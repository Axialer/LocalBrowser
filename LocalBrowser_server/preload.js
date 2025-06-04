const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    startServer: (contentPath) => ipcRenderer.invoke('start-server', contentPath),
    onServerLog: (callback) => ipcRenderer.on('server-log', (event, message) => callback(message)),
    onClientListUpdate: (callback) => ipcRenderer.on('client-list-update', (event, clients) => callback(clients)),
    getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
    getHostname: () => ipcRenderer.invoke('get-hostname')
}); 