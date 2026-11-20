# Графика и предметы: куда класть и как настраивать

## 1. Куда положить файлы

| Файл | Куда |
|---|---|
| `src/render/qualityRenderer.ts`, `src/render/postFx.ts` | новая папка `render/` рядом с `scene/`, `vr/` |
| `src/props/propTypes.ts`, `propManager.ts`, `propInteraction.ts` | новая папка `props/` |
| `public/layouts/catalog.json`, `layout.json` | папка `public/layouts/` в корне проекта (создайте) |
| `src/App.tsx`, `src/scene/webxrManager.ts`, `electron/main.cjs` | заменить существующие |

Модели предметов (`.glb`) кладите в `public/models/` и указывайте в `catalog.json` как `"model": "./models/имя.glb"`.

## 2. Чем «настроить картинку»

- **Пресет качества:** в `App.tsx` ищите `configureQualityRenderer(renderer, 'high', …)` и `new PostFX(…, { preset: 'high' })`. Значения: `low | medium | high | ultra`. На слабой машине начните с `medium`.
- **AO (тени в углах):** `aoRadius` в `PostFXOptions` (метры, 0.2–0.6).
- **Свечение бликов:** `bloomStrength` (0.15–0.4) и `bloomThreshold` (0.85–1.0; чем выше, тем меньше светится).
- **Окружение / отражения:** вызовите один раз после создания рендерера и сцены
  `await setupEnvironment(renderer, scene, { hdriUrl: './hdri/room.hdr', intensity: 1.0 })`
  (без `hdriUrl` берётся встроенная студийная комната). Сейчас окружение ставит ваш
  `configurePhotorealisticRendererAndHDRI`; мой вызов его перезапишет.
- **Тени от солнца:** `configureSun(mainDirLightRef.current, { bounds: new THREE.Box3(...), mapSize: 4096 })`
  с границами комнаты. Для статичных комнат добавьте `bakeStaticShadows(renderer)`.
- **Материалы:** `MaterialPresets.stainlessRailing()`, `.matteWall()`, `.varnishedWood()` и т.д.;
  текстуры: `createPBRMaterial(renderer, { albedo, normal, orm, … })`.
- **Уже загруженная модель комнаты:** `upgradeSceneMaterials(roomRoot, renderer)`.

## 3. Что делает картинку «как на скриншоте» (это ассеты, а не код)

1. **Запечённое освещение.** Мягкие тени и свет, отражённый от стен, на скриншоте — это лайтмапы.
   В Blender: Cycles → Bake (Diffuse, только Direct+Indirect) на второй UV-канал →
   сохранить PNG/EXR → в `createPBRMaterial` передать `lightmap` и `bakedUvChannel: 1`.
2. **Текстуры PBR** (albedo, normal, ORM) нормального разрешения (2K–4K) для пола, стен, мебели.
3. **Моделирование деталей:** фаски на перилах, плинтусы, розетки, трубы.
4. **HDRI** помещения или улицы за окнами (Poly Haven, CC0), чтобы металл отражал правдоподобное окружение.

## 4. Ограничения

- **В VR постобработка отключена** (WebXR несовместим с EffectComposer). В шлеме работают:
  MSAA, окружение, тени, aoMap/lightMap, ACES. GTAO и Bloom — только на мониторе.
- **VR запускается в Chrome/Edge, не в окне Electron** (см. `main.cjs`), поэтому флаги GPU
  передаются и туда, и в Electron.
- В three r186 `PCFShadowMap` удалён — используется `PCFShadowMap` (мягкость: `light.shadow.radius`).
- WebGPU не используется: `WebGLRenderer` и `WebGPURenderer` — разные пути рендера,
  а поддержка WebXR на WebGPU пока ограничена.

## 5. Как добавить предмет

1. Допишите запись в `public/layouts/catalog.json` (`id`, `name`, `description`, `primitive` или `model`).
2. Допишите размещение в `public/layouts/layout.json` в нужную комнату
   (`position` в метрах, `rotation` в градусах).
3. Перезапустите `npm run dev` или обновите страницу. Пересобирать код не нужно
   (в уже собранном `.exe` файлы лежат в `dist/layouts/`).

Имя комнаты в `layout.json` = `scenario_<id сценария>` (`scenario_1`, `scenario_2`, …).

## 6. Управление предметами

- Десктоп: навести курсор → контур и подсказка; клик или **G** → осмотр
  (мышь крутит, колесо приближает); **G/Esc** → вернуть.
- VR: навести луч → контур и карточка; курок → предмет в руке; курок ещё раз → вернуть.

---

# 7. Как получить «живую» комнату, как на скриншоте-образце

Код выше показывает комнату красиво, но **наполняет её ассетами**. Комнаты, собранные кодом из простых
форм, не станут реалистичными никакими настройками света. Нужна настоящая 3D-модель помещения.

## Три пути (от самого «реального» к самому дешёвому)

| Путь | Подходит, если | Результат | Трудоёмкость* |
|---|---|---|---|
| **A. Скан реального помещения** (фотограмметрия / LiDAR) | помещение реальное и в него можно попасть | «картина передаёт реальную комнату» | 1–3 дня на комнату + чистка |
| **B. Моделирование в Blender + запекание света** | помещения вымышленные или недоступны | полный контроль, лучший результат в VR | 1–3 недели на комнату у опытного 3D-художника |
| **C. Готовые ассеты + сборка** (Poly Haven, ambientCG, Sketchfab, Fab/Megascans) | нужен быстрый старт | хороший «фон», специфичное оборудование придётся делать отдельно | дни |

\*Оценки ориентировочные, зависят от размера комнаты и опыта.

### A. Скан
- Инструменты: RealityScan (бесплатный), Polycam, Kiri Engine, Luma; для больших залов — Matterport / лазерный скан.
- **Блестящий металл (перила, хром) сканируется плохо** — блики ломают реконструкцию. Такие элементы
  обычно моделируют заново поверх скана (перила — это простые трубы).
- Скан → Blender: убрать мусор, упростить сетку (retopo / Decimate), развернуть UV, запечь освещение.

### B. Blender
1. Модель помещения + детали (плинтусы, трубы, кабели, плафоны, розетки, таблички).
2. Материалы PBR: albedo + normal + ORM (текстуры 2K–4K).
3. **Запекание:** Cycles → Bake → Diffuse (Direct + Indirect, без Color) на **второй UV-канал**
   → лайтмапа 2K–4K на каждый крупный блок. Это и даёт мягкие тени и «отражённый» свет.
4. Экспорт glTF (GLB).

### C. Ассеты
- Poly Haven (CC0): HDRI, текстуры, часть моделей. ambientCG (CC0): текстуры. Проверяйте лицензию каждого файла.
- Предметы специфичного оборудования (дозиметры ДКС, приборы РХБЗ) — моделировать самим или через
  image-to-3D (Meshy, Tripo, Hunyuan3D, Rodin) с обязательной ручной чисткой: для мелких предметов
  результат обычно приемлемый, для архитектуры — нет.

## Что делает комнату «живой» (чек-лист на каждый сценарий)

- Информационные плакаты, таблицы, схемы эвакуации, знаки радиационной опасности (текстуры-«декали»).
- Разметка на полу, истёртые места у дверей, пятна и потёртости (карта roughness с вариациями).
- Кабели, короба, трубы, вентиляция, лампы с emissive-материалом.
- Мебель и мелочи «с историей»: приоткрытая папка, кружка, каска на крючке, шкафы, огнетушители.
- Мелкие предметы — через `catalog.json`/`layout.json` (дозиметры, папки, инструменты).
- Лёгкая пыль в лучах света (частицы), небольшая виньетка и зерно (в десктопном режиме).

## Бюджет для VR (ориентир, подберите под свою видеокарту)

- Треугольники: до ~1 млн на сцену; на мониторе можно заметно больше.
- Draw-call'ы: до нескольких сотен — склеивайте статичные меши с одним материалом.
- Текстуры: 2K, для крупных поверхностей 4K; формат **KTX2** (остаётся сжатым в видеопамяти).
- Геометрия: сжатие Meshopt/Draco. Оптимизация одной командой (проверьте флаги: `gltf-transform optimize --help`):
  `npx @gltf-transform/cli optimize room.glb room.opt.glb --compress meshopt --texture-compress ktx2`
  (для KTX2 нужен установленный KTX-Software / `toktx`; без него используйте `--texture-compress webp`).

## Декодеры для сжатых моделей (один раз)

В PowerShell, из корня проекта:

```powershell
mkdir public\draco -Force
mkdir public\basis -Force
copy node_modules\three\examples\jsm\libs\draco\gltf\* public\draco\
copy node_modules\three\examples\jsm\libs\basis\* public\basis\
```

## Подключение комнаты в код

```ts
import { createGLTFLoader } from './render/assetLoaders';
import { loadRoomModel } from './render/roomLoader';
import { configureSun } from './render/qualityRenderer';

const gltfLoader = createGLTFLoader(renderer);
const room = await loadRoomModel(renderer, gltfLoader, {
  url: './models/scenario_1_room.glb',
  parent: scene,
});
configureSun(mainDirLightRef.current!, { bounds: room.bounds, mapSize: 4096 });
```

Имя файла: `public/models/scenario_<id>_room.glb`. В консоли браузера появится строка со статистикой
комнаты (мешей, треугольников, текстур), по ней видно, укладываетесь ли вы в бюджет.
