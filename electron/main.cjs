'use strict';

/**
 * РХБЗ VR Тренажер — запуск из .exe.
 *
 * Как это работает и почему именно так:
 *  • Chromium внутри Electron собран БЕЗ WebXR/OpenXR, поэтому VR в окне Electron невозможен.
 *    Поэтому Electron служит «запускателем»: поднимает локальный сервер с приложением и открывает его в
 *    установленном Chrome/Edge (на Windows 10/11 Edge есть всегда), где WebXR работает.
 *  • Адрес http://localhost:ПОРТ — «безопасный контекст» (secure context) для браузера, поэтому ошибки
 *    «WebXR нужен HTTPS» и ручные флажки chrome://flags не требуются. Сервер слушает только 127.0.0.1.
 *  • VR-рантайм (SteamVR для HTC Vive) выбирается автоматически через переменную XR_RUNTIME_JSON только
 *    для запускаемого браузера: настройки Windows и других программ не меняются.
 *  • Все решения (браузер, рантайм, флаги) вынесены в отдельные функции и записываются в лог:
 *    %APPDATA%\<название приложения>\launcher.log
 *
 * Параметры запуска (необязательные):
 *    --embedded                2D-режим в окне Electron (без VR)
 *    --browser="C:\...\chrome.exe"   или переменная ALARA_BROWSER   — свой браузер
 *    --xr-runtime=auto|steamvr|system   или ALARA_XR_RUNTIME        — выбор VR-рантайма (по умолчанию auto)
 */

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const childProcess = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_DEV = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:3000';
const PREFERRED_PORT = 47831;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const STEAMVR_STORE_URL = 'https://store.steampowered.com/app/250820/SteamVR/';

function readArg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const FORCE_EMBEDDED = process.argv.includes('--embedded');

// ================================================================ ЛОГ
let logFile = null;

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  try {
    console.log(line);
    if (!logFile) {
      const dir = app.getPath('userData');
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, 'launcher.log');
      try {
        if (fs.existsSync(logFile) && fs.statSync(logFile).size > 512 * 1024) {
          fs.renameSync(logFile, `${logFile}.old`);
        }
      } catch {
        /* не критично */
      }
    }
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    /* лог не должен ронять приложение */
  }
}

// ================================================================ ЛОКАЛЬНЫЙ СЕРВЕР
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function createStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  return http.createServer((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        return res.end();
      }

      let urlPath;
      try {
        urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
      } catch {
        res.writeHead(400);
        return res.end('Bad request');
      }

      let filePath = path.resolve(path.join(root, urlPath));
      // защита от выхода за пределы папки приложения (../)
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        // запрос файла с расширением, которого нет → честный 404; адрес без расширения → страница приложения
        if (path.extname(urlPath)) {
          res.writeHead(404);
          return res.end('Not found');
        }
        filePath = path.join(root, 'index.html');
      }

      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch (err) {
      log('Ошибка сервера:', err && err.message);
      res.writeHead(500);
      res.end('Server error');
    }
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

let staticServer = null;

async function startStaticServer() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error(`Не найдена сборка приложения: ${path.join(DIST_DIR, 'index.html')}`);
  }
  staticServer = createStaticServer(DIST_DIR);
  try {
    return await listen(staticServer, PREFERRED_PORT);
  } catch {
    // порт занят — берём любой свободный (настройки браузера для нового адреса будут пустыми)
    staticServer = createStaticServer(DIST_DIR);
    return await listen(staticServer, 0);
  }
}

// ================================================================ БРАУЗЕР
function browserCandidates() {
  const env = process.env;
  const out = [];
  if (IS_WIN) {
    const pf = env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = env['LOCALAPPDATA'] || '';
    out.push(
      { name: 'Google Chrome', path: path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'Google Chrome', path: path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'Google Chrome', path: path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'Microsoft Edge', path: path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { name: 'Microsoft Edge', path: path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe') }
    );
  } else if (process.platform === 'darwin') {
    out.push(
      { name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' }
    );
  } else {
    out.push(
      { name: 'Google Chrome', path: '/usr/bin/google-chrome' },
      { name: 'Chromium', path: '/usr/bin/chromium' },
      { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge' }
    );
  }
  return out;
}

function findBrowser() {
  const custom = readArg('browser') || process.env.ALARA_BROWSER;
  if (custom) {
    if (fs.existsSync(custom)) return { name: 'указанный вручную', path: custom };
    log('Указанный браузер не найден:', custom);
  }
  return browserCandidates().find(c => c.path && fs.existsSync(c.path)) || null;
}

/** Аргументы браузера. Только безопасные и полезные для VR; «тестовых» флагов с жёлтой плашкой нет. */
function buildBrowserArgs(url, profileDir) {
  return [
    `--app=${url}`, // окно приложения без адресной строки
    `--user-data-dir=${profileDir}`, // отдельный профиль: сохраняет разрешения (микрофон, VR) между запусками
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-features=WebXR,OpenXR', // в современных версиях включено по умолчанию, для старых — страховка
    '--webxr-runtime=openxr', // для старых версий Chrome; в новых флаг игнорируется
    '--autoplay-policy=no-user-gesture-required', // звук дозиметра без предварительного клика
    // Окно браузера не в фокусе, когда надет шлем: не даём Chrome «усыплять» таймеры и рендер
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,800',
  ];
}

// ================================================================ VR-РАНТАЙМ (Windows)
function regQuery(key, valueName) {
  if (!IS_WIN) return null;
  try {
    const out = childProcess.execFileSync('reg', ['query', key, '/v', valueName], {
      encoding: 'latin1',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.match(new RegExp(`${valueName}\\s+REG_\\w+\\s+(.+)`));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function isProcessRunning(imageName) {
  if (!IS_WIN) return false;
  try {
    const out = childProcess.execFileSync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/NH'], {
      encoding: 'latin1',
      timeout: 4000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toLowerCase().includes(imageName.toLowerCase());
  } catch {
    return false;
  }
}

/** Папки библиотек Steam из libraryfolders.vdf (там перечислены все диски, где лежат игры). */
function parseLibraryFolders(vdfText) {
  const result = [];
  const re = /"path"\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(vdfText)) !== null) result.push(m[1].replace(/\\\\/g, '\\'));
  return result;
}

function findSteamVrRuntimeJson() {
  if (!IS_WIN) return null;
  const roots = new Set();

  const fromReg = regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath') || regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  if (fromReg) roots.add(path.normalize(fromReg));
  roots.add('C:\\Program Files (x86)\\Steam');
  roots.add('C:\\Program Files\\Steam');

  for (const steamRoot of [...roots]) {
    const vdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    try {
      if (fs.existsSync(vdf)) {
        for (const lib of parseLibraryFolders(fs.readFileSync(vdf, 'utf8'))) roots.add(path.normalize(lib));
      }
    } catch {
      /* пропускаем нечитаемый файл */
    }
  }

  for (const root of roots) {
    const json = path.join(root, 'steamapps', 'common', 'SteamVR', 'steamxr_win64.json');
    try {
      if (fs.existsSync(json)) return json;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Чистая функция выбора VR-рантайма (проверяется тестами).
 *  override:      'auto' | 'steamvr' | 'system'
 *  steamJson:     путь к steamxr_win64.json или null
 *  activeRuntime: путь активного OpenXR-рантайма из реестра Windows или null
 *  steamRunning:  запущен ли SteamVR (vrserver.exe)
 */
function chooseXrRuntime({ override, steamJson, activeRuntime, steamRunning }) {
  const activeIsSteam = Boolean(activeRuntime && /steamxr/i.test(activeRuntime));

  if (override === 'system') return { use: 'system', json: null, reason: 'выбрано вручную: системный рантайм' };
  if (override === 'steamvr') {
    return steamJson
      ? { use: 'steamvr', json: steamJson, reason: 'выбрано вручную: SteamVR' }
      : { use: 'system', json: null, reason: 'SteamVR запрошен вручную, но не найден' };
  }

  if (activeIsSteam) return { use: 'system', json: null, reason: 'SteamVR уже назначен активным OpenXR-рантаймом' };
  if (steamJson && (steamRunning || !activeRuntime)) {
    return {
      use: 'steamvr',
      json: steamJson,
      reason: steamRunning ? 'SteamVR запущен — используем его для VR' : 'в системе не назначен OpenXR-рантайм — используем SteamVR',
    };
  }
  return { use: 'system', json: null, reason: activeRuntime ? 'используется системный OpenXR-рантайм' : 'OpenXR-рантайм не найден' };
}

function resolveXrRuntime() {
  const override = (readArg('xr-runtime') || process.env.ALARA_XR_RUNTIME || 'auto').toLowerCase();
  const steamJson = findSteamVrRuntimeJson();
  const activeRuntime = regQuery('HKLM\\SOFTWARE\\Khronos\\OpenXR\\1', 'ActiveRuntime');
  const steamRunning = isProcessRunning('vrserver.exe') || isProcessRunning('vrmonitor.exe');
  const choice = chooseXrRuntime({ override, steamJson, activeRuntime, steamRunning });
  log('VR-рантайм:', JSON.stringify({ override, steamJson, activeRuntime, steamRunning, choice }));
  return { ...choice, hasAnyRuntime: Boolean(steamJson || activeRuntime) };
}

// ================================================================ ЗАПУСК
let browserProc = null;
let fallbackWindow = null;
let quitting = false;

function openFallbackWindow(url) {
  if (fallbackWindow) return;
  fallbackWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  fallbackWindow.once('ready-to-show', () => fallbackWindow && fallbackWindow.show());
  fallbackWindow.on('closed', () => {
    fallbackWindow = null;
    app.quit();
  });
  fallbackWindow.loadURL(url);
}

function launchBrowser(browser, url, xr) {
  const profileDir = path.join(app.getPath('userData'), 'vr-browser-profile');
  const args = buildBrowserArgs(url, profileDir);
  const env = { ...process.env };
  if (xr && xr.json) env.XR_RUNTIME_JSON = xr.json;

  log('Запуск браузера:', browser.name, browser.path);
  log('Адрес:', url, '| XR_RUNTIME_JSON =', env.XR_RUNTIME_JSON || '(не задан)');

  const startedAt = Date.now();
  browserProc = childProcess.spawn(browser.path, args, { env, stdio: 'ignore', windowsHide: false });

  browserProc.on('error', err => {
    log('Не удалось запустить браузер:', err && err.message);
    browserProc = null;
    dialog.showErrorBox('Не удалось запустить браузер', `${browser.path}\n\n${(err && err.message) || err}`);
    openFallbackWindow(url);
  });

  browserProc.on('exit', async (code, signal) => {
    log('Браузер завершился: code =', code, 'signal =', signal);
    browserProc = null;
    if (quitting) return;
    // Мгновенный выход обычно значит, что окно уже открыто другим процессом с тем же профилем
    if (Date.now() - startedAt < 4000) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Окно тренажёра',
        message: 'Браузер завершился сразу после запуска.',
        detail: 'Возможно, окно тренажёра уже открыто. Закройте все окна «РХБЗ VR Тренажёр» и запустите приложение снова.',
      });
    }
    app.quit();
  });
}

async function showNoRuntimeDialog() {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'VR-рантайм не найден',
    message: 'Не найден SteamVR или другой OpenXR-рантайм.',
    detail:
      'Для шлема HTC Vive установите Steam и SteamVR (бесплатно). После установки запустите приложение снова — ' +
      'никаких настроек в браузере не требуется.\n\nМожно продолжить без VR: приложение откроется в обычном режиме на мониторе.',
    buttons: ['Открыть страницу SteamVR', 'Продолжить без VR', 'Выход'],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 0) {
    shell.openExternal(STEAMVR_STORE_URL);
    return 'exit';
  }
  return response === 1 ? 'continue' : 'exit';
}

async function start() {
  log('=== Запуск', app.getName(), app.getVersion(), '| Electron', process.versions.electron, '|', process.platform, os.release(), '===');

  let url;
  if (IS_DEV) {
    url = DEV_URL;
  } else {
    try {
      const port = await startStaticServer();
      url = `http://localhost:${port}/`;
    } catch (err) {
      log('Сервер не запустился:', err && err.message);
      dialog.showErrorBox('Не удалось запустить приложение', String((err && err.message) || err));
      app.quit();
      return;
    }
  }
  log('Адрес приложения:', url);

  if (FORCE_EMBEDDED) {
    openFallbackWindow(url);
    return;
  }

  const browser = findBrowser();
  if (!browser) {
    log('Chrome/Edge не найдены');
    await dialog.showMessageBox({
      type: 'warning',
      title: 'VR недоступен',
      message: 'Не найден Google Chrome или Microsoft Edge.',
      detail:
        'Режим VR работает только в Chrome или Edge (встроенный Chromium приложения WebXR не поддерживает). ' +
        'Установите браузер и запустите приложение снова. Сейчас откроется обычный режим на мониторе.',
    });
    openFallbackWindow(url);
    return;
  }

  let xr = { use: 'system', json: null, hasAnyRuntime: true };
  if (IS_WIN) {
    xr = resolveXrRuntime();
    if (!xr.hasAnyRuntime) {
      const choice = await showNoRuntimeDialog();
      if (choice === 'exit') {
        app.quit();
        return;
      }
    }
  }

  launchBrowser(browser, url, xr);
}

// ================================================================ ЖИЗНЕННЫЙ ЦИКЛ
function cleanup() {
  quitting = true;
  try {
    if (staticServer) staticServer.close();
  } catch {
    /* ignore */
  }
  try {
    if (browserProc && !browserProc.killed) browserProc.kill();
  } catch {
    /* ignore */
  }
}

if (IS_WIN) app.setAppUserModelId('com.rhbz.vr.simulator');
app.commandLine.appendSwitch('ignore-gpu-blocklist'); // относится только к запасному окну Electron

if (!app.requestSingleInstanceLock()) {
  // Копия уже запущена: вторую не открываем (иначе два сервера и конфликт профиля браузера)
  app.quit();
} else {
  app.on('second-instance', () => log('Повторный запуск проигнорирован: приложение уже работает'));
  app.whenReady().then(start).catch(err => {
    log('Критическая ошибка запуска:', err && err.stack);
    dialog.showErrorBox('Критическая ошибка', String((err && err.message) || err));
    app.quit();
  });
  app.on('window-all-closed', () => {
    if (!browserProc) app.quit();
  });
  app.on('before-quit', cleanup);
  app.on('will-quit', cleanup);
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

// Для автоматических тестов (в обычной работе не используется)
if (process.env.ALARA_TEST === '1') {
  module.exports = { chooseXrRuntime, parseLibraryFolders, buildBrowserArgs, createStaticServer, browserCandidates, findBrowser };
}
