const { contextBridge, ipcRenderer } = require('electron');

const onProgressListeners = new Set();
ipcRenderer.on('download:progress', (_e, evt) => {
  for (const fn of onProgressListeners) fn(evt);
});

contextBridge.exposeInMainWorld('api', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (value) => ipcRenderer.invoke('config:set', value),
  },
  spotify: {
    fetchPlaylist: (url) => ipcRenderer.invoke('spotify:fetch', url),
  },
  download: {
    start: (payload) => ipcRenderer.invoke('download:start', payload),
    cancel: () => ipcRenderer.invoke('download:cancel'),
    onProgress: (cb) => {
      onProgressListeners.add(cb);
      return () => onProgressListeners.delete(cb);
    },
  },
  shell: {
    openFolder: (target) => ipcRenderer.invoke('shell:openFolder', target),
  },
});
