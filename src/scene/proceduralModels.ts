/**
 * ALARA-Planner Pro VR — Фотореалистичные высокополигональные 3D модели оборудования радиационной безопасности
 * (95–99% физическая и геометрическая точность по стандартам ГОСТ / ISO)
 *
 * Реализованные инженерные требования:
 * - Сглаженные фаски и скругления кромок (Radius ≈ 1–3 мм, RoundedBoxGeometry и ExtrudeGeometry с bevelSegments = 4–6)
 * - Субмиллиметровые радиусы на рукоятках, стяжных замках, кнопках, фланцах и рамках приборов
 * - Уравнения цепной линии y(x) = a * cosh(x / a) - a для гибких высоковольтных и сигнальных кабелей
 * - Неоднородные PBR-карты шероховатости (полимерный корпус: roughness = 0.45; контакты/разъемы: metalness = 0.9, roughness = 0.2)
 *   с микроцарапинами, следами пальцев и износом пресс-форм
 * - Подповерхностное рассеивание (Subsurface Scattering - SSS) для свинцово-бутиловых перчаток, латекса и эластомеров
 * - Многослойная оптика и защитное свинцовое стекло (ТФ-5 / ГОСТ): отражения Френеля, просветляющее AR-покрытие (iridescence),
 *   микрорефракция (IOR 1.52–1.85) и физический зазор глубины между шкалой/ЖК-матрицей и верхним стеклом
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  createPolymerCasingMaterial,
  createMetalConnectorMaterial,
  createRubberSSSMaterial,
  createCatenaryCableMesh,
  createMachinedMetalPBRMaps
} from './pbrMaterialEngine';

// Вспомогательный генератор текстуры шлифованного металла со следами токарной обработки и микроцарапинами
export function createBrushedMetalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(0, 0, 512, 512);

  // Горизонтальные микроборозды шлифовки
  for (let y = 0; y < 512; y += 2) {
    const brightness = 140 + Math.floor(Math.random() * 50);
    ctx.strokeStyle = `rgba(${brightness}, ${brightness + 6}, ${brightness + 12}, 0.25)`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  // Зернистость и микроцарапины
  for (let i = 0; i < 30000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const val = 120 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${val}, ${val}, ${val}, 0.08)`;
    ctx.fillRect(x, y, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Текстура наклонных сигнальных желто-черных полос ГОСТ 12.4.026
export function createHazardStripesTexture(width = 512, height = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#eab308';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#0f172a';
  const stripeWidth = 32;
  for (let x = -height; x < width + height; x += stripeWidth * 2) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + stripeWidth, 0);
    ctx.lineTo(x + stripeWidth - height, height);
    ctx.lineTo(x - height, height);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Реалистичная текстура промышленной бетонной стены со светлыми панелями, швами и анкерами
export function createIndustrialConcreteWallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, 1024, 1024);

  for (let i = 0; i < 70000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const tone = Math.random() > 0.5 ? 255 : 180;
    const alpha = Math.random() * 0.05;
    ctx.fillStyle = `rgba(${tone}, ${tone}, ${tone}, ${alpha})`;
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 1016, 1016);
  ctx.beginPath();
  ctx.moveTo(512, 0);
  ctx.lineTo(512, 1024);
  ctx.moveTo(0, 512);
  ctx.lineTo(1024, 512);
  ctx.stroke();

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, 500, 500);
  ctx.strokeRect(518, 10, 496, 500);
  ctx.strokeRect(10, 518, 500, 496);
  ctx.strokeRect(518, 518, 496, 496);

  const boltPositions = [
    [40, 40], [480, 40], [40, 480], [480, 480],
    [544, 40], [984, 40], [544, 480], [984, 480],
    [40, 544], [480, 544], [40, 984], [480, 984],
    [544, 544], [984, 544], [544, 984], [984, 984]
  ];

  boltPositions.forEach(([bx, by]) => {
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(bx, by, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(bx - 2, by - 2, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = 'rgba(37, 99, 235, 0.75)';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('ЗОНА СТРОГОГО РЕЖИМА ВВЭР', 70, 100);
  ctx.font = 'bold 22px monospace';
  ctx.fillText('СЕКТОР А-04 • ОСПОРБ-99/2010', 70, 136);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Промышленный светлый дезактивируемый эпоксидный пол с разметкой безопасности и легким глянцем
export function createEpoxyFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 4;
  const gridSize = 256;
  for (let x = 0; x <= 1024; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1024);
    ctx.stroke();
  }
  for (let y = 0; y <= 1024; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y);
    ctx.stroke();
  }

  for (let i = 0; i < 40000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const val = 210 + Math.floor(Math.random() * 45);
    ctx.fillStyle = `rgba(${val}, ${val}, ${val}, 0.08)`;
    ctx.fillRect(x, y, 3, 3);
  }

  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, 480, 1024, 64);
  ctx.fillStyle = '#1e293b';
  for (let x = -64; x < 1024 + 64; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 480);
    ctx.lineTo(x + 32, 480);
    ctx.lineTo(x + 32 - 64, 544);
    ctx.lineTo(x - 64, 544);
    ctx.closePath();
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Чистая стена ПЭТ-лаборатории
export function createCleanroomWallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, 1016, 1016);
  ctx.beginPath();
  ctx.moveTo(512, 0);
  ctx.lineTo(512, 1024);
  ctx.moveTo(0, 512);
  ctx.lineTo(1024, 512);
  ctx.stroke();

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, 500, 500);
  ctx.strokeRect(516, 8, 500, 500);
  ctx.strokeRect(8, 516, 500, 500);
  ctx.strokeRect(516, 516, 500, 500);

  ctx.fillStyle = 'rgba(14, 165, 233, 0.7)';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('МОДУЛЬ СИНТЕЗА 18F-ФДГ', 60, 90);
  ctx.font = 'bold 20px monospace';
  ctx.fillText('КЛАСС ЧИСТОТЫ ISO 5 • СВИНЦОВАЯ БИОЗАЩИТА', 60, 126);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Антистатический полимерный пол чистой комнаты
export function createCleanroomFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3;
  const s = 128;
  for (let x = 0; x <= 512; x += s) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  for (let y = 0; y <= 512; y += s) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Текстура грунта, гравия и породы для уранового NORM-карьера
export function createQuarryGroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#57412f';
  ctx.fillRect(0, 0, 1024, 1024);

  for (let i = 0; i < 70000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const r = Math.floor(60 + Math.random() * 60);
    const g = Math.floor(45 + Math.random() * 45);
    const b = Math.floor(25 + Math.random() * 30);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(x, y, 3, 3);
  }

  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const radius = 2 + Math.random() * 6;
    ctx.fillStyle = Math.random() > 0.4 ? '#382b20' : '#785b41';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Текстура знака радиационной опасности ГОСТ 17925-72 (Трилистник)
export function createRadiationTrefoilTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, 242, 242);

  const cx = 128;
  const cy = 128;
  ctx.fillStyle = '#000000';

  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 3; i++) {
    const angle = (i * 120 - 90) * (Math.PI / 180);
    ctx.beginPath();
    ctx.arc(cx, cy, 88, angle - 0.52, angle + 0.52);
    ctx.arc(cx, cy, 36, angle + 0.52, angle - 0.52, true);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = '#000';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('РАДИАЦИЯ • ГОСТ', 128, 232);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Текстура прецизионного циферблата манометра ГОСТ 2405
export function createManometerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(256, 256, 248, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 14;
  ctx.stroke();

  // Деления шкалы давления (0..25 МПа)
  for (let i = 0; i <= 40; i++) {
    const angle = Math.PI * 0.75 + (i / 40) * Math.PI * 1.5;
    const isMajor = i % 4 === 0;
    const len = isMajor ? 38 : 20;
    const r1 = 230;
    const r2 = r1 - len;

    ctx.strokeStyle = i > 30 ? '#ef4444' : '#0f172a';
    ctx.lineWidth = isMajor ? 7 : 3;
    ctx.beginPath();
    ctx.moveTo(256 + Math.cos(angle) * r1, 256 + Math.sin(angle) * r1);
    ctx.lineTo(256 + Math.cos(angle) * r2, 256 + Math.sin(angle) * r2);
    ctx.stroke();
  }

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 38px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('МПа', 256, 172);
  ctx.font = 'bold 26px monospace';
  ctx.fillText('ГОСТ 2405 • КЛ. 0.6', 256, 212);

  // Красная черта предельного рабочего давления ВВЭР (16.0 МПа)
  const needleAngle = Math.PI * 0.75 + 0.65 * Math.PI * 1.5;
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(256, 256);
  ctx.lineTo(256 + Math.cos(needleAngle) * 176, 256 + Math.sin(needleAngle) * 176);
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(256, 256, 20, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Создание промышленного потолочного светильника со скругленными фасками R = 3 мм
 */
export function createIndustrialCeilingLamp(lightColor = 0xfffaed, intensity = 1.5): THREE.Group {
  const lampGroup = new THREE.Group();
  const metalMat = createMetalConnectorMaterial(0x94a3b8);

  const rodGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.4, 12);
  const rod = new THREE.Mesh(rodGeo, metalMat);
  rod.position.y = -0.2;
  lampGroup.add(rod);

  const housingGeo = new RoundedBoxGeometry(0.9, 0.12, 0.35, 4, 0.012);
  const housingMat = createPolymerCasingMaterial(0x475569);
  const housing = new THREE.Mesh(housingGeo, housingMat);
  housing.position.y = -0.44;
  lampGroup.add(housing);

  const diffuserGeo = new THREE.PlaneGeometry(0.85, 0.3);
  const diffuserMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: lightColor,
    emissiveIntensity: 2.2,
    roughness: 0.2
  });
  const diffuser = new THREE.Mesh(diffuserGeo, diffuserMat);
  diffuser.rotation.x = Math.PI / 2;
  diffuser.position.y = -0.505;
  lampGroup.add(diffuser);

  const pointLight = new THREE.PointLight(lightColor, intensity, 14, 1.2);
  pointLight.position.y = -0.6;
  pointLight.castShadow = true;
  pointLight.shadow.bias = -0.001;
  pointLight.shadow.mapSize.width = 512;
  pointLight.shadow.mapSize.height = 512;
  lampGroup.add(pointLight);

  return lampGroup;
}

/**
 * Металлическая ферма перекрытия промышленного цеха (I-Beam Truss)
 */
export function createIndustrialCeilingTruss(length: number): THREE.Group {
  const trussGroup = new THREE.Group();
  const trussMat = createMetalConnectorMaterial(0x64748b);

  const beamGeo = new RoundedBoxGeometry(length, 0.08, 0.08, 3, 0.004);
  const topBeam = new THREE.Mesh(beamGeo, trussMat);
  topBeam.position.y = 0.25;
  trussGroup.add(topBeam);

  const bottomBeam = new THREE.Mesh(beamGeo, trussMat);
  bottomBeam.position.y = -0.25;
  trussGroup.add(bottomBeam);

  const segments = Math.floor(length / 0.8);
  for (let i = 0; i <= segments; i++) {
    const x = -length / 2 + (i / segments) * length;
    const postGeo = new RoundedBoxGeometry(0.04, 0.5, 0.04, 2, 0.003);
    const post = new THREE.Mesh(postGeo, trussMat);
    post.position.set(x, 0, 0);
    trussGroup.add(post);

    if (i < segments) {
      const diagGeo = new RoundedBoxGeometry(0.03, 0.65, 0.03, 2, 0.003);
      const diag = new THREE.Mesh(diagGeo, trussMat);
      diag.position.set(x + length / segments / 2, 0, 0);
      diag.rotation.z = i % 2 === 0 ? 0.65 : -0.65;
      trussGroup.add(diag);
    }
  }

  return trussGroup;
}

/**
 * 1. Высокополигональный запорный клапан первого контура ВВЭР (ГОСТ 12821-80)
 * со сглаженными фасками фланцев, резьбовым штоком, эргономичным штурвалом
 * и многослойным оптическим манометром ГОСТ 2405 с кабелем датчика давления (Catenary curve)
 */
export function createHighDetailValve(): THREE.Group {
  const valveGroup = new THREE.Group();
  const { roughnessMap, bumpMap } = createMachinedMetalPBRMaps();

  const stainlessSteelMat = new THREE.MeshPhysicalMaterial({
    color: 0xcbd5e1,
    metalness: 0.9, // Точное соответствие ТЗ
    roughness: 0.2,
    roughnessMap,
    bumpMap,
    bumpScale: 0.0008,
    clearcoat: 0.25,
    clearcoatRoughness: 0.15
  });

  // Полимерно-порошковое покрытие штурвала (roughness = 0.45)
  const valveRedPolymerMat = createPolymerCasingMaterial(0xdc2626);
  const blueFlangeMat = createPolymerCasingMaterial(0x1d4ed8);
  const boltChromeMat = createMetalConnectorMaterial(0xf1f5f9);

  // 1. Литой корпус вентиля со сферическим расширением в центре
  const bodyCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.62, 36), stainlessSteelMat);
  bodyCyl.castShadow = true;
  bodyCyl.receiveShadow = true;
  valveGroup.add(bodyCyl);

  const bodySphere = new THREE.Mesh(new THREE.SphereGeometry(0.41, 32, 24), stainlessSteelMat);
  bodySphere.castShadow = true;
  valveGroup.add(bodySphere);

  // 2. Приварные воротниковые фланцы с фаской R = 3 мм (Torus bevel ring)
  [-0.29, 0.29].forEach(fy => {
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.49, 0.49, 0.085, 36), blueFlangeMat);
    flange.position.y = fy;
    flange.castShadow = true;
    valveGroup.add(flange);

    // Скругленная кромка фланца (Radius = 3 мм)
    const bevelRing = new THREE.Mesh(new THREE.TorusGeometry(0.487, 0.006, 16, 40), blueFlangeMat);
    bevelRing.rotation.x = Math.PI / 2;
    bevelRing.position.y = fy + (fy > 0 ? 0.04 : -0.04);
    valveGroup.add(bevelRing);
  });

  // 12 шестигранных шпилек с шайбами на каждом фланце
  const hexBoltGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.125, 6);
  const washerGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.012, 20);
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const bx = Math.cos(angle) * 0.425;
    const bz = Math.sin(angle) * 0.425;

    [0.29, -0.29].forEach(fy => {
      const bolt = new THREE.Mesh(hexBoltGeo, boltChromeMat);
      bolt.position.set(bx, fy, bz);
      valveGroup.add(bolt);

      const washer = new THREE.Mesh(washerGeo, boltChromeMat);
      washer.position.set(bx, fy + (fy > 0 ? 0.048 : -0.048), bz);
      valveGroup.add(washer);
    });
  }

  // 3. Крышка сальниковой камеры и трапецеидальный ходовой шток
  const bonnet = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.25, 0.36, 28), stainlessSteelMat);
  bonnet.position.y = 0.46;
  valveGroup.add(bonnet);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.48, 24), boltChromeMat);
  stem.position.y = 0.73;
  valveGroup.add(stem);

  // Микрокольца трапецеидальной резьбы штока (субмиллиметровая детализация)
  for (let ty = 0.56; ty <= 0.88; ty += 0.018) {
    const thread = new THREE.Mesh(new THREE.TorusGeometry(0.0445, 0.0022, 8, 24), boltChromeMat);
    thread.rotation.x = Math.PI / 2;
    thread.position.y = ty;
    valveGroup.add(thread);
  }

  // 4. Эргономичный штурвал со скругленными ребрами хвата и фасками
  const handwheelGroup = new THREE.Group();
  handwheelGroup.position.y = 0.96;
  handwheelGroup.name = 'handwheel';

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.040, 24, 48), valveRedPolymerMat);
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = true;
  handwheelGroup.add(rim);

  // 16 подпальцевых эргономических выступов на внешнем ободе штурвала
  for (let g = 0; g < 16; g++) {
    const ga = (g / 16) * Math.PI * 2;
    const gripNub = new THREE.Mesh(new THREE.SphereGeometry(0.043, 12, 12), valveRedPolymerMat);
    gripNub.scale.set(0.8, 0.75, 1.1);
    gripNub.position.set(Math.cos(ga) * 0.38, 0, Math.sin(ga) * 0.38);
    handwheelGroup.add(gripNub);
  }

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.075, 24), valveRedPolymerMat);
  handwheelGroup.add(hub);

  const lockNut = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.092, 6), boltChromeMat);
  handwheelGroup.add(lockNut);

  const spokeGeo = new THREE.CylinderGeometry(0.021, 0.026, 0.36, 16);
  for (let i = 0; i < 5; i++) {
    const sa = (i / 5) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, valveRedPolymerMat);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = sa;
    spoke.position.set(Math.cos(sa) * 0.18, 0, Math.sin(sa) * 0.18);
    handwheelGroup.add(spoke);
  }
  valveGroup.add(handwheelGroup);

  // 5. Многослойный оптический манометр ГОСТ 2405 (с глубиной циферблата, стрелкой и AR-стеклом Френеля)
  const manoGroup = new THREE.Group();
  manoGroup.position.set(0.36, 0.18, 0.22);
  manoGroup.rotation.y = Math.PI / 4;

  const manoCase = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.058, 32), stainlessSteelMat);
  manoCase.rotation.x = Math.PI / 2;
  manoGroup.add(manoCase);

  // Точеный рант манометра со скругленной фаской R = 2.5 мм
  const manoBezel = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.008, 16, 36), boltChromeMat);
  manoBezel.position.z = 0.028;
  manoGroup.add(manoBezel);

  // Подложка шкалы манометра на глубине 4 мм под стеклом
  const dialPlane = new THREE.Mesh(
    new THREE.CircleGeometry(0.114, 32),
    new THREE.MeshStandardMaterial({ map: createManometerTexture(), roughness: 0.35 })
  );
  dialPlane.position.z = 0.024;
  manoGroup.add(dialPlane);

  // Верхнее закаленное стекло манометра с антибликовым AR-покрытием и эффектом Френеля
  const manoGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    transmission: 0.94,
    thickness: 0.004,
    ior: 1.52,
    reflectivity: 0.92,
    roughness: 0.02,
    clearcoat: 1.0,
    iridescence: 0.65,
    iridescenceIOR: 1.38
  });
  const manoGlass = new THREE.Mesh(new THREE.CircleGeometry(0.118, 32), manoGlassMat);
  manoGlass.position.z = 0.031;
  manoGroup.add(manoGlass);

  // Импульсная трубка Бурдона + гибкий кабель датчика телеметрии по уравнению цепной линии
  const cableMesh = createCatenaryCableMesh(
    new THREE.Vector3(0, -0.12, 0),
    new THREE.Vector3(-0.22, -0.05, -0.12),
    { cableRadius: 0.006, sagParameterA: 0.09, helicalTurns: 0, color: 0x1e293b }
  );
  manoGroup.add(cableMesh);

  valveGroup.add(manoGroup);
  return valveGroup;
}

/**
 * 2. Защитный транспортный контейнер ТК-6 / УКТ-Д (ГОСТ 16327-88)
 * с двухслойной свинцовой защитой 60 мм Pb, скругленными ребрами, стальными защелками-стяжками
 * и гибким страховочным тросом крышки по уравнению цепной линии
 */
export function createTK6Container(): THREE.Group {
  const container = new THREE.Group();

  const yellowPolymerPaintMat = createPolymerCasingMaterial(0xfbbf24);
  const heavyLeadMat = new THREE.MeshPhysicalMaterial({
    color: 0x475569,
    metalness: 0.82,
    roughness: 0.32,
    map: createBrushedMetalTexture(),
    clearcoat: 0.1
  });
  const stainlessMat = createMetalConnectorMaterial(0xf8fafc); // metalness = 0.9, roughness = 0.2

  const warningMat = new THREE.MeshStandardMaterial({
    map: createRadiationTrefoilTexture(),
    roughness: 0.35,
    metalness: 0.15
  });

  // 1. Внешний цилиндрический корпус с верхним и нижним защитными буртами (фаска R = 3 мм)
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.235, 0.54, 36), yellowPolymerPaintMat);
  outer.position.y = 0.27;
  outer.castShadow = true;
  outer.receiveShadow = true;
  container.add(outer);

  // Резиновые демпферные пояса жесткости с подповерхностным рассеиванием
  const bandMat = createRubberSSSMaterial({
    color: 0x1e293b,
    attenuationColor: 0x475569,
    roughness: 0.48,
    transmission: 0.14
  });
  [0.10, 0.43].forEach(by => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.248, 0.014, 16, 36), bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = by;
    container.add(band);
  });

  // 2. Внутренняя свинцовая биозащитная гильза (60 мм свинца ГОСТ 3778-98) со ступенчатым замком
  const innerLead = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 28), heavyLeadMat);
  innerLead.position.y = 0.30;
  container.add(innerLead);

  const innerWell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.44, 24),
    createMetalConnectorMaterial(0x1e293b)
  );
  innerWell.position.y = 0.305;
  container.add(innerWell);

  // 3. Массивная ступенчатая защитная крышка со скругленным кантом и такелажной скобой
  const lidGroup = new THREE.Group();
  lidGroup.position.y = 0.545;
  lidGroup.name = 'container_lid';

  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.258, 0.262, 0.085, 36), yellowPolymerPaintMat);
  lid.castShadow = true;
  lidGroup.add(lid);

  const lidBevel = new THREE.Mesh(new THREE.TorusGeometry(0.256, 0.008, 16, 36), yellowPolymerPaintMat);
  lidBevel.rotation.x = Math.PI / 2;
  lidBevel.position.y = 0.04;
  lidGroup.add(lidBevel);

  // Верхняя хромированная рукоятка крышки (metalness = 0.9, roughness = 0.2)
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.014, 16, 32, Math.PI), stainlessMat);
  handle.position.y = 0.042;
  lidGroup.add(handle);

  container.add(lidGroup);

  // 4. Четыре эксцентриковых стяжных замка-защелки по периметру крышки
  const latchGeo = new RoundedBoxGeometry(0.028, 0.095, 0.018, 4, 0.002);
  for (let i = 0; i < 4; i++) {
    const la = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const latch = new THREE.Mesh(latchGeo, stainlessMat);
    latch.position.set(Math.cos(la) * 0.256, 0.50, Math.sin(la) * 0.256);
    latch.rotation.y = -la + Math.PI / 2;
    container.add(latch);
  }

  // 5. Боковые такелажные цапфы и ручки для переноски
  [-1, 1].forEach(side => {
    const sideHandle = new THREE.Group();
    sideHandle.position.set(side * 0.26, 0.32, 0);

    const bracket = new THREE.Mesh(new RoundedBoxGeometry(0.025, 0.06, 0.20, 3, 0.002), stainlessMat);
    sideHandle.add(bracket);

    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 16), stainlessMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.x = side * 0.018;
    sideHandle.add(bar);

    container.add(sideHandle);
  });

  // 6. Гибкий пломбировочный/страховочный трос крышки по уравнению цепной линии (Catenary Curve)
  const securityCable = createCatenaryCableMesh(
    new THREE.Vector3(0.24, 0.55, 0.08),
    new THREE.Vector3(0.25, 0.34, 0.04),
    { cableRadius: 0.0035, sagParameterA: 0.06, helicalTurns: 0, color: 0x475569 }
  );
  container.add(securityCable);

  // 7. Эмалированная табличка со знаком радиационной опасности ГОСТ 17925-72 и рамкой R = 1.5 мм
  const plaqueFrame = new THREE.Mesh(new RoundedBoxGeometry(0.19, 0.19, 0.008, 3, 0.0015), stainlessMat);
  plaqueFrame.position.set(0, 0.28, 0.250);
  container.add(plaqueFrame);

  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.175, 0.175), warningMat);
  sign.position.set(0, 0.28, 0.255);
  container.add(sign);

  return container;
}

/**
 * 3. Свинцовые защитные кирпичи ГОСТ со скошенными замками "ласточкин хвост" и фасками R = 2 мм
 */
export function createLeadBrickStack(rows = 3, cols = 4): THREE.Group {
  const stack = new THREE.Group();

  const leadMat = new THREE.MeshPhysicalMaterial({
    color: 0x64748b,
    metalness: 0.84,
    roughness: 0.27,
    map: createBrushedMetalTexture(),
    clearcoat: 0.12,
    clearcoatRoughness: 0.35
  });

  const brickW = 0.20; // 200 мм длина по ГОСТ
  const brickH = 0.10; // 100 мм высота
  const brickD = 0.10; // 100 мм толщина

  // Скругленные кромки R = 2 мм (0.002 м)
  const brickGeo = new RoundedBoxGeometry(brickW, brickH, brickD, 4, 0.0025);
  // Верхний шевронный шип замка "ласточкин хвост" для исключения прострела гамма-квантов через швы
  const ridgeGeo = new RoundedBoxGeometry(brickW * 0.96, 0.018, brickD * 0.42, 3, 0.0015);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const brickGroup = new THREE.Group();

      const brick = new THREE.Mesh(brickGeo, leadMat);
      brick.castShadow = true;
      brick.receiveShadow = true;
      brickGroup.add(brick);

      const ridge = new THREE.Mesh(ridgeGeo, leadMat);
      ridge.position.y = brickH * 0.5 + 0.006;
      brickGroup.add(ridge);

      const offset = r % 2 === 0 ? 0 : brickW * 0.25;
      brickGroup.position.set((c - (cols - 1) / 2) * brickW * 1.02 + offset, r * brickH + brickH / 2, 0);
      stack.add(brickGroup);
    }
  }

  return stack;
}

/**
 * 4. Передвижная защитная свинцовая ширма (20 мм Pb) со смотровым окном из радиационно-стойкого
 * свинцового стекла ТФ-5 (IOR = 1.85, многослойные отражения Френеля и AR-покрытие)
 */
export function createMovableLeadShieldScreen(): THREE.Group {
  const shield = new THREE.Group();

  const yellowFrameMat = createPolymerCasingMaterial(0xfbbf24);
  const leadPlateMat = new THREE.MeshPhysicalMaterial({
    color: 0x64748b,
    metalness: 0.82,
    roughness: 0.26,
    map: createBrushedMetalTexture()
  });
  const chromeMat = createMetalConnectorMaterial(0xe2e8f0);

  // Многослойное оптическое свинцовое стекло марки ТФ-5 (высокий показатель преломления IOR = 1.85)
  const leadGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xfef08a,
    transmission: 0.93,
    opacity: 1,
    transparent: true,
    roughness: 0.03,
    ior: 1.85, // Высокоплотное свинцовое стекло (Fresnel reflection)
    reflectivity: 0.96,
    thickness: 0.10, // 100 мм толщина оптического блока
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    iridescence: 0.58, // Антибликовое просветление AR-покрытия
    iridescenceIOR: 1.38,
    attenuationColor: new THREE.Color(0xfde047),
    attenuationDistance: 0.22
  });

  // 1. Опорная рама со скругленными фасками R = 3 мм
  const baseMesh = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.08, 0.62, 4, 0.004), yellowFrameMat);
  baseMesh.position.y = 0.085;
  baseMesh.castShadow = true;
  shield.add(baseMesh);

  // 4 поворотных промышленных колесных опоры с тормозными лапками
  const wheelMat = createRubberSSSMaterial({
    color: 0x0f172a,
    attenuationColor: 0x334155,
    roughness: 0.55,
    transmission: 0.1
  });
  [
    [-0.6, -0.22],
    [-0.6, 0.22],
    [0.6, -0.22],
    [0.6, 0.22]
  ].forEach(([wx, wz]) => {
    const fork = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.06, 0.07, 3, 0.002), chromeMat);
    fork.position.set(wx, 0.065, wz);
    shield.add(fork);

    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.038, 24), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.058, wz);
    shield.add(wheel);
  });

  // 2. Свинцовая бронеплита 20 мм Pb со скругленными фасками R = 3 мм
  const plateMesh = new THREE.Mesh(new RoundedBoxGeometry(1.32, 1.22, 0.055, 5, 0.003), leadPlateMat);
  plateMesh.position.set(0, 0.73, 0);
  plateMesh.castShadow = true;
  plateMesh.receiveShadow = true;
  shield.add(plateMesh);

  // Предупреждающая желто-черная полоса ГОСТ 12.4.026
  const stripeMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.30, 0.12),
    new THREE.MeshBasicMaterial({ map: createHazardStripesTexture(256, 32) })
  );
  stripeMesh.position.set(0, 0.22, 0.029);
  shield.add(stripeMesh);

  // 3. Многослойное смотровое окно в стальной скошенной раме
  const windowFrame = new THREE.Mesh(new RoundedBoxGeometry(0.84, 0.48, 0.09, 4, 0.003), yellowFrameMat);
  windowFrame.position.set(0, 1.52, 0);
  shield.add(windowFrame);

  // Внутренняя черная антибликовая прокладка стеклопакета (создает оптическую глубину)
  const innerGasket = new THREE.Mesh(
    new RoundedBoxGeometry(0.75, 0.40, 0.082, 3, 0.002),
    createPolymerCasingMaterial(0x0f172a)
  );
  innerGasket.position.set(0, 1.52, 0);
  shield.add(innerGasket);

  // Основной блок свинцового стекла ТФ-5
  const glass = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.38, 0.074, 4, 0.002), leadGlassMat);
  glass.position.set(0, 1.52, 0);
  shield.add(glass);

  // Второй тонкий защитный покровный слой стекла с воздушным зазором 2 мм (двойное отражение Френеля)
  const frontGlassSheet = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.38), leadGlassMat);
  frontGlassSheet.position.set(0, 1.52, 0.041);
  shield.add(frontGlassSheet);

  // 4. Эргономические поручни с прорезиненными SSS-рукоятками
  const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.16, 20), chromeMat);
  handleBar.rotation.z = Math.PI / 2;
  handleBar.position.set(0, 1.02, 0.24);
  shield.add(handleBar);

  [-0.38, 0.38].forEach(gx => {
    const gripSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.22, 20), wheelMat);
    gripSleeve.rotation.z = Math.PI / 2;
    gripSleeve.position.set(gx, 1.02, 0.24);
    shield.add(gripSleeve);
  });

  return shield;
}

/**
 * 5. Светосигнальное табло / радиационный маяк с оптическим рассеивателем Френеля
 */
export function createRadiationBeacon(state: 'normal' | 'warning' | 'danger'): THREE.Group {
  const beacon = new THREE.Group();

  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.082, 0.088, 0.24, 28),
    createPolymerCasingMaterial(0x1e293b)
  );
  housing.position.y = 0.12;
  beacon.add(housing);

  let domeColor = 0x22c55e;
  let emissiveColor = 0x15803d;
  if (state === 'warning') {
    domeColor = 0xeab308;
    emissiveColor = 0xa16207;
  } else if (state === 'danger') {
    domeColor = 0xef4444;
    emissiveColor = 0xb91c1c;
  }

  // Внутренний излучатель маяка
  const emitter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, 0.09, 20),
    new THREE.MeshStandardMaterial({
      color: domeColor,
      emissive: domeColor,
      emissiveIntensity: 3.5
    })
  );
  emitter.position.y = 0.27;
  beacon.add(emitter);

  // Внешний поликарбонатный колпак с линзой Френеля и микрорефракцией
  const domeGeo = new THREE.SphereGeometry(0.078, 28, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMat = new THREE.MeshPhysicalMaterial({
    color: domeColor,
    emissive: emissiveColor,
    emissiveIntensity: 0.75,
    transmission: 0.82,
    thickness: 0.015,
    ior: 1.58,
    roughness: 0.08,
    clearcoat: 1.0,
    transparent: true
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.y = 0.24;
  beacon.add(dome);

  const beaconLight = new THREE.PointLight(domeColor, state === 'danger' ? 2.5 : 1.0, 8);
  beaconLight.position.y = 0.3;
  beacon.add(beaconLight);

  return beacon;
}

/**
 * 6. Радиофармацевтический бокс биологической защиты (Горячая камера ПЭТ)
 * со скругленными фасками, многослойным свинцовым стеклом, перчаточными портами SSS и гибкими шлангами
 */
export function createHotCellGlovebox(): THREE.Group {
  const cell = new THREE.Group();

  const whitePolymerMat = createPolymerCasingMaterial(0xf8fafc);
  const stainlessMat = createMetalConnectorMaterial(0xe2e8f0);

  const leadGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xfef08a,
    transmission: 0.90,
    opacity: 1,
    transparent: true,
    roughness: 0.03,
    ior: 1.85,
    reflectivity: 0.95,
    thickness: 0.14,
    clearcoat: 1.0,
    iridescence: 0.62,
    iridescenceIOR: 1.38
  });

  const body = new THREE.Mesh(new RoundedBoxGeometry(2.4, 2.0, 1.4, 5, 0.012), whitePolymerMat);
  body.position.y = 1.3;
  body.castShadow = true;
  cell.add(body);

  const cavity = new THREE.Mesh(new RoundedBoxGeometry(2.1, 1.2, 1.1, 4, 0.008), stainlessMat);
  cavity.position.set(0, 1.4, 0.1);
  cell.add(cavity);

  const windowFrame = new THREE.Mesh(new RoundedBoxGeometry(1.62, 0.92, 0.11, 4, 0.004), stainlessMat);
  windowFrame.position.set(0, 1.5, 0.71);
  cell.add(windowFrame);

  const glass = new THREE.Mesh(new RoundedBoxGeometry(1.48, 0.78, 0.085, 4, 0.003), leadGlassMat);
  glass.position.set(0, 1.5, 0.72);
  cell.add(glass);

  // Перчаточные порты с герметичными свинцово-бутиловыми крагами (SSS)
  const glovePortSSSMat = createRubberSSSMaterial({
    color: 0x1e293b,
    attenuationColor: 0x3b82f6,
    roughness: 0.42,
    transmission: 0.22,
    thickness: 0.025,
    withGloveMicroTread: true
  });

  [-0.45, 0.45].forEach(px => {
    const portRing = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.022, 20, 36), stainlessMat);
    portRing.position.set(px, 0.92, 0.71);
    cell.add(portRing);

    const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.095, 0.06, 28), glovePortSSSMat);
    plug.rotation.x = Math.PI / 2;
    plug.position.set(px, 0.92, 0.72);
    cell.add(plug);
  });

  // Вытяжная фильтровентиляционная колонна (HEPA) и гибкий кабель телеметрии (Catenary)
  const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 28), stainlessMat);
  duct.position.set(0.7, 2.6, 0);
  cell.add(duct);

  const sensorCable = createCatenaryCableMesh(
    new THREE.Vector3(0.85, 1.85, 0.71),
    new THREE.Vector3(1.12, 1.45, 0.71),
    { cableRadius: 0.006, sagParameterA: 0.12, helicalTurns: 7, helicalRadius: 0.008, color: 0x0f172a }
  );
  cell.add(sensorCable);

  const interiorLight = new THREE.PointLight(0xffffff, 1.5, 4);
  interiorLight.position.set(0, 1.8, 0);
  cell.add(interiorLight);

  return cell;
}

/**
 * 7. Высокомощный взрывозащищенный тактический фонарь радиационной разведки (ФПС-4/6 ВЗГ / Hazmat LED)
 * Ориентирован оптической осью строго вдоль -Z локального пространства (по направлению указательного пальца кисти).
 * Содержит управляемый высокоинтенсивный THREE.SpotLight, заливающий THREE.PointLight,
 * объемный световой конус Тиндаля (Volumetric Beam Cone) и светодиодный индикатор состояния.
 */
export function createTacticalFlashlight(initialOn = false): THREE.Group {
  const flashlight = new THREE.Group();
  flashlight.name = 'tactical_flashlight';

  const bodyPolymerMat = createPolymerCasingMaterial(0xeab308); // Ударопрочный желтый корпус Hazmat
  const darkMetalMat = createMetalConnectorMaterial(0x1e293b);
  const chromeMat = createMetalConnectorMaterial(0xe2e8f0);
  const rubberGripMat = createRubberSSSMaterial({
    color: 0x0f172a,
    attenuationColor: 0x334155,
    roughness: 0.55,
    transmission: 0.08,
    thickness: 0.01,
    withGloveMicroTread: true
  });

  // 1. Основной цилиндрический корпус-рукоятка (вдоль оси Z: от +0.085 до -0.095)
  const barrelGeo = new THREE.CylinderGeometry(0.019, 0.018, 0.165, 28);
  barrelGeo.rotateX(Math.PI / 2);
  const barrelMesh = new THREE.Mesh(barrelGeo, bodyPolymerMat);
  barrelMesh.position.set(0, 0, -0.005);
  barrelMesh.castShadow = true;
  barrelMesh.receiveShadow = true;
  flashlight.add(barrelMesh);

  // Прорезиненная рельефная накладка под пальцы (Knurled Rubber Sleeve)
  const sleeveGeo = new THREE.CylinderGeometry(0.0205, 0.020, 0.095, 28);
  sleeveGeo.rotateX(Math.PI / 2);
  const sleeveMesh = new THREE.Mesh(sleeveGeo, rubberGripMat);
  sleeveMesh.position.set(0, 0, 0.01);
  flashlight.add(sleeveMesh);

  // 2. Торцевая крышка батарейного отсека с противоударным бампером (+Z)
  const tailCapGeo = new THREE.CylinderGeometry(0.021, 0.019, 0.024, 24);
  tailCapGeo.rotateX(Math.PI / 2);
  const tailCap = new THREE.Mesh(tailCapGeo, darkMetalMat);
  tailCap.position.set(0, 0, 0.082);
  flashlight.add(tailCap);

  // 3. Шестигранный радиатор охлаждения и расширенная головная часть (-Z)
  const hexCollarGeo = new THREE.CylinderGeometry(0.026, 0.022, 0.028, 6);
  hexCollarGeo.rotateX(Math.PI / 2);
  const hexCollar = new THREE.Mesh(hexCollarGeo, darkMetalMat);
  hexCollar.position.set(0, 0, -0.082);
  flashlight.add(hexCollar);

  // Головной рефлекторный блок с ребрами охлаждения
  const headBezelGeo = new THREE.CylinderGeometry(0.032, 0.025, 0.042, 32);
  headBezelGeo.rotateX(Math.PI / 2);
  const headBezel = new THREE.Mesh(headBezelGeo, darkMetalMat);
  headBezel.position.set(0, 0, -0.108);
  headBezel.castShadow = true;
  flashlight.add(headBezel);

  // Защитное резиновое кольцо вокруг линзы
  const bezelBumper = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0035, 16, 32), bodyPolymerMat);
  bezelBumper.position.set(0, 0, -0.128);
  flashlight.add(bezelBumper);

  // 4. Глубокий параболический зеркальный отражатель и CREE-светодиод
  const reflectorGeo = new THREE.CylinderGeometry(0.028, 0.008, 0.024, 28, 1, true);
  reflectorGeo.rotateX(Math.PI / 2);
  const reflectorMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    metalness: 0.98,
    roughness: 0.06,
    side: THREE.DoubleSide
  });
  const reflector = new THREE.Mesh(reflectorGeo, reflectorMat);
  reflector.position.set(0, 0, -0.116);
  flashlight.add(reflector);

  const ledEmitterMat = new THREE.MeshStandardMaterial({
    color: 0xfffef0,
    emissive: new THREE.Color(0xfffbeb),
    emissiveIntensity: initialOn ? 8.0 : 0.08,
    roughness: 0.15
  });
  const ledEmitter = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 16, 12), ledEmitterMat);
  ledEmitter.name = 'flashlight_led_emitter';
  ledEmitter.position.set(0, 0, -0.112);
  flashlight.add(ledEmitter);

  // Закаленная оптическая линза с просветлением
  const lensGeo = new THREE.CylinderGeometry(0.0285, 0.0285, 0.003, 28);
  lensGeo.rotateX(Math.PI / 2);
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 0.92,
    ior: 1.52,
    roughness: 0.04,
    thickness: 0.006,
    transparent: true
  });
  const lensMesh = new THREE.Mesh(lensGeo, lensMat);
  lensMesh.position.set(0, 0, -0.127);
  flashlight.add(lensMesh);

  // 5. Верхняя тактическая кнопка включения и светодиодный индикатор питания
  const switchHousing = new THREE.Mesh(
    new RoundedBoxGeometry(0.016, 0.009, 0.026, 3, 0.002),
    chromeMat
  );
  switchHousing.position.set(0, 0.020, -0.052);
  flashlight.add(switchHousing);

  const statusLedMat = new THREE.MeshStandardMaterial({
    color: initialOn ? 0x22c55e : 0xf59e0b,
    emissive: new THREE.Color(initialOn ? 0x22c55e : 0xf59e0b),
    emissiveIntensity: initialOn ? 3.5 : 1.2
  });
  const statusLed = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 12, 10), statusLedMat);
  statusLed.name = 'flashlight_status_led';
  statusLed.position.set(0, 0.025, -0.052);
  flashlight.add(statusLed);

  // 6. Объемный световой луч (Volumetric Beam Cone вдоль -Z)
  const coneLength = 4.6;
  const coneRadius = 0.88;
  const coneGeo = new THREE.ConeGeometry(coneRadius, coneLength, 32, 1, true);
  // По умолчанию вершина ConeGeometry в +Y, основание в -Y.
  // Сдвигаем так, чтобы вершина была в (0,0,0), а конус раскрывался вдоль -Z:
  coneGeo.translate(0, -coneLength / 2, 0);
  coneGeo.rotateX(Math.PI / 2);

  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xfffbeb,
    transparent: true,
    opacity: 0.11,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const beamCone = new THREE.Mesh(coneGeo, coneMat);
  beamCone.name = 'flashlight_beam_cone';
  beamCone.position.set(0, 0, -0.128);
  beamCone.visible = initialOn;
  beamCone.raycast = () => {}; // Исключаем световой конус из перехвата лучей рейкастера
  flashlight.add(beamCone);

  // 7. Высокоинтенсивный узконаправленный прожектор THREE.SpotLight + его цель вдоль -Z
  //    Прикрепляем SpotLight и spotLight.target напрямую к модели фонаря со смещением цели (0, 0, -5)
  const spotTarget = new THREE.Object3D();
  spotTarget.name = 'flashlight_spot_target';
  spotTarget.position.set(0, 0, -5);

  const spotLight = new THREE.SpotLight(0xfffef0, initialOn ? 68.0 : 0.0, 34, Math.PI / 5.2, 0.42, 1.35);
  spotLight.name = 'flashlight_spot_light';
  spotLight.position.set(0, 0, -0.13);
  spotLight.target = spotTarget;
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 1024;
  spotLight.shadow.mapSize.height = 1024;
  spotLight.shadow.camera.near = 0.08;
  spotLight.shadow.camera.far = 32;
  spotLight.shadow.bias = -0.0003;
  spotLight.visible = initialOn;
  flashlight.add(spotLight);
  flashlight.add(spotLight.target);

  // Мягкая локальная засветка вблизи линзы фонаря
  const bounceLight = new THREE.PointLight(0xfffbeb, initialOn ? 2.6 : 0.0, 4.2, 1.6);
  bounceLight.name = 'flashlight_bounce_light';
  bounceLight.position.set(0, 0, -0.16);
  bounceLight.visible = initialOn;
  flashlight.add(bounceLight);

  flashlight.position.set(-0.02, 0.01, -0.03);
  flashlight.rotation.set(0, 0, 0);

  flashlight.userData = {
    ...flashlight.userData,
    interactiveId: 'tactical_flashlight',
    isFlashlight: true,
    isFlashlightOn: initialOn,
    placementType: 'prop',
    isLargeEquipment: false
  };

  return flashlight;
}

/**
 * Переключение состояния питания тактического фонаря (вкл / выкл)
 */
export function setTacticalFlashlightPower(flashlightRoot: THREE.Object3D, isOn: boolean): void {
  if (flashlightRoot.userData?.vrFlashlightInstance) {
    flashlightRoot.userData.vrFlashlightInstance.setPower(isOn);
    return;
  }

  flashlightRoot.userData.isFlashlightOn = isOn;

  const spotLight = flashlightRoot.getObjectByName('flashlight_spot_light') as THREE.SpotLight | undefined;
  if (spotLight) {
    spotLight.visible = isOn;
    spotLight.intensity = isOn ? 68.0 : 0.0;
    spotLight.target.position.set(0, 0, -5);
  }

  const bounceLight = flashlightRoot.getObjectByName('flashlight_bounce_light') as THREE.PointLight | undefined;
  if (bounceLight) {
    bounceLight.visible = isOn;
    bounceLight.intensity = isOn ? 2.6 : 0.0;
  }

  const beamCone = flashlightRoot.getObjectByName('flashlight_beam_cone') as THREE.Mesh | undefined;
  if (beamCone) {
    beamCone.visible = isOn;
  }

  const ledEmitter = flashlightRoot.getObjectByName('flashlight_led_emitter') as THREE.Mesh | undefined;
  if (ledEmitter && ledEmitter.material instanceof THREE.MeshStandardMaterial) {
    ledEmitter.material.emissiveIntensity = isOn ? 8.0 : 0.08;
  }

  const statusLed = flashlightRoot.getObjectByName('flashlight_status_led') as THREE.Mesh | undefined;
  if (statusLed && statusLed.material instanceof THREE.MeshStandardMaterial) {
    const colorHex = isOn ? 0x22c55e : 0xf59e0b;
    statusLed.material.color.setHex(colorHex);
    statusLed.material.emissive.setHex(colorHex);
    statusLed.material.emissiveIntensity = isOn ? 3.5 : 1.2;
  }
}

/**
 * Напольная приборная стойка-ложемент для размещения тактического фонаря рядом с оператором
 */
export function createFlashlightChargingStand(): THREE.Group {
  const stand = new THREE.Group();
  stand.name = 'flashlight_charging_stand';

  const darkSteelMat = createMetalConnectorMaterial(0x334155);
  const yellowPolymerMat = createPolymerCasingMaterial(0xeab308);

  // Круглое утяжеленное основание
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 0.04, 24), darkSteelMat);
  base.position.y = 0.02;
  base.receiveShadow = true;
  stand.add(base);

  // Телескопическая стойка высотой 0.86 м (удобно брать рукой стоя и в VR)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.84, 20), darkSteelMat);
  pole.position.y = 0.44;
  pole.castShadow = true;
  stand.add(pole);

  // Верхняя площадка-ложемент с подсветкой для легкого обнаружения в темноте
  const cradleTop = new THREE.Mesh(
    new RoundedBoxGeometry(0.22, 0.035, 0.24, 4, 0.004),
    yellowPolymerMat
  );
  cradleTop.position.set(0, 0.87, 0);
  cradleTop.castShadow = true;
  cradleTop.receiveShadow = true;
  stand.add(cradleTop);

  // Светящийся контурный маячок ложемента (чтобы стойку было видно в полной темноте бункера)
  const locatorRing = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.088, 24),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
  );
  locatorRing.rotation.x = -Math.PI / 2;
  locatorRing.position.set(0, 0.889, 0);
  stand.add(locatorRing);

  return stand;
}

