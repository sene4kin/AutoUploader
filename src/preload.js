const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('publisher', {
  chooseVideo: () => ipcRenderer.invoke('choose-video'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: values => ipcRenderer.invoke('config:save', values),
  connect: platform => ipcRenderer.invoke('oauth:connect', platform),
  disconnect: platform => ipcRenderer.invoke('oauth:disconnect', platform),
  publish: job => ipcRenderer.invoke('publish', job),
  cancelPublish: () => ipcRenderer.invoke('publish:cancel'),
  onProgress: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('publish:progress', listener);
    return () => ipcRenderer.removeListener('publish:progress', listener);
  }
});
