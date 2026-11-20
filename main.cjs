const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// Аппаратное ускорение WebGL2 / WebXR / SteamVR / OpenXR
app.commandLine.appendSwitch('enable-webgl2-compute-context');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-features', 'WebXR,OpenXR');
app.commandLine.appendSwitch('webxr-runtime', 'openxr');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#070b12',
    autoHideMenuBar: true,
    title: 'ALARA-Planner Pro VR',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Разрешаем WebXR, микрофон (PTT) и WebBluetooth (HIL ESP32) в локальном окне Electron
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'fullscreen', 'pointerLock', 'xr', 'bluetooth'];
    callback(allowed.includes(permission));
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged && devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
