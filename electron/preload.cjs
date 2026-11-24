const { contextBridge } = require('electron');

// Безопасный минимальный мост без передачи Node.js API в renderer
contextBridge.exposeInMainWorld('alaraElectron', {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome
  }
});
