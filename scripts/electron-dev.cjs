const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const USE_HTTPS = process.env.HTTPS !== 'false';
const DEV_URL = `${USE_HTTPS ? 'https' : 'http'}://localhost:${PORT}`;

function probeServer(url) {
  return new Promise(resolve => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(
      url,
      {
        rejectUnauthorized: false,
        timeout: 1500
      },
      res => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForVite(url, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await probeServer(url)) return true;
    await new Promise(r => setTimeout(r, 350));
  }
  return false;
}

function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    // Игнорируем уже завершённый процесс
  }
}

async function main() {
  const viteBin = path.join(
    ROOT_DIR,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vite.cmd' : 'vite'
  );

  const viteEnv = {
    ...process.env,
    HTTPS: USE_HTTPS ? 'true' : 'false'
  };

  console.log(`[ALARA Electron Dev] Запуск Vite dev-сервера (${DEV_URL})...`);
  const viteProc = spawn(viteBin, ['--port', String(PORT), '--host', '0.0.0.0'], {
    cwd: ROOT_DIR,
    env: viteEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  let electronProc = null;
  const shutdown = exitCode => {
    killProcessTree(electronProc);
    killProcessTree(viteProc);
    process.exit(exitCode);
  };

  viteProc.on('exit', code => {
    if (!electronProc) {
      console.error(`[ALARA Electron Dev] Vite завершился до старта Electron (код ${code}).`);
      process.exit(code || 1);
    }
  });

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  const ready = await waitForVite(DEV_URL);
  if (!ready) {
    console.error(`[ALARA Electron Dev] Не дождались ответа от ${DEV_URL} за 45 с.`);
    shutdown(1);
    return;
  }

  const electronBin = require('electron');
  console.log(`[ALARA Electron Dev] Запуск Electron -> ${DEV_URL}`);
  electronProc = spawn(electronBin, ['.'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: DEV_URL
    },
    stdio: 'inherit'
  });

  electronProc.on('exit', code => {
    killProcessTree(viteProc);
    process.exit(code ?? 0);
  });
}

main().catch(err => {
  console.error('[ALARA Electron Dev] Ошибка запуска:', err);
  process.exit(1);
});
