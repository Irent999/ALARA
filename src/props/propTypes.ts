/**
 * Типы JSON-файлов: каталог предметов (catalog.json) и расстановка по комнатам (layout.json).
 * Добавить новый предмет = дописать запись в JSON. Пересборка кода не нужна.
 */

export type Vec3 = [number, number, number];

export type MaterialPresetName =
  | 'chrome'
  | 'stainlessRailing'
  | 'brushedSteel'
  | 'matteWall'
  | 'matteFloor'
  | 'varnishedWood'
  | 'plastic'
  | 'rubber'
  | 'paper'
  | 'glass';

export interface PropMaterialDef {
  preset?: MaterialPresetName;
  /** Цвет "#rrggbb" — переопределяет цвет пресета */
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export interface PropPrimitiveDef {
  shape: 'box' | 'roundedBox' | 'cylinder' | 'sphere';
  /**
   * box / roundedBox: [ширина, высота, глубина, радиус_скругления?]
   * cylinder: [радиус_верха, радиус_низа, высота, сегментов?]
   * sphere: [радиус]
   * Размеры — в метрах.
   */
  size: number[];
}

export interface PropCatalogEntry {
  id: string;
  /** Название для подсказки */
  name: string;
  description?: string;
  /** Текст-призыв; по умолчанию «осмотреть» */
  hint?: string;

  /** Источник геометрии: GLB-модель ИЛИ примитив (заглушка, пока нет модели) */
  model?: string;
  primitive?: PropPrimitiveDef;
  material?: PropMaterialDef;

  /**
   * true  — все экземпляры типа рисуются ОДНИМ draw-call (InstancedMesh). Для розеток, папок, кружек.
   * false — каждый экземпляр отдельный Mesh/Group (нужно для составных GLB из нескольких мешей).
   * не задано — авто: instanced, если экземпляров ≥ 4 и модель состоит из одного меша.
   */
  instanced?: boolean;
  /** Реагирует ли на наведение/выбор (по умолчанию true) */
  interactive?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;

  inspect?: {
    /** Размер предмета в руке/перед камерой, метры (по наибольшему габариту). По умолчанию 0.18 */
    size?: number;
    /** Расстояние от камеры в десктоп-режиме, метры. По умолчанию 0.45 */
    distance?: number;
  };
}

export interface PropPlacement {
  /** id из каталога */
  type: string;
  /** Позиция относительно origin комнаты, метры */
  position: Vec3;
  /** Эйлеровы углы в ГРАДУСАХ (порядок XYZ) */
  rotation?: Vec3;
  /** Число (равномерно) или [x,y,z] */
  scale?: number | Vec3;
  /** Переопределения для подсказки конкретного экземпляра */
  name?: string;
  description?: string;
}

/** Процедурная россыпь: N одинаковых предметов в прямоугольной области (для массовки). */
export interface PropScatter {
  type: string;
  count: number;
  /** Центр области и её размеры по X/Z (метры); Y — высота поверхности */
  center: Vec3;
  area: [number, number];
  seed?: number;
  /** Случайный поворот вокруг вертикали (градусы). 360 = любой. */
  yawRandomDeg?: number;
  scaleJitter?: number;
}

export interface RoomLayout {
  /** Смещение всей комнаты в мировых координатах (если модель комнаты сдвинута) */
  origin?: Vec3;
  /**
   * Множитель разноса предметов по X и Z (1 = как записано). Если комната уже, чем я предположил,
   * поставьте 0.8 — все предметы «подтянутся» к центру; если шире — 1.2.
   */
  spreadXZ?: number;
  props: PropPlacement[];
  scatter?: PropScatter[];
}

export interface CatalogFile {
  version: 1;
  props: PropCatalogEntry[];
}

export interface LayoutFile {
  version: 1;
  rooms: Record<string, RoomLayout>;
}
