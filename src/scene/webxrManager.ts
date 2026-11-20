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

  public update(
    doseRateMicroSv: number,
    cumulativeDoseMsv: number,
    taskTitle: string,
    isFlashlightOn?: boolean,
    hapticStrength?: number,
    isVoiceActive?: boolean,
    voiceVolume?: number,
    latestVoiceNote?: string,
    isHudVisible: boolean = true
  ): void {
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

    if (latestVoiceNote && latestVoiceNote.trim().length > 0) {
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
      `Фонарь [Y]: ${isFlashlightOn ? 'ВКЛ' : 'ВЫКЛ'} • PTT [X] • Вибро: ${hapPct}%`,
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

  // Контроллеры VR (0 = правый, 1 = левый) и их Grip-пространства
  public controller0: THREE.Group | null = null;
  public controller1: THREE.Group | null = null;
  public controllerGrip0: THREE.Group | null = null;
  public controllerGrip1: THREE.Group | null = null;

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
  private prevMenuButtonPressed = false;
  private prevViveGripButtonPressed = false;

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
    // (физическая высота гарнитуры отслеживается встроенным трекингом local-floor)
    this.playerGroup.position.y = 0.0;

    // 2. Конфигурация WebXR-подсистемы рендерера
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    // 3. Обработчики жизненного цикла XR-сессии
    this.renderer.xr.addEventListener('sessionstart', () => {
      this.isInVR = true;
      this.xrSession = this.renderer.xr.getSession();

      // Сброс Y-координаты группы игрока под аппаратный уровень пола гарнитуры
      this.playerGroup.position.y = 0.0;

      if (this.rightHandRig) this.rightHandRig.rootGroup.visible = true;
      if (this.leftHandRig) this.leftHandRig.rootGroup.visible = true;

      this.updateVRButtonText();
      this.callbacks.onSessionStart?.();
    });

    this.renderer.xr.addEventListener('sessionend', () => {
      this.cleanupSessionState();
      this.updateVRButtonText();
      this.callbacks.onSessionEnd?.();
    });

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

    this.checkXRSupport();
    this.setupControllersInPlayerGroup();
  }

  /**
   * Полная очистка состояний при завершении XR-сессии (sessionend):
   * скрытие дуги телепортации, отключение моделей рук и сброс флагов активности
   */
  private cleanupSessionState(): void {
    this.isInVR = false;
    this.xrSession = null;
    this.isTeleportActive = false;
    this.isMovementFrozen = false;
    this.snapLocked = false;
    this.snapCooldown = 0;
    this.prevLeftPrimaryPressed = false;
    this.prevRightPrimaryPressed = false;
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

  /**
   * Инициализация контроллеров, их хватов (ControllerGrip) и моделей рук (HazmatHandRig)
   * СТРОГО внутри единой родительской группы игрока (this.playerGroup) для предотвращения дрифта
   */
  private setupControllersInPlayerGroup(): void {
    // =========================================================
    // 1. Контроллер 0 (Правая рука) — внутри this.playerGroup
    // =========================================================
    const c0 = this.renderer.xr.getController(0);
    this.controller0 = c0;

    c0.addEventListener('selectstart', () => {
      if (this.vrUiSystem && this.checkAndTriggerVRUIClick(c0)) {
        this.draggingUiControllerIdx = 0;
        return;
      }
      this.callbacks.onSelectStart?.(c0, 0);
    });

    c0.addEventListener('selectend', () => {
      if (this.draggingUiControllerIdx === 0) {
        this.draggingUiControllerIdx = null;
      }
      this.callbacks.onSelectEnd?.(c0, 0);
    });

    c0.addEventListener('squeezestart', () => {
      const grabbed = this.callbacks.onSqueezeStart?.(c0, 0);
      if (grabbed) {
        this.isSqueezeGrabActive = true;
        this.isTeleportActive = false;
      } else {
        this.isTeleportActive = true;
      }
    });

    c0.addEventListener('squeezeend', () => {
      this.callbacks.onSqueezeEnd?.(c0, 0);
      this.isSqueezeGrabActive = false;
      if (this.isTeleportActive && this.targetRing.visible) {
        this.callbacks.onTeleportTrigger?.(this.targetRing.position);
      }
      this.isTeleportActive = false;
      this.arcLine.visible = false;
      this.targetRing.visible = false;
    });

    // СТРОГОе добавление контроллера 0 в playerGroup (No Drift Architecture)
    this.playerGroup.add(c0);

    // Хват 0 (getControllerGrip(0)) и правая рука с дозиметром в ладони — внутри this.playerGroup
    const grip0 = this.renderer.xr.getControllerGrip(0);
    this.controllerGrip0 = grip0;
    this.playerGroup.add(grip0);

    // Правая анатомическая кисть с дозиметром внутри ладони (Palmar Grip Pose: curl ≈ 0.42):
    this.rightHandRig = new RealisticHumanHandRig({ handedness: 'right', withRadiometer: true });
    this.rightHandRig.rootGroup.position.set(0, 0, 0);
    this.rightHandRig.rootGroup.quaternion.identity();
    this.rightHandRig.handGroup.position.copy(RealisticHumanHandRig.VR_WRIST_OFFSET_POS);
    this.rightHandRig.handGroup.rotation.copy(RealisticHumanHandRig.VR_WRIST_OFFSET_ROT);
    this.rightHandRig.rootGroup.visible = false;
    this.playerGroup.add(this.rightHandRig.rootGroup);

    // =========================================================
    // 2. Контроллер 1 (Левая рука) — внутри this.playerGroup
    //    Свободная симметричная левая кисть БЕЗ прибора по умолчанию
    // =========================================================
    const c1 = this.renderer.xr.getController(1);
    this.controller1 = c1;

    c1.addEventListener('selectstart', () => {
      if (this.vrUiSystem && this.checkAndTriggerVRUIClick(c1)) {
        this.draggingUiControllerIdx = 1;
        return;
      }
      this.callbacks.onSelectStart?.(c1, 1);
    });

    c1.addEventListener('selectend', () => {
      if (this.draggingUiControllerIdx === 1) {
        this.draggingUiControllerIdx = null;
      }
      this.callbacks.onSelectEnd?.(c1, 1);
    });

    c1.addEventListener('squeezestart', () => {
      // Захват мелких деталей и инструментов левой рукой по кнопке Grip / Squeeze
      const grabbed = this.callbacks.onSqueezeStart?.(c1, 1);
      if (grabbed) {
        this.isSqueezeGrabActive = true;
        this.isTeleportActive = false;
      } else {
        this.isTeleportActive = true;
      }
    });

    c1.addEventListener('squeezeend', () => {
      this.callbacks.onSqueezeEnd?.(c1, 1);
      this.isSqueezeGrabActive = false;
      if (this.isTeleportActive && this.targetRing.visible) {
        this.callbacks.onTeleportTrigger?.(this.targetRing.position);
      }
      this.isTeleportActive = false;
      this.arcLine.visible = false;
      this.targetRing.visible = false;
    });

    // СТРОГОе добавление контроллера 1 в playerGroup (No Drift Architecture)
    this.playerGroup.add(c1);

    // Хват 1 (getControllerGrip(1)) и симметричная левая кисть с жестко интегрированным VRFlashlight — внутри this.playerGroup
    const grip1 = this.renderer.xr.getControllerGrip(1);
    this.controllerGrip1 = grip1;
    this.playerGroup.add(grip1);

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

    // =========================================================
    // 3. Отключение длинных «лазерных палок» по умолчанию:
    //    Короткая указка скрыта (visible = false) и включается ТОЛЬКО при наведении на плавающие UI-панели
    // =========================================================
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
    this.laser0.visible = false; // По умолчанию полностью скрыта!
    c0.add(this.laser0);

    const laserMat1 = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75
    });
    this.laser1 = new THREE.Line(shortPointerGeo.clone(), laserMat1);
    this.laser1.name = 'short_ui_pointer';
    this.laser1.visible = false; // По умолчанию полностью скрыта!
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
    btn.style.backgroundColor = 'rgba(8, 13, 24, 0.78)';
    btn.style.border = '1px solid rgba(255, 255, 255, 0.14)';
    btn.style.borderRadius = '10px';
    btn.style.padding = '7px 12px';
    btn.style.fontSize = '11px';
    btn.style.color = '#fef08a';
    btn.style.fontWeight = '600';
    btn.style.letterSpacing = '0.03em';
    btn.style.cursor = 'pointer';
    btn.style.backdropFilter = 'blur(10px)';
    btn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.45)';
    btn.style.transition = 'all 0.2s ease';
    btn.textContent = 'VR (SteamVR / WebXR)';

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
      target.textContent = this.isInVR
        ? 'ВЫЙТИ ИЗ VR'
        : 'ВОЙТИ В VR (STEAMVR / HTC VIVE)';
      target.style.borderColor = this.isInVR
        ? 'rgba(239, 68, 68, 0.8)'
        : 'rgba(234, 179, 8, 0.8)';
      target.style.color = this.isInVR ? '#fca5a5' : '#fef08a';
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

    const sources = this.xrSession.inputSources;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (src.handedness === hand && src.gamepad) {
        const gp = src.gamepad;

        // Чтение осей стика (Quest/Touch используeт axes[2..3], Vive/WMR может использовать axes[0..1])
        let rawX = 0;
        let rawY = 0;
        if (
          gp.axes.length >= 4 &&
          (Math.abs(gp.axes[2]) > Math.abs(gp.axes[0]) || Math.abs(gp.axes[3]) > Math.abs(gp.axes[1]))
        ) {
          rawX = gp.axes[2];
          rawY = gp.axes[3];
        } else if (gp.axes.length >= 2) {
          rawX = gp.axes[0];
          rawY = gp.axes[1];
        }

        const normX = this.applyDeadzone(rawX, this.deadzone);
        const normY = this.applyDeadzone(rawY, this.deadzone);

        if (hand === 'left') {
          target.moveX = normX;
          target.moveY = normY;
        } else {
          target.turnX = normX;
          target.turnY = normY;
        }

        if (gp.buttons.length > 0 && gp.buttons[0]) {
          target.trigger = gp.buttons[0].value ?? (gp.buttons[0].pressed ? 1.0 : 0.0);
        }
        if (gp.buttons.length > 1 && gp.buttons[1]) {
          target.grip = gp.buttons[1].value ?? (gp.buttons[1].pressed ? 1.0 : 0.0);
          target.squeezePressed = gp.buttons[1].pressed || target.grip > 0.6;
        }
        if (gp.buttons.length > 3 && gp.buttons[3]) {
          target.thumbstickPressed = gp.buttons[3].pressed;
        }
        if (gp.buttons.length > 4 && gp.buttons[4]) {
          target.primaryPressed = gp.buttons[4].pressed;
        }
        if (gp.buttons.length > 5 && gp.buttons[5]) {
          target.secondaryPressed = gp.buttons[5].pressed;
        }

        break;
      }
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

  /**
   * Синхронный 1:1 трекинг ориентации и позиции виртуальных кистей с физическими контроллерами WebXR
   * (Direct Wrist Orientation Mapping):
   * - Кватернион виртуальной кисти (rootGroup.quaternion) 1:1 повторяет физический кватернион контроллера
   *   без каких-либо сглаживаний (slerp/lerp) и искусственных ограничений по Pitch, Roll, Yaw.
   */
  private syncWristOrientation1To1(): void {
    if (this.rightHandRig && this.controller0) {
      const hasCtrlPose0 =
        this.controller0.position.lengthSq() > 1e-6 ||
        Math.abs(this.controller0.quaternion.w - 1) > 1e-6;
      const posSource0 =
        hasCtrlPose0 || !this.controllerGrip0 ? this.controller0.position : this.controllerGrip0.position;
      const quatSource0 =
        hasCtrlPose0 || !this.controllerGrip0
          ? this.controller0.quaternion
          : this.controllerGrip0.quaternion;

      this.rightHandRig.syncDirectWristPose(posSource0, quatSource0);
    }

    if (this.leftHandRig && this.controller1) {
      const hasCtrlPose1 =
        this.controller1.position.lengthSq() > 1e-6 ||
        Math.abs(this.controller1.quaternion.w - 1) > 1e-6;
      const posSource1 =
        hasCtrlPose1 || !this.controllerGrip1 ? this.controller1.position : this.controllerGrip1.position;
      const quatSource1 =
        hasCtrlPose1 || !this.controllerGrip1
          ? this.controller1.quaternion
          : this.controllerGrip1.quaternion;

      this.leftHandRig.syncDirectWristPose(posSource1, quatSource1);
    }
  }

  /**
   * Главный цикл обновления XR (Zero Allocation):
   * - Smooth Locomotion по XZ-проекции взгляда камеры (только playerGroup.position.x / .z)
   * - Snap / Smooth Turn (только playerGroup.rotation.y)
   * - Синхронный 1:1 трекинг поворота кистей (Direct Wrist Orientation Mapping) и сгиба пальцев
   * - Лазерный рейкастинг UI и параболическая телепортация от мировых координат контроллера
   */
  public update(dt: number, camera: THREE.Camera): void {
    if (!this.isInVR) {
      this.isMoving = false;
      return;
    }

    const leftInput = this.getControllerInput('left');
    const rightInput = this.getControllerInput('right');
    this.isMoving = Math.abs(leftInput.moveX) > 0.05 || Math.abs(leftInput.moveY) > 0.05;

    // 0. Опрос физического геймпада через VRInputManager (Edge Detection / Debounce + Haptics):
    // - Правый контроллер:
    //   • Правый Грип: физический хват радиометра-дозиметра в ладони правой руки (Grip Pose)
    //   • Правый Стик (X-axis): поворот Snap (шаг 30°) / Smooth Turn (deadzone 0.15)
    //   • Нажатие на правый стик (Thumbstick Press): сброс/калибровка высоты и центра пространства playerGroup
    //   • Кнопка A (Press): переключение плавающего окна аналитики D(t) и H(t) (AnalyticsOverlay.toggle())
    //   • Кнопка B (Press): переключение частиц визуализации радиационного фона (RadiationBackgroundField.toggle())
    // - Левый контроллер:
    //   • Левый Триггер (0.0 -> 1.0): плавный динамический сгиб пальцев левой кисти
    //   • Левый Стик (X/Y axes): плавное перемещение Smooth Locomotion по плоскости XZ (deadzone 0.15)
    //   • Кнопка X (Push-to-Talk Hold): удержание микрофона VoiceTaskLogger.startListening() / stopListening()
    //   • Кнопка Y (Press): включение / выключение тактического фонаря VRFlashlight.toggle() с pulse(0.4, 40)
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
        this.controller0,
        this.controller1,
        this.isMovementFrozen
      );
    }

    // Обновление 3D-индикатора микрофона и амплитуды голоса на левой руке
    this.voiceTaskLogger?.update(dt);

    // 3. Абсолютный 1:1 трекинг поворота кистей (Pitch, Roll, Yaw) и сгибание пальцев
    this.syncWristOrientation1To1();

    if (this.leftHandRig) {
      const leftCurl = Math.max(leftInput.trigger, this.isSqueezeGrabActive ? leftInput.grip * 0.78 : 0);
      this.leftHandRig.setFingerCurl(leftCurl);
      this.leftHandRig.update(dt, true);
    }
    if (this.rightHandRig) {
      if (!this.vrInputManager?.isRightGripHoldingRadiometer) {
        this.rightHandRig.setFingerCurl(rightInput.trigger);
      }
      this.rightHandRig.update(dt, true);
    }

    // 3.5. Управление видимостью 3D VR HUD (HTC Vive Button Toggle):
    // Нажатие кнопки Menu (buttons[3]/[4]) или Grip (buttons[1]) на HTC Vive контроллере переключает видимость VR HUD
    if (this.xrSession && this.vrUiSystem) {
      let menuNowPressed = false;
      let viveGripNowPressed = false;

      for (let i = 0; i < this.xrSession.inputSources.length; i++) {
        const src = this.xrSession.inputSources[i];
        if (!src.gamepad) continue;

        const isViveProfile = Boolean(
          src.profiles?.some(p => {
            const low = p.toLowerCase();
            return low.includes('vive') || low.includes('wand') || low.includes('generic-trigger-squeeze-touchpad');
          })
        );

        // Кнопка Menu (buttons[3] или buttons[4] стандарта WebXR / HTC Vive / SteamVR)
        const hasMenu = Boolean(
          (src.gamepad.buttons.length > 3 && src.gamepad.buttons[3]?.pressed) ||
          (src.gamepad.buttons.length > 4 && src.gamepad.buttons[4]?.pressed)
        );
        if (hasMenu) {
          menuNowPressed = true;
        }

        // Кнопка Grip (buttons[1]) на HTC Vive контроллере
        if (isViveProfile && src.gamepad.buttons.length > 1 && src.gamepad.buttons[1]?.pressed) {
          viveGripNowPressed = true;
        }
      }

      const justPressedMenu = menuNowPressed && !this.prevMenuButtonPressed;
      const justPressedViveGrip = viveGripNowPressed && !this.prevViveGripButtonPressed;

      if (justPressedMenu || justPressedViveGrip) {
        const nextVisible = this.vrUiSystem.toggleHudVisibility();
        this.callbacks.onToggleHudVisibility?.(nextVisible);
        for (const src of this.xrSession.inputSources) {
          if (src.gamepad) {
            this.pulseGamepadActuator(src.gamepad, 0.35, 40);
          }
        }
      }

      this.prevMenuButtonPressed = menuNowPressed;
      this.prevViveGripButtonPressed = viveGripNowPressed;
    }

    // 4. Рейкастинг VR UI: короткая указка включается ИСКЛЮЧИТЕЛЬНО при наведении на UI-панели
    if (this.vrUiSystem) {
      let uiHit0 = false;
      if (this.controller0) {
        uiHit0 = this.updateUIRaycast(this.controller0, this.laser0);
      }
      if (this.controller1) {
        if (!uiHit0) {
          this.updateUIRaycast(this.controller1, this.laser1);
        } else if (this.laser1) {
          this.laser1.visible = false;
        }
      }

      // Плавное перетаскивание ползунка виброотклика (Haptic Strength Slider) при удержании курка
      if (this.draggingUiControllerIdx !== null) {
        const dragCtrl = this.draggingUiControllerIdx === 0 ? this.controller0 : this.controller1;
        const isTriggerHeld =
          this.draggingUiControllerIdx === 0 ? rightInput.trigger > 0.35 : leftInput.trigger > 0.35;
        if (dragCtrl && isTriggerHeld) {
          this.getControllerWorldRay(dragCtrl, this.controllerWorldPos, this.controllerWorldDir);
          this.raycaster.set(this.controllerWorldPos, this.controllerWorldDir);
          this.vrUiSystem.triggerSliderDrag(this.raycaster);
        } else if (!isTriggerHeld) {
          this.draggingUiControllerIdx = null;
        }
      }
    }

    // 5. Параболическая телепортация от мировых координат контроллера (блокируется при заморозке в состоянии Game Over)
    if (
      !this.isMovementFrozen &&
      !this.isSqueezeGrabActive &&
      (leftInput.squeezePressed || rightInput.squeezePressed)
    ) {
      const activeCtrl = rightInput.squeezePressed ? this.controller0 : this.controller1;
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
    hapticStrength?: number
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
        this.vrUiSystem?.isHudVisible ?? true
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
    const sources = this.xrSession.inputSources;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (src.gamepad) {
        this.pulseGamepadActuator(src.gamepad, warnIntensity, 95);
      }
    }
  }

  /**
   * Короткий тестовый импульс при перетаскивании ползунка силы виброотклика в VR HUD
   */
  public triggerHapticPreviewPulse(strength: number): void {
    this.hapticStrength = THREE.MathUtils.clamp(strength, 0, 1);
    if (!this.isInVR || !this.xrSession || this.hapticStrength <= 0.01) return;

    const previewIntensity = Math.max(0.08, this.hapticStrength * 0.75);
    const sources = this.xrSession.inputSources;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (src.gamepad) {
        this.pulseGamepadActuator(src.gamepad, previewIntensity, 45);
      }
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

    const sources = this.xrSession.inputSources;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (!src.gamepad) continue;

      // Дифференциация отдачи по рукам при манипуляции с высокоактивным источником:
      // Рука, удерживающая источник или зонд радиометра, получает 100% расчетной амплитуды, вторая рука — 80%
      let handMultiplier = 1.0;
      if (isHoldingHighActivitySource && holdingControllerIndex !== null) {
        const isHoldingHand =
          (holdingControllerIndex === 0 && src.handedness === 'right') ||
          (holdingControllerIndex === 1 && src.handedness === 'left');
        handMultiplier = isHoldingHand ? 1.0 : 0.78;
      } else if (src.handedness === 'left') {
        handMultiplier = 0.85;
      }

      this.pulseGamepadActuator(src.gamepad, params.intensity * handMultiplier, params.durationMs);
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
   * Безопасное переключение XR-сессии с каскадным Reference Space fallback ('local-floor' -> 'local' -> 'viewer')
   * и гарантированным завершением предыдущей активной сессии для устранения InvalidStateError.
   */
  public async toggleVRSession(): Promise<boolean> {
    if (this.isTogglingVR) return false;
    this.isTogglingVR = true;

    try {
      if (typeof navigator === 'undefined' || !('xr' in navigator) || !navigator.xr) {
        return false;
      }

      // 1. Если сессия уже активна, обязательно корректно завершаем её
      if (this.isInVR || this.xrSession) {
        try {
          if (this.xrSession) {
            await this.xrSession.end();
          }
        } catch (e) {
          console.warn('Error ending previous active XR session:', e);
        } finally {
          this.cleanupSessionState();
          this.updateVRButtonText();
        }
        return false;
      }

      // 2. Завершаем любую возможную зависшую сессию в Three.js WebGLRenderer
      const activeRendererSession = this.renderer.xr.getSession();
      if (activeRendererSession) {
        try {
          await activeRendererSession.end();
        } catch {}
      }

      // 3. КРИТИЧЕСКОЕ ТРЕБОВАНИЕ WEBXR: флаг renderer.xr.enabled = true должен быть включен до вызова requestSession
      this.renderer.xr.enabled = true;
      const session = await (navigator.xr as XRSystem).requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
      });

      // Каскадный выбор доступной системы координат: 'local-floor' -> 'local' -> 'viewer'
      const resolvedSpace = await this.resolveReferenceSpaceWithFallback(session);

      // Если гарнитура (например, старый профиль SteamVR) вернула 'local' или 'viewer' без уровня пола,
      // компенсируем базовую высоту глаз; для 'local-floor' высота строго 0.0
      this.playerGroup.position.y = resolvedSpace === 'local-floor' ? 0.0 : 1.65;

      this.xrSession = session;
      await this.renderer.xr.setSession(session);
      this.updateVRButtonText();
      return true;
    } catch (err) {
      console.warn('VR session request failed:', err);
      this.cleanupSessionState();
      this.updateVRButtonText();
      return false;
    } finally {
      this.isTogglingVR = false;
    }
  }
}
