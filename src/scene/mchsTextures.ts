/**
 * ALARA-Planner Pro VR — Генератор процедурных Canvas-текстур МЧС России и объектов АЭС
 * (Все текстуры создаются в памяти браузера/Electron без внешних URL и используют THREE.SRGBColorSpace)
 */

import * as THREE from 'three';

let cachedMchsChevronTex: THREE.CanvasTexture | null = null;
let cachedMchsBackPatchTex: THREE.CanvasTexture | null = null;
let cachedBopReflectiveTex: THREE.CanvasTexture | null = null;
let cachedEvacSignTex: THREE.CanvasTexture | null = null;

/**
 * Процедурный нарукавный шеврон МЧС России (Белая звезда надежды + оранжевый треугольник + «МЧС РОССИИ»)
 */
export function createMchsChevronTexture(): THREE.CanvasTexture {
  if (cachedMchsChevronTex) return cachedMchsChevronTex;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 320);

  // Щитовидный фон шеврона
  ctx.fillStyle = '#0f2557';
  ctx.beginPath();
  ctx.moveTo(28, 22);
  ctx.lineTo(228, 22);
  ctx.lineTo(228, 196);
  ctx.quadraticCurveTo(228, 272, 128, 304);
  ctx.quadraticCurveTo(28, 272, 28, 196);
  ctx.closePath();
  ctx.fill();

  // Двойная оранжево-золотая окантовка
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 10;
  ctx.stroke();

  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Верхняя дуговая плашка
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('МЧС РОССИИ', 128, 66);

  // Звезда Надежды (8-конечная белая звезда + синий круг + оранжевый треугольник)
  const cx = 128;
  const cy = 162;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -68);
    ctx.lineTo(15, -18);
    ctx.lineTo(0, 0);
    ctx.lineTo(-15, -18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Синий внутренний круг
  ctx.fillStyle = '#1d4ed8';
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Оранжевый равносторонний треугольник гражданской обороны
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 23);
  ctx.lineTo(cx + 21, cy + 15);
  ctx.lineTo(cx - 21, cy + 15);
  ctx.closePath();
  ctx.fill();

  // Нижняя надпись
  ctx.fillStyle = '#fde047';
  ctx.font = 'bold 18px monospace';
  ctx.fillText('АЭС • РХБЗ', 128, 258);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cachedMchsChevronTex = tex;
  return tex;
}

/**
 * Наспинная светоотражающая нашивка «МЧС РОССИИ» для БОП и химзащиты
 */
export function createMchsBackPatchTexture(): THREE.CanvasTexture {
  if (cachedMchsBackPatchTex) return cachedMchsBackPatchTex;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 512, 160);

  // Световозвращающие лимонные канты сверху и снизу
  ctx.fillStyle = '#bef264';
  ctx.fillRect(0, 0, 512, 18);
  ctx.fillRect(0, 142, 512, 18);

  ctx.fillStyle = '#f97316';
  ctx.fillRect(10, 26, 492, 108);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(16, 32, 480, 96);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 54px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('МЧС РОССИИ', 256, 82);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedMchsBackPatchTex = tex;
  return tex;
}

/**
 * Текстура сигнальной светоотражающей ленты БОП (лимонно-серебристая)
 */
export function createBopReflectiveStripeTexture(): THREE.CanvasTexture {
  if (cachedBopReflectiveTex) return cachedBopReflectiveTex;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#bef264';
  ctx.fillRect(0, 0, 256, 64);

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 18, 256, 28);

  ctx.strokeStyle = '#65a30d';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 2, 256, 60);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  cachedBopReflectiveTex = tex;
  return tex;
}

/**
 * Указатель эвакуационного коридора АЭС «ВЫХОД • ЭВАКУАЦИЯ МЧС»
 */
export function createEvacCorridorSignTexture(label = 'ВЫХОД / ЭВАКУАЦИЯ'): THREE.CanvasTexture {
  if (cachedEvacSignTex && label === 'ВЫХОД / ЭВАКУАЦИЯ') return cachedEvacSignTex;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#064e3b';
  ctx.fillRect(0, 0, 512, 192);

  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 496, 176);

  ctx.fillStyle = '#ecfdf5';
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, 256, 88);

  ctx.fillStyle = '#6ee7b7';
  ctx.font = 'bold 24px monospace';
  ctx.fillText('ЧИСТАЯ ЗОНА • САНПРОПУСКНИК', 256, 144);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (label === 'ВЫХОД / ЭВАКУАЦИЯ') {
    cachedEvacSignTex = tex;
  }
  return tex;
}

/**
 * Процедурный шильдик промышленного оборудования / шкафа / панели АЭС
 */
export function createEquipmentLabelTexture(
  title: string,
  subtitle: string,
  bgHex = '#0f172a',
  accentHex = '#f59e0b'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 192);

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 180);

  ctx.fillStyle = accentHex;
  ctx.font = 'bold 38px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 84);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 24px monospace';
  ctx.fillText(subtitle, 256, 140);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
