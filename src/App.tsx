/**
 * ALARA-Planner Pro VR - Главный модуль 3D/VR тренажера радиационной безопасности
 * Разработано с соблюдением ГОСТ Р 8.804-2012, ГОСТ 27451-87 и ОСПОРБ-99/2010
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import { MainMenuModal } from './components/MainMenuModal';
import { LabNotebookWidget } from './components/LabNotebookWidget';
import { GammaSpectrometryWidget } from './components/GammaSpectrometryWidget';
import { CharacterPPEState } from './components/CharacterCustomizer3D';
import { ToastNotifications, ToastItem } from './components/ToastNotifications';
import { TelemetryHistoryPoint } from './components/FloatingAnalyticsWindow';
import { VRUISystem } from './vr/vrUiSystem';
import { InteractionSystem, checkHeldObjectCollision } from './vr/vrInteractions';
import { configurePhotorealisticRendererAndHDRI } from './scene/pbrMaterialEngine';
import { RadiationBackgroundField } from './scene/radiationBackgroundField';
import {
  createTacticalFlashlight,
  setTacticalFlashlightPower,
  createFlashlightChargingStand
} from './scene/proceduralModels';
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
  calculatePPEProtectionFactors
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
  const doseIntegratorRef = useRef<DoseNumericalIntegrator>(new DoseNumericalIntegrator());
  const prevThreatLevelRef = useRef<'normal' | 'warning' | 'danger'>('normal');
  const selectedPpeIdRef = useRef<PPELoadoutId>(selectedPpeId);
  const selectedRemoteToolIdRef = useRef<RemoteToolId>(selectedRemoteToolId);
  const permitLimitMsvRef = useRef<number>(permitLimitMsv);
  const isExtendedArmRef = useRef<boolean>(isExtendedArm);
  const selectedInstrumentIdRef = useRef<InstrumentId>(selectedInstrumentId);
  const characterPpeStateRef = useRef<CharacterPPEState>(characterPpeState);
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

  selectedPpeIdRef.current = selectedPpeId;
  selectedRemoteToolIdRef.current = selectedRemoteToolId;
  permitLimitMsvRef.current = permitLimitMsv;
  isExtendedArmRef.current = isExtendedArm;
  selectedInstrumentIdRef.current = selectedInstrumentId;
  characterPpeStateRef.current = characterPpeState;
  physioTelemetryRef.current = physioTelemetry;
  activeScenarioIdRef.current = activeScenarioId;
  scenarioStepRef.current = scenarioStep;
  isHudVisibleRef.current = isHudVisible;

  /**
   * Полная синхронизация выбранного в Главном меню инвентаря/СИЗ с 3D-сценой,
   * руками персонажа в Desktop/VR и физическим расчетом доз
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
    }
    if (ppeId) {
      setSelectedPpeId(ppeId);
      selectedPpeIdRef.current = ppeId;
    }

    setSelectedRemoteToolId(remTool);
    selectedRemoteToolIdRef.current = remTool;

    // 1. Физическое обновление 3D-персонажа (манекен/тело под камерой)
    if (playerAvatarRigRef.current && ppeSt) {
      playerAvatarRigRef.current.updatePPEState(ppeSt);
    }

    // 2. Обновление десктопных рук (прибор и текстуры рукавов/перчаток СИЗ)
    if (handRigRef.current) {
      handRigRef.current.rebuildProbeGeometry(instr);
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
      if (ppeSt) {
        xrManagerRef.current.setPpeSuit(ppeSt.suitId);
      }
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

    // 2. Создание камеры
    const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 100);
    cameraRef.current = camera;

    // 3. Создание рендерера с физически корректным пайплайном (THREE.SRGBColorSpace, ACESFilmicToneMapping exposure = 1.0, PCFSoftShadowMap, HDRI PMREM)
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const hdriEnvTexture = configurePhotorealisticRendererAndHDRI(renderer, scene);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Группа игрока (высота playerGroup.position.y по умолчанию 0.0 для трекинга local-floor)
    const playerGroup = new THREE.Group();
    playerGroup.position.set(currentScenario.initialPlayerPos.x, 0.0, currentScenario.initialPlayerPos.z);
    playerGroup.add(camera);

    // 4.1. 3D-модель тела персонажа (PlayerAvatarRig) с надетой спецодеждой СИЗ
    const playerAvatarRig = new PlayerAvatarRig(characterPpeStateRef.current);
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

    // Главный DirectionalLight сверху (интенсивность 1.5)
    const mainDirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    mainDirLight.position.set(6, 18, 8);
    mainDirLight.castShadow = true;
    mainDirLight.shadow.mapSize.width = 2048;
    mainDirLight.shadow.mapSize.height = 2048;
    mainDirLight.shadow.bias = -0.0003;
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
    const handRig = new RealisticHumanHandRig({ handedness: 'right', withRadiometer: true });
    handRig.rebuildProbeGeometry(selectedInstrumentIdRef.current);
    handRig.setGloveSuitMaterial(characterPpeStateRef.current.suitId);
    camera.add(handRig.rootGroup);
    handRigRef.current = handRig;

    const leftHandRigDesktop = new RealisticHumanHandRig({
      handedness: 'left',
      withFlashlight: true,
      initialFlashlightOn: false
    });
    leftHandRigDesktop.setGloveSuitMaterial(characterPpeStateRef.current.suitId);
    camera.add(leftHandRigDesktop.rootGroup);
    leftHandRigDesktopRef.current = leftHandRigDesktop;
    flashlightMeshRef.current = leftHandRigDesktop.flashlight?.flashlightMesh ?? null;

    // 6.1. Пространственное поле гамма-квантов (THREE.Points + кастомный GLSL Additive-шейдер)
    const radiationField = new RadiationBackgroundField(1600);
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
          playerGroupRef.current.position.set(
            cfg.initialSpawnPos.x,
            isVRActive ? 0.0 : cfg.initialSpawnPos.y,
            cfg.initialSpawnPos.z
          );
          playerGroupRef.current.rotation.set(0, 0, 0);
        }

        if (xrManagerRef.current) {
          xrManagerRef.current.isMovementFrozen = false;
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

    // 8.5. Инициализация InteractionSystem с дифференцированной физикой сброса (Snap-to-Floor & Spatial Placement)
    const interactionSystem = new InteractionSystem(scene);
    interactionSystemRef.current = interactionSystem;

    // 9. WebXR Manager
    const xrManager = new WebXRManager(renderer, scene, playerGroup, {
      onSessionStart: () => {
        setIsInVR(true);
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
        // Применяем выбранный инструмент и текстуру перчаток СИЗ к контроллерам WebXR
        xrManagerRef.current?.setInstrument(selectedInstrumentIdRef.current);
        xrManagerRef.current?.setPpeSuit(characterPpeStateRef.current.suitId);
      },
      onSessionEnd: () => {
        setIsInVR(false);
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
          playerGroupRef.current.position.y = 1.65;
        }
        if (cameraRef.current && rendererRef.current) {
          cameraRef.current.aspect = window.innerWidth / Math.max(1, window.innerHeight);
          cameraRef.current.updateProjectionMatrix();
          rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
        return Boolean(interactionSystemRef.current?.grabbedObject);
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
      }
    });
    xrManager.vrUiSystem = vrUiSystem;
    xrManager.attachVoiceTaskLogger(voiceLogger);
    xrManager.setInstrument(selectedInstrumentIdRef.current);
    xrManager.setPpeSuit(characterPpeStateRef.current.suitId);
    xrManagerRef.current = xrManager;
    xrManager.checkXRSupport().then(supported => setIsVRSupported(supported));

    // Добавление стандартной кнопки Enter VR от Three.js в DOM
    const vrButton = xrManager.createVRButton();
    document.body.appendChild(vrButton);

    // Загрузка сцены первого сценария
    loadScenario(currentScenario);

    // Слушатель изменения размера окна (с сохранением оригинального Aspect Ratio экрана ПК)
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const pcAspect = window.innerWidth / Math.max(1, window.innerHeight);
      cameraRef.current.aspect = pcAspect;
      cameraRef.current.updateProjectionMatrix();
      if (!rendererRef.current.xr.isPresenting) {
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      } else {
        // В активной WebXR-сессии обновляем CSS-размеры главного холста ПК без сброса XRWebGLLayer
        rendererRef.current.domElement.style.width = `${window.innerWidth}px`;
        rendererRef.current.domElement.style.height = `${window.innerHeight}px`;
      }
    };
    window.addEventListener('resize', handleResize);

    // Управление мышью (Обзор)
    let isMouseDown = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let playerRotY = 0;
    let cameraPitch = 0;

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'CANVAS') {
        isMouseDown = true;
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
        audioEngine.init();
      }
    };

    const handleMouseUp = () => {
      isMouseDown = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      // В VR вращение камеры осуществляется аппаратно датчиками гарнитуры
      if (isMouseDown && playerGroupRef.current && cameraRef.current && !xrManagerRef.current?.isInVR) {
        const dx = e.clientX - prevMouseX;
        const dy = e.clientY - prevMouseY;

        playerRotY -= dx * 0.003;
        cameraPitch -= dy * 0.003;
        cameraPitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, cameraPitch));

        playerGroupRef.current.rotation.y = playerRotY;
        cameraRef.current.rotation.x = cameraPitch;

        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
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

      if (e.code === 'KeyC') toggleCrouch();
      if (e.code === 'KeyR') toggleExtendArm();
      if (e.code === 'KeyE') toggleGrip();
      if (e.code === 'KeyT') toggleTeleport();
      if (e.code === 'KeyF') handleToggleFlashlightRef.current();
      if (e.code === 'KeyV' && !e.repeat) {
        voiceLoggerRef.current?.startPushToTalk();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
      if (e.code === 'KeyV') {
        voiceLoggerRef.current?.stopPushToTalk();
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Главный цикл рендеринга Three.js (с поддержкой WebXR анимации и Display Mirroring на ПК)
    let lastTime = performance.now();
    let chartSecondTimer = 0;
    const mirrorSavedProjMatrix = new THREE.Matrix4();
    const mirrorSavedProjMatrixInv = new THREE.Matrix4();
    const ctxRayOrigin = new THREE.Vector3();
    const ctxRayDir = new THREE.Vector3();
    const ctxObjWorldPos = new THREE.Vector3();

    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const isVR = (xrManagerRef.current?.isInVR ?? false) || renderer.xr.isPresenting;
      const isMovementFrozen = rulesEngineRef.current?.isMovementFrozen ?? false;

      // 1. Перемещение игрока WASD (только в Desktop-режиме, замораживается при провале сценария Game Over)
      const isDesktopMoving = Boolean(
        keysRef.current['KeyW'] || keysRef.current['KeyS'] ||
        keysRef.current['KeyA'] || keysRef.current['KeyD'] ||
        keysRef.current['ArrowUp'] || keysRef.current['ArrowDown'] ||
        keysRef.current['ArrowLeft'] || keysRef.current['ArrowRight']
      );
      const isMovingNow = isDesktopMoving || (isVR && Boolean(xrManagerRef.current?.isMoving));
      isMovingRef.current = isMovingNow;

      if (playerGroupRef.current && !isVR && !isMovementFrozen) {
        const moveSpeed = 3.2 * dt;
        if (keysRef.current['KeyW']) playerGroupRef.current.translateZ(-moveSpeed);
        if (keysRef.current['KeyS']) playerGroupRef.current.translateZ(moveSpeed);
        if (keysRef.current['KeyA']) playerGroupRef.current.translateX(-moveSpeed);
        if (keysRef.current['KeyD']) playerGroupRef.current.translateX(moveSpeed);

        // Фиксация высоты взгляда в desktop (с учетом приседания)
        const targetY = isCrouched ? 0.95 : 1.65;
        playerGroupRef.current.position.y += (targetY - playerGroupRef.current.position.y) * Math.min(1.0, dt * 10);
      }

      // 1.5. Следование 3D-манекена за ориентацией взгляда оператора
      if (playerAvatarRigRef.current && cameraRef.current) {
        playerAvatarRigRef.current.updatePose(cameraRef.current);
      }

      // 2. Обновление WebXR (Smooth Locomotion, Turning, Перчатки Hazmat, Рейкастинг в VR UI)
      if (xrManagerRef.current && isVR && cameraRef.current) {
        xrManagerRef.current.isMovementFrozen = isMovementFrozen;
        xrManagerRef.current.update(dt, cameraRef.current);
      }

      // 3. Проверка коллизий удерживаемого предмета со стенами/полом и геометрией сцены
      if (grabbedObjectRef.current) {
        checkHeldObjectCollision(grabbedObjectRef.current, sceneCollidersRef.current);
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
      const probeWorldPos =
        isVR && xrManagerRef.current?.rightHandRig
          ? xrManagerRef.current.rightHandRig.probeTipWorldPos
          : handRigRef.current
          ? handRigRef.current.probeTipWorldPos
          : new THREE.Vector3();

      const operatorWorldPos = new THREE.Vector3();
      if (cameraRef.current) {
        cameraRef.current.getWorldPosition(operatorWorldPos);
      } else {
        operatorWorldPos.copy(probeWorldPos);
      }

      let minSourceDist = 999;
      let minUnshieldedSourceDist = 999;

      const sourceInputs = currentScenarioSources.current.map(source => {
        const sourceWorldPos = new THREE.Vector3();
        if (source.mesh) {
          source.mesh.updateMatrixWorld(true);
          source.mesh.getWorldPosition(sourceWorldPos);
        } else {
          sourceWorldPos.copy(source.position);
        }
        const dist = Math.max(0.1, probeWorldPos.distanceTo(sourceWorldPos));
        if (dist < minSourceDist) minSourceDist = dist;

        const shieldIntersections: Array<{ material: ShieldMaterialType; thicknessCm: number }> = [];

        // Если источник помещен внутрь защитного контейнера (например, ТК-6) и не удерживается в руке
        if (source.enclosedInShield && grabbedObjectRef.current !== source.mesh) {
          shieldIntersections.push({
            material: source.enclosedInShield.material,
            thicknessCm: source.enclosedInShield.thicknessCm
          });
        }

        const operatorDist = Math.max(0.1, operatorWorldPos.distanceTo(sourceWorldPos));
        const rayDirProbe = sourceWorldPos.clone().sub(probeWorldPos).normalize();
        const rayDirOperator = sourceWorldPos.clone().sub(operatorWorldPos).normalize();
        const rayProbe = new THREE.Raycaster(probeWorldPos, rayDirProbe, 0, dist);
        const rayOperator = new THREE.Raycaster(operatorWorldPos, rayDirOperator, 0, operatorDist);

        currentScenarioShields.current.forEach(shield => {
          shield.mesh.updateMatrixWorld(true);
          const hitsProbe = rayProbe.intersectObject(shield.mesh, true);
          const hitsOperator = hitsProbe.length > 0 ? hitsProbe : rayOperator.intersectObject(shield.mesh, true);
          if (hitsProbe.length > 0 || hitsOperator.length > 0) {
            shieldIntersections.push({
              material: shield.material,
              thicknessCm: shield.thicknessCm
            });
          }
        });

        if (shieldIntersections.length === 0 && operatorDist < minUnshieldedSourceDist) {
          minUnshieldedSourceDist = operatorDist;
        }

        return {
          activityMBq: source.activityMBq,
          isotopeId: source.isotopeId,
          distanceToProbeM: dist,
          shieldIntersections
        };
      });

      const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
      const compAnalysis = calculateComprehensiveProtection({
        sources: sourceInputs,
        ppeLoadoutId: selectedPpeIdRef.current,
        remoteToolId: selectedRemoteToolIdRef.current,
        isArmExtended: isExtendedArmRef.current,
        ventilationRateLitersPerMin: physioTelemetryRef.current?.airConsumptionLitersPerMin ?? 22.0,
        hasAirborneContamination: Boolean(
          activeScen?.hasAirborneContamination ??
          (activeScen?.id === 4 || activeScen?.id === 7 || activeScen?.id === 8 || activeScen?.id === 9 || activeScen?.id === 10)
        )
      });

      const theoreticalDoseRate = compAnalysis.finalProtectedDoseRateMicroSv;
      currentDoseRateRef.current = theoreticalDoseRate;
      protectionAnalysisRef.current = compAnalysis;

      // 5. Моделирование инерционности и статистической погрешности детектора по ГОСТ 27451-87
      const currentInstrId = selectedInstrumentIdRef.current;
      const instrument = GOST_INSTRUMENTS[currentInstrId];
      if (missionTimeRef.current === 0 && smoothedReadingRef.current === 0) {
        smoothedReadingRef.current = theoreticalDoseRate;
      }
      const simulatedRate = simulateDetectorReading(
        smoothedReadingRef.current,
        theoreticalDoseRate,
        instrument,
        dt
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
        const curTask = activeScen.stages[scenarioStepRef.current]?.taskRu || activeScen.titleRu;

        xrManagerRef.current.hapticStrength = hapticStrengthRef.current;
        const effectiveHaptic = xrManagerRef.current.triggerHaptics(
          theoreticalDoseRate,
          isHoldingRadSource,
          interactionSystemRef.current?.activeControllerIndex ?? null
        );

        xrManagerRef.current.updateVRWristDisplay(
          theoreticalDoseRate,
          cumulativeDoseRef.current,
          curTask,
          isFlashlightOnRef.current,
          hapticStrengthRef.current
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

      // Обновление параболической дуги телепортации на десктопе (клавиша T)
      if (cameraRef.current && xrManagerRef.current && !isVR) {
        const camDir = new THREE.Vector3();
        cameraRef.current.getWorldDirection(camDir);
        xrManagerRef.current.updateTeleportArc(probeWorldPos, camDir);

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

      // 6. Периодическое обновление React HUD и графиков аналитики в реальном времени (раз в 150 мс)
      chartSecondTimer += dt;
      if (chartSecondTimer >= 0.15) {
        chartSecondTimer = 0;
        setCurrentDoseRateMicroSv(theoreticalDoseRate);
        setCumulativeDoseMsv(cumulativeDoseRef.current);
        setMissionTimeSec(missionTimeRef.current);
        setProtectionAnalysis(compAnalysis);
        if (rulesSnapshot) {
          setRulesEvaluation({
            ...rulesSnapshot,
            failState: rulesSnapshot.failState ? { ...rulesSnapshot.failState } : null
          });
        }

        // Оценка радиационной зоны по ОСПОРБ-99/2010
        const zone = evaluateRadiationZone(theoreticalDoseRate);
        setThreatLevel(zone.threatLevel);
        setZoneName(zone.zoneName);

        // Контекстная проверка объекта под прицелом или в руке (для всплывающей контекстной карточки HUD)
        let nextTarget: TargetedObjectContext | null = null;
        const heldMeta = interactionSystemRef.current?.grabbedItemMeta;
        if (heldMeta) {
          nextTarget = {
            id: heldMeta.id,
            nameRu: heldMeta.nameRu,
            type: heldMeta.type,
            distanceM: 0,
            isGrabbed: true
          };
        } else if (!isVR && cameraRef.current && interactionSystemRef.current) {
          cameraRef.current.getWorldPosition(ctxRayOrigin);
          cameraRef.current.getWorldDirection(ctxRayDir);
          const hitMeta = interactionSystemRef.current.raycastInteractive(
            ctxRayOrigin,
            ctxRayDir,
            currentScenarioInteractive.current,
            4.0
          );
          if (hitMeta) {
            hitMeta.mesh.getWorldPosition(ctxObjWorldPos);
            nextTarget = {
              id: hitMeta.id,
              nameRu: hitMeta.nameRu,
              type: hitMeta.type,
              distanceM: ctxRayOrigin.distanceTo(ctxObjWorldPos),
              isGrabbed: false
            };
          }
        }
        const nextTargetKey = nextTarget
          ? `${nextTarget.id}:${nextTarget.isGrabbed ? 1 : 0}:${nextTarget.distanceM.toFixed(1)}`
          : '';
        if (nextTargetKey !== targetedObjectKeyRef.current) {
          targetedObjectKeyRef.current = nextTargetKey;
          setTargetedObject(nextTarget);
        }

        // 7. Пошаговый алгоритм методики РХБЗ (Multi-step Task Engine):
        // Шаг 1: «Разведка издалека» -> Шаг 2: «Выбор средств защиты» -> Шаг 3: «Дозированный подход» ->
        // Шаг 4: «Установка временного экрана» -> Шаг 5: «Точные замеры и расчет» -> Шаг 6: «Итоговый контроль»
        const activeScen = SCENARIOS.find(s => s.id === activeScenarioIdRef.current) || SCENARIOS[0];
        const curStep = scenarioStepRef.current;
        const totalSteps = activeScen?.stages.length ?? 6;
        if (curStep < totalSteps) {
          // Шаг 1: «Разведка издалека» — замер фона на рубеже r > 2.8 м без входа в очаг
          if (curStep === 0 && missionTimeRef.current >= 3.0 && minSourceDist > 2.8) {
            handleAdvanceScenarioStepRef.current(1);
          }
          // Шаг 2: «Выбор средств защиты» — подбор костюма/СИЗ под тип излучения
          else if (curStep === 1 && selectedPpeIdRef.current !== 'none') {
            handleAdvanceScenarioStepRef.current(2);
          }
          // Шаг 3: «Дозированный подход» — вход в опасную зону с таймером пребывания (r <= 2.2 м)
          else if (curStep === 2 && minSourceDist <= 2.2 && minSourceDist > 0) {
            handleAdvanceScenarioStepRef.current(3);
          }
          // Шаг 4: «Установка временного экрана» — монтаж защитного блока (kShield > 1.25)
          else if (curStep === 3 && compAnalysis.kShield > 1.25) {
            handleAdvanceScenarioStepRef.current(4);
          }
          // Шаг 5: «Точные замеры и расчет» — замеры за экраном в рабочей зоне
          else if (curStep === 4 && missionTimeRef.current >= 18.0 && compAnalysis.kShield > 1.1) {
            handleAdvanceScenarioStepRef.current(5);
          }
        }

        // Стресс / Пульс оператора в телеметрии
        let targetBpm = 72;
        if (zone.threatLevel === 'warning') targetBpm = 98;
        if (zone.threatLevel === 'danger') targetBpm = 135;
        // Учащенный пульс (тахикардия 158–168 уд/мин) при приближении к порогу 80% лимита дозы
        if (rulesSnapshot?.isWarning80Active) {
          targetBpm = 162;
        }
        setVitalsBpm(Math.round(targetBpm + (Math.random() * 6 - 3)));

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
        setChartLabels(prev => {
          const prevTick = prev.length > 0 ? Math.floor(parseFloat(prev[prev.length - 1]) * 2) : -1;
          if (prev.length === 0 || halfSecTick > prevTick) {
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
            return [...prev.slice(-119), label];
          }
          return prev;
        });
      }

      // 7. Основной рендер сцены (в режиме WebXR рендерит стереопару в буфер VR-гарнитуры)
      renderer.render(scene, camera);

      // 8. Display Mirroring: дублирование кадра на главный Canvas компьютера при активной WebXR-сессии
      //    без повторного пересчета тяжелой физики, матриц мира и карт теней
      if (renderer.xr.isPresenting) {
        const leftCam = renderer.xr.getCamera().cameras[0];
        const mirrorCam = leftCam || camera;

        const prevRenderTarget = renderer.getRenderTarget();
        const prevSceneAutoUpdate = scene.matrixWorldAutoUpdate;
        const prevShadowAutoUpdate = renderer.shadowMap.autoUpdate;
        const prevMirrorCamAutoUpdate = mirrorCam.matrixWorldAutoUpdate;

        // Сохраняем оригинальную VR-матрицу проекции левого глаза
        mirrorSavedProjMatrix.copy(mirrorCam.projectionMatrix);
        mirrorSavedProjMatrixInv.copy(mirrorCam.projectionMatrixInverse);

        // Вычисляем оригинальный Aspect Ratio экрана монитора ПК
        const canvasEl = renderer.domElement;
        const pcWidth = canvasEl.clientWidth || window.innerWidth;
        const pcHeight = Math.max(1, canvasEl.clientHeight || window.innerHeight);
        const pcAspect = pcWidth / pcHeight;

        // Адаптируем горизонтальный масштаб проекционной матрицы leftCam под Aspect Ratio экрана ПК
        const projEl = mirrorCam.projectionMatrix.elements;
        if (projEl[5] !== 0) {
          projEl[0] = projEl[5] / pcAspect;
          projEl[8] = 0; // Убираем асимметричный сдвиг оптического центра VR-линзы для монитора ПК
          projEl[9] = 0;
          mirrorCam.projectionMatrixInverse.copy(mirrorCam.projectionMatrix).invert();
        }

        // Отключаем повторный пересчет мировых матриц сцены, теней и сохраняем мировую матрицу leftCam (с учетом playerGroup)
        mirrorCam.matrixWorldAutoUpdate = false;
        scene.matrixWorldAutoUpdate = false;
        renderer.shadowMap.autoUpdate = false;

        // Временно отключаем renderer.xr.enabled и переключаем буфер вывода на основной холст браузера ПК (RenderTarget = null)
        try {
          renderer.xr.enabled = false;
          renderer.setRenderTarget(null);
          renderer.setViewport(0, 0, canvasEl.width, canvasEl.height);
          renderer.setScissor(0, 0, canvasEl.width, canvasEl.height);
          renderer.setScissorTest(false);

          renderer.render(scene, leftCam || camera);
        } finally {
          // Восстанавливаем матрицу проекции левого глаза, буфер VR-гарнитуры и renderer.xr.enabled = true
          mirrorCam.projectionMatrix.copy(mirrorSavedProjMatrix);
          mirrorCam.projectionMatrixInverse.copy(mirrorSavedProjMatrixInv);
          mirrorCam.matrixWorldAutoUpdate = prevMirrorCamAutoUpdate;

          renderer.setRenderTarget(prevRenderTarget);
          scene.matrixWorldAutoUpdate = prevSceneAutoUpdate;
          renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
          renderer.xr.enabled = true;
        }
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (vrButton && vrButton.parentElement) {
        vrButton.parentElement.removeChild(vrButton);
      }
      renderer.setAnimationLoop(null);
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

      // Очистка старой сцены
      if (currentEnvGroup.current) {
        sceneRef.current.remove(currentEnvGroup.current);
        currentEnvGroup.current = null;
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
      setChartLabels([]);
      setChartDoseRate([]);
      setChartCumulativeDose([]);
      setTelemetryHistory([]);
      setRulesEvaluation(null);
      hasShownSuccessModalRef.current = false;
      vrUiSystemRef.current?.closeModals();
      if (xrManagerRef.current) {
        xrManagerRef.current.isMovementFrozen = false;
      }

      // Позиция игрока (в VR сохраняем y = 0.0 для аппаратного трекинга local-floor)
      if (playerGroupRef.current) {
        const isVRActive = xrManagerRef.current?.isInVR ?? false;
        playerGroupRef.current.position.set(
          scen.initialPlayerPos.x,
          isVRActive ? 0.0 : scen.initialPlayerPos.y,
          scen.initialPlayerPos.z
        );
        playerGroupRef.current.rotation.set(0, 0, 0);
      }

      // Генерация 3D объектов нового сценария
      const built = scen.buildScene(sceneRef.current);

      // Размещение приборной стойки-ложемента рядом с оператором
      const standPos = new THREE.Vector3(
        scen.initialPlayerPos.x - 0.52,
        0,
        scen.initialPlayerPos.z - 0.65
      );
      const chargingStand = createFlashlightChargingStand();
      chargingStand.position.copy(standPos);
      built.envGroup.add(chargingStand);

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

      built.interactive.push({
        id: 'tactical_flashlight',
        nameRu: 'Зарядный пост фонаря ФПС-4ВЗГ',
        type: 'flashlight',
        placementType: 'floor',
        isLargeEquipment: true,
        mesh: chargingStand,
        interacted: false
      });

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
      const colliders: THREE.Object3D[] = [chargingStand];
      built.shields.forEach(s => {
        if (s.mesh) colliders.push(s.mesh);
      });
      built.interactive.forEach(item => {
        if (item.type === 'container' || item.type === 'valve') {
          colliders.push(item.mesh);
        }
      });
      sceneCollidersRef.current = colliders;

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

    if (rulesEngineRef.current) {
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
        // 0. Если отпущен тактический фонарь — сохраняем его пространственное положение и направление луча
        if (itemMeta?.type === 'flashlight' || droppedObject === flashlightMeshRef.current) {
          setIsFlashlightEquipped(false);
          isFlashlightEquippedRef.current = false;
          addToast(
            'info',
            'ТАКТИЧЕСКИЙ ФОНАРЬ РАЗМЕЩЕН',
            `${itemMeta?.nameRu || 'Фонарь'} оставлен в выбранной точке пространства и продолжает освещать сектор работ.`
          );
          return;
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
          const containerWorldPos = new THREE.Vector3();
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
        const rayOrigin = new THREE.Vector3();
        const rayDir = new THREE.Vector3();
        controller.getWorldPosition(rayOrigin);
        controller.getWorldDirection(rayDir).negate().normalize();

        const matchedItem = interactionSys.raycastInteractive(
          rayOrigin,
          rayDir,
          currentScenarioInteractive.current,
          4.5
        );

        if (matchedItem) {
          matchedItem.interacted = true;

          // Стационарный вентиль / затвор / разъединитель: поворот в VR
          if (matchedItem.type === 'valve') {
            matchedItem.mesh.rotation.y += Math.PI;
            currentScenarioSources.current.forEach(src => {
              src.activityMBq = Math.min(src.activityMBq, 450);
            });
            handleAdvanceScenarioStepRef.current(Math.max(2, scenarioStepRef.current + 1));
            addToast(
              'success',
              'ИСТОЧНИК ПЕРЕКРЫТ / ОТКЛЮЧЕН',
              `${matchedItem.nameRu} переведен в безопасное положение!`
            );
            audioEngineRef.current?.playTaskSuccess();
            return;
          }

          // Стационарный контейнер
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
            return;
          }

          // Тактический фонарь жестко привязан к левой руке: клик по стойке переключает его питание
          if (matchedItem.type === 'flashlight') {
            handleToggleFlashlightRef.current();
            return;
          }

          // Переносимый предмет: захват через InteractionSystem в ладонь активной кисти (palmGroup / handGroup)
          const handHolder =
            controllerIndex === 1
              ? xrManagerRef.current?.leftHandRig?.palmGroup ||
                xrManagerRef.current?.leftHandRig?.rootGroup ||
                controller
              : xrManagerRef.current?.rightHandRig?.palmGroup ||
                xrManagerRef.current?.rightHandRig?.rootGroup ||
                controller;

          interactionSys.grabObject(matchedItem, handHolder, controllerIndex ?? 0);
          grabbedObjectRef.current = matchedItem.mesh;
          setIsGripped(true);
          if (controllerIndex === 1) {
            xrManagerRef.current?.leftHandRig?.setGripTarget(true);
          } else {
            xrManagerRef.current?.rightHandRig?.setGripTarget(true);
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

      const rayOrigin = new THREE.Vector3();
      const rayDir = new THREE.Vector3();
      cameraRef.current.getWorldPosition(rayOrigin);
      cameraRef.current.getWorldDirection(rayDir).normalize();

      const matchedItem = interactionSys.raycastInteractive(
        rayOrigin,
        rayDir,
        currentScenarioInteractive.current,
        4.0
      );

      if (matchedItem) {
        matchedItem.interacted = true;

        if (matchedItem.type === 'valve') {
          matchedItem.mesh.rotation.y += Math.PI;
          currentScenarioSources.current.forEach(src => {
            src.activityMBq = Math.min(src.activityMBq, 450);
          });
          handleAdvanceScenarioStepRef.current(Math.max(2, scenarioStepRef.current + 1));
          addToast(
            'success',
            'УТЕЧКА / ПУЧОК БЛОКИРОВАН',
            `${matchedItem.nameRu} переведен в закрытое положение! Зафиксируйте нормализацию фона.`
          );
          audioEngineRef.current?.playTaskSuccess();
          return;
        }

        if (matchedItem.type === 'container') {
          if (currentScenarioSources.current[0]) {
            currentScenarioSources.current[0].activityMBq = 35;
          }
          handleAdvanceScenarioStepRef.current(Math.max(2, scenarioStepRef.current + 1));
          addToast(
            'success',
            'КОНТЕЙНЕР ЗАГЕРМЕТИЗИРОВАН',
            `${matchedItem.nameRu} экранировал излучение. Миссия выполнена по стандарту ALARA.`
          );
          audioEngineRef.current?.playTaskSuccess();
          return;
        }

        if (matchedItem.type === 'flashlight') {
          handleToggleFlashlightRef.current();
          return;
        }

        const targetHolder =
          leftHandRigDesktopRef.current?.palmGroup ||
          handRigRef.current?.palmGroup ||
          cameraRef.current;
        if (targetHolder) {
          interactionSys.grabObject(matchedItem, targetHolder, null);
          grabbedObjectRef.current = matchedItem.mesh;
          setIsGripped(true);
          leftHandRigDesktopRef.current?.setGripTarget(true);
          leftHandRigDesktopRef.current?.setExtensionTarget(true);
          handRigRef.current?.setGripTarget(true);

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
          if (clamped === totalStages - 1) {
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
      handRigRef.current?.setExtensionTarget(next);
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
          const nextId = (activeScen.id % 12) + 1;
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

      // КРИТИЧЕСКИ ВАЖНО: renderer.xr.enabled = true должно быть включено до вызова requestSession
      rendererRef.current.xr.enabled = true;

      if (typeof navigator === 'undefined' || !('xr' in navigator) || !navigator.xr) {
        addToast(
          'warning',
          'WEBXR НЕ ПОДДЕРЖИВАЕТСЯ',
          'Ваш браузер или система не поддерживают WebXR Device API. Используйте Google Chrome, Edge или гарнитуру VR (Meta Quest, HTC Vive).'
        );
        return;
      }

      const isSupp = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
      if (!isSupp && !isInVR) {
        addToast(
          'warning',
          'VR-ШЛЕМ НЕ ОБНАРУЖЕН',
          'Шлем виртуальной реальности (Meta Quest, HTC Vive, Valve Index) не найден. Подключите гарнитуру и активируйте SteamVR или Oculus Link.'
        );
        return;
      }

      if (xrManagerRef.current) {
        const success = await xrManagerRef.current.toggleVRSession();
        if (success) {
          addToast(
            'success',
            'VR-РЕЖИМ АКТИВИРОВАН',
            'Добро пожаловать в WebXR! 3D-планшет закреплен на контроллере. Для скрытия HUD нажмите Menu или Grip на HTC Vive.'
          );
        } else if (!isInVR) {
          addToast('info', 'VR-СЕССИЯ ЗАВЕРШЕНА', 'Возврат к стандартному монитору ПК.');
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
          setSelectedInstrumentId(id);
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

      {/* Стейт-машина 12 сценариев (INIT -> RUNNING -> CRITICAL_WARNING -> COMPLETED / FAILED) и 3D-спавнер источников угроз */}
      <ScenarioManager
        scenarioId={activeScenarioId}
        playerGroupRef={playerGroupRef}
        isWearingHazmatPpe={selectedPpeId !== 'none'}
        randomizedHazardMode={isRandomizedHazardMode}
        onStateChange={(snap) => {
          if (snap.state === 'COMPLETED') {
            triggerSuccessModalRef.current();
          }
        }}
      >
        <HazardSourceSpawner
          sceneOrGroupRef={currentEnvGroup}
          atmosphere={getScenarioDataById(activeScenarioId).atmosphere}
        />
      </ScenarioManager>

      {/* Симулятор физиологического стресса, расхода кислорода АСВ-2 и запотевания забрала */}
      <PhysiologicalStress
        ppeState={ppeCheckState}
        currentDoseRateMsvPerHour={currentDoseRateMicroSv / 1000.0}
        accumulatedDoseMsv={cumulativeDoseMsv}
        isPhysicalExertion={Boolean(isMovingRef.current || isCrouched || isGripped || isExtendedArm)}
        onUpdateTelemetry={setPhysioTelemetry}
        onOxygenDepletion={(remPct, pressMpa) => {
          setPpeCheckState(prev => ({
            ...prev,
            oxygenOrFilterReservePercent: remPct,
            cylinderPressureMpa: pressMpa
          }));
        }}
      />

      {/* Защита интерфейса в VR-шлеме: при isPresenting === true 2D HTML/DOM оверлей ПОЛНОСТЬЮ исключается из рендера (return null) */}
      <VRManager
        rendererRef={rendererRef}
        isInVR={isXRPresenting}
        onFlashlightChange={nextOn => {
          isFlashlightOnRef.current = nextOn;
          setIsFlashlightOn(nextOn);
        }}
      >
        <Desktop2DHUDOverlayGuard isPresenting={isXRPresenting}>
        <div
          id="ui-hud"
          className="absolute inset-0 h-[100dvh] overflow-hidden pointer-events-none pb-16 px-4 pt-4 box-border z-10 flex flex-col justify-between transition-opacity duration-300 opacity-100"
        >
          {/* Всплывающие уведомления (Toasts) */}
          <ToastNotifications toasts={toasts} onDismiss={dismissToast} />

          {/* Основной HUD интерфейс тренажера и всплывающее окно аналитики */}
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
            coopPeersCount={coopPeers.length}
            onCycleCoopRole={() => {
              const order: CoopSquadRole[] = [
                'RECON_DOSIMETRIST',
                'LIQUIDATOR_OPERATOR',
                'INCIDENT_COMMANDER'
              ];
              const next = order[(order.indexOf(coopRole) + 1) % order.length];
              setCoopRole(next);
              multiplayerRef.current?.setRole(next);
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
          />
        </div>

        {/* Главное меню виртуального лабораторного практикума */}
        <MainMenuModal
          isOpen={isMainMenuOpen}
          onClose={() => {
            setIsMainMenuOpen(false);
            syncLoadoutTo3DScene();
          }}
          activeScenarioId={activeScenarioId}
          onSelectScenario={id => {
            handleScenarioChange(id);
            setIsMainMenuOpen(false);
          }}
          isExamMode={isExamMode}
          onChangeExamMode={setIsExamMode}
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
          selectedRemoteToolId={selectedRemoteToolId}
          onSelectRemoteTool={toolId => {
            syncLoadoutTo3DScene(undefined, undefined, undefined, toolId);
            addToast('info', 'ИНСТРУМЕНТ ВЫБРАН', `Экипирован: ${REMOTE_TOOLS[toolId]?.nameRu}`);
          }}
          hideStartupModal={hideStartupModal}
          onToggleHideStartupModal={handleToggleHideStartupModal}
          onOpenLabNotebook={() => {
            setIsMainMenuOpen(false);
            setIsLabNotebookOpen(true);
          }}
          onOpenSpectrometry={() => {
            setIsMainMenuOpen(false);
            setIsSpectrometryOpen(true);
          }}
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
            setSelectedInstrumentId(id);
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
          scenarioTitle={currentScenario.titleRu}
        />

        {/* Модальное окно: Послеполетный разбор действий (After Action Review — AARAnalytics) */}
        <AARAnalytics
          isOpen={isAARModalOpen}
          onClose={() => setIsAARModalOpen(false)}
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
                : [])
            ]
          })}
        />
      </Desktop2DHUDOverlayGuard>
      </VRManager>
    </div>
  );
}
