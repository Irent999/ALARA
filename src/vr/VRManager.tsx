/**
 * ALARA-Planner Pro — Модуль управления VR-сессией, перехвата левого контроллера и тактического фонаря (VRManager.tsx)
 *
 * Архитектурные требования безопасности и физики света:
 * 1. Hook `useXR()`: если `isPresenting === true` (шлем надет), 2D HTML-оверлей (HUD)
 *    ПОЛНОСТЬЮ исключается из рендера (`return null`).
 * 2. Перехват ввода строго с левого контроллера (`inputSource.handedness === 'left'`).
 * 3. Переключение тактического фонаря (`SpotLight`) по нажатию кнопки 'X', 'Y' или 'Squeeze' (хват)
 *    на левом контроллере с подачей импульса Haptic Feedback.
 * 4. Источник `THREE.SpotLight` физически привязан к матрице позиции и ориентации левой руки/контроллера:
 *    - Угол раскрытия конуса: 30° (`Math.PI / 6`)
 *    - Мягкая полутень: `penumbra = 0.4`
 *    - Физический спад интенсивности по закону обратных квадратов: `decay = 2.0`
 *    - Цветовая температура тактического светодиода: `5500K` (`#fff6e5` / `0xfff6e5`)
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';

// ============================================================================
// 1. КОНСТАНТЫ ФИЗИКИ СВЕТА И МАППИНГА ЛЕВОГО КОНТРОЛЛЕРА WEBXR
// ============================================================================

/**
 * Конвертация цветовой температуры абсолютно черного тела (в Кельвинах) в линейный цвет THREE.Color.
 * Для тактического нейтрально-белого светодиода 5500K дает чистый спектр дневного света (#fff6e5).
 */
export function kelvinToThreeColor(kelvin: number = 5500): THREE.Color {
  const temp = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v / 255));
  return new THREE.Color(clamp01(r), clamp01(g), clamp01(b));
}

export const TACTICAL_FLASHLIGHT_SPECS = {
  /** Цветовая температура светодиода 5500K */
  LED_COLOR_KELVIN: 5500,
  /** Угол конуса луча 30 градусов (в радианах: π / 6 ≈ 0.5235988 рад) */
  CONE_ANGLE_RAD: THREE.MathUtils.degToRad(30),
  /** Мягкая полутень конуса */
  PENUMBRA: 0.4,
  /** Физический спад интенсивности по закону обратных квадратов 1/r² */
  DECAY_INVERSE_SQUARE: 2.0,
  /** Номинальная сила света включенного фонаря (кд / физические единицы Three.js) */
  INTENSITY_ON: 4.5,
  /** Максимальная эффективная дальность расчета освещения (м) */
  MAX_DISTANCE_M: 30.0,
  /** Дистанция целевой точки направления луча вдоль оси -Z левой кисти (м) */
  TARGET_DISTANCE_Z: -5.0
} as const;

/**
 * Индексы кнопок стандарта `xr-standard` для левого контроллера WebXR
 */
export const LEFT_CONTROLLER_BUTTON_INDICES = {
  TRIGGER_SELECT: 0,
  SQUEEZE_GRIP: 1,
  THUMBSTICK_PRESS: 3,
  BUTTON_X: 4,
  BUTTON_Y: 5
} as const;

// ============================================================================
// 2. ХУК useXR() И КОНТЕКСТ УПРАВЛЕНИЯ VR-СЕССИЕЙ
// ============================================================================

export interface XRContextValue {
  /** Активна ли сейчас иммерсивная VR-сессия в шлеме (true = шлем надет, 2D HUD скрыт) */
  readonly isPresenting: boolean;
  /** Текущий объект сессии WebXR */
  readonly session: XRSession | null;
  /** Включен ли тактический фонарь на левом контроллере */
  readonly isFlashlightOn: boolean;
  /** Программное переключение тактического фонаря */
  readonly toggleFlashlight: (forceState?: boolean) => boolean;
  /** Ссылка на 3D-группу тактического фонаря левой руки */
  readonly leftFlashlightRig: LeftControllerFlashlightRig | null;
  /** Запуск WebXR-сессии с безопасной проверкой renderer.xr.enabled = true */
  readonly requestVRSession?: () => Promise<boolean>;
  /** Завершение активной WebXR-сессии */
  readonly endVRSession?: () => Promise<void>;
}

const XRSessionContext = createContext<XRContextValue>({
  isPresenting: false,
  session: null,
  isFlashlightOn: false,
  toggleFlashlight: () => false,
  leftFlashlightRig: null,
  requestVRSession: async () => false,
  endVRSession: async () => {}
});

/**
 * Хук `useXR()` для проверки состояния VR-шлема (`isPresenting`) и управления оборудованием.
 * Может вызываться как внутри `<VRManager>`, так и автономно с передачей `rendererRef`.
 */
export function useXR(
  rendererRef?: React.RefObject<THREE.WebGLRenderer | null>,
  externalIsPresenting?: boolean
): XRContextValue {
  const contextValue = useContext(XRSessionContext);
  const [localPresenting, setLocalPresenting] = useState<boolean>(
    Boolean(externalIsPresenting ?? contextValue.isPresenting)
  );
  const [localSession, setLocalSession] = useState<XRSession | null>(contextValue.session);

  useEffect(() => {
    const renderer = rendererRef?.current;
    if (!renderer?.xr) {
      if (typeof externalIsPresenting === 'boolean') {
        setLocalPresenting(externalIsPresenting);
      }
      return;
    }

    const handleSessionChange = () => {
      const presenting = Boolean(renderer.xr.isPresenting || externalIsPresenting);
      setLocalPresenting(presenting);
      setLocalSession(renderer.xr.getSession?.() ?? null);
    };

    handleSessionChange();
    renderer.xr.addEventListener('sessionstart', handleSessionChange);
    renderer.xr.addEventListener('sessionend', handleSessionChange);

    return () => {
      renderer.xr.removeEventListener('sessionstart', handleSessionChange);
      renderer.xr.removeEventListener('sessionend', handleSessionChange);
    };
  }, [rendererRef, externalIsPresenting]);

  const effectivePresenting = Boolean(
    externalIsPresenting || localPresenting || contextValue.isPresenting
  );

  return {
    ...contextValue,
    isPresenting: effectivePresenting,
    session: localSession ?? contextValue.session
  };
}

// ============================================================================
// 3. ФИЗИЧЕСКИЙ 3D-РИГ ТАКТИЧЕСКОГО ФОНАРЯ НА ЛЕВОМ КОНТРОЛЛЕРЕ
// ============================================================================

export class LeftControllerFlashlightRig {
  /** Корневая группа фонаря, привязываемая к группе левой руки/контроллера */
  public readonly rootGroup: THREE.Group;
  /** Направленный источник света THREE.SpotLight (30°, penumbra 0.4, decay 2.0, 5500K) */
  public readonly spotLight: THREE.SpotLight;
  /** Целевой узел направления луча вдоль отрицательной оси -Z левой руки */
  public readonly lightTarget: THREE.Object3D;
  /** Объемный конус рассеяния Тиндаля (Volumetric Light Cone) в задымленной среде */
  public readonly volumetricConeMesh: THREE.Mesh;
  /** Эмиссионная линза светодиода 5500K */
  public readonly emitterLensMesh: THREE.Mesh;
  /** Текущее состояние питания фонаря */
  public isOn: boolean;

  constructor(initialOn: boolean = false) {
    this.isOn = initialOn;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'left_controller_tactical_flashlight_rig';

    // Позиционирование рукоятки фонаря в ладони левой руки
    this.rootGroup.position.set(-0.02, 0.01, -0.03);
    this.rootGroup.rotation.set(0, 0, 0);

    const ledColor5500K = kelvinToThreeColor(TACTICAL_FLASHLIGHT_SPECS.LED_COLOR_KELVIN);

    // 1. Создание физически корректного THREE.SpotLight
    this.spotLight = new THREE.SpotLight(
      ledColor5500K,
      initialOn ? TACTICAL_FLASHLIGHT_SPECS.INTENSITY_ON : 0.0,
      TACTICAL_FLASHLIGHT_SPECS.MAX_DISTANCE_M,
      TACTICAL_FLASHLIGHT_SPECS.CONE_ANGLE_RAD, // 30° (Math.PI / 6)
      TACTICAL_FLASHLIGHT_SPECS.PENUMBRA,       // 0.4
      TACTICAL_FLASHLIGHT_SPECS.DECAY_INVERSE_SQUARE // 2.0 (закон обратных квадратов 1/r²)
    );
    this.spotLight.position.set(0, 0, -0.09);
    this.spotLight.castShadow = true;
    this.spotLight.shadow.mapSize.width = 1024;
    this.spotLight.shadow.mapSize.height = 1024;
    this.spotLight.shadow.camera.near = 0.08;
    this.spotLight.shadow.camera.far = TACTICAL_FLASHLIGHT_SPECS.MAX_DISTANCE_M;
    this.spotLight.shadow.bias = -0.0005;
    this.rootGroup.add(this.spotLight);

    // 2. Привязка мишени spotLight.target строго вдоль оси -Z левого контроллера
    this.lightTarget = new THREE.Object3D();
    this.lightTarget.name = 'left_flashlight_spotlight_target';
    this.lightTarget.position.set(0, 0, TACTICAL_FLASHLIGHT_SPECS.TARGET_DISTANCE_Z);
    this.rootGroup.add(this.lightTarget);
    this.spotLight.target = this.lightTarget;

    // 3. Корпус тактического фонаря РХБЗ
    const bodyGeo = new THREE.CylinderGeometry(0.016, 0.014, 0.14, 24);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.32
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.set(0, 0, -0.02);
    bodyMesh.castShadow = true;
    this.rootGroup.add(bodyMesh);

    // 4. Линза излучателя 5500K
    const lensGeo = new THREE.CircleGeometry(0.015, 24);
    const lensMat = new THREE.MeshStandardMaterial({
      color: ledColor5500K,
      emissive: ledColor5500K,
      emissiveIntensity: initialOn ? 3.2 : 0.0,
      roughness: 0.1,
      metalness: 0.1
    });
    this.emitterLensMesh = new THREE.Mesh(lensGeo, lensMat);
    this.emitterLensMesh.rotation.y = Math.PI;
    this.emitterLensMesh.position.set(0, 0, -0.091);
    this.rootGroup.add(this.emitterLensMesh);

    // 5. Объемный конус света (Volumetric Cone) для визуализации луча в аэрозольном тумане
    const coneLength = 4.5;
    const coneRadius = Math.tan(TACTICAL_FLASHLIGHT_SPECS.CONE_ANGLE_RAD) * coneLength;
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneLength, 32, 1, true);
    coneGeo.translate(0, -coneLength / 2, 0);
    coneGeo.rotateX(Math.PI / 2);
    const coneMat = new THREE.MeshBasicMaterial({
      color: ledColor5500K,
      transparent: true,
      opacity: 0.075,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.volumetricConeMesh = new THREE.Mesh(coneGeo, coneMat);
    this.volumetricConeMesh.position.set(0, 0, -0.09);
    this.volumetricConeMesh.visible = initialOn;
    this.volumetricConeMesh.raycast = () => {};
    this.rootGroup.add(this.volumetricConeMesh);
  }

  /**
   * Привязка фонаря к группе левого контроллера (`leftControllerGrip` или `leftController`)
   */
  public attachToLeftController(leftControllerObject: THREE.Object3D): void {
    if (this.rootGroup.parent !== leftControllerObject) {
      leftControllerObject.add(this.rootGroup);
    }
  }

  /**
   * Включение / выключение тактического фонаря
   */
  public setPower(enabled: boolean, leftGamepad?: Gamepad | null): boolean {
    this.isOn = enabled;
    this.spotLight.intensity = this.isOn ? TACTICAL_FLASHLIGHT_SPECS.INTENSITY_ON : 0.0;
    this.volumetricConeMesh.visible = this.isOn;

    const lensMat = this.emitterLensMesh.material as THREE.MeshStandardMaterial;
    lensMat.emissiveIntensity = this.isOn ? 3.2 : 0.0;

    // Тактильный отклик (Haptic Pulse) при щелчке кнопки фонаря на левом контроллере
    if (leftGamepad?.hapticActuators && leftGamepad.hapticActuators.length > 0) {
      try {
        void leftGamepad.hapticActuators[0].pulse(0.45, 40);
      } catch {
        // Игнорируем ошибку, если контроллер не поддерживает виброактуатор
      }
    }

    return this.isOn;
  }

  public toggle(leftGamepad?: Gamepad | null): boolean {
    return this.setPower(!this.isOn, leftGamepad);
  }
}

// ============================================================================
// 4. ОПРОС ЛЕВОГО КОНТРОЛЛЕРА WEBXR (КНОПКИ X, Y И SQUEEZE)
// ============================================================================

export interface LeftControllerInputPollerOptions {
  /** Разрешить переключение фонаря также по нажатию Squeeze (хвата), если рука не занята предметом */
  readonly allowSqueezeToggle?: boolean;
  /** Коллбэк при изменении состояния фонаря */
  readonly onFlashlightToggle?: (isOn: boolean) => void;
}

export class LeftControllerFlashlightPoller {
  private prevXPressed = false;
  private prevYPressed = false;
  private prevSqueezePressed = false;
  private readonly flashlightRig: LeftControllerFlashlightRig;
  private readonly options: LeftControllerInputPollerOptions;

  constructor(
    flashlightRig: LeftControllerFlashlightRig,
    options: LeftControllerInputPollerOptions = {}
  ) {
    this.flashlightRig = flashlightRig;
    this.options = options;
  }

  /**
   * Вызывается в каждом кадре `renderer.setAnimationLoop` / `useFrame`
   * и перехватывает ввод строго с левого контроллера (`inputSource.handedness === 'left'`)
   */
  public update(session: XRSession | null): void {
    if (!session) {
      this.prevXPressed = false;
      this.prevYPressed = false;
      this.prevSqueezePressed = false;
      return;
    }

    try {
      const inputSources = session.inputSources;
      if (!inputSources) return;
      for (const inputSource of inputSources) {
        if (!inputSource || inputSource.handedness !== 'left' || !inputSource.gamepad) {
          continue;
        }

        const buttons = inputSource.gamepad.buttons;
        const isXPressed = Boolean(buttons?.[LEFT_CONTROLLER_BUTTON_INDICES.BUTTON_X]?.pressed);
        const isYPressed = Boolean(buttons?.[LEFT_CONTROLLER_BUTTON_INDICES.BUTTON_Y]?.pressed);
        const isSqueezePressed = Boolean(
          buttons?.[LEFT_CONTROLLER_BUTTON_INDICES.SQUEEZE_GRIP]?.pressed
        );

        // Детектор переднего фронта нажатия (Rising Edge) для исключения дребезга
        const justPressedX = isXPressed && !this.prevXPressed;
        const justPressedY = isYPressed && !this.prevYPressed;
        const justPressedSqueeze =
          Boolean(this.options.allowSqueezeToggle) &&
          isSqueezePressed &&
          !this.prevSqueezePressed;

        if (justPressedX || justPressedY || justPressedSqueeze) {
          const nextState = this.flashlightRig.toggle(inputSource.gamepad);
          this.options.onFlashlightToggle?.(nextState);
        }

        this.prevXPressed = isXPressed;
        this.prevYPressed = isYPressed;
        this.prevSqueezePressed = isSqueezePressed;
      }
    } catch {
      // Игнорируем транзиентные ошибки inputSources при переключении контроллеров
    }
  }
}

// ============================================================================
// 5. REACT-КОМПОНЕНТ VRManager (БЛОКИРОВКА 2D HUD В ШЛЕМЕ + КОНТРОЛЛЕР СВЕТА)
// ============================================================================

export interface VRManagerProps {
  /** Ссылка на WebGLRenderer для подписки на WebXR-события и привязки к контроллеру */
  readonly rendererRef?: React.RefObject<THREE.WebGLRenderer | null>;
  /** Ссылка на 3D-объект левой руки / контроллера, к которому крепится SpotLight */
  readonly leftControllerRef?: React.RefObject<THREE.Object3D | null>;
  /** Внешний флаг активной VR-сессии */
  readonly isInVR?: boolean;
  /** Разрешить переключение фонаря кнопкой Squeeze помимо кнопок X и Y */
  readonly enableSqueezeFlashlightToggle?: boolean;
  /** Отключить дублирующий SpotLight и фоновый pollLoop, если фонарём управляет WebXRManager */
  readonly disableInternalFlashlightRig?: boolean;
  /** Коллбэк синхронизации состояния фонаря с родительским приложением */
  readonly onFlashlightChange?: (isOn: boolean) => void;
  /**
   * Дочерний 2D HTML-оверлей (HUD).
   * Если `isPresenting === true` (пользователь надел VR-шлем), `VRManager` возвращает `null` для 2D HUD.
   */
  readonly children?: React.ReactNode;
}

export const VRManager: React.FC<VRManagerProps> = ({
  rendererRef,
  leftControllerRef,
  isInVR = false,
  enableSqueezeFlashlightToggle = true,
  disableInternalFlashlightRig = false,
  onFlashlightChange,
  children
}) => {
  const [isPresenting, setIsPresenting] = useState<boolean>(isInVR);
  const [session, setSession] = useState<XRSession | null>(null);
  const [isFlashlightOn, setIsFlashlightOn] = useState<boolean>(false);

  const flashlightRigRef = useRef<LeftControllerFlashlightRig | null>(null);
  if (!disableInternalFlashlightRig && !flashlightRigRef.current) {
    flashlightRigRef.current = new LeftControllerFlashlightRig(false);
  }

  const onFlashlightChangeRef = useRef(onFlashlightChange);
  onFlashlightChangeRef.current = onFlashlightChange;

  const toggleFlashlight = useCallback((forceState?: boolean): boolean => {
    const rig = flashlightRigRef.current;
    if (!rig) return false;
    const next = typeof forceState === 'boolean' ? rig.setPower(forceState) : rig.toggle();
    setIsFlashlightOn(next);
    onFlashlightChangeRef.current?.(next);
    return next;
  }, []);

  const requestVRSession = useCallback(async (): Promise<boolean> => {
    const renderer = rendererRef?.current;
    if (!renderer) {
      console.warn('VRManager: rendererRef is not ready');
      return false;
    }
    if (typeof navigator === 'undefined' || !navigator.xr) {
      console.warn('VRManager: WebXR not supported in navigator');
      return false;
    }
    try {
      // КРИТИЧЕСКИ ВАЖНО: renderer.xr.enabled = true должно быть включено до вызова requestSession
      renderer.xr.enabled = true;
      const isSupp = await navigator.xr.isSessionSupported('immersive-vr');
      if (!isSupp) {
        console.warn('VRManager: immersive-vr is not supported by device/browser');
        return false;
      }
      const newSession = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
      });
      const spaceChain: XRReferenceSpaceType[] = ['local-floor', 'local', 'viewer'];
      let resolvedSpace: XRReferenceSpaceType = 'viewer';
      for (const spaceType of spaceChain) {
        try {
          await newSession.requestReferenceSpace(spaceType);
          resolvedSpace = spaceType;
          break;
        } catch {
          // fallback к следующему reference space
        }
      }
      renderer.xr.setReferenceSpaceType(resolvedSpace);
      await renderer.xr.setSession(newSession);
      return true;
    } catch (err) {
      console.warn('VRManager: WebXR requestSession error:', err);
      return false;
    }
  }, [rendererRef]);

  const endVRSession = useCallback(async (): Promise<void> => {
    try {
      const activeSession = session ?? rendererRef?.current?.xr.getSession?.();
      if (activeSession) {
        await activeSession.end();
      }
    } catch (err) {
      console.warn('VRManager: WebXR end session error:', err);
    }
  }, [session, rendererRef]);

  // Привязка физического SpotLight (30°, penumbra 0.4, 5500K, 1/r²) к левому контроллеру
  useEffect(() => {
    if (disableInternalFlashlightRig) return;
    const leftCtrl = leftControllerRef?.current;
    const rig = flashlightRigRef.current;
    if (leftCtrl && rig) {
      rig.attachToLeftController(leftCtrl);
    }
  }, [leftControllerRef, disableInternalFlashlightRig]);

  // Отслеживание статуса VR-сессии (`sessionstart` / `sessionend`) и опрос левого контроллера
  useEffect(() => {
    const renderer = rendererRef?.current;
    if (!renderer?.xr) {
      setIsPresenting(isInVR);
      return;
    }

    const syncSession = () => {
      const activeSession = renderer.xr.getSession?.() ?? null;
      const presentingNow = Boolean(renderer.xr.isPresenting || isInVR);
      setIsPresenting(prev => (prev === presentingNow ? prev : presentingNow));
      setSession(prev => (prev === activeSession ? prev : activeSession));
    };

    syncSession();
    renderer.xr.addEventListener('sessionstart', syncSession);
    renderer.xr.addEventListener('sessionend', syncSession);

    if (disableInternalFlashlightRig || !flashlightRigRef.current) {
      return () => {
        renderer.xr.removeEventListener('sessionstart', syncSession);
        renderer.xr.removeEventListener('sessionend', syncSession);
      };
    }

    const poller = new LeftControllerFlashlightPoller(flashlightRigRef.current, {
      allowSqueezeToggle: enableSqueezeFlashlightToggle,
      onFlashlightToggle: nextOn => {
        setIsFlashlightOn(nextOn);
        onFlashlightChangeRef.current?.(nextOn);
      }
    });

    const controllerGrip0 = renderer.xr.getControllerGrip(0);
    const controllerGrip1 = renderer.xr.getControllerGrip(1);

    const onConnected = (event: { data?: XRInputSource } & THREE.Event) => {
      if (event.data?.handedness === 'left' && flashlightRigRef.current) {
        const targetGrip = event.target as THREE.Object3D | undefined;
        if (targetGrip && !leftControllerRef?.current) {
          flashlightRigRef.current.attachToLeftController(targetGrip);
        }
      }
    };

    controllerGrip0.addEventListener('connected' as never, onConnected as never);
    controllerGrip1.addEventListener('connected' as never, onConnected as never);

    let rafId = 0;
    const pollLoop = () => {
      const activeSession = renderer.xr.getSession?.() ?? null;
      if (activeSession) {
        poller.update(activeSession);
      }
      rafId = window.requestAnimationFrame(pollLoop);
    };
    rafId = window.requestAnimationFrame(pollLoop);

    return () => {
      window.cancelAnimationFrame(rafId);
      renderer.xr.removeEventListener('sessionstart', syncSession);
      renderer.xr.removeEventListener('sessionend', syncSession);
      controllerGrip0.removeEventListener('connected' as never, onConnected as never);
      controllerGrip1.removeEventListener('connected' as never, onConnected as never);
    };
  }, [rendererRef, leftControllerRef, isInVR, enableSqueezeFlashlightToggle, disableInternalFlashlightRig]);

  const effectivePresenting = Boolean(isPresenting || isInVR);

  const contextValue: XRContextValue = useMemo(
    () => ({
      isPresenting: effectivePresenting,
      session,
      isFlashlightOn,
      toggleFlashlight,
      leftFlashlightRig: flashlightRigRef.current,
      requestVRSession,
      endVRSession
    }),
    [effectivePresenting, session, isFlashlightOn, toggleFlashlight, requestVRSession, endVRSession]
  );

  // КРИТИЧЕСКОЕ ПРАВИЛО БЕЗОПАСНОСТИ VR:
  // Если пользователь надел VR-шлем (isPresenting === true), 2D HTML-оверлей (HUD)
  // ПОЛНОСТЬЮ исключается из рендера (return null).
  return (
    <XRSessionContext.Provider value={contextValue}>
      {effectivePresenting ? null : children}
    </XRSessionContext.Provider>
  );
};
