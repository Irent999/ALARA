# Сборка и упаковка ALARA-Planner Pro VR

Проект полностью автономен (без внешних CDN, все шрифты и библиотеки упаковываются локально) и готов к запуску на **ПК (Desktop)**, в VR-гарнитуре **HTC Vive (WebXR)** и в виде **установочного пакета Electron**.

## 1. Подготовка модели Сценария №4 (`assembly.glb`)

Перед сборкой установочного или веб-пакета поместите 3D-модель площадки АЭС:

```text
public/assembly.glb
```

При запуске в **Electron** модель также автоматически ищется рядом с исполняемым файлом (`ALARA-Planner Pro VR.exe`), в папке `resources/` или может быть загружена вручную через кнопку выбора файла на экране Сценария 4.

---

## 2. Проверка типов и релизная веб-сборка

```bash
npm install
npm run typecheck
npm run build:release
```

Готовый статический пакет формируется в папке `dist/` с относительными путями (`base: './'`).

---

## 3. Локальный HTTPS-сервер для HTC Vive (WebXR)

WebXR API в браузере (Chrome / Edge + SteamVR / OpenXR для HTC Vive) требует защищённый контекст (`https://` или `localhost`). В `vite.config.ts` подключён `@vitejs/plugin-basic-ssl`:

```bash
npm run preview
```

Сервер откроется на порту `3000` (`https://localhost:3000` или `https://<IP-ПК>:3000`).  
Если гарнитура HTC Vive подключена к ПК с SteamVR (OpenXR Runtime установлен как SteamVR), нажмите **«ВОЙТИ В VR (HTC VIVE)»** в правом нижнем углу экрана. При отсутствии шлема тренажёр работает в штатном Desktop-режиме.

---

## 4. Сборка установочного пакета (Electron)

В `main.cjs` настроена защищённая схема `app://alara/` (без ограничений `file://` для `fetch('./assembly.glb')` и WebAssembly Draco) и флаги WebXR/OpenXR.

```bash
npm run electron:build
```

Готовые установщики появятся в каталоге `release/`:
- **Windows**: `NSIS` инсталлятор (`.exe`) и `portable` версия
- **Linux**: `.AppImage`
- **macOS**: `.dmg`
