const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('yta', {
  defaultFolder: () => ipcRenderer.invoke('default-folder'),
  pickFolder: (start) => ipcRenderer.invoke('pick-folder', start),
  folderExists: (p) => ipcRenderer.invoke('folder-exists', p),
  run: (job) => ipcRenderer.invoke('run-job', job),
  probe: (url) => ipcRenderer.invoke('probe', url),
  loginStatus: () => ipcRenderer.invoke('login-status'),
  login: (url) => ipcRenderer.invoke('login', url),
  logout: () => ipcRenderer.invoke('logout'),
  cancel: (id) => ipcRenderer.invoke('cancel-job', id),
  reveal: (file) => ipcRenderer.invoke('reveal', file),
  retryTool: () => ipcRenderer.invoke('retry-tool'),
  toolStatus: () => ipcRenderer.invoke('tool-status'),
  onToolStatus: (cb) => subscribe('tool-status', cb),
  onJobEvent: (cb) => subscribe('job-event', cb),
  onLoginState: (cb) => subscribe('login-state', cb),
  updateState: () => ipcRenderer.invoke('update-state'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateState: (cb) => subscribe('update-state', cb),
  // Ponte com a extensão do navegador (ver electron/bridge.cjs).
  onExternalAdd: (cb) => subscribe('external-add', cb),
  externalAdded: (reply) => ipcRenderer.send('external-added', reply),
  reportItems: (list) => ipcRenderer.send('items-state', list),
  rendererReady: () => ipcRenderer.send('renderer-ready'),
  extensionHelp: () => ipcRenderer.invoke('extension-help'),
});
