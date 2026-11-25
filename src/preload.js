const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('islandAPI', {
  onStateUpdate: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('state-update', listener);
    return () => ipcRenderer.removeListener('state-update', listener);
  },
  onTaskFinished: (cb) => {
    const listener = (_event, events) => cb(events);
    ipcRenderer.on('task-finished', listener);
    return () => ipcRenderer.removeListener('task-finished', listener);
  },
  onCursorOutside: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('cursor-outside', listener);
    return () => ipcRenderer.removeListener('cursor-outside', listener);
  },
  onLanguageChange: (cb) => {
    const listener = (_event, lang) => cb(lang);
    ipcRenderer.on('language-change', listener);
    return () => ipcRenderer.removeListener('language-change', listener);
  },
  getLanguage: () => ipcRenderer.invoke('get-language'),
  setLanguage: (lang) => ipcRenderer.invoke('set-language', lang),
  resizeIsland: (width, height) => {
    ipcRenderer.send('resize-island', { width, height });
  },
  requestRefresh: () => ipcRenderer.invoke('request-refresh'),
  openConversation: (payload) => ipcRenderer.invoke('open-conversation', payload),
  dismissConversation: (id) => {
    ipcRenderer.send('dismiss-conversation', id);
  },
});
