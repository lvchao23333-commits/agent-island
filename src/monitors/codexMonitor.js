const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const DEFAULT_WAITING_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Reads active and recently-updated Codex conversations from local SQLite DBs.
 */
class CodexMonitor {
  constructor(options = {}) {
    this.codexDir = options.codexDir || path.join(os.homedir(), '.codex');
    this.waitingWindowMs = options.waitingWindowMs ?? DEFAULT_WAITING_WINDOW_MS;
  }

  _getActiveLockIds() {
    const lockDir = path.join(this.codexDir, 'thread-writer-locks');
    const ids = new Set();
    try {
      for (const entry of fs.readdirSync(lockDir)) {
        if (entry.endsWith('.lock') && !entry.startsWith('.')) {
          ids.add(entry.slice(0, -5));
        }
      }
    } catch {
      // Lock directory may not exist yet
    }
    return ids;
  }

  _openReadOnly(dbPath) {
    if (!DatabaseSync || !fs.existsSync(dbPath)) {
      return null;
    }
    return new DatabaseSync(dbPath, { readOnly: true });
  }

  poll() {
    if (!DatabaseSync) {
      return { items: [], error: 'node:sqlite unavailable' };
    }

    const statePath = path.join(this.codexDir, 'state_5.sqlite');
    const historyPath = path.join(this.codexDir, 'thread_history_1.sqlite');
    if (!fs.existsSync(statePath) || !fs.existsSync(historyPath)) {
      return { items: [], error: null };
    }

    const lockIds = this._getActiveLockIds();
    const now = Date.now();
    const cutoffSec = Math.floor((now - this.waitingWindowMs) / 1000);

    let stateDb = null;
    let historyDb = null;
    try {
      stateDb = this._openReadOnly(statePath);
      historyDb = this._openReadOnly(historyPath);
      if (!stateDb || !historyDb) {
        return { items: [], error: null };
      }

      const threads = stateDb
        .prepare(
          `SELECT id, title, cwd, updated_at
           FROM threads
           WHERE archived = 0 AND updated_at >= ?
           ORDER BY updated_at DESC
           LIMIT 50`
        )
        .all(cutoffSec - 86400); // include slightly older if locked

      // Also fetch latest turn status per thread from thread_history_1.sqlite
      const latestTurns = historyDb
        .prepare(
          `SELECT t1.thread_id, t1.status, t1.started_at, t1.completed_at
           FROM thread_turns t1
           INNER JOIN (
             SELECT thread_id, MAX(rollout_ordinal) AS max_ord
             FROM thread_turns
             GROUP BY thread_id
           ) t2
           ON t1.thread_id = t2.thread_id AND t1.rollout_ordinal = t2.max_ord`
        )
        .all();

      const turnByThread = new Map();
      for (const row of latestTurns) {
        turnByThread.set(row.thread_id, row);
      }

      const items = [];
      for (const t of threads) {
        const turn = turnByThread.get(t.id);
        const turnStatus = turn ? turn.status : 'completed';
        const updatedAtMs = (t.updated_at || 0) * 1000;
        const isLocked = lockIds.has(t.id);
        const isRunning = turnStatus === 'inProgress';
        const isRecent = now - updatedAtMs <= this.waitingWindowMs;

        if (!isRunning && !isLocked && !isRecent) {
          continue;
        }

        const displayTitle =
          (t.title && t.title.trim()) ||
          (t.cwd ? path.basename(t.cwd) : t.id.slice(0, 8));

        items.push({
          id: `codex:${t.id}`,
          rawId: t.id,
          source: 'codex',
          title: displayTitle,
          cwd: t.cwd || '',
          status: isRunning ? 'running' : 'waiting',
          detailStatus: turnStatus,
          isLocked,
          updatedAt: updatedAtMs,
        });
      }

      return { items, error: null };
    } catch (err) {
      return { items: [], error: err.message };
    } finally {
      try { stateDb?.close(); } catch {}
      try { historyDb?.close(); } catch {}
    }
  }
}

module.exports = { CodexMonitor };
