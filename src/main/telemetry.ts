/**
 * Telemetry, crash reporting, and audit logging module.
 *
 * Designed to be opt-in and privacy-respecting:
 *   - crash/error reports only collect stack traces and app version.
 *   - audit logs capture Agent tool usage and file changes.
 *
 * Sentry integration is available via the SENTRY_DSN environment variable.
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface TelemetryConfig {
  enabled: boolean;
  sentryDsn?: string;
  environment?: string;
  sampleRate?: number;
}

export interface AuditEntry {
  id: string;
  ts: number;
  actor: 'user' | 'agent' | 'plugin' | 'system';
  action: string;
  target?: string;
  details?: Record<string, any>;
}

/** audit.jsonl 达到该大小后轮转为 audit.jsonl.1（防止磁盘无限增长）。 */
const MAX_AUDIT_BYTES = 4 * 1024 * 1024;

class TelemetryManager {
  private config: TelemetryConfig = { enabled: false };
  private auditLog: AuditEntry[] = [];
  private maxAuditEntries = 2000;
  private _auditFile: string | null = null;
  private sentryInitialized = false;
  private auditLoaded = false;
  private pendingAudit: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private auditBytes = 0;

  /** Lazily resolve the audit file path. `app.getPath` is only safe to call
   *  after Electron's `app` module has been fully initialized, so we avoid
   *  touching it at module-load time (the `telemetry` singleton is created
   *  at import, which can run before `app` is ready in some entry paths). */
  private get auditFile(): string {
    if (this._auditFile === null) {
      this._auditFile = path.join(app.getPath('userData'), 'audit.jsonl');
    }
    return this._auditFile;
  }

  constructor() {
    // Defer all file I/O until first use so importing this module never
    // crashes when `app` isn't ready yet.
  }

  setConfig(config: TelemetryConfig) {
    this.config = { ...this.config, ...config };
    if (this.config.enabled && this.config.sentryDsn && !this.sentryInitialized) {
      this.initSentry();
    }
  }

  private initSentry() {
    try {
      // Dynamic import keeps Sentry optional (not a hard dependency).
      const Sentry = require('@sentry/electron/main');
      Sentry.init({
        dsn: this.config.sentryDsn,
        environment: this.config.environment || 'production',
        sampleRate: this.config.sampleRate ?? 1.0,
        release: app.getVersion(),
      });
      this.sentryInitialized = true;
    } catch {
      // Sentry not installed; log locally instead.
      this.captureMessage('Sentry integration requested but @sentry/electron/main is not installed', 'warn');
    }
  }

  captureException(error: Error, context?: Record<string, any>) {
    const payload = { message: error.message, stack: error.stack, context };
    this.writeAudit({ id: this.uuid(), ts: Date.now(), actor: 'system', action: 'exception', details: payload });
    if (this.config.enabled && this.sentryInitialized) {
      try {
        const Sentry = require('@sentry/electron/main');
        Sentry.captureException(error, { extra: context });
      } catch { /* ignore */ }
    }
  }

  captureMessage(message: string, level: 'info' | 'warn' | 'error' = 'info', context?: Record<string, any>) {
    this.writeAudit({ id: this.uuid(), ts: Date.now(), actor: 'system', action: 'message', details: { level, message, context } });
    if (this.config.enabled && this.sentryInitialized) {
      try {
        const Sentry = require('@sentry/electron/main');
        Sentry.captureMessage(message, level);
      } catch { /* ignore */ }
    }
  }

  audit(actor: AuditEntry['actor'], action: string, target?: string, details?: Record<string, any>) {
    this.writeAudit({ id: this.uuid(), ts: Date.now(), actor, action, target, details });
  }

  private writeAudit(entry: AuditEntry) {
    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-this.maxAuditEntries);
    }
    // 异步批量写盘：不在每个 Agent 工具调用链上同步阻塞主进程。
    this.pendingAudit.push(entry);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushAudit(), 500);
    }
    // 文件大小防护：超过 4MB 轮转（audit.jsonl → audit-1.jsonl），
    // 避免日志无限增长（原实现只写不轮转）。
    if (this.auditBytes > MAX_AUDIT_BYTES) {
      this.rotateAudit();
    }
  }

  private flushAudit() {
    this.flushTimer = null;
    if (this.pendingAudit.length === 0) return;
    const batch = this.pendingAudit;
    this.pendingAudit = [];
    const lines = batch.map(e => JSON.stringify(e)).join('\n') + '\n';
    try {
      fs.appendFileSync(this.auditFile, lines, 'utf-8');
      this.auditBytes += Buffer.byteLength(lines);
    } catch { /* ignore */ }
  }

  private rotateAudit() {
    try {
      if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
      this.flushAudit();
      const rotated = `${this.auditFile}.1`;
      if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
      if (fs.existsSync(this.auditFile)) fs.renameSync(this.auditFile, rotated);
      this.auditBytes = 0;
    } catch { /* ignore */ }
  }

  private loadAuditLog() {
    try {
      if (!fs.existsSync(this.auditFile)) return;
      const lines = fs.readFileSync(this.auditFile, 'utf-8').split('\n').filter(Boolean);
      this.auditLog = lines.slice(-this.maxAuditEntries).map(l => JSON.parse(l));
    } catch {
      this.auditLog = [];
    }
  }

  getAuditLog(): AuditEntry[] {
    if (!this.auditLoaded) {
      this.loadAuditLog();
      this.auditLoaded = true;
    }
    return [...this.auditLog];
  }

  clearAuditLog() {
    this.auditLog = [];
    try { fs.writeFileSync(this.auditFile, '', 'utf-8'); } catch { /* ignore */ }
  }

  private uuid(): string {
    // cryptographically random — Math.random()-based ids are predictable and
    // let an observer guess future audit entry ids.
    return randomUUID();
  }
}

export const telemetry = new TelemetryManager();
