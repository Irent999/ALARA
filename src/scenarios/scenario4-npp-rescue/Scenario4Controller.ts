/**
 * Главный контроллер Сценария №4: Комплексный VR/Desktop тренажёр МЧС на базе .glb-модели комплекса АЭС
 * - Асинхронная загрузка .glb через GLTFLoader + DRACOLoader (локальные декодеры ./draco/)
 * - Встроенный 1:1 м процедурный макет комплекса АЭС (градирни, реакторный зал, машзал, коридоры) при отсутствии .glb
 * - Автообнаружение Empty-маркеров (SPAWN_PLAYER, ENTRANCE_*, EXIT_*, EVAC_POINT_*, FIRE_ZONE_*, NPC_GROUP_*, EXTINGUISHER_POINT_*)
 * - Изоляция ресурсов и полная очистка GPU (geometries / materials / textures / loaders / audio) при выходе из сценария
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import {
  DiscoveredMarkers,
  SCENARIO4_DEFAULT_CONFIG,
  SCENARIO4_STEP_ORDER,
  Scenario4Config,
  Scenario4DebriefSummary,
  Scenario4HudSnapshot,
  WallColliderBox
} from './config';
import { FireAndExtinguisherManager } from './fireAndExtinguisher';
import { Scenario4EvacuationManager } from './evacuationManager';
import { Scenario4StateMachine } from './stateMachine';

export interface Scenario4ControllerOptions {
  envGroup: THREE.Group;
  camera: THREE.Camera;
  playerGroup: THREE.Group;
  onToast: (type: 'info' | 'success' | 'warning' | 'danger', title: string, message: string) => void;
  onPlayerSpawnReady?: (spawnPos: THREE.Vector3) => void;
}

export class Scenario4Controller {
  private readonly envGroup: THREE.Group;
  private readonly camera: THREE.Camera;
  private readonly playerGroup: THREE.Group;
  private readonly onToast: Scenario4ControllerOptions['onToast'];
  private readonly onPlayerSpawnReady?: Scenario4ControllerOptions['onPlayerSpawnReady'];
  private readonly config: Scenario4Config = SCENARIO4_DEFAULT_CONFIG;

  private readonly rootGroup = new THREE.Group();
  private readonly modelContainer = new THREE.Group();
  private dracoLoader: DRACOLoader | null = null;
  private gltfLoader: GLTFLoader | null = null;

  private fireMgr: FireAndExtinguisherManager | null = null;
  private evacMgr: Scenario4EvacuationManager | null = null;
  private readonly fsm = new Scenario4StateMachine();

  private wallColliders: WallColliderBox[] = [];
  private isDisposed = false;

  // Состояние загрузки .glb
  private isLoadingGlb = true;
  private loadProgressPct = 0;
  private loadStatusRu = 'Загрузка 3D-комплекса АЭС (.glb)...';
  private usingProceduralFallback = false;

  // Таймеры и телеметрия
  private elapsedSec = 0;
  private peakHeatLoad01 = 0;
  private currentHeatLoad01 = 0;
  private currentSmoke01 = 0;
  private cumulativeDoseMsv = 0;
  private targetPromptRu: string | null = null;
  private debrief: Scenario4DebriefSummary | null = null;

  private lastSprayWarnTime = -10;
  private lastPinWarnTime = -10;
  private lastExitWarnTime = -10;
  private lastStepNum = 1;

  // Комфорт-виньетка при VR-телепорте (крепится к camera, удаляется в dispose)
  private vrComfortMesh: THREE.Mesh | null = null;
  private vrComfortFade01 = 0;

  // Координаты ключевых зон (обновляются из маркеров .glb или дефолта)
  private readonly spawnPos = new THREE.Vector3();
  private readonly entrancePos = new THREE.Vector3();
  private readonly assemblyPos = new THREE.Vector3();
  private readonly primaryPostPos = new THREE.Vector3();
  private readonly sparePostPos = new THREE.Vector3();

  // Scratch векторы (Zero-Allocation)
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchVecC = new THREE.Vector3();

  constructor(options: Scenario4ControllerOptions) {
    this.envGroup = options.envGroup;
    this.camera = options.camera;
    this.playerGroup = options.playerGroup;
    this.onToast = options.onToast;
    this.onPlayerSpawnReady = options.onPlayerSpawnReady;

    this.rootGroup.name = 'scenario4_npp_complex_root';
    this.modelContainer.name = 'scenario4_glb_or_procedural_world';
    this.rootGroup.add(this.modelContainer);
    this.envGroup.add(this.rootGroup);

    this.setupVrComfortVignette();
    this.initLoader();
    void this.loadComplexGlb(this.config.glbUrl);
  }

  private initLoader(): void {
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath(this.config.dracoDecoderPath);
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
  }

  private setupVrComfortVignette(): void {
    const geo = new THREE.RingGeometry(0.28, 0.95, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0,
      depthTest: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0, -0.35);
    mesh.renderOrder = 998;
    mesh.visible = false;
    mesh.raycast = () => {};
    this.camera.add(mesh);
    this.vrComfortMesh = mesh;
  }

  public notifyTeleportFade(): void {
    this.vrComfortFade01 = 1.0;
  }

  public async loadCustomGlbFile(file: File): Promise<void> {
    if (this.isDisposed) return;
    const blobUrl = URL.createObjectURL(file);
    try {
      await this.loadComplexGlb(blobUrl, true);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  private async loadComplexGlb(url: string, isCustomUpload = false): Promise<void> {
    if (this.isDisposed || !this.gltfLoader) return;

    this.clearCurrentWorldSystems();
    this.isLoadingGlb = true;
    this.loadProgressPct = 5;
    this.loadStatusRu = isCustomUpload
      ? 'Импорт пользовательской 3D-модели АЭС (.glb)...'
      : 'Загрузка 3D-модели комплекса АЭС (.glb)...';

    try {
      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        this.gltfLoader!.load(
          url,
          loaded => resolve(loaded),
          evt => {
            if (evt.total > 0) {
              this.loadProgressPct = Math.min(95, Math.round((evt.loaded / evt.total) * 100));
            } else {
              this.loadProgressPct = Math.min(85, this.loadProgressPct + 8);
            }
          },
          err => reject(err)
        );
      });

      if (this.isDisposed) {
        this.disposeObjectTree(gltf.scene);
        return;
      }

      this.usingProceduralFallback = false;
      this.mountLoadedScene(gltf.scene, false);
      this.onToast(
        'success',
        'МОДЕЛЬ КОМПЛЕКСА АЭС ЗАГРУЖЕНА',
        '3D-объекты и маркеры эвакуации АЭС инициализированы в масштабе 1:1 м.'
      );
    } catch {
      if (this.isDisposed) return;
      // Грациозный fallback на встроенный детализированный 1:1м комплекс АЭС
      this.usingProceduralFallback = true;
      const proceduralComplex = this.buildProceduralNppComplex();
      this.mountLoadedScene(proceduralComplex, true);
      if (isCustomUpload) {
        this.onToast(
          'warning',
          'НЕ УДАЛОСЬ ПРОЧИТАТЬ .GLB',
          'Задействован штатный 3D-макет комплекса АЭС (градирни, энергоблок, цеха).'
        );
      }
    }
  }

  private mountLoadedScene(worldRoot: THREE.Group, isProcedural: boolean): void {
    // 1. Нормализация масштаба (1 unit = 1 meter)
    const scale = this.config.unitScale;
    worldRoot.scale.setScalar(scale);
    worldRoot.updateMatrixWorld(true);

    // Оптимизация теней и текстур
    worldRoot.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => {
          const std = m as THREE.MeshStandardMaterial | undefined;
          if (std?.map) {
            std.map.colorSpace = THREE.SRGBColorSpace;
          }
        });
      }
    });

    this.modelContainer.add(worldRoot);

    // 2. Автообнаружение Empty-маркеров и коллайдеров стен
    const markers = this.discoverMarkers(worldRoot);
    this.wallColliders = isProcedural
      ? [...this.config.wallColliders]
      : this.extractWallColliders(worldRoot);

    this.spawnPos.copy(markers.spawnPlayer);
    this.entrancePos.copy(
      markers.entrances[0]?.pos ??
        new THREE.Vector3(this.config.entrancePos[0], this.config.entrancePos[1], this.config.entrancePos[2])
    );
    this.assemblyPos.set(this.config.assemblyPos[0], this.config.assemblyPos[1], this.config.assemblyPos[2]);

    const primaryMarker = markers.extinguisherPoints.find(p => p.name.toUpperCase().includes('1')) ?? markers.extinguisherPoints[0];
    const spareMarker = markers.extinguisherPoints.find(p => p.name.toUpperCase().includes('SPARE') || p.name.toUpperCase().includes('2')) ?? markers.extinguisherPoints[1];

    this.primaryPostPos.copy(
      primaryMarker?.pos ??
        new THREE.Vector3(
          this.config.primaryExtinguisherPos[0],
          this.config.primaryExtinguisherPos[1],
          this.config.primaryExtinguisherPos[2]
        )
    );
    this.sparePostPos.copy(
      spareMarker?.pos ??
        new THREE.Vector3(
          this.config.spareExtinguisherPos[0],
          this.config.spareExtinguisherPos[1],
          this.config.spareExtinguisherPos[2]
        )
    );

    const exitList =
      markers.exits.length > 0
        ? markers.exits
        : this.config.exitPositions.map(e => ({
            name: e.id,
            pos: new THREE.Vector3(e.pos[0], e.pos[1], e.pos[2])
          }));

    // 3. Подсистемы пожара/огнетушителей и эвакуации
    this.fireMgr = new FireAndExtinguisherManager(
      this.config.fireZones,
      markers.fireZones,
      this.primaryPostPos,
      this.sparePostPos
    );
    this.rootGroup.add(this.fireMgr.rootGroup);

    this.evacMgr = new Scenario4EvacuationManager(
      this.config.npcGroups,
      markers.npcGroups,
      this.entrancePos,
      exitList,
      this.assemblyPos
    );
    this.rootGroup.add(this.evacMgr.rootGroup);

    // 4. Сброс состояния и перемещение оператора на SPAWN_PLAYER
    this.fsm.reset();
    this.elapsedSec = 0;
    this.peakHeatLoad01 = 0;
    this.debrief = null;
    this.lastStepNum = 1;
    this.isLoadingGlb = false;
    this.loadProgressPct = 100;

    this.onPlayerSpawnReady?.(this.spawnPos);
  }

  private discoverMarkers(root: THREE.Object3D): DiscoveredMarkers {
    const res: DiscoveredMarkers = {
      spawnPlayer: new THREE.Vector3(this.config.spawnPos[0], this.config.spawnPos[1], this.config.spawnPos[2]),
      entrances: [],
      exits: [],
      evacPoints: [],
      fireZones: [],
      npcGroups: [],
      extinguisherPoints: []
    };

    const wp = new THREE.Vector3();
    root.traverse(obj => {
      const upper = obj.name.toUpperCase();
      if (!upper) return;

      if (upper.startsWith('SPAWN_PLAYER')) {
        obj.getWorldPosition(wp);
        res.spawnPlayer.copy(wp);
      } else if (upper.startsWith('ENTRANCE_')) {
        obj.getWorldPosition(wp);
        res.entrances.push({ name: obj.name, pos: wp.clone() });
      } else if (upper.startsWith('EXIT_')) {
        obj.getWorldPosition(wp);
        res.exits.push({ name: obj.name, pos: wp.clone() });
      } else if (upper.startsWith('EVAC_POINT_')) {
        obj.getWorldPosition(wp);
        res.evacPoints.push({ name: obj.name, pos: wp.clone() });
      } else if (upper.startsWith('FIRE_ZONE_')) {
        obj.getWorldPosition(wp);
        res.fireZones.push({ name: obj.name, pos: wp.clone() });
      } else if (upper.startsWith('NPC_GROUP_')) {
        obj.getWorldPosition(wp);
        res.npcGroups.push({ name: obj.name, pos: wp.clone() });
      } else if (upper.startsWith('EXTINGUISHER_POINT_')) {
        obj.getWorldPosition(wp);
        res.extinguisherPoints.push({ name: obj.name, pos: wp.clone() });
      }
    });

    return res;
  }

  private extractWallColliders(root: THREE.Object3D): WallColliderBox[] {
    const boxes: WallColliderBox[] = [];
    const box3 = new THREE.Box3();
    root.traverse(obj => {
      const upper = obj.name.toUpperCase();
      if ((obj as THREE.Mesh).isMesh && (upper.includes('WALL') || upper.includes('COLLIDER'))) {
        box3.setFromObject(obj);
        if (!box3.isEmpty()) {
          boxes.push({
            minX: box3.min.x,
            maxX: box3.max.x,
            minY: box3.min.y,
            maxY: box3.max.y,
            minZ: box3.min.z,
            maxZ: box3.max.z
          });
        }
      }
    });
    return boxes.length > 0 ? boxes : [...this.config.wallColliders];
  }

  /**
   * Встроенный детализированный 3D-комплекс АЭС в масштабе 1:1 м (градирни, реактор, машзал, коридоры, маркеры)
   */
  private buildProceduralNppComplex(): THREE.Group {
    const complex = new THREE.Group();
    complex.name = 'procedural_npp_complex_1to1m';

    // 1. Внешняя площадка АЭС (90x90 м)
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.92, metalness: 0.05 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), groundMat);
    ground.name = 'scene_floor';
    ground.userData.isFloor = true;
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    complex.add(ground);

    // Асфальтовая дорога к главному входу
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 22),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.008, 22);
    complex.add(road);

    // 2. Градирни (2 гиперболоидные башни по 34 м высотой на заднем плане)
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.8 });
    const towerRimMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.25 });
    const towerGeo = new THREE.CylinderGeometry(5.5, 9.2, 34, 24, 1, false);
    [-26, 26].forEach(tx => {
      const tower = new THREE.Mesh(towerGeo, towerMat);
      tower.position.set(tx, 17, -26);
      complex.add(tower);

      const mist = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 5.4, 6, 18), towerRimMat);
      mist.position.set(tx, 36.5, -26);
      complex.add(mist);
    });

    // 3. Главный реакторный корпус (верхняя купольная надстройка над зоной энергоблока)
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.72, metalness: 0.08 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(28.4, 0.35, 26.4), concreteMat);
    roof.position.set(0, 4.95, -1);
    complex.add(roof);

    const reactorDrum = new THREE.Mesh(
      new THREE.CylinderGeometry(8.2, 8.2, 9.5, 24),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.65 })
    );
    reactorDrum.position.set(-4.5, 9.8, -5.0);
    complex.add(reactorDrum);

    const reactorDome = new THREE.Mesh(
      new THREE.SphereGeometry(8.2, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
      concreteMat
    );
    reactorDome.position.set(-4.5, 14.5, -5.0);
    complex.add(reactorDome);

    // 4. Внутренний эпоксидный пол здания (X: -14..14, Z: -14..12)
    const indoorFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 26),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.45, metalness: 0.12 })
    );
    indoorFloor.name = 'indoor_floor';
    indoorFloor.userData.isFloor = true;
    indoorFloor.rotation.x = -Math.PI / 2;
    indoorFloor.position.set(0, 0.012, -1);
    indoorFloor.receiveShadow = true;
    complex.add(indoorFloor);

    // 5. Стены и внутренние перегородки по коллайдерам
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.68, metalness: 0.08 });
    this.config.wallColliders.forEach((wc, idx) => {
      const w = wc.maxX - wc.minX;
      const h = wc.maxY - wc.minY;
      const d = wc.maxZ - wc.minZ;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      mesh.name = `BUILDING_WALL_${idx}`;
      mesh.position.set((wc.minX + wc.maxX) * 0.5, (wc.minY + wc.maxY) * 0.5, (wc.minZ + wc.maxZ) * 0.5);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      complex.add(mesh);
    });

    // 6. Промышленное оборудование в отсеках (кабельные лотки, шкафы РЗА, турбоагрегат)
    const cabMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.6 });
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.4, metalness: 0.7 });
    // Шкафы щитовой в западном отсеке
    for (let z = -8; z <= 0; z += 2.6) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.9), cabMat);
      cab.position.set(-12.2, 1.1, z);
      complex.add(cab);
    }
    // Маслостанция и трубопроводы в восточном машзале
    const turbine = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 6.5, 16), pipeMat);
    turbine.rotation.x = Math.PI / 2;
    turbine.position.set(10.5, 1.4, -3.5);
    complex.add(turbine);

    // Потолочные светильники внутри здания
    const indoorLights: Array<[number, number]> = [
      [0, 6],
      [-7.5, 2],
      [-8.5, -5],
      [7.5, 2],
      [8.5, -6]
    ];
    indoorLights.forEach(([lx, lz]) => {
      const pLight = new THREE.PointLight(0xf8fafc, 1.8, 16, 1.4);
      pLight.position.set(lx, 4.3, lz);
      complex.add(pLight);
    });

    // 7. Empty-маркеры иерархии (демонстрация полной совместимости со структурой .glb)
    const addMarker = (name: string, p: readonly [number, number, number]) => {
      const marker = new THREE.Object3D();
      marker.name = name;
      marker.position.set(p[0], p[1], p[2]);
      complex.add(marker);
    };
    addMarker('SPAWN_PLAYER', this.config.spawnPos);
    addMarker('ENTRANCE_MAIN', this.config.entrancePos);
    this.config.exitPositions.forEach(e => addMarker(e.id, e.pos));
    addMarker('EXTINGUISHER_POINT_1', this.config.primaryExtinguisherPos);
    addMarker('EXTINGUISHER_POINT_SPARE', this.config.spareExtinguisherPos);
    this.config.fireZones.forEach(f => addMarker(f.markerName, f.defaultPos));
    this.config.npcGroups.forEach(n => addMarker(n.markerName, n.defaultPos));

    return complex;
  }

  /**
   * Защита от прохождения сквозь стены и провала под пол (работает и в Desktop WASD, и в VR Stick/Teleport)
   */
  public clampPlayerPosition(pos: THREE.Vector3, isVR: boolean): void {
    const r = 0.42;
    // Предотвращение падения под землю
    if (!isVR && pos.y < 0.9) pos.y = 1.65;
    if (isVR && pos.y < 0) pos.y = 0;

    // Границы общей территории комплекса (-44..44 м)
    pos.x = THREE.MathUtils.clamp(pos.x, -42, 42);
    pos.z = THREE.MathUtils.clamp(pos.z, -42, 42);

    for (let i = 0; i < this.wallColliders.length; i++) {
      const w = this.wallColliders[i];
      const exMinX = w.minX - r;
      const exMaxX = w.maxX + r;
      const exMinZ = w.minZ - r;
      const exMaxZ = w.maxZ + r;

      if (pos.x > exMinX && pos.x < exMaxX && pos.z > exMinZ && pos.z < exMaxZ) {
        const dLeft = pos.x - exMinX;
        const dRight = exMaxX - pos.x;
        const dFront = pos.z - exMinZ;
        const dBack = exMaxZ - pos.z;
        const m = Math.min(dLeft, dRight, dFront, dBack);
        if (m === dLeft) pos.x = exMinX;
        else if (m === dRight) pos.x = exMaxX;
        else if (m === dFront) pos.z = exMinZ;
        else pos.z = exMaxZ;
      }
    }
  }

  public isExtinguisherArmed(): boolean {
    return this.fireMgr?.status === 'ARMED';
  }

  /**
   * Нажатие [E] / ЛКМ (короткое) / Курок VR для взятия ОУ-5, срыва чеки, замены баллона и команды NPC
   */
  public onTapInteract(
    playerPos: THREE.Vector3,
    _aimOrigin: THREE.Vector3,
    _aimDir: THREE.Vector3
  ): boolean {
    if (this.isDisposed || this.isLoadingGlb || !this.fireMgr || !this.evacMgr || this.debrief) {
      return false;
    }

    // 1. Взятие основного ОУ-5 со стойки у входа
    if (this.fireMgr.status === 'ON_POST') {
      if (playerPos.distanceTo(this.fireMgr.getPrimaryPostPos()) <= 3.4) {
        this.fireMgr.grabPrimaryExtinguisher();
        this.onToast(
          'info',
          'ОУ-5 ВЗЯТ В РУКИ',
          'Сорвите предохранительную чеку (нажмите [E] или [R]), затем войдите в здание.'
        );
        return true;
      }
    }

    // 2. Срыв предохранительной чеки с огнетушителя
    if (this.fireMgr.status === 'HELD_LOCKED') {
      this.fireMgr.pullSafetyPin();
      this.onToast(
        'success',
        'ЧЕКА СОРВАНА — ОУ-5 ГОТОВ К ПРИМЕНЕНИЮ',
        'Удерживайте ЛКМ / [E] / курок VR для подачи огнетушащей струи!'
      );
      return true;
    }

    // 3. Замена пустого / разряженного баллона на запасном посту
    if (
      this.fireMgr.isSpareAvailable() &&
      this.fireMgr.charge01 < 0.85 &&
      playerPos.distanceTo(this.fireMgr.getSparePostPos()) <= 3.4
    ) {
      this.fireMgr.swapSpareExtinguisher();
      this.onToast('success', 'БАЛЛОН ОУ-5 ЗАМЕНЁН', 'Запасной огнетушитель (100%) готов к работе.');
      return true;
    }

    // 4. Команда эвакуации ближайшей группе персонала
    const npcCmd = this.evacMgr.tryCommandNearestGroup(playerPos, this.fireMgr);
    if (npcCmd.found) {
      if (npcCmd.startedEvac) {
        this.onToast(
          'success',
          'ЭВАКУАЦИЯ ГРУППЫ НАЧАТА',
          `${npcCmd.groupNameRu} следует по маршруту к безопасному выходу!`
        );
      } else if (npcCmd.blockedByFireNameRu) {
        const msg = `Путь эвакуации перекрыт (${npcCmd.blockedByFireNameRu})! Сначала потушите очаг.`;
        this.fsm.pushWarning(msg, true);
        this.onToast('danger', 'ПУТЬ ПЕРЕКРЫТ ОГНЁМ', msg);
      }
      return true;
    }

    return false;
  }

  public onPullPinShortcut(): boolean {
    if (!this.fireMgr || this.fireMgr.status !== 'HELD_LOCKED') return false;
    this.fireMgr.pullSafetyPin();
    this.onToast('success', 'ЧЕКА ОУ-5 СОРВАНА', 'Огнетушитель переведён в боевое положение.');
    return true;
  }

  /**
   * Удержание триггера / ЛКМ / [E] для подачи струи огнетушителя
   */
  public onHoldSpray(aimOrigin: THREE.Vector3, aimDir: THREE.Vector3, dt: number, isMuted: boolean): void {
    if (this.isDisposed || this.isLoadingGlb || !this.fireMgr || this.debrief) return;

    const now = this.elapsedSec;
    if (this.fireMgr.status === 'ON_POST') {
      if (now - this.lastSprayWarnTime > 2.5) {
        this.lastSprayWarnTime = now;
        this.fsm.pushWarning('Сначала подойдите к красной стойке у входа и возьмите ОУ-5 [E].', false);
      }
      return;
    }

    if (this.fireMgr.status === 'HELD_LOCKED') {
      if (now - this.lastPinWarnTime > 2.5) {
        this.lastPinWarnTime = now;
        this.fsm.pushWarning('Нельзя тушить с заблокированной чекой! Нажмите [E] или [R].', true);
      }
      return;
    }

    if (this.fireMgr.status === 'EMPTY') {
      if (now - this.lastSprayWarnTime > 2.5) {
        this.lastSprayWarnTime = now;
        this.fsm.pushWarning('Заряд ОУ-5 исчерпан! Замените баллон на жёлтой запасной стойке.', false);
      }
      return;
    }

    const res = this.fireMgr.applySpray(aimOrigin, aimDir, dt, isMuted);
    if (res.extinguishedFireId) {
      this.onToast('success', 'ОЧАГ ПОТУШЕН', `${res.targetFireNameRu} полностью ликвидирован!`);
    }
  }

  public onStopSpray(): void {
    this.fireMgr?.stopSpray();
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    handAnchorPos: THREE.Vector3,
    aimDir: THREE.Vector3,
    isMuted: boolean,
    cumulativeDoseMsv: number
  ): Scenario4HudSnapshot {
    this.elapsedSec += !this.isLoadingGlb && !this.debrief ? dt : 0;
    this.cumulativeDoseMsv = cumulativeDoseMsv;
    this.fsm.tick(dt);

    // Плавное затухание VR-виньетки комфорта при телепорте
    if (this.vrComfortMesh) {
      if (this.vrComfortFade01 > 0.005) {
        this.vrComfortFade01 = Math.max(0, this.vrComfortFade01 - dt * 3.6);
        this.vrComfortMesh.visible = true;
        (this.vrComfortMesh.material as THREE.MeshBasicMaterial).opacity = this.vrComfortFade01 * 0.72;
      } else {
        this.vrComfortMesh.visible = false;
      }
    }

    if (this.isLoadingGlb || !this.fireMgr || !this.evacMgr) {
      return this.buildHudSnapshot();
    }

    // 1. Обновление очагов и ОУ-5
    const fireState = this.fireMgr.update(dt, playerPos, handAnchorPos, aimDir, isMuted);
    this.currentHeatLoad01 = fireState.thermalHeatLoad01;
    this.currentSmoke01 = fireState.smokeExposure01;
    if (fireState.thermalHeatLoad01 > this.peakHeatLoad01) {
      this.peakHeatLoad01 = fireState.thermalHeatLoad01;
    }

    // 2. Обновление эвакуации персонала
    const evacState = this.evacMgr.update(dt, this.fireMgr);
    if (evacState.justEvacuatedGroupNameRu) {
      this.onToast(
        'success',
        'ПЕРСОНАЛ В БЕЗОПАСНОСТИ',
        `${evacState.justEvacuatedGroupNameRu} выведена на внешний пункт сбора!`
      );
    }
    if (evacState.blockedGroupWarningRu) {
      this.fsm.pushWarning(evacState.blockedGroupWarningRu, true);
    }

    // 3. Проверка пространственных зон (внутри здания / пункт сбора)
    const isInsideBuilding =
      playerPos.x > -13.9 && playerPos.x < 13.9 && playerPos.z > -13.9 && playerPos.z < 11.9;
    const inAssemblyZone = playerPos.distanceTo(this.assemblyPos) <= 4.2;

    const fire1Ext = this.fireMgr.isFireExtinguished('fire_1');
    const allFiresExt = fireState.extinguishedCount === this.fireMgr.getTotalFires();
    const g1 = this.evacMgr.npcGroups[0];
    const g1ActiveOrDone = Boolean(g1 && (g1.status === 'FOLLOWING' || g1.status === 'EVACUATED'));
    const allNpcsDone = evacState.rescuedCount === evacState.totalNpcCount;

    // Ошибка при попытке выйти на точку сбора до ликвидации всех очагов / эвакуации
    if (
      inAssemblyZone &&
      this.fsm.getStep() !== 'STEP_1_PREP_ENTRY' &&
      (!allFiresExt || !allNpcsDone) &&
      this.elapsedSec - this.lastExitWarnTime > 5.0
    ) {
      this.lastExitWarnTime = this.elapsedSec;
      this.fsm.pushWarning(
        'Рано завершать операцию: проверьте все очаги возгорания и эвакуируйте оставшийся персонал!',
        false
      );
    }

    // 4. Шаги конечного автомата (1..6)
    const advanced = this.fsm.evaluateProgression({
      isExtinguisherArmed: this.fireMgr.status === 'ARMED',
      isInsideBuilding,
      fire1Extinguished: fire1Ext,
      group1StartedOrEvacuated: g1ActiveOrDone,
      allFiresExtinguished: allFiresExt,
      allNpcsEvacuated: allNpcsDone,
      inAssemblyZone
    });

    if (advanced) {
      const meta = this.fsm.getMeta();
      this.lastStepNum = meta.stepNumber;
      if (advanced === 'STEP_6_DEBRIEF') {
        this.debrief = this.fsm.buildDebriefSummary({
          elapsedSec: this.elapsedSec,
          rescuedCount: evacState.rescuedCount,
          totalNpcCount: evacState.totalNpcCount,
          extinguishedFires: fireState.extinguishedCount,
          totalFires: this.fireMgr.getTotalFires(),
          remainingExtinguisherPct: Math.round(this.fireMgr.charge01 * 100),
          cylindersUsed: this.fireMgr.cylindersUsed,
          cumulativeDoseMsv: this.cumulativeDoseMsv,
          peakHeatLoadPct: Math.round(this.peakHeatLoad01 * 100)
        });
        this.onToast('success', 'ОПЕРАЦИЯ МЧС ЗАВЕРШЕНА', 'Все очаги потушены, весь персонал спасён.');
      } else {
        this.onToast('info', `ЭТАП ${meta.stepNumber}/6: ${meta.titleRu}`, meta.instructionRu);
      }
    }

    // 5. Контекстная подсказка и подсветка ТОЛЬКО текущего активного шага
    this.updatePromptsAndHighlighting(playerPos);

    return this.buildHudSnapshot();
  }

  private updatePromptsAndHighlighting(playerPos: THREE.Vector3): void {
    if (!this.fireMgr || !this.evacMgr) return;
    const step = this.fsm.getStep();
    let prompt: string | null = null;

    if (step === 'STEP_1_PREP_ENTRY') {
      if (this.fireMgr.status === 'ON_POST') {
        this.evacMgr.setTargetHighlight(this.fireMgr.getPrimaryPostPos(), 0xef4444);
        this.evacMgr.updateGuidePath(null);
        if (playerPos.distanceTo(this.fireMgr.getPrimaryPostPos()) <= 3.4) {
          prompt = '[E] / ЛКМ — Взять огнетушитель ОУ-5 со стойки';
        }
      } else if (this.fireMgr.status === 'HELD_LOCKED') {
        this.evacMgr.setTargetHighlight(null);
        prompt = '[E] / [R] — Выдернуть предохранительную чеку ОУ-5';
      } else {
        this.evacMgr.setTargetHighlight(this.entrancePos, 0x38bdf8);
        this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [this.entrancePos]);
        prompt = 'Войдите в здание энергоблока через синий маркер входа';
      }
    } else if (step === 'STEP_2_FIRE_1') {
      const f1 = this.fireMgr.getFireById('fire_1');
      if (f1 && f1.intensity > 0) {
        this.evacMgr.setTargetHighlight(f1.worldPos, 0xf97316);
        this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [f1.worldPos]);
        if (playerPos.distanceTo(f1.worldPos) <= 5.4) {
          prompt = `Удерживайте ЛКМ / [E] / Курок — тушение (${Math.round(f1.intensity * 100)}%)`;
        }
      }
    } else if (step === 'STEP_3_EVAC_1') {
      const g1 = this.evacMgr.npcGroups[0];
      if (g1) {
        this.evacMgr.setTargetHighlight(g1.currentPos, 0x22c55e);
        this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [g1.currentPos]);
        if (playerPos.distanceTo(g1.currentPos) <= 5.2) {
          prompt = '[E] / ЛКМ — Подать команду эвакуации группе №1';
        }
      }
    } else if (step === 'STEP_4_FIRE_2_EVAC_2') {
      if (this.fireMgr.status === 'EMPTY' && this.fireMgr.isSpareAvailable()) {
        this.evacMgr.setTargetHighlight(this.fireMgr.getSparePostPos(), 0xf59e0b);
        this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [this.fireMgr.getSparePostPos()]);
        if (playerPos.distanceTo(this.fireMgr.getSparePostPos()) <= 3.4) {
          prompt = '[E] — Заменить пустой баллон ОУ-5 на запасной (100%)';
        }
      } else {
        const nextFire = this.fireMgr.getNearestActiveFire(playerPos);
        if (nextFire) {
          this.evacMgr.setTargetHighlight(nextFire.worldPos, 0xf97316);
          this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [nextFire.worldPos]);
          if (playerPos.distanceTo(nextFire.worldPos) <= 5.4) {
            prompt = `Удерживайте ЛКМ / [E] / Курок — ${nextFire.config.nameRu} (${Math.round(nextFire.intensity * 100)}%)`;
          }
        } else {
          const pendingNpc = this.evacMgr.getNearestPendingNpcGroup(playerPos);
          if (pendingNpc) {
            this.evacMgr.setTargetHighlight(pendingNpc.currentPos, 0x22c55e);
            this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [pendingNpc.currentPos]);
            if (playerPos.distanceTo(pendingNpc.currentPos) <= 5.2) {
              prompt = `[E] / ЛКМ — Эвакуировать: ${pendingNpc.config.nameRu}`;
            }
          }
        }
      }
    } else if (step === 'STEP_5_FINAL_SWEEP') {
      this.evacMgr.setTargetHighlight(this.assemblyPos, 0x10b981);
      this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [
        this.entrancePos,
        this.assemblyPos
      ]);
      prompt = 'Выйдите на зелёный Пункт сбора МЧС снаружи здания';
    } else {
      this.evacMgr.setTargetHighlight(null);
      this.evacMgr.updateGuidePath(null);
    }

    this.targetPromptRu = prompt;
  }

  public getHudSnapshot(): Scenario4HudSnapshot {
    return this.buildHudSnapshot();
  }

  private buildHudSnapshot(): Scenario4HudSnapshot {
    const meta = this.fsm.getMeta();
    const totalFires = this.fireMgr?.getTotalFires() ?? this.config.fireZones.length;
    const firesExtinguished = this.fireMgr?.getExtinguishedCount() ?? 0;
    const totalNpcCount = this.evacMgr
      ? this.evacMgr.npcGroups.reduce((acc, g) => acc + g.config.count, 0)
      : this.config.npcGroups.reduce((acc, g) => acc + g.count, 0);
    const rescuedCount = this.evacMgr
      ? this.evacMgr.npcGroups.reduce((acc, g) => acc + (g.status === 'EVACUATED' ? g.config.count : 0), 0)
      : 0;

    return {
      isLoadingGlb: this.isLoadingGlb,
      loadProgressPct: this.loadProgressPct,
      loadStatusRu: this.loadStatusRu,
      usingProceduralFallback: this.usingProceduralFallback,
      stepId: meta.id,
      stepNumber: meta.stepNumber,
      totalSteps: SCENARIO4_STEP_ORDER.length,
      stepTitleRu: meta.titleRu,
      instructionRu: meta.instructionRu,
      firesExtinguished,
      totalFires,
      rescuedCount,
      totalNpcCount,
      extinguisherStatus: this.fireMgr?.status ?? 'ON_POST',
      extinguisherChargePct: Math.round((this.fireMgr?.charge01 ?? 1) * 100),
      isSpraying: this.fireMgr?.isSpraying ?? false,
      isInsideBuilding: false,
      inAssemblyZone: false,
      thermalHeatLoad01: this.currentHeatLoad01,
      smokeExposure01: this.currentSmoke01,
      elapsedSec: this.elapsedSec,
      cumulativeDoseMsv: this.cumulativeDoseMsv,
      targetPromptRu: this.targetPromptRu,
      warningBannerRu: this.fsm.getWarningBanner(),
      safetyErrorCount: this.fsm.getSafetyErrors().length,
      debrief: this.debrief
    };
  }

  private clearCurrentWorldSystems(): void {
    if (this.fireMgr) {
      this.fireMgr.dispose();
      this.fireMgr = null;
    }
    if (this.evacMgr) {
      this.evacMgr.dispose();
      this.evacMgr = null;
    }
    this.disposeObjectTree(this.modelContainer);
    while (this.modelContainer.children.length > 0) {
      this.modelContainer.remove(this.modelContainer.children[0]);
    }
  }

  private disposeObjectTree(tree: THREE.Object3D): void {
    tree.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => {
          if (!m) return;
          const std = m as THREE.MeshStandardMaterial;
          std.map?.dispose();
          std.normalMap?.dispose();
          std.roughnessMap?.dispose();
          std.metalnessMap?.dispose();
          std.emissiveMap?.dispose();
          std.aoMap?.dispose();
          m.dispose();
        });
      }
    });
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.clearCurrentWorldSystems();
    if (this.vrComfortMesh) {
      this.vrComfortMesh.parent?.remove(this.vrComfortMesh);
      this.vrComfortMesh.geometry.dispose();
      (this.vrComfortMesh.material as THREE.Material).dispose();
      this.vrComfortMesh = null;
    }
    if (this.dracoLoader) {
      this.dracoLoader.dispose();
      this.dracoLoader = null;
    }
    this.gltfLoader = null;
    this.rootGroup.parent?.remove(this.rootGroup);
  }
}
