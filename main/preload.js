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
  dialog: {
    pickFolder: (current) => ipcRenderer.invoke('dialog:pickFolder', current),
  },
  library: {
    reset: () => ipcRenderer.invoke('library:reset'),
  },
  spotify: {
    fetchPlaylist: (url) => ipcRenderer.invoke('spotify:fetch', url),
  },
  spotifyAccount: {
    getStatus: () => ipcRenderer.invoke('spotify:status'),
    connect: () => ipcRenderer.invoke('spotify:connect'),
    disconnect: () => ipcRenderer.invoke('spotify:disconnect'),
    onStatusChange: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('spotify:status-changed', listener);
      return () => ipcRenderer.off('spotify:status-changed', listener);
    },
  },
  youtube: {
    fetchPlaylist: (url) => ipcRenderer.invoke('youtube:fetch', url),
  },
  soundcloud: {
    fetchPlaylist: (url) => ipcRenderer.invoke('soundcloud:fetch', url),
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
