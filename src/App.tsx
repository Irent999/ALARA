/**
 * ALARA-Planner Pro VR - Главный модуль 3D/VR тренажера радиационной безопасности
 * Разработано с соблюдением ГОСТ Р 8.804-2012, ГОСТ 27451-87 и ОСПОРБ-99/2010
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { RealisticHumanHandRig, HazmatHandRig } from './scene/handModel';
import { WebXRManager } from './scene/webxrManager';
import { SCENARIOS, ScenarioDefinition, RadiationSourceInstance, ShieldingInstance, InteractiveObjectInstance } from './scene/scenarios';
import { GOST_INSTRUMENTS, InstrumentId, simulateDetectorReading } from './instruments/gostInstruments';
import {
  calculateComprehensiveProtection,
  ComprehensiveProtectionAnalysis,
  DoseNumericalIntegrator,
  evaluateRadiationZone,
  PPELoadoutId,
  PPE_LOADOUTS,
  RemoteToolId,
  REMOTE_TOOLS,
  ShieldMaterialType,
  mapCharacterPpeToLoadout,
  mapLoadoutToCharacterPpe
} from './physics/gostPhysics';
import { PlayerAvatarRig } from './scene/playerAvatarRig';
import { RadiationSourceVisualizer } from './scene/radiationSourceVisualizer';
import { RadiationAudioEngine } from './audio/radiationAudio';
import { HUD, TargetedObjectContext } from './components/HUD';
import { GostInstrumentsModal } from './components/GostInstrumentsModal';
import { AlaraReportModal } from './components/AlaraReportModal';
import { TacticalTabletModal, ShadowQualitySetting } from './components/TacticalTabletModal';
import { LabNotebookWidget } from './components/LabNotebookWidget';
import { GammaSpectrometryWidget } from './components/GammaSpectrometryWidget';
import { CharacterPPEState } from './components/CharacterCustomizer3D';
import { ToastNotifications, ToastItem } from './components/ToastNotifications';
import { TelemetryHistoryPoint } from './components/FloatingAnalyticsWindow';
import { VRUISystem } from './vr/vrUiSystem';
import { InteractionSystem, checkHeldObjectCollision, GRIP_OFFSETS } from './vr/vrInteractions';
import { ToolManager, MchsToolId, NozzleSprayMode, TOOL_SLOTS } from './scene/ToolManager';
import { InteractionHoldSystem, HoldProgressSnapshot } from './vr/InteractionHoldSystem';
import { EvacuationManager, CarriedHazardInfo, MchsMissionMetrics } from './scene/EvacuationManager';
import { configurePhotorealisticRendererAndHDRI } from './scene/pbrMaterialEngine';
import { RadiationBackgroundField } from './scene/radiationBackgroundField';
import {
  createTacticalFlashlight,
  setTacticalFlashlightPower,
  createFlashlightChargingStand
} from './scene/proceduralModels';
import { createEquipmentLabelTexture } from './scene/mchsTextures';
import {
  VoiceTaskLogger,
  VoiceLogEntry,
  VoiceLoggerMode,
  VoiceToastFeedItem
} from './vr/voiceTaskLogger';
import {
  ScenarioConfigRegistry,
  IScenarioConfig
} from './scene/scenarioConfigRegistry';
import {
  ScenarioRulesEngine,
  ScenarioRulesEvaluationResult
} from './scene/scenarioRulesEngine';
import { useXR, Desktop2DHUDOverlayGuard } from './vr/useXRSessionState';
import { VRManager } from './vr/VRManager';
import { VisorPostProcessing } from './shaders/VisorPostProcessing';
import { PBRSceneLighting } from './environment/PBRSceneLighting';
import { ScenarioManager } from './scenarios/ScenarioManager';
import { getScenarioDataById } from './scenarios/ScenarioRegistry';
import { HazardSourceSpawner } from './components/objects/HazardSourceSpawner';
import {
  PPELoadoutState,
  verifyPPEReadinessChecklist,
  calculatePPEProtectionFactors,
  mapCharacterPpeToCheckState
} from './modules/PPECheckModule';
import {
  PhysiologicalStress,
  PhysiologicalTelemetry
} from './modules/PhysiologicalStress';
import {
  AARAnalytics,
  evaluateAARSummary,
  AARTrajectorySample
} from './modules/AARAnalytics';
import {
  MultiplayerManager,
  CoopSquadRole,
  COOP_ROLE_SPECIFICATIONS,
  NetworkPlayerState
} from './network/MultiplayerManager';
import {
  HILConnector,
  HILInboundHardwareState,
  HILOutboundTelemetryFrame
} from './hardware/HILConnector';
import {
  createEmptySessionExposureLimitsTracker,
  exportDoseHistoryPdfReport,
  type SessionExposureLimitsTracker
} from './utils/pdfDoseReportExporter';
import { Scenario4Controller } from './scenarios/scenario4-npp-rescue/Scenario4Controller';
import { Scenario4Hud } from './scenarios/scenario4-npp-rescue/Scenario4Hud';
import { SCENARIO_4_CONFIG, type Scenario4HudSnapshot } from './scenarios/scenario4-npp-rescue/config';
import { AC40_CAB_CONFIG } from './npp/nppNodeConfig';

const DEFAULT_PROTECTION_ANALYSIS: ComprehensiveProtectionAnalysis = {
  unshieldedBaseDoseRateMicroSv: 0.1,
  finalProtectedDoseRateMicroSv: 0.1,
  spectralDoseRatesMicroSv: { alpha: 0, beta: 0, gamma: 0.1, neutron: 0 },
  spectralSharesPercent: { alpha: 0, beta: 0, gamma: 100, neutron: 0 },
  kDist: 1.0,
  kShield: 1.0,
  kPpe: 1.0,
  kProtTotal: 1.0,
  activeShieldMaterialRu: 'Нет экрана (Открытый луч)',
  activeShieldThicknessCm: 0,
  activeMu: 0,
  activeBuildupB: 1.0,
  baseDistanceM: 0,
  effectiveDistanceM: 0
};

// Переиспользуемые векторы для обработчиков без аллокаций в кадре
const APP_SCRATCH_VEC_A = new THREE.Vector3();
const APP_SCRATCH_VEC_B = new THREE.Vector3();
const APP_SCRATCH_VEC_C = new THREE.Vector3();

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Состояние сценария и приборов
  const [activeScenarioId, setActiveScenarioId] = useState<number>(1);
  const [scenarioStep, setScenarioStep] = useState<number>(0);
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<InstrumentId>('dp5');
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);

  // 4 фактора защиты: СИЗ, дистанционный инструмент и карточка наряда-допуска
  const [selectedPpeId, setSelectedPpeId] = useState<PPELoadoutId>('basic_ppe');
  const [selectedRemoteToolId, setSelectedRemoteToolId] = useState<RemoteToolId>('hand');
  const [permitLimitMsv, setPermitLimitMsv] = useState<number>(0.10);
  const [protectionAnalysis, setProtectionAnalysis] = useState<ComprehensiveProtectionAnalysis>(
    DEFAULT_PROTECTION_ANALYSIS
  );
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryHistoryPoint[]>([]);

  // Дозиметрия и показатели безопасности
  const [cumulativeDoseMsv, setCumulativeDoseMsv] = useState<number>(0.0);
  const [currentDoseRateMicroSv, setCurrentDoseRateMicroSv] = useState<number>(0.0);
  const [threatLevel, setThreatLevel] = useState<'normal' | 'warning' | 'danger'>('normal');
  const [zoneName, setZoneName] = useState<string>('Зона свободного режима');
  const [vitalsBpm, setVitalsBpm] = useState<number>(72);
  const [missionTimeSec, setMissionTimeSec] = useState<number>(0);

  // Управление виртуальной рукой
  const [isCrouched, setIsCrouched] = useState<boolean>(false);
  const [isExtendedArm, setIsExtendedArm] = useState<boolean>(false);
  const [isGripped, setIsGripped] = useState<boolean>(false);
  const [isTeleportActive, setIsTeleportActive] = useState<boolean>(false);

  // Модальные окна, VR и визуализация радиационного поля
  const [isGostModalOpen, setIsGostModalOpen] = useState<boolean>(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);
  const [isVRSupported, setIsVRSupported] = useState<boolean>(false);
  const [isInVR, setIsInVR] = useState<boolean>(false);
  const [isRadiationFieldVisible, setIsRadiationFieldVisible] = useState<boolean>(true);

  // Тактический фонарь (жестко привязан к иерархии левой руки leftHandRig), режим низкой освещенности и виброотклик VR
  const [isFlashlightOn, setIsFlashlightOn] = useState<boolean>(false);
  const [isFlashlightEquipped, setIsFlashlightEquipped] = useState<boolean>(true);
  const [isLowLightMode, setIsLowLightMode] = useState<boolean>(false);
  const [hapticStrength, setHapticStrength] = useState<number>(1.0);

  // Состояние модуля голосового протоколирования и команд VoiceTaskLogger
  const [voiceLogs, setVoiceLogs] = useState<VoiceLogEntry[]>([]);
  const [isVoicePushToTalkActive, setIsVoicePushToTalkActive] = useState<boolean>(false);
  const [voiceMode, setVoiceMode] = useState<VoiceLoggerMode>('hybrid');
  const [voiceVolumeLevel, setVoiceVolumeLevel] = useState<number>(0);
  const [voiceInterimTranscript, setVoiceInterimTranscript] = useState<string>('');
  const [latestVoiceToast, setLatestVoiceToast] = useState<VoiceToastFeedItem | null>(null);
  const [isAnalyticsMinimized, setIsAnalyticsMinimized] = useState<boolean>(false);
  const [exportCsvSignal, setExportCsvSignal] = useState<number>(0);

  // Состояние движка правил ScenarioRulesEngine и реестра ScenarioConfigRegistry
  const [scenarioConfig, setScenarioConfig] = useState<IScenarioConfig>(() =>
    ScenarioConfigRegistry.getConfig(1)
  );
  const [rulesEvaluation, setRulesEvaluation] = useState<ScenarioRulesEvaluationResult | null>(
    null
  );

  // Уведомления Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // График Chart.js
  const [chartLabels, setChartLabels] = useState<string[]>([]);
  const [chartDoseRate, setChartDoseRate] = useState<number[]>([]);
  const [chartCumulativeDose, setChartCumulativeDose] = useState<number[]>([]);

  // Модули Шага 4 и Шага 5: Регламент СИЗ, Физиология, AAR-разбор, Кооп-сеть и HIL-приборы (ESP32)
  const [ppeCheckState, setPpeCheckState] = useState<PPELoadoutState>({
    suitType: 'KIH_4',
    respiratorType: 'ASV_2',
    dosimeterType: 'DKG_07B',
    suitIntegrity: 1.0,
    suitSealVerified: true,
    dosimeterCalibratedAndSealed: true,
    oxygenOrFilterReservePercent: 96.0,
    cylinderPressureMpa: 28.5
  });
  const [physioTelemetry, setPhysioTelemetry] = useState<PhysiologicalTelemetry>({
    heartRateBpm: 74.0,
    respirationRatePerMin: 15.0,
    spO2Percent: 98.4,
    coreBodyTempC: 36.75,
    stressIndexPercent: 12.0,
    visorFoggingLevel: 0.08,
    handTremorAmplitudeM: 0.0006,
    tunnelVisionIntensity: 0.0,
    airConsumptionLitersPerMin: 21.8,
    remainingOxygenPercent: 96.0,
    clinicalStatus: 'OPTIMAL'
  });
  const [isAARModalOpen, setIsAARModalOpen] = useState<boolean>(false);
  const [isHudVisible, setIsHudVisible] = useState<boolean>(true);
  const [scenario4Snapshot, setScenario4Snapshot] = useState<Scenario4HudSnapshot | null>(null);

  // Виртуальный лабораторный практикум: Меню, Лаб. Журнал, МКА и Экзамен
  const [hideStartupModal, setHideStartupModal] = useState<boolean>(() => {
    try {
      return localStorage.getItem('alara_hide_startup_modal') === 'true';
    } catch {
      return false;
    }
  });
  const [isMainMenuOpen, setIsMainMenuOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('alara_hide_startup_modal') !== 'true';
    } catch {
      return true;
    }
  });
  const [isExamMode, setIsExamMode] = useState<boolean>(false);
  const [isLabNotebookOpen, setIsLabNotebookOpen] = useState<boolean>(false);
  const [isSpectrometryOpen, setIsSpectrometryOpen] = useState<boolean>(false);
  const [characterPpeState, setCharacterPpeState] = useState<CharacterPPEState>({
    suitId: 'none',
    respiratorId: 'none',
    instrumentId: 'dp5'
  });
  const [activeCustomIsotopeId, setActiveCustomIsotopeId] = useState<string>('Cs-137');
  const [doseResetCount, setDoseResetCount] = useState<number>(0);
  const doseResetCountRef = useRef<number>(0);

  const handleToggleHideStartupModal = useCallback((hide: boolean) => {
    setHideStartupModal(hide);
    try {
      if (hide) {
        localStorage.setItem('alara_hide_startup_modal', 'true');
      } else {
        localStorage.removeItem('alara_hide_startup_modal');
      }
    } catch {}
  }, []);

  const [isRandomizedHazardMode, setIsRandomizedHazardMode] = useState<boolean>(false);
  const [coopRole, setCoopRole] = useState<CoopSquadRole>('RECON_DOSIMETRIST');
  const [coopPeers, setCoopPeers] = useState<NetworkPlayerState[]>([]);
  const [hilState, setHilState] = useState<HILInboundHardwareState | null>(null);
  const [hilLastFrame, setHilLastFrame] = useState<HILOutboundTelemetryFrame | null>(null);
  const [targetedObject, setTargetedObject] = useState<TargetedObjectContext | null>(null);
  const targetedObjectKeyRef = useRef<string>('');
  const [activeToolId, setActiveToolId] = useState<MchsToolId>('dp5');
  const [nozzleSprayMode, setNozzleSprayMode] = useState<NozzleSprayMode>('SPRAY');
  const [shadowQuality, setShadowQuality] = useState<ShadowQualitySetting>('medium');
  const [isAnalyticsWindowOpen, setIsAnalyticsWindowOpen] = useState<boolean>(false);
  const [holdSnapshot, setHoldSnapshot] = useState<HoldProgressSnapshot | null>(null);
  const [carriedHazard, setCarriedHazard] = useState<CarriedHazardInfo | null>(null);
  const [mchsMetrics, setMchsMetrics] = useState<MchsMissionMetrics>({
    operationsCompleted: 0,
    extractedCount: 0,
    totalExtractable: 0,
    tongsCompliantExtractions: 0,
    bareHandViolations: 0,
    spillsDecontaminated: 0,
    firesExtinguished: 0,
    valvesClosed: 0,
    breakersSwitched: 0,
    bareHandViolationDetailsRu: []
  });
  const multiplayerRef = useRef<MultiplayerManager | null>(null);
  const hilConnectorRef = useRef<HILConnector | null>(null);

  useEffect(() => {
    const mp = new MultiplayerManager('RECON_DOSIMETRIST');
    mp.onPeersUpdated(peers => setCoopPeers([...peers]));
    mp.connect();
    multiplayerRef.current = mp;

    const hil = new HILConnector();
    hil.onStateChange((st, frame) => {
      setHilState(st);
      setHilLastFrame(frame);
    });
    hil.enableVirtualLoopbackMode();
    hilConnectorRef.current = hil;

    return () => {
      mp.disconnect();
      hil.disconnect();
    };
  }, []);

  useEffect(() => {
    hilConnectorRef.current?.transmitTelemetry({
      doseRateMicroSvPerHour: currentDoseRateMicroSv,
      accumulatedDoseMsv: cumulativeDoseMsv,
      permitLimitMsv
    });
  }, [currentDoseRateMicroSv, cumulativeDoseMsv, permitLimitMsv]);

  // Three.js & Engine Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerGroupRef = useRef<THREE.Group | null>(null);
  const handRigRef = useRef<RealisticHumanHandRig | null>(null);
  const leftHandRigDesktopRef = useRef<RealisticHumanHandRig | null>(null);
  const xrManagerRef = useRef<WebXRManager | null>(null);
  const vrUiSystemRef = useRef<VRUISystem | null>(null);
  const audioEngineRef = useRef<RadiationAudioEngine | null>(null);
  const radiationFieldRef = useRef<RadiationBackgroundField | null>(null);
  const voiceLoggerRef = useRef<VoiceTaskLogger | null>(null);
  const rulesEngineRef = useRef<ScenarioRulesEngine | null>(null);

  // Ссылки на динамические объекты текущего сценария
  const currentScenarioSources = useRef<RadiationSourceInstance[]>([]);
  const currentScenarioShields = useRef<ShieldingInstance[]>([]);
  const currentScenarioInteractive = useRef<InteractiveObjectInstance[]>([]);
  const currentEnvGroup = useRef<THREE.Group | null>(null);
  const radiationSourceVisualizerRef = useRef<RadiationSourceVisualizer | null>(null);

  // Хранение удерживаемого в руке объекта и система интерактивного взаимодействия
  const grabbedObjectRef = useRef<THREE.Object3D | null>(null);
  const interactionSystemRef = useRef<InteractionSystem | null>(null);
  const tryGrabOrInteractRef = useRef<
    (source?: 'desktop' | 'vr', controller?: THREE.Group, isVRGrabbing?: boolean, controllerIndex?: number) => void
  >(() => {});
  const sceneCollidersRef = useRef<THREE.Object3D[]>([]);
  const handleOpenGostGuideRef = useRef<() => void>(() => {});
  const handleOpenAlaraReportRef = useRef<() => void>(() => {});
  const handleToggleFlashlightRef = useRef<(forceState?: boolean) => void>(() => {});
  const handleToggleRadiationFieldRef = useRef<(forceState?: boolean) => void>(() => {});
  const handleResetChartsRef = useRef<() => void>(() => {});
  const handleExportCsvCommandRef = useRef<() => void>(() => {});
  const handleToggleAnalyticsCommandRef = useRef<(forceExpanded?: boolean) => void>(() => {});
  const handleChangeHapticStrengthRef = useRef<(strength: number) => void>(() => {});
  const handleResetScenarioRef = useRef<() => void>(() => {});
  const handleScenarioChangeRef = useRef<(id: number) => void>(() => {});
  const triggerSuccessModalRef = useRef<() => void>(() => {});
  const handleEscapeOrMenuKeyRef = useRef<() => void>(() => {});
  const isHudVisibleRef = useRef<boolean>(true);
  const hasShownSuccessModalRef = useRef<boolean>(false);
  const currentDoseRateRef = useRef<number>(0);
  const protectionAnalysisRef = useRef<ComprehensiveProtectionAnalysis>(DEFAULT_PROTECTION_ANALYSIS);

  // Ссылки на тактический фонарь левой руки, виброотклик и источники общего освещения сцены
  const flashlightMeshRef = useRef<THREE.Group | null>(null);
  const isFlashlightOnRef = useRef<boolean>(false);
  const isFlashlightEquippedRef = useRef<boolean>(true);
  const isLowLightModeRef = useRef<boolean>(false);
  const hapticStrengthRef = useRef<number>(1.0);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const mainDirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillDirLightRef = useRef<THREE.DirectionalLight | null>(null);

  // Вспомогательные данные анимации и физики
  const keysRef = useRef<Record<string, boolean>>({});
  const smoothedReadingRef = useRef<number>(0);
  const cumulativeDoseRef = useRef<number>(0);
  const missionTimeRef = useRef<number>(0);
  const lastChartHalfSecTickRef = useRef<number>(-1);
  const sessionExposureLimitsRef = useRef<SessionExposureLimitsTracker>(
    createEmptySessionExposureLimitsTracker()
  );
  const doseIntegratorRef = useRef<DoseNumericalIntegrator>(new DoseNumericalIntegrator());
  const prevThreatLevelRef = useRef<'normal' | 'warning' | 'danger'>('normal');
  const selectedPpeIdRef = useRef<PPELoadoutId>(selectedPpeId);
  const selectedRemoteToolIdRef = useRef<RemoteToolId>(selectedRemoteToolId);
  const permitLimitMsvRef = useRef<number>(permitLimitMsv);
  const isCrouchedRef = useRef<boolean>(isCrouched);
  const isExtendedArmRef = useRef<boolean>(isExtendedArm);
  const selectedInstrumentIdRef = useRef<InstrumentId>(selectedInstrumentId);
  const characterPpeStateRef = useRef<CharacterPPEState>(characterPpeState);
  const coopRoleRef = useRef<CoopSquadRole>(coopRole);
  const playerAvatarRigRef = useRef<PlayerAvatarRig | null>(null);
  const physioTelemetryRef = useRef<PhysiologicalTelemetry>(physioTelemetry);
  const isMovingRef = useRef<boolean>(false);
  const lastRedAlertSoundTimeRef = useRef<number>(0);
  const lastYellowAlertSoundTimeRef = useRef<number>(0);
  const activeScenarioIdRef = useRef<number>(activeScenarioId);
  const scenarioStepRef = useRef<number>(scenarioStep);
  const permitLimitWarnedRef = useRef<boolean>(false);
  const handleAdvanceScenarioStepRef = useRef<(targetStep?: number) => void>(() => {});
  const lastEarlyWarningSoundTimeRef = useRef<number>(0);

  // Рефы подсистемы инструментов МЧС, удержания действий и эвакуации САР
  const activeToolIdRef = useRef<MchsToolId>('dp5');
  const toolManagerRef = useRef<ToolManager | null>(null);
  const holdSystemRef = useRef<InteractionHoldSystem | null>(null);
  const evacuationManagerRef = useRef<EvacuationManager | null>(null);
  const lmbHoldActiveRef = useRef<boolean>(false);
  const vrRightHoldRef = useRef<{ active: boolean; raycaster: THREE.Raycaster | null }>({
    active: false,
    raycaster: null
  });
  const holdActionBlockedRef = useRef<string | null>(null);
  const lastHoldSnapKeyRef = useRef<string>('');
  const lastCarriedKeyRef = useRef<string>('');
  const lastMetricsKeyRef = useRef<string>('');
  const modalOpenRef = useRef<boolean>(false);
  const selectMchsToolRef = useRef<(id: MchsToolId) => void>(() => {});
  const applyCompletedHoldActionRef = useRef<(item: InteractiveObjectInstance) => void>(() => {});
  const scenario4ControllerRef = useRef<Scenario4Controller | null>(null);
  const lastScen4SnapKeyRef = useRef<string>('');
  const lastScen4StepNumRef = useRef<number>(1);
  const resetDesktopLookRef = useRef<() => void>(() => {});
  const setDesktopLookTargetRef = useRef<(from: THREE.Vector3, target: THREE.Vector3) => void>(() => {});
  const desktopOverviewYRef = useRef<number | null>(null);
  const scenario4GroundYRef = useRef<number>(0);
  const lastHudDoseKeyRef = useRef<string>('');
  const lastHudCumDoseKeyRef = useRef<string>('');
  const lastHudMissionSecRef = useRef<number>(-1);
  const lastHudProtKeyRef = useRef<string>('');
  const lastHudRulesKeyRef = useRef<string>('');
  const lastHudZoneKeyRef = useRef<string>('');
  const lastHudBpmRef = useRef<number>(72);

  selectedPpeIdRef.current = selectedPpeId;
  selectedRemoteToolIdRef.current = selectedRemoteToolId;
  permitLimitMsvRef.current = permitLimitMsv;
  isCrouchedRef.current = isCrouched;
  isExtendedArmRef.current = isExtendedArm;
  selectedInstrumentIdRef.current = selectedInstrumentId;
  characterPpeStateRef.current = characterPpeState;
  coopRoleRef.current = coopRole;
  physioTelemetryRef.current = physioTelemetry;
  activeScenarioIdRef.current = activeScenarioId;
  scenarioStepRef.current = scenarioStep;
  isHudVisibleRef.current = isHudVisible;
  activeToolIdRef.current = activeToolId;
  modalOpenRef.current =
    isMainMenuOpen ||
    isGostModalOpen ||
    isReportModalOpen ||
    isLabNotebookOpen ||
    isSpectrometryOpen ||
    isAARModalOpen ||
    isAnalyticsWindowOpen;

  const getEffectiveReachM = (): number => {
    const remTool = selectedRemoteToolIdRef.current;
    const roleSpec = COOP_ROLE_SPECIFICATIONS[coopRoleRef.current];
    const toolAddedM = REMOTE_TOOLS[remTool]?.addedDistanceM ?? 0;
    const armExtra = isExtendedArmRef.current && remTool !== 'extended_arm' ? 0.45 : 0;
    return 3.2 + toolAddedM + roleSpec.modifiers.interactionReachBonusM + armExtra;
  };

  const applyCoopRole = useCallback((role: CoopSquadRole) => {
    setCoopRole(role);
    coopRoleRef.current = role;
    multiplayerRef.current?.setRole(role);
    playerAvatarRigRef.current?.setCoopRole(role);

    const spec = COOP_ROLE_SPECIFICATIONS[role];
    handRigRef.current?.setCoopRoleAccent(spec.accentHexNumber);
    leftHandRigDesktopRef.current?.setCoopRoleAccent(spec.accentHexNumber);
    xrManagerRef.current?.setCoopRoleAccent(spec.accentHexNumber);

    scenario4ControllerRef.current?.setOperatorLoadoutProfile({
      role,
      suitId: characterPpeStateRef.current.suitId,
      respiratorId: characterPpeStateRef.current.respiratorId,
      remoteToolId: selectedRemoteToolIdRef.current
    });
  }, []);

  /**
   * Полная синхронизация выбранного в Главном меню инвентаря/СИЗ с 3D-сценой,
   * руками персонажа в Desktop/VR, физическим расчетом доз и Сценарием 4
   */
  const syncLoadoutTo3DScene = useCallback((
    instrumentId?: InstrumentId,
    newPpeState?: CharacterPPEState,
    newPpeLoadoutId?: PPELoadoutId,
    newRemoteToolId?: RemoteToolId
  ) => {
    const instr = instrumentId ?? selectedInstrumentIdRef.current;
    let ppeSt = newPpeState;
    let ppeId = newPpeLoadoutId;

    if (ppeSt && !ppeId) {
      ppeId = mapCharacterPpeToLoadout(ppeSt);
    } else if (ppeId && !ppeSt) {
      ppeSt = mapLoadoutToCharacterPpe(ppeId, instr);
    } else if (!ppeSt && !ppeId) {
      ppeSt = characterPpeStateRef.current;
      ppeId = selectedPpeIdRef.current;
    }

    if (ppeSt) {
      ppeSt = { ...ppeSt, instrumentId: instr };
    }

    const remTool = newRemoteToolId ?? selectedRemoteToolIdRef.current;

    setSelectedInstrumentId(instr);
    selectedInstrumentIdRef.current = instr;

    if (ppeSt) {
      setCharacterPpeState(ppeSt);
      characterPpeStateRef.current = ppeSt;
      const syncedSuit = ppeSt.suitId;
      const syncedResp = ppeSt.respiratorId;
      setPpeCheckState(prev => mapCharacterPpeToCheckState(syncedSuit, syncedResp, prev));
    }
    if (ppeId) {
      setSelectedPpeId(ppeId);
      selectedPpeIdRef.current = ppeId;
    }

    setSelectedRemoteToolId(remTool);
    selectedRemoteToolIdRef.current = remTool;

    if (newRemoteToolId !== undefined) {
      if (newRemoteToolId === 'extended_arm') {
        setIsExtendedArm(true);
        isExtendedArmRef.current = true;
        handRigRef.current?.setExtensionTarget(true);
      } else if (newRemoteToolId === 'hand') {
        setIsExtendedArm(false);
        isExtendedArmRef.current = false;
        handRigRef.current?.setExtensionTarget(false);
      }
    }

    // 1. Физическое обновление 3D-персонажа (манекен/тело под камерой)
    if (playerAvatarRigRef.current && ppeSt) {
      playerAvatarRigRef.current.updatePPEState(ppeSt);
    }

    // 2. Обновление десктопных рук (прибор, штанга/манипулятор и текстуры рукавов/перчаток СИЗ)
    if (handRigRef.current) {
      handRigRef.current.rebuildProbeGeometry(instr);
      handRigRef.current.setRemoteToolMode(remTool);
      if (ppeSt) {
        handRigRef.current.setGloveSuitMaterial(ppeSt.suitId);
      }
    }
    if (leftHandRigDesktopRef.current && ppeSt) {
      leftHandRigDesktopRef.current.setGloveSuitMaterial(ppeSt.suitId);
    }

    // 3. Обновление рук в WebXR/VR
    if (xrManagerRef.current) {
      xrManagerRef.current.setInstrument(instr);
      xrManagerRef.current.setRemoteToolMode(remTool);
      if (ppeSt) {
        xrManagerRef.current.setPpeSuit(ppeSt.suitId);
      }
    }

    // 4. Синхронизация дистанционного манипулятора 1.5м со слотом Щипцы ЦМ-1.5 [6]
    if (newRemoteToolId === 'manipulator_15m' && activeToolIdRef.current !== 'tongs') {
      toolManagerRef.current?.selectTool('tongs');
      activeToolIdRef.current = 'tongs';
      setActiveToolId('tongs');
    } else if (
      newRemoteToolId &&
      newRemoteToolId !== 'manipulator_15m' &&
      activeToolIdRef.current === 'tongs'
    ) {
      toolManagerRef.current?.selectTool('dp5');
      activeToolIdRef.current = 'dp5';
      setActiveToolId('dp5');
    }

    // 5. Обновление профиля оператора в Сценарии 4
    if (ppeSt) {
      scenario4ControllerRef.current?.setOperatorLoadoutProfile({
        role: coopRoleRef.current,
        suitId: ppeSt.suitId,
        respiratorId: ppeSt.respiratorId,
        remoteToolId: remTool
      });
    }
  }, []);

  const addToast = useCallback((type: ToastItem['type'], title: string, message: string) => {
    const newToast: ToastItem = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      title,
      message,
      timestamp: Date.now()
    };
    setToasts(prev => [...prev.slice(-4), newToast]);
    vrUiSystemRef.current?.showToast(type, title, message);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== newToast.id));
    }, 6000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Получить текущий сценарий
  const currentScenario = SCENARIOS.find(s => s.id === activeScenarioId) || SCENARIOS[0];

  // Проверка активного состояния VR-сессии (useXR): при isPresenting === true 2D DOM HUD полностью исключается из рендера (return null)
  const { isPresenting: isXRPresenting } = useXR(rendererRef, isInVR);

  // Инициализация Three.js и WebXR
  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Создание сцены с реалистичной атмосферой
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(currentScenario.fogColor);
    scene.fog = new THREE.FogExp2(currentScenario.fogColor, currentScenario.fogDensity);
    sceneRef.current = scene;

    // 2. Создание камеры с безопасным aspect ratio и расширенным frustum (чтобы стены и пол не отсекались)
    const safeAspect = Math.max(0.1, window.innerWidth / Math.max(1, window.innerHeight));
    const camera = new THREE.PerspectiveCamera(65, safeAspect, 0.08, 160);
    cameraRef.current = camera;

    // 3. Создание рендерера с физически корректным пайплайном и оптимизированным pixelRatio
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const hdriEnvTexture = configurePhotorealisticRendererAndHDRI(renderer, scene);
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    let isWebGLContextLost = false;
    const handleWebGLContextLost = (event: Event) => {
      event.preventDefault();
      isWebGLContextLost = true;
      if (xrManagerRef.current?.isInVR) {
        void xrManagerRef.current.toggleVRSession();
      }
      addToast(
        'warning',
        'ПОТЕРЯ КОНТЕКСТА WEBGL',
        'Графический контекст временно приостановлен. Ожидается автоматическое восстановление...'
      );
    };
    const handleWebGLContextRestored = () => {
      isWebGLContextLost = false;
      renderer.shadowMap.needsUpdate = true;
      addToast('info', 'WEBGL ВОССТАНОВЛЕН', 'Графический контекст и сцена успешно восстановлены.');
    };
    renderer.domElement.addEventListener('webglcontextlost', handleWebGLContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleWebGLContextRestored);

    // 4. Группа игрока (высота playerGroup.position.y по умолчанию 0.0 для трекинга local-floor)
    const playerGroup = new THREE.Group();
    playerGroup.position.set(currentScenario.initialPlayerPos.x, 0.0, currentScenario.initialPlayerPos.z);
    playerGroup.add(camera);

    // 4.1. 3D-модель тела персонажа (PlayerAvatarRig) в режиме от 1-го лица (без клиппинга плеч/торса)
    const playerAvatarRig = new PlayerAvatarRig(characterPpeStateRef.current);
    playerAvatarRig.setFirstPersonMode(true);
    playerAvatarRig.setCoopRole(coopRoleRef.current);
    playerGroup.add(playerAvatarRig.rootGroup);
    playerAvatarRigRef.current = playerAvatarRig;

    scene.add(playerGroup);
    playerGroupRef.current = playerGroup;

    // 5. Полноценное промышленное освещение с поддержкой режима низкой освещенности (Low-Light Vault Mode)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    // HemisphereLight для симуляции рассеянного света от светлого потолка и пола
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x555566, 1.3);
    scene.add(hemiLight);
    hemiLightRef.current = hemiLight;

    // Главный DirectionalLight сверху со сжатым фрустумом и оптимизированной картой теней
    const mainDirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    mainDirLight.position.set(6, 18, 8);
    mainDirLight.castShadow = true;
    mainDirLight.shadow.mapSize.width = 1024;
    mainDirLight.shadow.mapSize.height = 1024;
    mainDirLight.shadow.camera.left = -10;
    mainDirLight.shadow.camera.right = 10;
    mainDirLight.shadow.camera.top = 10;
    mainDirLight.shadow.camera.bottom = -10;
    mainDirLight.shadow.camera.near = 1;
    mainDirLight.shadow.camera.far = 34;
    mainDirLight.shadow.camera.updateProjectionMatrix();
    mainDirLight.shadow.bias = -0.0004;
    scene.add(mainDirLight);
    mainDirLightRef.current = mainDirLight;

    // Заполняющий DirectionalLight сзади (интенсивность 0.7)
    const fillDirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    fillDirLight.position.set(-8, 12, -10);
    scene.add(fillDirLight);
    fillDirLightRef.current = fillDirLight;

    // 6. Две анатомические кисти рук (Simultaneous Dual Hand System):
    //    - Правая рука с радиометром внутри ладонной поверхности (Palmar Grip Pose: curl ≈ 0.42)
    //    - Левая рука с жестко интегрированным тактическим фонарем VRFlashlight в локальной иерархии кисти (Grip Pose: curl ≈ 0.45)
    const initRoleAccent = COOP_ROLE_SPECIFICATIONS[coopRoleRef.current].accentHexNumber;
    const handRig = new RealisticHumanHandRig({ handedness: 'right', withRadiometer: true });
    handRig.rebuildProbeGeometry(selectedInstrumentIdRef.current);
    handRig.setRemoteToolMode(selectedRemoteToolIdRef.current);
    handRig.setGloveSuitMaterial(characterPpeStateRef.current.suitId);
    handRig.setCoopRoleAccent(initRoleAccent);
    camera.add(handRig.rootGroup);
    handRigRef.current = handRig;

    const leftHandRigDesktop = new RealisticHumanHandRig({
      handedness: 'left',
      withFlashlight: true,
      initialFlashlightOn: false
    });
    leftHandRigDesktop.setGloveSuitMaterial(characterPpeStateRef.current.suitId);
    leftHandRigDesktop.setCoopRoleAccent(initRoleAccent);
    camera.add(leftHandRigDesktop.rootGroup);
    leftHandRigDesktopRef.current = leftHandRigDesktop;
    flashlightMeshRef.current = leftHandRigDesktop.flashlight?.flashlightMesh ?? null;

    // 6.1. Пространственное поле гамма-квантов (160 частиц для стабильных 60-90+ FPS)
    const radiationField = new RadiationBackgroundField(160);
    scene.add(radiationField.pointsMesh);
    radiationFieldRef.current = radiationField;

    // 6.2. 3D-Визуализатор источников излучения (голографические знаки ГОСТ 17925-72, ореолы и контейнеры)
    const srcVisualizer = new RadiationSourceVisualizer();
    radiationSourceVisualizerRef.current = srcVisualizer;

    // 7. Аудио движок
    const audioEngine = new RadiationAudioEngine();
    audioEngineRef.current = audioEngine;

    // 8. Пространственный 3D VR UI (HUD, Toast, Справочник ГОСТ и Отчет ALARA)
    const vrUiSystem = new VRUISystem(camera);
    scene.add(vrUiSystem.rootGroup);
    vrUiSystemRef.current = vrUiSystem;

    // Подключение кнопок быстрого доступа, выбора сценария и ползунка настроек виброотклика VR HUD
    vrUiSystem.onScenarioChange = (newScenarioId: number) => {
      handleScenarioChangeRef.current(newScenarioId);
    };
    vrUiSystem.onToggleHudVisibility = (visible: boolean) => {
      setIsHudVisible(visible);
      isHudVisibleRef.current = visible;
    };
    vrUiSystem.onOpenChecklistFromHud = () => {
      const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
      const hasError = rulesEngineRef.current?.isFailed ?? false;
      vrUiSystemRef.current?.openChecklistModal(
        scenarioStepRef.current,
        activeScen.stages,
        hasError
      );
    };
    vrUiSystem.onAdvanceStepFromHud = (targetStep?: number) => {
      handleAdvanceScenarioStepRef.current(targetStep);
      const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
      vrUiSystemRef.current?.updateChecklistLive(
        scenarioStepRef.current,
        activeScen.stages,
        false
      );
    };
    vrUiSystem.onOpenGostFromHud = () => {
      handleOpenGostGuideRef.current();
    };
    vrUiSystem.onOpenAlaraFromHud = () => {
      handleOpenAlaraReportRef.current();
    };
    vrUiSystem.onToggleFlashlightFromHud = () => {
      handleToggleFlashlightRef.current();
    };
    vrUiSystem.onToggleVoicePttFromHud = () => {
      voiceLoggerRef.current?.togglePushToTalk();
    };
    vrUiSystem.onChangeHapticStrengthFromHud = (strength: number) => {
      handleChangeHapticStrengthRef.current(strength);
    };
    vrUiSystem.onResetScenarioFromHud = () => {
      handleResetScenarioRef.current();
    };

    // 8.1. Инициализация движка правил и условий проигрыша ScenarioRulesEngine (11 сценариев)
    const rulesEngine = new ScenarioRulesEngine(currentScenario.id, {
      onWarning80Triggered: messageRu => {
        audioEngineRef.current?.playTaskSuccess();
        addToast('warning', '⚠ ПРЕДУПРЕЖДЕНИЕ: ПОРОГ 80%', messageRu);
      },
      onWarning80HapticPulse: () => {
        xrManagerRef.current?.triggerWarning80HapticPulse();
      },
      onScenarioFailed: failed => {
        if (failed.failCode === 'DOSE_LIMIT_EXCEEDED') {
          doseResetCountRef.current += 1;
          setDoseResetCount(c => c + 1);
        }
        if (xrManagerRef.current) {
          xrManagerRef.current.isMovementFrozen = true;
        }
        audioEngineRef.current?.playAlarmSiren();
        addToast('danger', failed.titleRu, failed.reasonRu);
      },
      onResetScenarioConfirmed: cfg => {
        const isVRActive =
          (xrManagerRef.current?.isInVR ?? false) || (rendererRef.current?.xr.isPresenting ?? false);

        if (interactionSystemRef.current?.grabbedObject) {
          interactionSystemRef.current.releaseObject();
        }
        grabbedObjectRef.current = null;
        setIsGripped(false);

        if (playerGroupRef.current) {
          const vrResetY =
            xrManagerRef.current?.activeReferenceSpaceType === 'local-floor' ? 0.0 : 1.65;
          playerGroupRef.current.position.set(
            cfg.initialSpawnPos.x,
            isVRActive ? vrResetY : cfg.initialSpawnPos.y,
            cfg.initialSpawnPos.z
          );
          playerGroupRef.current.rotation.set(0, 0, 0);
        }

        if (xrManagerRef.current) {
          xrManagerRef.current.isMovementFrozen = false;
        }

        // Сброс интерактивных состояний пожара (Сц. 2) и SBO БПУ (Сц. 3)
        const envUD = currentEnvGroup.current?.userData;
        if (envUD?.fireSimulation) {
          const fs = envUD.fireSimulation as {
            flameFlames: THREE.Mesh[];
            smokePuffs: THREE.Mesh[];
            fireLight: THREE.PointLight;
            sparkGroup: THREE.Group;
            isPowerEnergized: boolean;
            isFireExtinguished: boolean;
            extinguishProgress?: number;
          };
          fs.isPowerEnergized = true;
          fs.isFireExtinguished = false;
          fs.extinguishProgress = 0;
          fs.flameFlames.forEach(f => {
            f.visible = true;
          });
          fs.smokePuffs.forEach(p => {
            const pMat = p.material as THREE.MeshStandardMaterial;
            if (pMat) pMat.opacity = 0.45;
          });
          fs.fireLight.intensity = 4.5;
          fs.sparkGroup.visible = true;

          const breaker = currentScenarioInteractive.current.find(i => i.id === 'power_breaker');
          const bHandle = breaker?.mesh.userData?.breakerHandle as THREE.Object3D | undefined;
          if (bHandle) bHandle.rotation.x = 0;
          const bLed = breaker?.mesh.userData?.breakerLed as THREE.Mesh | undefined;
          const bLedMat = bLed?.material as THREE.MeshBasicMaterial | undefined;
          if (bLedMat) bLedMat.color.setHex(0xef4444);
        }
        if (envUD?.sboSimulation) {
          const ss = envUD.sboSimulation as {
            sboScreenMesh?: THREE.Mesh;
            deskIndicatorMat: THREE.MeshBasicMaterial;
            emergencyLight: THREE.PointLight;
            isCableConnected: boolean;
            isGeneratorRunning: boolean;
            isCoolingRestored: boolean;
          };
          ss.isCableConnected = false;
          ss.isGeneratorRunning = false;
          ss.isCoolingRestored = false;
          ss.deskIndicatorMat.color.setHex(0x991b1b);
          ss.emergencyLight.color.setHex(0xef4444);
          if (ss.sboScreenMesh) {
            const scrMat = ss.sboScreenMesh.material as THREE.MeshBasicMaterial;
            if (scrMat) {
              if (scrMat.map) scrMat.map.dispose();
              scrMat.map = createEquipmentLabelTexture('БПУ • БЛОК №1', 'SBO: ПОТЕРЯ ПИТАНИЯ!', '#1f0808', '#ef4444');
              scrMat.needsUpdate = true;
            }
          }
          const cableBox = currentScenarioInteractive.current.find(i => i.id === 'sbo_power_cable');
          const cLed = cableBox?.mesh.userData?.cablePlugLed as THREE.Mesh | undefined;
          const cMat = cLed?.material as THREE.MeshBasicMaterial | undefined;
          if (cMat) cMat.color.setHex(0xf59e0b);

          const mdnu = currentScenarioInteractive.current.find(i => i.id === 'mdnu_diesel_pump');
          const mLed = mdnu?.mesh.userData?.mdnuStatusLed as THREE.Mesh | undefined;
          const mMat = mLed?.material as THREE.MeshBasicMaterial | undefined;
          if (mMat) mMat.color.setHex(0xef4444);

          if (ambientLightRef.current) ambientLightRef.current.intensity = 0.04;
          if (hemiLightRef.current) hemiLightRef.current.intensity = 0.08;
          if (mainDirLightRef.current) mainDirLightRef.current.intensity = 0.08;
          if (fillDirLightRef.current) fillDirLightRef.current.intensity = 0.03;
        }

        // Сброс просыпей, удержания действий, инструментов и статистики эвакуации САР
        holdSystemRef.current?.reset();
        toolManagerRef.current?.setTongsClosure(0);
        currentScenarioInteractive.current.forEach(item => {
          item.interacted = false;
          if (typeof item.mesh.userData?.holdBaseRotY === 'number') {
            item.mesh.rotation.y = item.mesh.userData.holdBaseRotY as number;
          }
          if (item.type === 'spill' && item.mesh.userData) {
            item.mesh.userData.isDecontaminated = false;
            item.mesh.userData.sourceDecontaminated = false;
            const puddleMat = item.mesh.userData.puddleMat as THREE.MeshStandardMaterial | undefined;
            if (puddleMat) puddleMat.opacity = 0.86;
            const puddleMeshes = item.mesh.userData.puddleMeshes as THREE.Mesh[] | undefined;
            puddleMeshes?.forEach(pm => pm.scale.set(1, 1, 1));
            const sorbentMound = item.mesh.userData.sorbentMound as THREE.Mesh | undefined;
            if (sorbentMound) {
              sorbentMound.visible = false;
              sorbentMound.scale.set(1, 0.05, 1);
            }
            const sorbentMat = item.mesh.userData.sorbentMat as THREE.MeshStandardMaterial | undefined;
            if (sorbentMat) sorbentMat.opacity = 0;
          }
        });
        evacuationManagerRef.current?.reset();
        setHoldSnapshot(null);
        setCarriedHazard(null);
        if (evacuationManagerRef.current) {
          setMchsMetrics(evacuationManagerRef.current.getMetrics());
        }

        // Обнуление накопленной дозы (H_accum = 0), очистка массивов графиков D(t) и H(t), локального CSV-буфера и голосового журнала
        doseIntegratorRef.current.reset();
        cumulativeDoseRef.current = 0;
        missionTimeRef.current = 0;
        smoothedReadingRef.current = 0;
        permitLimitWarnedRef.current = false;
        setCumulativeDoseMsv(0);
        setMissionTimeSec(0);
        setScenarioStep(0);
        setPermitLimitMsv(cfg.hLimitMsv);
        permitLimitMsvRef.current = cfg.hLimitMsv;
        lastChartHalfSecTickRef.current = -1;
        sessionExposureLimitsRef.current = createEmptySessionExposureLimitsTracker();
        setChartLabels([]);
        setChartDoseRate([]);
        setChartCumulativeDose([]);
        setTelemetryHistory([]);
        voiceLoggerRef.current?.clearLogs();
        setVoiceLogs([]);
        setLatestVoiceToast(null);

        // Возврат СИЗ и инструментов в начальные значения сценария
        syncLoadoutTo3DScene(undefined, undefined, cfg.defaultPpeId, cfg.defaultRemoteToolId);
        setRulesEvaluation(null);
        if (rendererRef.current) {
          rendererRef.current.shadowMap.needsUpdate = true;
        }
      }
    });
    rulesEngineRef.current = rulesEngine;

    // 8.2. Инициализация модуля голосового протоколирования и команд VoiceTaskLogger (Web Speech API ru-RU)
    const voiceLogger = new VoiceTaskLogger({
      mode: 'hybrid',
      radiationField,
      flashlight: leftHandRigDesktop.flashlight,
      getTelemetrySnapshot: () => {
        const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
        const stageNum = scenarioStepRef.current + 1;
        const comp = protectionAnalysisRef.current;
        const shieldSummary =
          comp.activeShieldThicknessCm > 0
            ? `${comp.activeShieldMaterialRu} ${comp.activeShieldThicknessCm.toFixed(1)} см`
            : 'Без экрана';
        return {
          elapsedSec: missionTimeRef.current,
          location: `Точка Сц.${activeScen.id}-${stageNum}`,
          currentDoseRate: currentDoseRateRef.current,
          activeShielding: shieldSummary
        };
      },
      getXRSession: () => xrManagerRef.current?.xrSession ?? null,
      onToggleRadiationField: forceState => {
        handleToggleRadiationFieldRef.current(forceState);
      },
      onToggleFlashlight: forceState => {
        handleToggleFlashlightRef.current(forceState);
      },
      onExportCsv: () => {
        handleExportCsvCommandRef.current();
      },
      onResetDose: () => {
        handleResetChartsRef.current();
      },
      onToggleAnalytics: forceExpanded => {
        handleToggleAnalyticsCommandRef.current(forceExpanded);
      },
      onLogEntryAdded: entry => {
        setVoiceLogs(prev => [...prev, entry]);
        audioEngineRef.current?.playTaskSuccess();
        addToast(
          'success',
          `🎙 ЗАПИСЬ ПРОТОКОЛА [${entry.location}]`,
          `«${entry.textNote}» • H = ${entry.currentDoseRate.toFixed(1)} мкЗв/ч • Защита: ${entry.activeShielding}`
        );
      },
      onCommandExecuted: match => {
        audioEngineRef.current?.playTaskSuccess();
        addToast(
          'info',
          `⚡ ГОЛОСОВАЯ КОМАНДА`,
          `${match.actionLabelRu} (распознано: «${match.rawTranscript}»)`
        );
      },
      onToastFeedUpdate: (_feed, latest) => {
        setLatestVoiceToast(latest);
      },
      onStateChange: st => {
        setIsVoicePushToTalkActive(st.isPushToTalkActive);
        setVoiceMode(st.mode);
        setVoiceInterimTranscript(st.interimTranscript);
        setVoiceVolumeLevel(st.volumeLevel);
      }
    });
    voiceLoggerRef.current = voiceLogger;

    // 8.5. Инициализация InteractionSystem, ToolManager, InteractionHoldSystem и EvacuationManager
    const interactionSystem = new InteractionSystem(scene);
    interactionSystemRef.current = interactionSystem;

    const toolManager = new ToolManager(scene);
    toolManager.attachToHandRig('desktop', handRig.palmGroup, handRig.radiometerGroup);
    toolManagerRef.current = toolManager;

    const evacuationManager = new EvacuationManager();
    evacuationManagerRef.current = evacuationManager;

    const holdSystem = new InteractionHoldSystem(scene, {
      onHapticPulse: (intensity, durationMs) => {
        const session = xrManagerRef.current?.xrSession;
        const strength = hapticStrengthRef.current;
        if (!session || strength <= 0.01) return;
        const eff = Math.max(0, Math.min(1, intensity * strength));
        for (let i = 0; i < session.inputSources.length; i++) {
          const gp = session.inputSources[i].gamepad;
          if (!gp || session.inputSources[i].handedness !== 'right') continue;
          try {
            if (gp.hapticActuators && gp.hapticActuators.length > 0) {
              (gp.hapticActuators[0] as unknown as { pulse?: (v: number, d: number) => void }).pulse?.(
                eff,
                durationMs
              );
            } else {
              const vib = (gp as unknown as {
                vibrationActuator?: {
                  playEffect?: (t: string, p: { duration: number; strongMagnitude: number; weakMagnitude: number }) => void;
                };
              }).vibrationActuator;
              vib?.playEffect?.('dual-rumble', {
                duration: durationMs,
                strongMagnitude: eff,
                weakMagnitude: eff * 0.85
              });
            }
          } catch {}
        }
      },
      onSnapshot: snap => {
        const snapKey = `${snap.isHolding ? 1 : 0}:${snap.targetId ?? ''}:${Math.round(snap.progress * 100)}`;
        if (snapKey !== lastHoldSnapKeyRef.current) {
          lastHoldSnapKeyRef.current = snapKey;
          setHoldSnapshot(snap.isHolding || snap.progress > 0.01 ? snap : null);
        }
      }
    });
    holdSystemRef.current = holdSystem;

    // 9. WebXR Manager
    const xrManager = new WebXRManager(renderer, scene, playerGroup, {
      onSessionStart: () => {
        setIsInVR(true);
        resetDesktopLookRef.current();
        if (cameraRef.current) {
          cameraRef.current.position.set(0, 0, 0);
          cameraRef.current.rotation.set(0, 0, 0);
        }
        if (playerGroupRef.current) {
          const eyeH = activeScenarioIdRef.current === 4 ? SCENARIO_4_CONFIG.PLAYER_EYE_HEIGHT : 1.65;
          playerGroupRef.current.position.y =
            xrManagerRef.current?.activeReferenceSpaceType === 'local-floor' ? 0.0 : eyeH;
        }
        playerAvatarRigRef.current?.setFirstPersonMode(true);
        // Активируем видимость VR UI в шлеме
        if (vrUiSystemRef.current) {
          vrUiSystemRef.current.rootGroup.visible = true;
        }
        // Синхронизируем состояние VR-фонаря в левой руке WebXR (локальная иерархия leftHandRig)
        if (xrManagerRef.current?.leftHandRig) {
          const vrFl = xrManagerRef.current.leftHandRig.equipFlashlight(isFlashlightOnRef.current);
          flashlightMeshRef.current = vrFl.flashlightMesh;
        }
        if (leftHandRigDesktopRef.current?.flashlight) {
          leftHandRigDesktopRef.current.flashlight.setPower(false);
        }
        // Скрываем виртуальные руки десктопного режима (в VR активны руки внутри playerGroup)
        if (handRigRef.current) {
          handRigRef.current.rootGroup.visible = false;
        }
        if (leftHandRigDesktopRef.current) {
          leftHandRigDesktopRef.current.rootGroup.visible = false;
        }
        // Применяем выбранный инструмент, штангу, роль и текстуру перчаток СИЗ к контроллерам WebXR
        xrManagerRef.current?.setInstrument(selectedInstrumentIdRef.current);
        xrManagerRef.current?.setRemoteToolMode(selectedRemoteToolIdRef.current);
        xrManagerRef.current?.setPpeSuit(characterPpeStateRef.current.suitId);
        xrManagerRef.current?.setCoopRoleAccent(
          COOP_ROLE_SPECIFICATIONS[coopRoleRef.current].accentHexNumber
        );
      },
      onSessionEnd: () => {
        setIsInVR(false);
        vrRightHoldRef.current.active = false;
        vrRightHoldRef.current.raycaster = null;
        scenario4ControllerRef.current?.onStopSpray();
        scenario4ControllerRef.current?.stowExtinguisher();
        toolManagerRef.current?.parkExtinguisher(false);
        // Скрываем VR UI, закрываем модалки и сбрасываем тосты
        if (vrUiSystemRef.current) {
          vrUiSystemRef.current.rootGroup.visible = false;
          vrUiSystemRef.current.closeModals();
          vrUiSystemRef.current.clearToast();
        }
        // Если предмет сцены удерживался в контроллере VR — корректно сбрасываем его через InteractionSystem
        if (interactionSystemRef.current?.grabbedObject) {
          interactionSystemRef.current.releaseObject(
            currentEnvGroup.current ? [currentEnvGroup.current] : undefined,
            playerGroupRef.current ? [playerGroupRef.current] : undefined
          );
          grabbedObjectRef.current = null;
          setIsGripped(false);
        }
        // Восстанавливаем активность фонаря на десктопной левой руке и гасим дублирующий VR-источник
        if (xrManagerRef.current?.leftHandRig?.flashlight) {
          xrManagerRef.current.leftHandRig.flashlight.setPower(false);
        }
        if (leftHandRigDesktopRef.current) {
          const deskFl = leftHandRigDesktopRef.current.equipFlashlight(isFlashlightOnRef.current);
          flashlightMeshRef.current = deskFl.flashlightMesh;
        }
        // Восстанавливаем видимость обеих рук в Desktop-режиме
        if (handRigRef.current) {
          handRigRef.current.rootGroup.visible = true;
        }
        if (leftHandRigDesktopRef.current) {
          leftHandRigDesktopRef.current.rootGroup.visible = true;
        }
        // Восстанавливаем высоту камеры игрока и параметры рендера для Desktop
        if (playerGroupRef.current) {
          const groundY = activeScenarioIdRef.current === 4 ? scenario4GroundYRef.current : 0;
          const eyeH = activeScenarioIdRef.current === 4 ? SCENARIO_4_CONFIG.PLAYER_EYE_HEIGHT : 1.65;
          playerGroupRef.current.position.y = groundY + eyeH;
        }
        resetDesktopLookRef.current();
        if (cameraRef.current && rendererRef.current && !rendererRef.current.xr.isPresenting) {
          cameraRef.current.position.set(0, 0, 0);
          cameraRef.current.rotation.set(0, 0, 0);
          cameraRef.current.aspect = window.innerWidth / Math.max(1, window.innerHeight);
          cameraRef.current.updateProjectionMatrix();
          rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
          rendererRef.current.setSize(window.innerWidth, window.innerHeight);
        }
      },
      onSelectStart: (controller, idx) => {
        tryGrabOrInteractRef.current('vr', controller, true, idx);
      },
      onSelectEnd: (controller, idx) => {
        tryGrabOrInteractRef.current('vr', controller, false, idx);
      },
      onSqueezeStart: (controller, idx) => {
        tryGrabOrInteractRef.current('vr', controller, true, idx);
        const grabbed = Boolean(interactionSystemRef.current?.grabbedObject);
        if (!grabbed && scenario4ControllerRef.current) {
          const handedness = xrManagerRef.current?.getControllerHandedness(idx);
          if (handedness === 'right' || idx === 0) {
            if (scenario4ControllerRef.current.onPullPinShortcut()) {
              return false;
            }
            if (scenario4ControllerRef.current.isExtinguisherArmed()) {
              scenario4ControllerRef.current.toggleStowExtinguisher();
            }
          }
        }
        return grabbed;
      },
      onSqueezeEnd: (controller, idx) => {
        // Если пользователь удерживал предмет этим контроллером и отпустил хват (squeezeend)
        if (
          interactionSystemRef.current?.grabbedObject &&
          (interactionSystemRef.current.activeControllerIndex === null ||
            interactionSystemRef.current.activeControllerIndex === idx)
        ) {
          tryGrabOrInteractRef.current('vr', controller, false, idx);
        }
      },
      onTeleportTrigger: targetPos => {
        playerGroup.position.x = targetPos.x;
        playerGroup.position.z = targetPos.z;
        if (scenario4ControllerRef.current) {
          scenario4ControllerRef.current.clampPlayerPosition(playerGroup.position, true);
          scenario4ControllerRef.current.notifyTeleportFade();
        }
        setIsTeleportActive(false);
      },
      onToggleFlashlight: (_hand, isOn) => {
        if (typeof isOn === 'boolean') {
          isFlashlightOnRef.current = isOn;
          setIsFlashlightOn(isOn);
        } else {
          handleToggleFlashlightRef.current();
        }
      },
      onVoicePushToTalkChange: isActive => {
        setIsVoicePushToTalkActive(isActive);
      },
      onToggleAnalyticsOverlay: () => {
        setIsAnalyticsMinimized(prev => !prev);
      },
      onToggleRadiationBackgroundField: () => {
        handleToggleRadiationFieldRef.current();
      },
      onToggleHudVisibility: (visible: boolean) => {
        setIsHudVisible(visible);
        isHudVisibleRef.current = visible;
        vrUiSystemRef.current?.setHudVisible(visible);
      },
      onCycleTool: dir => {
        const nextSlot = toolManagerRef.current?.cycleTool(dir);
        if (nextSlot) {
          selectMchsToolRef.current(nextSlot.id);
        }
      },
      onLeftThumbstickPress: () => {
        if (activeScenarioIdRef.current === 4 && !modalOpenRef.current) {
          scenario4ControllerRef.current?.onBoardOrExitVehicle();
        }
      },
      onRightTriggerWorldHold: (raycaster, _controller, isHeld, justPressed, justReleased) => {
        vrRightHoldRef.current.active = isHeld;
        vrRightHoldRef.current.raycaster = raycaster;
        if (justPressed || justReleased) {
          holdActionBlockedRef.current = null;
        }
      }
    });
    if (xrManager.rightHandRig) {
      toolManager.attachToHandRig('vr', xrManager.rightHandRig.palmGroup, xrManager.rightHandRig.radiometerGroup);
    }
    xrManager.vrUiSystem = vrUiSystem;
    xrManager.attachVoiceTaskLogger(voiceLogger);
    xrManager.setInstrument(selectedInstrumentIdRef.current);
    xrManager.setRemoteToolMode(selectedRemoteToolIdRef.current);
    xrManager.setPpeSuit(characterPpeStateRef.current.suitId);
    xrManager.setCoopRoleAccent(COOP_ROLE_SPECIFICATIONS[coopRoleRef.current].accentHexNumber);
    xrManagerRef.current = xrManager;
    xrManager.checkXRSupport().then(supported => setIsVRSupported(supported));

    // Добавление стандартной кнопки Enter VR от Three.js в DOM
    const vrButton = xrManager.createVRButton();
    document.body.appendChild(vrButton);

    // Загрузка сцены первого сценария
    loadScenario(currentScenario);

    // Слушатель изменения размера окна (строгая блокировка в активной WebXR-сессии)
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      if (rendererRef.current.xr.isPresenting) return;
      const pcAspect = window.innerWidth / Math.max(1, window.innerHeight);
      cameraRef.current.aspect = pcAspect;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Управление мышью (Обзор + удержание ЛКМ без перетаскивания для технологических действий)
    let isMouseDown = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let downMouseX = 0;
    let downMouseY = 0;
    let downMouseTimeMs = 0;
    let playerRotY = 0;
    let cameraPitch = 0;
    resetDesktopLookRef.current = () => {
      playerRotY = 0;
      cameraPitch = 0;
    };
    setDesktopLookTargetRef.current = (from: THREE.Vector3, target: THREE.Vector3) => {
      const dx = target.x - from.x;
      const dy = target.y - from.y;
      const dz = target.z - from.z;
      if (dx * dx + dy * dy + dz * dz < 1e-6) return;
      const yaw = Math.atan2(-dx, -dz);
      const horizDist = Math.hypot(dx, dz);
      const rawPitch = Math.atan2(dy, Math.max(0.001, horizDist));
      const clampedPitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, rawPitch));
      playerRotY = yaw;
      cameraPitch = clampedPitch;
      if (playerGroupRef.current) {
        playerGroupRef.current.rotation.set(0, playerRotY, 0);
      }
      if (cameraRef.current) {
        cameraRef.current.rotation.set(cameraPitch, 0, 0);
        cameraRef.current.updateMatrixWorld(true);
      }
      handRigRef.current?.setDesktopCameraPitch(cameraPitch);
      leftHandRigDesktopRef.current?.setDesktopCameraPitch(cameraPitch);
    };

    const isXrPresentingNow = () =>
      Boolean(xrManagerRef.current?.isInVR || rendererRef.current?.xr.isPresenting);

    const handleMouseDown = (e: MouseEvent) => {
      if (isXrPresentingNow()) return;
      if ((e.target as HTMLElement).tagName === 'CANVAS') {
        isMouseDown = true;
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
        downMouseX = e.clientX;
        downMouseY = e.clientY;
        downMouseTimeMs = performance.now();
        if (e.button === 0 && !modalOpenRef.current) {
          lmbHoldActiveRef.current = true;
          holdActionBlockedRef.current = null;
        }
        audioEngine.init();
      }
    };

    // Предварительно аллоцированные векторы для обработчиков ввода (Zero Allocation)
    const tapOriginScratch = new THREE.Vector3();
    const tapDirScratch = new THREE.Vector3();
    const tapHandScratch = new THREE.Vector3();

    const handleMouseUp = (e: MouseEvent) => {
      const wasShortCanvasClick =
        isMouseDown &&
        e.button === 0 &&
        !modalOpenRef.current &&
        !isXrPresentingNow() &&
        performance.now() - downMouseTimeMs < 260 &&
        Math.hypot(e.clientX - downMouseX, e.clientY - downMouseY) < 6;

      isMouseDown = false;
      lmbHoldActiveRef.current = false;
      holdActionBlockedRef.current = null;

      if (wasShortCanvasClick && scenario4ControllerRef.current && cameraRef.current) {
        cameraRef.current.getWorldPosition(tapOriginScratch);
        cameraRef.current.getWorldDirection(tapDirScratch).normalize();
        scenario4ControllerRef.current.onTapInteract(
          tapOriginScratch,
          tapOriginScratch,
          tapDirScratch
        );
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (lmbHoldActiveRef.current && !scenario4ControllerRef.current?.isExtinguisherArmed()) {
        if (Math.hypot(e.clientX - downMouseX, e.clientY - downMouseY) > 6) {
          lmbHoldActiveRef.current = false;
        }
      }
      // В VR вращение камеры осуществляется аппаратно датчиками гарнитуры
      if (isMouseDown && !modalOpenRef.current && playerGroupRef.current && cameraRef.current && !isXrPresentingNow()) {
        const dx = e.clientX - prevMouseX;
        const dy = e.clientY - prevMouseY;

        playerRotY -= dx * 0.003;
        cameraPitch -= dy * 0.003;
        cameraPitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, cameraPitch));

        playerGroupRef.current.rotation.y = playerRotY;
        cameraRef.current.rotation.x = cameraPitch;
        handRigRef.current?.setDesktopCameraPitch(cameraPitch);
        leftHandRigDesktopRef.current?.setDesktopCameraPitch(cameraPitch);

        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.tagName !== 'CANVAS') return;
      if (modalOpenRef.current || isXrPresentingNow()) return;
      if (Math.abs(e.deltaY) < 2) return;

      const dir: 1 | -1 = e.deltaY > 0 ? 1 : -1;
      const nextSlot = toolManagerRef.current?.cycleTool(dir, true);
      if (nextSlot) {
        selectMchsToolRef.current(nextSlot.id);
      }
    };

    // Клавиатура (игнорируем горячие клавиши при фокусе в текстовом поле ввода протокола)
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement | null)?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') {
        return;
      }

      keysRef.current[e.code] = true;
      audioEngine.init();

      if (e.code === 'Tab' || e.code === 'Escape' || e.code === 'ContextMenu') {
        e.preventDefault();
        if (!e.repeat) {
          handleEscapeOrMenuKeyRef.current();
        }
        return;
      }

      if (e.code === 'KeyH' && !e.repeat && !modalOpenRef.current) {
        const nextVis = !isHudVisibleRef.current;
        isHudVisibleRef.current = nextVis;
        setIsHudVisible(nextVis);
        vrUiSystemRef.current?.setHudVisible(nextVis);
        return;
      }

      // Быстрый выбор инструментов МЧС: [1] ДП-5В, [2] Фонарь, [3] Ствол/ОУ-5, [4] Руки, [5] Лопата, [6] Щипцы
      if (!e.repeat && !modalOpenRef.current) {
        if (e.code === 'Digit1' || e.code === 'Numpad1') selectMchsToolRef.current('dp5');
        else if (e.code === 'Digit2' || e.code === 'Numpad2') selectMchsToolRef.current('flashlight');
        else if (e.code === 'Digit3' || e.code === 'Numpad3') selectMchsToolRef.current('extinguisher');
        else if (e.code === 'Digit4' || e.code === 'Numpad4') selectMchsToolRef.current('hands');
        else if (e.code === 'Digit5' || e.code === 'Numpad5') selectMchsToolRef.current('shovel');
        else if (e.code === 'Digit6' || e.code === 'Numpad6') selectMchsToolRef.current('tongs');
      }

      if (e.code === 'KeyC' && !e.repeat && !isXrPresentingNow()) {
        desktopOverviewYRef.current = null;
        toggleCrouch();
      }
      if (e.code === 'KeyR' && !e.repeat && !isXrPresentingNow()) {
        if (activeScenarioIdRef.current === 4 && scenario4ControllerRef.current?.onPullPinShortcut()) {
          // Сорвали предохранительную чеку ОУ-5 в Сценарии 4
        } else {
          toggleExtendArm();
        }
      }
      if (e.code === 'KeyQ' && !e.repeat && !modalOpenRef.current) {
        if (activeToolIdRef.current === 'extinguisher' && toolManagerRef.current) {
          const nextMode = toolManagerRef.current.toggleNozzleSprayMode();
          setNozzleSprayMode(nextMode);
          addToast(
            'info',
            nextMode === 'SOLID' ? 'СТВОЛ ГМ-70: СПЛОШНАЯ СТРУЯ' : 'СТВОЛ ГМ-70: РАСПЫЛЁННАЯ ЗАВЕСА',
            nextMode === 'SOLID'
              ? 'Дальнобойная компактная струя (радиус 12 м) для сбивания очага с безопасной дистанции.'
              : 'Широкий конус распыла (охлаждение и осаждение аэрозоля при высокой интенсивности).'
          );
        }
      }
      if (e.code === 'KeyG' && !e.repeat && !modalOpenRef.current) {
        if (activeScenarioIdRef.current === 4 && scenario4ControllerRef.current) {
          scenario4ControllerRef.current.toggleStowExtinguisher();
        } else if (toolManagerRef.current) {
          const nextExtState = toolManagerRef.current.toggleParkExtinguisher();
          const syncedId = toolManagerRef.current.getActiveToolId();
          activeToolIdRef.current = syncedId;
          setActiveToolId(syncedId);
          addToast(
            'info',
            nextExtState === 'STOWED' ? 'ОУ-5 УБРАН' : 'ОУ-5 В РУКЕ',
            nextExtState === 'STOWED'
              ? 'Огнетушитель убран из поля зрения. Нажмите [G] или [3], чтобы вернуть в руку.'
              : 'Огнетушитель ОУ-5 переведён в боевую готовность.'
          );
        }
        return;
      }
      if (e.code === 'KeyE' && !e.repeat && !isXrPresentingNow()) {
        if (scenario4ControllerRef.current && cameraRef.current && !modalOpenRef.current) {
          cameraRef.current.getWorldPosition(tapOriginScratch);
          cameraRef.current.getWorldDirection(tapDirScratch).normalize();
          scenario4ControllerRef.current.onTapInteract(
            tapOriginScratch,
            tapOriginScratch,
            tapDirScratch
          );
        } else {
          toggleGrip();
        }
      }
      if (e.code === 'KeyT' && !e.repeat) toggleTeleport();
      if (e.code === 'KeyF' && !e.repeat) handleToggleFlashlightRef.current();
      if (e.code === 'KeyK' && !e.repeat && !modalOpenRef.current && activeScenarioIdRef.current === 4) {
        scenario4ControllerRef.current?.focusCameraOnModel();
        return;
      }
      if (
        e.code === 'Enter' &&
        !e.repeat &&
        !modalOpenRef.current &&
        !isXrPresentingNow() &&
        activeScenarioIdRef.current === 4
      ) {
        e.preventDefault();
        scenario4ControllerRef.current?.onBoardOrExitVehicle();
        return;
      }
      if (e.code === 'KeyB' && !e.repeat && !modalOpenRef.current && activeScenarioIdRef.current === 4) {
        if (scenario4ControllerRef.current?.isPlayerSeatedInVehicle()) {
          scenario4ControllerRef.current.cycleNextVehicleAutopilot();
        }
        return;
      }
      if (e.code === 'KeyL' && !e.repeat && !modalOpenRef.current && activeScenarioIdRef.current === 4) {
        scenario4ControllerRef.current?.toggleVehicleBeacons();
        return;
      }
      if (e.code === 'KeyV' && !e.repeat) {
        voiceLoggerRef.current?.startPushToTalk();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
      if (e.code === 'KeyE') {
        holdActionBlockedRef.current = null;
      }
      if (e.code === 'KeyV') {
        voiceLoggerRef.current?.stopPushToTalk();
      }
    };

    const handleWindowBlur = () => {
      isMouseDown = false;
      lmbHoldActiveRef.current = false;
      holdActionBlockedRef.current = null;
      keysRef.current = {};
      scenario4ControllerRef.current?.onStopSpray();
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    // Главный цикл рендеринга Three.js (Zero-Allocation: все scratch-объекты вынесены за цикл)
    let lastTime = performance.now();
    let chartSecondTimer = 0;
    const mirrorSavedProjMatrix = new THREE.Matrix4();
    const mirrorSavedProjMatrixInv = new THREE.Matrix4();
    const ctxRayOrigin = new THREE.Vector3();
    const ctxRayDir = new THREE.Vector3();
    const ctxObjWorldPos = new THREE.Vector3();
    const holdRayOrigin = new THREE.Vector3();
    const holdRayDir = new THREE.Vector3();
    const holdTargetWorldPos = new THREE.Vector3();
    const loopCarrierPos = new THREE.Vector3();
    const loopFallbackProbePos = new THREE.Vector3();
    const loopOperatorWorldPos = new THREE.Vector3();
    const loopSourceWorldPos = new THREE.Vector3();
    const loopRayDirProbe = new THREE.Vector3();
    const loopRayDirOperator = new THREE.Vector3();
    const loopRayProbe = new THREE.Raycaster();
    const loopRayOperator = new THREE.Raycaster();
    const loopCamDir = new THREE.Vector3();
    const s4SeatPosScratch = new THREE.Vector3();
    let prevS4VehicleSeated = false;
    let prevS4VehicleYaw = 0;
    let vrSeatedRefEyeY: number | null = null;
    const loopSourceInputs: Array<{
      activityMBq: number;
      isotopeId: string;
      distanceToProbeM: number;
      shieldIntersections: Array<{ material: ShieldMaterialType; thicknessCm: number }>;
    }> = [];
    const loopShieldPool: Array<Array<{ material: ShieldMaterialType; thicknessCm: number }>> = [];

    renderer.setAnimationLoop(() => {
      if (isWebGLContextLost) return;

      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const isVR = (xrManagerRef.current?.isInVR ?? false) || renderer.xr.isPresenting;
      const isMovementFrozen = rulesEngineRef.current?.isMovementFrozen ?? false;
      const isSeatedInS4Vehicle = Boolean(
        activeScenarioIdRef.current === 4 && scenario4ControllerRef.current?.isPlayerSeatedInVehicle()
      );

      // 1. Перемещение игрока WASD (только в Desktop-режиме и вне кабины АЦ-40)
      const isDesktopMoving = Boolean(
        !isVR &&
        !isSeatedInS4Vehicle &&
        (keysRef.current['KeyW'] || keysRef.current['KeyS'] ||
        keysRef.current['KeyA'] || keysRef.current['KeyD'] ||
        keysRef.current['ArrowUp'] || keysRef.current['ArrowDown'] ||
        keysRef.current['ArrowLeft'] || keysRef.current['ArrowRight'])
      );
      const isMovingNow = isDesktopMoving || (isVR && !isSeatedInS4Vehicle && Boolean(xrManagerRef.current?.isMoving));
      isMovingRef.current = isMovingNow;

      if (playerGroupRef.current && !isVR && !isMovementFrozen && !modalOpenRef.current && !isSeatedInS4Vehicle) {
        const isScen4 = activeScenarioIdRef.current === 4;
        const baseSpeed = isScen4 ? SCENARIO_4_CONFIG.PLAYER_MOVE_SPEED_DESKTOP : 3.2;
        const sprintMult =
          isScen4 && (keysRef.current['ShiftLeft'] || keysRef.current['ShiftRight']) ? 1.65 : 1.0;
        const moveSpeed = baseSpeed * sprintMult * dt;
        const hadMoveKey = Boolean(
          keysRef.current['KeyW'] ||
            keysRef.current['KeyS'] ||
            keysRef.current['KeyA'] ||
            keysRef.current['KeyD']
        );
        if (hadMoveKey) {
          desktopOverviewYRef.current = null;
        }
        if (keysRef.current['KeyW']) playerGroupRef.current.translateZ(-moveSpeed);
        if (keysRef.current['KeyS']) playerGroupRef.current.translateZ(moveSpeed);
        if (keysRef.current['KeyA']) playerGroupRef.current.translateX(-moveSpeed);
        if (keysRef.current['KeyD']) playerGroupRef.current.translateX(moveSpeed);

        // Фиксация высоты взгляда в desktop (либо обзорная высота после [K], либо рост оператора над уровнем площадки)
        const groundY = isScen4 ? scenario4GroundYRef.current : 0;
        const standEyeH = isScen4 ? SCENARIO_4_CONFIG.PLAYER_EYE_HEIGHT : 1.65;
        const targetY =
          desktopOverviewYRef.current !== null
            ? desktopOverviewYRef.current
            : groundY + (isCrouchedRef.current ? 0.95 : standEyeH);
        playerGroupRef.current.position.y += (targetY - playerGroupRef.current.position.y) * Math.min(1.0, dt * 10);
        scenario4ControllerRef.current?.clampPlayerPosition(playerGroupRef.current.position, false);
      }

      // 1.5. Следование 3D-манекена за ориентацией взгляда оператора и привязка ног к полу (groundY)
      if (playerAvatarRigRef.current && cameraRef.current) {
        const isScen4 = activeScenarioIdRef.current === 4;
        const avatarGroundY = isScen4 ? scenario4GroundYRef.current : 0;
        const fallbackEyeH = isScen4 ? SCENARIO_4_CONFIG.PLAYER_EYE_HEIGHT : 1.65;
        playerAvatarRigRef.current.rootGroup.position.y = isVR
          ? 0
          : avatarGroundY - (playerGroupRef.current?.position.y ?? fallbackEyeH);
        playerAvatarRigRef.current.updatePose(cameraRef.current);
      }

      // 2. Обновление WebXR (Smooth Locomotion, Turning, Перчатки Hazmat, Рейкастинг в VR UI, Gaze fallback)
      if (xrManagerRef.current && isVR && cameraRef.current) {
        try {
          xrManagerRef.current.isMovementFrozen = isMovementFrozen || isSeatedInS4Vehicle;
          xrManagerRef.current.update(dt, cameraRef.current);
          if (playerGroupRef.current && !isSeatedInS4Vehicle) {
            scenario4ControllerRef.current?.clampPlayerPosition(playerGroupRef.current.position, true);
          }
        } catch (xrErr) {
          console.warn('WebXR update frame error:', xrErr);
        }
      }

      // 3. Проверка коллизий удерживаемого предмета со стенами/полом и обновление переносимых источников (1/r² + САР)
      if (grabbedObjectRef.current) {
        checkHeldObjectCollision(grabbedObjectRef.current, sceneCollidersRef.current);
      }
      if (cameraRef.current) {
        cameraRef.current.getWorldPosition(loopCarrierPos);
      } else {
        loopCarrierPos.copy(playerGroup.position);
      }
      evacuationManager.update(dt, now * 0.001, isMovingNow, loopCarrierPos);

      // 3.2. Механика взаимодействия с удержанием (дезактивация лопатой, тушение ОУ-5, задвижки, рубильники, МДНУ)
      {
        const isDesktopHoldInput =
          !isVR && !modalOpenRef.current && (Boolean(keysRef.current['KeyE']) || lmbHoldActiveRef.current);
        const isVrHoldInput = isVR && vrRightHoldRef.current.active;
        const holdPressed = (isDesktopHoldInput || isVrHoldInput) && !grabbedObjectRef.current && !isMovementFrozen;
        let steppedHold = false;

        if (holdPressed && interactionSystemRef.current) {
          let hasRay = false;
          if (isVR && vrRightHoldRef.current.raycaster) {
            holdRayOrigin.copy(vrRightHoldRef.current.raycaster.ray.origin);
            holdRayDir.copy(vrRightHoldRef.current.raycaster.ray.direction);
            hasRay = true;
          } else if (!isVR && cameraRef.current) {
            cameraRef.current.getWorldPosition(holdRayOrigin);
            cameraRef.current.getWorldDirection(holdRayDir).normalize();
            hasRay = true;
          }

          if (hasRay) {
            const effReachM = getEffectiveReachM();
            const holdCandidate = interactionSystemRef.current.raycastInteractive(
              holdRayOrigin,
              holdRayDir,
              currentScenarioInteractive.current,
              effReachM
            );

            if (holdCandidate && !holdCandidate.interacted && holdCandidate.holdAction) {
              const envData = currentEnvGroup.current?.userData;
              const curTool = activeToolIdRef.current;
              let blockReason: string | null = null;

              if (holdCandidate.type === 'spill' && curTool !== 'shovel') {
                blockReason = 'Выберите инженерную лопату БСЛ-110 [5] для засыпки просыпи сорбентом!';
              } else if (holdCandidate.id === 'fire_tray_target' && curTool !== 'extinguisher') {
                blockReason = 'Выберите углекислотный огнетушитель / ствол [3] для тушения очага пожара!';
              } else if (holdCandidate.id === 'mdnu_diesel_pump' && !envData?.sboSimulation?.isCableConnected) {
                blockReason = 'Сначала подключите силовой кабель 0.4 кВ к шкафу резервного ввода слева!';
              } else if (
                holdCandidate.id === 'sbo_cooling_valve' &&
                (!envData?.sboSimulation?.isCableConnected || !envData?.sboSimulation?.isGeneratorRunning)
              ) {
                blockReason = 'Нет электропитания арматуры ПГ! Подключите кабель 0.4 кВ и запустите МДНУ-150.';
              }

              if (blockReason) {
                if (holdActionBlockedRef.current !== `${holdCandidate.id}:${blockReason}`) {
                  holdActionBlockedRef.current = `${holdCandidate.id}:${blockReason}`;
                  addToast('warning', 'ТРЕБУЕТСЯ ПОДГОТОВКА ОПЕРАЦИИ', blockReason);
                }
              } else {
                const actionSpec = holdCandidate.holdAction;
                const normalizedPref = actionSpec.preferredToolId === 'wrench' ? 'hands' : actionSpec.preferredToolId;
                const isPreferred = !normalizedPref || normalizedPref === curTool;
                const activeRoleSpec = COOP_ROLE_SPECIFICATIONS[coopRoleRef.current];
                const baseDuration = isPreferred ? actionSpec.durationSec : actionSpec.durationSec * 1.35;
                const effectiveDuration = baseDuration / activeRoleSpec.modifiers.holdActionSpeedMultiplier;

                holdSystem.stepHold(
                  {
                    targetId: holdCandidate.id,
                    targetMesh: holdCandidate.mesh,
                    labelRu: actionSpec.labelRu,
                    kind: actionSpec.kind,
                    durationSec: effectiveDuration,
                    preferredToolId: actionSpec.preferredToolId,
                    onProgress: p => {
                      if (actionSpec.kind === 'decontaminate' && holdCandidate.mesh.userData) {
                        const ud = holdCandidate.mesh.userData;
                        const puddleMat = ud.puddleMat as THREE.MeshStandardMaterial | undefined;
                        if (puddleMat) puddleMat.opacity = Math.max(0.08, 0.86 * (1 - p * 0.9));
                        const puddleMeshes = ud.puddleMeshes as THREE.Mesh[] | undefined;
                        const s = Math.max(0.25, 1 - p * 0.72);
                        puddleMeshes?.forEach(pm => pm.scale.set(s, 1, s));
                        const sorbentMound = ud.sorbentMound as THREE.Mesh | undefined;
                        const sorbentMat = ud.sorbentMat as THREE.MeshStandardMaterial | undefined;
                        if (sorbentMound && sorbentMat) {
                          sorbentMound.visible = true;
                          sorbentMound.scale.set(1, 0.08 + p * 0.92, 1);
                          sorbentMat.opacity = Math.min(0.96, p * 1.05);
                        }
                      } else if (actionSpec.kind === 'extinguish') {
                        const fireSim = envData?.fireSimulation as
                          | { extinguishProgress?: number }
                          | undefined;
                        if (fireSim) {
                          fireSim.extinguishProgress = p;
                        }
                      } else if (actionSpec.kind === 'valve') {
                        if (typeof holdCandidate.mesh.userData.holdBaseRotY !== 'number') {
                          holdCandidate.mesh.userData.holdBaseRotY = holdCandidate.mesh.rotation.y;
                        }
                        holdCandidate.mesh.rotation.y =
                          (holdCandidate.mesh.userData.holdBaseRotY as number) + p * Math.PI;
                      } else if (actionSpec.kind === 'breaker') {
                        const handle = holdCandidate.mesh.userData?.breakerHandle as THREE.Object3D | undefined;
                        if (handle) handle.rotation.x = p * (Math.PI / 3);
                      }
                    },
                    onComplete: () => {
                      applyCompletedHoldActionRef.current(holdCandidate);
                    }
                  },
                  dt
                );
                steppedHold = true;
              }
            }
          }
        }

        if (!steppedHold) {
          holdSystem.decay(dt);
        }
        holdSystem.updateBillboard(camera);

        const hasTargetPos = holdSystem.getTargetWorldPos(holdTargetWorldPos);
        toolManager.update(
          dt,
          now * 0.001,
          isVR,
          holdSystem.getIsHolding(),
          holdSystem.getActiveKind(),
          hasTargetPos ? holdTargetWorldPos : null
        );
      }

      // 3.3. Сценарий №4: Аварийно-спасательная операция на комплексе АЭС (/assembly.glb + HTC Vive + АЦ-40)
      if (scenario4ControllerRef.current && cameraRef.current) {
        const s4Ctrl = scenario4ControllerRef.current;
        const isMuted = audioEngine.getMuted();
        const isKeyHold = Boolean(keysRef.current['KeyE']) || Boolean(keysRef.current['Space']);
        const isDesktopSpray =
          !isVR &&
          !modalOpenRef.current &&
          (isKeyHold || (s4Ctrl.isExtinguisherArmed() && lmbHoldActiveRef.current));
        const isVrSpray = isVR && vrRightHoldRef.current.active;

        let driveThrottle = 0;
        let driveSteer = 0;
        if (isSeatedInS4Vehicle) {
          if (!isVR && !modalOpenRef.current) {
            driveThrottle =
              (keysRef.current['KeyW'] || keysRef.current['ArrowUp'] ? 1 : 0) -
              (keysRef.current['KeyS'] || keysRef.current['ArrowDown'] ? 1 : 0);
            driveSteer =
              (keysRef.current['KeyA'] || keysRef.current['ArrowLeft'] ? 1 : 0) -
              (keysRef.current['KeyD'] || keysRef.current['ArrowRight'] ? 1 : 0);
          } else if (isVR && xrManagerRef.current) {
            const leftVr = xrManagerRef.current.getControllerInput('left');
            driveThrottle = -leftVr.moveY;
            driveSteer = -leftVr.moveX;
          }
        }

        const s4Snap = s4Ctrl.stepWithInput({
          dt,
          viveInput: {
            isVR,
            camera: cameraRef.current,
            vrRightHandAnchor: xrManagerRef.current?.rightHandRig?.rootGroup ?? null,
            vrRightRaycaster: vrRightHoldRef.current.raycaster
          },
          isSprayingInput: isDesktopSpray || isVrSpray,
          isMuted,
          cumulativeDoseMsv: cumulativeDoseRef.current,
          isMovementFrozen,
          vehicleDriveInput: isSeatedInS4Vehicle
            ? { throttle: driveThrottle, steer: driveSteer }
            : undefined
        });

        // Синхронизация кабины водителя АЦ-40 с группой игрока (Desktop + VR)
        const seatInfo = s4Ctrl.getVehicleSeatWorldTransform(s4SeatPosScratch);
        if (seatInfo.seated && playerGroupRef.current) {
          desktopOverviewYRef.current = null;
          if (!prevS4VehicleSeated) {
            prevS4VehicleYaw = seatInfo.yaw;
            if (!isVR) {
              playerRotY = seatInfo.yaw + Math.PI;
              cameraPitch = AC40_CAB_CONFIG.desktopInitialPitchRad;
              playerGroupRef.current.rotation.set(0, playerRotY, 0);
              cameraRef.current.rotation.set(cameraPitch, 0, 0);
              handRigRef.current?.setDesktopCameraPitch(cameraPitch);
              leftHandRigDesktopRef.current?.setDesktopCameraPitch(cameraPitch);
            } else {
              playerGroupRef.current.rotation.set(0, seatInfo.yaw + Math.PI, 0);
              vrSeatedRefEyeY = THREE.MathUtils.clamp(
                cameraRef.current.position.y || SCENARIO_4_CONFIG.PLAYER_EYE_HEIGHT,
                AC40_CAB_CONFIG.vrMinEyeY,
                AC40_CAB_CONFIG.vrMaxEyeY
              );
            }
          } else {
            let dYaw = seatInfo.yaw - prevS4VehicleYaw;
            while (dYaw > Math.PI) dYaw -= Math.PI * 2;
            while (dYaw < -Math.PI) dYaw += Math.PI * 2;
            prevS4VehicleYaw = seatInfo.yaw;
            if (!isVR) {
              playerRotY += dYaw;
              playerGroupRef.current.rotation.y = playerRotY;
            } else {
              playerGroupRef.current.rotation.y += dYaw;
            }
          }

          if (!isVR) {
            // За рулём в Desktop убираем навесные руки от камеры, чтобы приборы, руль и пульт МЧС не перекрывались
            if (handRigRef.current) handRigRef.current.rootGroup.visible = false;
            if (leftHandRigDesktopRef.current) leftHandRigDesktopRef.current.rootGroup.visible = false;
          }

          if (isVR) {
            const refEyeY = vrSeatedRefEyeY ?? SCENARIO_4_CONFIG.PLAYER_EYE_HEIGHT;
            const vrSeatY =
              xrManagerRef.current?.activeReferenceSpaceType === 'local-floor'
                ? s4SeatPosScratch.y - refEyeY
                : s4SeatPosScratch.y;
            playerGroupRef.current.position.set(s4SeatPosScratch.x, vrSeatY, s4SeatPosScratch.z);
          } else {
            playerGroupRef.current.position.copy(s4SeatPosScratch);
          }
        } else if (prevS4VehicleSeated && !seatInfo.seated && playerGroupRef.current) {
          vrSeatedRefEyeY = null;
          if (!isVR) {
            if (handRigRef.current) handRigRef.current.rootGroup.visible = true;
            if (leftHandRigDesktopRef.current) leftHandRigDesktopRef.current.rootGroup.visible = true;
          } else if (xrManagerRef.current?.activeReferenceSpaceType === 'local-floor') {
            playerGroupRef.current.position.y = scenario4GroundYRef.current;
          }
        }
        prevS4VehicleSeated = seatInfo.seated;

        if (s4Snap.stepNumber !== lastScen4StepNumRef.current) {
          lastScen4StepNumRef.current = s4Snap.stepNumber;
          setScenarioStep(s4Snap.stepNumber - 1);
        }

        const s4Key = [
          s4Snap.isLoadingGlb ? 1 : 0,
          Math.round(s4Snap.loadProgressPct),
          s4Snap.loadErrorRu ?? '',
          s4Snap.stepId,
          s4Snap.firesExtinguished,
          s4Snap.rescuedCount,
          s4Snap.extinguisherStatus,
          s4Snap.extinguisherLifecycleState,
          s4Snap.extinguisherChargePct,
          s4Snap.isSpraying ? 1 : 0,
          Math.round(s4Snap.thermalHeatLoad01 * 20),
          Math.round(s4Snap.smokeExposure01 * 10),
          s4Snap.installedEquipmentCount,
          s4Snap.vehicle.isSeated ? 1 : 0,
          s4Snap.vehicle.nearDoor ? 1 : 0,
          s4Snap.vehicle.nearHoseReel ? 1 : 0,
          s4Snap.vehicle.isHoseAttached ? 1 : 0,
          s4Snap.vehicle.speedKmh,
          s4Snap.vehicle.autopilotTargetName ?? '',
          Math.round(s4Snap.vehicle.hoseLengthM),
          s4Snap.vehicle.hoseOverstretched ? 1 : 0,
          s4Snap.vehicle.beaconsOn ? 1 : 0,
          s4Snap.emergencyOps.radReconDone ? 1 : 0,
          Math.round(s4Snap.emergencyOps.radReconProgress01 * 10),
          s4Snap.emergencyOps.loopIsolated ? 1 : 0,
          s4Snap.emergencyOps.casualtyStabilized ? 1 : 0,
          s4Snap.targetPromptRu ?? '',
          s4Snap.warningBannerRu ?? '',
          s4Snap.safetyErrorCount,
          s4Snap.debrief ? 1 : 0,
          s4Snap.activeInputLabelRu
        ].join(':');
        if (s4Key !== lastScen4SnapKeyRef.current) {
          lastScen4SnapKeyRef.current = s4Key;
          setScenario4Snapshot(s4Snap);
        }
      } else {
        if (prevS4VehicleSeated && !isVR) {
          if (handRigRef.current) handRigRef.current.rootGroup.visible = true;
          if (leftHandRigDesktopRef.current) leftHandRigDesktopRef.current.rootGroup.visible = true;
        }
        vrSeatedRefEyeY = null;
        prevS4VehicleSeated = false;
      }

      if (flashlightMeshRef.current && isFlashlightOnRef.current) {
        flashlightMeshRef.current.updateMatrixWorld(true);
      }

      // 3.5. Динамическая адаптация глаза (HDR Exposure) при включении тактического фонаря в темных помещениях
      const targetExposure = isLowLightModeRef.current
        ? isFlashlightOnRef.current
          ? 0.96
          : 1.28
        : isFlashlightOnRef.current
        ? 1.06
        : 1.15;
      renderer.toneMappingExposure +=
        (targetExposure - renderer.toneMappingExposure) * Math.min(1.0, dt * 3.5);

      // 4. Физический расчет мощности дозы D(t) с учетом 4 фундаментальных факторов защиты:
      //    - Защита экранированием (теневая и стационарная: свинец, бетон, сталь, вода, полиэтилен)
      //    - Средства индивидуальной защиты СИЗ (100% задержка α, расчет пробега β по соотношению Каца-Пенфолда)
      //    - Защита расстоянием и дистанционный инструмент (закон обратных квадратов 1/r²)
      //    - Защита временем (интеграл H(t) методом трапеций/Симпсона и контроль лимита наряда-допуска)
      const activeHandRig =
        isVR && xrManagerRef.current?.rightHandRig
          ? xrManagerRef.current.rightHandRig
          : handRigRef.current;
      const probeWorldPos = activeHandRig
        ? activeHandRig.probeTipWorldPos
        : loopFallbackProbePos.set(0, 0, 0);
      const activeVisExtM = activeHandRig ? activeHandRig.getVisualProbeExtensionM() : 0;

      if (cameraRef.current) {
        cameraRef.current.getWorldPosition(loopOperatorWorldPos);
      } else {
        loopOperatorWorldPos.copy(probeWorldPos);
      }
      const operatorWorldPos = loopOperatorWorldPos;

      let minSourceDist = 999;
      let minUnshieldedSourceDist = 999;

      loopSourceInputs.length = 0;
      const srcList = currentScenarioSources.current;
      const shieldList = currentScenarioShields.current;
      for (let si = 0; si < srcList.length; si++) {
        const source = srcList[si];
        if (source.mesh) {
          source.mesh.updateMatrixWorld(true);
          source.mesh.getWorldPosition(loopSourceWorldPos);
        } else {
          loopSourceWorldPos.copy(source.position);
        }
        // Компенсируем визуальное смещение выдвинутой штанги/манипулятора на 3D-кисти,
        // чтобы calculateComprehensiveProtection корректно прибавил remoteTool.addedDistanceM ровно 1 раз
        const dist = Math.max(0.1, probeWorldPos.distanceTo(loopSourceWorldPos) + activeVisExtM);
        if (dist < minSourceDist) minSourceDist = dist;

        let shieldIntersections = loopShieldPool[si];
        if (!shieldIntersections) {
          shieldIntersections = [];
          loopShieldPool[si] = shieldIntersections;
        }
        shieldIntersections.length = 0;

        // Если источник помещен внутрь защитного контейнера (например, ТК-6) и не удерживается в руке
        if (source.enclosedInShield && grabbedObjectRef.current !== source.mesh) {
          shieldIntersections.push(source.enclosedInShield);
        }

        const operatorDist = Math.max(0.1, operatorWorldPos.distanceTo(loopSourceWorldPos));
        loopRayDirProbe.subVectors(loopSourceWorldPos, probeWorldPos).normalize();
        loopRayDirOperator.subVectors(loopSourceWorldPos, operatorWorldPos).normalize();
        loopRayProbe.set(probeWorldPos, loopRayDirProbe);
        loopRayProbe.near = 0;
        loopRayProbe.far = Math.max(0.1, probeWorldPos.distanceTo(loopSourceWorldPos));
        loopRayOperator.set(operatorWorldPos, loopRayDirOperator);
        loopRayOperator.near = 0;
        loopRayOperator.far = operatorDist;

        for (let shi = 0; shi < shieldList.length; shi++) {
          const shield = shieldList[shi];
          shield.mesh.updateMatrixWorld(true);
          const hitsProbe = loopRayProbe.intersectObject(shield.mesh, true);
          const hitsOperator =
            hitsProbe.length > 0 ? hitsProbe : loopRayOperator.intersectObject(shield.mesh, true);
          if (hitsProbe.length > 0 || hitsOperator.length > 0) {
            shieldIntersections.push({
              material: shield.material,
              thicknessCm: shield.thicknessCm
            });
          }
        }

        if (shieldIntersections.length === 0 && operatorDist < minUnshieldedSourceDist) {
          minUnshieldedSourceDist = operatorDist;
        }

        loopSourceInputs.push({
          activityMBq: source.activityMBq,
          isotopeId: source.isotopeId,
          distanceToProbeM: dist,
          shieldIntersections
        });
      }

      const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
      const compAnalysis = calculateComprehensiveProtection({
        sources: loopSourceInputs,
        ppeLoadoutId: selectedPpeIdRef.current,
        suitId: characterPpeStateRef.current.suitId,
        respiratorId: characterPpeStateRef.current.respiratorId,
        remoteToolId: selectedRemoteToolIdRef.current,
        isArmExtended: isExtendedArmRef.current,
        ventilationRateLitersPerMin: physioTelemetryRef.current?.airConsumptionLitersPerMin ?? 22.0,
        hasAirborneContamination: Boolean(activeScen?.hasAirborneContamination)
      });

      const theoreticalDoseRate = compAnalysis.finalProtectedDoseRateMicroSv;
      currentDoseRateRef.current = theoreticalDoseRate;
      protectionAnalysisRef.current = compAnalysis;

      // 5. Моделирование инерционности и статистической погрешности детектора по ГОСТ 27451-87
      const currentInstrId = selectedInstrumentIdRef.current;
      const instrument = GOST_INSTRUMENTS[currentInstrId];
      const activeRoleSpecLoop = COOP_ROLE_SPECIFICATIONS[coopRoleRef.current];
      if (missionTimeRef.current === 0 && smoothedReadingRef.current === 0) {
        smoothedReadingRef.current = theoreticalDoseRate;
      }
      const simulatedRate = simulateDetectorReading(
        smoothedReadingRef.current,
        theoreticalDoseRate,
        instrument,
        dt * activeRoleSpecLoop.modifiers.detectorResponseBonus
      );
      smoothedReadingRef.current = simulatedRate;

      // Численное интегрирование накопленной эквивалентной дозы H_accum(t) = \int_0^t \dot{D}(\tau) d\tau
      // с верификацией сходимости методов Трапеций и Симпсона 1/3 (< 0.1%)
      const isFailedNow = rulesEngineRef.current?.isMovementFrozen ?? false;
      const integrationSnapshot = isFailedNow
        ? {
            cumulativeDoseMsv: cumulativeDoseRef.current,
            trapezoidalMsv: cumulativeDoseRef.current,
            simpsonMsv: cumulativeDoseRef.current,
            convergenceErrorPercent: 0,
            elapsedSec: missionTimeRef.current
          }
        : doseIntegratorRef.current.step(theoreticalDoseRate, dt);
      cumulativeDoseRef.current = integrationSnapshot.cumulativeDoseMsv;
      missionTimeRef.current = integrationSnapshot.elapsedSec;

      const heldObj = grabbedObjectRef.current;
      const isHoldingRadSource = Boolean(
        heldObj &&
          (currentScenarioSources.current.some(s => s.mesh === heldObj) ||
            currentScenarioInteractive.current.some(
              i => i.mesh === heldObj && (i.type === 'source' || i.type === 'sample')
            ))
      );

      const isSourceEnclosedInContainer = currentScenarioSources.current.every(s =>
        Boolean(s.enclosedInShield)
      );

      // 5.5. Оценка условий проигрыша и 80% порога предупреждения через ScenarioRulesEngine
      const rulesSnapshot =
        rulesEngineRef.current?.evaluateStep(
          {
            scenarioId: activeScenarioIdRef.current,
            elapsedSec: missionTimeRef.current,
            cumulativeDoseMsv: cumulativeDoseRef.current,
            currentDoseRateMicroSv: theoreticalDoseRate,
            permitLimitMsv: permitLimitMsvRef.current,
            distanceToNearestSourceM: minSourceDist,
            ppeLoadoutId: selectedPpeIdRef.current,
            remoteToolId: selectedRemoteToolIdRef.current,
            kShield: compAnalysis.kShield,
            activeShieldMaterialRu: compAnalysis.activeShieldMaterialRu,
            isHoldingRadioactiveSource: isHoldingRadSource,
            isSourceEnclosedInContainer
          },
          dt
        ) ?? null;

      // 5.6. Трекинг достигнутых пределов облучения и пороговых зон за всю сессию (для PDF-отчета)
      {
        const tracker = sessionExposureLimitsRef.current;
        const tSec = missionTimeRef.current;
        const pLimit = Math.max(0.001, permitLimitMsvRef.current);
        const accumMsv = cumulativeDoseRef.current;
        const activeCfg = ScenarioConfigRegistry.getConfig(activeScenarioIdRef.current);
        const warnRatio = Math.min(
          activeCfg?.warningThresholdRatio ?? 0.8,
          activeRoleSpecLoop.modifiers.earlyWarningRatio
        );
        const tMax = Math.max(1, activeCfg?.tMaxSec ?? 300);

        const pushLimitEventOnce = (
          code: string,
          labelRu: string,
          measuredValue: string,
          thresholdValue: string,
          severity: 'INFO' | 'WARNING' | 'CRITICAL'
        ) => {
          if (!tracker.limitEvents.some(e => e.code === code)) {
            tracker.limitEvents.push({
              elapsedSec: tSec,
              code,
              labelRu,
              measuredValue,
              thresholdValue,
              severity
            });
          }
        };

        if (theoreticalDoseRate > tracker.peakProtectedRateMicroSv) {
          tracker.peakProtectedRateMicroSv = theoreticalDoseRate;
          tracker.peakProtectedRateAtSec = tSec;
        }
        if (compAnalysis.unshieldedBaseDoseRateMicroSv > tracker.peakUnshieldedRateMicroSv) {
          tracker.peakUnshieldedRateMicroSv = compAnalysis.unshieldedBaseDoseRateMicroSv;
        }
        if (accumMsv > tracker.peakCumulativeDoseMsv) {
          tracker.peakCumulativeDoseMsv = accumMsv;
        }
        if (tracker.minDistanceM === null || compAnalysis.baseDistanceM < tracker.minDistanceM) {
          tracker.minDistanceM = compAnalysis.baseDistanceM;
        }
        if (compAnalysis.kProtTotal > tracker.maxTotalProtectionFactor) {
          tracker.maxTotalProtectionFactor = compAnalysis.kProtTotal;
        }

        if (theoreticalDoseRate >= 12) {
          tracker.secondsInControlledZone += dt;
          if (tracker.controlledZoneEnteredAtSec === null) {
            tracker.controlledZoneEnteredAtSec = tSec;
            pushLimitEventOnce(
              'ZONE_CONTROLLED_12',
              'Вход в зону контролируемого доступа (>= 12 мкЗв/ч)',
              `${theoreticalDoseRate.toFixed(1)} мкЗв/ч`,
              '12.0 мкЗв/ч',
              'INFO'
            );
          }
        }
        if (theoreticalDoseRate >= 800) {
          tracker.secondsInYellowZone += dt;
          if (tracker.yellowZoneEnteredAtSec === null) {
            tracker.yellowZoneEnteredAtSec = tSec;
            pushLimitEventOnce(
              'ZONE_YELLOW_800',
              'Порог оперативной Желтой зоны МЭД (>= 800 мкЗв/ч)',
              `${theoreticalDoseRate.toFixed(1)} мкЗв/ч`,
              '800 мкЗв/ч',
              'WARNING'
            );
          }
        }
        if (theoreticalDoseRate >= 1000) {
          tracker.secondsInStrictZone += dt;
          if (tracker.strictZoneEnteredAtSec === null) {
            tracker.strictZoneEnteredAtSec = tSec;
            pushLimitEventOnce(
              'ZONE_STRICT_1000',
              'Вход в зону строгого режима ОСПОРБ-99 (>= 1.0 мЗв/ч)',
              `${(theoreticalDoseRate / 1000).toFixed(2)} мЗв/ч`,
              '1.00 мЗв/ч',
              'WARNING'
            );
          }
        }
        if (theoreticalDoseRate >= 8000 || rulesSnapshot?.zoneAlertLevel === 'red_retreat') {
          tracker.secondsInRedRetreatZone += dt;
          if (tracker.redRetreatEnteredAtSec === null) {
            tracker.redRetreatEnteredAtSec = tSec;
            pushLimitEventOnce(
              'ZONE_RED_RETREAT_8000',
              'Красная зона экстренного отступления (>= 8.0 мЗв/ч)',
              `${(theoreticalDoseRate / 1000).toFixed(2)} мЗв/ч`,
              '8.00 мЗв/ч',
              'CRITICAL'
            );
          }
        }
        if (accumMsv >= pLimit * warnRatio && tracker.doseWarn80ReachedAtSec === null) {
          tracker.doseWarn80ReachedAtSec = tSec;
          pushLimitEventOnce(
            'DOSE_WARN_80',
            `Достигнут предупредительный порог ${(warnRatio * 100).toFixed(0)}% H_limit`,
            `${(accumMsv * 1000).toFixed(1)} мкЗв`,
            `${(pLimit * warnRatio * 1000).toFixed(1)} мкЗв`,
            'WARNING'
          );
        }
        if (accumMsv >= pLimit && tracker.doseLimit100ReachedAtSec === null) {
          tracker.doseLimit100ReachedAtSec = tSec;
          pushLimitEventOnce(
            'DOSE_LIMIT_100',
            'Превышен предел индивидуальной дозы по наряду-допуску (100% H_limit)',
            `${(accumMsv * 1000).toFixed(1)} мкЗв`,
            `${(pLimit * 1000).toFixed(1)} мкЗв`,
            'CRITICAL'
          );
        }
        if (tSec >= tMax * warnRatio && tracker.timeWarn80ReachedAtSec === null) {
          tracker.timeWarn80ReachedAtSec = tSec;
          pushLimitEventOnce(
            'TIME_WARN_80',
            `Достигнуто ${(warnRatio * 100).toFixed(0)}% норматива времени T_max`,
            `${tSec.toFixed(1)} с`,
            `${(tMax * warnRatio).toFixed(0)} с`,
            'WARNING'
          );
        }
        if (tSec >= tMax && tracker.timeLimit100ReachedAtSec === null) {
          tracker.timeLimit100ReachedAtSec = tSec;
          pushLimitEventOnce(
            'TIME_LIMIT_100',
            'Превышен норматив времени пребывания в зоне T_max',
            `${tSec.toFixed(1)} с`,
            `${tMax} с`,
            'CRITICAL'
          );
        }
      }

      // Автоматическое предупреждение при превышении нормативной карточки наряда-допуска (Защита временем)
      if (
        !permitLimitWarnedRef.current &&
        cumulativeDoseRef.current >= permitLimitMsvRef.current &&
        permitLimitMsvRef.current > 0
      ) {
        permitLimitWarnedRef.current = true;
        addToast(
          'danger',
          'ПРЕВЫШЕН ПРЕДЕЛ ДОЗЫ НАРЯДА-ДОПУСКА!',
          `Накопленная доза достигла лимита ${(permitLimitMsvRef.current * 1000).toFixed(0)} мкЗв! Немедленно покиньте зону работ.`
        );
        audioEngineRef.current?.playAlarmSiren();
      }

      // Обновление дисплеев, виброотклика (пропорционально dD/dt) и перчаток
      if (isVR && xrManagerRef.current) {
        xrManagerRef.current.rightHandRig?.renderLCD(simulatedRate, currentInstrId);
        const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
        const curTask =
          activeScen.id === 4 && scenario4ControllerRef.current
            ? scenario4ControllerRef.current.getHudSnapshot().instructionRu
            : activeScen.stages[scenarioStepRef.current]?.taskRu || activeScen.titleRu;

        xrManagerRef.current.hapticStrength = hapticStrengthRef.current;
        const effectiveHaptic = xrManagerRef.current.triggerHaptics(
          theoreticalDoseRate,
          isHoldingRadSource,
          interactionSystemRef.current?.activeControllerIndex ?? null
        );

        const curToolSlot = TOOL_SLOTS.find(s => s.id === activeToolIdRef.current) || TOOL_SLOTS[0];
        const curHoldSnap = holdSystem.getSnapshot();
        xrManagerRef.current.updateVRWristDisplay(
          theoreticalDoseRate,
          cumulativeDoseRef.current,
          curTask,
          isFlashlightOnRef.current,
          hapticStrengthRef.current,
          curToolSlot.shortNameRu,
          curHoldSnap.isHolding ? Math.round(curHoldSnap.progress * 100) : null
        );

        // Обновление пространственного VR UI (HUD) с индикацией 80% предупреждения и окна Game Over
        if (vrUiSystemRef.current && cameraRef.current) {
          vrUiSystemRef.current.updateOrientation(dt, cameraRef.current);
          const zone = evaluateRadiationZone(theoreticalDoseRate);
          const vLogger = voiceLoggerRef.current;
          const latestVToast = vLogger?.getLatestActiveToast();
          const activeCfg = rulesEngineRef.current?.getConfig();
          vrUiSystemRef.current.renderHUD({
            currentDoseRateMicroSv: theoreticalDoseRate,
            cumulativeDoseMsv: cumulativeDoseRef.current,
            missionTimeSec: missionTimeRef.current,
            selectedInstrumentId: currentInstrId,
            threatLevel: zone.threatLevel,
            zoneName: zone.zoneName,
            scenarioTitle: activeScen.titleRu,
            scenarioTask: curTask,
            vitalsBpm,
            distanceToSourceM: minSourceDist,
            isFlashlightOn: isFlashlightOnRef.current,
            isFlashlightEquipped: isFlashlightEquippedRef.current,
            hapticStrength: hapticStrengthRef.current,
            effectiveHapticIntensity: effectiveHaptic,
            isHoldingSource: isHoldingRadSource,
            isVoicePushToTalkActive: vLogger?.isPushToTalkActive ?? false,
            voiceVolumeLevel: vLogger?.volumeLevel ?? 0,
            voiceMode: vLogger?.mode ?? 'hybrid',
            latestVoiceNoteText:
              vLogger?.isPushToTalkActive && vLogger.interimTranscript
                ? vLogger.interimTranscript
                : latestVToast?.text,
            voiceLogCount: vLogger?.getLogs().length ?? 0,
            isWarning80Active: rulesSnapshot?.isWarning80Active ?? false,
            warning80Message: rulesSnapshot?.warning80MessageRu ?? '',
            doseRatioPercent: (rulesSnapshot?.doseProgressRatio ?? 0) * 100,
            timeRatioPercent: (rulesSnapshot?.timeProgressRatio ?? 0) * 100,
            isScenarioFailed: rulesSnapshot?.isFailed ?? false,
            scenarioFailedTitle: rulesSnapshot?.failState?.titleRu ?? '',
            scenarioFailedReason: rulesSnapshot?.failState?.reasonRu ?? '',
            scenarioFailedCountdownSec: rulesSnapshot?.failState?.countdownSec ?? 5.0,
            hLimitMsv: activeCfg?.hLimitMsv ?? permitLimitMsvRef.current,
            tMaxSec: activeCfg?.tMaxSec ?? null
          });

          if (vrUiSystemRef.current.isChecklistModalOpen) {
            vrUiSystemRef.current.updateChecklistLive(
              scenarioStepRef.current,
              activeScen.stages,
              (rulesSnapshot?.isFailed ?? false) || (rulesSnapshot?.isWarning80Active ?? false)
            );
          }
        }
      } else if (handRigRef.current) {
        handRigRef.current.update(dt, false);
        handRigRef.current.renderLCD(simulatedRate, currentInstrId);
        leftHandRigDesktopRef.current?.update(dt, false);
        voiceLoggerRef.current?.update(dt);
      }

      // Аудио отклик детектора (динамические пороговые зоны: желтая — пульсация прибора, красная — непрерывный треск и сирена)
      if (audioEngineRef.current) {
        const isRedZone = rulesSnapshot?.zoneAlertLevel === 'red_retreat';
        const isYellowZone = rulesSnapshot?.zoneAlertLevel === 'yellow';

        const crackleMultiplier = isRedZone
          ? 6.0
          : isYellowZone
          ? 2.8
          : (rulesSnapshot?.audioCrackleMultiplier ?? 1.0);

        audioEngineRef.current.updateAudio(
          simulatedRate,
          instrument,
          dt,
          crackleMultiplier
        );

        // Звуковые оповещения динамических зон:
        if (isRedZone) {
          const nowMs = performance.now();
          if (nowMs - lastRedAlertSoundTimeRef.current >= 450) {
            lastRedAlertSoundTimeRef.current = nowMs;
            audioEngineRef.current.playRedZoneAlarm();
          }
        } else if (isYellowZone) {
          const nowMs = performance.now();
          if (nowMs - lastYellowAlertSoundTimeRef.current >= 1200) {
            lastYellowAlertSoundTimeRef.current = nowMs;
            audioEngineRef.current.playYellowZonePulse();
          }
        }
      }
      if (radiationFieldRef.current) {
        radiationFieldRef.current.update(dt, theoreticalDoseRate, currentScenarioSources.current);
      }
      if (radiationSourceVisualizerRef.current && camera) {
        radiationSourceVisualizerRef.current.update(dt, camera);
      }

      // 5.8. Процедурные анимации объектов сценариев МЧС АЭС (без аллокаций в кадре)
      const envUD = currentEnvGroup.current?.userData;
      if (envUD?.evacArrows && Array.isArray(envUD.evacArrows) && envUD.evacArrows.length > 0) {
        const firstArrow = envUD.evacArrows[0] as THREE.Mesh;
        const arrowMat = firstArrow.material as THREE.MeshBasicMaterial | undefined;
        if (arrowMat) {
          arrowMat.opacity = 0.42 + 0.48 * (0.5 + 0.5 * Math.sin(now * 0.0055));
        }
      }
      if (envUD?.fireSimulation) {
        const fireSim = envUD.fireSimulation as {
          flameFlames: THREE.Mesh[];
          smokePuffs: THREE.Mesh[];
          fireLight: THREE.PointLight;
          sparkGroup: THREE.Group;
          isPowerEnergized: boolean;
          isFireExtinguished: boolean;
          extinguishProgress?: number;
        };
        if (!fireSim.isFireExtinguished) {
          const suppressScale = Math.max(0.14, 1 - (fireSim.extinguishProgress ?? 0) * 0.86);
          const tFire = now * 0.009;
          for (let i = 0; i < fireSim.flameFlames.length; i++) {
            const flame = fireSim.flameFlames[i];
            const flicker = 0.78 + 0.38 * Math.sin(tFire + i * 1.4);
            flame.scale.set(
              (0.92 + 0.12 * Math.cos(tFire + i)) * suppressScale,
              flicker * suppressScale,
              (0.92 + 0.12 * Math.sin(tFire * 1.1 + i)) * suppressScale
            );
          }
          for (let i = 0; i < fireSim.smokePuffs.length; i++) {
            const puff = fireSim.smokePuffs[i];
            puff.position.y = 1.0 + ((i * 0.34 + now * 0.00055) % 2.1);
          }
          fireSim.fireLight.intensity = (3.4 + 1.6 * Math.sin(now * 0.022)) * suppressScale;
          if (fireSim.isPowerEnergized) {
            fireSim.sparkGroup.visible = Math.sin(now * 0.045) > -0.25;
            fireSim.sparkGroup.rotation.y = now * 0.012;
          } else {
            fireSim.sparkGroup.visible = false;
          }
        } else {
          fireSim.fireLight.intensity = 0;
          fireSim.sparkGroup.visible = false;
        }
      }
      if (envUD?.sboSimulation) {
        const sboSim = envUD.sboSimulation as {
          emergencyLight: THREE.PointLight;
          isCoolingRestored: boolean;
          isGeneratorRunning: boolean;
        };
        if (!sboSim.isCoolingRestored) {
          const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now * 0.008));
          sboSim.emergencyLight.intensity = (sboSim.isGeneratorRunning ? 1.4 : 2.6) * pulse;
        } else {
          sboSim.emergencyLight.intensity = 1.8;
        }
      }

      // Обновление параболической дуги телепортации на десктопе (клавиша T)
      if (cameraRef.current && xrManagerRef.current && !isVR) {
        cameraRef.current.getWorldDirection(loopCamDir);
        xrManagerRef.current.updateTeleportArc(probeWorldPos, loopCamDir);

        if (
          keysRef.current['KeyT'] &&
          xrManagerRef.current.targetRing.visible &&
          !isMovementFrozen
        ) {
          playerGroup.position.x = xrManagerRef.current.targetRing.position.x;
          playerGroup.position.z = xrManagerRef.current.targetRing.position.z;
          setIsTeleportActive(false);
          xrManagerRef.current.isTeleportActive = false;
        }
      }

      // 6. Периодическое обновление React HUD с dirty-checking (не чаще 1 раза в 220 мс)
      chartSecondTimer += dt;
      if (chartSecondTimer >= 0.22) {
        chartSecondTimer = 0;

        const doseRateKey =
          theoreticalDoseRate < 1000
            ? theoreticalDoseRate.toFixed(1)
            : (theoreticalDoseRate / 1000).toFixed(2);
        if (doseRateKey !== lastHudDoseKeyRef.current) {
          lastHudDoseKeyRef.current = doseRateKey;
          setCurrentDoseRateMicroSv(theoreticalDoseRate);
        }

        const cumDoseKey = (cumulativeDoseRef.current * 1000).toFixed(1);
        if (cumDoseKey !== lastHudCumDoseKeyRef.current) {
          lastHudCumDoseKeyRef.current = cumDoseKey;
          setCumulativeDoseMsv(cumulativeDoseRef.current);
        }

        const wholeMissionSec = Math.floor(missionTimeRef.current);
        if (wholeMissionSec !== lastHudMissionSecRef.current) {
          lastHudMissionSecRef.current = wholeMissionSec;
          setMissionTimeSec(missionTimeRef.current);
        }

        const protKey = `${compAnalysis.kProtTotal.toFixed(1)}:${compAnalysis.kShield.toFixed(1)}:${compAnalysis.kPpe.toFixed(1)}:${compAnalysis.baseDistanceM.toFixed(1)}`;
        if (protKey !== lastHudProtKeyRef.current) {
          lastHudProtKeyRef.current = protKey;
          setProtectionAnalysis(compAnalysis);
        }

        if (rulesSnapshot) {
          const rulesKey = `${rulesSnapshot.isFailed ? 1 : 0}:${rulesSnapshot.isWarning80Active ? 1 : 0}:${rulesSnapshot.zoneAlertLevel}:${rulesSnapshot.isRetreatCountdownActive ? Math.ceil(rulesSnapshot.retreatCountdownRemainingSec) : 0}:${Math.round(rulesSnapshot.doseProgressRatio * 50)}:${Math.round(rulesSnapshot.timeProgressRatio * 50)}`;
          if (rulesKey !== lastHudRulesKeyRef.current) {
            lastHudRulesKeyRef.current = rulesKey;
            setRulesEvaluation({
              ...rulesSnapshot,
              failState: rulesSnapshot.failState ? { ...rulesSnapshot.failState } : null
            });
          }
        }

        // Оценка радиационной зоны по ОСПОРБ-99/2010
        const zone = evaluateRadiationZone(theoreticalDoseRate);
        const zoneKey = `${zone.threatLevel}:${zone.zoneName}`;
        if (zoneKey !== lastHudZoneKeyRef.current) {
          lastHudZoneKeyRef.current = zoneKey;
          setThreatLevel(zone.threatLevel);
          setZoneName(zone.zoneName);
        }

        // Контекстная проверка объекта под прицелом или в руке (для единой подсказки у прицела)
        let nextTarget: TargetedObjectContext | null = null;
        const heldMeta = interactionSystemRef.current?.grabbedItemMeta;
        if (heldMeta) {
          nextTarget = {
            id: heldMeta.id,
            nameRu: heldMeta.nameRu,
            type: heldMeta.type,
            distanceM: 0,
            isGrabbed: true,
            requiresTongs: heldMeta.requiresTongs
          };
        } else if (!isVR && cameraRef.current && interactionSystemRef.current) {
          cameraRef.current.getWorldPosition(ctxRayOrigin);
          cameraRef.current.getWorldDirection(ctxRayDir);
          const hitMeta = interactionSystemRef.current.raycastInteractive(
            ctxRayOrigin,
            ctxRayDir,
            currentScenarioInteractive.current,
            getEffectiveReachM()
          );
          if (hitMeta) {
            hitMeta.mesh.getWorldPosition(ctxObjWorldPos);
            const rawPrefToolId = hitMeta.holdAction?.preferredToolId;
            const prefToolId = rawPrefToolId === 'wrench' ? 'hands' : rawPrefToolId;
            const recSlot = hitMeta.requiresTongs
              ? 6
              : prefToolId
              ? TOOL_SLOTS.find(s => s.id === prefToolId)?.slot
              : undefined;
            nextTarget = {
              id: hitMeta.id,
              nameRu: hitMeta.nameRu,
              type: hitMeta.type,
              distanceM: ctxRayOrigin.distanceTo(ctxObjWorldPos),
              isGrabbed: false,
              holdPromptRu: !hitMeta.interacted ? hitMeta.holdAction?.labelRu : undefined,
              requiresTongs: hitMeta.requiresTongs,
              recommendedSlot: recSlot
            };
          }
        }
        const nextTargetKey = nextTarget
          ? `${nextTarget.id}:${nextTarget.isGrabbed ? 1 : 0}:${nextTarget.distanceM.toFixed(1)}:${nextTarget.holdPromptRu ?? ''}:${nextTarget.recommendedSlot ?? 0}`
          : '';
        if (nextTargetKey !== targetedObjectKeyRef.current) {
          targetedObjectKeyRef.current = nextTargetKey;
          setTargetedObject(nextTarget);
        }

        // Синхронизация состояния эвакуации САР и метрик МЧС в HUD (с троттлингом по ключу)
        const nextCarried = evacuationManager.getCarriedInfo(loopCarrierPos);
        const nextCarriedKey = nextCarried
          ? `${nextCarried.item.id}:${nextCarried.usedTongs ? 1 : 0}:${nextCarried.bareHandViolation ? 1 : 0}:${nextCarried.nearestDropZoneDistanceM?.toFixed(1) ?? 'none'}`
          : '';
        if (nextCarriedKey !== lastCarriedKeyRef.current) {
          lastCarriedKeyRef.current = nextCarriedKey;
          setCarriedHazard(nextCarried);
        }

        const nextMetrics = evacuationManager.getMetrics();
        const nextMetricsKey = `${nextMetrics.operationsCompleted}:${nextMetrics.extractedCount}:${nextMetrics.totalExtractable}:${nextMetrics.bareHandViolations}:${nextMetrics.spillsDecontaminated}:${nextMetrics.firesExtinguished}`;
        if (nextMetricsKey !== lastMetricsKeyRef.current) {
          lastMetricsKeyRef.current = nextMetricsKey;
          setMchsMetrics(nextMetrics);
        }

        // 7. Пошаговый алгоритм сценариев МЧС АЭС (#1–#3; Сценарий #4 управляется своим FSM)
        const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
        const curStep = scenarioStepRef.current;
        const totalSteps = activeScen?.stages.length ?? 6;
        if (curStep < totalSteps && activeScen.id !== 4) {
          if (activeScen.id === 1) {
            // Сценарий 1 МЧС АЭС: Разведка ДП-5В -> СИЗ -> Локализация -> Эвакуация к шлюзу
            if (curStep === 0 && missionTimeRef.current >= 2.5 && minSourceDist > 2.8) {
              handleAdvanceScenarioStepRef.current(1);
            } else if (curStep === 1 && selectedPpeIdRef.current !== 'none') {
              handleAdvanceScenarioStepRef.current(2);
            } else if (curStep === 2 && compAnalysis.kShield > 1.25) {
              handleAdvanceScenarioStepRef.current(3);
            } else if (curStep === 3) {
              const evacObj = currentScenarioInteractive.current.find(i => i.type === 'evac_point');
              if (evacObj) {
                evacObj.mesh.getWorldPosition(ctxObjWorldPos);
                if (operatorWorldPos.distanceTo(ctxObjWorldPos) <= 1.65) {
                  handleAdvanceScenarioStepRef.current(4);
                }
              }
            }
          } else if (activeScen.id === 2) {
            // Сценарий 2 МЧС АЭС: Пожар 6 кВ (БОП -> Обесточивание -> Тушение ОУ-5)
            const fireSim = currentEnvGroup.current?.userData?.fireSimulation as
              | { isPowerEnergized: boolean; isFireExtinguished: boolean }
              | undefined;
            if (curStep === 0 && selectedPpeIdRef.current !== 'none' && missionTimeRef.current >= 2.0) {
              handleAdvanceScenarioStepRef.current(1);
            } else if (curStep === 1 && fireSim && !fireSim.isPowerEnergized) {
              handleAdvanceScenarioStepRef.current(2);
            } else if (curStep === 2 && fireSim && fireSim.isFireExtinguished && !fireSim.isPowerEnergized) {
              handleAdvanceScenarioStepRef.current(3);
            }
          } else if (activeScen.id === 3) {
            // Сценарий 3 МЧС АЭС: Обесточивание БПУ SBO (Фонарь -> Кабель 0.4 кВ -> МДНУ-150 -> Задвижка ПГ)
            if (curStep === 0 && (isFlashlightOnRef.current || missionTimeRef.current >= 5.0) && missionTimeRef.current >= 2.5) {
              handleAdvanceScenarioStepRef.current(1);
            }
          }
        }

        // Стресс / Пульс оператора в телеметрии (без лишних перерисовок от случайного шума)
        let targetBpm = 72;
        if (zone.threatLevel === 'warning') targetBpm = 98;
        if (zone.threatLevel === 'danger') targetBpm = 135;
        if (rulesSnapshot?.isWarning80Active) {
          targetBpm = 162;
        }
        if (targetBpm !== lastHudBpmRef.current) {
          lastHudBpmRef.current = targetBpm;
          setVitalsBpm(targetBpm);
        }

        // Проверка перехода в опасную зону -> Toast уведомление
        if (zone.threatLevel !== prevThreatLevelRef.current) {
          if (zone.threatLevel === 'danger') {
            addToast(
              'danger',
              'КРИТИЧЕСКИЙ РАДИАЦИОННЫЙ ФОН',
              'Мощность дозы превышает 1000 мкЗв/ч! Примените защиту экранированием, СИЗ или увеличьте дистанцию.'
            );
            audioEngineRef.current?.playAlarmSiren();
          } else if (zone.threatLevel === 'warning') {
            addToast(
              'warning',
              'ВХОД В ЗОНУ ПОВЫШЕННОГО ФОНА',
              'Мощность дозы выше нормы. Контролируйте время экспозиции по карточке наряда-допуска.'
            );
          }
          prevThreatLevelRef.current = zone.threatLevel;
        }

        // Кольцевой буфер телеметрии (раз в 0.5 с, не более 120 точек для отсутствия утечек памяти)
        const halfSecTick = Math.floor(missionTimeRef.current * 2);
        const label = `${missionTimeRef.current.toFixed(1)}с`;
        if (lastChartHalfSecTickRef.current < 0 || halfSecTick > lastChartHalfSecTickRef.current) {
          lastChartHalfSecTickRef.current = halfSecTick;
          setChartLabels(prev => [...prev.slice(-119), label]);
          setChartDoseRate(r => [...r.slice(-119), Number(theoreticalDoseRate.toFixed(2))]);
          setChartCumulativeDose(d => [...d.slice(-119), Number(cumulativeDoseRef.current.toFixed(6))]);
          setTelemetryHistory(h => [
            ...h.slice(-119),
            {
              timeLabel: label,
              timestampIso: new Date().toISOString(),
              elapsedSec: missionTimeRef.current,
              distanceM: compAnalysis.baseDistanceM,
              effectiveDistanceM: compAnalysis.effectiveDistanceM,
              attenuationFactor: compAnalysis.kShield,
              doseRateMicroSv: theoreticalDoseRate,
              unshieldedDoseRateMicroSv: compAnalysis.unshieldedBaseDoseRateMicroSv,
              cumulativeDoseMsv: integrationSnapshot.trapezoidalMsv,
              simpsonCumulativeDoseMsv: integrationSnapshot.simpsonMsv,
              convergenceErrorPercent: integrationSnapshot.convergenceErrorPercent,
              permitLimitMsv: permitLimitMsvRef.current,
              alphaRate: compAnalysis.spectralDoseRatesMicroSv.alpha,
              betaRate: compAnalysis.spectralDoseRatesMicroSv.beta,
              gammaRate: compAnalysis.spectralDoseRatesMicroSv.gamma,
              neutronRate: compAnalysis.spectralDoseRatesMicroSv.neutron,
              kDist: compAnalysis.kDist,
              kShield: compAnalysis.kShield,
              kPpe: compAnalysis.kPpe,
              kProtTotal: compAnalysis.kProtTotal,
              voiceProtocolNote:
                voiceLoggerRef.current?.findVoiceNotesForTimeWindow(missionTimeRef.current, 0.55) ||
                undefined
            }
          ]);
        }
      }

      // 7. Основной рендер сцены (в режиме WebXR рендерит стереопару в буфер VR-гарнитуры)
      renderer.render(scene, camera);

      // 8. Display Mirroring: дублирование кадра на главный Canvas компьютера при активной WebXR-сессии
      if (renderer.xr.isPresenting) {
        try {
          const xrCam = renderer.xr.getCamera();
          const leftCam = xrCam?.cameras?.[0];
          const mirrorCam = leftCam || camera;
          if (mirrorCam) {
            const prevRenderTarget = renderer.getRenderTarget();
            const prevSceneAutoUpdate = scene.matrixWorldAutoUpdate;
            const prevShadowAutoUpdate = renderer.shadowMap.autoUpdate;
            const prevMirrorCamAutoUpdate = mirrorCam.matrixWorldAutoUpdate;

            mirrorSavedProjMatrix.copy(mirrorCam.projectionMatrix);
            mirrorSavedProjMatrixInv.copy(mirrorCam.projectionMatrixInverse);

            const canvasEl = renderer.domElement;
            const pcWidth = canvasEl.clientWidth || window.innerWidth;
            const pcHeight = Math.max(1, canvasEl.clientHeight || window.innerHeight);
            const pcAspect = pcWidth / pcHeight;

            const projEl = mirrorCam.projectionMatrix.elements;
            if (projEl[5] !== 0 && Number.isFinite(pcAspect) && pcAspect > 0) {
              projEl[0] = projEl[5] / pcAspect;
              projEl[8] = 0;
              projEl[9] = 0;
              mirrorCam.projectionMatrixInverse.copy(mirrorCam.projectionMatrix).invert();
            }

            mirrorCam.matrixWorldAutoUpdate = false;
            scene.matrixWorldAutoUpdate = false;
            renderer.shadowMap.autoUpdate = false;

            try {
              renderer.xr.enabled = false;
              renderer.setRenderTarget(null);
              renderer.setViewport(0, 0, canvasEl.width, canvasEl.height);
              renderer.setScissor(0, 0, canvasEl.width, canvasEl.height);
              renderer.setScissorTest(false);

              renderer.render(scene, mirrorCam);
            } finally {
              mirrorCam.projectionMatrix.copy(mirrorSavedProjMatrix);
              mirrorCam.projectionMatrixInverse.copy(mirrorSavedProjMatrixInv);
              mirrorCam.matrixWorldAutoUpdate = prevMirrorCamAutoUpdate;

              renderer.setRenderTarget(prevRenderTarget);
              scene.matrixWorldAutoUpdate = prevSceneAutoUpdate;
              renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
              renderer.xr.enabled = true;
            }
          }
        } catch (mirrorErr) {
          console.warn('WebXR mirror render skipped:', mirrorErr);
          renderer.xr.enabled = true;
        }
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      renderer.domElement.removeEventListener('webglcontextlost', handleWebGLContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleWebGLContextRestored);
      if (vrButton && vrButton.parentElement) {
        vrButton.parentElement.removeChild(vrButton);
      }
      renderer.setAnimationLoop(null);
      xrManager.dispose();
      xrManagerRef.current = null;
      scenario4ControllerRef.current?.dispose();
      scenario4ControllerRef.current = null;
      toolManager.dispose();
      holdSystem.dispose();
      voiceLogger.dispose();
      radiationField.dispose();
      hdriEnvTexture.dispose();
      renderer.dispose();
      audioEngine.dispose();
    };
  }, []);

  // Сброс графиков и интеграла накопленной дозы
  const handleResetCharts = useCallback(() => {
    doseIntegratorRef.current.reset();
    cumulativeDoseRef.current = 0;
    missionTimeRef.current = 0;
    permitLimitWarnedRef.current = false;
    setCumulativeDoseMsv(0);
    setMissionTimeSec(0);
    lastChartHalfSecTickRef.current = -1;
    sessionExposureLimitsRef.current = createEmptySessionExposureLimitsTracker();
    setChartLabels([]);
    setChartDoseRate([]);
    setChartCumulativeDose([]);
    setTelemetryHistory([]);
    addToast('info', 'ГРАФИКИ СБРОШЕНЫ', 'Интеграл накопленной дозы H(t) и история измерений обнулены.');
  }, [addToast]);

  // Применение режима низкой освещенности (подземные бункеры РАО, шахты, темные подвалы) или штатного света
  const applySceneLightingMode = useCallback((lowLight: boolean, scen: ScenarioDefinition, envGroup?: THREE.Group | null) => {
    if (!sceneRef.current) return;
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = lowLight ? 0.04 : 0.5;
    }
    if (hemiLightRef.current) {
      hemiLightRef.current.intensity = lowLight ? 0.08 : 1.3;
    }
    if (mainDirLightRef.current) {
      mainDirLightRef.current.intensity = lowLight ? 0.08 : 1.5;
    }
    if (fillDirLightRef.current) {
      fillDirLightRef.current.intensity = lowLight ? 0.03 : 0.7;
    }

    const bgColor = lowLight ? 0x030712 : scen.fogColor;
    const fogDens = lowLight ? Math.max(scen.fogDensity, 0.035) : scen.fogDensity;
    sceneRef.current.background = new THREE.Color(bgColor);
    sceneRef.current.fog = new THREE.FogExp2(bgColor, fogDens);

    const targetEnv = envGroup ?? currentEnvGroup.current;
    if (targetEnv) {
      targetEnv.traverse(obj => {
        // Приглушаем стационарные потолочные светильники сцены в режиме аварийного затемнения,
        // не затрагивая сам тактический фонарь
        if (
          (obj instanceof THREE.PointLight || obj instanceof THREE.SpotLight) &&
          obj.name !== 'flashlight_spot_light' &&
          obj.name !== 'flashlight_bounce_light'
        ) {
          if (obj.userData.baseIntensity === undefined) {
            obj.userData.baseIntensity = obj.intensity;
          }
          obj.intensity = lowLight ? obj.userData.baseIntensity * 0.08 : obj.userData.baseIntensity;
        }
      });
    }
    if (rendererRef.current) {
      rendererRef.current.shadowMap.needsUpdate = true;
    }
  }, []);

  // Загрузка сцены любого из 11 сценариев
  const loadScenario = useCallback(
    (scen: ScenarioDefinition) => {
      if (!sceneRef.current) return;

      // Если удерживался предмет при смене сценария — отпускаем его в сцену
      if (interactionSystemRef.current?.grabbedObject) {
        interactionSystemRef.current.releaseObject();
      }
      if (grabbedObjectRef.current && sceneRef.current) {
        sceneRef.current.attach(grabbedObjectRef.current);
        grabbedObjectRef.current = null;
      }
      setIsGripped(false);
      setIsFlashlightEquipped(true);
      isFlashlightEquippedRef.current = true;

      // Очистка и полное освобождение ресурсов старой сцены перед переключением
      scenario4ControllerRef.current?.dispose();
      scenario4ControllerRef.current = null;
      if (currentEnvGroup.current) {
        currentEnvGroup.current.traverse(obj => {
          if ((obj as THREE.Mesh).isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) {
            const mObj = obj as THREE.Mesh;
            mObj.geometry?.dispose();
            const mats = Array.isArray(mObj.material) ? mObj.material : [mObj.material];
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
        sceneRef.current.remove(currentEnvGroup.current);
        currentEnvGroup.current = null;
      }

      // Настройка дальности камеры и теней: расширенный диапазон для крупного комплекса АЭС (#4), компактный для залов (#1–#3)
      if (cameraRef.current) {
        cameraRef.current.near = scen.id === 4 ? 0.12 : 0.08;
        cameraRef.current.far = scen.id === 4 ? 650 : 160;
        cameraRef.current.updateProjectionMatrix();
      }
      if (mainDirLightRef.current) {
        const sBound = scen.id === 4 ? 30 : 10;
        mainDirLightRef.current.shadow.camera.left = -sBound;
        mainDirLightRef.current.shadow.camera.right = sBound;
        mainDirLightRef.current.shadow.camera.top = sBound;
        mainDirLightRef.current.shadow.camera.bottom = -sBound;
        mainDirLightRef.current.shadow.camera.far = scen.id === 4 ? 90 : 34;
        mainDirLightRef.current.shadow.camera.updateProjectionMatrix();
      }

      // Сброс дозы, времени и загрузка конфигурации ScenarioConfigRegistry для текущего сценария
      const cfg = ScenarioConfigRegistry.getConfig(scen.id);
      setScenarioConfig(cfg);
      doseIntegratorRef.current.reset();
      cumulativeDoseRef.current = 0;
      missionTimeRef.current = 0;
      smoothedReadingRef.current = 0;
      permitLimitWarnedRef.current = false;
      setCumulativeDoseMsv(0);
      setMissionTimeSec(0);
      setScenarioStep(0);
      setPermitLimitMsv(cfg.hLimitMsv);
      permitLimitMsvRef.current = cfg.hLimitMsv;
      syncLoadoutTo3DScene(undefined, undefined, cfg.defaultPpeId, cfg.defaultRemoteToolId);
      lastChartHalfSecTickRef.current = -1;
      sessionExposureLimitsRef.current = createEmptySessionExposureLimitsTracker();
      setChartLabels([]);
      setChartDoseRate([]);
      setChartCumulativeDose([]);
      setTelemetryHistory([]);
      setRulesEvaluation(null);
      hasShownSuccessModalRef.current = false;
      vrUiSystemRef.current?.closeModals();
      if (xrManagerRef.current) {
        xrManagerRef.current.isMovementFrozen = false;
        xrManagerRef.current.moveSpeed = scen.id === 4 ? SCENARIO_4_CONFIG.PLAYER_MOVE_SPEED_VR : 1.8;
      }
      if (playerAvatarRigRef.current) {
        playerAvatarRigRef.current.rootGroup.scale.setScalar(
          scen.id === 4 ? SCENARIO_4_CONFIG.PLAYER_SCALE : 1.0
        );
      }

      // Позиция и ориентация игрока / камеры (с проверкой на NaN и сбросом углов обзора)
      const safeSpawnX = Number.isFinite(scen.initialPlayerPos.x) ? scen.initialPlayerPos.x : 0;
      const safeSpawnY = Number.isFinite(scen.initialPlayerPos.y) ? scen.initialPlayerPos.y : 1.65;
      const safeSpawnZ = Number.isFinite(scen.initialPlayerPos.z) ? scen.initialPlayerPos.z : 4.4;
      const isVRActive = Boolean(xrManagerRef.current?.isInVR || rendererRef.current?.xr.isPresenting);
      const vrBaseY = xrManagerRef.current?.activeReferenceSpaceType === 'local-floor' ? 0.0 : 1.65;

      if (playerGroupRef.current) {
        playerGroupRef.current.position.set(
          safeSpawnX,
          isVRActive ? vrBaseY : safeSpawnY,
          safeSpawnZ
        );
        playerGroupRef.current.rotation.set(0, 0, 0);
      }
      if (!isVRActive && cameraRef.current) {
        resetDesktopLookRef.current();
        cameraRef.current.position.set(0, 0, 0);
        cameraRef.current.rotation.set(0, 0, 0);
        cameraRef.current.updateMatrixWorld(true);
      }

      // Безопасная генерация 3D-объектов нового сценария и гарантированное добавление envGroup в сцену
      let initErrorsCount = 0;
      let built: ReturnType<ScenarioDefinition['buildScene']>;
      try {
        built = scen.buildScene(sceneRef.current);
      } catch (err) {
        initErrorsCount += 1;
        console.error(`[ALARA] Ошибка в scen.buildScene для сценария #${scen.id}:`, err);
        const fallbackGroup = new THREE.Group();
        fallbackGroup.name = `scenario_${scen.id}_fallback`;
        built = { envGroup: fallbackGroup, sources: [], shields: [], interactive: [] };
      }

      if (built.envGroup) {
        built.envGroup.visible = true;
        built.envGroup.layers.enableAll();
        if (built.envGroup.parent !== sceneRef.current) {
          console.warn(
            `[ALARA] envGroup сценария #${scen.id} не был прикреплён к scene — выполняем принудительный scene.add(envGroup).`
          );
          sceneRef.current.add(built.envGroup);
        }
      }

      // Размещение приборной стойки-ложемента рядом с оператором (только в сценариях #1–#3; Сценарий 4 рендерит исключительно /assembly.glb)
      let chargingStand: THREE.Group | null = null;
      if (scen.id !== 4) {
        const standPos = new THREE.Vector3(
          scen.initialPlayerPos.x - 0.52,
          0,
          scen.initialPlayerPos.z - 0.65
        );
        chargingStand = createFlashlightChargingStand();
        chargingStand.position.copy(standPos);
        built.envGroup.add(chargingStand);
      }

      // Жесткая привязка VRFlashlight к иерархии левой руки (НЕ в scene!):
      // Фонарь и его SpotLight + spotLight.target (0, 0, -5) находятся строго в локальной группе левой кисти
      const initialLowLight = Boolean(scen.isLowLight);
      const isVRActiveNow =
        (xrManagerRef.current?.isInVR ?? false) || (rendererRef.current?.xr.isPresenting ?? false);

      if (xrManagerRef.current?.leftHandRig) {
        const vrFl = xrManagerRef.current.leftHandRig.equipFlashlight(isVRActiveNow ? initialLowLight : false);
        if (isVRActiveNow) {
          flashlightMeshRef.current = vrFl.flashlightMesh;
        }
      }
      if (leftHandRigDesktopRef.current) {
        const deskFl = leftHandRigDesktopRef.current.equipFlashlight(!isVRActiveNow ? initialLowLight : false);
        if (!isVRActiveNow) {
          flashlightMeshRef.current = deskFl.flashlightMesh;
        }
      }

      setIsFlashlightOn(initialLowLight);
      isFlashlightOnRef.current = initialLowLight;
      setIsLowLightMode(initialLowLight);
      isLowLightModeRef.current = initialLowLight;

      if (chargingStand) {
        built.interactive.push({
          id: 'tactical_flashlight',
          nameRu: 'Зарядный пост фонаря ФПС-4ВЗГ',
          type: 'flashlight',
          placementType: 'floor',
          isLargeEquipment: true,
          mesh: chargingStand,
          interacted: false
        });
      }

      // Применяем параметры освещения (для бункеров, шахт и техподполий — аварийное затемнение)
      applySceneLightingMode(initialLowLight, scen, built.envGroup);

      // Регистрация всех интерактивных защитных экранов в массиве экранов с самого старта сцены
      built.interactive.forEach(item => {
        if (item.type === 'shield') {
          const alreadyExists = built.shields.some(s => s.mesh === item.mesh);
          if (!alreadyExists) {
            built.shields.push({
              id: item.id,
              mesh: item.mesh,
              material: item.shieldMaterial || 'lead',
              thicknessCm: item.shieldThicknessCm || 2.5,
              boundingBox: new THREE.Box3().setFromObject(item.mesh)
            });
          }
        }
      });
      currentScenarioSources.current = built.sources;
      currentScenarioShields.current = built.shields;
      currentScenarioInteractive.current = built.interactive;
      currentEnvGroup.current = built.envGroup;

      // Генерация 3D-визуальных маркеров радиации: голографические знаки ГОСТ 17925-72, зоны ионизации и контейнеры
      radiationSourceVisualizerRef.current?.bindSources(built.sources, built.envGroup);

      // Фиксация начальных мировых и локальных координат всех 3D-объектов в ScenarioRulesEngine для resetScenario()
      rulesEngineRef.current?.bindScenario(scen.id, {
        sources: built.sources,
        shields: built.shields,
        interactive: built.interactive
      });

      // Сбор статических твердотельных объектов сцены для проверки коллизий
      const colliders: THREE.Object3D[] = chargingStand ? [chargingStand] : [];
      built.shields.forEach(s => {
        if (s.mesh) colliders.push(s.mesh);
      });
      built.interactive.forEach(item => {
        if (item.type === 'container' || item.type === 'valve' || item.type === 'drop_zone') {
          colliders.push(item.mesh);
        }
      });
      sceneCollidersRef.current = colliders;

      // Инициализация системы эвакуации САР, удержания действий и сброс хватов/инструментов под новый сценарий
      holdSystemRef.current?.reset();
      if (toolManagerRef.current) {
        toolManagerRef.current.resetOnScenarioLoad(scen.id === 4);
        const syncedToolId = toolManagerRef.current.getActiveToolId();
        activeToolIdRef.current = syncedToolId;
        setActiveToolId(syncedToolId);
      }
      evacuationManagerRef.current?.bindScenario(built.interactive, built.sources);
      setHoldSnapshot(null);
      setCarriedHazard(null);
      if (evacuationManagerRef.current) {
        setMchsMetrics(evacuationManagerRef.current.getMetrics());
      }

      // Сброс кешей dirty-check HUD при загрузке нового сценария
      lastHudDoseKeyRef.current = '';
      lastHudCumDoseKeyRef.current = '';
      lastHudMissionSecRef.current = -1;
      lastHudProtKeyRef.current = '';
      lastHudRulesKeyRef.current = '';
      lastHudZoneKeyRef.current = '';

      // Изолированная инициализация Сценария №4 (.glb-модель комплекса АЭС) — только при запуске Сценария 4
      lastScen4SnapKeyRef.current = '';
      lastScen4StepNumRef.current = 1;
      desktopOverviewYRef.current = null;
      scenario4GroundYRef.current = 0;
      if (scen.id === 4 && cameraRef.current && playerGroupRef.current) {
        try {
          const s4Ctrl = new Scenario4Controller({
            envGroup: built.envGroup,
            camera: cameraRef.current,
            playerGroup: playerGroupRef.current,
            doseLimitMsv: cfg.hLimitMsv,
            maxDurationSec: cfg.tMaxSec,
            onToast: addToast,
            onRadiationSourcesReady: sources => {
              if (currentEnvGroup.current === built.envGroup) {
                currentScenarioSources.current = sources;
                radiationSourceVisualizerRef.current?.bindSources(sources, built.envGroup);
              }
            },
            onPlayerSpawnReady: (spawn, lookTarget, boundsSize) => {
              desktopOverviewYRef.current = null;
              scenario4GroundYRef.current = spawn.y;
              const maxDim = Math.max(boundsSize[0], boundsSize[1], boundsSize[2], 30);
              if (cameraRef.current) {
                cameraRef.current.far = Math.max(650, maxDim * 5);
                cameraRef.current.updateProjectionMatrix();
              }
              if (mainDirLightRef.current) {
                const sBound = Math.max(30, Math.min(180, maxDim * 0.75));
                mainDirLightRef.current.shadow.camera.left = -sBound;
                mainDirLightRef.current.shadow.camera.right = sBound;
                mainDirLightRef.current.shadow.camera.top = sBound;
                mainDirLightRef.current.shadow.camera.bottom = -sBound;
                mainDirLightRef.current.shadow.camera.far = Math.max(120, maxDim * 2.5);
                mainDirLightRef.current.shadow.camera.updateProjectionMatrix();
              }
              if (playerGroupRef.current) {
                const isVrNow = Boolean(
                  xrManagerRef.current?.isInVR || rendererRef.current?.xr.isPresenting
                );
                const vrY =
                  xrManagerRef.current?.activeReferenceSpaceType === 'local-floor' ? 0.0 : SCENARIO_4_CONFIG.PLAYER_EYE_HEIGHT;
                const spawnEyeY = isVrNow
                  ? spawn.y + vrY
                  : spawn.y + SCENARIO_4_CONFIG.PLAYER_EYE_HEIGHT;
                playerGroupRef.current.position.set(spawn.x, spawnEyeY, spawn.z);
                if (!isVrNow) {
                  const eyeOrigin = new THREE.Vector3(spawn.x, spawnEyeY, spawn.z);
                  setDesktopLookTargetRef.current(eyeOrigin, lookTarget);
                } else {
                  const yaw = Math.atan2(-(lookTarget.x - spawn.x), -(lookTarget.z - spawn.z));
                  playerGroupRef.current.rotation.set(0, yaw, 0);
                }
              }
            },
            onCameraFocusRequested: (focusPos, lookTarget) => {
              if (!playerGroupRef.current) return;
              const isVrNow = Boolean(
                xrManagerRef.current?.isInVR || rendererRef.current?.xr.isPresenting
              );
              if (!isVrNow) {
                desktopOverviewYRef.current = focusPos.y;
                playerGroupRef.current.position.copy(focusPos);
                setDesktopLookTargetRef.current(focusPos, lookTarget);
              } else {
                playerGroupRef.current.position.set(focusPos.x, focusPos.y, focusPos.z);
                const yaw = Math.atan2(-(lookTarget.x - focusPos.x), -(lookTarget.z - focusPos.z));
                playerGroupRef.current.rotation.set(0, yaw, 0);
              }
            }
          });
          s4Ctrl.setOperatorLoadoutProfile({
            role: coopRoleRef.current,
            suitId: characterPpeStateRef.current.suitId,
            respiratorId: characterPpeStateRef.current.respiratorId,
            remoteToolId: selectedRemoteToolIdRef.current
          });
          scenario4ControllerRef.current = s4Ctrl;
          setScenario4Snapshot(s4Ctrl.getHudSnapshot());
        } catch (err) {
          initErrorsCount += 1;
          console.error('[ALARA] Ошибка инициализации Scenario4Controller (#4):', err);
          setScenario4Snapshot(null);
        }
      } else {
        setScenario4Snapshot(null);
      }

      if (rendererRef.current) {
        rendererRef.current.shadowMap.needsUpdate = true;
      }

      // Диагностика геометрии, камеры и видимых мешей при старте сценария
      if (sceneRef.current && cameraRef.current) {
        sceneRef.current.updateMatrixWorld(true);
        const camWorldPos = APP_SCRATCH_VEC_A;
        const camWorldDir = APP_SCRATCH_VEC_B;
        cameraRef.current.getWorldPosition(camWorldPos);
        cameraRef.current.getWorldDirection(camWorldDir);

        let sceneVisibleMeshes = 0;
        let envVisibleMeshes = 0;
        sceneRef.current.traverse(obj => {
          if ((obj as THREE.Mesh).isMesh && obj.visible) sceneVisibleMeshes += 1;
        });
        built.envGroup.traverse(obj => {
          if ((obj as THREE.Mesh).isMesh && obj.visible) envVisibleMeshes += 1;
        });

        const hasNanCamera =
          !Number.isFinite(camWorldPos.x) ||
          !Number.isFinite(camWorldPos.y) ||
          !Number.isFinite(camWorldPos.z);

        const diagPayload = {
          scenarioId: scen.id,
          cameraWorldPos: [
            Number(camWorldPos.x.toFixed(2)),
            Number(camWorldPos.y.toFixed(2)),
            Number(camWorldPos.z.toFixed(2))
          ],
          cameraLookDir: [
            Number(camWorldDir.x.toFixed(2)),
            Number(camWorldDir.y.toFixed(2)),
            Number(camWorldDir.z.toFixed(2))
          ],
          nearFar: [cameraRef.current.near, cameraRef.current.far],
          envAttachedToScene: built.envGroup.parent === sceneRef.current,
          envVisibleMeshes,
          sceneVisibleMeshes,
          initErrorsCount
        };

        if (hasNanCamera || envVisibleMeshes === 0 || initErrorsCount > 0) {
          console.warn('[ALARA Diag] Предупреждение при старте сценария:', diagPayload);
        } else {
          console.info('[ALARA Diag] Сценарий загружен:', diagPayload);
        }
      }

      addToast(
        'info',
        'ЗАПУСК СЦЕНАРИЯ',
        initialLowLight
          ? `${scen.titleRu}. Режим низкой освещенности: возьмите тактический фонарь со стойки слева или нажмите [X/A] / [F].`
          : `${scen.titleRu}. Начните выполнение этапа 1.`
      );
    },
    [addToast, applySceneLightingMode]
  );

  // Смена сценария
  const handleScenarioChange = (id: number) => {
    setActiveScenarioId(id);
    const scen = SCENARIOS.find(s => s.id === id) || SCENARIOS[0];
    loadScenario(scen);
  };

  /**
   * Полный сброс сценария resetScenario() через ScenarioRulesEngine:
   * - Возврат playerGroup в исходную точку спавна.
   * - Обнуление накопленной дозы (H_accum = 0), очистка массивов графиков D(t) и H(t), локального CSV-буфера и голосового журнала.
   * - Возврат всех 3D-объектов, СИЗ, экранов и приборов в начальные мировые координаты.
   */
  const handleResetScenario = useCallback(() => {
    const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
    const cfg = ScenarioConfigRegistry.getConfig(activeScen.id);
    hasShownSuccessModalRef.current = false;
    vrUiSystemRef.current?.closeModals();

    if (activeScen.id === 4) {
      loadScenario(activeScen);
    } else if (rulesEngineRef.current) {
      rulesEngineRef.current.resetScenario();
    } else {
      loadScenario(activeScen);
    }

    addToast(
      'info',
      '🔄 СЦЕНАРИЙ СБРОШЕН (resetScenario)',
      `Оператор возвращен на спавн (${cfg.initialSpawnPos.x.toFixed(1)}, ${cfg.initialSpawnPos.z.toFixed(1)}). Доза H_accum = 0, графики D(t)/H(t), CSV-буфер, голосовой лог и все 3D-объекты восстановлены.`
    );
  }, [addToast, loadScenario]);

  // Переключение активного сменного инструмента МЧС (1–6)
  const selectMchsTool = useCallback(
    (id: MchsToolId) => {
      const normalizedId: MchsToolId = id === 'wrench' ? 'hands' : id;
      const slot =
        toolManagerRef.current?.selectTool(normalizedId) ||
        TOOL_SLOTS.find(s => s.id === normalizedId) ||
        TOOL_SLOTS[0];
      const changed = activeToolIdRef.current !== slot.id;
      activeToolIdRef.current = slot.id;
      setActiveToolId(slot.id);

      if (changed) {
        handRigRef.current?.triggerToolSwapAnimation();
      }

      if (slot.id === 'tongs') {
        selectedRemoteToolIdRef.current = 'manipulator_15m';
        setSelectedRemoteToolId('manipulator_15m');
        handRigRef.current?.setRemoteToolMode('manipulator_15m');
        xrManagerRef.current?.setRemoteToolMode('manipulator_15m');
        toolManagerRef.current?.setTongsClosure(grabbedObjectRef.current ? 1 : 0);
      } else if (selectedRemoteToolIdRef.current === 'manipulator_15m') {
        selectedRemoteToolIdRef.current = 'hand';
        setSelectedRemoteToolId('hand');
        handRigRef.current?.setRemoteToolMode('hand');
        xrManagerRef.current?.setRemoteToolMode('hand');
      }

      scenario4ControllerRef.current?.setOperatorLoadoutProfile({
        role: coopRoleRef.current,
        suitId: characterPpeStateRef.current.suitId,
        respiratorId: characterPpeStateRef.current.respiratorId,
        remoteToolId: selectedRemoteToolIdRef.current
      });

      if (changed) {
        addToast('info', `ИНСТРУМЕНТ [${slot.hotkey}]: ${slot.nameRu}`, slot.purposeRu);
      }
    },
    [addToast]
  );
  selectMchsToolRef.current = selectMchsTool;

  // Завершение технологической операции с удержанием (лопата, ОУ-5, задвижки, рубильники, МДНУ)
  const applyCompletedHoldAction = useCallback(
    (matchedItem: InteractiveObjectInstance) => {
      matchedItem.interacted = true;
      const envUD = currentEnvGroup.current?.userData;

      const updateSboConsoleScreen = (title: string, subtitle: string, bgHex: string, accentHex: string) => {
        const sboSim = envUD?.sboSimulation as { sboScreenMesh?: THREE.Mesh } | undefined;
        const scr = sboSim?.sboScreenMesh;
        if (!scr) return;
        const mat = scr.material as THREE.MeshBasicMaterial;
        if (mat) {
          if (mat.map) mat.map.dispose();
          mat.map = createEquipmentLabelTexture(title, subtitle, bgHex, accentHex);
          mat.needsUpdate = true;
        }
      };

      const kind = matchedItem.holdAction?.kind;

      // 1. Дезактивация радиоактивной просыпи сорбентом (лопата БСЛ-110 [2])
      if (kind === 'decontaminate' || matchedItem.type === 'spill') {
        if (matchedItem.mesh.userData) {
          matchedItem.mesh.userData.isDecontaminated = true;
          const puddleMat = matchedItem.mesh.userData.puddleMat as THREE.MeshStandardMaterial | undefined;
          if (puddleMat) puddleMat.opacity = 0.08;
          const puddleMeshes = matchedItem.mesh.userData.puddleMeshes as THREE.Mesh[] | undefined;
          puddleMeshes?.forEach(pm => pm.scale.set(0.25, 1, 0.25));
          const sorbentMound = matchedItem.mesh.userData.sorbentMound as THREE.Mesh | undefined;
          const sorbentMat = matchedItem.mesh.userData.sorbentMat as THREE.MeshStandardMaterial | undefined;
          if (sorbentMound && sorbentMat) {
            sorbentMound.visible = true;
            sorbentMound.scale.set(1, 1, 1);
            sorbentMat.opacity = 0.96;
          }
          if (!matchedItem.mesh.userData.sourceDecontaminated) {
            matchedItem.mesh.userData.sourceDecontaminated = true;
            const linked = currentScenarioSources.current.find(
              s => s.id === matchedItem.linkedSourceId || s.mesh === matchedItem.mesh
            );
            if (linked) {
              linked.activityMBq = Math.max(10, linked.activityMBq * 0.12);
              linked.enclosedInShield = { material: 'concrete', thicknessCm: 6.0 };
            }
          }
        }
        evacuationManagerRef.current?.recordOperation(matchedItem.id, 'spill');
        if (evacuationManagerRef.current) setMchsMetrics(evacuationManagerRef.current.getMetrics());
        audioEngineRef.current?.playTaskSuccess();
        addToast(
          'success',
          'ПРОСЫПЬ ДЕЗАКТИВИРОВАНА СОРБЕНТОМ',
          `${matchedItem.nameRu} засыпана сорбентом, поверхностная активность снижена на 88%.`
        );
        return;
      }

      // 2. Тушение пожара углекислотным огнетушителем ОУ-5 (CO₂)
      if (kind === 'extinguish' || matchedItem.type === 'extinguisher') {
        const fireSim = envUD?.fireSimulation as
          | {
              flameFlames: THREE.Mesh[];
              smokePuffs: THREE.Mesh[];
              fireLight: THREE.PointLight;
              sparkGroup: THREE.Group;
              isPowerEnergized: boolean;
              isFireExtinguished: boolean;
            }
          | undefined;
        if (fireSim) {
          fireSim.isFireExtinguished = true;
          fireSim.flameFlames.forEach(f => {
            f.visible = false;
            f.scale.set(1, 1, 1);
          });
          fireSim.smokePuffs.forEach(p => {
            const pMat = p.material as THREE.MeshStandardMaterial;
            if (pMat) pMat.opacity = 0.12;
          });
          fireSim.fireLight.intensity = 0;
          fireSim.sparkGroup.visible = false;
        }
        // Отмечаем оба связанных объекта пожара как выполненные
        currentScenarioInteractive.current.forEach(i => {
          if (i.id === 'fire_tray_target' || i.id === 'co2_extinguisher') {
            i.interacted = true;
          }
        });
        currentScenarioSources.current.forEach(src => {
          if (src.id === 'src_fire_cs137') {
            src.activityMBq = Math.min(src.activityMBq, 2400);
          }
        });
        evacuationManagerRef.current?.recordOperation('fire_extinguish', 'fire');
        if (evacuationManagerRef.current) setMchsMetrics(evacuationManagerRef.current.getMetrics());
        audioEngineRef.current?.playTaskSuccess();

        // После завершения тушения сразу убираем огнетушитель с экрана в походное положение [1] ДП-5В
        if (toolManagerRef.current) {
          toolManagerRef.current.parkExtinguisher(true);
          const syncedId = toolManagerRef.current.getActiveToolId();
          activeToolIdRef.current = syncedId;
          setActiveToolId(syncedId);
        }

        if (fireSim && !fireSim.isPowerEnergized) {
          handleAdvanceScenarioStepRef.current(3);
          addToast(
            'success',
            'ПОЖАР ПОТУШЕН ОУ-5 (CO₂)',
            'Трасса 6 кВ обесточена, открытое пламя ликвидировано. Огнетушитель убран в кобуру — эвакуируйте бочку РАО и пострадавшего в САР-2!'
          );
        } else {
          addToast(
            'warning',
            'ПЛАМЯ СБИТО ОУ-5 — ОБЕСТОЧЬТЕ 6 кВ!',
            'Диэлектрик ОУ-5 безопасен до 10 кВ, но напряжение на кабельной трассе еще не снято! Отключите рубильник 6 кВ.'
          );
        }
        return;
      }

      // 3. Силовые рубильники и ввод кабеля 0.4 кВ
      if (kind === 'breaker' || matchedItem.type === 'breaker') {
        if (matchedItem.id === 'power_breaker') {
          const fireSim = envUD?.fireSimulation as
            | { sparkGroup?: THREE.Group; isPowerEnergized: boolean; isFireExtinguished: boolean }
            | undefined;
          if (fireSim) {
            fireSim.isPowerEnergized = false;
            if (fireSim.sparkGroup) fireSim.sparkGroup.visible = false;
          }
          const handle = matchedItem.mesh.userData?.breakerHandle as THREE.Object3D | undefined;
          if (handle) handle.rotation.x = Math.PI / 3;
          const led = matchedItem.mesh.userData?.breakerLed as THREE.Mesh | undefined;
          const ledMat = led?.material as THREE.MeshBasicMaterial | undefined;
          if (ledMat) ledMat.color.setHex(0x22c55e);

          evacuationManagerRef.current?.recordOperation(matchedItem.id, 'breaker');
          if (evacuationManagerRef.current) setMchsMetrics(evacuationManagerRef.current.getMetrics());
          handleAdvanceScenarioStepRef.current(
            fireSim?.isFireExtinguished ? 3 : Math.max(2, scenarioStepRef.current)
          );
          addToast(
            'success',
            'КАБЕЛЬНАЯ ТРАССА 6 кВ ОБЕСТОЧЕНА',
            'Напряжение 6 кВ снято! Теперь ликвидируйте возгорание огнетушителем ОУ-5 [4].'
          );
          audioEngineRef.current?.playTaskSuccess();
          return;
        }

        if (matchedItem.id === 'sbo_power_cable') {
          const sboSim = envUD?.sboSimulation as { isCableConnected: boolean } | undefined;
          if (sboSim) sboSim.isCableConnected = true;
          const plugLed = matchedItem.mesh.userData?.cablePlugLed as THREE.Mesh | undefined;
          const plugMat = plugLed?.material as THREE.MeshBasicMaterial | undefined;
          if (plugMat) plugMat.color.setHex(0x22c55e);

          evacuationManagerRef.current?.recordOperation(matchedItem.id, 'breaker');
          if (evacuationManagerRef.current) setMchsMetrics(evacuationManagerRef.current.getMetrics());
          updateSboConsoleScreen('ВВОД 0.4 кВ ПОДКЛЮЧЕН', 'ЗАПУСТИТЕ МДНУ-150 СПРАВА', '#1c1917', '#f59e0b');
          handleAdvanceScenarioStepRef.current(Math.max(2, scenarioStepRef.current));
          addToast(
            'success',
            'АВАРИЙНЫЙ КАБЕЛЬ 0.4 кВ ПОДКЛЮЧЕН',
            'Схема временного питания собрана. Запустите мобильную установку МДНУ-150!'
          );
          audioEngineRef.current?.playTaskSuccess();
          return;
        }
      }

      // 4. Мобильная дизель-насосная установка МДНУ-150
      if (kind === 'generator' || matchedItem.type === 'generator') {
        const sboSim = envUD?.sboSimulation as
          | {
              emergencyLight: THREE.PointLight;
              isCableConnected: boolean;
              isGeneratorRunning: boolean;
            }
          | undefined;
        if (!sboSim?.isCableConnected) {
          matchedItem.interacted = false;
          addToast(
            'warning',
            'СНАЧАЛА ПОДКЛЮЧИТЕ КАБЕЛЬ 0.4 кВ',
            'Перед запуском МДНУ-150 подключите силовой кабель к шкафу резервного ввода слева!'
          );
          return;
        }
        sboSim.isGeneratorRunning = true;
        const statusLed = matchedItem.mesh.userData?.mdnuStatusLed as THREE.Mesh | undefined;
        const statusMat = statusLed?.material as THREE.MeshBasicMaterial | undefined;
        if (statusMat) statusMat.color.setHex(0x22c55e);

        sboSim.emergencyLight.color.setHex(0xf59e0b);
        if (ambientLightRef.current) ambientLightRef.current.intensity = 0.25;
        if (fillDirLightRef.current) fillDirLightRef.current.intensity = 0.35;

        evacuationManagerRef.current?.recordOperation(matchedItem.id, 'generator');
        if (evacuationManagerRef.current) setMchsMetrics(evacuationManagerRef.current.getMetrics());
        updateSboConsoleScreen('МДНУ-150 В РАБОТЕ', 'ОТКРОЙТЕ ЗАДВИЖКУ АВАРИЙНОЙ ПОДПИТКИ ПГ', '#0f172a', '#38bdf8');
        handleAdvanceScenarioStepRef.current(3);
        addToast(
          'success',
          'МДНУ-150 ЗАПУЩЕНА',
          'Резервное питание подано на щит БПУ! Откройте задвижку аварийной подпитки ПГ у пульта.'
        );
        audioEngineRef.current?.playTaskSuccess();
        return;
      }

      // 5. Арматура и задвижки (Сценарии 1 и 3)
      if (kind === 'valve' || matchedItem.type === 'valve') {
        if (activeScenarioIdRef.current === 3 && matchedItem.id === 'sbo_cooling_valve') {
          const sboSim = envUD?.sboSimulation as
            | {
                deskIndicatorMat: THREE.MeshBasicMaterial;
                emergencyLight: THREE.PointLight;
                isCableConnected: boolean;
                isGeneratorRunning: boolean;
                isCoolingRestored: boolean;
              }
            | undefined;
          if (!sboSim?.isCableConnected || !sboSim?.isGeneratorRunning) {
            matchedItem.interacted = false;
            audioEngineRef.current?.playAlarmSiren();
            addToast(
              'warning',
              'НЕТ ЭЛЕКТРОПИТАНИЯ АРМАТУРЫ ПГ',
              'Для запуска аварийной подпитки сначала подключите кабель 0.4 кВ и запустите установку МДНУ-150!'
            );
            return;
          }
          if (typeof matchedItem.mesh.userData.holdBaseRotY === 'number') {
            matchedItem.mesh.rotation.y = (matchedItem.mesh.userData.holdBaseRotY as number) + Math.PI;
          } else {
            matchedItem.mesh.rotation.y += Math.PI;
          }
          sboSim.isCoolingRestored = true;
          sboSim.deskIndicatorMat.color.setHex(0x10b981);
          sboSim.emergencyLight.color.setHex(0x10b981);
          if (ambientLightRef.current) ambientLightRef.current.intensity = 0.45;
          if (hemiLightRef.current) hemiLightRef.current.intensity = 0.9;

          evacuationManagerRef.current?.recordOperation(matchedItem.id, 'valve');
          if (evacuationManagerRef.current) setMchsMetrics(evacuationManagerRef.current.getMetrics());
          updateSboConsoleScreen('РАСХОЛАЖИВАНИЕ ПГ АКТИВНО', 'БПУ • ПИТАНИЕ И ПОДПИТКА В НОРМЕ', '#022c22', '#10b981');
          currentScenarioSources.current.forEach(src => {
            src.activityMBq = Math.min(src.activityMBq, 450);
          });
          addToast(
            'success',
            'АВАРИЙНОЕ РАСХОЛАЖИВАНИЕ ВОССТАНОВЛЕНО',
            'Отказ SBO ликвидирован! Теплоотвод от реакторной установки восстановлен.'
          );
          audioEngineRef.current?.playTaskSuccess();
          triggerSuccessModalRef.current();
          return;
        }

        if (typeof matchedItem.mesh.userData.holdBaseRotY === 'number') {
          matchedItem.mesh.rotation.y = (matchedItem.mesh.userData.holdBaseRotY as number) + Math.PI;
        } else {
          matchedItem.mesh.rotation.y += Math.PI;
        }
        currentScenarioSources.current.forEach(src => {
          src.activityMBq = Math.min(src.activityMBq, 450);
        });
        evacuationManagerRef.current?.recordOperation(matchedItem.id, 'valve');
        if (evacuationManagerRef.current) setMchsMetrics(evacuationManagerRef.current.getMetrics());

        if (activeScenarioIdRef.current === 1) {
          handleAdvanceScenarioStepRef.current(Math.max(3, scenarioStepRef.current + 1));
          addToast(
            'success',
            'КОНТУР ГЦК ПЕРЕКРЫТ',
            `${matchedItem.nameRu} переведен в закрытое положение! Засыпьте просыпь [2] или двигайтесь к выходу.`
          );
        } else {
          handleAdvanceScenarioStepRef.current(Math.max(2, scenarioStepRef.current + 1));
          addToast(
            'success',
            'ИСТОЧНИК ПЕРЕКРЫТ / ОТКЛЮЧЕН',
            `${matchedItem.nameRu} переведен в безопасное положение!`
          );
        }
        audioEngineRef.current?.playTaskSuccess();
        return;
      }

      evacuationManagerRef.current?.recordOperation(matchedItem.id, 'other');
      if (evacuationManagerRef.current) setMchsMetrics(evacuationManagerRef.current.getMetrics());
      audioEngineRef.current?.playTaskSuccess();
    },
    [addToast]
  );
  applyCompletedHoldActionRef.current = applyCompletedHoldAction;

  // Интерактивный захват и дифференцированный сброс предметов (Desktop и WebXR VR) через InteractionSystem
  const tryGrabOrInteract = useCallback(
    (
      source: 'desktop' | 'vr' = 'desktop',
      controller?: THREE.Group,
      isVRGrabbing?: boolean,
      controllerIndex?: number
    ) => {
      if (!sceneRef.current || !interactionSystemRef.current) return;
      const interactionSys = interactionSystemRef.current;

      const excludeRoots: THREE.Object3D[] = [];
      if (playerGroupRef.current) excludeRoots.push(playerGroupRef.current);
      if (vrUiSystemRef.current) excludeRoots.push(vrUiSystemRef.current.rootGroup);
      const floorCandidates = currentEnvGroup.current ? [currentEnvGroup.current] : undefined;

      // Универсальная обработка логики этапов для всех 11 сценариев после сброса объекта
      const handlePostDropMissionLogic = (
        droppedObject: THREE.Object3D,
        itemMeta: InteractiveObjectInstance | null,
        isLargeEquipment: boolean,
        modeLabel: string
      ) => {
        toolManagerRef.current?.setTongsClosure(0);

        // 0. Если отпущен тактический фонарь — сохраняем его пространственное положение и направление луча
        if (itemMeta?.type === 'flashlight' || droppedObject === flashlightMeshRef.current) {
          evacuationManagerRef.current?.clearCarry();
          setIsFlashlightEquipped(false);
          isFlashlightEquippedRef.current = false;
          addToast(
            'info',
            'ТАКТИЧЕСКИЙ ФОНАРЬ РАЗМЕЩЕН',
            `${itemMeta?.nameRu || 'Фонарь'} оставлен в выбранной точке пространства и продолжает освещать сектор работ.`
          );
          return;
        }

        // 0.5. Проверка попадания эвакуируемого опасного объекта в свинцовый контейнер САР / Безопасную зону
        if (evacuationManagerRef.current) {
          const sarDeposit = evacuationManagerRef.current.tryDepositObject(droppedObject, itemMeta);
          setCarriedHazard(null);
          setMchsMetrics(evacuationManagerRef.current.getMetrics());
          if (sarDeposit.deposited) {
            audioEngineRef.current?.playTaskSuccess();
            addToast(
              'success',
              'ОБЪЕКТ ИЗОЛИРОВАН В ЗОНЕ САР',
              `${itemMeta?.nameRu || 'Опасный объект'} помещён в «${sarDeposit.dropZone?.nameRu || 'Контейнер САР'}»! Экранирование снизило дозовую нагрузку на ${sarDeposit.shieldedPercent}%.`
            );
            return;
          }
        }

        // 1. Если установлен защитный экран (свинец, баритобетон, парафин/борированный полиэтилен)
        if (itemMeta?.type === 'shield' || isLargeEquipment) {
          const mat: ShieldMaterialType = itemMeta?.shieldMaterial || 'lead';
          const thick = itemMeta?.shieldThicknessCm || 2.5;
          const shieldId = itemMeta?.id || 'placed_shield';

          const existingIdx = currentScenarioShields.current.findIndex(s => s.mesh === droppedObject);
          const updatedShield: ShieldingInstance = {
            id: shieldId,
            mesh: droppedObject,
            material: mat,
            thicknessCm: thick,
            boundingBox: new THREE.Box3().setFromObject(droppedObject)
          };

          if (existingIdx >= 0) {
            currentScenarioShields.current[existingIdx] = updatedShield;
          } else {
            currentScenarioShields.current.push(updatedShield);
          }

          if (rendererRef.current) {
            rendererRef.current.shadowMap.needsUpdate = true;
          }

          if (scenarioStepRef.current <= 3) {
            handleAdvanceScenarioStepRef.current(4);
          }
          addToast(
            'success',
            modeLabel === 'VR' ? 'ЗАЩИТНЫЙ ЭКРАН УСТАНОВЛЕН В VR' : 'ЗАЩИТНЫЙ ЭКРАН УСТАНОВЛЕН НА ПОЛ',
            `${itemMeta?.nameRu || 'Экран'} выровнен вертикально по полу и ослабляет поток по закону I = I₀·exp(-μ·d)·B.`
          );
          audioEngineRef.current?.playTaskSuccess();
          return;
        }

        // 2. Если отпущен портативный источник или радиоактивная проба — проверяем близость к защитному контейнеру
        const containerItem = currentScenarioInteractive.current.find(i => i.type === 'container');
        if (containerItem) {
          const containerWorldPos = APP_SCRATCH_VEC_C;
          containerItem.mesh.getWorldPosition(containerWorldPos);

          if (droppedObject.position.distanceTo(containerWorldPos) < 1.85) {
            droppedObject.position.set(
              containerWorldPos.x,
              containerWorldPos.y + 0.26,
              containerWorldPos.z
            );
            droppedObject.rotation.set(0, 0, 0);
            const matchedSource =
              currentScenarioSources.current.find(s => s.mesh === droppedObject) ||
              currentScenarioSources.current[0];
            if (matchedSource) {
              matchedSource.enclosedInShield = {
                material: containerItem.shieldMaterial || 'lead',
                thicknessCm: containerItem.shieldThicknessCm || 6.5
              };
            }
            if (scenarioStepRef.current <= 6) {
              handleAdvanceScenarioStepRef.current(7);
            } else {
              triggerSuccessModalRef.current();
            }
            addToast(
              'success',
              'ИСТОЧНИК ИЗОЛИРОВАН В КОНТЕЙНЕРЕ',
              `${itemMeta?.nameRu || 'Источник'} помещен в ${containerItem.nameRu}! Свинцовая защита контейнера ослабляет поток по закону Бугера-Ламберта с фактором накопления B(μd).`
            );
            audioEngineRef.current?.playTaskSuccess();
            return;
          } else {
            const matchedSource = currentScenarioSources.current.find(s => s.mesh === droppedObject);
            if (matchedSource) {
              matchedSource.enclosedInShield = undefined;
            }
          }
        }

        addToast(
          'info',
          'ПРЕДМЕТ ОСТАВЛЕН В ПРОСТРАНСТВЕ',
          `${itemMeta?.nameRu || 'Объект'} сохранил пространственное положение руки. Перенесите его в защитный контейнер.`
        );
      };

      // Единый обработчик стационарных интерактивных объектов МЧС АЭС и сценариев 1-3 (для VR и Desktop)
      const handleSpecialInteractiveObject = (matchedItem: InteractiveObjectInstance): boolean => {
        const envUD = currentEnvGroup.current?.userData;

        const updateSboConsoleScreen = (title: string, subtitle: string, bgHex: string, accentHex: string) => {
          const sboSim = envUD?.sboSimulation as { sboScreenMesh?: THREE.Mesh } | undefined;
          const scr = sboSim?.sboScreenMesh;
          if (!scr) return;
          const mat = scr.material as THREE.MeshBasicMaterial;
          if (mat) {
            if (mat.map) mat.map.dispose();
            mat.map = createEquipmentLabelTexture(title, subtitle, bgHex, accentHex);
            mat.needsUpdate = true;
          }
        };

        // 1. Эвакуационный шлюз (Сценарий 1 МЧС АЭС)
        if (matchedItem.type === 'evac_point') {
          handleAdvanceScenarioStepRef.current(4);
          addToast(
            'success',
            'ЭВАКУАЦИЯ ЗАВЕРШЕНА',
            'Звено МЧС вышло через зеленый коридор в чистую зону санпропускника!'
          );
          audioEngineRef.current?.playTaskSuccess();
          triggerSuccessModalRef.current();
          return true;
        }

        // 2. Силовые рубильники / разъединители (Сценарий 2: 6 кВ, Сценарий 3: кабель 0.4 кВ)
        if (matchedItem.type === 'breaker') {
          if (matchedItem.id === 'power_breaker') {
            const fireSim = envUD?.fireSimulation as
              | { sparkGroup?: THREE.Group; isPowerEnergized: boolean; isFireExtinguished: boolean }
              | undefined;
            if (fireSim) {
              fireSim.isPowerEnergized = false;
              if (fireSim.sparkGroup) fireSim.sparkGroup.visible = false;
            }
            const handle = matchedItem.mesh.userData?.breakerHandle as THREE.Object3D | undefined;
            if (handle) handle.rotation.x = Math.PI / 3;
            const led = matchedItem.mesh.userData?.breakerLed as THREE.Mesh | undefined;
            const ledMat = led?.material as THREE.MeshBasicMaterial | undefined;
            if (ledMat) ledMat.color.setHex(0x22c55e);

            handleAdvanceScenarioStepRef.current(
              fireSim?.isFireExtinguished ? 3 : Math.max(2, scenarioStepRef.current)
            );
            addToast(
              'success',
              'КАБЕЛЬНАЯ ТРАССА 6 кВ ОБЕСТОЧЕНА',
              'Напряжение 6 кВ снято! Теперь можно безопасно ликвидировать возгорание огнетушителем ОУ-5.'
            );
            audioEngineRef.current?.playTaskSuccess();
            return true;
          }

          if (matchedItem.id === 'sbo_power_cable') {
            const sboSim = envUD?.sboSimulation as { isCableConnected: boolean } | undefined;
            if (sboSim) {
              sboSim.isCableConnected = true;
            }
            const plugLed = matchedItem.mesh.userData?.cablePlugLed as THREE.Mesh | undefined;
            const plugMat = plugLed?.material as THREE.MeshBasicMaterial | undefined;
            if (plugMat) plugMat.color.setHex(0x22c55e);

            updateSboConsoleScreen('ВВОД 0.4 кВ ПОДКЛЮЧЕН', 'ЗАПУСТИТЕ МДНУ-150 СПРАВА', '#1c1917', '#f59e0b');
            handleAdvanceScenarioStepRef.current(Math.max(2, scenarioStepRef.current));
            addToast(
              'success',
              'АВАРИЙНЫЙ КАБЕЛЬ 0.4 кВ ПОДКЛЮЧЕН',
              'Схема временного питания собрана. Запустите мобильную установку МДНУ-150!'
            );
            audioEngineRef.current?.playTaskSuccess();
            return true;
          }
        }

        // 3. Диэлектрический углекислотный огнетушитель ОУ-5 (Сценарий 2)
        if (matchedItem.type === 'extinguisher') {
          const fireSim = envUD?.fireSimulation as
            | {
                flameFlames: THREE.Mesh[];
                smokePuffs: THREE.Mesh[];
                fireLight: THREE.PointLight;
                sparkGroup: THREE.Group;
                isPowerEnergized: boolean;
                isFireExtinguished: boolean;
              }
            | undefined;
          if (fireSim) {
            fireSim.isFireExtinguished = true;
            fireSim.flameFlames.forEach(f => {
              f.visible = false;
            });
            fireSim.smokePuffs.forEach(p => {
              const pMat = p.material as THREE.MeshStandardMaterial;
              if (pMat) pMat.opacity = 0.12;
            });
            fireSim.fireLight.intensity = 0;
            fireSim.sparkGroup.visible = false;
          }
          currentScenarioSources.current.forEach(src => {
            if (src.id === 'src_fire_cs137') {
              src.activityMBq = Math.min(src.activityMBq, 2400);
            }
          });
          audioEngineRef.current?.playTaskSuccess();

          if (fireSim && !fireSim.isPowerEnergized) {
            handleAdvanceScenarioStepRef.current(3);
            addToast(
              'success',
              'ПОЖАР ПОТУШЕН ОУ-5 (CO₂)',
              'Трасса 6 кВ обесточена, открытое пламя ликвидировано. Оформите отчет ALARA!'
            );
          } else {
            addToast(
              'warning',
              'ПЛАМЯ СБИТО ОУ-5 — ОБЕСТОЧЬТЕ 6 кВ!',
              'Диэлектрик ОУ-5 безопасен до 10 кВ, но напряжение на кабельной трассе еще не снято! Отключите рубильник 6 кВ.'
            );
          }
          return true;
        }

        // 4. Водяной пожарный ствол ПК-50 (ОПАСНО под напряжением 6 кВ в Сценарии 2!)
        if (matchedItem.type === 'hydrant') {
          const fireSim = envUD?.fireSimulation as
            | {
                flameFlames: THREE.Mesh[];
                smokePuffs: THREE.Mesh[];
                fireLight: THREE.PointLight;
                isPowerEnergized: boolean;
                isFireExtinguished: boolean;
              }
            | undefined;
          if (fireSim?.isPowerEnergized !== false) {
            audioEngineRef.current?.playAlarmSiren();
            rulesEngineRef.current?.triggerProtocolViolation(
              {
                scenarioId: activeScenarioIdRef.current,
                elapsedSec: missionTimeRef.current,
                cumulativeDoseMsv: cumulativeDoseRef.current,
                currentDoseRateMicroSv: currentDoseRateRef.current,
                permitLimitMsv: permitLimitMsvRef.current,
                distanceToNearestSourceM: 1.5,
                ppeLoadoutId: selectedPpeIdRef.current,
                remoteToolId: selectedRemoteToolIdRef.current,
                kShield: protectionAnalysisRef.current.kShield,
                activeShieldMaterialRu: protectionAnalysisRef.current.activeShieldMaterialRu,
                isHoldingRadioactiveSource: false,
                isSourceEnclosedInContainer: false
              },
              'КРИТИЧЕСКОЕ НАРУШЕНИЕ ПТБ МЧС: Подача воды из ствола ПК-50 на кабели под напряжением 6 кВ! Поражение электрическим током!'
            );
            addToast(
              'danger',
              'ПОРАЖЕНИЕ ТОКОМ 6 кВ!',
              'ЗАПРЕЩЕНО тушить водой электроустановки под напряжением 6 кВ! Сначала отключите силовой рубильник.'
            );
            return true;
          }

          if (fireSim) {
            fireSim.isFireExtinguished = true;
            fireSim.flameFlames.forEach(f => {
              f.visible = false;
            });
            fireSim.fireLight.intensity = 0;
          }
          currentScenarioSources.current.forEach(src => {
            if (src.id === 'src_fire_cs137') {
              src.activityMBq = Math.min(src.activityMBq, 2400);
            }
          });
          handleAdvanceScenarioStepRef.current(3);
          addToast(
            'success',
            'ПОЖАР ЛИКВИДИРОВАН ВОДОЙ',
            'Трасса 6 кВ была предварительно обесточена, проливка выполнена безопасно.'
          );
          audioEngineRef.current?.playTaskSuccess();
          return true;
        }

        // 5. Мобильная дизель-насосная установка МДНУ-150 (Сценарий 3)
        if (matchedItem.type === 'generator') {
          const sboSim = envUD?.sboSimulation as
            | {
                emergencyLight: THREE.PointLight;
                isCableConnected: boolean;
                isGeneratorRunning: boolean;
              }
            | undefined;
          if (!sboSim?.isCableConnected) {
            addToast(
              'warning',
              'СНАЧАЛА ПОДКЛЮЧИТЕ КАБЕЛЬ 0.4 кВ',
              'Перед запуском МДНУ-150 подключите силовой кабель к шкафу резервного ввода слева!'
            );
            return true;
          }
          sboSim.isGeneratorRunning = true;
          const statusLed = matchedItem.mesh.userData?.mdnuStatusLed as THREE.Mesh | undefined;
          const statusMat = statusLed?.material as THREE.MeshBasicMaterial | undefined;
          if (statusMat) statusMat.color.setHex(0x22c55e);

          sboSim.emergencyLight.color.setHex(0xf59e0b);
          if (ambientLightRef.current) ambientLightRef.current.intensity = 0.25;
          if (fillDirLightRef.current) fillDirLightRef.current.intensity = 0.35;

          updateSboConsoleScreen('МДНУ-150 В РАБОТЕ', 'ОТКРОЙТЕ ЗАДВИЖКУ АВАРИЙНОЙ ПОДПИТКИ ПГ', '#0f172a', '#38bdf8');
          handleAdvanceScenarioStepRef.current(3);
          addToast(
            'success',
            'МДНУ-150 ЗАПУЩЕНА',
            'Резервное питание подано на щит БПУ! Откройте задвижку аварийной подпитки ПГ у пульта.'
          );
          audioEngineRef.current?.playTaskSuccess();
          return true;
        }

        // 6. Стационарный вентиль / запорный клапан (Сценарий 3 и Сценарий 1 / лаборатории)
        if (matchedItem.type === 'valve') {
          if (activeScenarioIdRef.current === 3 && matchedItem.id === 'sbo_cooling_valve') {
            const sboSim = envUD?.sboSimulation as
              | {
                  deskIndicatorMat: THREE.MeshBasicMaterial;
                  emergencyLight: THREE.PointLight;
                  isCableConnected: boolean;
                  isGeneratorRunning: boolean;
                  isCoolingRestored: boolean;
                }
              | undefined;
            if (!sboSim?.isCableConnected || !sboSim?.isGeneratorRunning) {
              audioEngineRef.current?.playAlarmSiren();
              addToast(
                'warning',
                'НЕТ ЭЛЕКТРОПИТАНИЯ АРМАТУРЫ ПГ',
                'Для запуска аварийной подпитки сначала подключите кабель 0.4 кВ и запустите установку МДНУ-150!'
              );
              return true;
            }
            matchedItem.mesh.rotation.y += Math.PI;
            sboSim.isCoolingRestored = true;
            sboSim.deskIndicatorMat.color.setHex(0x10b981);
            sboSim.emergencyLight.color.setHex(0x10b981);
            if (ambientLightRef.current) ambientLightRef.current.intensity = 0.45;
            if (hemiLightRef.current) hemiLightRef.current.intensity = 0.9;

            updateSboConsoleScreen('РАСХОЛАЖИВАНИЕ ПГ АКТИВНО', 'БПУ • ПИТАНИЕ И ПОДПИТКА В НОРМЕ', '#022c22', '#10b981');
            currentScenarioSources.current.forEach(src => {
              src.activityMBq = Math.min(src.activityMBq, 450);
            });
            addToast(
              'success',
              'АВАРИЙНОЕ РАСХОЛАЖИВАНИЕ ВОССТАНОВЛЕНО',
              'Отказ SBO ликвидирован! Теплоотвод от реакторной установки восстановлен.'
            );
            audioEngineRef.current?.playTaskSuccess();
            triggerSuccessModalRef.current();
            return true;
          }

          matchedItem.mesh.rotation.y += Math.PI;
          currentScenarioSources.current.forEach(src => {
            src.activityMBq = Math.min(src.activityMBq, 450);
          });
          if (activeScenarioIdRef.current === 1) {
            handleAdvanceScenarioStepRef.current(Math.max(3, scenarioStepRef.current + 1));
            addToast(
              'success',
              'КОНТУР ГЦК ПЕРЕКРЫТ',
              `${matchedItem.nameRu} переведен в закрытое положение! Двигайтесь по зеленому коридору к шлюзу эвакуации.`
            );
          } else {
            handleAdvanceScenarioStepRef.current(Math.max(2, scenarioStepRef.current + 1));
            addToast(
              'success',
              'ИСТОЧНИК ПЕРЕКРЫТ / ОТКЛЮЧЕН',
              `${matchedItem.nameRu} переведен в безопасное положение!`
            );
          }
          audioEngineRef.current?.playTaskSuccess();
          return true;
        }

        // 7. Стационарный защитный контейнер
        if (matchedItem.type === 'container') {
          if (currentScenarioSources.current[0]) {
            currentScenarioSources.current[0].activityMBq = 35;
          }
          handleAdvanceScenarioStepRef.current(Math.max(2, scenarioStepRef.current + 1));
          addToast(
            'success',
            'КОНТЕЙНЕР ЗАГЕРМЕТИЗИРОВАН',
            `${matchedItem.nameRu} закрыт крышкой биозащиты. Поток излучения экранирован.`
          );
          audioEngineRef.current?.playTaskSuccess();
          return true;
        }

        // 8. Тактический фонарь на стойке
        if (matchedItem.type === 'flashlight') {
          handleToggleFlashlightRef.current();
          return true;
        }

        return false;
      };

      // ==========================================
      // РЕЖИМ WEBXR VR: ОБРАБОТКА КОНТРОЛЛЕРОВ
      // ==========================================
      if (source === 'vr' && controller) {
        // При 'selectend' / 'squeezeend' (отпускание в VR):
        if (isVRGrabbing === false) {
          if (
            interactionSys.grabbedObject &&
            (interactionSys.activeControllerIndex === null ||
              controllerIndex === undefined ||
              interactionSys.activeControllerIndex === controllerIndex)
          ) {
            const dropRes = interactionSys.releaseObject(floorCandidates, excludeRoots);
            grabbedObjectRef.current = null;
            setIsGripped(false);

            if (dropRes) {
              handlePostDropMissionLogic(
                dropRes.droppedObject,
                dropRes.itemMeta,
                dropRes.isLargeEquipment,
                'VR'
              );
            }
          }
          return;
        }

        // При 'selectstart' (нажатие курка в VR):
        const rayOrigin = APP_SCRATCH_VEC_A;
        const rayDir = APP_SCRATCH_VEC_B;
        controller.getWorldPosition(rayOrigin);
        controller.getWorldDirection(rayDir).negate().normalize();

        if (scenario4ControllerRef.current && cameraRef.current) {
          const vrPlayerPos = APP_SCRATCH_VEC_C;
          cameraRef.current.getWorldPosition(vrPlayerPos);
          const handledTap = scenario4ControllerRef.current.onTapInteract(
            vrPlayerPos,
            rayOrigin,
            rayDir
          );
          if (handledTap) return;
        }

        const matchedItem = interactionSys.raycastInteractive(
          rayOrigin,
          rayDir,
          currentScenarioInteractive.current,
          getEffectiveReachM() + 0.3
        );

        if (matchedItem) {
          // Если операция требует длительного удержания (2–3.5 сек) и ещё не завершена — передаём управление InteractionHoldSystem
          if (matchedItem.holdAction && !matchedItem.interacted) {
            return;
          }

          if (matchedItem.type === 'drop_zone') {
            addToast(
              'info',
              'БЕЗОПАСНАЯ ЗОНА САР',
              `${matchedItem.nameRu}. Принесите сюда опасный объект, ТВЭЛ (щипцами [3]) или пострадавшего для изоляции.`
            );
            return;
          }

          if (evacuationManagerRef.current?.isItemExtracted(matchedItem.id)) {
            addToast('info', 'ОБЪЕКТ УЖЕ ИЗОЛИРОВАН', `${matchedItem.nameRu} уже находится в свинцовом контейнере САР.`);
            return;
          }

          matchedItem.interacted = true;

          if (handleSpecialInteractiveObject(matchedItem)) {
            return;
          }

          // Переносимый предмет: если активны щипцы ЦМ-1.5 [6] и это извлекаемый/опасный предмет — крепим на конец щипцов
          const hasSafeRemoteManipulator =
            activeToolIdRef.current === 'tongs' ||
            selectedRemoteToolIdRef.current === 'manipulator_15m' ||
            selectedRemoteToolIdRef.current === 'telescopic_rod_3m';
          const useTongsHolder =
            activeToolIdRef.current === 'tongs' &&
            Boolean(evacuationManagerRef.current?.isExtractableType(matchedItem));
          const tongsTipHolder = useTongsHolder ? toolManagerRef.current?.getTongsTipHolder(true) : null;
          const grabbedHand =
            xrManagerRef.current?.getControllerHandedness(controllerIndex) ??
            (controllerIndex === 1 ? 'left' : 'right');
          const handHolder =
            tongsTipHolder ||
            (grabbedHand === 'left'
              ? xrManagerRef.current?.leftHandRig?.palmGroup ||
                xrManagerRef.current?.leftHandRig?.rootGroup ||
                controller
              : xrManagerRef.current?.rightHandRig?.palmGroup ||
                xrManagerRef.current?.rightHandRig?.rootGroup ||
                controller);

          interactionSys.grabObject(
            matchedItem,
            handHolder,
            controllerIndex ?? 0,
            useTongsHolder ? GRIP_OFFSETS.tongs_tip : undefined
          );
          grabbedObjectRef.current = matchedItem.mesh;
          setIsGripped(true);
          if (useTongsHolder) {
            toolManagerRef.current?.setTongsClosure(1);
          }
          if (grabbedHand === 'left') {
            xrManagerRef.current?.leftHandRig?.setGripTarget(true);
          } else {
            xrManagerRef.current?.rightHandRig?.setGripTarget(true);
          }

          if (evacuationManagerRef.current?.isExtractableType(matchedItem)) {
            const carryToolId: MchsToolId = hasSafeRemoteManipulator ? 'tongs' : activeToolIdRef.current;
            const carryRes = evacuationManagerRef.current.startCarry(matchedItem, carryToolId);
            setCarriedHazard(evacuationManagerRef.current.getCarriedInfo());
            setMchsMetrics(evacuationManagerRef.current.getMetrics());
            if (carryRes.bareHandViolation) {
              audioEngineRef.current?.playAlarmSiren();
              addToast(
                'danger',
                'НАРУШЕНИЕ ALARA: ЗАХВАТ БЕЗ ЩИПЦОВ!',
                carryRes.violationMessageRu || 'Опасный источник захвачен без дистанционных щипцов ЦМ-1.5 [3]!'
              );
            } else {
              audioEngineRef.current?.playTaskSuccess();
              addToast(
                'success',
                useTongsHolder ? 'ЗАХВАТ ЩИПЦАМИ ЦМ-1.5' : 'ОБЪЕКТ ВЗЯТ ДЛЯ ЭВАКУАЦИИ',
                `${matchedItem.nameRu} — перенесите в свинцовый контейнер САР и отпустите.`
              );
            }
            return;
          }

          addToast('info', 'ПРЕДМЕТ ЗАХВАЧЕН', `${matchedItem.nameRu} удерживается в VR-руке.`);
          audioEngineRef.current?.playTaskSuccess();

          if (matchedItem.type === 'source' || matchedItem.type === 'sample') {
            setScenarioStep(prev => Math.max(prev, 1));
            addToast(
              'warning',
              'РАДИОАКТИВНЫЙ ОБЪЕКТ В РУКЕ',
              'Используйте дистанционный манипулятор и поместите объект в защитный контейнер ТК-6!'
            );
          } else if (matchedItem.type === 'shield' && scenarioStep === 0) {
            setScenarioStep(1);
          }
        }
        return;
      }

      // ==========================================
      // РЕЖИМ DESKTOP (Мышь / Клавиатура E)
      // ==========================================
      // Отпускание: если предмет уже удерживается в руке
      if (interactionSys.grabbedObject) {
        const dropRes = interactionSys.releaseObject(floorCandidates, excludeRoots);
        grabbedObjectRef.current = null;
        setIsGripped(false);
        handRigRef.current?.setGripTarget(false);
        leftHandRigDesktopRef.current?.setGripTarget(false);
        leftHandRigDesktopRef.current?.setExtensionTarget(false);

        if (dropRes) {
          handlePostDropMissionLogic(
            dropRes.droppedObject,
            dropRes.itemMeta,
            dropRes.isLargeEquipment,
            'DESKTOP'
          );
        }
        return;
      }

      // Взятие: raycast из центра камеры (захват осуществляется свободной левой рукой, пока правая держит радиометр)
      if (!cameraRef.current) return;

      const rayOrigin = APP_SCRATCH_VEC_A;
      const rayDir = APP_SCRATCH_VEC_B;
      cameraRef.current.getWorldPosition(rayOrigin);
      cameraRef.current.getWorldDirection(rayDir).normalize();

      const matchedItem = interactionSys.raycastInteractive(
        rayOrigin,
        rayDir,
        currentScenarioInteractive.current,
        getEffectiveReachM()
      );

      if (matchedItem) {
        // Операции с удержанием выполняются в цикле рендера через InteractionHoldSystem
        if (matchedItem.holdAction && !matchedItem.interacted) {
          return;
        }

        if (matchedItem.type === 'drop_zone') {
          addToast(
            'info',
            'БЕЗОПАСНАЯ ЗОНА САР',
            `${matchedItem.nameRu}. Принесите сюда опасный объект, ТВЭЛ (щипцами [3]) или пострадавшего и нажмите E.`
          );
          return;
        }

        if (evacuationManagerRef.current?.isItemExtracted(matchedItem.id)) {
          addToast('info', 'ОБЪЕКТ УЖЕ ИЗОЛИРОВАН', `${matchedItem.nameRu} уже находится в свинцовом контейнере САР.`);
          return;
        }

        matchedItem.interacted = true;

        if (handleSpecialInteractiveObject(matchedItem)) {
          return;
        }

        const hasSafeRemoteManipulator =
          activeToolIdRef.current === 'tongs' ||
          selectedRemoteToolIdRef.current === 'manipulator_15m' ||
          selectedRemoteToolIdRef.current === 'telescopic_rod_3m';
        const useTongsHolder =
          activeToolIdRef.current === 'tongs' &&
          Boolean(evacuationManagerRef.current?.isExtractableType(matchedItem));
        const tongsTipHolder = useTongsHolder ? toolManagerRef.current?.getTongsTipHolder(false) : null;
        const targetHolder =
          tongsTipHolder ||
          leftHandRigDesktopRef.current?.palmGroup ||
          handRigRef.current?.palmGroup ||
          cameraRef.current;

        if (targetHolder) {
          interactionSys.grabObject(
            matchedItem,
            targetHolder,
            null,
            useTongsHolder ? GRIP_OFFSETS.tongs_tip : undefined
          );
          grabbedObjectRef.current = matchedItem.mesh;
          setIsGripped(true);
          if (useTongsHolder) {
            toolManagerRef.current?.setTongsClosure(1);
            handRigRef.current?.setExtensionTarget(true);
          } else {
            leftHandRigDesktopRef.current?.setGripTarget(true);
            leftHandRigDesktopRef.current?.setExtensionTarget(true);
          }
          handRigRef.current?.setGripTarget(true);

          if (evacuationManagerRef.current?.isExtractableType(matchedItem)) {
            const carryToolId: MchsToolId = hasSafeRemoteManipulator ? 'tongs' : activeToolIdRef.current;
            const carryRes = evacuationManagerRef.current.startCarry(matchedItem, carryToolId);
            setCarriedHazard(evacuationManagerRef.current.getCarriedInfo());
            setMchsMetrics(evacuationManagerRef.current.getMetrics());
            if (carryRes.bareHandViolation) {
              audioEngineRef.current?.playAlarmSiren();
              addToast(
                'danger',
                'НАРУШЕНИЕ ALARA: ЗАХВАТ БЕЗ ЩИПЦОВ!',
                carryRes.violationMessageRu || 'Опасный источник захвачен без дистанционных щипцов ЦМ-1.5 [3]!'
              );
            } else {
              audioEngineRef.current?.playTaskSuccess();
              addToast(
                'success',
                useTongsHolder ? 'ЗАХВАТ ЩИПЦАМИ ЦМ-1.5 [3]' : 'ОБЪЕКТ ВЗЯТ ДЛЯ ЭВАКУАЦИИ',
                `${matchedItem.nameRu} — донесите до свинцового контейнера САР и нажмите E.`
              );
            }
            return;
          }

          addToast(
            'info',
            'ПРЕДМЕТ ЗАХВАЧЕН',
            `${matchedItem.nameRu} удерживается в руке. Переместите его в требуемую точку и нажмите E.`
          );
          audioEngineRef.current?.playTaskSuccess();
        }

        if (matchedItem.type === 'source' || matchedItem.type === 'sample') {
          setScenarioStep(prev => Math.max(prev, 1));
          addToast(
            'warning',
            'АКТИВНЫЙ ОБРАЗЕЦ В РУКЕ',
            'Поместите радиоактивный предмет в свинцовый контейнер / пенал ТК-6!'
          );
        } else if (matchedItem.type === 'shield' && scenarioStep === 0) {
          setScenarioStep(1);
        }
      }
    },
    [scenarioStep, addToast]
  );

  // Синхронизация рефа обработчика захвата для WebXR событий
  tryGrabOrInteractRef.current = tryGrabOrInteract;

  // Многошаговый движок учебных заданий лабораторного практикума (Multi-step Task Engine)
  const handleAdvanceScenarioStep = useCallback(
    (targetStep?: number) => {
      setScenarioStep(prev => {
        const totalStages = currentScenario.stages.length;
        const next = typeof targetStep === 'number' ? targetStep : prev + 1;
        const clamped = Math.min(totalStages - 1, Math.max(0, next));
        if (clamped > prev) {
          audioEngineRef.current?.playTaskSuccess();
          const nextStage = currentScenario.stages[clamped];
          addToast(
            'success',
            `ЭТАП ${clamped + 1} АКТИВИРОВАН: ${nextStage?.titleRu || 'Следующий этап'}`,
            nextStage?.taskRu || 'Выполняйте регламентное задание лабораторной работы.'
          );
          if (clamped === totalStages - 1 && activeScenarioIdRef.current !== 3) {
            triggerSuccessModalRef.current();
          }
        }
        return clamped;
      });
    },
    [currentScenario, addToast]
  );
  handleAdvanceScenarioStepRef.current = handleAdvanceScenarioStep;

  // Управление движением и рукой
  const toggleCrouch = () => {
    setIsCrouched(prev => !prev);
  };

  const toggleExtendArm = () => {
    setIsExtendedArm(prev => {
      const next = !prev;
      isExtendedArmRef.current = next;
      handRigRef.current?.setExtensionTarget(next);
      if (next && selectedRemoteToolIdRef.current === 'hand') {
        selectedRemoteToolIdRef.current = 'extended_arm';
        setSelectedRemoteToolId('extended_arm');
        handRigRef.current?.setRemoteToolMode('extended_arm');
        xrManagerRef.current?.setRemoteToolMode('extended_arm');
      } else if (!next && selectedRemoteToolIdRef.current === 'extended_arm') {
        selectedRemoteToolIdRef.current = 'hand';
        setSelectedRemoteToolId('hand');
        handRigRef.current?.setRemoteToolMode('hand');
        xrManagerRef.current?.setRemoteToolMode('hand');
      }
      scenario4ControllerRef.current?.setOperatorLoadoutProfile({
        role: coopRoleRef.current,
        suitId: characterPpeStateRef.current.suitId,
        respiratorId: characterPpeStateRef.current.respiratorId,
        remoteToolId: selectedRemoteToolIdRef.current
      });
      return next;
    });
  };

  const toggleGrip = () => {
    tryGrabOrInteract();
  };

  const rotateWrist = () => {
    handRigRef.current?.rotateWrist();
  };

  const toggleTeleport = () => {
    setIsTeleportActive(prev => {
      const next = !prev;
      if (xrManagerRef.current) xrManagerRef.current.isTeleportActive = next;
      return next;
    });
  };

  const toggleAudio = () => {
    const isNowMuted = audioEngineRef.current?.toggleMute() ?? false;
    setIsAudioMuted(isNowMuted);
  };

  const triggerSuccessModal = useCallback(() => {
    if (hasShownSuccessModalRef.current) return;
    hasShownSuccessModalRef.current = true;
    audioEngineRef.current?.playTaskSuccess();
    addToast(
      'success',
      '🏆 СЦЕНАРИЙ УСПЕШНО ЗАВЕРШЕН!',
      `Все регламентные задачи выполнены. Доза H = ${(cumulativeDoseRef.current * 1000).toFixed(2)} мкЗв, время: ${Math.round(missionTimeRef.current)}с.`
    );

    const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
    const cfg = ScenarioConfigRegistry.getConfig(activeScen.id);

    if (vrUiSystemRef.current) {
      vrUiSystemRef.current.openSuccessModal(
        {
          scenarioId: activeScen.id,
          scenarioTitle: activeScen.titleRu,
          scenarioTask: activeScen.stages[0]?.taskRu || '',
          facilityRu: activeScen.facilityRu,
          cumulativeDoseMsv: cumulativeDoseRef.current,
          missionTimeSec: missionTimeRef.current,
          hLimitMsv: cfg.hLimitMsv,
          completedTasksCount: activeScen.stages.length,
          totalTasksCount: activeScen.stages.length,
          alaraRating: cumulativeDoseRef.current < cfg.hLimitMsv * 0.4 ? 'ОТЛИЧНО (КЛАСС А)' : 'ХОРОШО (КЛАСС B)'
        },
        () => {
          const nextId = (activeScen.id % SCENARIOS.length) + 1;
          handleScenarioChangeRef.current(nextId);
        },
        () => {
          handleResetScenarioRef.current();
        },
        () => {
          handleOpenAlaraReportRef.current();
        },
        () => {}
      );
    }
  }, [addToast]);

  const toggleVR = async () => {
    try {
      if (!rendererRef.current) {
        addToast(
          'warning',
          'WEBXR НЕ ГОТОВ',
          'Графический рендерер еще инициализируется. Попробуйте через секунду.'
        );
        return;
      }

      rendererRef.current.xr.enabled = true;

      if (typeof navigator === 'undefined' || !('xr' in navigator) || !navigator.xr) {
        addToast(
          'warning',
          'WEBXR НЕ ПОДДЕРЖИВАЕТСЯ',
          'Ваш браузер или система не поддерживают WebXR Device API. Используйте Chrome, Edge или встроенный браузер VR-гарнитуры.'
        );
        return;
      }

      const isSupp = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
      if (!isSupp && !isInVR) {
        addToast(
          'warning',
          'VR-ШЛЕМ НЕ ОБНАРУЖЕН',
          'Шлем виртуальной реальности не найден. Подключите гарнитуру (Quest, Vive, Pico, Index) и запустите OpenXR / SteamVR.'
        );
        return;
      }

      if (xrManagerRef.current) {
        const wasInVR = isInVR;
        const success = await xrManagerRef.current.toggleVRSession();
        if (success) {
          addToast(
            'success',
            'VR-РЕЖИМ АКТИВИРОВАН',
            'Добро пожаловать в WebXR! 3D-планшет закреплен на левом запястье. Нажмите на дисплей запястья для скрытия/показа VR HUD.'
          );
        } else if (wasInVR) {
          addToast('info', 'VR-СЕССИЯ ЗАВЕРШЕНА', 'Возврат к стандартному монитору ПК.');
        } else if (xrManagerRef.current.lastErrorMessageRu) {
          addToast('warning', 'НЕ УДАЛОСЬ ВОЙТИ В VR', xrManagerRef.current.lastErrorMessageRu);
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn('VR Mode Toggle Error:', err);
      addToast('danger', 'СБОЙ ВХОДА В VR', `Ошибка WebXR: ${errorMsg}`);
    }
  };

  const toggleRadiationField = useCallback((forceState?: boolean) => {
    if (radiationFieldRef.current) {
      if (typeof forceState === 'boolean') {
        radiationFieldRef.current.setEnabled(forceState);
        setIsRadiationFieldVisible(forceState);
      } else {
        const next = radiationFieldRef.current.toggle();
        setIsRadiationFieldVisible(next);
      }
    } else {
      setIsRadiationFieldVisible(prev => (typeof forceState === 'boolean' ? forceState : !prev));
    }
  }, []);

  // Управление тактическим фонарем левой руки (кнопка X/A контроллера, кнопка VR HUD, клавиша F или голосовая команда)
  const handleToggleFlashlight = useCallback(
    (forceState?: boolean) => {
      const isVRActive =
        (xrManagerRef.current?.isInVR ?? false) || (rendererRef.current?.xr.isPresenting ?? false);
      const nextState = typeof forceState === 'boolean' ? forceState : !isFlashlightOnRef.current;

      // Жесткая привязка в локальную систему координат левой кисти через .equipFlashlight() (.attach())
      // со сбросом офсетов (-0.02, 0.01, -0.03), цели (0, 0, -5) и позы хвата curl = 0.45 без мирового дрифта
      if (xrManagerRef.current?.leftHandRig) {
        const vrFl = xrManagerRef.current.leftHandRig.equipFlashlight(isVRActive ? nextState : false);
        if (isVRActive) {
          flashlightMeshRef.current = vrFl.flashlightMesh;
        }
      }
      if (leftHandRigDesktopRef.current) {
        const deskFl = leftHandRigDesktopRef.current.equipFlashlight(!isVRActive ? nextState : false);
        if (!isVRActive) {
          flashlightMeshRef.current = deskFl.flashlightMesh;
        }
      }

      setIsFlashlightEquipped(true);
      isFlashlightEquippedRef.current = true;
      setIsFlashlightOn(nextState);
      isFlashlightOnRef.current = nextState;
      audioEngineRef.current?.playTaskSuccess();
      addToast(
        'info',
        nextState ? 'ПРОЖЕКТОР ЛЕВОЙ РУКИ ВКЛЮЧЕН' : 'ПРОЖЕКТОР ЛЕВОЙ РУКИ ВЫКЛЮЧЕН',
        nextState
          ? 'Узконаправленный луч ФПС-4ВЗГ (68 кд) направлен вдоль оси -Z левой кисти для осмотра темных зон.'
          : 'Луч тактического фонаря на левой руке отключен.'
      );
    },
    [addToast]
  );

  // Переключение режима низкой освещенности (бункер / техподполье / аварийное освещение)
  const handleToggleLowLightMode = useCallback(() => {
    const nextLowLight = !isLowLightModeRef.current;
    setIsLowLightMode(nextLowLight);
    isLowLightModeRef.current = nextLowLight;
    const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
    applySceneLightingMode(nextLowLight, activeScen);

    // При переходе в темноту автоматически включаем фонарь на левой руке, если он был выключен
    if (nextLowLight && !isFlashlightOnRef.current) {
      const isVRActive =
        (xrManagerRef.current?.isInVR ?? false) || (rendererRef.current?.xr.isPresenting ?? false);
      if (xrManagerRef.current?.leftHandRig) {
        xrManagerRef.current.leftHandRig.equipFlashlight(isVRActive);
      }
      if (leftHandRigDesktopRef.current) {
        leftHandRigDesktopRef.current.equipFlashlight(!isVRActive);
      }
      setIsFlashlightEquipped(true);
      isFlashlightEquippedRef.current = true;
      setIsFlashlightOn(true);
      isFlashlightOnRef.current = true;
    }

    addToast(
      'info',
      nextLowLight ? 'РЕЖИМ БУНКЕРА (НИЗКАЯ ОСВЕЩЕННОСТЬ)' : 'ШТАТНОЕ ПРОМЫШЛЕННОЕ ОСВЕЩЕНИЕ',
      nextLowLight
        ? 'Основное освещение приглушено. Используйте тактический фонарь левой руки [X/A] / [F] для осмотра помещения.'
        : 'Полное аварийно-промышленное освещение зала восстановлено.'
    );
  }, [addToast, applySceneLightingMode]);

  const handleOpenGostGuide = () => {
    if (xrManagerRef.current?.isInVR && vrUiSystemRef.current) {
      vrUiSystemRef.current.openGostModal(
        selectedInstrumentId,
        id => {
          syncLoadoutTo3DScene(id);
          addToast('info', 'ПРИБОР ВЫБРАН В VR', `Активирован: ${GOST_INSTRUMENTS[id].name}`);
        },
        () => {}
      );
    } else {
      setIsGostModalOpen(true);
    }
  };

  const handleOpenAlaraReport = () => {
    if (scenarioStepRef.current >= 6) {
      handleAdvanceScenarioStep(currentScenario.stages.length);
    }
    if (xrManagerRef.current?.isInVR && vrUiSystemRef.current) {
      vrUiSystemRef.current.openReportModal(
        cumulativeDoseRef.current,
        missionTimeRef.current,
        chartLabels,
        chartDoseRate,
        currentScenario.titleRu,
        () => {
          loadScenario(currentScenario);
          vrUiSystemRef.current?.closeModals();
        },
        () => {}
      );
    } else {
      setIsReportModalOpen(true);
    }
  };

  const handleChangeHapticStrength = useCallback((strength: number) => {
    const clamped = Math.max(0, Math.min(1, Math.round(strength * 100) / 100));
    setHapticStrength(clamped);
    hapticStrengthRef.current = clamped;
    if (xrManagerRef.current) {
      xrManagerRef.current.triggerHapticPreviewPulse(clamped);
    }
  }, []);

  // Обработчики для модуля голосового протоколирования и команд VoiceTaskLogger
  const handleStartVoicePushToTalk = useCallback(() => {
    voiceLoggerRef.current?.startPushToTalk();
  }, []);

  const handleStopVoicePushToTalk = useCallback(() => {
    voiceLoggerRef.current?.stopPushToTalk();
  }, []);

  const handleToggleVoiceMode = useCallback(() => {
    if (!voiceLoggerRef.current) return;
    const cur = voiceLoggerRef.current.mode;
    const next: VoiceLoggerMode =
      cur === 'hybrid' ? 'dictation' : cur === 'dictation' ? 'commands' : 'hybrid';
    voiceLoggerRef.current.setMode(next);
  }, []);

  const handleSubmitVoiceFallbackText = useCallback((text: string, mode?: VoiceLoggerMode) => {
    voiceLoggerRef.current?.submitTextFallback(text, mode);
  }, []);

  // Синхронизация рефов для прямого вызова из кнопок VR HUD, контроллеров WebXR и голосовых команд VoiceTaskLogger
  handleOpenGostGuideRef.current = handleOpenGostGuide;
  handleOpenAlaraReportRef.current = handleOpenAlaraReport;
  handleToggleFlashlightRef.current = handleToggleFlashlight;
  handleToggleRadiationFieldRef.current = toggleRadiationField;
  handleResetChartsRef.current = handleResetCharts;
  handleExportCsvCommandRef.current = () => {
    setExportCsvSignal(prev => prev + 1);
  };
  handleToggleAnalyticsCommandRef.current = (forceExpanded?: boolean) => {
    if (typeof forceExpanded === 'boolean') {
      setIsAnalyticsMinimized(!forceExpanded);
    } else {
      setIsAnalyticsMinimized(prev => !prev);
    }
  };
  handleChangeHapticStrengthRef.current = handleChangeHapticStrength;
  handleResetScenarioRef.current = handleResetScenario;
  handleScenarioChangeRef.current = handleScenarioChange;
  triggerSuccessModalRef.current = triggerSuccessModal;
  handleEscapeOrMenuKeyRef.current = () => {
    if (
      isGostModalOpen ||
      isReportModalOpen ||
      isLabNotebookOpen ||
      isSpectrometryOpen ||
      isAARModalOpen ||
      isAnalyticsWindowOpen
    ) {
      setIsGostModalOpen(false);
      setIsReportModalOpen(false);
      setIsLabNotebookOpen(false);
      setIsSpectrometryOpen(false);
      setIsAARModalOpen(false);
      setIsAnalyticsWindowOpen(false);
      vrUiSystemRef.current?.closeModals();
      return;
    }
    setIsMainMenuOpen(prev => !prev);
  };

  const handleToggleNozzleSprayMode = useCallback(() => {
    if (!toolManagerRef.current) return;
    const nextMode = toolManagerRef.current.toggleNozzleSprayMode();
    setNozzleSprayMode(nextMode);
    addToast(
      'info',
      nextMode === 'SOLID' ? 'СТВОЛ ГМ-70: СПЛОШНАЯ СТРУЯ' : 'СТВОЛ ГМ-70: РАСПЫЛЁННАЯ ЗАВЕСА',
      nextMode === 'SOLID'
        ? 'Дальнобойная компактная струя (12 м) активирована.'
        : 'Широкий конус распыления активирован.'
    );
  }, [addToast]);

  const handleChangeShadowQuality = useCallback((quality: ShadowQualitySetting) => {
    setShadowQuality(quality);
    const size = quality === 'low' ? 512 : 1024;
    if (mainDirLightRef.current) {
      mainDirLightRef.current.shadow.mapSize.set(size, size);
      if (mainDirLightRef.current.shadow.map) {
        mainDirLightRef.current.shadow.map.dispose();
        mainDirLightRef.current.shadow.map = null;
      }
    }
    if (rendererRef.current) {
      rendererRef.current.shadowMap.needsUpdate = true;
    }
  }, []);

  const activeScenarioAtmosphere = useMemo(
    () => getScenarioDataById(activeScenarioId).atmosphere,
    [activeScenarioId]
  );

  const handleScenarioManagerStateChange = useCallback((snap: { state: string }) => {
    if (snap.state === 'COMPLETED' && activeScenarioIdRef.current !== 4) {
      triggerSuccessModalRef.current();
    }
  }, []);

  const handleOxygenDepletion = useCallback((remPct: number, pressMpa: number) => {
    setPpeCheckState(prev => ({
      ...prev,
      oxygenOrFilterReservePercent: remPct,
      cylinderPressureMpa: pressMpa
    }));
  }, []);

  const handleVRFlashlightChange = useCallback((nextOn: boolean) => {
    isFlashlightOnRef.current = nextOn;
    setIsFlashlightOn(nextOn);
  }, []);

  const getSessionLimitsSummary = useCallback((): SessionExposureLimitsTracker => {
    const t = sessionExposureLimitsRef.current;
    return {
      ...t,
      limitEvents: [...t.limitEvents]
    };
  }, []);

  return (
    <div className="fixed inset-0 w-screen h-[100dvh] overflow-hidden bg-slate-950 select-none font-sans">
      {/* 3D Canvas Контейнер: абсолютное позиционирование на весь экран, z-index 0 */}
      <div
        id="canvas-container"
        ref={containerRef}
        className="absolute inset-0 w-full h-full z-0 cursor-grab active:cursor-grabbing overflow-hidden pointer-events-auto"
      />

      {/* Физически корректное освещение гермозон (PBR Scene Lighting, Volumetric Fog, Contact Shadows) */}
      <PBRSceneLighting
        sceneRef={sceneRef}
        rendererRef={rendererRef}
        isLowLightMode={isLowLightMode}
        scenarioId={activeScenarioId}
      />

      {/* Кастомный пост-эффект панорамного забрала маски/противогаза и радиационного шума при МЭД > 10 мЗв/ч */}
      <VisorPostProcessing
        cameraRef={cameraRef}
        rendererRef={rendererRef}
        doseRateMsvPerHour={currentDoseRateMicroSv / 1000.0}
        vitalsBpm={vitalsBpm}
        isFlashlightOn={isFlashlightOn}
        isLowLightZone={isLowLightMode}
      />

      {/* Стейт-машина 4 сценариев (INIT -> RUNNING -> CRITICAL_WARNING -> COMPLETED / FAILED) и 3D-спавнер источников угроз */}
      <ScenarioManager
        scenarioId={activeScenarioId}
        playerGroupRef={playerGroupRef}
        isWearingHazmatPpe={selectedPpeId !== 'none'}
        randomizedHazardMode={isRandomizedHazardMode}
        onStateChange={handleScenarioManagerStateChange}
      >
        <HazardSourceSpawner
          sceneOrGroupRef={currentEnvGroup}
          atmosphere={activeScenarioAtmosphere}
        />
      </ScenarioManager>

      {/* Симулятор физиологического стресса, расхода кислорода АСВ-2, тепловой нагрузки, дыма и запотевания забрала */}
      <PhysiologicalStress
        ppeState={ppeCheckState}
        currentDoseRateMsvPerHour={currentDoseRateMicroSv / 1000.0}
        accumulatedDoseMsv={cumulativeDoseMsv}
        ambientTemperatureC={
          activeScenarioId === 4 && scenario4Snapshot
            ? 22 + scenario4Snapshot.thermalHeatLoad01 * 180
            : 22
        }
        smokeExposure01={
          activeScenarioId === 4 && scenario4Snapshot
            ? scenario4Snapshot.smokeExposure01
            : 0
        }
        stressDampingFactor={COOP_ROLE_SPECIFICATIONS[coopRole].modifiers.stressDampingFactor}
        isPhysicalExertion={Boolean(isMovingRef.current || isCrouched || isGripped || isExtendedArm)}
        onUpdateTelemetry={setPhysioTelemetry}
        onOxygenDepletion={handleOxygenDepletion}
      />

      {/* Защита интерфейса в VR-шлеме: при isPresenting === true 2D HTML/DOM оверлей ПОЛНОСТЬЮ исключается из рендера (return null) */}
      <VRManager
        rendererRef={rendererRef}
        isInVR={isXRPresenting}
        disableInternalFlashlightRig
        onFlashlightChange={handleVRFlashlightChange}
      >
        <Desktop2DHUDOverlayGuard isPresenting={isXRPresenting}>

        <div
          id="ui-hud"
          className="absolute inset-0 h-[100dvh] overflow-hidden pointer-events-none pb-16 px-4 pt-4 box-border z-10 flex flex-col justify-between transition-opacity duration-300 opacity-100"
        >
          {/* Всплывающие уведомления (Toasts) */}
          <ToastNotifications toasts={toasts} onDismiss={dismissToast} />

          {/* Основной HUD интерфейс тренажера (Zero-Clutter HUD) */}
          <HUD
            scenario={currentScenario}
            scenarioStep={scenarioStep}
            onScenarioChange={handleScenarioChange}
            selectedInstrumentId={selectedInstrumentId}
            onInstrumentChange={id => {
              syncLoadoutTo3DScene(id);
              addToast('info', 'ПРИБОР СМЕНЕН', `Выбран: ${GOST_INSTRUMENTS[id].name}. Характеристики обновлены.`);
            }}
            isAudioMuted={isAudioMuted}
            onToggleAudio={toggleAudio}
            threatLevel={threatLevel}
            zoneName={zoneName}
            cumulativeDoseMsv={cumulativeDoseMsv}
            currentDoseRateMicroSv={currentDoseRateMicroSv}
            vitalsBpm={vitalsBpm}
            isCrouched={isCrouched}
            onToggleCrouch={toggleCrouch}
            isExtendedArm={isExtendedArm}
            onToggleExtendArm={toggleExtendArm}
            isGripped={isGripped}
            onToggleGrip={toggleGrip}
            onRotateWrist={rotateWrist}
            isTeleportActive={isTeleportActive}
            onToggleTeleport={toggleTeleport}
            onOpenGostGuide={handleOpenGostGuide}
            onOpenAlaraReport={handleOpenAlaraReport}
            onToggleVR={toggleVR}
            isVRSupported={isVRSupported}
            isInVR={isInVR}
            isRadiationFieldVisible={isRadiationFieldVisible}
            onToggleRadiationField={toggleRadiationField}
            telemetryHistory={telemetryHistory}
            protectionAnalysis={protectionAnalysis}
            missionTimeSec={missionTimeSec}
            permitLimitMsv={permitLimitMsv}
            onChangePermitLimitMsv={limit => {
              setPermitLimitMsv(limit);
              permitLimitWarnedRef.current = false;
              addToast(
                'info',
                'ЛИМИТ НАРЯДА-ДОПУСКА ОБНОВЛЕН',
                `Контрольный предел дозы установлен на ${(limit * 1000).toFixed(0)} мкЗв (${limit.toFixed(2)} мЗв).`
              );
            }}
            selectedPpeId={selectedPpeId}
            onChangePpeId={ppeId => {
              syncLoadoutTo3DScene(undefined, undefined, ppeId);
              const ppe = PPE_LOADOUTS[ppeId];
              addToast(
                'success',
                `ЭКИПИРОВАНО: ${ppe.shortNameRu.toUpperCase()}`,
                `${ppe.descriptionRu}`
              );
            }}
            selectedRemoteToolId={selectedRemoteToolId}
            onChangeRemoteToolId={toolId => {
              syncLoadoutTo3DScene(undefined, undefined, undefined, toolId);
              const tool = REMOTE_TOOLS[toolId];
              addToast(
                'info',
                `ДИСТАНЦИОННЫЙ ИНСТРУМЕНТ: ${tool.shortNameRu.toUpperCase()}`,
                `${tool.descriptionRu}`
              );
            }}
            onResetCharts={handleResetCharts}
            isFlashlightOn={isFlashlightOn}
            isFlashlightEquipped={isFlashlightEquipped}
            onToggleFlashlight={() => handleToggleFlashlight()}
            isLowLightMode={isLowLightMode}
            onToggleLowLightMode={handleToggleLowLightMode}
            hapticStrength={hapticStrength}
            onChangeHapticStrength={handleChangeHapticStrength}
            voiceLogs={voiceLogs}
            isVoicePushToTalkActive={isVoicePushToTalkActive}
            voiceMode={voiceMode}
            voiceVolumeLevel={voiceVolumeLevel}
            voiceInterimTranscript={voiceInterimTranscript}
            latestVoiceToast={latestVoiceToast}
            onStartVoicePushToTalk={handleStartVoicePushToTalk}
            onStopVoicePushToTalk={handleStopVoicePushToTalk}
            onToggleVoiceMode={handleToggleVoiceMode}
            onSubmitVoiceFallbackText={handleSubmitVoiceFallbackText}
            isAnalyticsMinimized={isAnalyticsMinimized}
            onToggleAnalyticsMinimized={setIsAnalyticsMinimized}
            exportCsvSignal={exportCsvSignal}
            scenarioConfig={scenarioConfig}
            rulesEvaluation={rulesEvaluation}
            onResetScenario={handleResetScenario}
            onOpenMainMenu={() => setIsMainMenuOpen(true)}
            onOpenTablet={() => setIsMainMenuOpen(true)}
            onOpenLabNotebook={() => {
              setIsLabNotebookOpen(true);
              if (scenarioStepRef.current === 4) {
                handleAdvanceScenarioStep(5);
              }
            }}
            onOpenSpectrometry={() => setIsSpectrometryOpen(true)}
            isExamMode={isExamMode}
            onChangeExamMode={setIsExamMode}
            onStepChange={handleAdvanceScenarioStep}
            visible={isHudVisible}
            onToggleVisibility={v => {
              setIsHudVisible(v);
              isHudVisibleRef.current = v;
              vrUiSystemRef.current?.setHudVisible(v);
            }}
            targetedObject={targetedObject}
            coopRoleCallsign={COOP_ROLE_SPECIFICATIONS[coopRole].callsignRu}
            coopRoleBadgeCode={COOP_ROLE_SPECIFICATIONS[coopRole].badgeCodeRu}
            coopRoleSummaryRu={COOP_ROLE_SPECIFICATIONS[coopRole].prioritySummaryRu}
            coopPeersCount={coopPeers.length}
            effectiveReachM={Number(
              (
                3.2 +
                (REMOTE_TOOLS[selectedRemoteToolId]?.addedDistanceM ?? 0) +
                COOP_ROLE_SPECIFICATIONS[coopRole].modifiers.interactionReachBonusM +
                (isExtendedArm && selectedRemoteToolId !== 'extended_arm' ? 0.45 : 0)
              ).toFixed(2)
            )}
            onCycleCoopRole={() => {
              const order: CoopSquadRole[] = [
                'RECON_DOSIMETRIST',
                'LIQUIDATOR_OPERATOR',
                'INCIDENT_COMMANDER'
              ];
              const next = order[(order.indexOf(coopRole) + 1) % order.length];
              applyCoopRole(next);
              const nextSpec = COOP_ROLE_SPECIFICATIONS[next];
              addToast('info', `РОЛЬ: ${nextSpec.callsignRu}`, nextSpec.prioritySummaryRu);
            }}
            oxygenPercent={physioTelemetry.remainingOxygenPercent}
            spO2Percent={physioTelemetry.spO2Percent}
            coreBodyTempC={physioTelemetry.coreBodyTempC}
            hilLabel={
              hilState?.transportMode === 'VIRTUAL_ESP32_LOOPBACK'
                ? 'ESP32-SIM'
                : hilState?.transportMode || 'OFF'
            }
            hilCountsPerSec={hilLastFrame?.geigerCountsPerSecond ?? 0}
            hilProtocolTitle={hilLastFrame?.formattedProtocolFrame || 'Протокол HIL ESP32'}
            onConnectHil={() => hilConnectorRef.current?.connectWebBluetooth()}
            isRandomizedHazardMode={isRandomizedHazardMode}
            onToggleRandomizedHazardMode={() => {
              setIsRandomizedHazardMode(prev => {
                const next = !prev;
                addToast(
                  'info',
                  next ? 'СЛУЧАЙНЫЙ РЕЖИМ УГРОЗ: ВКЛ' : 'СЛУЧАЙНЫЙ РЕЖИМ УГРОЗ: ВЫКЛ',
                  next
                    ? 'Координаты и активность источников процедурно сгенерированы в границах помещения.'
                    : 'Восстановлена паспортная дислокация источников по регламенту сценария.'
                );
                return next;
              });
            }}
            onOpenAAR={() => setIsAARModalOpen(true)}
            doseResetCount={doseResetCount}
            getSessionLimitsSummary={getSessionLimitsSummary}
            activeToolId={activeToolId}
            onSelectTool={selectMchsTool}
            holdSnapshot={holdSnapshot}
            carriedHazard={carriedHazard}
            mchsMetrics={mchsMetrics}
            scenario4Snapshot={scenario4Snapshot}
            nozzleSprayMode={nozzleSprayMode}
            onToggleNozzleSprayMode={handleToggleNozzleSprayMode}
            isAnalyticsWindowOpen={isAnalyticsWindowOpen}
            onCloseAnalyticsWindow={() => setIsAnalyticsWindowOpen(false)}
          />
        </div>

        {/* HUD и финальный протокол разбора МЧС для Сценария №4 (.glb АЭС) */}
        {activeScenarioId === 4 && scenario4Snapshot && (
          <Scenario4Hud
            snapshot={scenario4Snapshot}
            isHudVisible={isHudVisible}
            onRestart={handleResetScenario}
            onRetryLoadGlb={() => scenario4ControllerRef.current?.retryLoadGlb()}
            onFocusModel={() => scenario4ControllerRef.current?.focusCameraOnModel()}
            onSelectCustomGlbFile={file => {
              void scenario4ControllerRef.current?.loadCustomGlbFile(file);
            }}
            onBoardOrExitVehicle={() => {
              scenario4ControllerRef.current?.onBoardOrExitVehicle();
            }}
            onStartAutopilot={buildingIdx => {
              scenario4ControllerRef.current?.startVehicleAutopilot(buildingIdx);
            }}
            onCancelAutopilot={() => {
              scenario4ControllerRef.current?.cancelVehicleAutopilot();
            }}
            onToggleBeacons={() => {
              scenario4ControllerRef.current?.toggleVehicleBeacons();
            }}
          />
        )}

        {/* Единый Тактический Планшет (вызов по [Tab] или [Esc]) */}
        <TacticalTabletModal
          isOpen={isMainMenuOpen}
          onClose={() => {
            setIsMainMenuOpen(false);
            syncLoadoutTo3DScene();
          }}
          isVRSupported={isVRSupported}
          isInVR={isInVR}
          onToggleVR={toggleVR}
          activeScenarioId={activeScenarioId}
          scenario={currentScenario}
          scenarioStep={scenarioStep}
          onSelectScenario={id => {
            handleScenarioChange(id);
            setIsMainMenuOpen(false);
          }}
          onStepChange={handleAdvanceScenarioStep}
          onResetScenario={handleResetScenario}
          scenario4Snapshot={scenario4Snapshot}
          isExamMode={isExamMode}
          onChangeExamMode={setIsExamMode}
          isRandomizedHazardMode={isRandomizedHazardMode}
          onToggleRandomizedHazardMode={() => {
            setIsRandomizedHazardMode(prev => !prev);
          }}
          selectedInstrumentId={selectedInstrumentId}
          onSelectInstrument={id => {
            syncLoadoutTo3DScene(id);
            addToast('info', 'ПРИБОР СМЕНЕН', `Выбран: ${GOST_INSTRUMENTS[id].name}`);
          }}
          selectedIsotopeId={activeCustomIsotopeId}
          onSelectIsotope={iso => {
            setActiveCustomIsotopeId(iso);
            addToast('info', 'ИЗОТОП УСТАНОВЛЕН', `Выбран радионуклид: ${iso}`);
          }}
          ppeState={characterPpeState}
          onChangePPE={newState => {
            syncLoadoutTo3DScene(undefined, newState);
          }}
          selectedPpeId={selectedPpeId}
          onChangePpeId={ppeId => {
            syncLoadoutTo3DScene(undefined, undefined, ppeId);
            const ppe = PPE_LOADOUTS[ppeId];
            addToast('success', `ЭКИПИРОВАНО: ${ppe.shortNameRu.toUpperCase()}`, ppe.descriptionRu);
          }}
          selectedRemoteToolId={selectedRemoteToolId}
          onSelectRemoteTool={toolId => {
            syncLoadoutTo3DScene(undefined, undefined, undefined, toolId);
            addToast('info', 'ИНСТРУМЕНТ ВЫБРАН', `Экипирован: ${REMOTE_TOOLS[toolId]?.nameRu}`);
          }}
          vitalsBpm={vitalsBpm}
          oxygenPercent={physioTelemetry.remainingOxygenPercent}
          spO2Percent={physioTelemetry.spO2Percent}
          coreBodyTempC={physioTelemetry.coreBodyTempC}
          coopRole={coopRole}
          coopRoleCallsign={COOP_ROLE_SPECIFICATIONS[coopRole].callsignRu}
          coopPeersCount={coopPeers.length}
          effectiveReachM={Number(
            (
              3.2 +
              (REMOTE_TOOLS[selectedRemoteToolId]?.addedDistanceM ?? 0) +
              COOP_ROLE_SPECIFICATIONS[coopRole].modifiers.interactionReachBonusM +
              (isExtendedArm && selectedRemoteToolId !== 'extended_arm' ? 0.45 : 0)
            ).toFixed(2)
          )}
          onSelectCoopRole={role => {
            applyCoopRole(role);
            const spec = COOP_ROLE_SPECIFICATIONS[role];
            addToast('info', `РОЛЬ ЗВЕНА: ${spec.callsignRu}`, spec.prioritySummaryRu);
          }}
          onCycleCoopRole={() => {
            const order: CoopSquadRole[] = [
              'RECON_DOSIMETRIST',
              'LIQUIDATOR_OPERATOR',
              'INCIDENT_COMMANDER'
            ];
            const next = order[(order.indexOf(coopRole) + 1) % order.length];
            applyCoopRole(next);
            const nextSpec = COOP_ROLE_SPECIFICATIONS[next];
            addToast('info', `РОЛЬ ЗВЕНА: ${nextSpec.callsignRu}`, nextSpec.prioritySummaryRu);
          }}
          currentDoseRateMicroSv={currentDoseRateMicroSv}
          cumulativeDoseMsv={cumulativeDoseMsv}
          missionTimeSec={missionTimeSec}
          permitLimitMsv={permitLimitMsv}
          onChangePermitLimitMsv={limit => {
            setPermitLimitMsv(limit);
            permitLimitWarnedRef.current = false;
            addToast(
              'info',
              'ЛИМИТ НАРЯДА-ДОПУСКА ОБНОВЛЕН',
              `Контрольный предел дозы установлен на ${(limit * 1000).toFixed(0)} мкЗв.`
            );
          }}
          protectionAnalysis={protectionAnalysis}
          telemetryHistory={telemetryHistory}
          scenarioConfig={scenarioConfig}
          rulesEvaluation={rulesEvaluation}
          doseResetCount={doseResetCount}
          getSessionLimitsSummary={getSessionLimitsSummary}
          mchsMetrics={mchsMetrics}
          onOpenAnalyticsWindow={() => setIsAnalyticsWindowOpen(true)}
          onExportCsv={() => setExportCsvSignal(prev => prev + 1)}
          onResetCharts={handleResetCharts}
          onOpenLabNotebook={() => setIsLabNotebookOpen(true)}
          onOpenSpectrometry={() => setIsSpectrometryOpen(true)}
          onOpenGostGuide={handleOpenGostGuide}
          onOpenAlaraReport={handleOpenAlaraReport}
          onOpenAAR={() => setIsAARModalOpen(true)}
          onToast={addToast}
          voiceLogs={voiceLogs}
          isVoicePushToTalkActive={isVoicePushToTalkActive}
          voiceMode={voiceMode}
          onStartVoicePushToTalk={handleStartVoicePushToTalk}
          onStopVoicePushToTalk={handleStopVoicePushToTalk}
          onToggleVoiceMode={handleToggleVoiceMode}
          onSubmitVoiceFallbackText={handleSubmitVoiceFallbackText}
          hilLabel={
            hilState?.transportMode === 'VIRTUAL_ESP32_LOOPBACK'
              ? 'ESP32-SIM'
              : hilState?.transportMode || 'OFF'
          }
          hilCountsPerSec={hilLastFrame?.geigerCountsPerSecond ?? 0}
          hilProtocolTitle={hilLastFrame?.formattedProtocolFrame || 'Протокол HIL ESP32'}
          onConnectHil={() => hilConnectorRef.current?.connectWebBluetooth()}
          isLowLightMode={isLowLightMode}
          onToggleLowLightMode={handleToggleLowLightMode}
          isRadiationFieldVisible={isRadiationFieldVisible}
          onToggleRadiationField={() => toggleRadiationField()}
          isAudioMuted={isAudioMuted}
          onToggleAudio={toggleAudio}
          hapticStrength={hapticStrength}
          onChangeHapticStrength={handleChangeHapticStrength}
          shadowQuality={shadowQuality}
          onChangeShadowQuality={handleChangeShadowQuality}
          hideStartupModal={hideStartupModal}
          onToggleHideStartupModal={handleToggleHideStartupModal}
        />

        {/* Интерактивный лабораторный журнал студента (Самостоятельные расчёты) */}
        <LabNotebookWidget
          isOpen={isLabNotebookOpen}
          onClose={() => setIsLabNotebookOpen(false)}
          currentDoseRateMicroSv={currentDoseRateMicroSv}
          currentDistanceMeters={telemetryHistory[telemetryHistory.length - 1]?.distanceM || 1.0}
          selectedShieldMaterial="lead"
          selectedShieldThicknessCm={2.0}
        />

        {/* Многоканальный анализатор спектра и идентификатор радионуклидов */}
        <GammaSpectrometryWidget
          isOpen={isSpectrometryOpen}
          onClose={() => setIsSpectrometryOpen(false)}
          selectedInstrumentId={selectedInstrumentId}
          activeIsotopeId={currentScenario.id === 3 ? (isExamMode ? 'Cs-137' : 'Cs-137') : (currentScenario.dominantIsotopes[0] || activeCustomIsotopeId)}
          currentDoseRateMicroSv={currentDoseRateMicroSv}
          isBlindMode={isExamMode || currentScenario.id === 3}
          onIdentifyVerdict={nuclide => {
            addToast('success', 'ИДЕНТИФИКАЦИЯ ЗАВЕРШЕНА', `Радионуклид успешно подтвержден: ${nuclide}`);
          }}
        />

        {/* Модальное окно: Справочник приборов по ГОСТ 27451-87 */}
        <GostInstrumentsModal
          isOpen={isGostModalOpen}
          onClose={() => {
            setIsGostModalOpen(false);
            vrUiSystemRef.current?.closeModals();
          }}
          selectedInstrumentId={selectedInstrumentId}
          onSelectInstrument={id => {
            syncLoadoutTo3DScene(id);
            setIsGostModalOpen(false);
            vrUiSystemRef.current?.closeModals();
            addToast('info', 'ПРИБОР ВЫБРАН', `Активирован: ${GOST_INSTRUMENTS[id].name}`);
          }}
        />

        {/* Модальное окно: Полный протокол и отчет ALARA */}
        <AlaraReportModal
          isOpen={isReportModalOpen}
          onClose={() => {
            setIsReportModalOpen(false);
            vrUiSystemRef.current?.closeModals();
          }}
          cumulativeDoseMsv={cumulativeDoseMsv}
          missionTimeSec={missionTimeSec}
          chartLabels={chartLabels}
          chartDoseRate={chartDoseRate}
          onRestartMission={() => {
            loadScenario(currentScenario);
            vrUiSystemRef.current?.closeModals();
          }}
          scenarioTitle={`${currentScenario.titleRu} — ${currentScenario.facilityRu}`}
          telemetryHistory={telemetryHistory}
          protectionAnalysis={protectionAnalysis}
          permitLimitMsv={permitLimitMsv}
          selectedPpeId={selectedPpeId}
          selectedRemoteToolId={selectedRemoteToolId}
          scenarioConfig={scenarioConfig}
          scenarioMeta={{
            id: currentScenario.id,
            titleRu: currentScenario.titleRu,
            facilityRu: currentScenario.facilityRu,
            categoryRu: currentScenario.categoryRu,
            shortDescriptionRu: currentScenario.shortDescriptionRu,
            dominantIsotopes: currentScenario.dominantIsotopes,
            recommendedPermitLimitMsv: currentScenario.recommendedPermitLimitMsv
          }}
          rulesEvaluation={rulesEvaluation}
          voiceLogs={voiceLogs}
          doseResetCount={doseResetCount}
          getSessionLimitsSummary={getSessionLimitsSummary}
          mchsMetrics={mchsMetrics}
        />

        {/* Модальное окно: Послеполетный разбор действий (After Action Review — AARAnalytics) */}
        <AARAnalytics
          isOpen={isAARModalOpen}
          onClose={() => setIsAARModalOpen(false)}
          onExportPdf={async () => {
            try {
              const res = await exportDoseHistoryPdfReport({
                history: telemetryHistory,
                currentAnalysis: protectionAnalysis,
                cumulativeDoseMsv,
                missionTimeSec,
                permitLimitMsv,
                selectedPpeId,
                selectedRemoteToolId,
                scenarioTitle: `${currentScenario.titleRu} — ${currentScenario.facilityRu}`,
                scenarioConfig,
                scenarioMeta: {
                  id: currentScenario.id,
                  titleRu: currentScenario.titleRu,
                  facilityRu: currentScenario.facilityRu,
                  categoryRu: currentScenario.categoryRu,
                  shortDescriptionRu: currentScenario.shortDescriptionRu,
                  dominantIsotopes: currentScenario.dominantIsotopes,
                  recommendedPermitLimitMsv: currentScenario.recommendedPermitLimitMsv
                },
                rulesEvaluation,
                voiceLogs,
                doseResetCount,
                sessionLimits: getSessionLimitsSummary(),
                mchsMetrics
              });
              addToast('success', 'PDF-ОТЧЕТ СФОРМИРОВАН', `Сохранен файл: ${res.fileName}`);
            } catch (err) {
              console.error('Ошибка экспорта PDF из AAR:', err);
              addToast('danger', 'ОШИБКА ЭКСПОРТА PDF', 'Не удалось сформировать PDF-отчет.');
            }
          }}
          report={evaluateAARSummary({
            scenarioId: activeScenarioId,
            scenarioTitle: currentScenario.titleRu,
            missionDurationSec: missionTimeSec,
            targetDurationSec: scenarioConfig?.tMaxSec || 300,
            doseResetCount: doseResetCount,
            finalAccumulatedDoseMsv: cumulativeDoseMsv,
            doseLimitMsv: permitLimitMsv,
            ppeChecklist: verifyPPEReadinessChecklist(ppeCheckState),
            ppeProtection: calculatePPEProtectionFactors(ppeCheckState),
            physiology: physioTelemetry,
            mchsMetrics,
            trajectorySamples: telemetryHistory.map((pt, idx): AARTrajectorySample => ({
              timestampSec: pt.elapsedSec,
              position: [
                Math.sin(idx * 0.35) * Math.min(8, pt.distanceM),
                1.65,
                -Math.cos(idx * 0.35) * Math.min(8, pt.distanceM)
              ],
              doseRateMsvPerHour: pt.doseRateMicroSv / 1000.0,
              cumulativeDoseMsv: pt.cumulativeDoseMsv,
              heartRateBpm: physioTelemetry.heartRateBpm,
              shieldAttenuationFactor: protectionAnalysis.kShield,
              ppeProtectionFactor: protectionAnalysis.kPpe
            })),
            violations: [
              ...(rulesEvaluation?.failState
                ? [
                    {
                      id: 'v-fail',
                      timestampSec: rulesEvaluation.failState.failedAtSec,
                      severity: 'CRITICAL_VIOLATION' as const,
                      code: rulesEvaluation.failState.failCode,
                      descriptionRu: rulesEvaluation.failState.reasonRu,
                      penaltyPoints: 25
                    }
                  ]
                : []),
              ...(doseResetCount > 0 && (!rulesEvaluation?.failState || rulesEvaluation.failState.failCode !== 'DOSE_LIMIT_EXCEEDED')
                ? [
                    {
                      id: 'v-dose-resets',
                      timestampSec: missionTimeSec,
                      severity: 'CRITICAL_VIOLATION' as const,
                      code: 'DOSE_LIMIT_EXCEEDED',
                      descriptionRu: `ПРЕВЫШЕН КОНТРОЛЬНЫЙ ПРЕДЕЛ ДОЗЫ! ПРЕВЫШЕНИЕ НРБ-99/2009 (Аварийных сбросов: ${doseResetCount})`,
                      penaltyPoints: 25 * doseResetCount
                    }
                  ]
                : []),
              ...mchsMetrics.bareHandViolationDetailsRu.map((msg, idx) => ({
                id: `v-bare-hand-${idx}`,
                timestampSec: missionTimeSec,
                severity: 'CRITICAL_VIOLATION' as const,
                code: 'BARE_HAND_ISOTOPE_GRAB',
                descriptionRu: msg,
                penaltyPoints: 18
              }))
            ]
          })}
        />
      </Desktop2DHUDOverlayGuard>
      </VRManager>
    </div>
  );
}
