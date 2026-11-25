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
  resizeIsland: (width, height) => {
    ipcRenderer.send('resize-island', { width, height });
  },
  requestRefresh: () => {
    ipcRenderer.send('request-refresh');
  },
});
