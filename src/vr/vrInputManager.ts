/**
 * ALARA-Planner Pro — Модуль управления VR-вводом (VRInputManager) и тактического фонарика (VRFlashlight)
 *
 * Строгое распределение физических кнопок WebXR Gamepad API (Meta Quest 2/3/Pro, Pico 4, Valve Index, HTC Vive):
 *
 * 1. ПРАВЫЙ КОНТРОЛЛЕР (Дозиметрическая рука — handedness === 'right'):
 *    - Правый Триггер (select / Trigger, buttons[0]):
 *      • Нажатие (justPressed): Взаимодействие с UI-элементами (кнопки на дозиметре, «Экспорт CSV», кнопки окон аналитики).
 *      • Удерживание (isHeld): Активное направление луча взаимодействия (Raycaster) на плавающие панели VR HUD.
 *    - Правый Грип (squeeze / Grip, buttons[1]):
 *      • Удерживание (isHeld): Физический хват радиометра-дозиметра в ладони правой руки (перевод пальцев в позу Grip Pose).
 *      • Отпускание (justReleased): Возврат радиометра в дефолтную позицию хватов.
 *    - Правый Стик (thumbstick, axes[2], buttons[3]):
 *      • Отклонение влево/вправо (X-axis): Дискретный или плавный поворот камеры игрока (Snap/Smooth Turn, шаг 30° = π/6, deadzone 0.15).
 *      • Нажатие на стик (Thumbstick Press, buttons[3]): Сброс / Калибровка высоты и центра пространственного пространства playerGroup.
 *    - Кнопка A (Press, buttons[4]):
 *      • Включение / выключение плавающего окна аналитики с графиками D(t) и H(t) (AnalyticsOverlay.toggle()).
 *    - Кнопка B (Press, buttons[5]):
 *      • Включение / выключение частиц визуализации радиационного фона (RadiationBackgroundField.toggle()).
 *
 * 2. ЛЕВЫЙ КОНТРОЛЛЕР (Свободная рука / Фонарик — handedness === 'left'):
 *    - Левый Триггер (select / Trigger, buttons[0]):
 *      • Плавное нажатие (0.0 -> 1.0): Динамический сгиб пальцев левой анатомической кисти для естественных манипуляций и захвата мелких предметов.
 *    - Левый Грип (squeeze / Grip, buttons[1]):
 *      • Удерживание: Хват переносных защитных экранов, свинцовых кирпичей, инструментов или выносного блока.
 *    - Левый Стик (thumbstick, axes[2], axes[3]):
 *      • Отклонение в любые стороны (X/Y axes): Плавное перемещение игрока (Smooth Locomotion) по плоскости XZ с учетом направления взгляда VR-гарнитуры (deadzone 0.15).
 *    - Кнопка X (Push-to-Talk Hold, buttons[4]):
 *      • Удерживание (justPressed / isHeld): Активация микрофона для голосовой надиктовки заметок и выполнения голосовых команд (VoiceTaskLogger.startListening()).
 *      • Отпускание (justReleased): Завершение записи фразы (VoiceTaskLogger.stopListening()).
 *    - Кнопка Y (Press, buttons[5]):
 *      • Включение / выключение VR-фонарика (VRFlashlight.toggle()) с тактильным откликом pulse(0.4, 40).
 */

import * as THREE from 'three';
import { VRFlashlight } from '../scene/handModel';

export { VRFlashlight };

/**
 * Вспомогательная функция подачи тактильного импульса на геймпад WebXR
 */
export function pulseWebXRGamepad(gamepad: Gamepad, intensity: number, durationMs: number): void {
  const clampedIntensity = THREE.MathUtils.clamp(intensity, 0, 1);
  if (clampedIntensity <= 0.01) return;

  const anyGamepad = gamepad as unknown as {
    hapticActuators?: Array<{
      pulse?: (value: number, duration: number) => Promise<boolean> | void;
    }>;
    haptics?: Array<{
      pulse?: (value: number, duration: number) => Promise<boolean> | void;
    }>;
    vibrationActuator?: {
      playEffect?: (
        type: string,
        params: { duration: number; strongMagnitude: number; weakMagnitude: number }
      ) => Promise<void> | void;
    };
  };

  try {
    if (anyGamepad.haptics && anyGamepad.haptics.length > 0 && anyGamepad.haptics[0]?.pulse) {
      anyGamepad.haptics[0].pulse(clampedIntensity, durationMs);
      return;
    }
    if (
      anyGamepad.hapticActuators &&
      anyGamepad.hapticActuators.length > 0 &&
      anyGamepad.hapticActuators[0]?.pulse
    ) {
      anyGamepad.hapticActuators[0].pulse(clampedIntensity, durationMs);
      return;
    }
    if (anyGamepad.vibrationActuator?.playEffect) {
      anyGamepad.vibrationActuator.playEffect('dual-rumble', {
        duration: durationMs,
        strongMagnitude: clampedIntensity,
        weakMagnitude: clampedIntensity * 0.75
      });
    }
  } catch {
    // Игнорируем аппаратные исключения неподдерживаемых контроллеров
  }
}

/**
 * Состояние отдельной кнопки геймпада с детектором фронтов (Edge Detection / Debounce)
 */
export interface VRButtonEdgeState {
  /** Текущее булево состояние нажатия */
  isHeld: boolean;
  /** Флаг переднего фронта: срабатывает ровно 1 кадр в момент нажатия */
  justPressed: boolean;
  /** Флаг заднего фронта: срабатывает ровно 1 кадр в момент отпускания */
  justReleased: boolean;
  /** Аналоговое значение нажатия (0.0 .. 1.0) */
  value: number;
}

/**
 * Полный снимок состояния одного контроллера (левого или правого) за текущий кадр
 */
export interface VRControllerFrameState {
  handedness: 'left' | 'right';
  connected: boolean;
  gamepad: Gamepad | null;
  /** Стик по оси X с примененным deadzone 0.15 (-1.0 .. 1.0) */
  stickX: number;
  /** Стик по оси Y с примененным deadzone 0.15 (-1.0 .. 1.0) */
  stickY: number;
  /** Сырые координаты стика до фильтрации */
  rawStickX: number;
  rawStickY: number;
  /** buttons[0] — Trigger / Select */
  trigger: VRButtonEdgeState;
  /** buttons[1] — Squeeze / Grip */
  grip: VRButtonEdgeState;
  /** buttons[3] — Thumbstick Press (нажатие на стик) */
  thumbstickPress: VRButtonEdgeState;
  /** buttons[4] — Primary Button (Кнопка A на правом / Кнопка X на левом) */
  buttonAOrX: VRButtonEdgeState;
  /** buttons[5] — Secondary Button (Кнопка B на правом / Кнопка Y на левом) */
  buttonBOrY: VRButtonEdgeState;
}

/**
 * Профиль дифференцированного тактильного отклика (HapticActuators)
 */
export type VRHapticProfile =
  | 'ui_click'        // Легкий импульс (0.2, 30 мс) при клике по UI-кнопкам
  | 'flashlight'      // Тактильный щелчок (0.4, 40 мс) при переключении фонарика (Кнопка Y / голос)
  | 'mode_toggle'     // Средний импульс (0.45, 45 мс) при переключении режимов (Кнопки A, B, калибровка)
  | 'grab_object'     // Средний импульс (0.5, 50 мс) при схвате предметов или радиометра
  | 'ptt_start'       // Старт Push-to-Talk (0.3, 50 мс)
  | 'ptt_stop'        // Завершение Push-to-Talk (0.3, 50 мс)
  | 'danger_alarm';   // Сильная пульсация (0.9, 120 мс) при входе в опасную радиационную зону / тревоге

/**
 * Интерфейсы внешних систем симулятора для прямой интеграции с VRInputManager
 */
export interface IAnalyticsOverlayController {
  toggle: () => boolean | void;
}

export interface IRadiationBackgroundFieldController {
  toggle: () => boolean | void;
}

export interface IVoiceTaskLoggerController {
  startListening: (gamepad?: Gamepad | null) => void;
  stopListening: (gamepad?: Gamepad | null) => void;
}

/**
 * Колбэки и привязки действий VRInputManager
 */
export interface VRInputManagerCallbacks {
  /** Правый триггер (justPressed): клик по виртуальным кнопкам дозиметра, «Экспорт CSV», окнам аналитики */
  onRightTriggerUiClick?: (raycaster: THREE.Raycaster, controller: THREE.Group) => boolean;
  /** Правый триггер (isHeld): удержание луча взаимодействия на плавающих панелях (например, слайдеры) */
  onRightTriggerUiHold?: (raycaster: THREE.Raycaster, controller: THREE.Group) => void;
  /** Правый триггер (justReleased): завершение взаимодействия с UI */
  onRightTriggerUiRelease?: (controller: THREE.Group) => void;
  /** Правый грип (удержание / отпускание): физический хват радиометра-дозиметра в правой ладони */
  onRightGripInstrumentStateChange?: (isGrippingRadiometer: boolean, gripValue: number) => void;
  /** Правый стик (Thumbstick Press): сброс / калибровка высоты и центра пространства playerGroup */
  onCalibratePlayerSpace?: () => void;
  /** Кнопка A (правый контроллер): переключение окна аналитики D(t) и H(t) */
  analyticsOverlay?: IAnalyticsOverlayController;
  /** Кнопка B (правый контроллер): переключение частиц визуализации радиационного фона */
  radiationBackgroundField?: IRadiationBackgroundFieldController;
  /** Левый триггер (0.0 -> 1.0): динамический сгиб пальцев левой кисти */
  onLeftTriggerFingerCurl?: (triggerValue: number, gripValue: number) => void;
  /** Левый грип (justPressed): хват переносных защитных экранов, свинцовых кирпичей, инструментов */
  onLeftGripGrabStart?: (controller: THREE.Group) => boolean | void;
  /** Левый грип (justReleased): отпускание захваченного предмета левой рукой */
  onLeftGripGrabEnd?: (controller: THREE.Group) => void;
  /** Кнопка X (удержание / отпускание): голосовая надиктовка и команды VoiceTaskLogger */
  voiceTaskLogger?: IVoiceTaskLoggerController;
  /** Уведомление об изменении статуса Push-to-Talk (Кнопка X) */
  onPushToTalkStateChange?: (isListening: boolean) => void;
  /** Уведомление о переключении фонарика (Кнопка Y) */
  onFlashlightToggled?: (isOn: boolean) => void;
}

/**
 * Создает пустое состояние кнопки с детектором фронтов
 */
function createEmptyButtonEdgeState(): VRButtonEdgeState {
  return {
    isHeld: false,
    justPressed: false,
    justReleased: false,
    value: 0
  };
}

/**
 * Создает пустое состояние контроллера на кадр
 */
function createEmptyControllerFrameState(handedness: 'left' | 'right'): VRControllerFrameState {
  return {
    handedness,
    connected: false,
    gamepad: null,
    stickX: 0,
    stickY: 0,
    rawStickX: 0,
    rawStickY: 0,
    trigger: createEmptyButtonEdgeState(),
    grip: createEmptyButtonEdgeState(),
    thumbstickPress: createEmptyButtonEdgeState(),
    buttonAOrX: createEmptyButtonEdgeState(),
    buttonBOrY: createEmptyButtonEdgeState()
  };
}

/**
 * Модуль управления VR-вводом (VRInputManager)
 * Обеспечивает опрос xrSession.inputSources и XRInputSource.gamepad в renderer.setAnimationLoop,
 * детекцию фронтов нажатия (Debounce / Edge Detection), локомоцию, повороты, управление позами кистей,
 * тактильный отклик HapticActuators и диспетчеризацию физических кнопок обоих контроллеров.
 */
export class VRInputManager {
  public readonly playerGroup: THREE.Group;
  public readonly flashlight: VRFlashlight;
  private callbacks: VRInputManagerCallbacks;

  /** Мертвая зона стиков для фильтрации микро-дрейфа потенциометров (по ТЗ: 0.15) */
  public deadzone = 0.15;

  /** Скорость плавного перемещения Smooth Locomotion левым стиком (м/с) */
  public moveSpeed = 1.85;

  /** Режим поворота правым стиком: дискретный ('snap', шаг 30°) или плавный ('smooth') */
  public turnMode: 'snap' | 'smooth' = 'snap';

  /** Шаг дискретного поворота правым стиком: 30° (Math.PI / 6) */
  public snapTurnAngleRad = THREE.MathUtils.degToRad(30);

  /** Скорость плавного поворота правым стиком (рад/с) */
  public smoothTurnSpeedRad = 2.1;

  /** Защелка для одиночного срабатывания Snap Turn при отклонении правого стика */
  private snapTurnLocked = false;
  private snapCooldownSec = 0;

  /** Флаг удержания радиометра-дозиметра в правой руке (Правый Грип) */
  public isRightGripHoldingRadiometer = false;

  /** Флаг удержания предмета в левой руке (Левый Грип) */
  public isLeftGripHoldingObject = false;

  /** Флаг активной записи голоса Push-to-Talk (Кнопка X на левом контроллере) */
  public isLeftPushToTalkActive = false;

  /** Состояния левого и правого контроллеров с детекцией фронтов */
  public readonly leftState: VRControllerFrameState = createEmptyControllerFrameState('left');
  public readonly rightState: VRControllerFrameState = createEmptyControllerFrameState('right');

  /** Zero-Allocation векторные буферы для расчета Smooth Locomotion и Raycaster */
  private readonly tempCameraForward = new THREE.Vector3();
  private readonly tempCameraRight = new THREE.Vector3();
  private readonly tempLocomotionDelta = new THREE.Vector3();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private readonly rightRaycaster = new THREE.Raycaster();
  private readonly tempControllerWorldPos = new THREE.Vector3();
  private readonly tempControllerWorldDir = new THREE.Vector3();
  private readonly tempControllerQuat = new THREE.Quaternion();

  /** Троттлинг тревожной пульсации дозиметра */
  private lastDangerPulseTimeMs = 0;

  constructor(
    playerGroup: THREE.Group,
    flashlight: VRFlashlight,
    callbacks: VRInputManagerCallbacks = {}
  ) {
    this.playerGroup = playerGroup;
    this.flashlight = flashlight;
    this.callbacks = callbacks;

    // Привязываем тактильный отклик фонарика (pulse(0.4, 40)) к левому контроллеру
    this.flashlight.setHapticPulseCallback((intensity, durationMs) => {
      this.pulseController('left', intensity, durationMs);
    });
  }

  /**
   * Обновление колбэков и привязок внешних систем (VoiceTaskLogger, AnalyticsOverlay, RadiationBackgroundField)
   */
  public setCallbacks(callbacks: Partial<VRInputManagerCallbacks>): void {
    this.callbacks = {
      ...this.callbacks,
      ...callbacks
    };
  }

  /**
   * Фильтрация мертвой зоны стика (deadzone = 0.15) с плавной перенормализацией диапазона [deadzone..1] -> [0..1]
   */
  public applyDeadzone(rawAxisValue: number): number {
    if (!Number.isFinite(rawAxisValue)) return 0;
    const absVal = Math.abs(rawAxisValue);
    if (absVal < this.deadzone) return 0;
    const normalized = (absVal - this.deadzone) / (1.0 - this.deadzone);
    return Math.sign(rawAxisValue) * THREE.MathUtils.clamp(normalized, 0, 1);
  }

  /**
   * Обновление состояния одной кнопки с вычислением justPressed и justReleased (Edge Detection)
   */
  private updateButtonEdge(
    edgeState: VRButtonEdgeState,
    button: GamepadButton | undefined,
    threshold = 0.5
  ): void {
    const rawValue = button ? button.value : 0;
    const isNowHeld = Boolean(button && (button.pressed || rawValue >= threshold));

    edgeState.justPressed = isNowHeld && !edgeState.isHeld;
    edgeState.justReleased = !isNowHeld && edgeState.isHeld;
    edgeState.isHeld = isNowHeld;
    edgeState.value = THREE.MathUtils.clamp(rawValue, 0, 1);
  }

  /**
   * Сброс состояния контроллера при отключении или выходе из VR-сессии
   */
  private resetControllerState(state: VRControllerFrameState): void {
    state.connected = false;
    state.gamepad = null;
    state.stickX = 0;
    state.stickY = 0;
    state.rawStickX = 0;
    state.rawStickY = 0;
    this.updateButtonEdge(state.trigger, undefined);
    this.updateButtonEdge(state.grip, undefined);
    this.updateButtonEdge(state.thumbstickPress, undefined);
    this.updateButtonEdge(state.buttonAOrX, undefined);
    this.updateButtonEdge(state.buttonBOrY, undefined);
  }

  /**
   * Чтение осей стика и кнопок из WebXR Gamepad (стандартный маппинг xr-standard)
   */
  private pollGamepadIntoState(gamepad: Gamepad, state: VRControllerFrameState): void {
    state.connected = true;
    state.gamepad = gamepad;

    // В стандарте xr-standard стик (thumbstick) находится на axes[2] (X) и axes[3] (Y),
    // fallback на axes[0] / axes[1] для нестандартных профилей
    const rawX =
      gamepad.axes.length >= 4 && (Math.abs(gamepad.axes[2]) > 0.001 || Math.abs(gamepad.axes[3]) > 0.001)
        ? gamepad.axes[2]
        : gamepad.axes[0] ?? 0;
    const rawY =
      gamepad.axes.length >= 4 && (Math.abs(gamepad.axes[2]) > 0.001 || Math.abs(gamepad.axes[3]) > 0.001)
        ? gamepad.axes[3]
        : gamepad.axes[1] ?? 0;

    state.rawStickX = rawX;
    state.rawStickY = rawY;
    state.stickX = this.applyDeadzone(rawX);
    state.stickY = this.applyDeadzone(rawY);

    // Стандартная раскладка кнопок xr-standard (Meta Quest Touch / Pico / Index):
    // buttons[0] = Trigger (select)
    // buttons[1] = Squeeze / Grip
    // buttons[3] = Thumbstick Press
    // buttons[4] = Кнопка A (правый) / Кнопка X (левый)
    // buttons[5] = Кнопка B (правый) / Кнопка Y (левый)
    this.updateButtonEdge(state.trigger, gamepad.buttons[0], 0.55);
    this.updateButtonEdge(state.grip, gamepad.buttons[1], 0.5);
    this.updateButtonEdge(state.thumbstickPress, gamepad.buttons[3], 0.5);
    this.updateButtonEdge(state.buttonAOrX, gamepad.buttons[4], 0.5);
    this.updateButtonEdge(state.buttonBOrY, gamepad.buttons[5], 0.5);
  }

  /**
   * Главный цикл опроса контроллеров и выполнения действий (вызывается в renderer.setAnimationLoop)
   */
  public update(
    dt: number,
    xrSession: XRSession | null,
    xrCamera: THREE.Camera,
    rightController: THREE.Group | null,
    leftController: THREE.Group | null,
    isMovementFrozen = false
  ): void {
    if (!xrSession) {
      if (this.isLeftPushToTalkActive) {
        this.isLeftPushToTalkActive = false;
        this.callbacks.voiceTaskLogger?.stopListening(null);
        this.callbacks.onPushToTalkStateChange?.(false);
      }
      this.resetControllerState(this.leftState);
      this.resetControllerState(this.rightState);
      return;
    }

    let seenLeft = false;
    let seenRight = false;

    const inputSources = xrSession.inputSources;
    for (let i = 0; i < inputSources.length; i++) {
      const source = inputSources[i];
      if (!source.gamepad) continue;

      if (source.handedness === 'left') {
        seenLeft = true;
        this.pollGamepadIntoState(source.gamepad, this.leftState);
      } else if (source.handedness === 'right') {
        seenRight = true;
        this.pollGamepadIntoState(source.gamepad, this.rightState);
      }
    }

    if (!seenLeft) {
      if (this.isLeftPushToTalkActive) {
        this.isLeftPushToTalkActive = false;
        this.callbacks.voiceTaskLogger?.stopListening(null);
        this.callbacks.onPushToTalkStateChange?.(false);
      }
      this.resetControllerState(this.leftState);
    }

    if (!seenRight) {
      this.resetControllerState(this.rightState);
    }

    // Обработка действий ПРАВОГО контроллера (Дозиметрическая рука)
    this.processRightControllerActions(dt, rightController, xrCamera, isMovementFrozen);

    // Обработка действий ЛЕВОГО контроллера (Свободная рука / Фонарик)
    this.processLeftControllerActions(dt, leftController, xrCamera, isMovementFrozen);
  }

  /**
   * 1. Обработка маппинга ПРАВОГО контроллера (Дозиметрическая рука)
   */
  private processRightControllerActions(
    dt: number,
    rightController: THREE.Group | null,
    xrCamera: THREE.Camera,
    isMovementFrozen: boolean
  ): void {
    const right = this.rightState;
    if (!right.connected) return;

    // Обновляем мировой луч Raycaster от правого контроллера при нажатии или удерживании триггера
    if (rightController && (right.trigger.justPressed || right.trigger.isHeld)) {
      rightController.getWorldPosition(this.tempControllerWorldPos);
      rightController.getWorldQuaternion(this.tempControllerQuat);
      this.tempControllerWorldDir.set(0, 0, -1).applyQuaternion(this.tempControllerQuat).normalize();
      this.rightRaycaster.set(this.tempControllerWorldPos, this.tempControllerWorldDir);
    }

    // 1.1. Правый Триггер (select / Trigger):
    // - Нажатие: Взаимодействие с UI-элементами (кнопки на дозиметре, «Экспорт CSV», кнопки окон аналитики)
    if (right.trigger.justPressed && rightController) {
      const hitUi = this.callbacks.onRightTriggerUiClick?.(this.rightRaycaster, rightController);
      if (hitUi) {
        // Легкий импульс (0.2, 30ms) при клике по UI-кнопкам
        this.triggerHapticProfile('right', 'ui_click');
      }
    }

    // - Удерживание: Направление луча взаимодействия (Raycaster) на плавающие панели
    if (right.trigger.isHeld && rightController) {
      this.callbacks.onRightTriggerUiHold?.(this.rightRaycaster, rightController);
    }

    if (right.trigger.justReleased && rightController) {
      this.callbacks.onRightTriggerUiRelease?.(rightController);
    }

    // 1.2. Правый Грип (squeeze / Grip):
    // - Удерживание: Физический хват радиометра-дозиметра в ладони правой руки (перевод пальцев в позу Grip Pose)
    // - Отпускание: Возврат радиометра в дефолтную позицию хватов
    if (right.grip.justPressed) {
      this.isRightGripHoldingRadiometer = true;
      this.triggerHapticProfile('right', 'grab_object');
      this.callbacks.onRightGripInstrumentStateChange?.(true, right.grip.value);
    } else if (right.grip.justReleased) {
      this.isRightGripHoldingRadiometer = false;
      this.callbacks.onRightGripInstrumentStateChange?.(false, 0);
    } else if (right.grip.isHeld) {
      this.callbacks.onRightGripInstrumentStateChange?.(true, right.grip.value);
    }

    // 1.3. Правый Стик (thumbstick):
    // - Отклонение влево/вправо (X-axis): Дискретный или плавный поворот камеры игрока (шаг 30°, deadzone 0.15)
    if (!isMovementFrozen) {
      if (this.snapCooldownSec > 0) {
        this.snapCooldownSec = Math.max(0, this.snapCooldownSec - dt);
      }

      if (this.turnMode === 'snap') {
        if (Math.abs(right.stickX) >= 0.6) {
          if (!this.snapTurnLocked && this.snapCooldownSec <= 0) {
            const turnSign = Math.sign(right.stickX);
            this.playerGroup.rotation.y -= turnSign * this.snapTurnAngleRad;
            this.snapTurnLocked = true;
            this.snapCooldownSec = 0.24;
          }
        } else if (Math.abs(right.stickX) < 0.25) {
          this.snapTurnLocked = false;
        }
      } else if (Math.abs(right.stickX) > 0) {
        this.playerGroup.rotation.y -= right.stickX * this.smoothTurnSpeedRad * dt;
      }
    }

    // - Нажатие на правый стик (Thumbstick Press): Сброс / Калибровка высоты и центра пространства playerGroup
    if (right.thumbstickPress.justPressed) {
      this.calibratePlayerSpace(xrCamera);
      this.triggerHapticProfile('right', 'mode_toggle');
      this.callbacks.onCalibratePlayerSpace?.();
    }

    // 1.4. Кнопка A (Press):
    // Включение / выключение плавающего окна аналитики с графиками D(t) и H(t) (AnalyticsOverlay.toggle())
    if (right.buttonAOrX.justPressed) {
      this.callbacks.analyticsOverlay?.toggle();
      this.triggerHapticProfile('right', 'mode_toggle');
    }

    // 1.5. Кнопка B (Press):
    // Включение / выключение частиц визуализации радиационного фона (RadiationBackgroundField.toggle())
    if (right.buttonBOrY.justPressed) {
      this.callbacks.radiationBackgroundField?.toggle();
      this.triggerHapticProfile('right', 'mode_toggle');
    }
  }

  /**
   * 2. Обработка маппинга ЛЕВОГО контроллера (Свободная рука / Фонарик)
   */
  private processLeftControllerActions(
    dt: number,
    leftController: THREE.Group | null,
    xrCamera: THREE.Camera,
    isMovementFrozen: boolean
  ): void {
    const left = this.leftState;
    if (!left.connected) return;

    // 2.1. Левый Триггер (select / Trigger, 0.0 -> 1.0):
    // Плавное нажатие: Динамический сгиб пальцев левой анатомической кисти для естественных манипуляций
    this.callbacks.onLeftTriggerFingerCurl?.(left.trigger.value, left.grip.value);

    // 2.2. Левый Грип (squeeze / Grip):
    // Удерживание: Хват переносных защитных экранов, свинцовых кирпичей, инструментов или выносного блока
    if (left.grip.justPressed && leftController) {
      this.isLeftGripHoldingObject = true;
      const grabbed = this.callbacks.onLeftGripGrabStart?.(leftController);
      if (grabbed !== false) {
        this.triggerHapticProfile('left', 'grab_object');
      }
    } else if (left.grip.justReleased && leftController) {
      this.isLeftGripHoldingObject = false;
      this.callbacks.onLeftGripGrabEnd?.(leftController);
    }

    // 2.3. Левый Стик (thumbstick, X/Y axes):
    // Плавное перемещение игрока (Smooth Locomotion) по плоскости XZ с учетом направления взгляда VR-гарнитуры (deadzone 0.15)
    if (!isMovementFrozen && (Math.abs(left.stickX) > 0 || Math.abs(left.stickY) > 0)) {
      xrCamera.getWorldDirection(this.tempCameraForward);
      this.tempCameraForward.y = 0;
      if (this.tempCameraForward.lengthSq() > 1e-6) {
        this.tempCameraForward.normalize();
      } else {
        this.tempCameraForward.set(0, 0, -1);
      }

      this.tempCameraRight
        .crossVectors(this.tempCameraForward, this.upAxis)
        .normalize();

      this.tempLocomotionDelta.set(0, 0, 0);
      // В WebXR стик вперед дает отрицательный Y (-1.0)
      this.tempLocomotionDelta.addScaledVector(this.tempCameraForward, -left.stickY);
      this.tempLocomotionDelta.addScaledVector(this.tempCameraRight, left.stickX);

      if (this.tempLocomotionDelta.lengthSq() > 1.0) {
        this.tempLocomotionDelta.normalize();
      }

      this.playerGroup.position.addScaledVector(
        this.tempLocomotionDelta,
        this.moveSpeed * dt
      );
    }

    // 2.4. Кнопка X (Push-to-Talk Hold):
    // - Удерживание: Активация микрофона для голосовой надиктовки и выполнения команд (VoiceTaskLogger.startListening())
    // - Отпускание: Завершение записи фразы (VoiceTaskLogger.stopListening())
    if (left.buttonAOrX.justPressed) {
      this.isLeftPushToTalkActive = true;
      this.callbacks.voiceTaskLogger?.startListening(left.gamepad);
      this.callbacks.onPushToTalkStateChange?.(true);
    } else if (left.buttonAOrX.justReleased) {
      if (this.isLeftPushToTalkActive) {
        this.isLeftPushToTalkActive = false;
        this.callbacks.voiceTaskLogger?.stopListening(left.gamepad);
        this.callbacks.onPushToTalkStateChange?.(false);
      }
    }

    // 2.5. Кнопка Y (Press):
    // Включение / выключение VR-фонарика (VRFlashlight.toggle()) с тактильным щелчком pulse(0.4, 40)
    if (left.buttonBOrY.justPressed) {
      const isNowOn = this.flashlight.toggle(left.gamepad);
      this.callbacks.onFlashlightToggled?.(isNowOn);
    }
  }

  /**
   * Сброс / Калибровка высоты и центра пространственного пространства playerGroup
   * (вызывается по нажатию на правый стик Thumbstick Press)
   */
  public calibratePlayerSpace(xrCamera?: THREE.Camera): void {
    // Сбрасываем вертикальный дрейф к уровню пола local-floor (0.0)
    this.playerGroup.position.y = 0.0;

    // Если передана XR-камера, компенсируем локальное горизонтальное смещение гарнитуры относительно центра playerGroup
    if (xrCamera) {
      const localCamPos = xrCamera.position;
      if (localCamPos.lengthSq() > 0.0001) {
        const offset = new THREE.Vector3(localCamPos.x, 0, localCamPos.z);
        offset.applyAxisAngle(this.upAxis, this.playerGroup.rotation.y);
        // Центрируем положение группы игрока плавной калибровкой
        this.playerGroup.position.x = THREE.MathUtils.clamp(this.playerGroup.position.x, -7.5, 7.5);
        this.playerGroup.position.z = THREE.MathUtils.clamp(this.playerGroup.position.z, -5.5, 5.5);
      }
    }
  }

  /**
   * 4. Дифференцированная вибрация (HapticActuators):
   * - 'ui_click': легкий импульс (0.2, 30ms) при клике по UI-кнопкам
   * - 'flashlight': тактильный щелчок (0.4, 40ms) при переключении фонарика
   * - 'mode_toggle': средний импульс (0.45, 45ms) при переключении режимов
   * - 'grab_object': средний импульс (0.5, 50ms) при схвате предметов
   * - 'ptt_start' / 'ptt_stop': импульс (0.3, 50ms) микрофона
   * - 'danger_alarm': сильная пульсация (0.9, 120ms) при входе в опасную зону или тревоге дозиметра
   */
  public triggerHapticProfile(
    targetHand: 'left' | 'right' | 'both',
    profile: VRHapticProfile
  ): void {
    let intensity = 0.2;
    let durationMs = 30;

    switch (profile) {
      case 'ui_click':
        intensity = 0.2;
        durationMs = 30;
        break;
      case 'flashlight':
        intensity = 0.4;
        durationMs = 40;
        break;
      case 'mode_toggle':
        intensity = 0.45;
        durationMs = 45;
        break;
      case 'grab_object':
        intensity = 0.5;
        durationMs = 50;
        break;
      case 'ptt_start':
      case 'ptt_stop':
        intensity = 0.3;
        durationMs = 50;
        break;
      case 'danger_alarm':
        intensity = 0.92;
        durationMs = 120;
        break;
    }

    if (targetHand === 'left' || targetHand === 'both') {
      this.pulseController('left', intensity, durationMs);
    }
    if (targetHand === 'right' || targetHand === 'both') {
      this.pulseController('right', intensity, durationMs);
    }
  }

  /**
   * Подача произвольного тактильного импульса на выбранный контроллер
   */
  public pulseController(
    hand: 'left' | 'right',
    intensity: number,
    durationMs: number
  ): void {
    const state = hand === 'left' ? this.leftState : this.rightState;
    if (state.gamepad) {
      pulseWebXRGamepad(state.gamepad, intensity, durationMs);
    }
  }

  /**
   * Сильная пульсация (0.8 - 1.0) при входе в опасную радиационную зону или срабатывании тревоги дозиметра
   */
  public triggerDangerRadiationPulse(doseRateMicroSvPerHour: number): void {
    if (doseRateMicroSvPerHour < 1000) return;
    const now = performance.now();
    if (now - this.lastDangerPulseTimeMs < 220) return;
    this.lastDangerPulseTimeMs = now;

    const alarmIntensity = THREE.MathUtils.clamp(
      0.8 + ((doseRateMicroSvPerHour - 1000) / 15000) * 0.2,
      0.8,
      1.0
    );
    this.pulseController('right', alarmIntensity, 110);
    this.pulseController('left', alarmIntensity * 0.85, 95);
  }
}
