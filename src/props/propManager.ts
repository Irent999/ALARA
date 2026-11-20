/**
 * propManager.ts — менеджер мелких предметов (пропсов).
 *
 * Идея оптимизации:
 *   • Предметы ОДНОГО типа (розетки, папки, кружки) → один InstancedMesh = 1 draw-call на тип,
 *     независимо от числа экземпляров. 500 папок стоят столько же, сколько одна.
 *   • Составные GLB (несколько мешей/материалов) → клоны Group: геометрия и материалы общие
 *     (память не дублируется), но draw-call'ы по числу мешей.
 *   • Расстановка берётся из JSON — новые предметы добавляются без пересборки.
 *
 * Выбор предмета: raycaster.intersectObjects(getInteractiveObjects(), true) → resolveHit(hit).
 * Для InstancedMesh Three.js сам возвращает hit.instanceId — по нему находим конкретный предмет.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MaterialPresets } from '../render/qualityRenderer';
import type {
  CatalogFile,
  LayoutFile,
  PropCatalogEntry,
  PropMaterialDef,
  PropPlacement,
  PropScatter,
  RoomLayout
} from './propTypes';

export interface PlacedProp {
  uid: string;
  roomId: string;
  placement: PropPlacement;
  def: PropCatalogEntry;
  /** InstancedMesh (общий для типа) или Group (личный клон) */
  object: THREE.Object3D;
  /** Номер экземпляра в InstancedMesh; null для клонов */
  instanceId: number | null;
  /** Матрица в системе координат корня комнаты */
  localMatrix: THREE.Matrix4;
}

/** Описание одной «детали» отрисовки — нужно подсветке и режиму осмотра */
export interface RenderPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrixWorld: THREE.Matrix4;
}

type PropSource =
  | { kind: 'mesh'; geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }
  | { kind: 'group'; template: THREE.Object3D };

interface RoomState {
  root: THREE.Group;
  placed: PlacedProp[];
  interactive: THREE.Object3D[];
  instanced: THREE.InstancedMesh[];
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const DEG = Math.PI / 180;

/** Детерминированный ГСЧ: одинаковый seed → одинаковая россыпь при каждом запуске */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PropManager {
  private readonly catalog = new Map<string, PropCatalogEntry>();
  private layout: LayoutFile | null = null;
  private readonly sources = new Map<string, Promise<PropSource>>();
  private readonly rooms = new Map<string, RoomState>();
  private uidCounter = 0;
  /** Смещение начала координат комнаты (стартовая точка игрока): координаты в layout.json считаются от неё */
  private readonly roomOffsets = new Map<string, [number, number, number]>();
  /** Очередь построения: быстрые повторные вызовы не накладываются друг на друга */
  private buildQueue: Promise<void> = Promise.resolve();

  /**
   * @param gltf  загрузчик GLB. Для сжатых моделей (Draco/Meshopt/KTX2) передайте createGLTFLoader(renderer)
   *              из render/assetLoaders.ts; по умолчанию — обычный GLTFLoader.
   */
  constructor(
    private readonly defaultParent: THREE.Object3D,
    private readonly gltf: GLTFLoader = new GLTFLoader()
  ) {}

  // ------------------------------------------------------------ загрузка JSON
  public async loadCatalog(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`PropManager: не удалось загрузить каталог ${url} (${res.status})`);
    this.setCatalog((await res.json()) as CatalogFile);
  }

  public async loadLayout(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`PropManager: не удалось загрузить раскладку ${url} (${res.status})`);
    this.layout = (await res.json()) as LayoutFile;
  }

  public setCatalog(file: CatalogFile): void {
    this.catalog.clear();
    for (const entry of file.props) this.catalog.set(entry.id, entry);
    this.sources.clear();
  }

  public setLayout(file: LayoutFile): void {
    this.layout = file;
  }

  // ------------------------------------------------------------ построение комнаты
  /**
   * Строит предметы комнаты. По умолчанию предметы ВСЕХ ДРУГИХ комнат удаляются
   * (в каждый момент активен один сценарий). keepOthers = true — для миров из нескольких комнат сразу.
   */
  public buildRoom(roomId: string, parent: THREE.Object3D = this.defaultParent, keepOthers = false): Promise<void> {
    const run = (): Promise<void> => this.buildRoomInternal(roomId, parent, keepOthers);
    this.buildQueue = this.buildQueue.then(run, run);
    return this.buildQueue;
  }

  private async buildRoomInternal(roomId: string, parent: THREE.Object3D, keepOthers: boolean): Promise<void> {
    if (!this.layout) throw new Error('PropManager: сначала loadLayout()');
    const room = this.layout.rooms[roomId];
    if (!room) {
      console.warn(`PropManager: комната "${roomId}" не найдена в layout.json`);
      return;
    }
    this.disposeRoom(roomId);
    if (!keepOthers) {
      for (const other of [...this.rooms.keys()]) if (other !== roomId) this.disposeRoom(other);
    }

    const root = new THREE.Group();
    root.name = `props:${roomId}`;
    const o = room.origin ?? [0, 0, 0];
    const off = this.roomOffsets.get(roomId) ?? [0, 0, 0];
    root.position.set(o[0] + off[0], o[1] + off[1], o[2] + off[2]);
    parent.add(root);

    const state: RoomState = { root, placed: [], interactive: [], instanced: [] };
    this.rooms.set(roomId, state);

    // Явные предметы + россыпь → единый список, сгруппированный по типу
    const k = room.spreadXZ ?? 1;
    const spread = (v: [number, number, number]): [number, number, number] => [v[0] * k, v[1], v[2] * k];
    const all: PropPlacement[] = [
      ...room.props.map(p => (k === 1 ? p : { ...p, position: spread(p.position) })),
      ...this.expandScatter(room).map(p => (k === 1 ? p : { ...p, position: spread(p.position) }))
    ];
    const byType = new Map<string, PropPlacement[]>();
    for (const p of all) {
      const list = byType.get(p.type);
      if (list) list.push(p);
      else byType.set(p.type, [p]);
    }

    for (const [typeId, list] of byType) {
      const def = this.catalog.get(typeId);
      if (!def) {
        console.warn(`PropManager: тип "${typeId}" отсутствует в каталоге`);
        continue;
      }
      const source = await this.getSource(def);
      const useInstancing = source.kind === 'mesh' && (def.instanced ?? list.length >= 4);

      if (useInstancing && source.kind === 'mesh') this.buildInstanced(state, roomId, def, source, list);
      else this.buildClones(state, roomId, def, source, list);
    }
  }

  private buildInstanced(
    state: RoomState,
    roomId: string,
    def: PropCatalogEntry,
    source: Extract<PropSource, { kind: 'mesh' }>,
    list: PropPlacement[]
  ): void {
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, list.length);
    mesh.name = `inst:${def.id}`;
    mesh.castShadow = def.castShadow ?? true;
    mesh.receiveShadow = def.receiveShadow ?? true;

    const instances: PlacedProp[] = [];
    list.forEach((placement, i) => {
      const m = this.composeMatrix(placement);
      mesh.setMatrixAt(i, m);
      instances.push({
        uid: `p${++this.uidCounter}`,
        roomId,
        placement,
        def,
        object: mesh,
        instanceId: i,
        localMatrix: m
      });
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Без этого frustum culling работает по геометрии одного экземпляра и предметы «пропадают»
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    mesh.userData.instances = instances;

    state.root.add(mesh);
    state.instanced.push(mesh);
    state.placed.push(...instances);
    if (def.interactive !== false) state.interactive.push(mesh);
  }

  private buildClones(
    state: RoomState,
    roomId: string,
    def: PropCatalogEntry,
    source: PropSource,
    list: PropPlacement[]
  ): void {
    for (const placement of list) {
      // Геометрия и материалы общие — клонируется только иерархия узлов
      const obj: THREE.Object3D =
        source.kind === 'mesh' ? new THREE.Mesh(source.geometry, source.material) : source.template.clone(true);
      obj.name = `prop:${def.id}`;

      const m = this.composeMatrix(placement);
      m.decompose(obj.position, obj.quaternion, obj.scale);

      obj.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = def.castShadow ?? true;
          mesh.receiveShadow = def.receiveShadow ?? true;
        }
      });

      const placed: PlacedProp = {
        uid: `p${++this.uidCounter}`,
        roomId,
        placement,
        def,
        object: obj,
        instanceId: null,
        localMatrix: m
      };
      obj.userData.placed = placed;

      state.root.add(obj);
      state.placed.push(placed);
      if (def.interactive !== false) state.interactive.push(obj);
    }
  }

  private composeMatrix(p: PropPlacement): THREE.Matrix4 {
    const pos = new THREE.Vector3(...p.position);
    const rot = p.rotation ?? [0, 0, 0];
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
    const sc =
      typeof p.scale === 'number'
        ? new THREE.Vector3(p.scale, p.scale, p.scale)
        : p.scale
        ? new THREE.Vector3(...p.scale)
        : new THREE.Vector3(1, 1, 1);
    return new THREE.Matrix4().compose(pos, quat, sc);
  }

  private expandScatter(room: RoomLayout): PropPlacement[] {
    const out: PropPlacement[] = [];
    for (const s of room.scatter ?? []) out.push(...this.scatterOne(s));
    return out;
  }

  private scatterOne(s: PropScatter): PropPlacement[] {
    const rnd = mulberry32(s.seed ?? 1);
    const yaw = s.yawRandomDeg ?? 360;
    const jitter = s.scaleJitter ?? 0;
    const res: PropPlacement[] = [];
    for (let i = 0; i < s.count; i++) {
      const k = 1 + (rnd() * 2 - 1) * jitter;
      res.push({
        type: s.type,
        position: [
          s.center[0] + (rnd() - 0.5) * s.area[0],
          s.center[1],
          s.center[2] + (rnd() - 0.5) * s.area[1]
        ],
        rotation: [0, rnd() * yaw, 0],
        scale: k
      });
    }
    return res;
  }

  // ------------------------------------------------------------ источники геометрии
  private getSource(def: PropCatalogEntry): Promise<PropSource> {
    let p = this.sources.get(def.id);
    if (!p) {
      p = def.model ? this.loadModelSource(def) : Promise.resolve(this.buildPrimitiveSource(def));
      this.sources.set(def.id, p);
    }
    return p;
  }

  private async loadModelSource(def: PropCatalogEntry): Promise<PropSource> {
    let gltf;
    try {
      gltf = await this.gltf.loadAsync(def.model as string);
    } catch (err) {
      // Модель не нашли / не открылась — показываем примитив-заглушку, а не роняем всю комнату
      console.warn(`PropManager: не удалось загрузить ${def.model}, использую primitive`, err);
      return this.buildPrimitiveSource(def);
    }
    gltf.scene.updateMatrixWorld(true);

    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse(o => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });

    // Один меш → можно инстансить: «запекаем» его трансформ в геометрию
    if (meshes.length === 1) {
      const geo = meshes[0].geometry.clone().applyMatrix4(meshes[0].matrixWorld);
      return { kind: 'mesh', geometry: geo, material: meshes[0].material };
    }
    return { kind: 'group', template: gltf.scene };
  }

  private buildPrimitiveSource(def: PropCatalogEntry): PropSource {
    const prim = def.primitive ?? { shape: 'box', size: [0.1, 0.1, 0.1] };
    const s = prim.size;
    let geo: THREE.BufferGeometry;
    switch (prim.shape) {
      case 'cylinder':
        geo = new THREE.CylinderGeometry(s[0] ?? 0.04, s[1] ?? s[0] ?? 0.04, s[2] ?? 0.1, s[3] ?? 24);
        break;
      case 'sphere':
        geo = new THREE.SphereGeometry(s[0] ?? 0.05, 24, 16);
        break;
      case 'roundedBox':
        geo = new RoundedBoxGeometry(s[0] ?? 0.1, s[1] ?? 0.1, s[2] ?? 0.1, 3, s[3] ?? 0.01);
        break;
      default:
        geo = new THREE.BoxGeometry(s[0] ?? 0.1, s[1] ?? 0.1, s[2] ?? 0.1);
    }
    // Точка опоры — основание предмета: position.y в JSON = высота поверхности (стола, полки)
    geo.computeBoundingBox();
    if (geo.boundingBox) geo.translate(0, -geo.boundingBox.min.y, 0);

    return { kind: 'mesh', geometry: geo, material: this.buildMaterial(def.material) };
  }

  private buildMaterial(def?: PropMaterialDef): THREE.Material {
    const preset = def?.preset ?? 'plastic';
    const mat = MaterialPresets[preset]() as THREE.MeshStandardMaterial;
    if (def?.color) mat.color.set(def.color);
    if (def?.roughness !== undefined) mat.roughness = def.roughness;
    if (def?.metalness !== undefined) mat.metalness = def.metalness;
    if (def?.emissive) {
      mat.emissive.set(def.emissive);
      mat.emissiveIntensity = def.emissiveIntensity ?? 1;
    }
    return mat;
  }

  // ------------------------------------------------------------ доступ для взаимодействия
  /** Объекты для raycaster.intersectObjects(…, true) */
  public getInteractiveObjects(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const r of this.rooms.values()) out.push(...r.interactive);
    return out;
  }

  /** Результат пересечения → конкретный предмет */
  public resolveHit(hit: THREE.Intersection): PlacedProp | null {
    const inst = hit.object as THREE.InstancedMesh;
    if (inst.isInstancedMesh && hit.instanceId !== undefined) {
      const arr = inst.userData.instances as PlacedProp[] | undefined;
      return arr?.[hit.instanceId] ?? null;
    }
    let o: THREE.Object3D | null = hit.object;
    while (o) {
      if (o.userData.placed) return o.userData.placed as PlacedProp;
      o = o.parent;
    }
    return null;
  }

  /** Детали отрисовки предмета в мировых координатах (для контура и осмотра) */
  public getRenderParts(placed: PlacedProp): RenderPart[] {
    const parts: RenderPart[] = [];
    const inst = placed.object as THREE.InstancedMesh;

    if (inst.isInstancedMesh && placed.instanceId !== null) {
      inst.updateWorldMatrix(true, false);
      const m = new THREE.Matrix4();
      inst.getMatrixAt(placed.instanceId, m);
      parts.push({
        geometry: inst.geometry,
        material: inst.material,
        matrixWorld: new THREE.Matrix4().multiplyMatrices(inst.matrixWorld, m)
      });
      return parts;
    }

    placed.object.updateWorldMatrix(true, true);
    placed.object.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        parts.push({ geometry: mesh.geometry, material: mesh.material, matrixWorld: mesh.matrixWorld.clone() });
      }
    });
    return parts;
  }

  /** Спрятать/показать предмет (когда он «в руке»). Для инстанса — нулевой масштаб. */
  public setHidden(placed: PlacedProp, hidden: boolean): void {
    const inst = placed.object as THREE.InstancedMesh;
    if (inst.isInstancedMesh && placed.instanceId !== null) {
      inst.setMatrixAt(placed.instanceId, hidden ? ZERO_MATRIX : placed.localMatrix);
      inst.instanceMatrix.needsUpdate = true;
    } else {
      placed.object.visible = !hidden;
    }
  }

  // ------------------------------------------------------------ редактирование раскладки (для placementPicker)
  public getCatalogIds(): string[] {
    return [...this.catalog.keys()];
  }

  public getCatalogEntry(id: string): PropCatalogEntry | undefined {
    return this.catalog.get(id);
  }

  /** Задать начало координат комнаты (например, стартовую точку игрока сценария). Вызывать до buildRoom(). */
  public setRoomOffset(roomId: string, x: number, y: number, z: number): void {
    this.roomOffsets.set(roomId, [x, y, z]);
  }

  /** Мировая точка → координаты в JSON комнаты (с учётом origin, смещения и spreadXZ) */
  public worldToRoomLocal(roomId: string, world: THREE.Vector3): [number, number, number] {
    const room = this.layout?.rooms[roomId];
    const base = room?.origin ?? [0, 0, 0];
    const off = this.roomOffsets.get(roomId) ?? [0, 0, 0];
    const o: [number, number, number] = [base[0] + off[0], base[1] + off[1], base[2] + off[2]];
    const k = room?.spreadXZ ?? 1;
    const r = (n: number): number => Math.round(n * 100) / 100;
    return [r((world.x - o[0]) / k), r(world.y - o[1]), r((world.z - o[2]) / k)];
  }

  public appendPlacement(roomId: string, placement: PropPlacement): Promise<void> {
    if (!this.layout) return Promise.resolve();
    const room = (this.layout.rooms[roomId] ??= { props: [] });
    room.props.push(placement);
    return this.buildRoom(roomId);
  }

  public removeLastPlacement(roomId: string): Promise<void> {
    const room = this.layout?.rooms[roomId];
    if (!room || room.props.length === 0) return Promise.resolve();
    room.props.pop();
    return this.buildRoom(roomId);
  }

  /** Текст блока "props": [...] для вставки в layout.json */
  public exportRoomProps(roomId: string): string {
    const room = this.layout?.rooms[roomId];
    if (!room) return '[]';
    return `[\n${room.props.map(p => `  ${JSON.stringify(p)}`).join(',\n')}\n]`;
  }

  // ------------------------------------------------------------ очистка
  public disposeRoom(roomId: string): void {
    const state = this.rooms.get(roomId);
    if (!state) return;
    state.root.removeFromParent();
    for (const inst of state.instanced) inst.dispose(); // освобождает буфер матриц; геометрия/материал общие
    this.rooms.delete(roomId);
  }

  public dispose(): void {
    for (const id of [...this.rooms.keys()]) this.disposeRoom(id);
    this.sources.clear();
  }
}
