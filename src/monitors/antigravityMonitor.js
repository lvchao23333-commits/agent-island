const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const DEFAULT_WAITING_WINDOW_MS = 2 * 60 * 60 * 1000;

function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function postJson(port, urlPath, headers, body, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Reads active and recently-updated Antigravity conversations via the live
 * ConversationService hub HTTP API, with a read-only SQLite fallback.
 */
class AntigravityMonitor {
  constructor(options = {}) {
    this.agyDir =
      options.agyDir || path.join(os.homedir(), '.gemini', 'antigravity');
    this.waitingWindowMs = options.waitingWindowMs ?? DEFAULT_WAITING_WINDOW_MS;
    this.postJson = options.postJson || postJson;
  }

  _getPresenceLockIds() {
    const lockDir = path.join(this.agyDir, 'presence');
    const ids = new Set();
    try {
      for (const entry of fs.readdirSync(lockDir)) {
        if (entry.endsWith('.lock')) {
          ids.add(entry.slice(0, -5));
        }
      }
    } catch {
      // Ignore missing presence dir
    }
    return ids;
  }

  _findLiveHub() {
    const daemonDir = path.join(this.agyDir, 'daemon');
    let files = [];
    try {
      files = fs
        .readdirSync(daemonDir)
        .filter((f) => f.startsWith('hub_') && f.endsWith('.json'))
        .map((f) => {
          const full = path.join(daemonDir, f);
          return { full, mtime: fs.statSync(full).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch {
      return null;
    }

    for (const file of files) {
      try {
        const info = JSON.parse(fs.readFileSync(file.full, 'utf8'));
        if (info.httpPort && info.csrfToken && isPidAlive(info.pid)) {
          return info;
        }
      } catch {
        // Ignore malformed hub file
      }
    }
    return null;
  }

  async _pollViaHub(hub, lockIds) {
    const res = await this.postJson(
      hub.httpPort,
      '/product.v1.ConversationService/ListConversations',
      {
        'Connect-Protocol-Version': '1',
        'x-antigravity-csrf-token': hub.csrfToken,
      },
      { pageSize: 30, includeArchived: false }
    );

    const now = Date.now();
    const items = [];
    for (const conv of res.conversations || []) {
      const runState = conv.state?.runState || 'RUN_STATE_IDLE';
      const isRunning =
        runState === 'RUN_STATE_RUNNING' || runState === 'RUN_STATE_CANCELLING';
      const updatedAtMs = conv.state?.updateTime
        ? Date.parse(conv.state.updateTime)
        : 0;
      const isLocked = lockIds.has(conv.id);
      const isRecent = updatedAtMs > 0 && now - updatedAtMs <= this.waitingWindowMs;

      if (!isRunning && !isLocked && !isRecent) {
        continue;
      }

      const title =
        (conv.annotations?.title && conv.annotations.title.trim()) ||
        (conv.state?.summary && conv.state.summary.trim()) ||
        conv.id.slice(0, 8);

      items.push({
        id: `agy:${conv.id}`,
        rawId: conv.id,
        source: 'antigravity',
        title,
        status: isRunning ? 'running' : 'waiting',
        detailStatus: runState,
        isLocked,
        updatedAt: updatedAtMs,
      });
    }
    return items;
  }

  _pollViaSqlite(lockIds) {
    if (!DatabaseSync) {
      return [];
    }
    const dbPath = path.join(this.agyDir, 'conversation_summaries.db');
    if (!fs.existsSync(dbPath)) {
      return [];
    }

    const now = Date.now();
    let db = null;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db
        .prepare(
          `SELECT conversation_id, title, preview, status, last_modified_time
           FROM conversation_summaries
           ORDER BY last_modified_time DESC
           LIMIT 30`
        )
        .all();

      const items = [];
      for (const row of rows) {
        const isRunning = row.status === 'CASCADE_RUN_STATUS_RUNNING';
        const updatedAtMs = row.last_modified_time
          ? Date.parse(row.last_modified_time)
          : 0;
        const isLocked = lockIds.has(row.conversation_id);
        const isRecent = updatedAtMs > 0 && now - updatedAtMs <= this.waitingWindowMs;

        if (!isRunning && !isLocked && !isRecent) {
          continue;
        }

        items.push({
          id: `agy:${row.conversation_id}`,
          rawId: row.conversation_id,
          source: 'antigravity',
          title:
            (row.title && row.title.trim()) ||
            (row.preview && row.preview.trim().slice(0, 50)) ||
            row.conversation_id.slice(0, 8),
          status: isRunning ? 'running' : 'waiting',
          detailStatus: row.status || 'CASCADE_RUN_STATUS_IDLE',
          isLocked,
          updatedAt: updatedAtMs,
        });
      }
      return items;
    } finally {
      try { db?.close(); } catch {}
    }
  }

  async poll() {
    const lockIds = this._getPresenceLockIds();
    const hub = this._findLiveHub();
    if (hub) {
      try {
        const items = await this._pollViaHub(hub, lockIds);
        return { items, mode: 'hub', error: null };
      } catch (err) {
        // Fallback to SQLite if hub call fails
        try {
          const items = this._pollViaSqlite(lockIds);
          return { items, mode: 'sqlite-fallback', error: err.message };
        } catch (sqlErr) {
          return { items: [], mode: 'error', error: sqlErr.message };
        }
      }
    }

    try {
      const items = this._pollViaSqlite(lockIds);
      return { items, mode: 'sqlite', error: null };
    } catch (err) {
      return { items: [], mode: 'error', error: err.message };
    }
  }
}

module.exports = { AntigravityMonitor };
