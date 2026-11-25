const islandEl = document.getElementById('island');
const pillView = document.getElementById('pill-view');
const pillDot = document.getElementById('pill-dot');
const pillText = document.getElementById('pill-text');
const toastView = document.getElementById('toast-view');
const toastBadge = document.getElementById('toast-badge');
const toastStatus = document.getElementById('toast-status');
const toastTitle = document.getElementById('toast-title');
const toastClose = document.getElementById('toast-close');
const panelView = document.getElementById('panel-view');
const panelBody = document.getElementById('panel-body');
const btnCollapse = document.getElementById('btn-collapse');
const btnRefresh = document.getElementById('btn-refresh');

let currentMode = 'pill'; // 'pill' | 'toast' | 'panel'
let toastTimer = null;
let activeToastEvent = null;
let latestState = {
  running: [],
  waiting: [],
  recentFinished: [],
};

function formatRelativeTime(ms) {
  if (!ms) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 15) return '刚刚';
  if (diffSec < 60) return `${diffSec}秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  return `${diffHour}小时前`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setMode(mode) {
  currentMode = mode;
  islandEl.className = `island mode-${mode}`;
  pillView.classList.toggle('hidden', mode !== 'pill');
  toastView.classList.toggle('hidden', mode !== 'toast');
  panelView.classList.toggle('hidden', mode !== 'panel');

  if (mode === 'pill') {
    window.islandAPI.resizeIsland(260, 76);
  } else if (mode === 'toast') {
    window.islandAPI.resizeIsland(396, 118);
  } else if (mode === 'panel') {
    requestAnimationFrame(() => {
      const h = Math.min(500, Math.max(140, islandEl.offsetHeight + 42));
      window.islandAPI.resizeIsland(424, h);
    });
  }
}

function renderPill() {
  const rCount = latestState.running.length;
  const wCount = latestState.waiting.length;

  pillDot.className = 'status-dot';
  if (rCount > 0) {
    pillDot.classList.add('running');
  } else if (wCount > 0) {
    pillDot.classList.add('waiting');
  } else {
    pillDot.classList.add('idle');
  }

  if (rCount > 0 && wCount > 0) {
    pillText.textContent = `${rCount} 运行中 · ${wCount} 待回复`;
  } else if (rCount > 0) {
    pillText.textContent = `${rCount} 个对话运行中`;
  } else if (wCount > 0) {
    pillText.textContent = `${wCount} 个对话等待回复`;
  } else {
    pillText.textContent = '暂无活跃对话';
  }
}

function renderItem(item, isRunning) {
  const sourceLabel = item.source === 'codex' ? 'Codex' : 'Antigravity';
  const statusText = isRunning ? '正在运行...' : '等待回复';
  const rel = formatRelativeTime(item.updatedAt);
  const meta = rel ? `${statusText} · ${rel}` : statusText;

  return `
    <div class="conv-item" data-id="${escapeHtml(item.id)}" data-source="${escapeHtml(item.source)}" data-raw-id="${escapeHtml(item.rawId || '')}" title="点击跳转到对话">
      <span class="status-dot ${isRunning ? 'running' : 'waiting'}"></span>
      <span class="source-badge ${item.source}">${sourceLabel}</span>
      <div class="conv-info">
        <div class="conv-title">${escapeHtml(item.title)}</div>
        <div class="conv-meta">${escapeHtml(meta)}</div>
      </div>
      <span class="conv-jump">↗</span>
      <button class="conv-delete" type="button" title="从列表移除">✕</button>
    </div>
  `;
}

function renderPanel() {
  const { running, waiting } = latestState;
  const parts = [];

  if (running.length > 0) {
    parts.push(`
      <div>
        <div class="section-title">正在运行 (${running.length})</div>
        <div class="item-list">
          ${running.map((item) => renderItem(item, true)).join('')}
        </div>
      </div>
    `);
  }

  if (waiting.length > 0) {
    parts.push(`
      <div>
        <div class="section-title">等待回复 (${waiting.length})</div>
        <div class="item-list">
          ${waiting.slice(0, 12).map((item) => renderItem(item, false)).join('')}
        </div>
      </div>
    `);
  }

  if (parts.length === 0) {
    parts.push('<div class="empty-state">Codex 与 Antigravity 当前均无活跃对话</div>');
  }

  panelBody.innerHTML = parts.join('');
  if (currentMode === 'panel') {
    setMode('panel');
  }
}

function showFinishToast(ev) {
  if (currentMode === 'panel') return;
  if (toastTimer) clearTimeout(toastTimer);
  activeToastEvent = ev;

  toastBadge.textContent = ev.source === 'codex' ? 'Codex' : 'Antigravity';
  toastBadge.className = `source-badge ${ev.source}`;
  toastStatus.textContent =
    ev.detailStatus === 'failed'
      ? '运行失败'
      : ev.detailStatus === 'interrupted'
        ? '已中断'
        : '运行完成 · 等待回复';
  toastTitle.textContent = ev.title;

  setMode('toast');
  toastTimer = setTimeout(() => {
    if (currentMode === 'toast') {
      activeToastEvent = null;
      setMode('pill');
    }
  }, 5000);
}

pillView.addEventListener('click', () => {
  setMode('panel');
});

toastView.addEventListener('click', (e) => {
  if (e.target === toastClose) return;
  if (toastTimer) clearTimeout(toastTimer);
  if (activeToastEvent) {
    window.islandAPI.openConversation({
      source: activeToastEvent.source,
      rawId: activeToastEvent.rawId,
    });
    activeToastEvent = null;
  }
  setMode('pill');
});

panelBody.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('.conv-delete');
  if (deleteBtn) {
    e.stopPropagation();
    const itemEl = deleteBtn.closest('.conv-item');
    const id = itemEl?.dataset.id;
    if (id) {
      window.islandAPI.dismissConversation(id);
    }
    return;
  }

  const itemEl = e.target.closest('.conv-item');
  if (!itemEl) return;
  const source = itemEl.dataset.source;
  const rawId = itemEl.dataset.rawId;
  if (source && rawId) {
    window.islandAPI.openConversation({ source, rawId });
  }
});

toastClose.addEventListener('click', (e) => {
  e.stopPropagation();
  if (toastTimer) clearTimeout(toastTimer);
  setMode('pill');
});

btnCollapse.addEventListener('click', () => {
  setMode('pill');
});

btnRefresh.addEventListener('click', () => {
  window.islandAPI.requestRefresh();
});

window.islandAPI.onStateUpdate((data) => {
  latestState = data;
  renderPill();
  renderPanel();
});

window.islandAPI.onTaskFinished((events) => {
  if (events && events.length > 0) {
    showFinishToast(events[0]);
  }
});
