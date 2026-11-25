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
const btnLang = document.getElementById('btn-lang');

const I18N = {
  'zh-CN': {
    langToggleLabel: 'EN',
    langToggleTitle: 'Switch to English',
    refreshTitle: '刷新',
    collapseTitle: '收起',
    closeTitle: '关闭',
    justNow: '刚刚',
    secAgo: (n) => `${n}秒前`,
    minAgo: (n) => `${n}分钟前`,
    hourAgo: (n) => `${n}小时前`,
    runningAndWaiting: (r, w) => `${r} 运行中 · ${w} 待回复`,
    runningOnly: (r) => `${r} 个对话运行中`,
    waitingOnly: (w) => `${w} 个对话等待回复`,
    idlePill: '暂无活跃对话',
    runningStatus: '正在运行...',
    waitingStatus: '等待回复',
    openTooltip: '点击跳转到对话',
    dismissTooltip: '从列表移除',
    runningSection: (n) => `正在运行 (${n})`,
    waitingSection: (n) => `等待回复 (${n})`,
    emptyPanel: 'Codex 与 Antigravity 当前均无活跃对话',
    toastFailed: '运行失败',
    toastInterrupted: '已中断',
    toastDone: '运行完成 · 等待回复',
    toastOpening: '正在跳转...',
  },
  en: {
    langToggleLabel: '中',
    langToggleTitle: '切换到中文',
    refreshTitle: 'Refresh',
    collapseTitle: 'Collapse',
    closeTitle: 'Close',
    justNow: 'just now',
    secAgo: (n) => `${n}s ago`,
    minAgo: (n) => `${n}m ago`,
    hourAgo: (n) => `${n}h ago`,
    runningAndWaiting: (r, w) => `${r} running · ${w} waiting`,
    runningOnly: (r) => `${r} running`,
    waitingOnly: (w) => `${w} waiting`,
    idlePill: 'No active chats',
    runningStatus: 'Running...',
    waitingStatus: 'Waiting',
    openTooltip: 'Click to open conversation',
    dismissTooltip: 'Dismiss from list',
    runningSection: (n) => `Running (${n})`,
    waitingSection: (n) => `Waiting for reply (${n})`,
    emptyPanel: 'No active Codex or Antigravity chats',
    toastFailed: 'Failed',
    toastInterrupted: 'Interrupted',
    toastDone: 'Finished · Waiting for reply',
    toastOpening: 'Opening...',
  },
};

let currentLang = 'zh-CN';
let currentMode = 'pill'; // 'pill' | 'toast' | 'panel'
let toastTimer = null;
let peekLeaveTimer = null;
let emptyPanelTimer = null;
let isPillHovered = false;
let activeToastEvent = null;
let latestState = {
  running: [],
  waiting: [],
  recentFinished: [],
};

function t() {
  return I18N[currentLang] || I18N['zh-CN'];
}

function applyLanguage(lang) {
  currentLang = lang === 'en' ? 'en' : 'zh-CN';
  const dict = t();
  btnLang.textContent = dict.langToggleLabel;
  btnLang.title = dict.langToggleTitle;
  btnRefresh.title = dict.refreshTitle;
  btnCollapse.title = dict.collapseTitle;
  toastClose.title = dict.closeTitle;
  renderPill();
  renderPanel();
}

function formatRelativeTime(ms) {
  if (!ms) return '';
  const dict = t();
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 15) return dict.justNow;
  if (diffSec < 60) return dict.secAgo(diffSec);
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return dict.minAgo(diffMin);
  const diffHour = Math.floor(diffMin / 60);
  return dict.hourAgo(diffHour);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function updatePeekState() {
  const isIdle =
    latestState.running.length === 0 && latestState.waiting.length === 0;
  if (!islandEl.matches(':hover')) {
    isPillHovered = false;
  }
  const shouldPeek = currentMode === 'pill' && isIdle && !isPillHovered;
  islandEl.classList.toggle('is-peek', shouldPeek);
  document.body.classList.toggle('is-peeking', shouldPeek);
}

function scheduleEmptyPanelAutoClose() {
  const isEmpty =
    latestState.running.length === 0 && latestState.waiting.length === 0;
  if (currentMode === 'panel' && isEmpty) {
    if (!emptyPanelTimer) {
      emptyPanelTimer = setTimeout(() => {
        emptyPanelTimer = null;
        if (
          currentMode === 'panel' &&
          latestState.running.length === 0 &&
          latestState.waiting.length === 0
        ) {
          isPillHovered = false;
          setMode('pill');
        }
      }, 2000);
    }
  } else if (emptyPanelTimer) {
    clearTimeout(emptyPanelTimer);
    emptyPanelTimer = null;
  }
}

function setMode(mode) {
  currentMode = mode;
  islandEl.className = `island mode-${mode}`;
  pillView.classList.toggle('hidden', mode !== 'pill');
  toastView.classList.toggle('hidden', mode !== 'toast');
  panelView.classList.toggle('hidden', mode !== 'panel');
  updatePeekState();
  scheduleEmptyPanelAutoClose();

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

  const dict = t();
  if (rCount > 0 && wCount > 0) {
    pillText.textContent = dict.runningAndWaiting(rCount, wCount);
  } else if (rCount > 0) {
    pillText.textContent = dict.runningOnly(rCount);
  } else if (wCount > 0) {
    pillText.textContent = dict.waitingOnly(wCount);
  } else {
    pillText.textContent = dict.idlePill;
  }
  updatePeekState();
}

function renderItem(item, isRunning) {
  const dict = t();
  const sourceLabel = item.source === 'codex' ? 'Codex' : 'Antigravity';
  const statusText = isRunning ? dict.runningStatus : dict.waitingStatus;
  const rel = formatRelativeTime(item.updatedAt);
  const meta = rel ? `${statusText} · ${rel}` : statusText;

  return `
    <div class="conv-item" data-id="${escapeHtml(item.id)}" data-status="${isRunning ? 'running' : 'waiting'}" data-source="${escapeHtml(item.source)}" data-raw-id="${escapeHtml(item.rawId || '')}" title="${escapeHtml(dict.openTooltip)}">
      <span class="status-dot ${isRunning ? 'running' : 'waiting'}"></span>
      <span class="source-badge ${item.source}">${sourceLabel}</span>
      <div class="conv-info">
        <div class="conv-title">${escapeHtml(item.title)}</div>
        <div class="conv-meta">${escapeHtml(meta)}</div>
      </div>
      <span class="conv-jump">↗</span>
      <button class="conv-delete" type="button" title="${escapeHtml(dict.dismissTooltip)}">✕</button>
    </div>
  `;
}

function renderPanel() {
  const dict = t();
  const { running, waiting } = latestState;
  const parts = [];

  if (running.length > 0) {
    parts.push(`
      <div>
        <div class="section-title">${escapeHtml(dict.runningSection(running.length))}</div>
        <div class="item-list">
          ${running.map((item) => renderItem(item, true)).join('')}
        </div>
      </div>
    `);
  }

  if (waiting.length > 0) {
    parts.push(`
      <div>
        <div class="section-title">${escapeHtml(dict.waitingSection(waiting.length))}</div>
        <div class="item-list">
          ${waiting.slice(0, 12).map((item) => renderItem(item, false)).join('')}
        </div>
      </div>
    `);
  }

  if (parts.length === 0) {
    parts.push(`<div class="empty-state">${escapeHtml(dict.emptyPanel)}</div>`);
  }

  panelBody.innerHTML = parts.join('');
  scheduleEmptyPanelAutoClose();
  if (currentMode === 'panel') {
    setMode('panel');
  }
}

function showFinishToast(ev) {
  if (currentMode === 'panel') return;
  if (toastTimer) clearTimeout(toastTimer);
  activeToastEvent = ev;
  const dict = t();

  toastBadge.textContent = ev.source === 'codex' ? 'Codex' : 'Antigravity';
  toastBadge.className = `source-badge ${ev.source}`;
  toastStatus.textContent =
    ev.detailStatus === 'failed'
      ? dict.toastFailed
      : ev.detailStatus === 'interrupted'
        ? dict.toastInterrupted
        : dict.toastDone;
  toastTitle.textContent = ev.title;

  setMode('toast');
  toastTimer = setTimeout(() => {
    if (currentMode === 'toast') {
      activeToastEvent = null;
      setMode('pill');
    }
  }, 5000);
}

islandEl.addEventListener('mouseenter', () => {
  if (peekLeaveTimer) {
    clearTimeout(peekLeaveTimer);
    peekLeaveTimer = null;
  }
  isPillHovered = true;
  updatePeekState();
});

function schedulePeekReset() {
  if (peekLeaveTimer) clearTimeout(peekLeaveTimer);
  peekLeaveTimer = setTimeout(() => {
    isPillHovered = false;
    updatePeekState();
  }, 180);
}

islandEl.addEventListener('mouseleave', schedulePeekReset);
document.addEventListener('mouseleave', schedulePeekReset);
window.addEventListener('blur', () => {
  isPillHovered = false;
  updatePeekState();
});

updatePeekState();

pillView.addEventListener('click', () => {
  setMode('panel');
});

toastView.addEventListener('click', async (e) => {
  if (e.target === toastClose) return;
  if (toastTimer) clearTimeout(toastTimer);
  if (activeToastEvent) {
    const ev = activeToastEvent;
    activeToastEvent = null;
    toastStatus.textContent = t().toastOpening;
    await window.islandAPI.openConversation({
      source: ev.source,
      rawId: ev.rawId,
    });
    if (ev.id) {
      window.islandAPI.dismissConversation(ev.id);
    }
  }
  setMode('pill');
});

panelBody.addEventListener('click', async (e) => {
  const deleteBtn = e.target.closest('.conv-delete');
  if (deleteBtn) {
    e.stopPropagation();
    const itemEl = deleteBtn.closest('.conv-item');
    const id = itemEl?.dataset.id;
    if (id && itemEl) {
      itemEl.classList.add('is-removing');
      window.islandAPI.dismissConversation(id);
      setTimeout(() => {
        latestState.running = latestState.running.filter((i) => i.id !== id);
        latestState.waiting = latestState.waiting.filter((i) => i.id !== id);
        renderPill();
        renderPanel();
      }, 180);
    }
    return;
  }

  const itemEl = e.target.closest('.conv-item');
  if (!itemEl || itemEl.classList.contains('is-loading')) return;
  const id = itemEl.dataset.id;
  const status = itemEl.dataset.status;
  const source = itemEl.dataset.source;
  const rawId = itemEl.dataset.rawId;
  if (source && rawId) {
    itemEl.classList.add('is-loading');
    const jumpEl = itemEl.querySelector('.conv-jump');
    if (jumpEl) {
      jumpEl.outerHTML = '<span class="mini-spinner"></span>';
    }
    try {
      await window.islandAPI.openConversation({ source, rawId });
    } finally {
      if (status === 'waiting' && id) {
        itemEl.classList.add('is-removing');
        window.islandAPI.dismissConversation(id);
      } else {
        itemEl.classList.remove('is-loading');
        const spinner = itemEl.querySelector('.mini-spinner');
        if (spinner) {
          spinner.outerHTML = '<span class="conv-jump">↗</span>';
        }
      }
    }
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

btnLang.addEventListener('click', async () => {
  const next = currentLang === 'zh-CN' ? 'en' : 'zh-CN';
  const saved = await window.islandAPI.setLanguage(next);
  applyLanguage(saved);
});

btnRefresh.addEventListener('click', async () => {
  if (btnRefresh.classList.contains('is-spinning')) return;
  btnRefresh.classList.add('is-spinning');
  try {
    await window.islandAPI.requestRefresh();
  } finally {
    setTimeout(() => btnRefresh.classList.remove('is-spinning'), 250);
  }
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

window.islandAPI.onCursorOutside(() => {
  if (isPillHovered) {
    isPillHovered = false;
    updatePeekState();
  }
});

window.islandAPI.onLanguageChange((lang) => {
  applyLanguage(lang);
});

window.islandAPI.getLanguage().then(applyLanguage);
