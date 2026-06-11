// Compile agent and main process TS to JS using TypeScript API
// Using transpileModule for speed (no type checking, just TS->JS)
const path = require('path');
const fs = require('fs');
const ts = require(path.join(__dirname, 'node_modules', '.typescript-ZsywiT6h', 'lib', 'typescript.js'));

const ROOT = __dirname;
const options = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
};

function compileAndWrite(tsPath, jsPath) {
  const source = fs.readFileSync(tsPath, 'utf-8');
  const result = ts.transpileModule(source, {
    compilerOptions: options,
    fileName: path.basename(tsPath),
  });
  const dir = path.dirname(jsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(jsPath, result.outputText);
  console.log('OK:', path.relative(ROOT, tsPath), '->', path.relative(ROOT, jsPath));
}

function processDir(srcDir, destDir) {
  const srcPath = path.join(ROOT, srcDir);
  const destPath = path.join(ROOT, destDir);
  if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
  
  const entries = fs.readdirSync(srcPath, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.endsWith('.ts')) {
      const tsFile = path.join(srcPath, e.name);
      const jsFile = path.join(destPath, e.name.replace(/\.ts$/, '.js'));
      try {
        compileAndWrite(tsFile, jsFile);
      } catch (err) {
        console.error('FAIL:', path.relative(ROOT, tsFile), '-', err.message);
      }
    }
  }
}

console.log('=== Compiling TypeScript (Main Process) ===');
processDir('src/agent', 'dist/agent');
processDir('src/main', 'dist/main');
// Copy pure JS files that have no TS source
const agentSrc = path.join(ROOT, 'src/agent');
const agentDst = path.join(ROOT, 'dist/agent');
const entries = fs.readdirSync(agentSrc, { withFileTypes: true });
for (const e of entries) {
  if (e.name.endsWith('.js') && !fs.existsSync(path.join(agentSrc, e.name.replace(/\.js$/, '.ts')))) {
    fs.copyFileSync(path.join(agentSrc, e.name), path.join(agentDst, e.name));
    console.log('COPY:', 'src/agent/' + e.name, '->', 'dist/agent/' + e.name);
  }
}
console.log('=== Main process compilation complete ===');
