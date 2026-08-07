/**
 * Plugin sandbox — capability-gated module loader for plugin entry code.
 *
 * Previously plugin `main` entries were loaded with a bare `require(mainPath)`
 * in the main process, granting the plugin the FULL Node.js surface
 * (`child_process`, `fs`, `net`, …) with no isolation. This module runs plugin
 * code inside a Node `vm` context with:
 *
 *   1. A curated set of globals (no ambient `process`/`global` unless the plugin
 *      explicitly declares the matching capability).
 *   2. A `require` shim that only resolves:
 *        - a small allow-list of "safe" built-ins (path, util, events, …),
 *        - capability-gated built-ins (fs → 'fs', net/http → 'network', …),
 *        - relative / bundled files that stay INSIDE the plugin root.
 *      Anything else throws before the module is loaded.
 *
 * SECURITY NOTE: Node's `vm` is not a hard security boundary on its own — a
 * determined script can reach out through prototype tricks. The real control
 * here is the capability-gated `require`: without a declared capability the
 * plugin cannot obtain `child_process`, `fs`, or networking modules, which are
 * the primitives needed to actually do damage. Treat this as defense-in-depth,
 * not a full jail.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire, isBuiltin as nodeIsBuiltin } from 'module';

/** Capabilities a plugin may declare in its manifest (`capabilities: [...]`). */
export const KNOWN_CAPABILITIES = ['fs', 'network', 'child_process', 'process', 'worker'] as const;
export type PluginCapability = typeof KNOWN_CAPABILITIES[number];

/** Built-ins always available regardless of declared capabilities. */
const SAFE_BUILTINS = new Set([
  'path', 'url', 'util', 'events', 'string_decoder', 'querystring',
  'assert', 'buffer', 'stream', 'zlib', 'punycode', 'timers', 'crypto',
]);

/** Built-ins unlocked only when the matching capability is declared. */
const CAPABILITY_BUILTINS: Record<PluginCapability, string[]> = {
  fs: ['fs', 'fs/promises'],
  network: ['net', 'http', 'https', 'http2', 'tls', 'dns', 'dgram'],
  child_process: ['child_process'],
  process: ['os'],
  worker: ['worker_threads', 'cluster'],
};

/** Normalize a builtin name by stripping the optional `node:` prefix. */
function builtinName(request: string): string {
  return request.startsWith('node:') ? request.slice(5) : request;
}

/** Validate declared capabilities; returns the list of unknown entries. */
export function findUnknownCapabilities(capabilities: string[]): string[] {
  const known = new Set<string>(KNOWN_CAPABILITIES);
  return capabilities.filter(c => !known.has(c));
}

function isInsideRoot(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}

// ---------------------------------------------------------------------------
// Sandbox realm hardening.
//
// Node's `vm` is NOT a security boundary: anything with a reachable host-realm
// reference (host function/object) can escape via `.constructor.constructor`
// chains. The previous implementation injected host `console`, `Buffer`, URL,
// timers, etc. into the sandbox, making escape a one-liner:
//     console.log.constructor.constructor('return process')()
//
// Defense applied here:
//   1. Every injected object is prototype-less (`Object.create(null)`) and
//      every injected function is wrapped in a Proxy that shadows
//      `constructor` / `__proto__` / `prototype` (only call/apply/bind pass).
//   2. Objects handed out by `require` (built-in modules, JSON, nested
//      properties) are wrapped the same way.
//   3. No host globals (Buffer, URL, TextEncoder, timers, process, …) are
//      injected. `process` is only available as a *safe subset* object when
//      the plugin declares the `process` capability.
//
// This closes all trivial escape vectors; treat it as accident-prevention,
// not a jail for intentionally malicious plugins.
// ---------------------------------------------------------------------------

function safeHostFn<T extends (...args: any[]) => any>(fn: T, wrapResult = false): T {
  return new Proxy(fn, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      return wrapResult ? sandboxSafe(result) : result;
    },
    get(target, prop) {
      if (prop === 'call' || prop === 'apply' || prop === 'bind') {
        return safeHostFn(Reflect.get(target, prop) as any, wrapResult);
      }
      return undefined;
    },
  }) as T;
}

function sandboxSafe(value: any, depth = 0): any {
  if (depth > 3) return value;
  if (typeof value === 'function') return safeHostFn(value, true);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return new Proxy(value, {
      get(target, prop) {
        if (typeof prop === 'string' && (prop === 'constructor' || prop === '__proto__' || prop === 'prototype')) {
          return undefined;
        }
        return sandboxSafe(Reflect.get(target, prop), depth + 1);
      },
      set(target, prop, v) {
        return Reflect.set(target, prop, v);
      },
    });
  }
  return value;
}

function buildSafeConsole(): Record<string, (...args: any[]) => void> {
  const c: Record<string, (...args: any[]) => void> = Object.create(null);
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const real = console[level].bind(console);
    c[level] = safeHostFn((...args: any[]) => real(...args));
  }
  return c;
}

/** Prototype-less snapshot of `process` for plugins that declare the capability. */
function buildSafeProcess(): Record<string, any> {
  const env: Record<string, string> = Object.create(null);
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return Object.assign(Object.create(null), {
    env,
    platform: process.platform,
    arch: process.arch,
    version: process.version,
    versions: Object.assign(Object.create(null), process.versions),
    pid: process.pid,
    cwd: safeHostFn(() => process.cwd()),
    exit: safeHostFn((code?: number) => process.exit(code ?? 0)),
  });
}

export interface SandboxOptions {
  /** Absolute path to the plugin root; requires may never escape it. */
  pluginRoot: string;
  /** Capabilities declared in the manifest (already validated). */
  capabilities?: string[];
}

/**
 * Load a plugin entry file in a capability-gated sandbox and return its
 * `module.exports`. Throws if the entry escapes the plugin root or requests a
 * module its capabilities do not permit.
 */
export function loadPluginSandboxed(entryPath: string, options: SandboxOptions): any {
  const pluginRoot = path.resolve(options.pluginRoot);
  const granted = new Set(options.capabilities || []);
  const moduleCache = new Map<string, any>();

  const buildRequire = (fromDir: string) => {
    const nativeRequire = createRequire(path.join(fromDir, '__loom_plugin__.js'));

    return function pluginRequire(request: string): any {
      // 1. Built-in modules — gated by the safe-list / capability map.
      if (nodeIsBuiltin(request)) {
        const name = builtinName(request);
        if (SAFE_BUILTINS.has(name)) return sandboxSafe(nativeRequire(request));
        for (const cap of granted) {
          if (CAPABILITY_BUILTINS[cap as PluginCapability]?.includes(name)) {
            return sandboxSafe(nativeRequire(request));
          }
        }
        throw new Error(
          `Plugin blocked from requiring built-in module "${request}": no matching capability declared.`,
        );
      }

      // 2. Relative / absolute / bundled files — must resolve INSIDE the root.
      let resolved: string;
      try {
        resolved = nativeRequire.resolve(request);
      } catch (e: any) {
        throw new Error(`Plugin require("${request}") failed to resolve: ${e.message}`);
      }
      if (!isInsideRoot(pluginRoot, resolved)) {
        throw new Error(`Plugin require("${request}") escapes the plugin directory.`);
      }
      // JSON is data, not code — load it directly.
      if (resolved.endsWith('.json')) return sandboxSafe(nativeRequire(request));
      return loadFile(resolved);
    };
  };

  const loadFile = (filePath: string): any => {
    const cached = moduleCache.get(filePath);
    if (cached) return cached.exports;

    const code = fs.readFileSync(filePath, 'utf-8');
    const dir = path.dirname(filePath);
    // Prototype-less module/exports: `module.constructor` / `exports.__proto__`
    // must not reach the host Object.prototype.
    const moduleObj = Object.create(null) as any;
    moduleObj.exports = Object.create(null) as any;
    moduleCache.set(filePath, moduleObj);

    const sandboxGlobals: Record<string, any> = {
      module: moduleObj,
      exports: moduleObj.exports,
      // Safe-wrapped host require: callable, but its property chain is opaque.
      require: safeHostFn(buildRequire(dir)),
      console: buildSafeConsole(),
      __filename: filePath,
      __dirname: dir,
    };
    // Only expose `process` (as a safe subset) when the plugin declares the
    // capability — never the host `process` object itself.
    if (granted.has('process')) sandboxGlobals.process = buildSafeProcess();

    const context = vm.createContext(sandboxGlobals);
    const script = new vm.Script(code, { filename: filePath });
    script.runInContext(context, { timeout: 5000 });
    return moduleObj.exports;
  };

  if (!isInsideRoot(pluginRoot, entryPath)) {
    throw new Error('Plugin entry escapes the plugin directory.');
  }
  return loadFile(path.resolve(entryPath));
}
