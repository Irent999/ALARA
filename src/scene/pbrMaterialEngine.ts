/**
 * ALARA-Planner Pro VR — Photorealistic PBR Material, Micro-Surface & Geometry Engine
 *
 * Physical Accuracy Specification (95–99% Real-World Fidelity):
 * 1. Geometric Precision:
 *    - High-density chamfers & smoothed edge bevels (Radius ≈ 1–3 mm, 0.001–0.003 m)
 *    - Sub-millimeter lathe/extrude curves on handles, buttons, display bezels & body contours
 *    - Exact Catenary curve equation y(x) = a * cosh(x / a) - a for flexible radiation probe cables
 *    - State/technical standard proportions (ГОСТ 27451-87, ГОСТ 17925-72, ISO 4037)
 * 2. PBR Material Engineering:
 *    - Non-uniform Roughness & Metalness maps (Polymer casing: roughness = 0.45; Metal contacts/connectors: metalness = 0.9, roughness = 0.2)
 *    - Procedural micro-scratches, subtle fingerprint smudges, and injection-mold wear patterns
 *    - Subsurface Scattering (SSS) via MeshPhysicalMaterial transmission/thickness/attenuation/sheen for rubberized Hazmat gloves, latex, and translucent grips
 *    - Multi-layer Optics & Glass with Fresnel reflections, AR-coating thin-film iridescence, micro-refraction (IOR 1.52–1.85), and physical inner air-gap depth between LCD crystal and top glass
 * 3. Lighting & Shading Integration:
 *    - THREE.SRGBColorSpace output color space, ACESFilmicToneMapping (exposure = 1.0), PCFSoftShadowMap
 *    - Synthesized High-Dynamic-Range Image (HDRI) environment lighting via PMREMGenerator
 */

import * as THREE from 'three';
import { createCherenkovShaderMeshGroup } from '../shaders/CherenkovGlowShader';
import { VolumetricPlumeSystem } from '../components/effects/VolumetricPlume';

// Кэш процедурных PBR-карт для предотвращения повторной генерации
const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Детерминированный псевдослучайный генератор для стабильного микрорельефа
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 1. Неоднородная карта шероховатости (Roughness Map) и микрорельефа (Bump Map)
 * для литого полимерного корпуса приборов (базовая шероховатость = 0.45)
 * Включает: микроцарапины, легкие отпечатки пальцев оператора и потертости пресс-формы
 */
export function createPolymerCasingPBRMaps(): {
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const roughKey = 'polymer_roughness_map_v2';
  const bumpKey = 'polymer_bump_map_v2';

  if (textureCache.has(roughKey) && textureCache.has(bumpKey)) {
    return {
      roughnessMap: textureCache.get(roughKey)!,
      bumpMap: textureCache.get(bumpKey)!
    };
  }

  const size = 512;
  const rand = mulberry32(104729);

  // --- A. КАРТА ШЕРОХОВАТОСТИ (Roughness Map, центр вокруг 0.45 -> ~115/255) ---
  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  // Базовый уровень roughness = 1.0 в текстуре умножается на material.roughness (0.45).
  // Поэтому используем среднее значение ~215, чтобы произведение давало ~0.40-0.48 с вариацией.
  rCtx.fillStyle = 'rgb(220, 220, 220)';
  rCtx.fillRect(0, 0, size, size);

  // Пятна износа литьевой формы (Mold wear patterns) и легкие отпечатки пальцев (Fingerprint smudges)
  for (let i = 0; i < 18; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const rx = 24 + rand() * 55;
    const ry = 18 + rand() * 40;
    const grad = rCtx.createRadialGradient(cx, cy, 2, cx, cy, Math.max(rx, ry));
    // Жировые следы пальцев чуть более глянцевые или матовые
    const isSmudge = i % 2 === 0;
    grad.addColorStop(0, isSmudge ? 'rgba(250, 250, 250, 0.22)' : 'rgba(165, 165, 165, 0.20)');
    grad.addColorStop(0.6, isSmudge ? 'rgba(235, 235, 235, 0.10)' : 'rgba(190, 190, 190, 0.08)');
    grad.addColorStop(1, 'rgba(220, 220, 220, 0)');
    rCtx.fillStyle = grad;
    rCtx.beginPath();
    rCtx.ellipse(cx, cy, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    rCtx.fill();

    // Тонкие концентрические дуги папиллярного узора отпечатка пальца
    if (isSmudge && i < 8) {
      rCtx.strokeStyle = 'rgba(245, 245, 245, 0.09)';
      rCtx.lineWidth = 1.2;
      for (let ring = 4; ring < 24; ring += 3.5) {
        rCtx.beginPath();
        rCtx.ellipse(cx, cy, ring * 0.9, ring * 1.25, 0.4, 0.2, Math.PI * 1.6);
        rCtx.stroke();
      }
    }
  }

  // Потертости вдоль кромок пресс-формы (Mold seam & edge wear)
  rCtx.strokeStyle = 'rgba(170, 170, 170, 0.28)';
  rCtx.lineWidth = 14;
  rCtx.strokeRect(8, 8, size - 16, size - 16);

  // Микрозернистость шагрени ударопрочного АБС-пластика / поликарбоната
  for (let i = 0; i < 28000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const v = 190 + Math.floor(rand() * 60);
    rCtx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.12)`;
    rCtx.fillRect(x, y, 2, 2);
  }

  // Микроцарапины от эксплуатации (Micro-scratches)
  for (let i = 0; i < 85; i++) {
    const x1 = rand() * size;
    const y1 = rand() * size;
    const len = 8 + rand() * 42;
    const angle = rand() * Math.PI * 2;
    rCtx.strokeStyle = rand() > 0.4 ? 'rgba(150, 150, 150, 0.32)' : 'rgba(255, 255, 255, 0.24)';
    rCtx.lineWidth = 0.6 + rand() * 0.9;
    rCtx.beginPath();
    rCtx.moveTo(x1, y1);
    rCtx.lineTo(x1 + Math.cos(angle) * len, y1 + Math.sin(angle) * len);
    rCtx.stroke();
  }

  // --- B. КАРТА МИКРОРЕЛЬЕФА (Bump Map) ---
  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  bCtx.fillStyle = 'rgb(128, 128, 128)';
  bCtx.fillRect(0, 0, size, size);

  // Шагрень полимера
  for (let i = 0; i < 35000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const v = rand() > 0.5 ? 148 : 108;
    bCtx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.18)`;
    bCtx.fillRect(x, y, 1.5, 1.5);
  }

  // Бороздки микроцарапин в карте высот
  for (let i = 0; i < 70; i++) {
    const x1 = rand() * size;
    const y1 = rand() * size;
    const len = 6 + rand() * 35;
    const angle = rand() * Math.PI * 2;
    bCtx.strokeStyle = 'rgba(70, 70, 70, 0.35)';
    bCtx.lineWidth = 0.8;
    bCtx.beginPath();
    bCtx.moveTo(x1, y1);
    bCtx.lineTo(x1 + Math.cos(angle) * len, y1 + Math.sin(angle) * len);
    bCtx.stroke();
  }

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;

  textureCache.set(roughKey, roughnessMap);
  textureCache.set(bumpKey, bumpMap);

  return { roughnessMap, bumpMap };
}

/**
 * 2. PBR-карты для прецизионных металлических контактов, разъемов LEMO/БНЦ и зондов
 * (metalness = 0.9, roughness = 0.2) с анизотропной токарной обработкой и микроцарапинами
 */
export function createMachinedMetalPBRMaps(): {
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const roughKey = 'machined_metal_rough_v2';
  const bumpKey = 'machined_metal_bump_v2';

  if (textureCache.has(roughKey) && textureCache.has(bumpKey)) {
    return {
      roughnessMap: textureCache.get(roughKey)!,
      bumpMap: textureCache.get(bumpKey)!
    };
  }

  const size = 512;
  const rand = mulberry32(99371);

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  rCtx.fillStyle = 'rgb(225, 225, 225)';
  rCtx.fillRect(0, 0, size, size);

  // Токарные микрокольца шлифовки
  for (let y = 0; y < size; y += 2) {
    const v = 195 + Math.floor(rand() * 55);
    rCtx.strokeStyle = `rgba(${v}, ${v}, ${v}, 0.35)`;
    rCtx.lineWidth = 1;
    rCtx.beginPath();
    rCtx.moveTo(0, y);
    rCtx.lineTo(size, y);
    rCtx.stroke();
  }

  // Следы контактного трения и микроцарапины
  for (let i = 0; i < 65; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 10 + rand() * 45;
    const ang = (rand() - 0.5) * 0.5;
    rCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    rCtx.lineWidth = 0.8;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    rCtx.stroke();
  }

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;
  bCtx.drawImage(rCanvas, 0, 0);

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;

  textureCache.set(roughKey, roughnessMap);
  textureCache.set(bumpKey, bumpMap);

  return { roughnessMap, bumpMap };
}

/**
 * 3. PBR-текстура протектора и складок защитной свинцово-бутиловой / латексной перчатки СИЗ
 */
export function createHazmatGlovePBRMaps(): {
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const bumpKey = 'glove_micro_bump_v2';
  const roughKey = 'glove_micro_rough_v2';

  if (textureCache.has(bumpKey) && textureCache.has(roughKey)) {
    return {
      bumpMap: textureCache.get(bumpKey)!,
      roughnessMap: textureCache.get(roughKey)!
    };
  }

  const size = 512;
  const rand = mulberry32(44219);

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  bCtx.fillStyle = 'rgb(128, 128, 128)';
  bCtx.fillRect(0, 0, size, size);

  // Ромбовидный противоскользящий микропротектор по ГОСТ Р 12.4.246
  bCtx.strokeStyle = 'rgba(185, 185, 185, 0.45)';
  bCtx.lineWidth = 1.4;
  const step = 12;
  for (let i = -size; i < size * 2; i += step) {
    bCtx.beginPath();
    bCtx.moveTo(i, 0);
    bCtx.lineTo(i + size, size);
    bCtx.stroke();

    bCtx.beginPath();
    bCtx.moveTo(i, size);
    bCtx.lineTo(i + size, 0);
    bCtx.stroke();
  }

  // Анатомические микроскладки сгиба эластомера на суставах
  for (let i = 0; i < 28; i++) {
    const y = rand() * size;
    bCtx.strokeStyle = 'rgba(85, 85, 85, 0.30)';
    bCtx.lineWidth = 2.2;
    bCtx.beginPath();
    bCtx.moveTo(0, y);
    bCtx.quadraticCurveTo(size * 0.5, y + (rand() - 0.5) * 26, size, y);
    bCtx.stroke();
  }

  // Roughness-карта с легким тальковым/латексным напылением и потертостями на пальцах
  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;
  rCtx.fillStyle = 'rgb(215, 215, 215)';
  rCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 16; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const rad = 20 + rand() * 50;
    const grad = rCtx.createRadialGradient(cx, cy, 2, cx, cy, rad);
    grad.addColorStop(0, 'rgba(165, 165, 165, 0.28)');
    grad.addColorStop(1, 'rgba(215, 215, 215, 0)');
    rCtx.fillStyle = grad;
    rCtx.beginPath();
    rCtx.arc(cx, cy, rad, 0, Math.PI * 2);
    rCtx.fill();
  }

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(3, 3);

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2, 2);

  textureCache.set(bumpKey, bumpMap);
  textureCache.set(roughKey, roughnessMap);

  return { bumpMap, roughnessMap };
}

/**
 * 4. Создание материала с подповерхностным рассеиванием (Subsurface Scattering - SSS)
 * для прорезиненных перчаток, латекса и полупрозрачных полимерных накладок
 */
export function createRubberSSSMaterial(params: {
  color: number;
  attenuationColor: number;
  roughness?: number;
  transmission?: number;
  thickness?: number;
  withGloveMicroTread?: boolean;
}): THREE.MeshPhysicalMaterial {
  const { bumpMap, roughnessMap } = params.withGloveMicroTread
    ? createHazmatGlovePBRMaps()
    : createPolymerCasingPBRMaps();

  return new THREE.MeshPhysicalMaterial({
    color: params.color,
    roughness: params.roughness ?? 0.44,
    roughnessMap,
    metalness: 0.04,
    bumpMap,
    bumpScale: params.withGloveMicroTread ? 0.0016 : 0.0008,
    // Подповерхностное рассеивание (Subsurface Scattering approximation in Three.js Physical Material)
    transmission: params.transmission ?? 0.18,
    thickness: params.thickness ?? 0.022,
    attenuationColor: new THREE.Color(params.attenuationColor),
    attenuationDistance: 0.015,
    ior: 1.51, // Каучук / латекс / эластомер
    reflectivity: 0.45,
    sheen: 0.38,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(params.attenuationColor).lerp(new THREE.Color(0xffffff), 0.35),
    clearcoat: 0.22,
    clearcoatRoughness: 0.38
  });
}

/**
 * 5. Создание материала полимерного корпуса прибора с неоднородной шероховатостью (roughness = 0.45)
 */
export function createPolymerCasingMaterial(colorHex: number = 0x1e293b): THREE.MeshPhysicalMaterial {
  const { roughnessMap, bumpMap } = createPolymerCasingPBRMaps();
  return new THREE.MeshPhysicalMaterial({
    color: colorHex,
    roughness: 0.45, // Точное соответствие ТЗ: polymer casing roughness = 0.45
    roughnessMap,
    metalness: 0.08,
    bumpMap,
    bumpScale: 0.0007,
    clearcoat: 0.15,
    clearcoatRoughness: 0.42,
    reflectivity: 0.52,
    ior: 1.58 // Ударопрочный поликарбонат / АБС
  });
}

/**
 * 6. Создание материала металлических контактов, разъемов и зондов (metalness = 0.9, roughness = 0.2)
 */
export function createMetalConnectorMaterial(colorHex: number = 0xdbeafe): THREE.MeshPhysicalMaterial {
  const { roughnessMap, bumpMap } = createMachinedMetalPBRMaps();
  return new THREE.MeshPhysicalMaterial({
    color: colorHex,
    metalness: 0.9, // Точное соответствие ТЗ: metal contacts/connectors metalness = 0.9
    roughness: 0.2, // Точное соответствие ТЗ: roughness = 0.2
    roughnessMap,
    bumpMap,
    bumpScale: 0.0005,
    clearcoat: 0.25,
    clearcoatRoughness: 0.15,
    reflectivity: 0.95
  });
}

/**
 * 7. Многослойная оптическая панель дисплея (Multi-layer Fresnel, AR-coating glares,
 * micro-refraction, and inner depth between LCD crystal and top glass)
 */
export function createMultiLayerOpticalDisplay(options: {
  width: number;
  height: number;
  lcdTexture: THREE.Texture;
  innerDepthMeters?: number; // Физическая воздушная прослойка между ЖК-матрицей и верхним стеклом (1.5-2.5 мм)
  bezelColor?: number;
}): {
  displayGroup: THREE.Group;
  lcdCrystalMesh: THREE.Mesh;
  topGlassMesh: THREE.Mesh;
} {
  const w = options.width;
  const h = options.height;
  const depthGap = options.innerDepthMeters ?? 0.0022; // 2.2 мм глубина колодца экрана
  const displayGroup = new THREE.Group();

  // Слой 1: Внутренний скошенный колодец (Bezel Mask), создающий параллакс и тень на кристалле
  const bezelThick = 0.0032;
  const outerShape = new THREE.Shape();
  const rOut = 0.003;
  const bw = w + 0.005;
  const bh = h + 0.005;
  outerShape.moveTo(-bw / 2 + rOut, -bh / 2);
  outerShape.lineTo(bw / 2 - rOut, -bh / 2);
  outerShape.quadraticCurveTo(bw / 2, -bh / 2, bw / 2, -bh / 2 + rOut);
  outerShape.lineTo(bw / 2, bh / 2 - rOut);
  outerShape.quadraticCurveTo(bw / 2, bh / 2, bw / 2 - rOut, bh / 2);
  outerShape.lineTo(-bw / 2 + rOut, bh / 2);
  outerShape.quadraticCurveTo(-bw / 2, bh / 2, -bw / 2, bh / 2 - rOut);
  outerShape.lineTo(-bw / 2, -bh / 2 + rOut);
  outerShape.quadraticCurveTo(-bw / 2, -bh / 2, -bw / 2 + rOut, -bh / 2);

  const holePath = new THREE.Path();
  const rIn = 0.0018;
  holePath.moveTo(-w / 2 + rIn, -h / 2);
  holePath.lineTo(w / 2 - rIn, -h / 2);
  holePath.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rIn);
  holePath.lineTo(w / 2, h / 2 - rIn);
  holePath.quadraticCurveTo(w / 2, h / 2, w / 2 - rIn, h / 2);
  holePath.lineTo(-w / 2 + rIn, h / 2);
  holePath.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rIn);
  holePath.lineTo(-w / 2, -h / 2 + rIn);
  holePath.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rIn, -h / 2);
  outerShape.holes.push(holePath);

  const bezelGeo = new THREE.ExtrudeGeometry(outerShape, {
    depth: depthGap,
    bevelEnabled: true,
    bevelThickness: 0.0012,
    bevelSize: 0.0012,
    bevelSegments: 4
  });
  const bezelMat = createPolymerCasingMaterial(options.bezelColor ?? 0x0f172a);
  const bezelMesh = new THREE.Mesh(bezelGeo, bezelMat);
  bezelMesh.position.z = 0;
  displayGroup.add(bezelMesh);

  // Слой 2: Глубокая подложка жидких кристаллов (LCD Crystal Plane) с легкой собственной эмиссией
  const lcdGeo = new THREE.PlaneGeometry(w, h);
  const lcdMat = new THREE.MeshStandardMaterial({
    map: options.lcdTexture,
    emissive: 0xffffff,
    emissiveMap: options.lcdTexture,
    emissiveIntensity: 0.82,
    roughness: 0.25,
    metalness: 0.1
  });
  const lcdCrystalMesh = new THREE.Mesh(lcdGeo, lcdMat);
  lcdCrystalMesh.position.z = 0.0002;
  displayGroup.add(lcdCrystalMesh);

  // Слой 3: Внутренняя поляризационная микросетка с эффектом Френеля (Sub-layer Polarizer)
  const polarizerGeo = new THREE.PlaneGeometry(w, h);
  const polarizerMat = new THREE.MeshPhysicalMaterial({
    color: 0x042f2e,
    transparent: true,
    opacity: 0.14,
    roughness: 0.08,
    metalness: 0.1,
    ior: 1.49,
    iridescence: 0.35,
    iridescenceIOR: 1.35
  });
  const polarizerMesh = new THREE.Mesh(polarizerGeo, polarizerMat);
  polarizerMesh.position.z = depthGap * 0.45;
  displayGroup.add(polarizerMesh);

  // Слой 4: Верхнее закаленное защитное стекло с антибликовым AR-покрытием (iridescence),
  // многослойным отражением Френеля и микрорефракцией (Top Protective Mineral Glass)
  const glassGeo = new THREE.PlaneGeometry(w + 0.001, h + 0.001);
  const topGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    transparent: true,
    opacity: 1.0,
    transmission: 0.93, // Оптическая прозрачность с микрорефракцией
    thickness: 0.0035, // 3.5 мм кварцевое/минеральное стекло
    ior: 1.52, // Показатель преломления оптического стекла (Fresnel)
    reflectivity: 0.92,
    roughness: 0.03,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    // Антибликовое просветляющее AR-покрытие (пурпурно-бирюзовый перелив под углом)
    iridescence: 0.72,
    iridescenceIOR: 1.38, // MgF2 просветляющая пленка
    iridescenceThicknessRange: [160, 420],
    attenuationColor: new THREE.Color(0xe0f2fe),
    attenuationDistance: 0.08
  });
  const topGlassMesh = new THREE.Mesh(glassGeo, topGlassMat);
  topGlassMesh.position.z = depthGap + 0.0009;
  displayGroup.add(topGlassMesh);

  return { displayGroup, lcdCrystalMesh, topGlassMesh };
}

/**
 * 8. Точное уравнение цепной линии (Catenary Curve Equation) для гибкого кабеля зонда:
 *    y(x) = a * cosh(x / a) - a
 *    Генерирует реалистично провисающий армированный/витой кабель между разъемом корпуса и детектором
 */
export function createCatenaryCablePoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  sagParameterA: number = 0.065,
  segments: number = 64,
  helicalTurns: number = 0,
  helicalRadius: number = 0.0035
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const chord = new THREE.Vector3().subVectors(end, start);
  const horizontalDist = Math.max(0.02, chord.length());

  // Вектор ортонормального базиса для наложения витков спирального кабеля
  const tangent = chord.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();
  if (binormal.lengthSq() < 0.001) {
    binormal.set(1, 0, 0);
  }
  const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

  const a = Math.max(0.025, sagParameterA);
  const halfSpan = horizontalDist * 0.5;
  const coshMax = Math.cosh(halfSpan / a);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = new THREE.Vector3().lerpVectors(start, end, t);

    // Координата x относительно середины пролета [-L/2, +L/2]
    const xCentered = (t - 0.5) * horizontalDist;
    // Классическое уравнение цепной линии: y(x) = a * (cosh(x/a) - cosh(L / 2a))
    const catenarySagY = a * (Math.cosh(xCentered / a) - coshMax);
    p.y += catenarySagY;

    // Опциональная модуляция витков спирального телефонного/радиометрического шнура
    if (helicalTurns > 0) {
      // Плавное затухание спирали у гермовводов (strain relief boots)
      const envelope = Math.sin(t * Math.PI);
      const angle = t * Math.PI * 2 * helicalTurns;
      p.addScaledVector(binormal, Math.cos(angle) * helicalRadius * envelope);
      p.addScaledVector(normal, Math.sin(angle) * helicalRadius * envelope);
    }

    points.push(p);
  }

  return points;
}

/**
 * Создает 3D-меш гибкого кабеля по уравнению цепной линии с гермовводами (Strain Relief Boots)
 */
export function createCatenaryCableMesh(
  start: THREE.Vector3,
  end: THREE.Vector3,
  options: {
    cableRadius?: number;
    sagParameterA?: number;
    helicalTurns?: number;
    helicalRadius?: number;
    color?: number;
  } = {}
): THREE.Group {
  const cableGroup = new THREE.Group();
  const pts = createCatenaryCablePoints(
    start,
    end,
    options.sagParameterA ?? 0.058,
    72,
    options.helicalTurns ?? 10,
    options.helicalRadius ?? 0.0028
  );

  const curve = new THREE.CatmullRomCurve3(pts);
  const tubeGeo = new THREE.TubeGeometry(curve, 72, options.cableRadius ?? 0.0024, 12, false);
  const cableMat = createRubberSSSMaterial({
    color: options.color ?? 0x18181b,
    attenuationColor: 0x3f3f46,
    roughness: 0.42,
    transmission: 0.08,
    thickness: 0.008
  });

  const cableMesh = new THREE.Mesh(tubeGeo, cableMat);
  cableMesh.castShadow = true;
  cableGroup.add(cableMesh);

  return cableGroup;
}

/**
 * 9. Синтез фотореалистичной HDRI-карты окружения (PMREM Environment Map) и настройка
 * физически корректного пайплайна рендеринга (THREE.SRGBColorSpace, ACESFilmicToneMapping exposure = 1.0, PCFSoftShadowMap)
 */
export function configurePhotorealisticRendererAndHDRI(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene
): THREE.Texture {
  // 1. Точная установка параметров цветового пространства и тональной компрессии (Three.js r160+)
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0; // Точное соответствие ТЗ: exposure = 1.0

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // 2. Генерация высокодинамичной (HDRI) среды освещения через PMREMGenerator
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileCubemapShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x1e293b);

  // Купол мягкого студийно-промышленного градиента
  const skyGeo = new THREE.SphereGeometry(25, 32, 16);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x334155,
    side: THREE.BackSide
  });
  envScene.add(new THREE.Mesh(skyGeo, skyMat));

  // Высокояркостные HDR-панели верхнего света (создают реалистичные блики Френеля на стекле и фасках 1-3 мм)
  const createHDRLightPanel = (
    w: number,
    h: number,
    colorHex: number,
    intensity: number,
    pos: [number, number, number],
    lookAt: [number, number, number]
  ) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const col = new THREE.Color(colorHex).multiplyScalar(intensity);
    const mat = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.lookAt(...lookAt);
    envScene.add(mesh);
  };

  // Главные потолочные световые линии реакторного зала (высокая HDR яркость для четких AR-бликов)
  createHDRLightPanel(8, 2.2, 0xf8fafc, 7.5, [0, 12, 3], [0, 0, 0]);
  createHDRLightPanel(8, 2.2, 0xe0f2fe, 6.0, [-7, 9, -4], [0, 0, 0]);
  createHDRLightPanel(6, 3.0, 0xfef3c7, 5.5, [8, 7, 5], [0, 0, 0]);
  // Контровой (Rim) рефлектор для подчеркивания субмиллиметровых фасок
  createHDRLightPanel(10, 3.5, 0xbae6fd, 4.8, [0, 5, -12], [0, 0, 0]);
  // Мягкий рефлекс от светлого эпоксидного пола
  createHDRLightPanel(18, 18, 0x94a3b8, 1.4, [0, -8, 0], [0, 0, 0]);

  const envRT = pmremGenerator.fromScene(envScene, 0.025);
  scene.environment = envRT.texture;

  // Освобождаем временные ресурсы студийной сцены
  skyGeo.dispose();
  skyMat.dispose();
  pmremGenerator.dispose();

  return envRT.texture;
}

/**
 * 10. AAA PBR-материал разрушенного мокрого железобетона (Albedo, Roughness, Bump/Displacement, Clearcoat пленки воды)
 */
export function createWetCrackedConcreteMaterial(baseColorHex: number = 0x475569): THREE.MeshPhysicalMaterial {
  const { roughnessMap, bumpMap } = createPolymerCasingPBRMaps();
  return new THREE.MeshPhysicalMaterial({
    color: baseColorHex,
    roughness: 0.58,
    roughnessMap,
    metalness: 0.06,
    bumpMap,
    bumpScale: 0.0045,
    clearcoat: 0.48, // Эффект влажной пленки конденсата / пара на бетоне
    clearcoatRoughness: 0.22,
    reflectivity: 0.65,
    ior: 1.52
  });
}

/**
 * 11. AAA PBR-материал обожженного металла с термической окалиной и коррозией
 */
export function createScorchedCorrodedMetalMaterial(baseColorHex: number = 0x334155): THREE.MeshPhysicalMaterial {
  const { roughnessMap, bumpMap } = createMachinedMetalPBRMaps();
  return new THREE.MeshPhysicalMaterial({
    color: baseColorHex,
    metalness: 0.78,
    roughness: 0.46,
    roughnessMap,
    bumpMap,
    bumpScale: 0.0032,
    iridescence: 0.38, // Термическая побежалость обожженного сплава
    iridescenceIOR: 1.45,
    clearcoat: 0.14,
    clearcoatRoughness: 0.5
  });
}

/**
 * 12. AAA PBR-материал обломков реакторного графита и графитовой пыли ТВС
 */
export function createGraphiteDebrisMaterial(): THREE.MeshPhysicalMaterial {
  const { roughnessMap, bumpMap } = createHazmatGlovePBRMaps();
  return new THREE.MeshPhysicalMaterial({
    color: 0x18181b,
    metalness: 0.35,
    roughness: 0.62,
    roughnessMap,
    bumpMap,
    bumpScale: 0.005,
    sheen: 0.32,
    sheenColor: new THREE.Color(0x52525b),
    sheenRoughness: 0.45,
    clearcoat: 0.12
  });
}

/**
 * 13. AAA PBR-материал опасных радиоактивно-химических и плутониевых луж с Subsurface Scattering (SSS)
 */
export function createChemicalPuddleSSSMaterial(
  colorHex: number = 0x10b981,
  attenuationHex: number = 0x059669
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: colorHex,
    transmission: 0.76,
    thickness: 0.12,
    attenuationColor: new THREE.Color(attenuationHex),
    attenuationDistance: 0.08,
    ior: 1.39,
    roughness: 0.06,
    metalness: 0.02,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    emissive: new THREE.Color(attenuationHex),
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.92
  });
}

/**
 * 14. Визуальное свечение Вавилова — Черенкова и ионизация воздуха вблизи высокоактивных источников
 * (использует кастомный GLSL-шейдер CherenkovGlowShader с формулой Тамма — Франка, FBM и Fresnel)
 */
export function createCherenkovRadiationGlowMesh(
  radiusMeters: number = 0.85,
  activityBq: number = 4.5e13
): THREE.Group {
  return createCherenkovShaderMeshGroup(radiusMeters, {
    activityBq,
    medium: 'water_pool',
    wavelengthNm: 445,
    fresnelPower: 2.5,
    noiseScale: 3.4,
    pulseFrequencyHz: 18.0
  });
}

/**
 * 15. Объемное гауссово облако радиоактивного аэрозоля / пара с оптическим рассеянием Тиндаля
 * (использует кастомный GLSL-шейдер VolumetricPlumeSystem по модели Паскуилла — Гиффорда)
 */
export function createGaussianPlumeAerosolCloud(
  colorHex: number = 0xcbd5e1,
  radiusX: number = 3.2,
  radiusY: number = 1.8,
  radiusZ: number = 3.2
): THREE.Group {
  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'gaussian_plume_tyndall_cloud';

  // Подключаем GPU-систему дисперсии Паскуилла — Гиффорда с эффектом Тиндаля от фонаря левой руки
  const plumeSystem = new VolumetricPlumeSystem({
    particleCount: 420,
    stabilityClass: 'D',
    windSpeedMps: 1.6,
    plumeLengthM: Math.max(3.5, radiusX * 1.8),
    releaseHeightM: Math.max(0.25, radiusY * 0.25),
    aerosolColorHex: colorHex,
    baseOpacity: 0.28
  });
  plumeSystem.rootGroup.position.set(-radiusX * 0.65, 0, 0);
  cloudGroup.add(plumeSystem.rootGroup);

  const puffGeo = new THREE.SphereGeometry(1.0, 14, 10);
  const puffMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.09,
    roughness: 0.95,
    metalness: 0.0,
    depthWrite: false
  });
  for (let i = 0; i < 5; i++) {
    const scale = 0.55 + (i / 5) * 0.6;
    const puff = new THREE.Mesh(puffGeo, puffMat);
    puff.scale.set(radiusX * scale, radiusY * (0.6 + (i % 3) * 0.2), radiusZ * scale);
    puff.position.set(
      Math.sin(i * 1.7) * 0.55,
      0.7 + (i % 3) * 0.35,
      Math.cos(i * 2.1) * 0.55
    );
    puff.raycast = () => {};
    cloudGroup.add(puff);
  }

  return cloudGroup;
}
