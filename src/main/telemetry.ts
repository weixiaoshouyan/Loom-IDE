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

class TelemetryManager {
  private config: TelemetryConfig = { enabled: false };
  private auditLog: AuditEntry[] = [];
  private maxAuditEntries = 2000;
  private _auditFile: string | null = null;
  private sentryInitialized = false;
  private auditLoaded = false;

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
    try {
      fs.appendFileSync(this.auditFile, JSON.stringify(entry) + '\n', 'utf-8');
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
