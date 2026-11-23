/**
 * ALARA — Главный оркестратор Сценария №4: Аварийно-спасательная операция на АЭС (/assembly.glb)
 * (src/scenarios/scenario4-npp-rescue/Scenario4Controller.ts)
 *
 * Связывает модули:
 * - src/npp/        (NppAssemblyLoader + NppSceneInspector + NPP_NODE_CONFIG)
 * - src/state/      (Scenario4StateMachine + UnifiedScenarioState)
 * - src/mechanics/  (ExtinguisherSystem + NpcEvacuationSystem + NppEquipmentBuilder + MchsVehicleSystem + EmergencyOpsSystem)
 * - src/xr/         (ViveInteractionAdapter для HTC Vive / WebXR / Desktop)
 */

import * as THREE from 'three';
import {
  NPP_NODE_CONFIG,
  SCENARIO_4_CONFIG,
  type WallColliderBox
} from '../../npp/nppNodeConfig';
import {
  disposeGlbSceneHierarchy,
  isSessionCachedGlbRoot,
  NppAssemblyLoader,
  type NppLoadResult
} from '../../npp/nppAssemblyLoader';
import {
  createFrameYieldBudget,
  throwIfAborted,
  yieldIfBudgetExceeded,
  yieldToBrowser,
  type NppInspectionReport
} from '../../npp/nppSceneInspector';
import type { RadiationSourceInstance } from '../../scene/scenarios';
import { ExtinguisherSystem, type FirePortalDoorwaySpec } from '../../mechanics/extinguisherSystem';
import { NpcEvacuationSystem } from '../../mechanics/npcEvacuationSystem';
import { NppEquipmentBuilder } from '../../mechanics/nppEquipmentBuilder';
import {
  MchsVehicleSystem,
  type MchsVehicleSnapshot
} from '../../mechanics/mchsVehicleSystem';
import {
  EmergencyOpsSystem,
  type EmergencyOpsSnapshot
} from '../../mechanics/emergencyOpsSystem';
import {
  SCENARIO4_PHASE_ORDER,
  Scenario4DebriefSummary,
  Scenario4HudSnapshot,
  Scenario4NavigationSnapshot,
  Scenario4NavTargetItem,
  Scenario4StateMachine
} from '../../state/scenario4StateMachine';
import type { UnifiedLifecyclePhase, UnifiedScenarioState } from '../../state/scenarioContract';
import { ViveInteractionAdapter, type VivePollInputs } from '../../xr/viveInteractionAdapter';
import { COOP_ROLE_SPECIFICATIONS, type CoopSquadRole } from '../../network/MultiplayerManager';
import type { RespiratorTypeId, SuitTypeId } from '../../components/CharacterCustomizer3D';
import { REMOTE_TOOLS, type RemoteToolId } from '../../physics/gostPhysics';

export interface Scenario4OperatorLoadoutProfile {
  role: CoopSquadRole;
  suitId: SuitTypeId;
  respiratorId: RespiratorTypeId;
  remoteToolId: RemoteToolId;
}

const SUIT_THERMAL_RATING_C: Readonly<Record<SuitTypeId, number>> = {
  none: 40,
  l1_suit: 65,
  lead_apron: 60,
  kih4_suit: 90,
  heavy_lead_armor: 120,
  bop_suit: 350
};

const RESPIRATOR_SMOKE_PENETRATION: Readonly<Record<RespiratorTypeId, number>> = {
  none: 1.0,
  lepestok_200: 0.35,
  gp7_gasmask: 0.12,
  gp7vm_gasmask: 0.10,
  ppm88_mask: 0.06,
  asv2_scba: 0.0
};

export interface Scenario4ControllerOptions {
  readonly envGroup: THREE.Group;
  readonly camera: THREE.Camera;
  readonly playerGroup: THREE.Group;
  readonly doseLimitMsv?: number;
  readonly maxDurationSec?: number;
  readonly onToast: (
    type: 'info' | 'success' | 'warning' | 'danger',
    title: string,
    message: string
  ) => void;
  readonly onPlayerSpawnReady?: (
    spawnPos: THREE.Vector3,
    lookTarget: THREE.Vector3,
    boundsSize: readonly [number, number, number]
  ) => void;
  readonly onCameraFocusRequested?: (
    focusPos: THREE.Vector3,
    lookTarget: THREE.Vector3
  ) => void;
  readonly onRadiationSourcesReady?: (sources: RadiationSourceInstance[]) => void;
}

const EMPTY_VEHICLE_SNAPSHOT: MchsVehicleSnapshot = {
  isSeated: false,
  nearDoor: false,
  nearHoseReel: false,
  isHoseAttached: false,
  speedKmh: 0,
  autopilotTargetName: null,
  hoseLengthM: 0,
  maxHoseLengthM: SCENARIO_4_CONFIG.HOSE.maxLengthM,
  hoseOverstretched: false,
  beaconsOn: true,
  targets: []
};

const EMPTY_EMERGENCY_OPS_SNAPSHOT: EmergencyOpsSnapshot = {
  radReconDone: false,
  radReconProgress01: 0,
  loopIsolated: false,
  casualtyStabilized: false,
  smokeMultiplier: 1.0,
  completedOpsCount: 0,
  totalOpsCount: 3,
  nearestPendingPromptRu: null
};

export class Scenario4Controller {
  private readonly envGroup: THREE.Group;
  private readonly camera: THREE.Camera;
  private readonly playerGroup: THREE.Group;
  private readonly onToast: Scenario4ControllerOptions['onToast'];
  private readonly onPlayerSpawnReady?: Scenario4ControllerOptions['onPlayerSpawnReady'];
  private readonly onCameraFocusRequested?: Scenario4ControllerOptions['onCameraFocusRequested'];
  private readonly onRadiationSourcesReady?: Scenario4ControllerOptions['onRadiationSourcesReady'];
  private readonly doseLimitMsv: number;
  private readonly maxDurationSec: number;

  private readonly rootGroup = new THREE.Group();
  private readonly modelContainer = new THREE.Group();

  private readonly assemblyLoader = new NppAssemblyLoader(NPP_NODE_CONFIG);
  private readonly fsm = new Scenario4StateMachine();
  public readonly viveAdapter = new ViveInteractionAdapter();

  private fireMgr: ExtinguisherSystem | null = null;
  private evacMgr: NpcEvacuationSystem | null = null;
  private equipBuilder: NppEquipmentBuilder | null = null;
  private vehicleSys: MchsVehicleSystem | null = null;
  private emergencyOps: EmergencyOpsSystem | null = null;

  private inspectionReport: NppInspectionReport | null = null;
  private mountedWorldRoot: THREE.Group | null = null;
  private wallColliders: WallColliderBox[] = [];
  private readonly modelBounds = new THREE.Box3(
    new THREE.Vector3(-45, 0, -45),
    new THREE.Vector3(45, 30, 45)
  );
  private deckSurfaceY = 0;
  private isDisposed = false;

  // Состояние асинхронной загрузки /assembly.glb и токен безопасной отмены
  private isLoadingGlb = true;
  private loadProgressPct = 0;
  private loadStatusRu = `Загрузка 3D-комплекса АЭС (${NPP_NODE_CONFIG.glbUrl})...`;
  private loadErrorRu: string | null = null;
  private activeLoadAbort: AbortController | null = null;
  private activeLoadToken = 0;

  // Оперативные таймеры и телеметрия
  private elapsedSec = 0;
  private peakHeatLoad01 = 0;
  private currentHeatLoad01 = 0;
  private currentSmoke01 = 0;
  private cumulativeDoseMsv = 0;
  private isInsideBuildingNow = false;
  private inAssemblyZoneNow = false;
  private usedHoseOrVehicle = false;
  private activeInputLabelRu =
    'Desktop • [E]/ЛКМ: действие/распыл • [R]: чека • [Enter]: машина МЧС • [K]: фокус';
  private targetPromptRu: string | null = null;
  private debrief: Scenario4DebriefSummary | null = null;

  private lastSprayWarnTime = -10;
  private lastPinWarnTime = -10;
  private lastExitWarnTime = -10;
  private lastHoseWarnTime = -10;
  private nextAutopilotIdx = 0;

  // Виньетка комфорта при телепорте в VR
  private vrComfortMesh: THREE.Mesh | null = null;
  private vrComfortFade01 = 0;

  // Ключевые мировые точки (обновляются из графа .glb)
  private readonly spawnPos = new THREE.Vector3();
  private readonly spawnLookTarget = new THREE.Vector3();
  private readonly focusCameraPos = new THREE.Vector3();
  private readonly focusCameraTarget = new THREE.Vector3();
  private readonly entrancePos = new THREE.Vector3();
  private readonly assemblyPos = new THREE.Vector3();
  private readonly primaryPostPos = new THREE.Vector3();
  private readonly sparePostPos = new THREE.Vector3();

  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchCamForward = new THREE.Vector3();
  private targetMarkersVisible = true;

  private operatorRole: CoopSquadRole = 'RECON_DOSIMETRIST';
  private operatorSuitId: SuitTypeId = 'none';
  private operatorRespiratorId: RespiratorTypeId = 'none';
  private operatorRemoteToolId: RemoteToolId = 'hand';

  constructor(options: Scenario4ControllerOptions) {
    this.envGroup = options.envGroup;
    this.camera = options.camera;
    this.playerGroup = options.playerGroup;
    this.onToast = options.onToast;
    this.onPlayerSpawnReady = options.onPlayerSpawnReady;
    this.onCameraFocusRequested = options.onCameraFocusRequested;
    this.onRadiationSourcesReady = options.onRadiationSourcesReady;
    this.doseLimitMsv = options.doseLimitMsv ?? 0.5;
    this.maxDurationSec = options.maxDurationSec ?? 450;

    this.rootGroup.name = 'scenario4_npp_complex_root';
    this.modelContainer.name = 'scenario4_glb_or_procedural_world';
    this.rootGroup.add(this.modelContainer);
    this.envGroup.add(this.rootGroup);

    this.setupVrComfortVignette();
    void this.loadComplexGlb();
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

  public getTargetMarkersVisible(): boolean {
    return this.targetMarkersVisible;
  }

  public toggleTargetMarkers(): boolean {
    this.targetMarkersVisible = !this.targetMarkersVisible;
    this.fireMgr?.setTargetMarkersVisible(this.targetMarkersVisible);
    this.evacMgr?.setTargetMarkersVisible(this.targetMarkersVisible);
    this.emergencyOps?.setTargetMarkersVisible(this.targetMarkersVisible);
    this.onToast(
      'info',
      this.targetMarkersVisible ? '3D-МАРКЕРЫ ЦЕЛЕЙ ВКЛЮЧЕНЫ' : '3D-МАРКЕРЫ ЦЕЛЕЙ СКРЫТЫ',
      this.targetMarkersVisible
        ? 'Над очагами, группами эвакуации и угрозами отображаются дистанция и подсказки.'
        : '3D-метки скрыты (клавиша [M] возвращает подсветку в любой момент).'
    );
    return this.targetMarkersVisible;
  }

  private getEffectiveReachBonusM(): number {
    const toolBonus = REMOTE_TOOLS[this.operatorRemoteToolId]?.addedDistanceM ?? 0;
    const roleBonus = COOP_ROLE_SPECIFICATIONS[this.operatorRole]?.modifiers.interactionReachBonusM ?? 0;
    return toolBonus + roleBonus;
  }

  private applyOperatorLoadoutModifiers(): void {
    const roleSpec = COOP_ROLE_SPECIFICATIONS[this.operatorRole];
    const reachBonus = this.getEffectiveReachBonusM();
    this.fireMgr?.setRoleModifiers(reachBonus, roleSpec.modifiers.fireSuppressionMultiplier);
    this.emergencyOps?.setRoleModifiers(reachBonus, roleSpec.modifiers.detectorResponseBonus);
  }

  public setOperatorLoadoutProfile(profile: Scenario4OperatorLoadoutProfile): void {
    this.operatorRole = profile.role;
    this.operatorSuitId = profile.suitId;
    this.operatorRespiratorId = profile.respiratorId;
    this.operatorRemoteToolId = profile.remoteToolId;
    this.applyOperatorLoadoutModifiers();
  }

  public async loadCustomGlbFile(file: File): Promise<void> {
    if (this.isDisposed) return;
    const blobUrl = URL.createObjectURL(file);
    const cacheKey = `upload::${file.name}::${file.size}::${file.lastModified}`;
    try {
      await this.loadComplexGlb(blobUrl, true, false, cacheKey);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  public cancelLoading(): void {
    this.activeLoadToken += 1;
    if (this.activeLoadAbort) {
      this.activeLoadAbort.abort();
      this.activeLoadAbort = null;
    }
  }

  public retryLoadGlb(): void {
    if (this.isDisposed) return;
    void this.loadComplexGlb(undefined, false, true);
  }

  public focusCameraOnModel(): boolean {
    if (this.isDisposed || this.isLoadingGlb || this.loadErrorRu || !this.inspectionReport) {
      return false;
    }
    if (this.vehicleSys?.isSeated) {
      this.onBoardOrExitVehicle();
    }
    this.playerGroup.position.x = this.focusCameraPos.x;
    this.playerGroup.position.z = this.focusCameraPos.z;
    this.onCameraFocusRequested?.(this.focusCameraPos, this.focusCameraTarget);
    this.notifyTeleportFade();
    this.onToast(
      'info',
      'ФОКУС НА МОДЕЛЬ АЭС (.GLB)',
      `Камера наведена на центр Box3 (${this.inspectionReport.boundingBoxSize.join('×')} м).`
    );
    return true;
  }

  private async loadComplexGlb(
    customUrl?: string,
    isCustomUpload = false,
    forceReload = false,
    customCacheKey?: string
  ): Promise<void> {
    if (this.isDisposed) return;

    this.cancelLoading();
    const loadToken = ++this.activeLoadToken;
    const abortController = new AbortController();
    this.activeLoadAbort = abortController;
    const signal = abortController.signal;

    this.clearCurrentWorldSystems();
    this.fsm.reset();
    this.isLoadingGlb = true;
    this.loadErrorRu = null;
    this.inspectionReport = null;
    this.loadProgressPct = 5;
    this.loadStatusRu = isCustomUpload
      ? 'Чтение пользовательской 3D-модели АЭС (.glb)...'
      : `Загрузка 3D-комплекса АЭС (${NPP_NODE_CONFIG.glbUrl})...`;

    // Уступаем один кадр браузеру, чтобы UI загрузки гарантированно отрисовался до старта
    await yieldToBrowser();
    if (this.isDisposed || this.activeLoadToken !== loadToken || signal.aborted) return;

    console.time('[ALARA S4] Полная загрузка и запуск Сценария №4');
    try {
      const result = await this.assemblyLoader.load(
        customUrl,
        isCustomUpload ? 'custom_upload' : 'glb_file',
        {
          signal,
          forceReload,
          cacheKey: customCacheKey,
          onProgress: (pct, textRu) => {
            if (!this.isDisposed && this.activeLoadToken === loadToken && !signal.aborted) {
              this.loadProgressPct = pct;
              this.loadStatusRu = textRu;
            }
          }
        }
      );

      if (this.isDisposed || this.activeLoadToken !== loadToken || signal.aborted) {
        if (!result.fromCache && !isSessionCachedGlbRoot(result.sceneRoot)) {
          disposeGlbSceneHierarchy(result.sceneRoot);
        }
        return;
      }

      await this.mountLoadedWorldAsync(result, loadToken, signal);

      if (this.isDisposed || this.activeLoadToken !== loadToken || signal.aborted) {
        this.clearCurrentWorldSystems();
        return;
      }

      this.onToast(
        'success',
        result.fromCache ? 'МОДЕЛЬ АЭС ВОССТАНОВЛЕНА ИЗ КЭША' : 'МОДЕЛЬ АЭС ЗАГРУЖЕНА (.GLB)',
        `${result.resolvedUrl} • Корпусов: ${result.report.buildingVolumes.length}, узлов: ${result.report.totalNodes}, Box3: ${result.report.boundingBoxSize.join('×')} м.`
      );
    } catch (err) {
      const isAborted =
        signal.aborted ||
        this.activeLoadToken !== loadToken ||
        (err as { name?: string })?.name === 'AbortError';
      if (this.isDisposed || isAborted) {
        this.clearCurrentWorldSystems();
        return;
      }

      this.clearCurrentWorldSystems();
      const errMsg = err instanceof Error ? err.message : String(err);
      this.isLoadingGlb = false;
      this.loadProgressPct = 0;
      this.loadStatusRu = 'Ошибка загрузки /assembly.glb';
      this.loadErrorRu = errMsg;
      console.error('[ALARA Scenario4] Загрузка /assembly.glb завершилась ошибкой:', errMsg);
      this.onToast(
        'danger',
        'ОШИБКА ЗАГРУЗКИ /assembly.glb',
        `${errMsg}. Проверьте public/assembly.glb или выберите .glb вручную.`
      );
    } finally {
      console.timeEnd('[ALARA S4] Полная загрузка и запуск Сценария №4');
      if (this.activeLoadAbort === abortController) {
        this.activeLoadAbort = null;
      }
    }
  }

  private assertLoadStillValid(loadToken: number, signal: AbortSignal): void {
    throwIfAborted(signal);
    if (this.isDisposed || this.activeLoadToken !== loadToken) {
      const err = new Error('Загрузка сцены прервана сменой сценария.');
      err.name = 'AbortError';
      throw err;
    }
  }

  private async mountLoadedWorldAsync(
    result: NppLoadResult,
    loadToken: number,
    signal: AbortSignal
  ): Promise<void> {
    this.assertLoadStillValid(loadToken, signal);
    const { sceneRoot: worldRoot, report, groundMeshes } = result;
    const budget = createFrameYieldBudget();

    const updateProgress = (pct: number, textRu: string) => {
      if (!this.isDisposed && this.activeLoadToken === loadToken) {
        this.loadProgressPct = pct;
        this.loadStatusRu = textRu;
      }
    };

    // Шаг 1: Добавление модели АЭС в сцену и расстановка технического оборудования корпусов
    updateProgress(97.8, 'Размещение оборудования внутри корпусов АЭС...');
    await yieldIfBudgetExceeded(budget, 14, signal);
    this.assertLoadStillValid(loadToken, signal);

    console.time('[ALARA S4] Этап 1: Оборудование корпусов');
    this.loadErrorRu = null;
    this.inspectionReport = report;
    this.deckSurfaceY = report.deckSurfaceY;
    this.mountedWorldRoot = worldRoot;
    this.modelContainer.add(worldRoot);
    this.modelContainer.updateMatrixWorld(true);
    this.modelBounds.min.set(
      report.boundingBoxMin[0],
      report.boundingBoxMin[1],
      report.boundingBoxMin[2]
    );
    this.modelBounds.max.set(
      report.boundingBoxMax[0],
      report.boundingBoxMax[1],
      report.boundingBoxMax[2]
    );

    const m = report.markers;
    this.spawnPos.copy(m.spawnPlayer);
    this.spawnLookTarget.copy(m.spawnLookTarget);
    this.focusCameraPos.copy(m.focusCameraPos);
    this.focusCameraTarget.copy(m.focusCameraTarget);
    this.entrancePos.copy(m.entrances[0].pos);
    this.assemblyPos.copy(m.assemblyPoints[0].pos);

    const primaryMarker =
      m.extinguisherPoints.find(p => p.name.toUpperCase().includes('1')) ?? m.extinguisherPoints[0];
    const spareMarker =
      m.extinguisherPoints.find(
        p => p.name.toUpperCase().includes('SPARE') || p.name.toUpperCase().includes('2')
      ) ??
      m.extinguisherPoints[1] ??
      m.extinguisherPoints[0];

    this.primaryPostPos.copy(primaryMarker.pos);
    this.sparePostPos.copy(spareMarker.pos);

    const avoidPoints: THREE.Vector3[] = [
      ...m.fireZones.map(f => f.pos),
      ...m.npcSpawns.map(n => n.pos),
      ...m.entrances.map(e => e.pos),
      m.loopIsolationPoint.pos,
      m.casualtyTriagePoint.pos,
      this.sparePostPos
    ];

    if (SCENARIO_4_CONFIG.EQUIPMENT_LAYOUT.enabled) {
      this.equipBuilder = new NppEquipmentBuilder({
        buildings: report.mainBuildings.length > 0 ? report.mainBuildings : report.buildingVolumes,
        avoidPoints,
        minClearanceM: SCENARIO_4_CONFIG.EQUIPMENT_LAYOUT.minClearanceFromFireOrNpcM,
        maxBuildings: SCENARIO_4_CONFIG.EQUIPMENT_LAYOUT.maxBuildingsToPopulate,
        scale: SCENARIO_4_CONFIG.EQUIPMENT_LAYOUT.equipmentScale
      });
      this.rootGroup.add(this.equipBuilder.rootGroup);
      this.wallColliders = [...m.wallColliders, ...this.equipBuilder.colliders];
    } else {
      this.wallColliders = [...m.wallColliders];
    }
    console.timeEnd('[ALARA S4] Этап 1: Оборудование корпусов');

    // Шаг 2: Пожарный автомобиль АЦ-40 (лёгкий внешний каркас) и аварийные посты МЧС
    updateProgress(98.5, 'Сборка пожарного автомобиля АЦ-40 и аварийных постов...');
    await yieldIfBudgetExceeded(budget, 14, signal);
    this.assertLoadStillValid(loadToken, signal);

    console.time('[ALARA S4] Этап 2: АЦ-40 МЧС и аварийные посты');
    this.vehicleSys = new MchsVehicleSystem({
      spawnPos: m.vehicleSpawn.pos,
      lookTarget: this.entrancePos,
      driveTargets: m.buildingDriveTargets,
      buildingVolumes: report.buildingVolumes,
      siteBounds: this.modelBounds,
      deckSurfaceY: report.deckSurfaceY,
      groundMeshes
    });
    this.rootGroup.add(this.vehicleSys.rootGroup);

    this.emergencyOps = new EmergencyOpsSystem({
      radReconPos: m.radReconPoint.pos,
      loopIsolationPos: m.loopIsolationPoint.pos,
      casualtyTriagePos: m.casualtyTriagePoint.pos
    });
    this.rootGroup.add(this.emergencyOps.rootGroup);
    console.timeEnd('[ALARA S4] Этап 2: АЦ-40 МЧС и аварийные посты');

    // Шаг 3: Очаги пожара + яркие мигающие оранжевые PointLight и дым у порталов входа
    updateProgress(99.2, 'Активация очагов возгорания и дымовых порталов...');
    await yieldIfBudgetExceeded(budget, 14, signal);
    this.assertLoadStillValid(loadToken, signal);

    console.time('[ALARA S4] Этап 3: Очаги, портальные огни и дым');
    this.fireMgr = new ExtinguisherSystem(
      NPP_NODE_CONFIG.fireZones,
      m.fireZones,
      this.primaryPostPos,
      this.sparePostPos,
      SCENARIO_4_CONFIG.FIRE_SCALE,
      m.buildingAnchors,
      m.fireZoneBuildingIndices
    );

    // Явно инжектируем мигающие оранжевые PointLight и частицы дыма на каждый активный проём пожарного портала
    const portalDoorways: FirePortalDoorwaySpec[] = NPP_NODE_CONFIG.fireZones.map((cfg, idx) => {
      const bldIdx = m.fireZoneBuildingIndices[idx] ?? idx;
      const anchor = m.buildingAnchors[bldIdx] ?? m.buildingAnchors[0];
      const fallbackPos = m.fireZones[idx]?.pos ?? new THREE.Vector3(cfg.defaultPos[0], cfg.defaultPos[1], cfg.defaultPos[2]);
      return {
        fireId: cfg.id,
        doorwayPos: anchor ? anchor.facadePos : fallbackPos,
        labelRu: anchor?.labelRu
      };
    });
    this.fireMgr.configureFirePortalDoorways(portalDoorways);

    this.rootGroup.add(this.fireMgr.rootGroup);
    this.applyOperatorLoadoutModifiers();
    console.timeEnd('[ALARA S4] Этап 3: Очаги, портальные огни и дым');

    // Шаг 4: Персонал для эвакуации и источники ИИИ
    updateProgress(99.7, 'Размещение персонала эвакуации и радиационных маркеров...');
    await yieldIfBudgetExceeded(budget, 14, signal);
    this.assertLoadStillValid(loadToken, signal);

    console.time('[ALARA S4] Этап 4: Эвакуация NPC и финализация');
    this.evacMgr = new NpcEvacuationSystem({
      npcSpecs: NPP_NODE_CONFIG.npcGroups,
      discoveredNpcs: m.npcSpawns,
      discoveredWaypoints: m.waypoints,
      triggerSpecs: NPP_NODE_CONFIG.triggerZones,
      discoveredTriggers: m.triggers,
      entrancePos: this.entrancePos,
      entrances: m.entrances,
      buildingAnchors: m.buildingAnchors,
      npcGroupBuildingIndices: m.npcGroupBuildingIndices,
      exits: m.exits,
      assemblyPos: this.assemblyPos,
      markerScale: SCENARIO_4_CONFIG.MARKER_SCALE,
      npcScale: SCENARIO_4_CONFIG.NPC_SCALE
    });
    this.rootGroup.add(this.evacMgr.rootGroup);

    this.fireMgr.setTargetMarkersVisible(this.targetMarkersVisible);
    this.evacMgr.setTargetMarkersVisible(this.targetMarkersVisible);
    this.emergencyOps.setTargetMarkersVisible(this.targetMarkersVisible);

    const fireIsotopes: ReadonlyArray<{ isotopeId: string; activityMBq: number }> = [
      { isotopeId: 'Cs-137', activityMBq: 450 },
      { isotopeId: 'Co-60', activityMBq: 320 },
      { isotopeId: 'Cs-137', activityMBq: 280 }
    ];
    const syncedSources: RadiationSourceInstance[] = [];
    this.fireMgr.fires.forEach((fire, idx) => {
      const spec = fireIsotopes[idx] ?? { isotopeId: 'Cs-137', activityMBq: 250 };
      syncedSources.push({
        id: `src_s4_zone${idx + 1}`,
        position: new THREE.Vector3(fire.worldPos.x, fire.worldPos.y + 0.45, fire.worldPos.z),
        isotopeId: spec.isotopeId,
        activityMBq: spec.activityMBq,
        mesh: fire.rootGroup,
        ringFloorY: fire.worldPos.y + 0.03
      });
    });
    this.onRadiationSourcesReady?.(syncedSources);

    this.elapsedSec = 0;
    this.peakHeatLoad01 = 0;
    this.currentHeatLoad01 = 0;
    this.currentSmoke01 = 0;
    this.usedHoseOrVehicle = false;
    this.debrief = null;
    this.isLoadingGlb = false;
    this.loadProgressPct = 100;
    this.loadStatusRu = '3D-комплекс АЭС готов к операции';
    this.fsm.markAssetReady();

    this.onPlayerSpawnReady?.(this.spawnPos, this.spawnLookTarget, report.boundingBoxSize);
    console.timeEnd('[ALARA S4] Этап 4: Эвакуация NPC и финализация');
  }

  public isPlayerSeatedInVehicle(): boolean {
    return Boolean(this.vehicleSys?.isSeated);
  }

  public getVehicleSeatWorldTransform(outPos: THREE.Vector3): { seated: boolean; yaw: number } {
    if (!this.vehicleSys || !this.vehicleSys.isSeated) {
      return { seated: false, yaw: 0 };
    }
    const yaw = this.vehicleSys.getSeatWorldTransform(outPos);
    return { seated: true, yaw };
  }

  public enforceHoseTether(playerPos: THREE.Vector3): boolean {
    if (!this.vehicleSys) return false;
    return this.vehicleSys.enforceHoseTether(playerPos);
  }

  public onBoardOrExitVehicle(): boolean {
    if (this.isDisposed || this.isLoadingGlb || !this.vehicleSys || this.debrief) return false;
    if (this.vehicleSys.isHoseAttached && !this.vehicleSys.isSeated) {
      this.onToast(
        'warning',
        'УБЕРИТЕ ПОЖАРНЫЙ РУКАВ',
        'Сначала отсоедините рукав у заднего насоса [E], затем садитесь в кабину АЦ-40.'
      );
      return false;
    }

    const res = this.vehicleSys.toggleBoardOrExit(this.playerGroup.position, this.scratchVecA);
    if (res === 'BOARDED') {
      this.usedHoseOrVehicle = true;
      this.fireMgr?.stowExtinguisher();
      this.notifyTeleportFade();
      this.onToast(
        'info',
        'ПОСАДКА В АЦ-40 МЧС',
        'Управление: [W/A/S/D] или левый стик Vive · Автопилот: [B] или кнопки HUD · Выход: [Enter].'
      );
      return true;
    }
    if (res === 'EXITED') {
      this.playerGroup.position.x = this.scratchVecA.x;
      this.playerGroup.position.z = this.scratchVecA.z;
      this.clampPlayerPosition(this.playerGroup.position, false);
      this.notifyTeleportFade();
      this.onToast('info', 'ВЫХОД ИЗ КАБИНЫ АЦ-40', 'Подойдите к задней катушке [E] за рукавом или войдите в корпус.');
      return true;
    }
    this.onToast(
      'warning',
      'ДАЛЕКО ОТ МАШИНЫ МЧС',
      'Подойдите ближе к двери кабины красного пожарного автомобиля МЧС (< 4.5 м).'
    );
    return false;
  }

  public startVehicleAutopilot(buildingIndex: number): boolean {
    if (this.isDisposed || this.isLoadingGlb || !this.vehicleSys || this.debrief) return false;
    if (this.vehicleSys.isHoseAttached) {
      this.vehicleSys.returnHose();
      this.fireMgr?.setHoseEquipped(false);
    }
    const targetName = this.vehicleSys.startAutopilotToBuilding(buildingIndex);
    if (!targetName) return false;
    this.usedHoseOrVehicle = true;
    this.fireMgr?.stowExtinguisher();
    this.onToast('info', 'АВТОПИЛОТ МЧС ВКЛЮЧЕН', `Машина движется к точке: ${targetName}.`);
    return true;
  }

  public cancelVehicleAutopilot(): void {
    this.vehicleSys?.cancelAutopilot();
  }

  public toggleVehicleBeacons(): boolean {
    if (!this.vehicleSys || this.isDisposed || this.isLoadingGlb) return false;
    const next = this.vehicleSys.toggleBeacons();
    this.onToast(
      'info',
      next ? 'ПРОБЛЕСКОВЫЕ МАЯКИ ВКЛЮЧЕНЫ' : 'ПРОБЛЕСКОВЫЕ МАЯКИ ВЫКЛЮЧЕНЫ',
      next ? 'Сигнально-громкоговорящая установка АЦ-40 активна.' : 'Световые маяки переведены в дежурный режим.'
    );
    return next;
  }

  public cycleNextVehicleAutopilot(): boolean {
    if (!this.vehicleSys || !this.inspectionReport) return false;
    const count = this.inspectionReport.markers.buildingDriveTargets.length;
    if (count === 0) return false;
    const idx = this.nextAutopilotIdx % count;
    this.nextAutopilotIdx = (this.nextAutopilotIdx + 1) % count;
    return this.startVehicleAutopilot(idx);
  }

  /**
   * Защита от выхода за пределы комплекса АЭС и реальных коллайдеров .glb / оборудования
   */
  public clampPlayerPosition(pos: THREE.Vector3, isVR: boolean): void {
    if (this.vehicleSys?.isSeated) return;

    const r = 0.42;
    const floorY = Number.isFinite(this.deckSurfaceY) ? this.deckSurfaceY : 0;
    const minEyeY = floorY + 0.9;
    if (!isVR && pos.y < minEyeY) {
      pos.y = floorY + SCENARIO_4_CONFIG.PLAYER_EYE_HEIGHT;
    }
    if (isVR && pos.y < floorY) {
      pos.y = floorY;
    }

    const pad = 25;
    const minBoundX = Math.min(-25, this.modelBounds.min.x - pad);
    const maxBoundX = Math.max(25, this.modelBounds.max.x + pad);
    const minBoundZ = Math.min(-25, this.modelBounds.min.z - pad);
    const maxBoundZ = Math.max(25, this.modelBounds.max.z + pad);

    pos.x = THREE.MathUtils.clamp(pos.x, minBoundX, maxBoundX);
    pos.z = THREE.MathUtils.clamp(pos.z, minBoundZ, maxBoundZ);

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

    this.vehicleSys?.enforceHoseTether(pos);
  }

  public isExtinguisherArmed(): boolean {
    return Boolean(this.fireMgr?.status === 'ARMED' || this.vehicleSys?.isHoseAttached);
  }

  public isExtinguisherHeldOrArmed(): boolean {
    return Boolean(
      this.vehicleSys?.isHoseAttached ||
        this.fireMgr?.status === 'HELD_LOCKED' ||
        this.fireMgr?.status === 'ARMED'
    );
  }

  public toggleStowExtinguisher(): 'STOWED' | 'EQUIPPED' | 'UNAVAILABLE' {
    if (!this.fireMgr || this.isLoadingGlb || this.debrief) return 'UNAVAILABLE';
    const next = this.fireMgr.toggleStow();
    if (next === 'STOWED') {
      this.onToast(
        'info',
        'ОУ-5 УБРАН',
        'Огнетушитель переведён в походное положение (клавиша [G] или курок — вернуть в руку).'
      );
    } else if (next === 'EQUIPPED') {
      this.onToast('info', 'ОУ-5 В РУКЕ', 'Огнетушитель извлечён и готов к применению.');
    }
    return next;
  }

  public stowExtinguisher(): void {
    this.fireMgr?.stowExtinguisher();
  }

  /**
   * Короткое взаимодействие ([E] / ЛКМ / Курок HTC Vive):
   * 1) Рукав МЧС у насосного отсека -> 2) Взятие/чека/замена ОУ-5 ->
   * 3) Аварийные операции МЧС (разведка/задвижка/пострадавший) ->
   * 4) Эвакуация NPC -> 5) Посадка/выход в кабину АЦ-40
   */
  public onTapInteract(
    playerPos: THREE.Vector3,
    _aimOrigin: THREE.Vector3,
    _aimDir: THREE.Vector3
  ): boolean {
    if (this.isDisposed || this.isLoadingGlb || !this.fireMgr || !this.evacMgr || this.debrief) {
      return false;
    }

    if (this.vehicleSys?.isSeated) {
      return this.onBoardOrExitVehicle();
    }

    if (this.vehicleSys) {
      const hoseAction = this.vehicleSys.toggleHoseAtReel(playerPos);
      if (hoseAction === 'ATTACHED') {
        this.usedHoseOrVehicle = true;
        this.fireMgr.setHoseEquipped(true);
        this.onToast(
          'success',
          'ПОЖАРНЫЙ РУКАВ ПОДКЛЮЧЁН',
          `Ствол ГМ-70 в руке (макс. длина ${SCENARIO_4_CONFIG.HOSE.maxLengthM} м). Направляйте на очаги!`
        );
        return true;
      }
      if (hoseAction === 'RETURNED') {
        this.fireMgr.setHoseEquipped(false);
        this.onToast('info', 'РУКАВ СМОТАН', 'Пожарный рукав возвращён на катушку АЦ-40.');
        return true;
      }
    }

    const reachBonus = this.getEffectiveReachBonusM();

    if (this.fireMgr.status === 'ON_POST') {
      if (playerPos.distanceTo(this.fireMgr.getPrimaryPostPos()) <= 3.5 + reachBonus) {
        this.fireMgr.grabPrimaryExtinguisher();
        this.onToast(
          'info',
          'ОУ-5 ВЗЯТ В РУКИ',
          'Сорвите предохранительную чеку ([E] / [R] / Грип Vive) и войдите в корпус.'
        );
        return true;
      }
    }

    if (this.fireMgr.status === 'HELD_LOCKED') {
      this.fireMgr.pullSafetyPin();
      this.onToast(
        'success',
        'ЧЕКА СОРВАНА — ОУ-5 ГОТОВ',
        'Удерживайте ЛКМ / [E] / курок HTC Vive для тушения очагов!'
      );
      return true;
    }

    if (
      this.fireMgr.isSpareAvailable() &&
      this.fireMgr.charge01 < 0.85 &&
      playerPos.distanceTo(this.fireMgr.getSparePostPos()) <= 3.5 + reachBonus
    ) {
      this.fireMgr.swapSpareExtinguisher();
      this.onToast('success', 'БАЛЛОН ОУ-5 ЗАМЕНЁН', 'Запасной баллон (100%) готов к применению.');
      return true;
    }

    if (this.emergencyOps) {
      const opRes = this.emergencyOps.tryInteract(playerPos);
      if (opRes.handled && opRes.titleRu && opRes.messageRu) {
        this.onToast('success', opRes.titleRu, opRes.messageRu);
        return true;
      }
    }

    const npcCmd = this.evacMgr.tryCommandNearestGroup(playerPos, this.fireMgr, reachBonus);
    if (npcCmd.found) {
      if (npcCmd.startedEvac) {
        this.onToast(
          'success',
          'ЭВАКУАЦИЯ НАЧАТА',
          `${npcCmd.groupNameRu} следует по маршруту к безопасному выходу!`
        );
      } else if (npcCmd.blockedByFireNameRu) {
        const msg = `Маршрут перекрыт огнём (${npcCmd.blockedByFireNameRu})! Сначала потушите очаг.`;
        this.fsm.pushWarning(msg, true);
        this.onToast('danger', 'ПУТЬ ПЕРЕКРЫТ ОГНЁМ', msg);
      }
      return true;
    }

    if (this.vehicleSys?.nearDoor) {
      return this.onBoardOrExitVehicle();
    }

    return false;
  }

  public onPullPinShortcut(): boolean {
    if (!this.fireMgr || this.fireMgr.status !== 'HELD_LOCKED') return false;
    this.fireMgr.pullSafetyPin();
    this.onToast('success', 'ЧЕКА ОУ-5 СОРВАНА', 'Огнетушитель переведён в боевое положение.');
    return true;
  }

  public onHoldSpray(
    aimOrigin: THREE.Vector3,
    aimDir: THREE.Vector3,
    dt: number,
    isMuted: boolean
  ): void {
    if (this.isDisposed || this.isLoadingGlb || !this.fireMgr || this.debrief) return;
    if (this.vehicleSys?.isSeated) return;

    if (this.vehicleSys?.isHoseAttached) {
      const nozzlePos = this.vehicleSys.getNozzleTipWorldPos(this.scratchVecB);
      const res = this.fireMgr.applyHoseSpray(nozzlePos, aimOrigin, aimDir, dt, isMuted);
      if (res.extinguishedFireId) {
        this.onToast('success', 'ОЧАГ ПОТУШЕН (РУКАВ МЧС)', `${res.targetFireNameRu} ликвидирован!`);
      }
      return;
    }

    const now = this.elapsedSec;
    if (this.fireMgr.status === 'ON_POST') {
      if (now - this.lastSprayWarnTime > 2.5) {
        this.lastSprayWarnTime = now;
        this.fsm.pushWarning('Возьмите ОУ-5 на красной стойке [E] или рукав на машине МЧС.', false);
      }
      return;
    }

    if (this.fireMgr.status === 'HELD_LOCKED') {
      if (now - this.lastPinWarnTime > 2.5) {
        this.lastPinWarnTime = now;
        this.fsm.pushWarning('Сначала сорвите чеку ОУ-5 ([E] или [R])!', true);
      }
      return;
    }

    if (this.fireMgr.status === 'EMPTY') {
      if (now - this.lastSprayWarnTime > 2.5) {
        this.lastSprayWarnTime = now;
        this.fsm.pushWarning('ОУ-5 разряжен! Замените на жёлтой стойке или возьмите рукав МЧС.', false);
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

  public stepWithInput(params: {
    dt: number;
    viveInput: VivePollInputs;
    isSprayingInput: boolean;
    isMuted: boolean;
    cumulativeDoseMsv: number;
    isMovementFrozen?: boolean;
    vehicleDriveInput?: { throttle: number; steer: number };
  }): Scenario4HudSnapshot {
    const sample = this.viveAdapter.sampleAim(params.viveInput);
    this.activeInputLabelRu = this.vehicleSys?.isSeated
      ? 'АЦ-40 МЧС • [WASD]/Л.Стик: движение • [L]: маяки • [B]: автопилот • [Enter]/Наж. стика: выйти'
      : sample.inputHintLabelRu;

    if (params.isSprayingInput && !params.isMovementFrozen && !this.vehicleSys?.isSeated) {
      this.onHoldSpray(sample.aimOrigin, sample.aimDirection, params.dt, params.isMuted);
    } else {
      this.onStopSpray();
    }

    return this.update(
      params.dt,
      sample.playerWorldPos,
      sample.handAnchorPos,
      sample.aimDirection,
      params.isMuted,
      params.cumulativeDoseMsv,
      sample.handAnchorQuat,
      sample.hasVrHandQuat,
      params.vehicleDriveInput?.throttle ?? 0,
      params.vehicleDriveInput?.steer ?? 0
    );
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    handAnchorPos: THREE.Vector3,
    aimDir: THREE.Vector3,
    isMuted: boolean,
    cumulativeDoseMsv: number,
    handAnchorQuat?: THREE.Quaternion,
    hasVrHandQuat = false,
    vehicleThrottle = 0,
    vehicleSteer = 0
  ): Scenario4HudSnapshot {
    this.elapsedSec += !this.isLoadingGlb && !this.debrief ? dt : 0;
    this.cumulativeDoseMsv = cumulativeDoseMsv;
    this.fsm.tick(dt);

    if (this.vrComfortMesh) {
      if (this.vrComfortFade01 > 0.005) {
        this.vrComfortFade01 = Math.max(0, this.vrComfortFade01 - dt * 3.6);
        this.vrComfortMesh.visible = true;
        (this.vrComfortMesh.material as THREE.MeshBasicMaterial).opacity =
          this.vrComfortFade01 * 0.72;
      } else {
        this.vrComfortMesh.visible = false;
      }
    }

    if (this.isLoadingGlb || !this.fireMgr || !this.evacMgr || !this.vehicleSys || !this.emergencyOps) {
      return this.buildHudSnapshot();
    }

    // 1. Обновление автомобиля МЧС и пожарного рукава
    const earlyWarnRatio = COOP_ROLE_SPECIFICATIONS[this.operatorRole]?.modifiers.earlyWarningRatio ?? 0.8;
    const vehRes = this.vehicleSys.update({
      dt,
      playerPos,
      handAnchorPos,
      aimDir,
      handAnchorQuat,
      hasVrHandQuat,
      manualThrottle: vehicleThrottle,
      manualSteer: vehicleSteer,
      isSpraying: this.fireMgr.isSpraying,
      hasAlert: Boolean(
        this.fsm.getWarningBanner() || this.cumulativeDoseMsv >= this.doseLimitMsv * earlyWarnRatio
      ),
      extraColliders: this.wallColliders
    });
    if (vehRes.arrivedBuildingName) {
      this.onToast(
        'success',
        'АЦ-40 ПРИБЫЛ К КОРПУСУ',
        `Автопилот остановлен у цели: ${vehRes.arrivedBuildingName}. Нажмите [Enter] для выхода.`
      );
    }
    if (this.vehicleSys.hoseOverstretched && this.elapsedSec - this.lastHoseWarnTime > 4.0) {
      this.lastHoseWarnTime = this.elapsedSec;
      this.fsm.pushWarning(
        `Пожарный рукав натянут (${this.vehicleSys.hoseLengthM.toFixed(0)}/${SCENARIO_4_CONFIG.HOSE.maxLengthM} м)! Подгоните машину ближе к корпусу.`,
        false
      );
    }

    // 2. Аварийные операции (доразведка, перекрытие контура, стабилизация пострадавшего)
    const opsRes = this.emergencyOps.update(dt, playerPos);
    if (opsRes.justCompletedRadRecon) {
      this.onToast(
        'success',
        'ДОРАЗВЕДКА ВЫПОЛНЕНА',
        'Уровень радиации на входе зафиксирован ДП-5В. Разрешён вход в корпус.'
      );
    }

    // 3. Очаги пожара и ОУ-5 (с учетом термостойкости костюма, фильтрации СИЗОД и роли звена)
    const fireState = this.fireMgr.update(
      dt,
      playerPos,
      handAnchorPos,
      aimDir,
      isMuted,
      handAnchorQuat,
      hasVrHandQuat
    );
    const suitThermalC = SUIT_THERMAL_RATING_C[this.operatorSuitId] ?? 40;
    const roleThermalMult = this.operatorRole === 'LIQUIDATOR_OPERATOR' ? 0.85 : 1.0;
    const heatAtten = THREE.MathUtils.clamp(40 / Math.max(40, suitThermalC), 0.14, 1.0) * roleThermalMult;
    const smokePenetration = RESPIRATOR_SMOKE_PENETRATION[this.operatorRespiratorId] ?? 1.0;

    this.currentHeatLoad01 = THREE.MathUtils.clamp(fireState.thermalHeatLoad01 * heatAtten, 0, 1);
    this.currentSmoke01 = THREE.MathUtils.clamp(
      fireState.smokeExposure01 * opsRes.smokeMultiplier * smokePenetration,
      0,
      1
    );
    if (this.currentHeatLoad01 > this.peakHeatLoad01) {
      this.peakHeatLoad01 = this.currentHeatLoad01;
    }

    // 4. Эвакуация NPC
    const evacState = this.evacMgr.update(dt, playerPos, this.fireMgr);
    if (evacState.justEvacuatedGroupNameRu) {
      this.onToast(
        'success',
        'ПЕРСОНАЛ В БЕЗОПАСНОСТИ',
        `${evacState.justEvacuatedGroupNameRu} выведена на Пункт сбора МЧС!`
      );
    }
    if (evacState.blockedGroupWarningRu) {
      this.fsm.pushWarning(evacState.blockedGroupWarningRu, true);
    }

    const insideModelBox =
      playerPos.x >= this.modelBounds.min.x &&
      playerPos.x <= this.modelBounds.max.x &&
      playerPos.z >= this.modelBounds.min.z &&
      playerPos.z <= this.modelBounds.max.z;
    const nearAnyFire = this.fireMgr.fires.some(f => playerPos.distanceTo(f.worldPos) <= 8.5);
    this.isInsideBuildingNow =
      !this.vehicleSys.isSeated &&
      (insideModelBox || nearAnyFire || playerPos.distanceTo(this.entrancePos) <= 4.0);
    this.inAssemblyZoneNow =
      !this.vehicleSys.isSeated && playerPos.distanceTo(this.assemblyPos) <= 5.2;

    const allFiresExt = fireState.extinguishedCount === this.fireMgr.getTotalFires();
    const allEmergencyOpsDone =
      this.emergencyOps.loopIsolated && this.emergencyOps.casualtyStabilized;
    const allNpcsSafe = evacState.rescuedCount === evacState.totalNpcCount;

    if (
      this.inAssemblyZoneNow &&
      this.fsm.getPhase() !== 'BRIEFING_ENTRY' &&
      this.fsm.getPhase() !== 'LOADING_ASSET' &&
      (!allFiresExt || !allNpcsSafe || !allEmergencyOpsDone) &&
      this.elapsedSec - this.lastExitWarnTime > 5.0
    ) {
      this.lastExitWarnTime = this.elapsedSec;
      this.fsm.pushWarning(
        'Операция не завершена: потушите очаги, перекройте контур, стабилизируйте пострадавшего и выведите персонал!',
        false
      );
    }

    const transitionedTo = this.fsm.evaluateProgression({
      assetReady: !this.isLoadingGlb,
      isSuppressionReady:
        this.fireMgr.status === 'ARMED' ||
        this.fireMgr.status === 'EMPTY' ||
        this.vehicleSys.isHoseAttached,
      isInsideBuilding: this.isInsideBuildingNow,
      allFiresExtinguished: allFiresExt,
      allEmergencyOpsDone,
      allNpcsSafe,
      inAssemblyZone: this.inAssemblyZoneNow,
      elapsedSec: this.elapsedSec,
      maxDurationSec: this.maxDurationSec,
      cumulativeDoseMsv: this.cumulativeDoseMsv,
      doseLimitMsv: this.doseLimitMsv
    });

    if (transitionedTo) {
      if (
        transitionedTo === 'EVACUATION_ESCORT' ||
        transitionedTo === 'COMPLETED' ||
        transitionedTo === 'FAILED'
      ) {
        this.fireMgr.stowExtinguisher();
      }
      const meta = this.fsm.getMeta();
      if (transitionedTo === 'COMPLETED' || transitionedTo === 'FAILED') {
        this.debrief = this.fsm.buildDebriefSummary({
          outcome: transitionedTo,
          elapsedSec: this.elapsedSec,
          rescuedCount: evacState.rescuedCount,
          totalNpcCount: evacState.totalNpcCount,
          extinguishedFires: fireState.extinguishedCount,
          totalFires: this.fireMgr.getTotalFires(),
          remainingExtinguisherPct: Math.round(this.fireMgr.charge01 * 100),
          cylindersUsed: this.fireMgr.cylindersUsed,
          radReconDone: this.emergencyOps.radReconDone,
          loopIsolated: this.emergencyOps.loopIsolated,
          casualtyStabilized: this.emergencyOps.casualtyStabilized,
          usedHoseOrVehicle: this.usedHoseOrVehicle,
          cumulativeDoseMsv: this.cumulativeDoseMsv,
          peakHeatLoadPct: Math.round(this.peakHeatLoad01 * 100)
        });
        this.onToast(
          transitionedTo === 'COMPLETED' ? 'success' : 'danger',
          transitionedTo === 'COMPLETED' ? 'ОПЕРАЦИЯ МЧС ЗАВЕРШЕНА' : 'ОПЕРАЦИЯ ПРЕРВАНА',
          transitionedTo === 'COMPLETED'
            ? 'Все очаги ликвидированы, угрозы локализованы, персонал выведен на пункт сбора.'
            : this.fsm.getFailureReason() ?? 'Нарушение нормативов.'
        );
      } else {
        this.onToast(
          'info',
          `ФАЗА ${meta.stepNumber}/${SCENARIO4_PHASE_ORDER.length}: ${meta.titleRu}`,
          meta.instructionRu
        );
      }
    }

    this.updatePromptsAndHighlighting(playerPos);
    return this.buildHudSnapshot();
  }

  private updatePromptsAndHighlighting(playerPos: THREE.Vector3): void {
    if (!this.fireMgr || !this.evacMgr || !this.vehicleSys || !this.emergencyOps) return;
    const phase = this.fsm.getPhase();
    let prompt: string | null = null;

    if (this.vehicleSys.isSeated) {
      this.evacMgr.setTargetHighlight(null);
      this.evacMgr.updateGuidePath(null);
      prompt = this.vehicleSys.autopilotTargetIndex !== null
        ? 'Автопилот АЦ-40 ведёт машину к корпусу • [L] — маяки • [Enter] — выйти из кабины'
        : 'За рулём АЦ-40 МЧС • [WASD]/Стик — ехать • [L] — маяки • [B] — автопилот • [Enter] — выйти';
      this.targetPromptRu = prompt;
      return;
    }

    const nearbyOp = this.emergencyOps.getNearestPendingPrompt(playerPos);

    if (this.vehicleSys.nearHoseReel) {
      prompt = this.vehicleSys.isHoseAttached
        ? '[E] / Курок — Смотать и вернуть пожарный рукав на АЦ-40'
        : '[E] / Курок — Взять пожарный рукав МЧС (58 м)';
    } else if (nearbyOp) {
      prompt = nearbyOp.promptRu;
    } else if (this.vehicleSys.nearDoor) {
      prompt = '[Enter] / [E] — Сесть за руль пожарной машины АЦ-40 МЧС';
    }

    const reachBonus = this.getEffectiveReachBonusM();

    if (phase === 'BRIEFING_ENTRY') {
      if (this.fireMgr.status === 'ON_POST' && !this.vehicleSys.isHoseAttached) {
        this.evacMgr.setTargetHighlight(this.fireMgr.getPrimaryPostPos(), 0xef4444);
        this.evacMgr.updateGuidePath(null);
        if (!prompt && playerPos.distanceTo(this.fireMgr.getPrimaryPostPos()) <= 3.5 + reachBonus) {
          prompt = '[E] / ЛКМ / Курок — Взять огнетушитель ОУ-5 со стойки';
        }
      } else if (this.fireMgr.status === 'HELD_LOCKED' && !this.vehicleSys.isHoseAttached) {
        this.evacMgr.setTargetHighlight(null);
        if (!prompt) prompt = '[E] / [R] / Курок — Сорвать предохранительную чеку ОУ-5';
      } else {
        this.evacMgr.setTargetHighlight(this.entrancePos, 0x38bdf8);
        this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [this.entrancePos]);
        if (!prompt) prompt = 'Войдите в корпус энергоблока через синий шлюз входа';
      }
    } else if (phase === 'FIRE_SUPPRESSION') {
      if (
        !this.vehicleSys.isHoseAttached &&
        this.fireMgr.status === 'EMPTY' &&
        this.fireMgr.isSpareAvailable()
      ) {
        this.evacMgr.setTargetHighlight(this.fireMgr.getSparePostPos(), 0xf59e0b);
        this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [
          this.fireMgr.getSparePostPos()
        ]);
        if (!prompt && playerPos.distanceTo(this.fireMgr.getSparePostPos()) <= 3.5 + reachBonus) {
          prompt = '[E] / Курок — Заменить баллон ОУ-5 на запасной (100%)';
        }
      } else {
        const nextFire = this.fireMgr.getNearestActiveFire(playerPos);
        if (nextFire) {
          this.evacMgr.setTargetHighlight(nextFire.worldPos, 0xf97316);
          this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [nextFire.worldPos]);
          if (!prompt && playerPos.distanceTo(nextFire.worldPos) <= 8.5 + reachBonus) {
            prompt = `Удерживайте ЛКМ / [E] / Курок — Тушение: ${nextFire.config.nameRu} (${Math.round(nextFire.intensity * 100)}%)`;
          }
        } else if (!this.emergencyOps.loopIsolated) {
          this.evacMgr.setTargetHighlight(this.emergencyOps.loopIsolationPos, 0xef4444);
          this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [
            this.emergencyOps.loopIsolationPos
          ]);
          if (!prompt) prompt = 'Все очаги потушены! Перекройте красную задвижку в Корпусе №1 [E]';
        } else if (!this.emergencyOps.casualtyStabilized) {
          this.evacMgr.setTargetHighlight(this.emergencyOps.casualtyTriagePos, 0x38bdf8);
          this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [
            this.emergencyOps.casualtyTriagePos
          ]);
          if (!prompt) prompt = 'Окажите медпомощь пострадавшему в Корпусе №2 [E]';
        }
      }
    } else if (phase === 'EVACUATION_ESCORT') {
      if (!this.emergencyOps.loopIsolated) {
        this.evacMgr.setTargetHighlight(this.emergencyOps.loopIsolationPos, 0xef4444);
        this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [
          this.emergencyOps.loopIsolationPos
        ]);
        if (!prompt) prompt = 'Перекройте красную задвижку аварийного контура внутри Корпуса №1 [E]';
      } else if (!this.emergencyOps.casualtyStabilized) {
        this.evacMgr.setTargetHighlight(this.emergencyOps.casualtyTriagePos, 0x38bdf8);
        this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [
          this.emergencyOps.casualtyTriagePos
        ]);
        if (!prompt) prompt = 'Стабилизируйте пострадавшего работника внутри Корпуса №2 [E]';
      } else {
        const pendingNpc = this.evacMgr.getNearestPendingNpcGroup(playerPos);
        if (pendingNpc) {
          this.evacMgr.setTargetHighlight(pendingNpc.currentPos, 0x22c55e);
          this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [pendingNpc.currentPos]);
          if (!prompt && playerPos.distanceTo(pendingNpc.currentPos) <= 7.0 + reachBonus) {
            prompt = `[E] / ЛКМ / Курок — Начать эвакуацию: ${pendingNpc.config.nameRu}`;
          }
        } else {
          const allSafe = this.evacMgr.npcGroups.every(g => g.state === 'SAFE');
          if (allSafe) {
            this.evacMgr.setTargetHighlight(this.assemblyPos, 0x10b981);
            this.evacMgr.updateGuidePath(this.scratchVecA.copy(playerPos), [
              this.entrancePos,
              this.assemblyPos
            ]);
            if (!prompt) prompt = 'Выйдите на зелёный Пункт сбора МЧС снаружи здания';
          } else {
            this.evacMgr.setTargetHighlight(this.assemblyPos, 0x38bdf8);
            this.evacMgr.updateGuidePath(null);
            if (!prompt) prompt = 'Персонал движется по маршруту эвакуации к выходу...';
          }
        }
      }
    } else {
      this.evacMgr.setTargetHighlight(null);
      this.evacMgr.updateGuidePath(null);
    }

    this.targetPromptRu = prompt;
  }

  public getHudSnapshot(): Scenario4HudSnapshot {
    return this.buildHudSnapshot();
  }

  public getUnifiedState(): UnifiedScenarioState {
    const snap = this.buildHudSnapshot();
    let unifiedPhase: UnifiedLifecyclePhase = 'ACTIVE_OPERATION';
    if (snap.stepId === 'LOADING_ASSET') unifiedPhase = 'LOADING_ASSET';
    else if (snap.stepId === 'BRIEFING_ENTRY') unifiedPhase = 'BRIEFING_ENTRY';
    else if (snap.stepId === 'COMPLETED') unifiedPhase = 'COMPLETED';
    else if (snap.stepId === 'FAILED') unifiedPhase = 'FAILED';
    else if (snap.warningBannerRu) unifiedPhase = 'CRITICAL_WARNING';

    const curIdx = SCENARIO4_PHASE_ORDER.indexOf(snap.stepId);

    return {
      scenarioId: 4,
      titleRu: '04. МЧС АЭС: Аварийно-спасательная операция (/assembly.glb)',
      phase: unifiedPhase,
      stepNumber: snap.stepNumber,
      totalSteps: snap.totalSteps,
      stepTitleRu: snap.stepTitleRu,
      instructionRu: snap.instructionRu,
      elapsedSec: snap.elapsedSec,
      maxDurationSec: snap.maxDurationSec,
      currentDoseRateMsvPerHour: 0,
      accumulatedDoseMsv: snap.cumulativeDoseMsv,
      doseLimitMsv: snap.doseLimitMsv,
      isCompleted: snap.stepId === 'COMPLETED',
      isFailed: snap.stepId === 'FAILED',
      failureReasonRu: snap.debrief?.failureReasonRu ?? null,
      warningMessageRu: snap.warningBannerRu,
      objectives: [
        {
          id: 'sc4_obj_entry',
          labelRu: 'Взять ОУ-5 или пожарный рукав АЦ-40 и войти в корпус',
          isDone: curIdx > 1 || snap.stepId === 'COMPLETED',
          isCurrent: snap.stepId === 'BRIEFING_ENTRY'
        },
        {
          id: 'sc4_obj_fires',
          labelRu: `Потушить очаги возгорания (${snap.firesExtinguished}/${snap.totalFires})`,
          isDone: snap.firesExtinguished >= snap.totalFires && snap.totalFires > 0,
          isCurrent: snap.stepId === 'FIRE_SUPPRESSION'
        },
        {
          id: 'sc4_obj_ops',
          labelRu: `Аварийные угрозы МЧС (${snap.emergencyOps.completedOpsCount}/${snap.emergencyOps.totalOpsCount})`,
          isDone:
            snap.emergencyOps.loopIsolated && snap.emergencyOps.casualtyStabilized,
          isCurrent: snap.stepId === 'FIRE_SUPPRESSION' || snap.stepId === 'EVACUATION_ESCORT'
        },
        {
          id: 'sc4_obj_evac',
          labelRu: `Эвакуировать персонал (${snap.rescuedCount}/${snap.totalNpcCount}) на Пункт сбора`,
          isDone: snap.stepId === 'COMPLETED',
          isCurrent: snap.stepId === 'EVACUATION_ESCORT'
        }
      ]
    };
  }

  private computeRelativeBearingDeg(playerPos: THREE.Vector3, targetPos: THREE.Vector3): number {
    this.camera.getWorldDirection(this.scratchCamForward);
    let fx = this.scratchCamForward.x;
    let fz = this.scratchCamForward.z;
    const fLen = Math.hypot(fx, fz);
    if (fLen < 1e-4) {
      fx = 0;
      fz = -1;
    } else {
      fx /= fLen;
      fz /= fLen;
    }

    let tx = targetPos.x - playerPos.x;
    let tz = targetPos.z - playerPos.z;
    const tLen = Math.hypot(tx, tz);
    if (tLen < 1e-4) return 0;
    tx /= tLen;
    tz /= tLen;

    const dot = fx * tx + fz * tz;
    const det = fx * tz - fz * tx;
    return Math.round(THREE.MathUtils.radToDeg(Math.atan2(det, dot)));
  }

  private buildNavigationSnapshot(): Scenario4NavigationSnapshot {
    if (this.isLoadingGlb || !this.fireMgr || !this.evacMgr || !this.emergencyOps) {
      return {
        markersVisible: this.targetMarkersVisible,
        priorityTarget: null,
        activeBuildingAlerts: []
      };
    }

    const playerPos = this.playerGroup.position;
    const phase = this.fsm.getPhase();
    let priorityTarget: Scenario4NavTargetItem | null = null;

    const setPriority = (
      id: string,
      kind: Scenario4NavTargetItem['kind'],
      labelRu: string,
      buildingLabelRu: string | null,
      pos: THREE.Vector3,
      statusRu: string
    ) => {
      const distM = Math.round(Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z));
      priorityTarget = {
        id,
        kind,
        labelRu,
        buildingLabelRu,
        distanceM: distM,
        relativeBearingDeg: this.computeRelativeBearingDeg(playerPos, pos),
        statusRu
      };
    };

    if (phase === 'BRIEFING_ENTRY') {
      if (this.fireMgr.status === 'ON_POST' && !this.vehicleSys?.isHoseAttached) {
        setPriority('ext_post', 'extinguisher', 'Огнетушитель ОУ-5', 'Стартовая площадка', this.fireMgr.getPrimaryPostPos(), 'ВЗЯТЬ [E]');
      } else if (!this.emergencyOps.radReconDone) {
        setPriority('rad_recon', 'emergency_op', 'Доразведка ДП-5В', 'У входа', this.emergencyOps.radReconPos, 'ПРОВЕРКА');
      } else {
        setPriority('entry_main', 'entrance', 'Вход в аварийный корпус', 'Корпус №1', this.entrancePos, 'ВОЙТИ');
      }
    } else if (phase === 'FIRE_SUPPRESSION') {
      if (!this.vehicleSys?.isHoseAttached && this.fireMgr.status === 'EMPTY' && this.fireMgr.isSpareAvailable()) {
        setPriority('ext_spare', 'extinguisher', 'Запасной баллон ОУ-5', 'Корпус №1', this.fireMgr.getSparePostPos(), 'ЗАМЕНИТЬ [E]');
      } else {
        const nextFire = this.fireMgr.getNearestActiveFire(playerPos);
        if (nextFire) {
          setPriority(
            nextFire.config.id,
            'fire',
            `Очаг №${nextFire.index + 1}`,
            nextFire.buildingLabelRu,
            nextFire.worldPos,
            `ПОЖАР ${Math.round(nextFire.intensity * 100)}%`
          );
        } else if (!this.emergencyOps.loopIsolated) {
          setPriority('loop_iso', 'emergency_op', 'Аварийная задвижка', 'Корпус №1', this.emergencyOps.loopIsolationPos, 'ПЕРЕКРЫТЬ [E]');
        } else if (!this.emergencyOps.casualtyStabilized) {
          setPriority('cas_triage', 'emergency_op', 'Пострадавший оператор', 'Корпус №2', this.emergencyOps.casualtyTriagePos, 'ПОМОЩЬ [E]');
        }
      }
    } else if (phase === 'EVACUATION_ESCORT') {
      if (!this.emergencyOps.loopIsolated) {
        setPriority('loop_iso', 'emergency_op', 'Аварийная задвижка', 'Корпус №1', this.emergencyOps.loopIsolationPos, 'ПЕРЕКРЫТЬ [E]');
      } else if (!this.emergencyOps.casualtyStabilized) {
        setPriority('cas_triage', 'emergency_op', 'Пострадавший оператор', 'Корпус №2', this.emergencyOps.casualtyTriagePos, 'ПОМОЩЬ [E]');
      } else {
        const nextNpc = this.evacMgr.getNearestPendingNpcGroup(playerPos);
        if (nextNpc) {
          setPriority(
            nextNpc.config.id,
            'npc',
            `${nextNpc.config.nameRu} (${nextNpc.config.count} чел.)`,
            nextNpc.buildingLabelRu,
            nextNpc.currentPos,
            nextNpc.state === 'PANIC' ? 'УГРОЗА ОГНЯ' : 'ЭВАКУИРОВАТЬ [E]'
          );
        } else {
          setPriority('asm_zone', 'assembly', 'Пункт сбора МЧС', 'Площадка', this.assemblyPos, 'ВЫЙТИ К СБОРУ');
        }
      }
    } else if (phase === 'COMPLETED') {
      setPriority('done', 'completed', 'Все задачи выполнены', null, this.assemblyPos, 'ГОТОВО');
    }

    // Собираем сводку по корпусам, где ещё активен пожар или ждут люди
    const bldAlertMap = new Map<string, { fires: number; people: number }>();
    for (let i = 0; i < this.fireMgr.fires.length; i++) {
      const f = this.fireMgr.fires[i];
      if (f.status !== 'EXTINGUISHED' && f.intensity > 0) {
        const entry = bldAlertMap.get(f.buildingLabelRu) ?? { fires: 0, people: 0 };
        entry.fires += 1;
        bldAlertMap.set(f.buildingLabelRu, entry);
      }
    }
    for (let i = 0; i < this.evacMgr.npcGroups.length; i++) {
      const g = this.evacMgr.npcGroups[i];
      if (g.state !== 'SAFE') {
        const entry = bldAlertMap.get(g.buildingLabelRu) ?? { fires: 0, people: 0 };
        entry.people += g.config.count;
        bldAlertMap.set(g.buildingLabelRu, entry);
      }
    }

    const activeBuildingAlerts: string[] = [];
    bldAlertMap.forEach((counts, bldLabel) => {
      const parts: string[] = [];
      if (counts.fires > 0) parts.push(`${counts.fires} очаг`);
      if (counts.people > 0) parts.push(`${counts.people} чел.`);
      activeBuildingAlerts.push(`${bldLabel} (${parts.join(', ')})`);
    });

    return {
      markersVisible: this.targetMarkersVisible,
      priorityTarget,
      activeBuildingAlerts
    };
  }

  private buildHudSnapshot(): Scenario4HudSnapshot {
    const meta = this.fsm.getMeta();
    const totalFires = this.fireMgr?.getTotalFires() ?? NPP_NODE_CONFIG.fireZones.length;
    const firesExtinguished = this.fireMgr?.getExtinguishedCount() ?? 0;
    const totalNpcCount = this.evacMgr
      ? this.evacMgr.npcGroups.reduce((acc, g) => acc + g.config.count, 0)
      : NPP_NODE_CONFIG.npcGroups.reduce((acc, g) => acc + g.count, 0);
    const rescuedCount = this.evacMgr
      ? this.evacMgr.npcGroups.reduce(
          (acc, g) => acc + (g.state === 'SAFE' ? g.config.count : 0),
          0
        )
      : 0;

    return {
      isLoadingGlb: this.isLoadingGlb,
      loadProgressPct: this.loadProgressPct,
      loadStatusRu: this.loadStatusRu,
      loadErrorRu: this.loadErrorRu,
      inspectionReport: this.inspectionReport,
      stepId: meta.id,
      stepNumber: meta.stepNumber,
      totalSteps: SCENARIO4_PHASE_ORDER.length,
      stepTitleRu: meta.titleRu,
      instructionRu: meta.instructionRu,
      firesExtinguished,
      totalFires,
      rescuedCount,
      totalNpcCount,
      extinguisherStatus: this.fireMgr?.status ?? 'ON_POST',
      extinguisherLifecycleState: this.fireMgr?.lifecycleState ?? 'IDLE_HOLSTERED',
      extinguisherChargePct: Math.round((this.fireMgr?.charge01 ?? 1) * 100),
      isSpraying: this.fireMgr?.isSpraying ?? false,
      isInsideBuilding: this.isInsideBuildingNow,
      inAssemblyZone: this.inAssemblyZoneNow,
      thermalHeatLoad01: this.currentHeatLoad01,
      smokeExposure01: this.currentSmoke01,
      elapsedSec: this.elapsedSec,
      maxDurationSec: this.maxDurationSec,
      cumulativeDoseMsv: this.cumulativeDoseMsv,
      doseLimitMsv: this.doseLimitMsv,
      installedEquipmentCount: this.equipBuilder?.equipmentCount ?? 0,
      vehicle: this.vehicleSys
        ? this.vehicleSys.getSnapshot(this.playerGroup.position)
        : EMPTY_VEHICLE_SNAPSHOT,
      emergencyOps: this.emergencyOps
        ? this.emergencyOps.getSnapshot(this.playerGroup.position)
        : EMPTY_EMERGENCY_OPS_SNAPSHOT,
      navigation: this.buildNavigationSnapshot(),
      activeInputLabelRu: this.activeInputLabelRu,
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
    if (this.equipBuilder) {
      this.equipBuilder.dispose();
      this.equipBuilder = null;
    }
    if (this.vehicleSys) {
      this.vehicleSys.dispose();
      this.vehicleSys = null;
    }
    if (this.emergencyOps) {
      this.emergencyOps.dispose();
      this.emergencyOps = null;
    }
    // Отцепляем кэшированную сборку .glb без освобождения GPU-ресурсов, чтобы повторный запуск был мгновенным
    if (this.mountedWorldRoot && isSessionCachedGlbRoot(this.mountedWorldRoot)) {
      this.mountedWorldRoot.parent?.remove(this.mountedWorldRoot);
    }
    this.mountedWorldRoot = null;
    this.disposeObjectTree(this.modelContainer);
    while (this.modelContainer.children.length > 0) {
      this.modelContainer.remove(this.modelContainer.children[0]);
    }
  }

  private disposeObjectTree(tree: THREE.Object3D): void {
    disposeGlbSceneHierarchy(tree);
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.cancelLoading();
    this.clearCurrentWorldSystems();
    this.assemblyLoader.dispose();
    if (this.vrComfortMesh) {
      this.vrComfortMesh.parent?.remove(this.vrComfortMesh);
      this.vrComfortMesh.geometry.dispose();
      (this.vrComfortMesh.material as THREE.Material).dispose();
      this.vrComfortMesh = null;
    }
    this.rootGroup.parent?.remove(this.rootGroup);
  }
}
