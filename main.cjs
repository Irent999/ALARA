const { app, BrowserWindow, session, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Разрешаем fetch, WASM (Draco) и WebXR в локальном окне Electron без CORS-ошибок протокола file://
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

// Аппаратное ускорение WebGL2 / WebXR / SteamVR / OpenXR
app.commandLine.appendSwitch('enable-webgl2-compute-context');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-features', 'WebXR,OpenXR');
app.commandLine.appendSwitch('webxr-runtime', 'openxr');

function resolveDistFile(requestUrl) {
  const parsed = new URL(requestUrl);
  let relPath = decodeURIComponent(parsed.pathname || '/');
  if (relPath === '/' || relPath === '') {
    relPath = '/index.html';
  }
  const safeRel = path
    .normalize(relPath)
    .replace(/^([/\\])+/, '')
    .replace(/^(\.\.[/\\])+/, '');
  const distDir = path.join(__dirname, 'dist');
  const distCandidate = path.join(distDir, safeRel);
  if (fs.existsSync(distCandidate) && fs.statSync(distCandidate).isFile()) {
    return distCandidate;
  }

  // Позволяем положить тяжёлый assembly.glb рядом с exe, в resources/ или в public/ без пересборки asar
  if (safeRel === 'assembly.glb') {
    const externalCandidates = [
      path.join(process.resourcesPath || __dirname, 'assembly.glb'),
      path.join(path.dirname(app.getPath('exe')), 'assembly.glb'),
      path.join(__dirname, 'public', 'assembly.glb'),
      path.join(process.cwd(), 'public', 'assembly.glb'),
      path.join(process.cwd(), 'assembly.glb')
    ];
    for (const candidate of externalCandidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
    return null;
  }

  // Не подменяем отсутствующие бинарные/скриптовые файлы HTML-страницей (иначе GLTFLoader получает '<'!)
  const ext = path.extname(safeRel).toLowerCase();
  if (ext && ext !== '.html') {
    return null;
  }

  const indexFile = path.join(distDir, 'index.html');
  return fs.existsSync(indexFile) ? indexFile : null;
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#070b12',
    autoHideMenuBar: true,
    title: 'ALARA-Planner Pro VR',
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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
    mainWindow.loadURL('app://alara/index.html');
  }
}

// Доверяем локальному самоподписанному SSL-сертификату Vite dev-сервера (@vitejs/plugin-basic-ssl)
app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      event.preventDefault();
      callback(true);
      return;
    }
  } catch {
    // ignore
  }
  callback(false);
});

app.whenReady().then(() => {
  protocol.handle('app', request => {
    const filePath = resolveDistFile(request.url);
    if (!filePath) {
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

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
