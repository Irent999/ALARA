/**
 * ALARA-Planner Pro VR — Модуль управления WebXR (Meta Quest 2/3/Pro, HTC Vive, Pico 4, Valve Index / SteamVR)
 *
 * Архитектурные гарантии:
 * 1. No Drift Architecture (Единая иерархия playerGroup):
 *    - Все объекты контроллеров (getController(0), getController(1)), их хваты (getControllerGrip(0), getControllerGrip(1))
 *      и анатомические модели рук (HazmatHandRig) добавляются СТРОГО внутрь единой родительской группы игрока (playerGroup),
 *      а НЕ в корень глобальной scene.
 *    - При Smooth Locomotion и Snap/Smooth Turn трансформируются исключительно playerGroup.position и playerGroup.rotation.
 *    - Высота playerGroup.position.y по умолчанию инициализируется в 0.0 (физический рост отслеживается трекингом local-floor).
 * 2. Безопасное управление XR-сессией и каскадный Reference Space Fallback (SteamVR & WebXR):
 *    - Метод toggleVRSession() выполняет асинхронный каскадный запрос систем координат по цепочке:
 *      'local-floor' -> 'local' -> 'viewer'.
 *    - При завершении сессии (sessionend) выполняется гарантированная очистка состояний: скрытие дуги телепортации,
 *      отключение отображения моделей рук и сброс всех флагов активности.
 * 3. Нормализация ввода и локомоция (Deadzone >= 0.15):
 *    - Оси стиков нормализуются с фильтрацией мертвой зоны deadzone = 0.15 для устранения микро-дрейфа потенциометров.
 *    - Вектор движения tempForward рассчитывается строго по XZ-проекции направления взгляда камеры (camera.getWorldDirection)
 *      без изменения Y-координаты.
 * 4. Мировые координаты рейкастинга и Zero-Allocation цикл update():
 *    - Лазерный рейкастинг UI и параболическая дуга телепортации вычисляются строго от мировых координат контроллера
 *      (getWorldPosition / getWorldDirection).
 *    - Тактильный виброотклик (Haptics) защищен троттлингом (интервал 180 мс, в диапазоне 150–200 мс) для сохранения стабильного FPS.
 *    - В методе update() переиспользуются статические экземпляры THREE.Vector3 и THREE.Quaternion без аллокаций памяти.
 */

import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { RealisticHumanHandRig, HazmatHandRig, VRFlashlight } from './handModel';
import type { InstrumentId } from '../instruments/gostInstruments';
import { VRUISystem } from '../vr/vrUiSystem';
import { VoiceTaskLogger } from '../vr/voiceTaskLogger';
import {
  VRInputManager,
  IAnalyticsOverlayController,
  IRadiationBackgroundFieldController
} from '../vr/vrInputManager';

export { VRInputManager, VRFlashlight };

export interface WebXRCallbacks {
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
  onSelectStart?: (controller: THREE.Group, controllerIndex: number) => void;
  onSelectEnd?: (controller: THREE.Group, controllerIndex: number) => void;
  onSqueezeStart?: (controller: THREE.Group, controllerIndex: number) => boolean | void;
  onSqueezeEnd?: (controller: THREE.Group, controllerIndex: number) => void;
  onTeleportTrigger?: (targetPos: THREE.Vector3) => void;
  onToggleFlashlight?: (hand: 'left' | 'right', isOn?: boolean) => void;
  onVoicePushToTalkChange?: (isActive: boolean) => void;
  onToggleAnalyticsOverlay?: () => void;
  onToggleRadiationBackgroundField?: () => void;
  onCalibratePlayerSpace?: () => void;
  onToggleHudVisibility?: (visible: boolean) => void;
  onCycleTool?: (dir: 1 | -1) => void;
  onLeftThumbstickPress?: () => void;
  onRightTriggerWorldHold?: (
    raycaster: THREE.Raycaster,
    controller: THREE.Group,
    isHeld: boolean,
    justPressed: boolean,
    justReleased: boolean
  ) => void;
}

export interface XRControllerInput {
  moveX: number; // Левый стик X (-1..1)
  moveY: number; // Левый стик Y (-1..1)
  turnX: number; // Правый стик X (-1..1)
  turnY: number; // Правый стик Y (-1..1)
  trigger: number; // Аналоговый курок (0..1)
  grip: number; // Аналоговый хват / squeeze (0..1)
  primaryPressed: boolean; // Кнопка A / X
  secondaryPressed: boolean; // Кнопка B / Y
  thumbstickPressed: boolean; // Нажатие на стик (Thumbstick Press, buttons[3])
  squeezePressed: boolean;
}

export type XRReferenceSpaceFallbackType = 'local-floor' | 'local' | 'viewer';

/**
 * 3D-планшет на левом запястье (VR Wrist HUD)
 * Отрисовывает оперативную телеметрию дозиметра на руке в виртуальной реальности
 */
export class VRWristDisplay {
  public mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private lastRenderTimeMs = 0;
  private lastRenderKey = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geometry = new THREE.PlaneGeometry(0.18, 0.09);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(0, 0.05, -0.06);
    this.mesh.rotation.x = -Math.PI / 3;
  }

  public dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }

  public update(
    doseRateMicroSv: number,
    cumulativeDoseMsv: number,
    taskTitle: string,
    isFlashlightOn?: boolean,
    hapticStrength?: number,
    isVoiceActive?: boolean,
    voiceVolume?: number,
    latestVoiceNote?: string,
    isHudVisible: boolean = true,
    activeToolLabel?: string,
    holdProgressPct?: number | null
  ): void {
    const nowMs = performance.now();
    const rateKey =
      doseRateMicroSv >= 10000
        ? (doseRateMicroSv / 1000).toFixed(1)
        : doseRateMicroSv.toFixed(1);
    const renderKey = `${rateKey}|${cumulativeDoseMsv.toFixed(4)}|${taskTitle.slice(0, 24)}|${isFlashlightOn ? 1 : 0}|${Math.round((hapticStrength ?? 1) * 20)}|${isVoiceActive ? 1 : 0}|${latestVoiceNote ?? ''}|${isHudVisible ? 1 : 0}|${activeToolLabel ?? ''}|${typeof holdProgressPct === 'number' ? Math.round(holdProgressPct) : -1}`;
    if (renderKey === this.lastRenderKey || nowMs - this.lastRenderTimeMs < 140) {
      return;
    }
    this.lastRenderKey = renderKey;
    this.lastRenderTimeMs = nowMs;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, 512, 256);

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, 512, 256);

    const isDanger = doseRateMicroSv >= 1000;
    const isWarning = doseRateMicroSv >= 100 && !isDanger;
    ctx.strokeStyle = isVoiceActive
      ? '#22c55e'
      : isDanger
      ? '#ef4444'
      : isWarning
      ? '#eab308'
      : '#22c55e';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 506, 250);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 19px monospace';
    ctx.fillText('ГОСТ Р 8.804-2012 • ALARA VR', 20, 34);

    // Индикатор микрофона PTT в правом верхнем углу дисплея левого запястья
    const micColor = isVoiceActive ? '#22c55e' : '#475569';
    ctx.fillStyle = micColor;
    ctx.beginPath();
    ctx.arc(478, 28, 10 + (isVoiceActive ? (voiceVolume ?? 0) * 6 : 0), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isVoiceActive ? '#4ade80' : '#64748b';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(isVoiceActive ? '🎙 PTT REC' : '🎙 [Y/Стик]', 375, 33);

    ctx.fillStyle = isDanger ? '#f87171' : isWarning ? '#fde047' : '#4ade80';
    ctx.font = 'bold 48px monospace';
    const rateStr =
      doseRateMicroSv >= 10000
        ? (doseRateMicroSv / 1000).toFixed(1) + ' мЗв/ч'
        : doseRateMicroSv.toFixed(1) + ' мкЗв/ч';
    ctx.fillText(rateStr, 20, 92);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 21px monospace';
    ctx.fillText(`Доза: ${cumulativeDoseMsv.toFixed(4)} мЗв`, 20, 130);

    if (activeToolLabel) {
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(`Инстр: ${activeToolLabel.slice(0, 18)}`, 305, 130);
    }

    if (typeof holdProgressPct === 'number' && holdProgressPct > 0) {
      const clamped = Math.max(0, Math.min(100, Math.round(holdProgressPct)));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.fillRect(16, 144, 480, 50);
      ctx.fillStyle = 'rgba(14, 165, 233, 0.35)';
      ctx.fillRect(18, 146, Math.round((476 * clamped) / 100), 46);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(16, 144, 480, 50);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(`Выполнение операции: ${clamped}%`, 28, 175);
    } else if (latestVoiceNote && latestVoiceNote.trim().length > 0) {
      ctx.fillStyle = 'rgba(30, 41, 59, 0.92)';
      ctx.fillRect(16, 144, 480, 50);
      ctx.strokeStyle = isVoiceActive ? '#22c55e' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(16, 144, 480, 50);

      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 16px sans-serif';
      const cleanVoice =
        latestVoiceNote.length > 42 ? latestVoiceNote.slice(0, 40) + '...' : latestVoiceNote;
      ctx.fillText(`🎙 ${cleanVoice}`, 24, 175);
    } else {
      ctx.fillStyle = '#38bdf8';
      ctx.font = '19px sans-serif';
      const cleanTask = taskTitle.length > 40 ? taskTitle.slice(0, 38) + '...' : taskTitle;
      ctx.fillText(`Цель: ${cleanTask}`, 20, 178);
    }

    const hapPct = Math.round((hapticStrength ?? 1.0) * 100);
    ctx.fillStyle = '#64748b';
    ctx.font = 'italic 14px sans-serif';
    ctx.fillText(
      `Фонарь [Y]: ${isFlashlightOn ? 'ВКЛ' : 'ВЫКЛ'} • Стик ↕ Инстр • Вибро: ${hapPct}%`,
      20,
      228
    );

    // Интерактивная кнопка-индикатор видимости HUD на запястье
    ctx.fillStyle = isHudVisible ? 'rgba(14, 165, 233, 0.22)' : 'rgba(239, 68, 68, 0.22)';
    ctx.fillRect(360, 204, 136, 36);
    ctx.strokeStyle = isHudVisible ? '#38bdf8' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(360, 204, 136, 36);
    ctx.fillStyle = isHudVisible ? '#38bdf8' : '#f87171';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`HUD: ${isHudVisible ? 'ВКЛ' : 'СКРЫТ'} 👁`, 372, 227);

    this.texture.needsUpdate = true;
  }
}

export class WebXRManager {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  public readonly playerGroup: THREE.Group;
  private readonly callbacks: WebXRCallbacks;

  public isSupported = false;
  public isInVR = false;
  public xrSession: XRSession | null = null;
  public activeReferenceSpaceType: XRReferenceSpaceFallbackType = 'local-floor';
  public lastErrorMessageRu: string | null = null;

  // Контроллеры WebXR (слоты 0 и 1) и их Grip-пространства (руки маппятся динамически по handedness)
  public controller0: THREE.XRTargetRaySpace | null = null;
  public controller1: THREE.XRTargetRaySpace | null = null;
  public controllerGrip0: THREE.XRGripSpace | null = null;
  public controllerGrip1: THREE.XRGripSpace | null = null;

  private readonly controllerMeta: Record<
    0 | 1,
    { connected: boolean; handedness: XRHandedness; targetRayMode: XRTargetRayMode | 'unknown' }
  > = {
    0: { connected: false, handedness: 'none', targetRayMode: 'unknown' },
    1: { connected: false, handedness: 'none', targetRayMode: 'unknown' }
  };

  // Fallback для шлемов без контроллеров (gaze / transient-pointer)
  private gazeReticle: THREE.Mesh;
  private readonly gazeAnchorGroup = new THREE.Group();
  private isGazeSelectHeld = false;
  private gazeJustPressed = false;
  private gazeJustReleased = false;

  // Анатомические руки в химзащите (HazmatHandRig) внутри контроллеров
  public rightHandRig: HazmatHandRig | null = null;
  public leftHandRig: HazmatHandRig | null = null;

  // 3D VR Wrist Display на левом контроллере
  public wristDisplay: VRWristDisplay | null = null;

  // Связка с пространственным VR UI, голосовым логгером VoiceTaskLogger и менеджером VR-ввода VRInputManager
  public vrUiSystem: VRUISystem | null = null;
  public voiceTaskLogger: VoiceTaskLogger | null = null;
  public vrInputManager: VRInputManager | null = null;

  // Параболическая телепортация (Zero-Allocation буфер геометрии)
  public arcLine: THREE.Line;
  public targetRing: THREE.Mesh;
  public isTeleportActive = false;
  private isSqueezeGrabActive = false;
  private readonly arcPointsCount = 28;
  private readonly arcPositionsBuffer: Float32Array;
  private readonly arcPositionAttribute: THREE.BufferAttribute;

  // Параметры локомоции, заморозки при провале (Game Over) и поворотов
  public isMovementFrozen = false;
  public isMoving = false;
  public moveSpeed = 1.8; // м/с
  public turnMode: 'snap' | 'smooth' = 'snap';
  public snapAngle = Math.PI / 6; // 30 градусов (шаг Snap Turn по ТЗ)
  public snapCooldown = 0;
  private snapLocked = false;
  private prevLeftPrimaryPressed = false;
  private prevRightPrimaryPressed = false;
  private prevLeftPttHeld = false;
  private leftXHoldDurationSec = 0;
  private leftXTriggeredPtt = false;
  public smoothTurnSpeed = 2.2; // рад/с
  public deadzone = 0.15; // Минимальный порог фильтрации микро-дрейфа стиков (>= 0.15)

  // Лазерные лучи контроллеров
  private laser0: THREE.Line | null = null;

  /**
   * Смена модели прибора в правой руке VR-контроллера
   */
  public setInstrument(instrumentId: InstrumentId): void {
    this.rightHandRig?.rebuildProbeGeometry(instrumentId);
  }

  /**
   * Смена материала перчаток и рукавов СИЗ на обеих руках в VR
   */
  public setPpeSuit(suitId: string): void {
    this.rightHandRig?.setGloveSuitMaterial(suitId);
    this.leftHandRig?.setGloveSuitMaterial(suitId);
  }
  private laser1: THREE.Line | null = null;

  // Статические переиспользуемые структуры данных (Zero Allocation в цикле update)
  private readonly tempForward = new THREE.Vector3();
  private readonly tempRight = new THREE.Vector3();
  private readonly tempMove = new THREE.Vector3();
  private readonly upVector = new THREE.Vector3(0, 1, 0);
  private readonly raycaster = new THREE.Raycaster();
  private readonly controllerWorldPos = new THREE.Vector3();
  private readonly controllerWorldDir = new THREE.Vector3();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempArcPoint = new THREE.Vector3();
  private readonly tempArcVelocity = new THREE.Vector3();
  private readonly tempHitFloorPoint = new THREE.Vector3();

  // Переиспользуемые структуры состояния контроллеров для исключения аллокаций в кадре
  private readonly leftInputState: XRControllerInput = {
    moveX: 0,
    moveY: 0,
    turnX: 0,
    turnY: 0,
    trigger: 0,
    grip: 0,
    primaryPressed: false,
    secondaryPressed: false,
    thumbstickPressed: false,
    squeezePressed: false
  };

  private readonly rightInputState: XRControllerInput = {
    moveX: 0,
    moveY: 0,
    turnX: 0,
    turnY: 0,
    trigger: 0,
    grip: 0,
    primaryPressed: false,
    secondaryPressed: false,
    thumbstickPressed: false,
    squeezePressed: false
  };

  // Троттлинг тактильного виброотклика (180 мс — в строгом окне 150–200 мс) и настройка силы (0.0..1.0)
  private lastHapticTime = 0;
  private readonly HAPTIC_INTERVAL_MS = 180;
  public hapticStrength = 1.0;
  public lastEffectiveHapticIntensity = 0.0;
  private draggingUiControllerIdx: number | null = null;
  private isDisposed = false;
  private readonly cleanupCallbacks: Array<() => void> = [];
  private attachedSession: XRSession | null = null;
  private readonly tempCamPos = new THREE.Vector3();
  private readonly tempCamDir = new THREE.Vector3();
  private readonly tempCamQuat = new THREE.Quaternion();

  private readonly onRendererSessionStart = (): void => {
    this.isInVR = true;
    const session = this.renderer.xr.getSession();
    this.xrSession = session;
    this.attachXRSessionListeners(session);

    // Сброс Y-координаты группы игрока под аппаратный уровень пола гарнитуры (для local/viewer — 1.65м)
    this.playerGroup.position.y = this.activeReferenceSpaceType === 'local-floor' ? 0.0 : 1.65;
    this.syncTrackedHandMetaFromSession();
    this.syncHandRigVisibility();

    this.updateVRButtonText();
    this.callbacks.onSessionStart?.();
  };

  private readonly onRendererSessionEnd = (): void => {
    this.detachXRSessionListeners();
    this.cleanupSessionState();
    this.updateVRButtonText();
    this.callbacks.onSessionEnd?.();
  };

  private readonly onSessionInputSourcesChange = (): void => {
    this.syncTrackedHandMetaFromSession();
    this.syncHandRigVisibility();
  };

  private readonly onSessionGazeSelectStart = (event: XRInputSourceEvent): void => {
    try {
      const src = event.inputSource;
      const isGazeOrTransient =
        src.targetRayMode === 'gaze' ||
        src.targetRayMode === 'transient-pointer' ||
        (!this.hasTrackedHand('right') && !this.hasTrackedHand('left'));
      if (!isGazeOrTransient) return;

      this.isGazeSelectHeld = true;
      this.gazeJustPressed = true;
    } catch {
      // Игнорируем некорректные события selectstart
    }
  };

  private readonly onSessionGazeSelectEnd = (event: XRInputSourceEvent): void => {
    try {
      const src = event.inputSource;
      const isGazeOrTransient =
        src.targetRayMode === 'gaze' ||
        src.targetRayMode === 'transient-pointer' ||
        this.isGazeSelectHeld;
      if (!isGazeOrTransient) return;

      this.isGazeSelectHeld = false;
      this.gazeJustReleased = true;
    } catch {
      // Игнорируем некорректные события selectend
    }
  };

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    playerGroup: THREE.Group,
    callbacks: WebXRCallbacks = {}
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.playerGroup = playerGroup;
    this.callbacks = callbacks;

    // 1. Инициализация высоты playerGroup.position.y в 0.0 по умолчанию
    this.playerGroup.position.y = 0.0;

    // 2. Конфигурация WebXR-подсистемы рендерера
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    // 3. Обработчики жизненного цикла XR-сессии
    this.renderer.xr.addEventListener('sessionstart', this.onRendererSessionStart);
    this.renderer.xr.addEventListener('sessionend', this.onRendererSessionEnd);

    // 4. Инициализация геометрии параболической дуги телепортации без динамических аллокаций
    this.arcPositionsBuffer = new Float32Array((this.arcPointsCount + 1) * 3);
    this.arcPositionAttribute = new THREE.BufferAttribute(this.arcPositionsBuffer, 3);
    this.arcPositionAttribute.setUsage(THREE.DynamicDrawUsage);

    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', this.arcPositionAttribute);

    const arcMat = new THREE.LineBasicMaterial({
      color: 0x6366f1,
      linewidth: 3,
      transparent: true,
      opacity: 0.9
    });
    this.arcLine = new THREE.Line(arcGeo, arcMat);
    this.arcLine.frustumCulled = false;
    this.arcLine.visible = false;
    this.scene.add(this.arcLine);

    // Целевое кольцо точки телепортации на полу
    const ringGeo = new THREE.RingGeometry(0.35, 0.45, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x818cf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.targetRing = new THREE.Mesh(ringGeo, ringMat);
    this.targetRing.rotation.x = Math.PI / 2;
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);

    // Прицел взгляда (Gaze Reticle) для шлемов без контроллеров
    const gazeGeo = new THREE.RingGeometry(0.012, 0.02, 24);
    const gazeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false
    });
    this.gazeReticle = new THREE.Mesh(gazeGeo, gazeMat);
    this.gazeReticle.renderOrder = 999;
    this.gazeReticle.visible = false;
    this.gazeReticle.raycast = () => {};
    this.scene.add(this.gazeReticle);
    this.gazeAnchorGroup.name = 'webxr_gaze_anchor';

    this.checkXRSupport();
    this.setupControllersInPlayerGroup();
  }

  private attachXRSessionListeners(session: XRSession | null): void {
    if (this.attachedSession === session) return;
    this.detachXRSessionListeners();
    if (!session) return;
    try {
      session.addEventListener('inputsourceschange', this.onSessionInputSourcesChange);
      session.addEventListener('selectstart', this.onSessionGazeSelectStart);
      session.addEventListener('selectend', this.onSessionGazeSelectEnd);
      this.attachedSession = session;
    } catch {
      this.attachedSession = null;
    }
  }

  private detachXRSessionListeners(): void {
    if (!this.attachedSession) return;
    try {
      this.attachedSession.removeEventListener('inputsourceschange', this.onSessionInputSourcesChange);
      this.attachedSession.removeEventListener('selectstart', this.onSessionGazeSelectStart);
      this.attachedSession.removeEventListener('selectend', this.onSessionGazeSelectEnd);
    } catch {
      // Игнорируем, если сессия уже закрыта
    }
    this.attachedSession = null;
  }

  private syncTrackedHandMetaFromSession(): void {
    const session = this.xrSession;
    if (!session) {
      this.controllerMeta[0] = { connected: false, handedness: 'none', targetRayMode: 'unknown' };
      this.controllerMeta[1] = { connected: false, handedness: 'none', targetRayMode: 'unknown' };
      return;
    }
    try {
      const trackedSources: XRInputSource[] = [];
      const inputSources = session.inputSources;
      if (inputSources) {
        for (let i = 0; i < inputSources.length; i++) {
          const src = inputSources[i];
          if (src && src.targetRayMode === 'tracked-pointer') {
            trackedSources.push(src);
          }
        }
      }
      // Обновляем только незаполненные слоты, если 'connected' ещё не сработал
      for (let i = 0; i < Math.min(2, trackedSources.length); i++) {
        const slot = i as 0 | 1;
        if (!this.controllerMeta[slot].connected) {
          this.controllerMeta[slot] = {
            connected: true,
            handedness: trackedSources[i].handedness,
            targetRayMode: trackedSources[i].targetRayMode
          };
        }
      }
    } catch {
      // Игнорируем транзиентные ошибки inputSources
    }
  }

  private hasTrackedHand(hand: 'left' | 'right'): boolean {
    if (this.controllerMeta[0].connected && this.controllerMeta[0].handedness === hand) return true;
    if (this.controllerMeta[1].connected && this.controllerMeta[1].handedness === hand) return true;
    if (hand === 'right') {
      if (
        (this.controllerMeta[0].connected && this.controllerMeta[0].handedness === 'none') ||
        (this.controllerMeta[1].connected && this.controllerMeta[1].handedness === 'none')
      ) {
        return true;
      }
    }
    return false;
  }

  public getControllerIndexForHand(hand: 'left' | 'right'): 0 | 1 | null {
    if (this.controllerMeta[0].connected && this.controllerMeta[0].handedness === hand) return 0;
    if (this.controllerMeta[1].connected && this.controllerMeta[1].handedness === hand) return 1;
    if (hand === 'right') {
      if (this.controllerMeta[0].connected && this.controllerMeta[0].handedness === 'none') return 0;
      if (this.controllerMeta[1].connected && this.controllerMeta[1].handedness === 'none') return 1;
    }
    return null;
  }

  public getControllerForHand(hand: 'left' | 'right'): THREE.Group | null {
    const idx = this.getControllerIndexForHand(hand);
    if (idx === 0) return this.controller0;
    if (idx === 1) return this.controller1;
    return hand === 'right' ? this.controller0 : this.controller1;
  }

  public getControllerHandedness(controllerIndex: number | null | undefined): 'left' | 'right' {
    if (controllerIndex === 0 || controllerIndex === 1) {
      const h = this.controllerMeta[controllerIndex].handedness;
      if (h === 'left' || h === 'right') return h;
      return controllerIndex === 1 ? 'left' : 'right';
    }
    return 'right';
  }

  private syncHandRigVisibility(): void {
    if (!this.isInVR) {
      if (this.rightHandRig) this.rightHandRig.rootGroup.visible = false;
      if (this.leftHandRig) this.leftHandRig.rootGroup.visible = false;
      this.gazeReticle.visible = false;
      return;
    }
    const hasRight = this.hasTrackedHand('right');
    const hasLeft = this.hasTrackedHand('left');
    if (this.rightHandRig) {
      this.rightHandRig.rootGroup.visible = hasRight;
    }
    if (this.leftHandRig) {
      this.leftHandRig.rootGroup.visible = hasLeft;
    }
  }

  /**
   * Полная очистка состояний при завершении XR-сессии (sessionend):
   * скрытие дуги телепортации, отключение моделей рук и сброс флагов активности
   */
  private cleanupSessionState(): void {
    this.isInVR = false;
    this.xrSession = null;
    this.isTeleportActive = false;
    this.isSqueezeGrabActive = false;
    this.isMovementFrozen = false;
    this.snapLocked = false;
    this.snapCooldown = 0;
    this.prevLeftPrimaryPressed = false;
    this.prevRightPrimaryPressed = false;
    this.draggingUiControllerIdx = null;
    this.isGazeSelectHeld = false;
    this.gazeJustPressed = false;
    this.gazeJustReleased = false;
    this.gazeReticle.visible = false;
    this.controllerMeta[0] = { connected: false, handedness: 'none', targetRayMode: 'unknown' };
    this.controllerMeta[1] = { connected: false, handedness: 'none', targetRayMode: 'unknown' };
    this.vrInputManager?.reset();

    if (this.prevLeftPttHeld) {
      this.prevLeftPttHeld = false;
      this.voiceTaskLogger?.stopPushToTalk();
      this.callbacks.onVoicePushToTalkChange?.(false);
    }
    this.leftXHoldDurationSec = 0;
    this.leftXTriggeredPtt = false;

    // Скрытие дуги и целевого маркера телепортации
    this.arcLine.visible = false;
    this.targetRing.visible = false;

    // Отключение отображения VR-моделей рук
    if (this.rightHandRig) {
      this.rightHandRig.rootGroup.visible = false;
      this.rightHandRig.setFingerCurl(0);
    }
    if (this.leftHandRig) {
      this.leftHandRig.rootGroup.visible = false;
      this.leftHandRig.setFingerCurl(0);
    }

    // Полное скрытие коротких UI-указок при выходе из сессии
    if (this.laser0) {
      this.laser0.visible = false;
      (this.laser0.material as THREE.LineBasicMaterial).color.setHex(0x38bdf8);
    }
    if (this.laser1) {
      this.laser1.visible = false;
      (this.laser1.material as THREE.LineBasicMaterial).color.setHex(0x38bdf8);
    }
  }

  private bindControllerEvents(ctrl: THREE.XRTargetRaySpace, slot: 0 | 1): void {
    const onConnected = (event: { data?: XRInputSource } & THREE.Event) => {
      const src = event.data;
      this.controllerMeta[slot] = {
        connected: true,
        handedness: src?.handedness ?? 'none',
        targetRayMode: src?.targetRayMode ?? 'unknown'
      };
      this.syncHandRigVisibility();
    };

    const onDisconnected = () => {
      this.controllerMeta[slot] = {
        connected: false,
        handedness: 'none',
        targetRayMode: 'unknown'
      };
      if (this.draggingUiControllerIdx === slot) {
        this.draggingUiControllerIdx = null;
      }
      this.syncHandRigVisibility();
    };

    const onSelectStart = () => {
      if (this.vrUiSystem && this.checkAndTriggerVRUIClick(ctrl)) {
        this.draggingUiControllerIdx = slot;
        return;
      }
      this.callbacks.onSelectStart?.(ctrl, slot);
    };

    const onSelectEnd = () => {
      if (this.draggingUiControllerIdx === slot) {
        this.draggingUiControllerIdx = null;
      }
      this.callbacks.onSelectEnd?.(ctrl, slot);
    };

    const onSqueezeStart = () => {
      const grabbed = this.callbacks.onSqueezeStart?.(ctrl, slot);
      if (grabbed) {
        this.isSqueezeGrabActive = true;
        this.isTeleportActive = false;
      } else {
        this.isTeleportActive = true;
      }
    };

    const onSqueezeEnd = () => {
      this.callbacks.onSqueezeEnd?.(ctrl, slot);
      this.isSqueezeGrabActive = false;
      if (this.isTeleportActive && this.targetRing.visible) {
        this.callbacks.onTeleportTrigger?.(this.targetRing.position);
      }
      this.isTeleportActive = false;
      this.arcLine.visible = false;
      this.targetRing.visible = false;
    };

    ctrl.addEventListener('connected' as never, onConnected as never);
    ctrl.addEventListener('disconnected' as never, onDisconnected as never);
    ctrl.addEventListener('selectstart', onSelectStart);
    ctrl.addEventListener('selectend', onSelectEnd);
    ctrl.addEventListener('squeezestart', onSqueezeStart);
    ctrl.addEventListener('squeezeend', onSqueezeEnd);

    this.cleanupCallbacks.push(() => {
      ctrl.removeEventListener('connected' as never, onConnected as never);
      ctrl.removeEventListener('disconnected' as never, onDisconnected as never);
      ctrl.removeEventListener('selectstart', onSelectStart);
      ctrl.removeEventListener('selectend', onSelectEnd);
      ctrl.removeEventListener('squeezestart', onSqueezeStart);
      ctrl.removeEventListener('squeezeend', onSqueezeEnd);
    });
  }

  /**
   * Инициализация контроллеров, их хватов (ControllerGrip) и моделей рук (HazmatHandRig)
   * СТРОГО внутри единой родительской группы игрока (this.playerGroup) для предотвращения дрифта.
   * Определение левой/правой руки выполняется динамически через inputSource.handedness.
   */
  private setupControllersInPlayerGroup(): void {
    // Контроллер 0 и Хват 0 — внутри this.playerGroup
    const c0 = this.renderer.xr.getController(0);
    this.controller0 = c0;
    this.bindControllerEvents(c0, 0);
    this.playerGroup.add(c0);

    const grip0 = this.renderer.xr.getControllerGrip(0);
    this.controllerGrip0 = grip0;
    this.playerGroup.add(grip0);

    // Контроллер 1 и Хват 1 — внутри this.playerGroup
    const c1 = this.renderer.xr.getController(1);
    this.controller1 = c1;
    this.bindControllerEvents(c1, 1);
    this.playerGroup.add(c1);

    const grip1 = this.renderer.xr.getControllerGrip(1);
    this.controllerGrip1 = grip1;
    this.playerGroup.add(grip1);

    // Правая анатомическая кисть с дозиметром внутри ладони (Palmar Grip Pose: curl ≈ 0.42)
    this.rightHandRig = new RealisticHumanHandRig({ handedness: 'right', withRadiometer: true });
    this.rightHandRig.rootGroup.position.set(0, 0, 0);
    this.rightHandRig.rootGroup.quaternion.identity();
    this.rightHandRig.handGroup.position.copy(RealisticHumanHandRig.VR_WRIST_OFFSET_POS);
    this.rightHandRig.handGroup.rotation.copy(RealisticHumanHandRig.VR_WRIST_OFFSET_ROT);
    this.rightHandRig.rootGroup.visible = false;
    this.playerGroup.add(this.rightHandRig.rootGroup);

    // Левая кисть с жестко интегрированным тактическим фонарем VRFlashlight
    this.leftHandRig = new RealisticHumanHandRig({
      handedness: 'left',
      withFlashlight: true,
      initialFlashlightOn: false
    });
    this.leftHandRig.rootGroup.position.set(0, 0, 0);
    this.leftHandRig.rootGroup.quaternion.identity();
    this.leftHandRig.handGroup.position.copy(RealisticHumanHandRig.VR_WRIST_OFFSET_POS);
    this.leftHandRig.handGroup.rotation.copy(RealisticHumanHandRig.VR_WRIST_OFFSET_ROT);
    this.leftHandRig.rootGroup.visible = false;
    this.playerGroup.add(this.leftHandRig.rootGroup);

    // Короткие UI-указки: скрыты по умолчанию, включаются только при наведении на VR UI-панель
    const shortPointerGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -0.07),
      new THREE.Vector3(0, 0, -0.48)
    ]);
    const laserMat0 = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75
    });
    this.laser0 = new THREE.Line(shortPointerGeo, laserMat0);
    this.laser0.name = 'short_ui_pointer';
    this.laser0.visible = false;
    c0.add(this.laser0);

    const laserMat1 = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75
    });
    this.laser1 = new THREE.Line(shortPointerGeo.clone(), laserMat1);
    this.laser1.name = 'short_ui_pointer';
    this.laser1.visible = false;
    c1.add(this.laser1);

    this.wristDisplay = new VRWristDisplay();
    this.wristDisplay.mesh.position.set(0.016, 0.034, 0.032);
    this.wristDisplay.mesh.rotation.set(-Math.PI / 3.2, 0, 0);
    this.leftHandRig.handGroup.add(this.wristDisplay.mesh);

    // =========================================================
    // 4. Инициализация строго типизированного VRInputManager
    // =========================================================
    if (this.leftHandRig.flashlight) {
      this.vrInputManager = new VRInputManager(this.playerGroup, this.leftHandRig.flashlight, {
        onRightGripInstrumentStateChange: (isGripping, gripValue) => {
          this.rightHandRig?.setRightRadiometerGripPose(isGripping, gripValue);
        },
        onCalibratePlayerSpace: () => {
          this.callbacks.onCalibratePlayerSpace?.();
        },
        analyticsOverlay: {
          toggle: () => {
            this.vrUiSystem?.toggleAnalyticsWindow();
            this.callbacks.onToggleAnalyticsOverlay?.();
          }
        },
        radiationBackgroundField: {
          toggle: () => {
            this.callbacks.onToggleRadiationBackgroundField?.();
          }
        },
        onLeftTriggerFingerCurl: (triggerValue, gripValue) => {
          if (this.leftHandRig) {
            const leftCurl = Math.max(
              triggerValue,
              this.isSqueezeGrabActive ? gripValue * 0.78 : 0
            );
            this.leftHandRig.setFingerCurl(leftCurl);
          }
        },
        voiceTaskLogger: {
          startListening: (gamepad) => {
            this.voiceTaskLogger?.startListening(gamepad ?? undefined);
          },
          stopListening: (gamepad) => {
            this.voiceTaskLogger?.stopListening(gamepad ?? undefined);
          }
        },
        onPushToTalkStateChange: (isListening) => {
          this.callbacks.onVoicePushToTalkChange?.(isListening);
        },
        onFlashlightToggled: (isOn) => {
          this.callbacks.onToggleFlashlight?.('left', isOn);
        },
        onCycleTool: (dir) => {
          this.callbacks.onCycleTool?.(dir);
        },
        onLeftThumbstickPress: () => {
          this.callbacks.onLeftThumbstickPress?.();
        },
        onRightTriggerWorldHold: (raycaster, controller, isHeld, justPressed, justReleased) => {
          this.callbacks.onRightTriggerWorldHold?.(raycaster, controller, isHeld, justPressed, justReleased);
        }
      });
    }
  }

  /**
   * Привязка модуля голосового протоколирования VoiceTaskLogger и его 3D-индикатора микрофона к тыльной стороне левой кисти
   */
  public attachVoiceTaskLogger(logger: VoiceTaskLogger): void {
    this.voiceTaskLogger = logger;
    if (this.leftHandRig) {
      this.leftHandRig.handGroup.add(logger.micIndicator3D.rootGroup);
    }
  }

  /**
   * Привязка внешних контроллеров AnalyticsOverlay и RadiationBackgroundField к VRInputManager
   */
  public bindExternalInputSystems(
    analyticsOverlay?: IAnalyticsOverlayController,
    radiationBackgroundField?: IRadiationBackgroundFieldController
  ): void {
    if (!this.vrInputManager) return;
    this.vrInputManager.setCallbacks({
      ...(analyticsOverlay ? { analyticsOverlay } : {}),
      ...(radiationBackgroundField ? { radiationBackgroundField } : {})
    });
  }

  public get leftFlashlight(): VRFlashlight | null {
    return this.leftHandRig?.flashlight ?? null;
  }

  public equipLeftHandFlashlight(turnOn?: boolean): VRFlashlight | null {
    if (!this.leftHandRig) return null;
    return this.leftHandRig.equipFlashlight(turnOn);
  }

  public setLeftHandFlashlightPower(isOn: boolean): void {
    this.leftHandRig?.setFlashlightPower(isOn);
  }

  public isTogglingVR = false;
  public vrButtonElement: HTMLElement | null = null;

  public toggleLeftHandFlashlight(): boolean {
    return this.leftHandRig ? this.leftHandRig.toggleFlashlight() : false;
  }

  public createVRButton(): HTMLElement {
    const rawBtn = VRButton.createButton(this.renderer);
    // Клонируем элемент без Three.js дефолтных onclick/listeners, чтобы исключить конфликты и InvalidStateError
    const btn = rawBtn.cloneNode(true) as HTMLElement;
    btn.id = 'three-vr-button';
    btn.style.position = 'fixed';
    btn.style.bottom = '14px';
    btn.style.left = '14px';
    btn.style.transform = 'none';
    btn.style.zIndex = '45';
    btn.style.backgroundColor = 'rgba(11, 17, 23, 0.82)';
    btn.style.backdropFilter = 'blur(12px)';
    btn.style.border = '1px solid rgba(148, 163, 184, 0.16)';
    btn.style.borderRadius = '10px';
    btn.style.padding = '7px 12px';
    btn.style.fontFamily = "'JetBrains Mono', monospace";
    btn.style.fontSize = '11px';
    btn.style.color = '#F59E0B';
    btn.style.fontWeight = '600';
    btn.style.letterSpacing = '0.03em';
    btn.style.cursor = 'pointer';
    btn.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.45)';
    btn.style.transition = 'all 0.2s ease';
    btn.textContent = 'ВОЙТИ В VR (HTC VIVE)';

    btn.onclick = async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      await this.toggleVRSession();
      this.updateVRButtonText(btn);
    };

    this.vrButtonElement = btn;
    return btn;
  }

  public updateVRButtonText(btn?: HTMLElement): void {
    const target = btn || this.vrButtonElement;
    if (target) {
      target.style.display = this.isInVR ? 'none' : 'block';
      target.textContent = this.isInVR
        ? 'ВЫЙТИ ИЗ VR'
        : 'ВОЙТИ В VR (HTC VIVE)';
      target.style.borderColor = this.isInVR
        ? 'rgba(239, 68, 68, 0.6)'
        : 'rgba(14, 165, 233, 0.35)';
      target.style.color = this.isInVR ? '#EF4444' : '#F59E0B';
    }
  }

  public async checkXRSupport(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && 'xr' in navigator && navigator.xr) {
      try {
        this.isSupported = await (navigator.xr as XRSystem).isSessionSupported('immersive-vr');
      } catch {
        this.isSupported = false;
      }
    } else {
      this.isSupported = false;
    }
    return this.isSupported;
  }

  /**
   * Нормализация аналоговой оси с фильтрацией мертвой зоны (deadzone >= 0.15)
   */
  private applyDeadzone(value: number, deadzone = 0.15): number {
    const effectiveDeadzone = Math.max(0.15, deadzone);
    const absVal = Math.abs(value);
    if (absVal < effectiveDeadzone) return 0;
    return Math.sign(value) * ((absVal - effectiveDeadzone) / (1 - effectiveDeadzone));
  }

  /**
   * Безаллокационное чтение и нормализация осей/кнопок контроллера WebXR
   */
  public getControllerInput(hand: 'left' | 'right'): XRControllerInput {
    const target = hand === 'left' ? this.leftInputState : this.rightInputState;
    target.moveX = 0;
    target.moveY = 0;
    target.turnX = 0;
    target.turnY = 0;
    target.trigger = 0;
    target.grip = 0;
    target.primaryPressed = false;
    target.secondaryPressed = false;
    target.thumbstickPressed = false;
    target.squeezePressed = false;

    if (!this.xrSession) return target;

    try {
      const sources = this.xrSession.inputSources;
      if (!sources) return target;
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (!src || !src.gamepad) continue;
        const matchesHand =
          src.handedness === hand || (hand === 'right' && src.handedness === 'none');
        if (matchesHand) {
          const gp = src.gamepad;

          let rawX = 0;
          let rawY = 0;
          if (gp.axes && gp.axes.length >= 4) {
            const mag01 = Math.hypot(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
            const mag23 = Math.hypot(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
            if (mag23 >= mag01) {
              rawX = gp.axes[2] ?? 0;
              rawY = gp.axes[3] ?? 0;
            } else {
              rawX = gp.axes[0] ?? 0;
              rawY = gp.axes[1] ?? 0;
            }
          } else if (gp.axes && gp.axes.length >= 2) {
            rawX = gp.axes[0] ?? 0;
            rawY = gp.axes[1] ?? 0;
          }

          const normX = this.applyDeadzone(Number.isFinite(rawX) ? rawX : 0, this.deadzone);
          const normY = this.applyDeadzone(Number.isFinite(rawY) ? rawY : 0, this.deadzone);

          if (hand === 'left') {
            target.moveX = normX;
            target.moveY = normY;
          } else {
            target.turnX = normX;
            target.turnY = normY;
          }

          if (gp.buttons?.length > 0 && gp.buttons[0]) {
            target.trigger = gp.buttons[0].value ?? (gp.buttons[0].pressed ? 1.0 : 0.0);
          }
          if (gp.buttons?.length > 1 && gp.buttons[1]) {
            target.grip = gp.buttons[1].value ?? (gp.buttons[1].pressed ? 1.0 : 0.0);
            target.squeezePressed = gp.buttons[1].pressed || target.grip > 0.6;
          }
          const stickBtn = gp.buttons?.[3] ?? gp.buttons?.[2];
          if (stickBtn) {
            target.thumbstickPressed = stickBtn.pressed;
          }
          if (gp.buttons?.length > 4 && gp.buttons[4]) {
            target.primaryPressed = gp.buttons[4].pressed;
          }
          if (gp.buttons?.length > 5 && gp.buttons[5]) {
            target.secondaryPressed = gp.buttons[5].pressed;
          }

          break;
        }
      }
    } catch {
      // Игнорируем транзиентные ошибки чтения inputSources/gamepad
    }

    return target;
  }

  /**
   * Извлечение мировых координат и мирового вектора луча (-Z) контроллера
   * с учетом всех трансформаций родительской группы playerGroup (Zero Allocation)
   */
  private getControllerWorldRay(
    controller: THREE.Group,
    outOrigin: THREE.Vector3,
    outDirection: THREE.Vector3
  ): void {
    controller.getWorldPosition(outOrigin);
    // В Three.js getWorldDirection возвращает локальную ось +Z в мировых координатах;
    // луч WebXR-контроллера направлен вдоль -Z, поэтому инвертируем вектор
    controller.getWorldDirection(outDirection).negate().normalize();
  }

  private getSlotPoseObjects(slot: 0 | 1): { controller: THREE.Group | null; grip: THREE.Group | null } {
    return slot === 0
      ? { controller: this.controller0, grip: this.controllerGrip0 }
      : { controller: this.controller1, grip: this.controllerGrip1 };
  }

  /**
   * Синхронный 1:1 трекинг ориентации и позиции виртуальных кистей с физическими контроллерами WebXR
   * по реальному `handedness` подключенных контроллеров (без жесткой привязки слота 0/1)
   */
  private syncWristOrientation1To1(): void {
    const rightSlot = this.getControllerIndexForHand('right');
    if (this.rightHandRig && rightSlot !== null) {
      const { controller, grip } = this.getSlotPoseObjects(rightSlot);
      if (controller) {
        const hasCtrlPose =
          controller.position.lengthSq() > 1e-6 || Math.abs(controller.quaternion.w - 1) > 1e-6;
        const posSource = hasCtrlPose || !grip ? controller.position : grip.position;
        const quatSource = hasCtrlPose || !grip ? controller.quaternion : grip.quaternion;
        this.rightHandRig.syncDirectWristPose(posSource, quatSource);
      }
    }

    const leftSlot = this.getControllerIndexForHand('left');
    if (this.leftHandRig && leftSlot !== null) {
      const { controller, grip } = this.getSlotPoseObjects(leftSlot);
      if (controller) {
        const hasCtrlPose =
          controller.position.lengthSq() > 1e-6 || Math.abs(controller.quaternion.w - 1) > 1e-6;
        const posSource = hasCtrlPose || !grip ? controller.position : grip.position;
        const quatSource = hasCtrlPose || !grip ? controller.quaternion : grip.quaternion;
        this.leftHandRig.syncDirectWristPose(posSource, quatSource);
      }
    }
  }

  /**
   * Главный цикл обновления XR (Zero Allocation):
   * - Smooth Locomotion по XZ-проекции взгляда камеры (только playerGroup.position.x / .z)
   * - Snap / Smooth Turn (только playerGroup.rotation.y)
   * - Синхронный 1:1 трекинг поворота кистей (Direct Wrist Orientation Mapping) и сгиба пальцев
   * - Лазерный рейкастинг UI, поддержка gaze fallback (без контроллеров) и телепортация
   */
  public update(dt: number, camera: THREE.Camera): void {
    if (!this.isInVR || this.isDisposed) {
      this.isMoving = false;
      return;
    }

    this.syncTrackedHandMetaFromSession();
    this.syncHandRigVisibility();

    const leftInput = this.getControllerInput('left');
    const rightInput = this.getControllerInput('right');
    this.isMoving = Math.abs(leftInput.moveX) > 0.05 || Math.abs(leftInput.moveY) > 0.05;

    const rightSlot = this.getControllerIndexForHand('right');
    const leftSlot = this.getControllerIndexForHand('left');
    const rightCtrl = rightSlot === 0 ? this.controller0 : rightSlot === 1 ? this.controller1 : null;
    const leftCtrl = leftSlot === 0 ? this.controller0 : leftSlot === 1 ? this.controller1 : null;

    if (this.vrInputManager) {
      this.vrInputManager.moveSpeed = this.moveSpeed;
      this.vrInputManager.turnMode = this.turnMode;
      this.vrInputManager.snapTurnAngleRad = this.snapAngle;
      this.vrInputManager.smoothTurnSpeedRad = this.smoothTurnSpeed;
      this.vrInputManager.deadzone = this.deadzone;

      this.vrInputManager.update(
        dt,
        this.xrSession,
        camera,
        rightCtrl,
        leftCtrl,
        this.isMovementFrozen
      );
    }

    // Обновление 3D-индикатора микрофона и амплитуды голоса на левой руке
    this.voiceTaskLogger?.update(dt);

    // 3. Абсолютный 1:1 трекинг поворота кистей (Pitch, Roll, Yaw) и сгибание пальцев
    this.syncWristOrientation1To1();

    if (this.leftHandRig && this.leftHandRig.rootGroup.visible) {
      const leftCurl = Math.max(leftInput.trigger, this.isSqueezeGrabActive ? leftInput.grip * 0.78 : 0);
      this.leftHandRig.setFingerCurl(leftCurl);
      this.leftHandRig.update(dt, true);
    }
    if (this.rightHandRig && this.rightHandRig.rootGroup.visible) {
      if (!this.vrInputManager?.isRightGripHoldingRadiometer) {
        this.rightHandRig.setFingerCurl(rightInput.trigger);
      }
      this.rightHandRig.update(dt, true);
    }

    // 4. Рейкастинг VR UI: короткая указка включается ИСКЛЮЧИТЕЛЬНО при наведении на UI-панели
    const hasAnyTrackedPointer = rightCtrl !== null || leftCtrl !== null;
    if (this.vrUiSystem) {
      let uiHit0 = false;
      if (this.controller0 && this.controllerMeta[0].connected) {
        uiHit0 = this.updateUIRaycast(this.controller0, this.laser0);
      } else if (this.laser0) {
        this.laser0.visible = false;
      }

      if (this.controller1 && this.controllerMeta[1].connected) {
        if (!uiHit0) {
          this.updateUIRaycast(this.controller1, this.laser1);
        } else if (this.laser1) {
          this.laser1.visible = false;
        }
      } else if (this.laser1) {
        this.laser1.visible = false;
      }

      // Плавное перетаскивание ползунка виброотклика (Haptic Strength Slider) при удержании курка
      if (this.draggingUiControllerIdx !== null) {
        const dragSlot = this.draggingUiControllerIdx as 0 | 1;
        const dragCtrl = dragSlot === 0 ? this.controller0 : this.controller1;
        const dragHand = this.getControllerHandedness(dragSlot);
        const isTriggerHeld =
          dragHand === 'right' ? rightInput.trigger > 0.35 : leftInput.trigger > 0.35;
        if (dragCtrl && isTriggerHeld) {
          this.getControllerWorldRay(dragCtrl, this.controllerWorldPos, this.controllerWorldDir);
          this.raycaster.set(this.controllerWorldPos, this.controllerWorldDir);
          this.vrUiSystem.triggerSliderDrag(this.raycaster);
        } else if (!isTriggerHeld) {
          this.draggingUiControllerIdx = null;
        }
      }
    }

    // 4.5. Fallback для шлемов без контроллеров (gaze / transient-pointer): прицел взглядом + select
    if (!hasAnyTrackedPointer) {
      camera.getWorldPosition(this.tempCamPos);
      camera.getWorldDirection(this.tempCamDir).normalize();
      camera.getWorldQuaternion(this.tempCamQuat);

      this.gazeAnchorGroup.position.copy(this.tempCamPos);
      this.gazeAnchorGroup.quaternion.copy(this.tempCamQuat);
      this.gazeAnchorGroup.updateMatrixWorld(true);

      this.raycaster.set(this.tempCamPos, this.tempCamDir);
      const uiHit = this.vrUiSystem ? this.vrUiSystem.testRaycast(this.raycaster) : null;

      this.gazeReticle.visible = true;
      const reticleDist = uiHit
        ? Math.max(0.4, Math.min(3.5, this.tempCamPos.distanceTo(uiHit.point) - 0.02))
        : 1.85;
      this.gazeReticle.position
        .copy(this.tempCamPos)
        .addScaledVector(this.tempCamDir, reticleDist);
      this.gazeReticle.quaternion.copy(this.tempCamQuat);
      (this.gazeReticle.material as THREE.MeshBasicMaterial).color.setHex(
        uiHit?.buttonId ? 0xfacc15 : 0x38bdf8
      );

      if (this.gazeJustPressed) {
        const clickedUi = this.vrUiSystem ? this.vrUiSystem.triggerClick(this.raycaster) : false;
        if (!clickedUi) {
          this.callbacks.onSelectStart?.(this.gazeAnchorGroup, 0);
        }
      }
      if (this.gazeJustPressed || this.isGazeSelectHeld || this.gazeJustReleased) {
        this.callbacks.onRightTriggerWorldHold?.(
          this.raycaster,
          this.gazeAnchorGroup,
          this.isGazeSelectHeld,
          this.gazeJustPressed,
          this.gazeJustReleased
        );
      }
      if (this.gazeJustReleased) {
        this.callbacks.onSelectEnd?.(this.gazeAnchorGroup, 0);
      }
      this.gazeJustPressed = false;
      this.gazeJustReleased = false;
    } else {
      this.gazeReticle.visible = false;
      this.gazeJustPressed = false;
      this.gazeJustReleased = false;
    }

    // 5. Параболическая телепортация от мировых координат контроллера (блокируется при заморозке в состоянии Game Over)
    if (
      !this.isMovementFrozen &&
      !this.isSqueezeGrabActive &&
      (leftInput.squeezePressed || rightInput.squeezePressed)
    ) {
      const activeCtrl = rightInput.squeezePressed ? rightCtrl : leftCtrl;
      if (activeCtrl) {
        this.isTeleportActive = true;
        this.getControllerWorldRay(activeCtrl, this.controllerWorldPos, this.controllerWorldDir);
        this.updateTeleportArc(this.controllerWorldPos, this.controllerWorldDir);
      }
    } else if (this.isTeleportActive) {
      if (!this.isMovementFrozen && !this.isSqueezeGrabActive && this.targetRing.visible) {
        this.callbacks.onTeleportTrigger?.(this.targetRing.position);
      }
      this.isTeleportActive = false;
      this.arcLine.visible = false;
      this.targetRing.visible = false;
    }
  }

  private updateUIRaycast(controller: THREE.Group, laser: THREE.Line | null): boolean {
    if (!this.vrUiSystem) {
      if (laser) laser.visible = false;
      return false;
    }

    this.getControllerWorldRay(controller, this.controllerWorldPos, this.controllerWorldDir);
    this.raycaster.set(this.controllerWorldPos, this.controllerWorldDir);

    const hit = this.vrUiSystem.testRaycast(this.raycaster);

    if (laser) {
      if (hit !== null) {
        // Включаем короткую указку ИСКЛЮЧИТЕЛЬНО при наведении на плавающую UI-панель
        laser.visible = true;
        const mat = laser.material as THREE.LineBasicMaterial;
        mat.color.setHex(hit.buttonId ? 0xfacc15 : 0x38bdf8);
      } else {
        // Вне UI-панелей лазерная палка полностью отключена
        laser.visible = false;
      }
    }
    return hit !== null;
  }

  private checkAndTriggerVRUIClick(controller: THREE.Group): boolean {
    this.getControllerWorldRay(controller, this.controllerWorldPos, this.controllerWorldDir);
    this.raycaster.set(this.controllerWorldPos, this.controllerWorldDir);

    // 1. Проверяем клик по экрану левого запястья (VRWristDisplay) для мгновенного переключения HUD
    if (this.wristDisplay && this.wristDisplay.mesh && this.wristDisplay.mesh.visible) {
      const wristHits = this.raycaster.intersectObject(this.wristDisplay.mesh, false);
      if (wristHits.length > 0 && this.vrUiSystem) {
        const nextVis = this.vrUiSystem.toggleHudVisibility();
        this.callbacks.onToggleHudVisibility?.(nextVis);
        return true;
      }
    }

    if (!this.vrUiSystem) return false;
    return this.vrUiSystem.triggerClick(this.raycaster);
  }

  public updateVRWristDisplay(
    doseRateMicroSv: number,
    cumulativeDoseMsv: number,
    taskTitle: string,
    isFlashlightOn?: boolean,
    hapticStrength?: number,
    activeToolLabel?: string,
    holdProgressPct?: number | null
  ): void {
    if (this.wristDisplay && this.isInVR) {
      const isVoiceRec = this.voiceTaskLogger?.isPushToTalkActive ?? false;
      const voiceVol = this.voiceTaskLogger?.volumeLevel ?? 0;
      const latestToast = this.voiceTaskLogger?.getLatestActiveToast();
      const interim = this.voiceTaskLogger?.interimTranscript ?? '';
      const voiceLine =
        isVoiceRec && interim.length > 0
          ? interim
          : latestToast
          ? latestToast.text
          : undefined;

      this.wristDisplay.update(
        doseRateMicroSv,
        cumulativeDoseMsv,
        taskTitle,
        isFlashlightOn,
        hapticStrength ?? this.hapticStrength,
        isVoiceRec,
        voiceVol,
        voiceLine,
        this.vrUiSystem?.isHudVisible ?? true,
        activeToolLabel,
        holdProgressPct
      );
    }
  }

  /**
   * Безаллокационный расчет параболической дуги телепортации от мировых координат контроллера
   */
  public updateTeleportArc(startWorldPos: THREE.Vector3, forwardWorldDir: THREE.Vector3): void {
    if (!this.isTeleportActive) {
      this.arcLine.visible = false;
      this.targetRing.visible = false;
      return;
    }

    this.tempArcPoint.copy(startWorldPos);
    this.tempArcVelocity.copy(forwardWorldDir).multiplyScalar(9.0);

    const stepDt = 0.04;
    let foundFloorHit = false;

    for (let i = 0; i <= this.arcPointsCount; i++) {
      const idx = i * 3;
      this.arcPositionsBuffer[idx] = this.tempArcPoint.x;
      this.arcPositionsBuffer[idx + 1] = this.tempArcPoint.y;
      this.arcPositionsBuffer[idx + 2] = this.tempArcPoint.z;

      this.tempArcPoint.addScaledVector(this.tempArcVelocity, stepDt);
      this.tempArcVelocity.y -= 9.81 * stepDt;

      if (this.tempArcPoint.y <= 0.02 && !foundFloorHit) {
        this.tempHitFloorPoint.set(this.tempArcPoint.x, 0.02, this.tempArcPoint.z);
        foundFloorHit = true;
      }
    }

    this.arcPositionAttribute.needsUpdate = true;
    this.arcLine.geometry.computeBoundingSphere();
    this.arcLine.visible = true;

    if (foundFloorHit) {
      this.targetRing.position.copy(this.tempHitFloorPoint);
      this.targetRing.visible = true;
    } else {
      this.targetRing.visible = false;
    }
  }

  /**
   * Вычисление пропорционального отклика вибрации (Haptic Intensity & Duration)
   * от текущей мощности дозы излучения dD/dt (мкЗв/ч) и пользовательской настройки силы (hapticStrength: 0..1).
   * Обеспечивает тонкую физическую обратную связь при манипуляциях с высокоактивными источниками.
   */
  public computeProportionalHapticParams(
    doseRateMicroSvPerHour: number,
    isHoldingHighActivitySource = false
  ): {
    intensity: number;
    rawNormalizedIntensity: number;
    durationMs: number;
    intervalMs: number;
  } {
    const strength = THREE.MathUtils.clamp(this.hapticStrength, 0, 1);
    if (strength <= 0.001 || doseRateMicroSvPerHour < 0.5) {
      return {
        intensity: 0,
        rawNormalizedIntensity: 0,
        durationMs: 0,
        intervalMs: this.HAPTIC_INTERVAL_MS
      };
    }

    // Непрерывное кусочно-пропорциональное отображение мощности дозы dD/dt на шкалу [0.04 .. 1.0]:
    // 1) Малые мощности дозы (0.5 .. 50 мкЗв/ч) — мягкие тактильные импульсы [0.04 .. 0.25]
    // 2) Повышенный / предупреждающий фон (50 .. 1000 мкЗв/ч) — пропорциональный рост [0.25 .. 0.68]
    // 3) Высокоактивные источники (1000 .. 15000+ мкЗв/ч) — интенсивная вибрация [0.68 .. 1.00]
    let rawNormalized = 0;
    if (doseRateMicroSvPerHour < 50.0) {
      const t = (doseRateMicroSvPerHour - 0.5) / 49.5;
      rawNormalized = 0.04 + t * 0.21;
    } else if (doseRateMicroSvPerHour < 1000.0) {
      const t = (doseRateMicroSvPerHour - 50.0) / 950.0;
      rawNormalized = 0.25 + t * 0.43;
    } else {
      const t = Math.min(1.0, (doseRateMicroSvPerHour - 1000.0) / 14000.0);
      rawNormalized = 0.68 + t * 0.32;
    }

    // Дополнительное усиление тактильной отдачи при непосредственном удержании источника в руке
    if (isHoldingHighActivitySource) {
      rawNormalized = Math.min(1.0, rawNormalized * 1.18 + 0.08);
    }

    const intensity = THREE.MathUtils.clamp(rawNormalized * strength, 0, 1);
    const durationMs = Math.min(
      175,
      Math.max(18, Math.round((28 + rawNormalized * 135) * (0.45 + 0.55 * strength)))
    );
    // Интервал между импульсами сужается с 195 мс до 150 мс по мере роста dD/dt
    const intervalMs = Math.round(195 - rawNormalized * 45);

    return {
      intensity,
      rawNormalizedIntensity: rawNormalized,
      durationMs,
      intervalMs
    };
  }

  /**
   * Вспомогательная отправка импульса на актуаторы WebXR-геймпада
   * (поддержка как hapticActuators[0].pulse, так и vibrationActuator.playEffect('dual-rumble'))
   */
  private pulseGamepadActuator(gamepad: Gamepad, intensity: number, durationMs: number): void {
    const clampedIntensity = THREE.MathUtils.clamp(intensity, 0, 1);
    if (clampedIntensity <= 0.005 || durationMs <= 0) return;

    if (gamepad.hapticActuators && gamepad.hapticActuators.length > 0) {
      try {
        (gamepad.hapticActuators[0] as unknown as { pulse: (val: number, dur: number) => void }).pulse(
          clampedIntensity,
          durationMs
        );
        return;
      } catch {
        // Fallback к vibrationActuator ниже
      }
    }

    const vibActuator = (gamepad as unknown as {
      vibrationActuator?: {
        playEffect?: (
          type: string,
          params: { duration: number; strongMagnitude: number; weakMagnitude: number }
        ) => void;
      };
    }).vibrationActuator;

    if (vibActuator && typeof vibActuator.playEffect === 'function') {
      try {
        vibActuator.playEffect('dual-rumble', {
          duration: durationMs,
          strongMagnitude: clampedIntensity,
          weakMagnitude: Math.min(1.0, clampedIntensity * 0.85)
        });
      } catch {
        // Игнорируем аппаратные исключения неподдерживаемых контроллеров
      }
    }
  }

  /**
   * Тактильный виброимпульс предупреждения при достижении 80% порога лимита дозы H_limit или времени T_max
   */
  public triggerWarning80HapticPulse(): void {
    if (!this.isInVR || !this.xrSession || this.hapticStrength <= 0.01) return;
    const warnIntensity = THREE.MathUtils.clamp(0.65 * this.hapticStrength, 0.15, 1.0);
    try {
      const sources = this.xrSession.inputSources;
      if (!sources) return;
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (src?.gamepad) {
          this.pulseGamepadActuator(src.gamepad, warnIntensity, 95);
        }
      }
    } catch {
      // Игнорируем транзиентные ошибки inputSources
    }
  }

  /**
   * Короткий тестовый импульс при перетаскивании ползунка силы виброотклика в VR HUD
   */
  public triggerHapticPreviewPulse(strength: number): void {
    this.hapticStrength = THREE.MathUtils.clamp(strength, 0, 1);
    if (!this.isInVR || !this.xrSession || this.hapticStrength <= 0.01) return;

    const previewIntensity = Math.max(0.08, this.hapticStrength * 0.75);
    try {
      const sources = this.xrSession.inputSources;
      if (!sources) return;
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (src?.gamepad) {
          this.pulseGamepadActuator(src.gamepad, previewIntensity, 45);
        }
      }
    } catch {
      // Игнорируем транзиентные ошибки inputSources
    }
  }

  /**
   * Тактильный виброотклик (Haptics) пропорционально мощности дозы dD/dt
   * с защитным троттлингом (150–195 мс) для исключения просадки FPS при высокой частоте кадров гарнитуры (72/90/120 Гц)
   */
  public triggerHaptics(
    doseRateMicroSvPerHour: number,
    isHoldingHighActivitySource = false,
    holdingControllerIndex: number | null = null
  ): number {
    const params = this.computeProportionalHapticParams(
      doseRateMicroSvPerHour,
      isHoldingHighActivitySource
    );
    this.lastEffectiveHapticIntensity = params.intensity;

    if (!this.isInVR || !this.xrSession || params.intensity <= 0.005) {
      return params.intensity;
    }

    const now = performance.now();
    if (now - this.lastHapticTime < params.intervalMs) {
      return params.intensity;
    }
    this.lastHapticTime = now;

    try {
      const sources = this.xrSession.inputSources;
      if (!sources) return params.intensity;
      const holdingHand =
        holdingControllerIndex === null ? null : this.getControllerHandedness(holdingControllerIndex);

      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (!src?.gamepad) continue;

        let handMultiplier = 1.0;
        if (isHoldingHighActivitySource && holdingHand !== null) {
          const isHoldingHand = src.handedness === holdingHand;
          handMultiplier = isHoldingHand ? 1.0 : 0.78;
        } else if (src.handedness === 'left') {
          handMultiplier = 0.85;
        }

        this.pulseGamepadActuator(src.gamepad, params.intensity * handMultiplier, params.durationMs);
      }
    } catch {
      // Игнорируем транзиентные ошибки inputSources
    }

    return params.intensity;
  }

  /**
   * Асинхронный каскадный запрос системы координат (Reference Space)
   * с fallback-цепочкой: 'local-floor' -> 'local' -> 'viewer' (SteamVR / OpenXR / Quest совместимость)
   */
  private async resolveReferenceSpaceWithFallback(session: XRSession): Promise<XRReferenceSpaceFallbackType> {
    const fallbackChain: XRReferenceSpaceFallbackType[] = ['local-floor', 'local', 'viewer'];

    for (let i = 0; i < fallbackChain.length; i++) {
      const spaceType = fallbackChain[i];
      try {
        await session.requestReferenceSpace(spaceType);
        this.activeReferenceSpaceType = spaceType;
        this.renderer.xr.setReferenceSpaceType(spaceType);
        return spaceType;
      } catch {
        // Переход к следующему типу пространства в цепочке fallback
      }
    }

    this.activeReferenceSpaceType = 'viewer';
    this.renderer.xr.setReferenceSpaceType('viewer');
    return 'viewer';
  }

  /**
   * Безопасное переключение XR-сессии с проверкой navigator.xr / isSessionSupported,
   * каскадным Reference Space fallback ('local-floor' -> 'local' -> 'viewer') и очисткой при сбоях.
   */
  public async toggleVRSession(): Promise<boolean> {
    if (this.isTogglingVR || this.isDisposed) return false;
    this.isTogglingVR = true;
    this.lastErrorMessageRu = null;

    try {
      if (typeof navigator === 'undefined' || !('xr' in navigator) || !navigator.xr) {
        this.lastErrorMessageRu =
          'Браузер или окружение не поддерживают WebXR. Откройте приложение в Chrome, Edge или встроенном браузере VR-шлема.';
        return false;
      }

      // 1. Если сессия уже активна, корректно завершаем её
      if (this.isInVR || this.xrSession) {
        try {
          if (this.xrSession) {
            await this.xrSession.end();
          }
        } catch (e) {
          console.warn('Error ending previous active XR session:', e);
        } finally {
          this.detachXRSessionListeners();
          this.cleanupSessionState();
          this.updateVRButtonText();
        }
        return false;
      }

      // 2. Проверяем аппаратную поддержку immersive-vr до запроса сессии
      const supported = await (navigator.xr as XRSystem)
        .isSessionSupported('immersive-vr')
        .catch(() => false);
      this.isSupported = supported;
      if (!supported) {
        this.lastErrorMessageRu =
          'VR-гарнитура или OpenXR/SteamVR-рантайм не обнаружены. Подключите шлем и убедитесь, что VR-рантайм запущен.';
        return false;
      }

      // 3. Завершаем любую возможную зависшую сессию в Three.js WebGLRenderer
      const activeRendererSession = this.renderer.xr.getSession();
      if (activeRendererSession) {
        try {
          await activeRendererSession.end();
        } catch {
          // Игнорируем ошибку закрытия устаревшей сессии
        }
      }

      // 4. Включаем WebXR в рендерере до вызова requestSession
      this.renderer.xr.enabled = true;
      let session: XRSession | null = null;
      try {
        session = await (navigator.xr as XRSystem).requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
        });

        const resolvedSpace = await this.resolveReferenceSpaceWithFallback(session);
        this.playerGroup.position.y = resolvedSpace === 'local-floor' ? 0.0 : 1.65;

        this.xrSession = session;
        await this.renderer.xr.setSession(session);
        this.attachXRSessionListeners(session);
        this.updateVRButtonText();
        return true;
      } catch (sessionErr) {
        if (session) {
          try {
            await session.end();
          } catch {
            // Игнорируем ошибку принудительного закрытия незапущенной сессии
          }
        }
        throw sessionErr;
      }
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errName === 'NotAllowedError' || errName === 'SecurityError') {
        this.lastErrorMessageRu =
          'Доступ к WebXR отклонён браузером или политикой безопасности (требуется HTTPS или localhost).';
      } else if (errName === 'NotSupportedError') {
        this.lastErrorMessageRu =
          'Текущее устройство или драйвер OpenXR не поддерживает режим immersive-vr.';
      } else {
        this.lastErrorMessageRu = `Не удалось запустить VR-сессию: ${errMsg}`;
      }
      console.warn('VR session request failed:', err);
      this.detachXRSessionListeners();
      this.cleanupSessionState();
      this.updateVRButtonText();
      return false;
    } finally {
      this.isTogglingVR = false;
    }
  }

  /**
   * Полное освобождение слушателей, контроллеров и ресурсов WebXRManager при размонтировании сцены
   */
  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    const activeSession = this.xrSession ?? this.renderer.xr.getSession();
    if (activeSession) {
      try {
        void activeSession.end();
      } catch {
        // Игнорируем ошибку закрытия при dispose
      }
    }

    this.detachXRSessionListeners();
    this.renderer.xr.removeEventListener('sessionstart', this.onRendererSessionStart);
    this.renderer.xr.removeEventListener('sessionend', this.onRendererSessionEnd);

    for (const cleanup of this.cleanupCallbacks) {
      cleanup();
    }
    this.cleanupCallbacks.length = 0;

    this.cleanupSessionState();

    this.arcLine.parent?.remove(this.arcLine);
    this.arcLine.geometry.dispose();
    (this.arcLine.material as THREE.Material).dispose();

    this.targetRing.parent?.remove(this.targetRing);
    this.targetRing.geometry.dispose();
    (this.targetRing.material as THREE.Material).dispose();

    this.gazeReticle.parent?.remove(this.gazeReticle);
    this.gazeReticle.geometry.dispose();
    (this.gazeReticle.material as THREE.Material).dispose();

    if (this.laser0) {
      this.laser0.parent?.remove(this.laser0);
      this.laser0.geometry.dispose();
      (this.laser0.material as THREE.Material).dispose();
    }
    if (this.laser1) {
      this.laser1.parent?.remove(this.laser1);
      this.laser1.geometry.dispose();
      (this.laser1.material as THREE.Material).dispose();
    }

    this.wristDisplay?.dispose();
    if (this.vrButtonElement) {
      this.vrButtonElement.onclick = null;
      this.vrButtonElement.parentElement?.removeChild(this.vrButtonElement);
      this.vrButtonElement = null;
    }
  }
}
