/**
 * ALARA-Planner Pro VR — Фотореалистичная анатомическая 3D-модель кистей рук (RealisticHumanHandRig / HazmatHandRig)
 *
 * Архитектурные и биомеханические гарантии:
 * 1. Реалистичное позиционирование прибора в ПРАВОЙ ладони (Hand Grip Anchoring):
 *    - Ладонь правой руки при удержании прибора развернута ладонной поверхностью (Palmar surface) вверх/внутрь,
 *      а тыльной стороной (Dorsal surface с костяшками и ногтями) — вниз/наружу.
 *    - Корпус радиометра/дозиметра находится СТРОГО внутри ладони (со стороны ладонной поверхности, а не тыльной)
 *      без клиппинга (прохождения геометрии прибора сквозь текстуру кожи).
 *    - Точные локальные офсеты прикрепления дозиметра относительно группы ладони:
 *      radiometerGroup.position.set(0.01, -0.015, -0.04) и radiometerGroup.rotation.set(-Math.PI / 4, Math.PI / 12, 0).
 *    - Дисплей и органы управления прибора смотрят наверх и на пользователя (легко читаемы при естественно согнутом локте).
 *    - Выносной датчик / блок детектора направлен строго вперед по направлению указательного пальца (вдоль оси -Z кисти).
 *    - Пальцы правой руки при удержании прибора находятся в естественной позе хвата (Grip Pose: curl ≈ 0.42, в диапазоне 0.35–0.5),
 *      охватывая корпус прибора снизу и сбоку, а большой палец ложится на боковую/верхнюю грань корпуса.
 * 2. Полноценная симметричная ЛЕВАЯ рука (Simultaneous Dual Hand System) с жесткой интеграцией VR-фонаря (VRFlashlight):
 *    - Экземпляр RealisticHumanHandRig({ handedness: 'left' }) интегрирует класс VRFlashlight строго в локальную иерархию левой кисти:
 *      leftHandRig.add(flashlightMesh) / leftHandRig.attach(flashlightMesh) (без добавления модели фонаря или SpotLight напрямую в глобальную scene).
 *    - Локальное позиционирование рукоятки внутри ладони левой руки:
 *      flashlightMesh.position.set(-0.02, 0.01, -0.03), корпус цилиндра ориентирован вдоль оси кисти (rotation.x = Math.PI / 2),
 *      линза фонаря и конус света направлены строго вперед вдоль отрицательной оси -Z локального пространства кисти (по указательному пальцу).
 *    - Точечный прожектор THREE.SpotLight и его цель spotLight.target прикреплены напрямую к модели фонаря:
 *      flashlightMesh.add(spotLight) и flashlightMesh.add(spotLight.target), где spotLight.target.position.set(0, 0, -5),
 *      обеспечивая 1:1 вращение луча и динамических теней вслед за физическим запястьем левой руки.
 *    - Пальцы левой руки при удержании фонаря переведены в позу удержания цилиндрического предмета (Grip Pose: curl ≈ 0.45),
 *      а большой палец фиксирует рукоятку сверху.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { InstrumentId } from '../instruments/gostInstruments';
import {
  createBopReflectiveStripeTexture,
  createMchsChevronTexture
} from './mchsTextures';
import {
  createPolymerCasingMaterial,
  createMetalConnectorMaterial,
  createRubberSSSMaterial,
  createMultiLayerOpticalDisplay,
  createCatenaryCableMesh
} from './pbrMaterialEngine';

export interface FingerJoints {
  proximal: THREE.Group;
  intermediate?: THREE.Group;
  distal: THREE.Group;
  baseRotations: {
    proximal: THREE.Euler;
    intermediate?: THREE.Euler;
    distal: THREE.Euler;
  };
  gripRotations: {
    proximal: THREE.Euler;
    intermediate?: THREE.Euler;
    distal: THREE.Euler;
  };
}

/**
 * Класс высокоинтенсивного тактического VR-фонаря (VRFlashlight) для жесткой привязки к иерархии ЛЕВОЙ руки:
 * - Не добавляется напрямую в глобальную scene: является дочерним узлом левой кисти (leftHandRig.add(flashlightMesh) / .attach(flashlightMesh)).
 * - Рукоятка спозиционирована строго внутри ладони левой руки: flashlightMesh.position.set(-0.02, 0.01, -0.03),
 *   цилиндрическое шасси повернуто на Math.PI / 2 по X, а линза и конус света направлены строго вдоль -Z локального пространства кисти.
 * - Источник света THREE.SpotLight и его цель spotLight.target прикреплены напрямую к flashlightMesh:
 *   flashlightMesh.add(spotLight) и flashlightMesh.add(spotLight.target) со смещением spotLight.target.position.set(0, 0, -5).
 */
export class VRFlashlight {
  public readonly flashlightMesh: THREE.Group;
  public readonly cylinderBodyGroup: THREE.Group;
  public readonly spotLight: THREE.SpotLight;
  public readonly spotLightTarget: THREE.Object3D;
  public readonly bounceLight: THREE.PointLight;
  public readonly beamCone: THREE.Mesh;
  public readonly ledEmitter: THREE.Mesh;
  public readonly statusLed: THREE.Mesh;
  public isOn: boolean;
  public isEquipped: boolean = true;
  private hapticPulseCallback: ((intensity: number, durationMs: number) => void) | null = null;

  // Калиброванные локальные офсеты в системе координат левой ладони
  public static readonly LOCAL_OFFSET_POS = new THREE.Vector3(-0.02, 0.01, -0.03);
  public static readonly LOCAL_OFFSET_ROT = new THREE.Euler(0, 0, 0, 'XYZ');
  public static readonly CYLINDER_AXIS_ROT = new THREE.Euler(Math.PI / 2, 0, 0, 'XYZ');
  public static readonly TARGET_LOCAL_POS = new THREE.Vector3(0, 0, -5);
  public static readonly GRIP_POSE_CURL = 0.45;

  constructor(initialOn = false) {
    this.isOn = initialOn;
    this.flashlightMesh = new THREE.Group();
    this.flashlightMesh.name = 'tactical_flashlight';

    // Цилиндрическая группа корпуса: стандартные CylinderGeometry в Three.js ориентированы вдоль оси Y,
    // поэтому поворот Math.PI / 2 вокруг X укладывает рукоятку горизонтально в ладонь вдоль оси -Z указательного пальца
    this.cylinderBodyGroup = new THREE.Group();
    this.cylinderBodyGroup.name = 'flashlight_cylinder_body';
    this.cylinderBodyGroup.rotation.copy(VRFlashlight.CYLINDER_AXIS_ROT);
    this.flashlightMesh.add(this.cylinderBodyGroup);

    const bodyPolymerMat = createPolymerCasingMaterial(0xeab308); // Ударопрочный желтый полимер Hazmat
    const darkMetalMat = createMetalConnectorMaterial(0x1e293b);
    const chromeMat = createMetalConnectorMaterial(0xe2e8f0);
    const rubberGripMat = createRubberSSSMaterial({
      color: 0x0f172a,
      attenuationColor: 0x334155,
      roughness: 0.55,
      transmission: 0.08,
      thickness: 0.01,
      withGloveMicroTread: true
    });

    // Внутри cylinderBodyGroup (повернутой на +Math.PI/2 по X):
    // локальная ось -Y соответствует направлению вперед (-Z кисти), а +Y — к запястью (+Z кисти)
    // 1. Основной цилиндрический корпус-рукоятка
    const barrelGeo = new THREE.CylinderGeometry(0.0175, 0.0185, 0.155, 28);
    const barrelMesh = new THREE.Mesh(barrelGeo, bodyPolymerMat);
    barrelMesh.position.set(0, -0.005, 0);
    barrelMesh.castShadow = true;
    barrelMesh.receiveShadow = true;
    this.cylinderBodyGroup.add(barrelMesh);

    // Прорезиненная рельефная накладка под пальцы левой руки (Knurled Rubber Sleeve)
    const sleeveGeo = new THREE.CylinderGeometry(0.019, 0.0195, 0.092, 28);
    const sleeveMesh = new THREE.Mesh(sleeveGeo, rubberGripMat);
    sleeveMesh.position.set(0, 0.008, 0);
    this.cylinderBodyGroup.add(sleeveMesh);

    // 2. Торцевая крышка батарейного отсека (+Z кисти / +Y цилиндра)
    const tailCapGeo = new THREE.CylinderGeometry(0.019, 0.020, 0.022, 24);
    const tailCap = new THREE.Mesh(tailCapGeo, darkMetalMat);
    tailCap.position.set(0, 0.078, 0);
    this.cylinderBodyGroup.add(tailCap);

    // 3. Шестигранный радиатор охлаждения и расширенная головная часть с линзой (-Z кисти / -Y цилиндра)
    const hexCollarGeo = new THREE.CylinderGeometry(0.021, 0.024, 0.026, 6);
    const hexCollar = new THREE.Mesh(hexCollarGeo, darkMetalMat);
    hexCollar.position.set(0, -0.078, 0);
    this.cylinderBodyGroup.add(hexCollar);

    const headBezelGeo = new THREE.CylinderGeometry(0.024, 0.030, 0.040, 32);
    const headBezel = new THREE.Mesh(headBezelGeo, darkMetalMat);
    headBezel.position.set(0, -0.104, 0);
    headBezel.castShadow = true;
    this.cylinderBodyGroup.add(headBezel);

    // Защитное кольцо вокруг линзы (в пространстве flashlightMesh на z = -0.124)
    const bezelBumper = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.0032, 16, 32), bodyPolymerMat);
    bezelBumper.position.set(0, 0, -0.124);
    this.flashlightMesh.add(bezelBumper);

    // 4. Глубокий параболический отражатель и CREE-светодиод
    const reflectorGeo = new THREE.CylinderGeometry(0.008, 0.026, 0.022, 28, 1, true);
    const reflectorMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      metalness: 0.98,
      roughness: 0.06,
      side: THREE.DoubleSide
    });
    const reflector = new THREE.Mesh(reflectorGeo, reflectorMat);
    reflector.position.set(0, -0.112, 0);
    this.cylinderBodyGroup.add(reflector);

    const ledEmitterMat = new THREE.MeshStandardMaterial({
      color: 0xfffef0,
      emissive: new THREE.Color(0xfffbeb),
      emissiveIntensity: initialOn ? 8.0 : 0.08,
      roughness: 0.15
    });
    this.ledEmitter = new THREE.Mesh(new THREE.SphereGeometry(0.007, 16, 12), ledEmitterMat);
    this.ledEmitter.name = 'flashlight_led_emitter';
    this.ledEmitter.position.set(0, 0, -0.108);
    this.flashlightMesh.add(this.ledEmitter);

    // Закаленная оптическая линза (строго на переднем срезе вдоль -Z)
    const lensGeo = new THREE.CylinderGeometry(0.027, 0.027, 0.003, 28);
    const lensMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.92,
      ior: 1.52,
      roughness: 0.04,
      thickness: 0.006,
      transparent: true
    });
    const lensMesh = new THREE.Mesh(lensGeo, lensMat);
    lensMesh.position.set(0, -0.123, 0);
    this.cylinderBodyGroup.add(lensMesh);

    // 5. Верхняя тактическая кнопка включения под большой палец левой руки (+Y в пространстве flashlightMesh)
    const switchHousing = new THREE.Mesh(
      new RoundedBoxGeometry(0.014, 0.008, 0.024, 3, 0.002),
      chromeMat
    );
    switchHousing.position.set(0, 0.019, -0.036);
    this.flashlightMesh.add(switchHousing);

    const statusLedMat = new THREE.MeshStandardMaterial({
      color: initialOn ? 0x22c55e : 0xf59e0b,
      emissive: new THREE.Color(initialOn ? 0x22c55e : 0xf59e0b),
      emissiveIntensity: initialOn ? 3.5 : 1.2
    });
    this.statusLed = new THREE.Mesh(new THREE.SphereGeometry(0.003, 12, 10), statusLedMat);
    this.statusLed.name = 'flashlight_status_led';
    this.statusLed.position.set(0, 0.024, -0.036);
    this.flashlightMesh.add(this.statusLed);

    // 6. Объемный световой конус (Volumetric Beam Cone) строго вперед вдоль отрицательной оси -Z
    const coneLength = 4.6;
    const coneRadius = 0.85;
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneLength, 32, 1, true);
    coneGeo.translate(0, -coneLength / 2, 0);
    coneGeo.rotateX(Math.PI / 2);

    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xfffbeb,
      transparent: true,
      opacity: 0.10,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.beamCone = new THREE.Mesh(coneGeo, coneMat);
    this.beamCone.name = 'flashlight_beam_cone';
    this.beamCone.position.set(0, 0, -0.125);
    this.beamCone.visible = initialOn;
    this.beamCone.raycast = () => {};
    this.flashlightMesh.add(this.beamCone);

    // 7. Связка источника света THREE.SpotLight и его цели spotLight.target напрямую внутри flashlightMesh:
    //    flashlightMesh.add(spotLight) и flashlightMesh.add(spotLight.target) с позицией цели (0, 0, -5)
    //    Настройки SpotLight: angle = Math.PI / 6, penumbra = 0.4, intensity = 3.5, castShadow = true
    this.spotLightTarget = new THREE.Object3D();
    this.spotLightTarget.name = 'flashlight_spot_target';
    this.spotLightTarget.position.set(0, 0, -5);

    this.spotLight = new THREE.SpotLight(
      0xfff6e5, // 5500K LED
      initialOn ? 3.5 : 0.0,
      25,
      Math.PI / 6, // 30°
      0.4,
      2.0 // спад интенсивности по закону обратных квадратов 1/r²
    );
    this.spotLight.name = 'flashlight_spot_light';
    this.spotLight.position.set(0, 0, -0.126);
    this.spotLight.target = this.spotLightTarget;
    this.spotLight.castShadow = false;
    this.spotLight.visible = initialOn;

    // Прикрепляем SpotLight и spotLight.target напрямую к модели фонаря
    this.flashlightMesh.add(this.spotLight);
    this.flashlightMesh.add(this.spotLight.target);

    // Мягкая ближняя подсветка у линзы фонаря
    this.bounceLight = new THREE.PointLight(0xfffbeb, initialOn ? 2.4 : 0.0, 4.0, 1.6);
    this.bounceLight.name = 'flashlight_bounce_light';
    this.bounceLight.position.set(0, 0, -0.15);
    this.bounceLight.visible = initialOn;
    this.flashlightMesh.add(this.bounceLight);

    // Локальное позиционирование рукоятки внутри ладони левой руки: (-0.02, 0.01, -0.03)
    this.flashlightMesh.position.set(-0.02, 0.01, -0.03);
    this.flashlightMesh.rotation.copy(VRFlashlight.LOCAL_OFFSET_ROT);

    this.flashlightMesh.userData = {
      ...this.flashlightMesh.userData,
      interactiveId: 'tactical_flashlight',
      isFlashlight: true,
      isFlashlightOn: initialOn,
      vrFlashlightInstance: this,
      placementType: 'prop',
      isLargeEquipment: false
    };
  }

  public get mesh(): THREE.Group {
    return this.flashlightMesh;
  }

  /**
   * Жесткая привязка фонаря к локальной иерархии левой руки (leftHandRig / leftControllerGrip):
   * Использует .attach() при динамическом переприкреплении и фиксирует локальные координаты
   * flashlightMesh.position.set(-0.02, 0.01, -0.03) без малейшего дрифта в мировом пространстве.
   */
  public attachToLeftHand(leftHandParent: THREE.Object3D): void {
    if (this.flashlightMesh.parent && this.flashlightMesh.parent !== leftHandParent) {
      leftHandParent.attach(this.flashlightMesh);
    } else if (!this.flashlightMesh.parent) {
      leftHandParent.add(this.flashlightMesh);
    }

    // Гарантируем точные локальные офсеты внутри ладони левой кисти и ориентацию луча вдоль -Z
    this.flashlightMesh.position.set(-0.02, 0.01, -0.03);
    this.flashlightMesh.rotation.copy(VRFlashlight.LOCAL_OFFSET_ROT);
    this.cylinderBodyGroup.rotation.copy(VRFlashlight.CYLINDER_AXIS_ROT);
    this.spotLight.target.position.set(0, 0, -5);

    this.isEquipped = true;
    this.flashlightMesh.updateMatrix();
    this.flashlightMesh.updateMatrixWorld(true);
  }

  public setHapticPulseCallback(cb: (intensity: number, durationMs: number) => void): void {
    this.hapticPulseCallback = cb;
  }

  /**
   * Включение / выключение светового потока и индикации фонаря
   */
  public setPower(isOn: boolean, gamepad?: Gamepad | null): void {
    this.isOn = isOn;
    this.flashlightMesh.userData.isFlashlightOn = isOn;

    this.spotLight.visible = isOn;
    this.spotLight.intensity = isOn ? 3.5 : 0.0;
    this.spotLight.distance = 25;
    this.spotLight.angle = Math.PI / 6;
    this.spotLight.penumbra = 0.4;
    this.spotLight.decay = 2.0;
    this.spotLight.castShadow = false;
    this.spotLight.target.position.set(0, 0, -5);

    this.bounceLight.visible = isOn;
    this.bounceLight.intensity = isOn ? 2.4 : 0.0;

    this.beamCone.visible = isOn;

    if (this.ledEmitter.material instanceof THREE.MeshStandardMaterial) {
      this.ledEmitter.material.emissiveIntensity = isOn ? 8.0 : 0.08;
    }

    if (this.statusLed.material instanceof THREE.MeshStandardMaterial) {
      const colorHex = isOn ? 0x22c55e : 0xf59e0b;
      this.statusLed.material.color.setHex(colorHex);
      this.statusLed.material.emissive.setHex(colorHex);
      this.statusLed.material.emissiveIntensity = isOn ? 3.5 : 1.2;
    }

    if (gamepad) {
      this.pulseToggleHaptic(gamepad, 0.4, 40);
    } else if (this.hapticPulseCallback) {
      this.hapticPulseCallback(0.4, 40);
    }
  }

  public toggle(gamepad?: Gamepad | null): boolean {
    this.setPower(!this.isOn, gamepad);
    return this.isOn;
  }

  /**
   * Короткий тактильный импульс при переключении кнопки Y или голосовой команде:
   * gamepad.haptics[0].pulse(0.4, 40) / gamepad.hapticActuators[0].pulse(0.4, 40)
   */
  public pulseToggleHaptic(gamepad?: Gamepad | null, intensity = 0.4, durationMs = 40): void {
    if (!gamepad) return;
    const anyGp = gamepad as unknown as {
      haptics?: Array<{ pulse?: (value: number, duration: number) => Promise<void> | void }>;
      hapticActuators?: Array<{ pulse?: (value: number, duration: number) => Promise<void> | void }>;
      vibrationActuator?: {
        playEffect?: (
          type: string,
          params: { duration: number; strongMagnitude: number; weakMagnitude: number }
        ) => Promise<void> | void;
      };
    };

    try {
      if (anyGp.haptics && anyGp.haptics.length > 0 && typeof anyGp.haptics[0].pulse === 'function') {
        anyGp.haptics[0].pulse(intensity, durationMs);
        return;
      }
      if (
        anyGp.hapticActuators &&
        anyGp.hapticActuators.length > 0 &&
        typeof anyGp.hapticActuators[0].pulse === 'function'
      ) {
        anyGp.hapticActuators[0].pulse(intensity, durationMs);
        return;
      }
      if (anyGp.vibrationActuator && typeof anyGp.vibrationActuator.playEffect === 'function') {
        anyGp.vibrationActuator.playEffect('dual-rumble', {
          duration: durationMs,
          strongMagnitude: intensity,
          weakMagnitude: intensity * 0.85
        });
      }
    } catch {
      // Игнорируем аппаратные ошибки геймпада
    }
  }
}

// Кэш процедурной текстуры микрорельефа кожи (поры + дерматоглифика ладони)
let cachedSkinBumpTexture: THREE.CanvasTexture | null = null;
let cachedGloveGripBumpTexture: THREE.CanvasTexture | null = null;
let cachedSleeveWeaveBumpTexture: THREE.CanvasTexture | null = null;

function createAnatomicalSkinBumpTexture(): THREE.CanvasTexture {
  if (cachedSkinBumpTexture) return cachedSkinBumpTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgb(128, 128, 128)';
  ctx.fillRect(0, 0, 512, 512);

  // Мягкая микротекстура пор эпидермиса и дерматоглифики
  for (let i = 0; i < 28000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = Math.random() > 0.5 ? 142 : 114;
    ctx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.15)`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }

  // Тонкие сгибательные складки кожи на суставах и ладони
  ctx.strokeStyle = 'rgba(90, 90, 90, 0.28)';
  ctx.lineWidth = 1.3;
  for (let y = 20; y < 512; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(256, y + (Math.random() - 0.5) * 12, 512, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  cachedSkinBumpTexture = texture;
  return texture;
}

function createGloveGripBumpTexture(): THREE.CanvasTexture {
  if (cachedGloveGripBumpTexture) return cachedGloveGripBumpTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgb(128, 128, 128)';
  ctx.fillRect(0, 0, 512, 512);

  // Алмазное микро-рифление химстойких / нитриловых перчаток для уверенного хвата прибора
  const step = 12;
  for (let y = 0; y < 512; y += step) {
    const offset = ((y / step) % 2) * (step * 0.5);
    for (let x = -step; x < 512 + step; x += step) {
      ctx.fillStyle = 'rgb(168, 168, 168)';
      ctx.beginPath();
      ctx.moveTo(x + offset, y + 1.5);
      ctx.lineTo(x + offset + step * 0.36, y + step * 0.5);
      ctx.lineTo(x + offset, y + step - 1.5);
      ctx.lineTo(x + offset - step * 0.36, y + step * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Легкие складки резины/полимера вдоль сгибов
  ctx.strokeStyle = 'rgba(85, 85, 85, 0.35)';
  ctx.lineWidth = 2.0;
  for (let y = 40; y < 512; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y - 5, 340, y + 5, 512, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 2.5);
  cachedGloveGripBumpTexture = texture;
  return texture;
}

function createSleeveWeaveBumpTexture(): THREE.CanvasTexture {
  if (cachedSleeveWeaveBumpTexture) return cachedSleeveWeaveBumpTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgb(128, 128, 128)';
  ctx.fillRect(0, 0, 512, 512);

  // Тканое рипстоп-армирование защитного рукава + поперечные складки манжеты
  ctx.strokeStyle = 'rgba(155, 155, 155, 0.32)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 512; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  for (let y = 32; y < 512; y += 44) {
    const grad = ctx.createLinearGradient(0, y - 10, 0, y + 10);
    grad.addColorStop(0, 'rgba(128,128,128,0)');
    grad.addColorStop(0.5, 'rgba(72,72,72,0.45)');
    grad.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - 10, 512, 20);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  cachedSleeveWeaveBumpTexture = texture;
  return texture;
}

/**
 * Создание реалистичного PBR-материала кожи с roughness: 0.65 и мягким рельефом
 */
export function createAnatomicalSkinMaterial(): THREE.MeshPhysicalMaterial {
  const bumpMap = createAnatomicalSkinBumpTexture();
  return new THREE.MeshPhysicalMaterial({
    color: 0xe2b89b, // Естественный теплый телесный оттенок кожи
    roughness: 0.65, // Матовость кожи roughness = 0.65
    metalness: 0.02,
    bumpMap,
    bumpScale: 0.0006,
    transmission: 0.06,
    thickness: 0.015,
    attenuationColor: new THREE.Color(0xd96b52),
    attenuationDistance: 0.018,
    ior: 1.44,
    sheen: 0.28,
    sheenRoughness: 0.65,
    sheenColor: new THREE.Color(0xffdfc9),
    clearcoat: 0.08,
    clearcoatRoughness: 0.55
  });
}

export interface RealisticHumanHandRigOptions {
  handedness?: 'left' | 'right';
  withRadiometer?: boolean;
  withFlashlight?: boolean;
  initialFlashlightOn?: boolean;
}

export type HazmatHandRigOptions = RealisticHumanHandRigOptions;

export class RealisticHumanHandRig {
  public rootGroup: THREE.Group;
  public handGroup: THREE.Group;
  public palmGroup: THREE.Group; // Кость/группа анатомической ладони
  public forearmMesh: THREE.Mesh; // Короткий аккуратный срез запястья (без длинного предплечья)
  public radiometerGroup: THREE.Group; // Точка привязки прибора с калиброванным офсетом (0.01, -0.015, -0.04)
  public radiometerChassisGroup: THREE.Group; // Внутренний корпус прибора и детектора
  public probeAssemblyGroup: THREE.Group;
  public flashlight: VRFlashlight | null = null; // Интегрированный тактический фонарь левой руки (VRFlashlight)
  public lcdMesh?: THREE.Mesh;
  public lcdTexture?: THREE.CanvasTexture;
  public lcdCanvas?: HTMLCanvasElement;
  public lcdContext?: CanvasRenderingContext2D;
  public probeTipWorldPos: THREE.Vector3 = new THREE.Vector3();
  public handedness: 'left' | 'right';
  public hasRadiometer: boolean;
  public hasFlashlight: boolean;

  private fingers: Record<string, FingerJoints> = {};
  private handSkinMeshes: THREE.Mesh[] = [];
  private nailMeshes: THREE.Mesh[] = [];
  private sleeveMeshes: THREE.Mesh[] = [];
  private cuffSealMeshes: THREE.Mesh[] = [];
  private bareWristMeshes: THREE.Mesh[] = [];
  private sleeveEmblemMeshes: THREE.Mesh[] = [];
  private bopReflectiveMeshes: THREE.Mesh[] = [];
  private currentSuitId: string = 'none';
  private currentGripProgress = 0; // 0.0 = пальцы расправлены, 0.42/0.45 = Grip Pose прибора/фонаря, 1.0 = сжаты в кулак
  private targetGripProgress = 0;
  private triggerCurlInput = 0;
  private wristAngle = 0;
  private currentExtension = 0;
  private targetExtension = 0;
  private currentInstrumentId: InstrumentId = 'dp5';
  private desktopCameraPitch = 0;
  private smoothedPitchComp = 0;
  private swapOffsetZ = 0;
  private swapOffsetY = 0;
  private lastLcdRenderTimeMs = 0;
  private lastLcdKey = '';

  // Естественная базовая поза хвата прибора правой рукой (Grip Pose: curl = 0.42 в строгом диапазоне 0.35–0.50)
  public static readonly RADIOMETER_GRIP_POSE_CURL = 0.42;

  // Поза удержания цилиндрической рукоятки фонаря левой рукой (Grip Pose: curl = 0.45)
  public static readonly FLASHLIGHT_GRIP_POSE_CURL = 0.45;

  // Калиброванный локальный офсет прикрепления дозиметра относительно кости/группы правой ладони:
  // radiometer.position.set(0.01, -0.015, -0.04) и radiometer.rotation.set(-Math.PI / 4, Math.PI / 12, 0)
  public static readonly RADIOMETER_LOCAL_POS = new THREE.Vector3(0.01, -0.015, -0.04);
  public static readonly RADIOMETER_LOCAL_ROT = new THREE.Euler(-Math.PI / 4, Math.PI / 12, 0, 'XYZ');

  // Калиброванный локальный офсет прикрепления фонаря внутри ладони левой руки:
  // flashlightMesh.position.set(-0.02, 0.01, -0.03)
  public static readonly FLASHLIGHT_LOCAL_POS = new THREE.Vector3(-0.02, 0.01, -0.03);
  public static readonly FLASHLIGHT_LOCAL_ROT = new THREE.Euler(0, 0, 0, 'XYZ');

  // Калиброванный локальный базовый офсет кисти относительно контроллера / Grip в VR:
  // Совмещает анатомический центр ладони с рукояткой физического контроллера
  public static readonly VR_WRIST_OFFSET_POS = new THREE.Vector3(0, -0.004, 0.042);
  public static readonly VR_WRIST_OFFSET_ROT = new THREE.Euler(0, 0, 0, 'YXZ');

  // Переиспользуемые векторы и кватернионы без аллокаций в цикле update()
  private static readonly tempBaseRight = new THREE.Vector3(0.24, -0.22, -0.43);
  private static readonly tempBaseLeft = new THREE.Vector3(-0.24, -0.24, -0.42);
  private static readonly tempExtRight = new THREE.Vector3(0.09, -0.14, -0.84);
  private static readonly tempExtLeft = new THREE.Vector3(-0.11, -0.16, -0.76);
  private readonly tempTargetPos = new THREE.Vector3();
  private readonly tempProbeOffset = new THREE.Vector3();
  private readonly tempWorldQuat = new THREE.Quaternion();

  constructor(options: RealisticHumanHandRigOptions = {}) {
    this.handedness = options.handedness || 'right';
    // Правая рука создается с радиометром, а левая рука — с жестко привязанным тактическим фонарем VRFlashlight
    this.hasRadiometer =
      options.withRadiometer !== undefined ? options.withRadiometer : false;
    this.hasFlashlight =
      options.withFlashlight !== undefined
        ? options.withFlashlight
        : this.handedness === 'left' && !this.hasRadiometer;

    this.rootGroup = new THREE.Group();
    this.handGroup = new THREE.Group();
    this.palmGroup = new THREE.Group();
    this.radiometerGroup = new THREE.Group();
    this.radiometerChassisGroup = new THREE.Group();
    this.probeAssemblyGroup = new THREE.Group();

    if (this.hasRadiometer) {
      this.lcdCanvas = document.createElement('canvas');
      this.lcdCanvas.width = 512;
      this.lcdCanvas.height = 256;
      this.lcdContext = this.lcdCanvas.getContext('2d')!;
      this.lcdTexture = new THREE.CanvasTexture(this.lcdCanvas);
      this.lcdTexture.colorSpace = THREE.SRGBColorSpace;
      this.lcdTexture.minFilter = THREE.LinearFilter;
      this.lcdTexture.magFilter = THREE.LinearFilter;
    }

    // 1. PBR-материал кожи (roughness: 0.65) и легкий глянец ногтевых пластин
    const skinMat = createAnatomicalSkinMaterial();
    const nailMat = new THREE.MeshPhysicalMaterial({
      color: 0xf3d2c1,
      roughness: 0.32,
      metalness: 0.02,
      clearcoat: 0.45,
      clearcoatRoughness: 0.22
    });

    // 2. Иерархия кисти: rootGroup -> handGroup -> palmGroup
    this.handGroup.position.set(0, 0, 0);
    this.rootGroup.add(this.handGroup);
    this.handGroup.add(this.palmGroup);

    // 3. Анатомическое запястье + модульный рукав защитного костюма СИЗ (Hazmat Sleeve + Cuff Seal)
    const palmBaseY = this.hasRadiometer ? -0.036 : this.handedness === 'left' ? -0.018 : 0.0;
    this.forearmMesh = this.buildWristAndSleeve(skinMat, palmBaseY);

    // 4. Анатомическая ладонь и 5 пальцев:
    // Ладонная поверхность (Palmar surface) обращена к удерживаемому предмету (радиометру в правой руке, фонарю в левой руке)
    this.buildAnatomicalPalm(skinMat);
    this.buildAnatomicalFingers(skinMat, nailMat);

    // 5. Дозиметр-радиометр (для правой руки):
    // Прикрепляется к группе ладони со строгими локальными координатами:
    // radiometer.position.set(0.01, -0.015, -0.04) и radiometer.rotation.set(-Math.PI / 4, Math.PI / 12, 0)
    this.palmGroup.add(this.radiometerGroup);
    this.radiometerGroup.position.copy(RealisticHumanHandRig.RADIOMETER_LOCAL_POS);
    this.radiometerGroup.rotation.copy(RealisticHumanHandRig.RADIOMETER_LOCAL_ROT);

    if (this.hasRadiometer) {
      this.buildPhotorealisticRadiometer();
      this.renderLCD(0, 'dp5');
      // Переводим пальцы правой руки в физически естественную позу хвата (Grip Pose: curl = 0.42)
      this.currentGripProgress = RealisticHumanHandRig.RADIOMETER_GRIP_POSE_CURL;
      this.targetGripProgress = RealisticHumanHandRig.RADIOMETER_GRIP_POSE_CURL;
      this.applyFingerRotations(this.currentGripProgress);
    } else if (this.handedness === 'left' && this.hasFlashlight) {
      // 5.1. Жесткая привязка VRFlashlight к локальной иерархии левой руки (leftHandRig -> palmGroup):
      //      Модель фонаря, SpotLight и spotLight.target находятся строго внутри leftHandRig (НЕ в scene)
      this.flashlight = new VRFlashlight(Boolean(options.initialFlashlightOn));
      this.add(this.flashlight.flashlightMesh);
      this.flashlight.attachToLeftHand(this.palmGroup);
      // Переводим пальцы левой руки в позу удержания цилиндрического предмета (Grip Pose: curl = 0.45)
      this.currentGripProgress = RealisticHumanHandRig.FLASHLIGHT_GRIP_POSE_CURL;
      this.targetGripProgress = RealisticHumanHandRig.FLASHLIGHT_GRIP_POSE_CURL;
      this.applyFingerRotations(this.currentGripProgress);
    } else {
      this.currentGripProgress = 0.0;
      this.targetGripProgress = 0.0;
      this.applyFingerRotations(0.0);
    }

    // 6. Позиция кисти по умолчанию для Desktop-режима
    if (this.handedness === 'right') {
      this.rootGroup.position.copy(RealisticHumanHandRig.tempBaseRight);
      this.rootGroup.rotation.set(0.04, -0.08, 0.02);
    } else {
      this.rootGroup.position.copy(RealisticHumanHandRig.tempBaseLeft);
      this.rootGroup.rotation.set(0.04, 0.08, 0.0);
    }
  }

  /**
   * Прямое добавление дочернего объекта в локальную иерархию кисти (leftHandRig.add(flashlightMesh))
   */
  public add(object: THREE.Object3D): this {
    this.palmGroup.add(object);
    return this;
  }

  /**
   * Динамическое переприкрепление объекта в локальную систему координат кисти через .attach()
   * без мирового дрифта (leftHandRig.attach(flashlightMesh))
   */
  public attach(object: THREE.Object3D): this {
    this.palmGroup.attach(object);
    return this;
  }

  /**
   * Динамическая экипировка и жесткая привязка VRFlashlight в ладонь левой руки:
   * - Пересчитывает локальные координаты через .attach(flashlightMesh), исключая дрифт в мировом пространстве
   * - Фиксирует локальные офсеты рукоятки внутри ладони: position.set(-0.02, 0.01, -0.03)
   * - Направляет линзу и SpotLight + spotLight.target (0, 0, -5) строго вдоль оси -Z указательного пальца
   * - Переводит пальцы левой руки в позу хвата цилиндра (Grip Pose: curl = 0.45), большой палец фиксирует рукоятку сверху
   */
  public equipFlashlight(flashlightOrPower?: VRFlashlight | boolean, turnOn?: boolean): VRFlashlight {
    if (flashlightOrPower instanceof VRFlashlight) {
      this.flashlight = flashlightOrPower;
    } else if (!this.flashlight) {
      this.flashlight = new VRFlashlight(typeof flashlightOrPower === 'boolean' ? flashlightOrPower : false);
    }

    this.palmGroup.updateWorldMatrix(true, false);
    if (this.flashlight.flashlightMesh.parent && this.flashlight.flashlightMesh.parent !== this.palmGroup) {
      this.palmGroup.attach(this.flashlight.flashlightMesh);
    } else if (!this.flashlight.flashlightMesh.parent) {
      this.palmGroup.add(this.flashlight.flashlightMesh);
    }

    this.flashlight.attachToLeftHand(this.palmGroup);
    this.hasFlashlight = true;
    this.flashlight.flashlightMesh.visible = true;

    if (typeof flashlightOrPower === 'boolean') {
      this.flashlight.setPower(flashlightOrPower);
    } else if (typeof turnOn === 'boolean') {
      this.flashlight.setPower(turnOn);
    }

    // Фиксируем позу удержания цилиндрической рукоятки (curl = 0.45)
    this.targetGripProgress = Math.max(
      RealisticHumanHandRig.FLASHLIGHT_GRIP_POSE_CURL,
      this.targetGripProgress
    );
    this.currentGripProgress = RealisticHumanHandRig.FLASHLIGHT_GRIP_POSE_CURL;
    this.applyFingerRotations(this.currentGripProgress);

    return this.flashlight;
  }

  public setFlashlightPower(isOn: boolean): void {
    const fl = this.flashlight ?? this.equipFlashlight(isOn);
    fl.attachToLeftHand(this.palmGroup);
    fl.setPower(isOn);
  }

  public toggleFlashlight(): boolean {
    const fl = this.flashlight ?? this.equipFlashlight(false);
    fl.attachToLeftHand(this.palmGroup);
    return fl.toggle();
  }

  /**
   * Построение анатомически профилированного запястья, ульнарного выступа и модульного защитного рукава СИЗ
   * с гофрированной манжетой и герметизирующим хомутом.
   */
  private buildWristAndSleeve(skinMat: THREE.Material, palmBaseY: number): THREE.Mesh {
    const isLeft = this.handedness === 'left';

    // Анатомически сужающееся запястье (LatheGeometry по оси Y -> разворот вдоль +Z)
    const wristPts: THREE.Vector2[] = [
      new THREE.Vector2(0.001, 0.0),
      new THREE.Vector2(0.0265, 0.003),
      new THREE.Vector2(0.0290, 0.014), // лучезапястная складка
      new THREE.Vector2(0.0282, 0.026), // сужение запястья
      new THREE.Vector2(0.0305, 0.040), // переход в дистальное предплечье
      new THREE.Vector2(0.0320, 0.052),
      new THREE.Vector2(0.001, 0.054)
    ];
    const wristGeo = new THREE.LatheGeometry(wristPts, 28);
    wristGeo.rotateX(Math.PI / 2);
    wristGeo.scale(1.18, 0.78, 1.0);
    wristGeo.computeVertexNormals();

    const wristMesh = new THREE.Mesh(wristGeo, skinMat);
    wristMesh.position.set(0, palmBaseY, -0.004);
    wristMesh.castShadow = true;
    wristMesh.receiveShadow = true;
    this.palmGroup.add(wristMesh);
    this.handSkinMeshes.push(wristMesh);

    // Головка локтевой кости (Ulnar Styloid Process) — тонкий анатомический рельеф на внешнем крае запястья
    const ulnarGeo = new THREE.SphereGeometry(0.0085, 14, 12);
    ulnarGeo.scale(0.85, 0.65, 1.35);
    const ulnarBump = new THREE.Mesh(ulnarGeo, skinMat);
    ulnarBump.position.set(isLeft ? -0.027 : 0.027, palmBaseY - 0.004, 0.010);
    this.palmGroup.add(ulnarBump);
    this.handSkinMeshes.push(ulnarBump);
    this.bareWristMeshes.push(ulnarBump);

    // Дефолтный материал рукава (лабораторный/рабочий манжет при отсутствии химзащиты)
    const defaultSleeveMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.72,
      metalness: 0.04,
      bumpMap: createSleeveWeaveBumpTexture(),
      bumpScale: 0.0012
    });
    const defaultCuffMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.50,
      metalness: 0.25
    });

    // Основной защитный рукав СИЗ, плавно уходящий назад от запястья (z = 0.018 .. 0.118)
    const sleevePts: THREE.Vector2[] = [
      new THREE.Vector2(0.001, 0.0),
      new THREE.Vector2(0.0315, 0.003),
      new THREE.Vector2(0.0332, 0.015), // вход раструба перчатки
      new THREE.Vector2(0.0345, 0.032),
      new THREE.Vector2(0.0365, 0.056),
      new THREE.Vector2(0.0385, 0.082),
      new THREE.Vector2(0.0395, 0.098),
      new THREE.Vector2(0.001, 0.100)
    ];
    const sleeveGeo = new THREE.LatheGeometry(sleevePts, 30);
    sleeveGeo.rotateX(Math.PI / 2);
    sleeveGeo.scale(1.16, 0.84, 1.0);
    sleeveGeo.computeVertexNormals();

    const sleeveMesh = new THREE.Mesh(sleeveGeo, defaultSleeveMat);
    sleeveMesh.position.set(0, palmBaseY, 0.022);
    sleeveMesh.castShadow = true;
    sleeveMesh.receiveShadow = true;
    sleeveMesh.visible = false; // Виден при активном костюме СИЗ
    this.palmGroup.add(sleeveMesh);
    this.sleeveMeshes.push(sleeveMesh);

    // Гофрированные складки / кольцо фиксации запястного обтюратора (Corrugated Cuff Seal + Clamp Ring)
    [-0.002, 0.010, 0.022].forEach((zOff, idx) => {
      const ringGeo = new THREE.TorusGeometry(0.0338 + idx * 0.0008, 0.0026, 12, 32);
      ringGeo.scale(1.16, 0.84, 1.0);
      const ringMesh = new THREE.Mesh(ringGeo, defaultCuffMat);
      ringMesh.position.set(0, palmBaseY, 0.024 + zOff);
      ringMesh.castShadow = true;
      ringMesh.visible = false;
      this.palmGroup.add(ringMesh);
      this.cuffSealMeshes.push(ringMesh);
    });

    // Световозвращающая манжетная полоса БОП на рукаве
    const bopStripeGeo = new THREE.CylinderGeometry(0.0365, 0.0355, 0.018, 28, 1, true);
    bopStripeGeo.rotateX(Math.PI / 2);
    bopStripeGeo.scale(1.16, 0.84, 1.0);
    const bopStripeMat = new THREE.MeshStandardMaterial({
      map: createBopReflectiveStripeTexture(),
      roughness: 0.25,
      metalness: 0.45,
      emissive: new THREE.Color(0x65a30d),
      emissiveIntensity: 0.22
    });
    const bopStripeMesh = new THREE.Mesh(bopStripeGeo, bopStripeMat);
    bopStripeMesh.position.set(0, palmBaseY, 0.068);
    bopStripeMesh.visible = false;
    this.palmGroup.add(bopStripeMesh);
    this.bopReflectiveMeshes.push(bopStripeMesh);

    // Нарукавный шеврон «МЧС УЗБЕКИСТАНА» на внешней стороне рукава
    const emblemMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.034, 0.042),
      new THREE.MeshBasicMaterial({
        map: createMchsChevronTexture(),
        transparent: true,
        side: THREE.DoubleSide
      })
    );
    emblemMesh.position.set(isLeft ? -0.0435 : 0.0435, palmBaseY + 0.004, 0.095);
    emblemMesh.rotation.y = isLeft ? -Math.PI / 2 : Math.PI / 2;
    emblemMesh.visible = false;
    this.palmGroup.add(emblemMesh);
    this.sleeveEmblemMeshes.push(emblemMesh);

    return wristMesh;
  }

  /**
   * Процедурная лофт-геометрия анатомической ладони:
   * - Плавный профиль сечения от лучезапястной линии (z = +0.012) до пястно-фаланговых суставов (z = -0.092)
   * - Вогнутая ладонная поверхность (Palmar Arch) и выпуклая тыльная дуга с рельефом сухожилий
   */
  private createAnatomicalPalmGeometry(
    isLeft: boolean,
    palmarSign: number
  ): THREE.BufferGeometry {
    const zSteps = 18;
    const radialSegs = 28;
    const zStart = 0.012;
    const zEnd = -0.091;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const xSign = isLeft ? -1 : 1;

    for (let zi = 0; zi <= zSteps; zi++) {
      const v = zi / zSteps; // 0 = запястье, 1 = линия костяшек (MCP)
      const z = zStart + (zEnd - zStart) * v;

      // Ширина пястья: 3.15 см полуширина у запястья -> 4.35 см в дистальном отделе
      const halfWidth =
        0.0315 +
        0.0125 * Math.sin(Math.pow(v, 0.78) * Math.PI * 0.62) +
        0.003 * Math.sin(v * Math.PI);

      // Толщина ладони: чуть толще проксимально (1.28 см), тоньше к дистальному краю (1.02 см)
      const halfThick = 0.0128 - 0.0026 * Math.pow(v, 1.35);

      // Легкое анатомическое смещение центра пястья к мизинцу
      const centerX = xSign * (0.001 + 0.003 * v);

      // Завершающая шапочка на самом дистальном и проксимальном торцах
      const endCapScale =
        zi === 0 ? 0.35 : zi === zSteps ? 0.42 : 1.0;

      for (let ri = 0; ri <= radialSegs; ri++) {
        const u = ri / radialSegs;
        const theta = u * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        // Скругленный суперэллипс для естественной анатомической формы поперечного среза ладони
        const sqCos = Math.sign(cosT) * Math.pow(Math.abs(cosT), 0.78);
        const sqSin = Math.sign(sinT) * Math.pow(Math.abs(sinT), 0.88);

        let x = centerX + sqCos * halfWidth * endCapScale;
        let y = sqSin * halfThick * endCapScale;

        // Вогнутость ладонной ложбинки (Palmar Arch) и выпуклость тыла кисти
        const isPalmarSide = sinT * palmarSign > 0;
        const centerFactor = Math.max(0, 1 - Math.abs(cosT) * 1.15);
        if (isPalmarSide) {
          // Анатомическое углубление в центре ладони под рукоятку прибора / фонаря
          y -= palmarSign * 0.0024 * centerFactor * Math.sin(v * Math.PI);
        } else {
          // Тыльная выпуклость + 4 тонких гребня сухожилий разгибателей пальцев
          const tendonRipple =
            0.00075 *
            Math.pow(Math.max(0, Math.cos(cosT * Math.PI * 3.5)), 2) *
            Math.sin(v * Math.PI);
          y -= palmarSign * (0.0014 * centerFactor * Math.sin(v * Math.PI) + tendonRipple);
        }

        // Скос линии пястно-фаланговых суставов (мизинец короче, указательный длиннее)
        const fingerSweep =
          v > 0.72
            ? ((v - 0.72) / 0.28) *
              (xSign * cosT > 0 ? 0.0085 * Math.pow(Math.abs(cosT), 1.4) : 0.002)
            : 0;

        positions.push(x, y, z + fingerSweep);
        uvs.push(u, v);
      }
    }

    const rowStride = radialSegs + 1;
    for (let zi = 0; zi < zSteps; zi++) {
      for (let ri = 0; ri < radialSegs; ri++) {
        const a = zi * rowStride + ri;
        const b = a + 1;
        const c = (zi + 1) * rowStride + ri;
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Формирование анатомической ладони:
   * - Правая рука с радиометром (this.hasRadiometer === true):
   *   Ладонная поверхность обращена ВВЕРХ (+Y) к корпусу прибора (palmCenterY = -0.045), тыльная с костяшками — ВНИЗ (-Y).
   * - Левая рука с цилиндрическим фонарем (isLeft === true):
   *   Ладонная поверхность (palmCenterY = -0.020) поддерживает рукоятку фонаря без клиппинга, костяшки на тыльной стороне (-Y).
   */
  private buildAnatomicalPalm(skinMat: THREE.Material): void {
    const isLeft = this.handedness === 'left';
    const palmarSign = this.hasRadiometer || isLeft ? 1 : -1;
    const palmCenterY = this.hasRadiometer ? -0.045 : isLeft ? -0.020 : 0.0;

    // 1. Основное цельное скульптурное тело пястья с ладонной дугой и сухожилиями
    const palmGeo = this.createAnatomicalPalmGeometry(isLeft, palmarSign);
    const palmMesh = new THREE.Mesh(palmGeo, skinMat);
    palmMesh.position.set(0, palmCenterY, 0);
    palmMesh.castShadow = true;
    palmMesh.receiveShadow = true;
    this.palmGroup.add(palmMesh);
    this.handSkinMeshes.push(palmMesh);

    // 2. Возвышение большого пальца (Thenar Eminence) — органическая мышца на ладонной стороне
    const thenarGeo = new THREE.SphereGeometry(0.0205, 22, 18);
    thenarGeo.scale(1.10, 0.62, 1.56);
    const thenar = new THREE.Mesh(thenarGeo, skinMat);
    const thenarX = isLeft ? 0.022 : -0.023;
    thenar.position.set(thenarX, palmCenterY + palmarSign * 0.0068, -0.034);
    thenar.rotation.y = isLeft ? -0.28 : 0.28;
    thenar.castShadow = true;
    thenar.receiveShadow = true;
    this.palmGroup.add(thenar);
    this.handSkinMeshes.push(thenar);

    // 3. Возвышение мизинца (Hypothenar Eminence) — на ладонной стороне с локтевого края
    const hypothenarGeo = new THREE.SphereGeometry(0.0158, 18, 16);
    hypothenarGeo.scale(0.82, 0.62, 1.78);
    const hypothenar = new THREE.Mesh(hypothenarGeo, skinMat);
    hypothenar.position.set(isLeft ? -0.031 : 0.033, palmCenterY + palmarSign * 0.0065, -0.046);
    hypothenar.castShadow = true;
    hypothenar.receiveShadow = true;
    this.palmGroup.add(hypothenar);
    this.handSkinMeshes.push(hypothenar);

    // 4. Межпальцевые перепонки (Interdigital Web Spaces) для естественного перехода от пястья к основаниям пальцев
    const webPositions = isLeft
      ? [0.0125, -0.0065, -0.025]
      : [-0.0125, 0.0065, 0.025];
    webPositions.forEach((wx, idx) => {
      const webGeo = new THREE.SphereGeometry(0.0068, 12, 10);
      webGeo.scale(0.95, 0.68, 1.45);
      const webMesh = new THREE.Mesh(webGeo, skinMat);
      webMesh.position.set(wx, palmCenterY + palmarSign * 0.001, -0.085 + idx * 0.002);
      this.palmGroup.add(webMesh);
      this.handSkinMeshes.push(webMesh);
    });

    // 5. Костяшки пястно-фаланговых суставов (MCP Knuckles) — СТРОГО на тыльной (Dorsal) стороне ладони
    const knuckleOffsets = isLeft
      ? [0.024, 0.005, -0.014, -0.032]
      : [-0.024, -0.005, 0.014, 0.032];
    knuckleOffsets.forEach((kx, idx) => {
      const kSphere = new THREE.Mesh(new THREE.SphereGeometry(0.0082 - idx * 0.0004, 16, 14), skinMat);
      kSphere.scale.set(1.06, 0.62, 1.18);
      kSphere.position.set(kx, palmCenterY - palmarSign * 0.0088, -0.087 + Math.abs(idx - 1.2) * 0.003);
      kSphere.castShadow = true;
      this.palmGroup.add(kSphere);
      this.handSkinMeshes.push(kSphere);
    });
  }

  /**
   * Создает органическую скульптурную фалангу пальца (LatheGeometry с суставным расширением,
   * кожной складкой, мягкой ладонной подушечкой и анатомическим сужением к кончику пальца).
   */
  private createTaperedPhalanxMesh(
    proximalRadius: number,
    distalRadius: number,
    length: number,
    skinMat: THREE.Material,
    isDistalTip = false
  ): THREE.Group {
    const segGroup = new THREE.Group();

    const totalLen = Math.max(0.010, length);
    const pts: THREE.Vector2[] = [];
    const steps = 14;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps; // 0 = проксимальный сустав, 1 = дистальный сустав/кончик
      const y = t * totalLen;

      // Базовое сужение
      let r = proximalRadius + (distalRadius - proximalRadius) * t;

      // Небольшое утолщение проксимального сустава и легкая мышечная полнота середины фаланги
      const proxBulge = Math.exp(-Math.pow((t - 0.08) / 0.14, 2)) * proximalRadius * 0.08;
      const midPad = Math.sin(t * Math.PI) * proximalRadius * 0.055;

      // Складка сустава (тонкий кольцевой рельеф у 16% длины)
      const creaseDip = -Math.exp(-Math.pow((t - 0.22) / 0.06, 2)) * proximalRadius * 0.04;

      r += proxBulge + midPad + creaseDip;

      if (isDistalTip && t > 0.72) {
        // Плавное сферически-овальное закругление подушечки кончика пальца
        const tipT = (t - 0.72) / 0.28;
        r *= Math.sqrt(Math.max(0.001, 1 - tipT * tipT * 0.96));
      }

      pts.push(new THREE.Vector2(Math.max(0.0005, r), y));
    }

    // Закрываем полюса фаланги аккуратно
    pts.unshift(new THREE.Vector2(0.0005, -proximalRadius * 0.42));
    if (!isDistalTip) {
      pts.push(new THREE.Vector2(0.0005, totalLen + distalRadius * 0.36));
    } else {
      pts.push(new THREE.Vector2(0.0004, totalLen + distalRadius * 0.12));
    }

    const phalanxGeo = new THREE.LatheGeometry(pts, 20);
    // Поворачиваем ось Y LatheGeometry вдоль -Z (ось вытянутого пальца)
    phalanxGeo.rotateX(-Math.PI / 2);
    // Естественная дорсовентральная приплюснутость пальца
    phalanxGeo.scale(1.0, 0.86, 1.0);
    phalanxGeo.computeVertexNormals();

    const phalanxMesh = new THREE.Mesh(phalanxGeo, skinMat);
    phalanxMesh.castShadow = true;
    phalanxMesh.receiveShadow = true;
    segGroup.add(phalanxMesh);
    this.handSkinMeshes.push(phalanxMesh);

    return segGroup;
  }

  /**
   * Создание анатомически изогнутой ногтевой пластины
   */
  private createCurvedNailMesh(
    width: number,
    length: number,
    nailMat: THREE.Material,
    dorsalNailSign: number
  ): THREE.Mesh {
    const nailGeo = new THREE.CylinderGeometry(width * 0.52, width * 0.48, length, 14, 1, false, -Math.PI * 0.36, Math.PI * 0.72);
    nailGeo.rotateX(Math.PI / 2);
    nailGeo.scale(1.0, 0.32, 1.0);
    if (dorsalNailSign < 0) {
      nailGeo.rotateZ(Math.PI);
    }
    const nailMesh = new THREE.Mesh(nailGeo, nailMat);
    this.nailMeshes.push(nailMesh);
    return nailMesh;
  }

  /**
   * Построение 5 анатомических пальцев:
   * - Правая рука с радиометром (this.hasRadiometer === true):
   *   4 пальца охватывают корпус прибора (curl = 0.42), указательный палец вытянут вперед вдоль зонда (-Z).
   * - Левая рука с фонарем (isLeft === true):
   *   При curl = 0.45 (FLASHLIGHT_GRIP_POSE_CURL) 4 пальца плотно обхватывают цилиндрическую рукоятку фонаря
   *   в точке (-0.02, 0.01, -0.03) снизу и слева, а большой палец фиксирует рукоятку сверху (над кнопкой включения).
   */
  private buildAnatomicalFingers(skinMat: THREE.Material, nailMat: THREE.Material): void {
    const isLeft = this.handedness === 'left';
    const palmarUp = this.hasRadiometer;
    const palmCenterY = palmarUp ? -0.045 : isLeft ? -0.020 : 0.0;
    const dorsalNailSign = palmarUp || isLeft ? -1 : 1;

    const fingerDefs = [
      {
        name: 'thumb',
        x: isLeft ? 0.024 : palmarUp ? -0.033 : -0.039,
        y: isLeft ? palmCenterY + 0.018 : palmarUp ? palmCenterY + 0.016 : -0.006,
        z: isLeft ? -0.030 : palmarUp ? -0.038 : -0.036,
        length: 0.035,
        radius: 0.010,
        isThumb: true,
        splayY: isLeft ? -0.46 : 0.52
      },
      {
        name: 'index',
        x: isLeft ? 0.022 : palmarUp ? -0.020 : -0.029,
        y: palmCenterY + (palmarUp || isLeft ? 0.004 : 0.001),
        z: -0.088,
        length: 0.038,
        radius: 0.0086,
        isThumb: false,
        splayY: isLeft ? -0.04 : 0.04
      },
      {
        name: 'middle',
        x: isLeft ? 0.003 : palmarUp ? 0.001 : -0.009,
        y: palmCenterY + (palmarUp || isLeft ? 0.003 : 0.002),
        z: -0.091,
        length: 0.041,
        radius: 0.0090,
        isThumb: false,
        splayY: 0.0
      },
      {
        name: 'ring',
        x: isLeft ? -0.016 : palmarUp ? 0.021 : 0.010,
        y: palmCenterY + (palmarUp || isLeft ? 0.004 : 0.001),
        z: -0.088,
        length: 0.037,
        radius: 0.0085,
        isThumb: false,
        splayY: isLeft ? 0.04 : -0.04
      },
      {
        name: 'pinky',
        x: isLeft ? -0.034 : palmarUp ? 0.039 : 0.028,
        y: palmCenterY + (palmarUp || isLeft ? 0.006 : -0.001),
        z: -0.082,
        length: 0.031,
        radius: 0.0075,
        isThumb: false,
        splayY: isLeft ? 0.08 : -0.08
      }
    ];

    fingerDefs.forEach(def => {
      const proximal = new THREE.Group();
      proximal.name = `finger_${def.name}`;
      proximal.position.set(def.x, def.y, def.z);

      const r0 = def.radius;
      const r1 = def.radius * 0.86;
      const proxPhalanx = this.createTaperedPhalanxMesh(r0, r1, def.length, skinMat, false);
      proximal.add(proxPhalanx);

      if (def.isThumb) {
        const distal = new THREE.Group();
        distal.position.set(0, 0, -def.length * 0.92);

        const distLen = def.length * 0.82;
        const r2 = def.radius * 0.68;
        const distPhalanx = this.createTaperedPhalanxMesh(r1, r2, distLen, skinMat, true);
        distal.add(distPhalanx);

        const nail = this.createCurvedNailMesh(r2 * 1.48, distLen * 0.46, nailMat, dorsalNailSign);
        nail.position.set(0, dorsalNailSign * r2 * 0.52, -distLen * 0.58);
        nail.rotation.x = dorsalNailSign * 0.08;
        distal.add(nail);

        proximal.add(distal);
        this.palmGroup.add(proximal);

        if (palmarUp) {
          // Большой палец правой руки ложится точно на боковую/верхнюю левую грань корпуса радиометра без пересечения
          this.fingers['thumb'] = {
            proximal,
            distal,
            baseRotations: {
              proximal: new THREE.Euler(-0.32, 0.22, 0.25),
              distal: new THREE.Euler(-0.18, -0.08, 0)
            },
            gripRotations: {
              proximal: new THREE.Euler(-0.56, -0.18, 0.42),
              distal: new THREE.Euler(-0.48, -0.22, 0.10)
            }
          };
        } else if (isLeft) {
          // Большой палец левой руки при curl ≈ 0.45 огибает цилиндрическую рукоятку фонаря (-0.02, 0.01, -0.03)
          // и фиксирует ее сверху прямо над тактической кнопкой включения
          this.fingers['thumb'] = {
            proximal,
            distal,
            baseRotations: {
              proximal: new THREE.Euler(0.28, -0.42, 0.32),
              distal: new THREE.Euler(0.10, 0, 0)
            },
            gripRotations: {
              proximal: new THREE.Euler(0.76, 0.82, 0.56),
              distal: new THREE.Euler(-0.42, 0.28, -0.15)
            }
          };
        } else {
          this.fingers['thumb'] = {
            proximal,
            distal,
            baseRotations: {
              proximal: new THREE.Euler(0.18, 0.55, -0.32),
              distal: new THREE.Euler(0.12, 0, 0)
            },
            gripRotations: {
              proximal: new THREE.Euler(0.88, 0.98, -0.68),
              distal: new THREE.Euler(0.85, 0.08, 0)
            }
          };
        }
      } else {
        const intermediate = new THREE.Group();
        intermediate.position.set(0, 0, -def.length * 0.92);

        const interLen = def.length * 0.72;
        const r2 = def.radius * 0.74;
        const interPhalanx = this.createTaperedPhalanxMesh(r1, r2, interLen, skinMat, false);
        intermediate.add(interPhalanx);
        proximal.add(intermediate);

        const distal = new THREE.Group();
        distal.position.set(0, 0, -interLen * 0.90);

        const distLen = def.length * 0.62;
        const r3 = def.radius * 0.58;
        const distPhalanx = this.createTaperedPhalanxMesh(r2, r3, distLen, skinMat, true);
        distal.add(distPhalanx);

        const nail = this.createCurvedNailMesh(r3 * 1.48, distLen * 0.48, nailMat, dorsalNailSign);
        nail.position.set(0, dorsalNailSign * r3 * 0.54, -distLen * 0.56);
        nail.rotation.x = dorsalNailSign * 0.08;
        distal.add(nail);

        intermediate.add(distal);
        this.palmGroup.add(proximal);

        if (palmarUp) {
          // В супинированной правой ладони пальцы огибают корпус прибора снизу вверх,
          // а указательный палец направлен вперед вдоль выносного датчика (-Z)
          const isIndex = def.name === 'index';
          const isPinky = def.name === 'pinky';
          this.fingers[def.name] = {
            proximal,
            intermediate,
            distal,
            baseRotations: {
              proximal: new THREE.Euler(-0.08, def.splayY, 0),
              intermediate: new THREE.Euler(-0.12, 0, 0),
              distal: new THREE.Euler(-0.08, 0, 0)
            },
            gripRotations: {
              proximal: new THREE.Euler(isIndex ? -0.34 : isPinky ? -0.78 : -0.62, def.splayY * 0.3, isPinky ? 0.18 : 0.06),
              intermediate: new THREE.Euler(isIndex ? -0.45 : -0.88, 0, 0),
              distal: new THREE.Euler(isIndex ? -0.32 : -0.68, 0, 0)
            }
          };
        } else if (isLeft) {
          // Пальцы левой руки в позе удержания цилиндрического корпуса фонаря (при curl ≈ 0.45):
          // охватывают цилиндр фонаря (-0.02, 0.01, -0.03) снизу и слева с направлением вдоль оси -Z
          const isIndex = def.name === 'index';
          this.fingers[def.name] = {
            proximal,
            intermediate,
            distal,
            baseRotations: {
              proximal: new THREE.Euler(0.10, def.splayY, 0),
              intermediate: new THREE.Euler(0.14, 0, 0),
              distal: new THREE.Euler(0.08, 0, 0)
            },
            gripRotations: {
              proximal: new THREE.Euler(isIndex ? 1.05 : 1.26, def.splayY * 0.22, -0.06),
              intermediate: new THREE.Euler(isIndex ? 1.28 : 1.48, 0, 0),
              distal: new THREE.Euler(isIndex ? 0.96 : 1.14, 0, 0)
            }
          };
        } else {
          this.fingers[def.name] = {
            proximal,
            intermediate,
            distal,
            baseRotations: {
              proximal: new THREE.Euler(0.10, def.splayY, 0),
              intermediate: new THREE.Euler(0.14, 0, 0),
              distal: new THREE.Euler(0.08, 0, 0)
            },
            gripRotations: {
              proximal: new THREE.Euler(1.22, def.splayY * 0.25, 0),
              intermediate: new THREE.Euler(1.42, 0, 0),
              distal: new THREE.Euler(1.05, 0, 0)
            }
          };
        }
      }
    });
  }

  /**
   * Построение фотореалистичного дозиметра-радиометра ГОСТ 27451-87 внутри ладони правой руки:
   * - Корпус находится строго со стороны ладонной поверхности (Palmar surface) в точке (0.01, -0.015, -0.04).
   * - Дисплей и кнопки управления смотрят НАВЕРХ и НА ПОЛЬЗОВАТЕЛЯ.
   * - Выносной датчик / блок детектора направлен строго ВПЕРЕД вдоль указательного пальца (-Z).
   */
  private buildPhotorealisticRadiometer(): void {
    // Выравниваем внутреннее шасси относительно якоря radiometerGroup (-Math.PI / 4, Math.PI / 12, 0),
    // чтобы ось детектора шла строго вдоль указательного пальца (-Z), а экран смотрел вверх/на пользователя
    const anchorQuat = new THREE.Quaternion().setFromEuler(RealisticHumanHandRig.RADIOMETER_LOCAL_ROT);
    const desiredHandSpaceQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.08, 0.0, 0.0, 'YXZ')
    );
    this.radiometerChassisGroup.quaternion
      .copy(anchorQuat)
      .invert()
      .multiply(desiredHandSpaceQuat);
    this.radiometerGroup.add(this.radiometerChassisGroup);

    const casingMat = createPolymerCasingMaterial(0x1e293b);
    // Эргономичный корпус радиометра (ширина 6.4 см, высота 3.4 см, длина 14.0 см) — лежит внутри ладони без клиппинга
    const bodyGeo = new RoundedBoxGeometry(0.064, 0.034, 0.140, 5, 0.003);
    const bodyMesh = new THREE.Mesh(bodyGeo, casingMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.radiometerChassisGroup.add(bodyMesh);

    const bumperMat = createRubberSSSMaterial({
      color: 0x090d16,
      attenuationColor: 0x334155,
      roughness: 0.52,
      transmission: 0.16,
      thickness: 0.016
    });
    const bumperGeo = new RoundedBoxGeometry(0.068, 0.037, 0.022, 5, 0.003);

    const bumperFront = new THREE.Mesh(bumperGeo, bumperMat);
    bumperFront.position.set(0, 0, -0.062);
    this.radiometerChassisGroup.add(bumperFront);

    const bumperRear = new THREE.Mesh(bumperGeo, bumperMat);
    bumperRear.position.set(0, 0, 0.062);
    this.radiometerChassisGroup.add(bumperRear);

    // Оптический ЖК-дисплей на ВЕРХНЕЙ грани корпуса — смотрит наверх и чуть наклонен на пользователя
    if (this.lcdTexture) {
      const { displayGroup, lcdCrystalMesh } = createMultiLayerOpticalDisplay({
        width: 0.052,
        height: 0.036,
        lcdTexture: this.lcdTexture,
        innerDepthMeters: 0.0020,
        bezelColor: 0x0f172a
      });
      this.lcdMesh = lcdCrystalMesh;
      displayGroup.rotation.x = -Math.PI / 2.35; // Смотрит вверх и под удобным углом к глазам оператора
      displayGroup.position.set(0, 0.0185, -0.014);
      this.radiometerChassisGroup.add(displayGroup);
    }

    // Органы управления (кнопки РЕЖИМ / ПОРОГ и селектор поддиапазонов) на верхней грани прибора
    const metalContactMat = createMetalConnectorMaterial(0xe2e8f0);
    const btnYellowMat = createRubberSSSMaterial({
      color: 0xf59e0b,
      attenuationColor: 0xfef08a,
      roughness: 0.35,
      transmission: 0.28,
      thickness: 0.006
    });
    const btnDarkMat = createPolymerCasingMaterial(0x334155);
    const btnGeo = new RoundedBoxGeometry(0.010, 0.0045, 0.0075, 4, 0.0008);

    [-0.017, 0.017].forEach((bx, idx) => {
      const btn = new THREE.Mesh(btnGeo, idx === 0 ? btnYellowMat : btnDarkMat);
      btn.position.set(bx, 0.0185, 0.022);
      this.radiometerChassisGroup.add(btn);
    });

    const dialGroup = new THREE.Group();
    dialGroup.position.set(0, 0.0185, 0.038);
    dialGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0105, 0.0055, 24), btnDarkMat));
    const dialPointer = new THREE.Mesh(
      new RoundedBoxGeometry(0.0028, 0.0032, 0.014, 3, 0.0008),
      btnYellowMat
    );
    dialPointer.position.y = 0.0035;
    dialGroup.add(dialPointer);
    this.radiometerChassisGroup.add(dialGroup);

    // Разъем LEMO и гибкий кабель к блоку детектирования
    const connectorGroup = new THREE.Group();
    connectorGroup.position.set(-0.015, 0.003, -0.075);
    connectorGroup.rotation.x = Math.PI / 2;
    connectorGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.014, 20), metalContactMat));
    this.radiometerChassisGroup.add(connectorGroup);

    const catenaryCable = createCatenaryCableMesh(
      new THREE.Vector3(-0.015, 0.003, -0.088),
      new THREE.Vector3(0, 0.003, -0.086),
      {
        cableRadius: 0.0022,
        sagParameterA: 0.034,
        helicalTurns: 7,
        helicalRadius: 0.0028,
        color: 0x18181b
      }
    );
    this.radiometerChassisGroup.add(catenaryCable);

    // Выносной датчик / блок детектора направлен строго вперед по направлению указательного пальца (вдоль -Z)
    this.radiometerChassisGroup.add(this.probeAssemblyGroup);
    this.rebuildProbeGeometry('dp5');
  }

  public rebuildProbeGeometry(instrumentId: InstrumentId): void {
    this.currentInstrumentId = instrumentId;
    while (this.probeAssemblyGroup.children.length > 0) {
      this.probeAssemblyGroup.remove(this.probeAssemblyGroup.children[0]);
    }

    const metalMat = createMetalConnectorMaterial(0xdbeafe);
    const brassFilterMat = createMetalConnectorMaterial(0xf59e0b);
    const darkPolymerMat = createPolymerCasingMaterial(0x1e293b);
    const titaniumMat = createMetalConnectorMaterial(0x94a3b8);
    const amberFilterMat = createPolymerCasingMaterial(0xd97706);
    const gripSSSMat = createRubberSSSMaterial({
      color: 0x0f172a,
      attenuationColor: 0x38bdf8,
      roughness: 0.44,
      transmission: 0.22,
      thickness: 0.014
    });

    if (instrumentId === 'dp5') {
      const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.0095, 0.044, 24), gripSSSMat);
      holder.rotation.x = Math.PI / 2;
      holder.position.set(0, 0.003, -0.094);
      this.probeAssemblyGroup.add(holder);

      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0092, 0.0092, 0.142, 28), metalMat);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.003, -0.148);
      tube.castShadow = true;
      this.probeAssemblyGroup.add(tube);

      const shutter = new THREE.Mesh(new THREE.CylinderGeometry(0.0108, 0.0108, 0.054, 28), brassFilterMat);
      shutter.rotation.x = Math.PI / 2;
      shutter.position.set(0, 0.003, -0.178);
      this.probeAssemblyGroup.add(shutter);

      [-0.154, -0.202].forEach(rz => {
        const knurlRing = new THREE.Mesh(new THREE.TorusGeometry(0.0110, 0.0011, 12, 28), metalMat);
        knurlRing.position.set(0, 0.003, rz);
        this.probeAssemblyGroup.add(knurlRing);
      });

      const endCap = new THREE.Mesh(new THREE.CylinderGeometry(0.0112, 0.0102, 0.008, 24), darkPolymerMat);
      endCap.rotation.x = Math.PI / 2;
      endCap.position.set(0, 0.003, -0.218);
      this.probeAssemblyGroup.add(endCap);
    } else if (instrumentId === 'mica_gm') {
      // МКС-01СА1М — Торцевой слюдяной счетчик (Pancake / Бета-1)
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.065, 24), gripSSSMat);
      stem.rotation.x = Math.PI / 2;
      stem.position.set(0, 0.004, -0.105);
      this.probeAssemblyGroup.add(stem);

      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.024, 32), createPolymerCasingMaterial(0xb91c1c));
      housing.rotation.x = Math.PI / 2;
      housing.position.set(0, 0.004, -0.155);
      housing.castShadow = true;
      this.probeAssemblyGroup.add(housing);

      const meshGrid = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.004, 32), titaniumMat);
      meshGrid.rotation.x = Math.PI / 2;
      meshGrid.position.set(0, 0.004, -0.168);
      this.probeAssemblyGroup.add(meshGrid);

      const micaWindow = new THREE.Mesh(
        new THREE.CircleGeometry(0.025, 32),
        new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.85 })
      );
      micaWindow.position.set(0, 0.004, -0.171);
      this.probeAssemblyGroup.add(micaWindow);
    } else if (instrumentId === 'hemispheric_gm') {
      // Полусферический энергокомпенсированный датчик
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.088, 24), metalMat);
      stem.rotation.x = Math.PI / 2;
      stem.position.set(0, 0.003, -0.118);
      this.probeAssemblyGroup.add(stem);

      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.022, 28, 28, 0, Math.PI * 2, 0, Math.PI / 2), brassFilterMat);
      dome.rotation.x = -Math.PI / 2;
      dome.position.set(0, 0.003, -0.162);
      dome.castShadow = true;
      this.probeAssemblyGroup.add(dome);
    } else if (instrumentId === 'ion') {
      // Ионизационная камера (ВР-01 / ДРГ)
      const chamberBarrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.026, 0.115, 32),
        createPolymerCasingMaterial(0x334155)
      );
      chamberBarrel.rotation.x = Math.PI / 2;
      chamberBarrel.position.set(0, 0.008, -0.148);
      chamberBarrel.castShadow = true;
      this.probeAssemblyGroup.add(chamberBarrel);

      const frontBezel = new THREE.Mesh(new THREE.TorusGeometry(0.0245, 0.0028, 16, 32), brassFilterMat);
      frontBezel.position.set(0, 0.008, -0.206);
      this.probeAssemblyGroup.add(frontBezel);
    } else if (instrumentId === 'nai') {
      // Сцинтиллятор NaI(Tl) со сцинтилляционным кристаллом и ФЭУ
      const pmtTube = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.108, 28), darkPolymerMat);
      pmtTube.rotation.x = Math.PI / 2;
      pmtTube.position.set(0, 0.004, -0.132);
      this.probeAssemblyGroup.add(pmtTube);

      const crystalHead = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.018, 0.062, 32), metalMat);
      crystalHead.rotation.x = Math.PI / 2;
      crystalHead.position.set(0, 0.004, -0.194);
      crystalHead.castShadow = true;
      this.probeAssemblyGroup.add(crystalHead);
    } else if (instrumentId === 'alpha_zns') {
      // Альфа-радиометр ZnS(Ag) со световодом
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.060, 24), darkPolymerMat);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(0, 0.004, -0.100);
      this.probeAssemblyGroup.add(handle);

      const boxHead = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.038, 0.045), titaniumMat);
      boxHead.position.set(0, 0.004, -0.150);
      boxHead.castShadow = true;
      this.probeAssemblyGroup.add(boxHead);

      const znsScreen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.044, 0.030),
        new THREE.MeshStandardMaterial({ color: 0xa3e635, roughness: 0.2, metalness: 0.4 })
      );
      znsScreen.position.set(0, 0.004, -0.173);
      this.probeAssemblyGroup.add(znsScreen);
    } else if (instrumentId === 'cdznte') {
      // Полупроводниковый детектор CdZnTe (высокотехнологичный спектрометрический микрозонд)
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.075, 24), titaniumMat);
      stem.rotation.x = Math.PI / 2;
      stem.position.set(0, 0.003, -0.115);
      this.probeAssemblyGroup.add(stem);

      const czthead = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.032), darkPolymerMat);
      czthead.position.set(0, 0.003, -0.165);
      czthead.castShadow = true;
      this.probeAssemblyGroup.add(czthead);

      const goldContact = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.004), brassFilterMat);
      goldContact.position.set(0, 0.003, -0.182);
      this.probeAssemblyGroup.add(goldContact);
    } else if (instrumentId === 'pips') {
      // Кремниевый планарный PIPS-детектор с ультратонким окном
      const pipsStem = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.070, 24), metalMat);
      pipsStem.rotation.x = Math.PI / 2;
      pipsStem.position.set(0, 0.003, -0.112);
      this.probeAssemblyGroup.add(pipsStem);

      const pipsCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.020, 32), titaniumMat);
      pipsCollar.rotation.x = Math.PI / 2;
      pipsCollar.position.set(0, 0.003, -0.155);
      this.probeAssemblyGroup.add(pipsCollar);

      const siliconChip = new THREE.Mesh(
        new THREE.CircleGeometry(0.015, 32),
        new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.05, metalness: 0.95 })
      );
      siliconChip.position.set(0, 0.003, -0.166);
      this.probeAssemblyGroup.add(siliconChip);
    } else if (instrumentId === 'neutron') {
      // Нейтронный рем-метр — замедляющая сфера Боннера
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0088, 0.0088, 0.072, 20), metalMat);
      stem.rotation.x = Math.PI / 2;
      stem.position.set(0, 0.004, -0.112);
      this.probeAssemblyGroup.add(stem);

      const polySSSMat = createRubberSSSMaterial({
        color: 0xe2e8f0,
        attenuationColor: 0x93c5fd,
        roughness: 0.38,
        transmission: 0.28,
        thickness: 0.045
      });
      const bonnerSphere = new THREE.Mesh(new THREE.SphereGeometry(0.044, 32, 32), polySSSMat);
      bonnerSphere.position.set(0, 0.006, -0.184);
      bonnerSphere.castShadow = true;
      this.probeAssemblyGroup.add(bonnerSphere);
    }
  }

  /**
   * Смена материала перчаток, рукава и манжеты СИЗ в реальном времени
   */
  public setGloveSuitMaterial(suitOrPpeId: string): void {
    this.currentSuitId = suitOrPpeId || 'none';
    const gloveBump = createGloveGripBumpTexture();
    const sleeveBump = createSleeveWeaveBumpTexture();

    let gloveMat: THREE.Material;
    let sleeveMat: THREE.Material | null = null;
    let cuffMat: THREE.Material | null = null;
    let isGloved = true;

    if (suitOrPpeId === 'bop_suit' || suitOrPpeId === 'bop_firefighter') {
      // Боевая одежда пожарного МЧС БОП-1: термостойкие диэлектрические краги + арамидный темно-синий рукав
      gloveMat = new THREE.MeshPhysicalMaterial({
        color: 0x1c1917,
        roughness: 0.48,
        metalness: 0.14,
        clearcoat: 0.25,
        clearcoatRoughness: 0.35,
        bumpMap: gloveBump,
        bumpScale: 0.0013,
        name: 'bop_dielectric_gloves'
      });
      sleeveMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.65,
        metalness: 0.10,
        bumpMap: sleeveBump,
        bumpScale: 0.0018,
        name: 'bop_aramid_sleeve'
      });
      cuffMat = new THREE.MeshStandardMaterial({
        color: 0xea580c,
        roughness: 0.36,
        metalness: 0.25
      });
    } else if (suitOrPpeId === 'lead_apron' || suitOrPpeId === 'pneumosuit_lead') {
      // Свинцовые виниловые перчатки (цианово-синий резиносвинец) + свинцово-синий рукав
      gloveMat = new THREE.MeshPhysicalMaterial({
        color: 0x0284c7,
        roughness: 0.34,
        metalness: 0.24,
        clearcoat: 0.35,
        clearcoatRoughness: 0.28,
        bumpMap: gloveBump,
        bumpScale: 0.0009,
        name: 'lead_apron_gloves'
      });
      sleeveMat = new THREE.MeshStandardMaterial({
        color: 0x1e3a8a,
        roughness: 0.52,
        metalness: 0.16,
        bumpMap: sleeveBump,
        bumpScale: 0.0014,
        name: 'lead_apron_sleeve'
      });
      cuffMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.35,
        metalness: 0.55
      });
    } else if (suitOrPpeId === 'l1_suit' || suitOrPpeId === 'basic_ppe') {
      // Защитный костюм Л-1 (оливковая вулканизированная резина Т-15)
      gloveMat = new THREE.MeshPhysicalMaterial({
        color: 0x4d7c0f,
        roughness: 0.56,
        metalness: 0.08,
        sheen: 0.2,
        sheenRoughness: 0.6,
        bumpMap: gloveBump,
        bumpScale: 0.0012,
        name: 'l1_rubber_gloves'
      });
      sleeveMat = new THREE.MeshStandardMaterial({
        color: 0x3f6212,
        roughness: 0.62,
        metalness: 0.08,
        bumpMap: sleeveBump,
        bumpScale: 0.0016,
        name: 'l1_rubber_sleeve'
      });
      cuffMat = new THREE.MeshStandardMaterial({
        color: 0x111827,
        roughness: 0.6,
        metalness: 0.15
      });
    } else if (suitOrPpeId === 'kih4_suit' || suitOrPpeId === 'hazmat_suit') {
      // Изолирующий комплекс КИХ-4 (ярко-оранжевые химстойкие рукавицы + герметизирующее кольцо)
      gloveMat = new THREE.MeshPhysicalMaterial({
        color: 0xf59e0b,
        roughness: 0.28,
        metalness: 0.14,
        clearcoat: 0.45,
        clearcoatRoughness: 0.22,
        bumpMap: gloveBump,
        bumpScale: 0.0010,
        name: 'kih4_hazmat_gloves'
      });
      sleeveMat = new THREE.MeshStandardMaterial({
        color: 0xea580c,
        roughness: 0.36,
        metalness: 0.12,
        bumpMap: sleeveBump,
        bumpScale: 0.0012,
        name: 'kih4_hazmat_sleeve'
      });
      cuffMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.42,
        metalness: 0.45
      });
    } else if (suitOrPpeId === 'heavy_lead_armor' || suitOrPpeId === 'heavy_lead_suit') {
      // Тяжелый экранирующий комплект ликвидатора (свинцовые латные краги и стальной хомут)
      gloveMat = new THREE.MeshPhysicalMaterial({
        color: 0x334155,
        roughness: 0.38,
        metalness: 0.68,
        clearcoat: 0.22,
        bumpMap: gloveBump,
        bumpScale: 0.0011,
        name: 'heavy_lead_gauntlets'
      });
      sleeveMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.46,
        metalness: 0.52,
        bumpMap: sleeveBump,
        bumpScale: 0.0018,
        name: 'heavy_lead_sleeve'
      });
      cuffMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.28,
        metalness: 0.85
      });
    } else {
      // Без СИЗ — естественная анатомическая кожа с открытыми ногтями
      gloveMat = createAnatomicalSkinMaterial();
      isGloved = false;
    }

    // Применяем материал ко всем сегментам ладони, запястья и каждой фаланги пальцев (без затрагивания приборов/фонаря)
    for (let i = 0; i < this.handSkinMeshes.length; i++) {
      this.handSkinMeshes[i].material = gloveMat;
    }
    for (let i = 0; i < this.nailMeshes.length; i++) {
      this.nailMeshes[i].visible = !isGloved;
    }
    for (let i = 0; i < this.bareWristMeshes.length; i++) {
      this.bareWristMeshes[i].visible = !isGloved;
    }
    for (let i = 0; i < this.sleeveMeshes.length; i++) {
      const m = this.sleeveMeshes[i];
      m.visible = isGloved;
      if (sleeveMat) m.material = sleeveMat;
    }
    for (let i = 0; i < this.cuffSealMeshes.length; i++) {
      const c = this.cuffSealMeshes[i];
      c.visible = isGloved;
      if (cuffMat) c.material = cuffMat;
    }
    const isBop = suitOrPpeId === 'bop_suit' || suitOrPpeId === 'bop_firefighter';
    for (let i = 0; i < this.bopReflectiveMeshes.length; i++) {
      this.bopReflectiveMeshes[i].visible = isBop;
    }
    for (let i = 0; i < this.sleeveEmblemMeshes.length; i++) {
      this.sleeveEmblemMeshes[i].visible = isGloved;
    }
  }

  public setPpeState(state: { suitId?: string }): void {
    this.setGloveSuitMaterial(state?.suitId || 'none');
  }

  public getSuitId(): string {
    return this.currentSuitId;
  }

  /**
   * Прямая привязка сгибания фаланг пальцев к аналоговому значению триггера контроллера:
   * - Для левой руки с экипированным фонарем (this.hasFlashlight): базовая поза удержания цилиндра
   *   составляет FLASHLIGHT_GRIP_POSE_CURL (curl ≈ 0.45), а при нажатии триггера пальцы плотнее обжимают рукоятку до 0.52.
   * - Для правой руки с радиометром: базовая поза хвата составляет RADIOMETER_GRIP_POSE_CURL (0.42, в окне 0.35–0.5),
   *   а при нажатии триггера пальцы плотнее обжимают корпус до 0.50 без клиппинга сквозь прибор.
   * - Для полностью свободной кисти: curl = 0.0 (расправлены) .. 1.0 (сжаты в кулак).
   */
  public setFingerCurl(curl: number): void {
    const clamped = Math.max(0.0, Math.min(1.0, curl));
    this.triggerCurlInput = clamped;

    if (this.hasRadiometer) {
      this.targetGripProgress =
        RealisticHumanHandRig.RADIOMETER_GRIP_POSE_CURL +
        clamped * (0.50 - RealisticHumanHandRig.RADIOMETER_GRIP_POSE_CURL);
    } else if (this.hasFlashlight) {
      this.targetGripProgress =
        RealisticHumanHandRig.FLASHLIGHT_GRIP_POSE_CURL +
        clamped * (0.52 - RealisticHumanHandRig.FLASHLIGHT_GRIP_POSE_CURL);
    } else {
      this.targetGripProgress = clamped;
    }
  }

  public setGripTarget(gripped: boolean): void {
    if (this.hasRadiometer) {
      this.targetGripProgress = gripped ? 0.50 : RealisticHumanHandRig.RADIOMETER_GRIP_POSE_CURL;
    } else if (this.hasFlashlight) {
      this.targetGripProgress = gripped ? 0.52 : RealisticHumanHandRig.FLASHLIGHT_GRIP_POSE_CURL;
    } else {
      this.targetGripProgress = gripped ? 1.0 : 0.0;
    }
  }

  /**
   * Управление физическим хватом радиометра-дозиметра в ладони ПРАВОЙ руки (Правый Грип / squeeze):
   * - Удерживание (isGripping = true): плотный хват радиометра в ладони (перевод пальцев в позу Grip Pose)
   * - Отпускание (isGripping = false): возврат радиометра в дефолтную позицию хватов (0.01, -0.015, -0.04)
   */
  public setRightRadiometerGripPose(isGripping: boolean, gripValue = 1.0): void {
    if (!this.hasRadiometer) return;
    if (isGripping) {
      const clampedGrip = Math.max(0.35, Math.min(1.0, gripValue));
      this.targetGripProgress =
        RealisticHumanHandRig.RADIOMETER_GRIP_POSE_CURL + clampedGrip * 0.14;
      this.radiometerGroup.position.set(0.008, -0.013, -0.044);
      this.radiometerGroup.rotation.set(-Math.PI / 3.85, Math.PI / 12, 0);
    } else {
      this.targetGripProgress = RealisticHumanHandRig.RADIOMETER_GRIP_POSE_CURL;
      this.radiometerGroup.position.copy(RealisticHumanHandRig.RADIOMETER_LOCAL_POS);
      this.radiometerGroup.rotation.copy(RealisticHumanHandRig.RADIOMETER_LOCAL_ROT);
    }
  }

  public toggleGrip(): boolean {
    if (this.hasRadiometer) {
      const isTight = this.targetGripProgress > 0.46;
      this.targetGripProgress = isTight ? RealisticHumanHandRig.RADIOMETER_GRIP_POSE_CURL : 0.50;
      return !isTight;
    }
    if (this.hasFlashlight) {
      const isTight = this.targetGripProgress > 0.48;
      this.targetGripProgress = isTight ? RealisticHumanHandRig.FLASHLIGHT_GRIP_POSE_CURL : 0.52;
      return !isTight;
    }
    const next = this.targetGripProgress > 0.5 ? 0.0 : 1.0;
    this.targetGripProgress = next;
    return next > 0.5;
  }

  public setExtensionTarget(extended: boolean): void {
    this.targetExtension = extended ? 1.0 : 0.0;
  }

  public toggleExtension(): boolean {
    const next = this.targetExtension > 0.5 ? 0.0 : 1.0;
    this.targetExtension = next;
    return next > 0.5;
  }

  public rotateWrist(): void {
    this.wristAngle += Math.PI / 4;
    if (this.wristAngle >= Math.PI * 2) {
      this.wristAngle = 0;
    }
  }

  /**
   * Синхронный трекинг поворота кисти 1:1 (Direct Wrist Orientation Mapping) для WebXR:
   * - Кватернион и позиция rootGroup 1:1 повторяют физический кватернион и позицию контроллера
   *   без каких-либо сглаживаний (slerp/lerp) и искусственных ограничений по Pitch, Roll, Yaw.
   */
  public syncDirectWristPose(
    controllerPos: THREE.Vector3,
    controllerQuat: THREE.Quaternion,
    localOffsetPos: THREE.Vector3 = RealisticHumanHandRig.VR_WRIST_OFFSET_POS,
    localOffsetRot: THREE.Euler = RealisticHumanHandRig.VR_WRIST_OFFSET_ROT
  ): void {
    this.rootGroup.position.copy(controllerPos);
    this.rootGroup.quaternion.copy(controllerQuat);

    this.handGroup.position.copy(localOffsetPos);
    this.handGroup.rotation.copy(localOffsetRot);
  }

  private applyFingerRotations(progress: number): void {
    Object.values(this.fingers).forEach(f => {
      this.lerpEulerInto(
        f.proximal.rotation,
        f.baseRotations.proximal,
        f.gripRotations.proximal,
        progress
      );

      if (f.intermediate && f.baseRotations.intermediate && f.gripRotations.intermediate) {
        this.lerpEulerInto(
          f.intermediate.rotation,
          f.baseRotations.intermediate,
          f.gripRotations.intermediate,
          progress
        );
      }

      this.lerpEulerInto(
        f.distal.rotation,
        f.baseRotations.distal,
        f.gripRotations.distal,
        progress
      );
    });
  }

  public setDesktopCameraPitch(pitchRad: number): void {
    this.desktopCameraPitch = pitchRad;
  }

  public triggerToolSwapAnimation(): void {
    this.swapOffsetZ = 0.09;
    this.swapOffsetY = -0.055;
  }

  public update(delta: number, isVR: boolean = false): void {
    // 1. Плавное обновление сгиба фаланг пальцев (Grip Pose 0.42 для радиометра в правой руке / 0.45 для фонаря в левой руке)
    this.currentGripProgress +=
      (this.targetGripProgress - this.currentGripProgress) * Math.min(1, delta * 18);
    this.applyFingerRotations(this.currentGripProgress);

    // 2. Позиция и ориентация кисти:
    // В VR-режиме rootGroup.quaternion 1:1 управляется контроллером WebXR без сглаживаний
    if (!isVR) {
      this.currentExtension += (this.targetExtension - this.currentExtension) * Math.min(1, delta * 8);

      // Плавная компенсация наклона головы вниз и анимация смены инструмента
      const targetPitchComp = Math.max(0, -this.desktopCameraPitch);
      this.smoothedPitchComp += (targetPitchComp - this.smoothedPitchComp) * Math.min(1, delta * 10);
      this.swapOffsetZ += (0 - this.swapOffsetZ) * Math.min(1, delta * 13);
      this.swapOffsetY += (0 - this.swapOffsetY) * Math.min(1, delta * 13);

      const baseHandPos =
        this.handedness === 'right'
          ? RealisticHumanHandRig.tempBaseRight
          : RealisticHumanHandRig.tempBaseLeft;
      const extendedHandPos =
        this.handedness === 'right'
          ? RealisticHumanHandRig.tempExtRight
          : RealisticHumanHandRig.tempExtLeft;

      this.tempTargetPos.copy(baseHandPos).lerp(extendedHandPos, this.currentExtension);
      this.tempTargetPos.y += this.smoothedPitchComp * 0.045 + this.swapOffsetY;
      this.tempTargetPos.z += this.smoothedPitchComp * 0.065 + this.swapOffsetZ;
      this.rootGroup.position.copy(this.tempTargetPos);
      this.handGroup.position.set(0, 0, 0);
      this.handGroup.rotation.set(this.smoothedPitchComp * 0.16, 0, this.wristAngle);
    }

    // 3. Мировая позиция кончика выносного датчика (вдоль оси -Z указательного пальца) или обновление матрицы фонаря левой руки
    if (this.hasRadiometer) {
      this.radiometerChassisGroup.updateWorldMatrix(true, false);
      this.radiometerChassisGroup.getWorldPosition(this.probeTipWorldPos);
      this.radiometerChassisGroup.getWorldQuaternion(this.tempWorldQuat);
      this.tempProbeOffset.set(0, 0.003, -0.220).applyQuaternion(this.tempWorldQuat);
      this.probeTipWorldPos.add(this.tempProbeOffset);
    } else {
      this.palmGroup.updateWorldMatrix(true, true);
      this.palmGroup.getWorldPosition(this.probeTipWorldPos);
    }
  }

  private lerpEulerInto(target: THREE.Euler, a: THREE.Euler, b: THREE.Euler, t: number): void {
    target.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }

  public renderLCD(doseRateMicroSv: number, instrumentId: string = 'dp5'): void {
    if (!this.hasRadiometer || !this.lcdContext || !this.lcdCanvas || !this.lcdTexture) return;

    const validId = (['dp5', 'ion', 'nai', 'neutron'].includes(instrumentId) ? instrumentId : 'dp5') as InstrumentId;
    const instrumentChanged = validId !== this.currentInstrumentId;
    if (instrumentChanged) {
      this.rebuildProbeGeometry(validId);
    }

    const quantizedDoseKey =
      doseRateMicroSv >= 1000000
        ? (doseRateMicroSv / 1000000).toFixed(3)
        : doseRateMicroSv >= 1000
        ? (doseRateMicroSv / 1000).toFixed(2)
        : doseRateMicroSv.toFixed(1);
    const lcdKey = `${validId}:${quantizedDoseKey}:${doseRateMicroSv > 12 ? 1 : 0}`;
    const nowMs = performance.now();
    if (!instrumentChanged && (lcdKey === this.lastLcdKey || nowMs - this.lastLcdRenderTimeMs < 100)) {
      return;
    }
    this.lastLcdKey = lcdKey;
    this.lastLcdRenderTimeMs = nowMs;

    const ctx = this.lcdContext;
    const w = this.lcdCanvas.width;
    const h = this.lcdCanvas.height;

    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#053b2c');
    bgGrad.addColorStop(1, '#03261d');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, w - 12, h - 12);

    ctx.fillStyle = '#6ee7b7';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`ГОСТ 27451 • ${validId.toUpperCase()}`, 20, 36);

    ctx.fillStyle = '#34d399';
    ctx.fillText('HV OK • 98%', 345, 36);

    ctx.font = 'bold 72px monospace';
    let valStr = doseRateMicroSv.toFixed(1);
    let unit = 'мкЗв/ч';

    if (doseRateMicroSv >= 1000) {
      valStr = (doseRateMicroSv / 1000).toFixed(2);
      unit = 'мЗв/ч';
    }
    if (doseRateMicroSv >= 1000000) {
      valStr = (doseRateMicroSv / 1000000).toFixed(3);
      unit = 'Зв/ч';
    }

    ctx.fillStyle = '#ecfdf5';
    ctx.fillText(valStr, 24, 120);

    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = '#a7f3d0';
    ctx.fillText(unit, 355, 116);

    ctx.fillStyle = '#064e3b';
    ctx.fillRect(20, 154, 472, 28);

    const logFraction = Math.min(1, Math.max(0, (Math.log10(Math.max(0.1, doseRateMicroSv)) + 1) / 6));
    const barWidth = Math.floor(logFraction * 472);

    ctx.fillStyle = doseRateMicroSv < 12 ? '#10b981' : doseRateMicroSv < 1000 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(20, 154, barWidth, 28);

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('0.1', 20, 208);
    ctx.fillText('10', 160, 208);
    ctx.fillText('1k', 300, 208);
    ctx.fillText('100k', 425, 208);

    ctx.font = 'bold 21px sans-serif';
    if (doseRateMicroSv > 12) {
      ctx.fillStyle = '#f87171';
      ctx.fillText('ВНИМАНИЕ! ПРЕВЫШЕНИЕ КОНТРОЛЬНОГО УРОВНЯ', 20, 240);
    } else {
      ctx.fillStyle = '#34d399';
      ctx.fillText('РАДИАЦИОННЫЙ ФОН В НОРМЕ (ОСПОРБ-99/2010)', 20, 240);
    }

    this.lcdTexture.needsUpdate = true;
  }
}

export { RealisticHumanHandRig as HazmatHandRig };
