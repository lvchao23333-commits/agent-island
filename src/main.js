const path = require('node:path');
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require('electron');
const { CodexMonitor } = require('./monitors/codexMonitor');
const { AntigravityMonitor } = require('./monitors/antigravityMonitor');
const { StateTracker } = require('./stateTracker');

const POLL_INTERVAL_MS = 1500;
const TOP_MARGIN_PX = 8;

let mainWindow = null;
let tray = null;
let pollTimer = null;

const settings = {
  notificationsEnabled: true,
  visible: true,
};

const codexMonitor = new CodexMonitor();
const agyMonitor = new AntigravityMonitor();
const stateTracker = new StateTracker();

function createTrayIcon() {
  // 16x16 solid dark-blue/emerald dot PNG as data URL
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect x="2" y="7" width="28" height="18" rx="9" fill="#111827" stroke="#34d399" stroke-width="2.5"/>
    <circle cx="11" cy="16" r="3.5" fill="#34d399"/>
    <circle cx="21" cy="16" r="3.5" fill="#60a5fa"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

function positionTopCenter(width, height) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const { x, y, width: screenW } = display.workArea;
  const winX = Math.round(x + (screenW - width) / 2);
  const winY = y + TOP_MARGIN_PX;
  mainWindow.setBounds({ x: winX, y: winY, width, height }, false);
}

function createWindow() {
  const initW = 256;
  const initH = 44;

  mainWindow = new BrowserWindow({
    width: initW,
    height: initH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionTopCenter(initW, initH);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Agent Island - Codex & Antigravity Monitor');

  const rebuildMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: settings.visible ? '隐藏灵动岛' : '显示灵动岛',
        click: () => {
          settings.visible = !settings.visible;
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (settings.visible) mainWindow.showInactive();
            else mainWindow.hide();
          }
          rebuildMenu();
        },
      },
      {
        label: 'Windows 系统通知提醒',
        type: 'checkbox',
        checked: settings.notificationsEnabled,
        click: (item) => {
          settings.notificationsEnabled = item.checked;
        },
      },
      { type: 'separator' },
      {
        label: '立即刷新',
        click: () => {
          runPoll();
        },
      },
      {
        label: '退出',
        click: () => {
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  tray.on('click', () => {
    settings.visible = !settings.visible;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (settings.visible) mainWindow.showInactive();
      else mainWindow.hide();
    }
    rebuildMenu();
  });

  rebuildMenu();
}

async function openConversation({ source, rawId }) {
  if (!rawId) return;
  const targetUrl =
    source === 'codex'
      ? `codex://threads/${encodeURIComponent(rawId)}`
      : `antigravity://conversation/${encodeURIComponent(rawId)}`;
  try {
    await shell.openExternal(targetUrl);
  } catch {
    const fallbackUrl = source === 'codex' ? 'codex://' : 'antigravity://';
    try {
      await shell.openExternal(fallbackUrl);
    } catch {
      // Ignore if protocol handler unavailable
    }
  }
}

function sendSystemNotifications(finishedEvents) {
  if (!settings.notificationsEnabled || !Notification.isSupported()) return;
  for (const ev of finishedEvents) {
    const sourceLabel = ev.source === 'codex' ? 'Codex' : 'Antigravity';
    const statusLabel =
      ev.detailStatus === 'failed'
        ? '运行失败'
        : ev.detailStatus === 'interrupted'
          ? '已中断'
          : '已运行完成，等待你的回复';

    const notification = new Notification({
      title: `${sourceLabel} · ${statusLabel}`,
      body: ev.title,
      silent: false,
    });
    notification.on('click', () => {
      openConversation({ source: ev.source, rawId: ev.rawId });
    });
    notification.show();
  }
}

async function runPoll() {
  const [codexRes, agyRes] = await Promise.all([
    Promise.resolve(codexMonitor.poll()),
    agyMonitor.poll(),
  ]);

  const allItems = [...agyRes.items, ...codexRes.items];
  const snapshot = stateTracker.update(allItems);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-update', {
      running: snapshot.running,
      waiting: snapshot.waiting,
      recentFinished: snapshot.recentFinished,
      updatedAt: snapshot.updatedAt,
      errors: {
        codex: codexRes.error,
        antigravity: agyRes.error,
      },
    });

    if (snapshot.newlyFinished.length > 0) {
      mainWindow.webContents.send('task-finished', snapshot.newlyFinished);
      sendSystemNotifications(snapshot.newlyFinished);
    }
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.agent.island');
  }

  createWindow();
  createTray();

  ipcMain.on('resize-island', (_event, { width, height }) => {
    const w = Math.max(180, Math.min(460, Math.round(width)));
    const h = Math.max(38, Math.min(520, Math.round(height)));
    positionTopCenter(w, h);
  });

  ipcMain.on('request-refresh', () => {
    runPoll();
  });

  ipcMain.on('open-conversation', (_event, payload) => {
    if (payload) {
      openConversation(payload);
    }
  });

  ipcMain.on('dismiss-conversation', (_event, id) => {
    if (id) {
      stateTracker.dismiss(id);
      runPoll();
    }
  });

  mainWindow.webContents.once('did-finish-load', async () => {
    await runPoll();
    if (process.argv.includes('--smoke-test')) {
      const snap = stateTracker.update([]); // just read counts? No, let's log from runPoll
      console.log('SMOKE_TEST_OK');
      setTimeout(() => app.exit(0), 500);
    }
  });

  if (!process.argv.includes('--smoke-test')) {
    pollTimer = setInterval(runPoll, POLL_INTERVAL_MS);
  }
});

app.on('before-quit', () => {
  if (pollTimer) clearInterval(pollTimer);
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
