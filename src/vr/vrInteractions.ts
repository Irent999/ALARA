/**
 * ALARA-Planner Pro VR — Система интерактивного взаимодействия (InteractionSystem),
 * дифференцированная физика сброса (Snap-to-Floor & Spatial Placement),
 * конфигурация хватов (Grip Offsets) и предотвращение коллизий удерживаемых предметов.
 */

import * as THREE from 'three';
import { InteractiveObjectInstance, ObjectPlacementType } from '../scene/scenarios';

export interface GripOffset {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale?: THREE.Vector3;
}

/**
 * Конфигурация индивидуальных смещений и поворотов захвата для интерактивных предметов сцены
 */
export const GRIP_OFFSETS: Record<string, GripOffset> = {
  // Сценарий 1: Передвижная свинцовая ширма 20 мм Pb (крупное напольное оборудование)
  screen_shield: {
    position: new THREE.Vector3(0, -0.45, -0.85),
    rotation: new THREE.Euler(0, 0, 0)
  },
  lead_screen: {
    position: new THREE.Vector3(0, -0.45, -0.85),
    rotation: new THREE.Euler(0, 0, 0)
  },
  // Сценарий 6: Водородно-борный экран из парафина / борированного полиэтилена
  paraffin_shield: {
    position: new THREE.Vector3(0, -0.45, -0.85),
    rotation: new THREE.Euler(0, 0, 0)
  },
  // Сценарий 3: Стопка свинцовых кирпичей ГОСТ (тяжелый защитный блок)
  lead_bricks: {
    position: new THREE.Vector3(0, -0.14, -0.46),
    rotation: new THREE.Euler(0, 0, 0)
  },
  // Сценарий 2: Ампула / капсула Ir-192 (мелкий портативный источник)
  ir_capsule: {
    position: new THREE.Vector3(0, -0.01, -0.10),
    rotation: new THREE.Euler(Math.PI / 2, 0, 0)
  },
  // Сценарий 4: Радиоактивный образец руды Ra-226 (ручной образец породы)
  norm_rock: {
    position: new THREE.Vector3(0, -0.025, -0.08),
    rotation: new THREE.Euler(0, 0, 0)
  },
  // Сценарий 7: Вскрытая ампула Sr-90 / Y-90 (мелкая деталь в ладони)
  sr90_vial: {
    position: new THREE.Vector3(0, -0.02, -0.07),
    rotation: new THREE.Euler(0, 0, 0)
  },
  // Сценарий 8: Сосуд Маринелли с пробой почвы (ручной инвентарь)
  marinelli_beaker: {
    position: new THREE.Vector3(0, -0.03, -0.10),
    rotation: new THREE.Euler(0, 0, 0)
  },
  // Сценарий 9: Накопительная угольная камера НК-32 (портативный датчик радона)
  charcoal_adsorber: {
    position: new THREE.Vector3(0, -0.02, -0.08),
    rotation: new THREE.Euler(0, 0, 0)
  },
  // Сценарий 11: Антикварный керамический сосуд с урановой глазурью
  uranium_ceramic: {
    position: new THREE.Vector3(0, -0.035, -0.11),
    rotation: new THREE.Euler(0, 0, 0)
  },
  // Высокомощный тактический фонарь ФПС-4/6 ВЗГ (внутри ладони левой руки вдоль оси -Z указательного пальца)
  tactical_flashlight: {
    position: new THREE.Vector3(-0.02, 0.01, -0.03),
    rotation: new THREE.Euler(0, 0, 0)
  },
  // МЧС Сценарий 1: Выпавший топливный элемент ТВЭЛ / ИИИ (захват щипцами ЦМ-1.5)
  fuel_pin_source: {
    position: new THREE.Vector3(0, -0.01, -0.10),
    rotation: new THREE.Euler(Math.PI / 2, 0, 0)
  },
  // МЧС Сценарий 2: Повреждённая бочка РАО и пострадавший оператор
  damaged_rao_drum: {
    position: new THREE.Vector3(0, -0.22, -0.52),
    rotation: new THREE.Euler(0, 0, 0)
  },
  injured_operator: {
    position: new THREE.Vector3(0, -0.35, -0.72),
    rotation: new THREE.Euler(0, Math.PI / 2, 0)
  },
  // МЧС Сценарий 3: Критический блок управления АСУ ТП
  critical_control_unit: {
    position: new THREE.Vector3(0, -0.03, -0.14),
    rotation: new THREE.Euler(0, 0, 0)
  },
  // Хват на конце губок дистанционных щипцов ЦМ-1.5
  tongs_tip: {
    position: new THREE.Vector3(0, 0, -0.04),
    rotation: new THREE.Euler(Math.PI / 2, 0, 0)
  },
  // Универсальный фоллбэк для мелкого ручного инвентаря (дозиметры, датчики, флешки)
  default: {
    position: new THREE.Vector3(0, -0.025, -0.09),
    rotation: new THREE.Euler(0, 0, 0)
  }
};

// Reusable статические объекты для проверки коллизий и расчетов без аллокаций в кадре
const sHeldBox = new THREE.Box3();
const sColliderBox = new THREE.Box3();
const sWorldCorrection = new THREE.Vector3();
const sParentInvMatrix = new THREE.Matrix4();

export interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
}

export function isDescendantOf(child: THREE.Object3D, parent: THREE.Object3D): boolean {
  let curr: THREE.Object3D | null = child.parent;
  while (curr) {
    if (curr === parent) return true;
    curr = curr.parent;
  }
  return false;
}

/**
 * Проверка столкновений удерживаемого объекта со стенами, полом помещения и реальной геометрией сцены.
 * Восстанавливает базовый Grip Offset перед проверкой кадра, чтобы временные касания пола/стен
 * никогда не вызывали накопления ошибки (улетания предмета вверх относительно руки).
 */
export function checkHeldObjectCollision(
  heldObject: THREE.Object3D,
  colliders?: THREE.Object3D[],
  bounds: RoomBounds = { minX: -6.5, maxX: 6.5, minZ: -6.5, maxZ: 6.5, minY: 0.03 }
): void {
  // Тактический фонарь жестко интегрирован в локальную иерархию левой кисти (leftHandRig)
  // и содержит 5-метровый конус света/target, поэтому не должен выталкиваться коллайдерами пола и стен
  if (heldObject.userData?.isFlashlight || heldObject.name === 'tactical_flashlight') {
    heldObject.position.set(-0.02, 0.01, -0.03);
    heldObject.rotation.set(0, 0, 0);
    heldObject.updateWorldMatrix(true, false);
    return;
  }
  // 0. Восстанавливаем исходный локальный Grip Offset перед проверкой коллизий текущего кадра
  if (heldObject.userData?.baseGripPosition instanceof THREE.Vector3) {
    heldObject.position.copy(heldObject.userData.baseGripPosition);
  }
  if (heldObject.userData?.baseGripRotation instanceof THREE.Euler) {
    heldObject.rotation.copy(heldObject.userData.baseGripRotation);
  }

  // 1. Обновляем мировую трансформацию удерживаемого объекта
  heldObject.updateWorldMatrix(true, false);
  sHeldBox.setFromObject(heldObject);

  sWorldCorrection.set(0, 0, 0);

  // 2. Fallback: Защита от проваливания сквозь пол помещения
  if (sHeldBox.min.y < bounds.minY) {
    sWorldCorrection.y += bounds.minY - sHeldBox.min.y;
  }

  // 3. Fallback: Защита от выхода за внешние стены помещения (X и Z)
  if (sHeldBox.min.x < bounds.minX) {
    sWorldCorrection.x += bounds.minX - sHeldBox.min.x;
  } else if (sHeldBox.max.x > bounds.maxX) {
    sWorldCorrection.x -= sHeldBox.max.x - bounds.maxX;
  }

  if (sHeldBox.min.z < bounds.minZ) {
    sWorldCorrection.z += bounds.minZ - sHeldBox.min.z;
  } else if (sHeldBox.max.z > bounds.maxZ) {
    sWorldCorrection.z -= sHeldBox.max.z - bounds.maxZ;
  }

  // 4. Проверка реальных твердотельных объектов сцены (свинцовые ширмы, контейнеры ТК-6, оборудование)
  if (colliders && colliders.length > 0) {
    for (let i = 0; i < colliders.length; i++) {
      const col = colliders[i];
      if (!col || !col.visible || col === heldObject) {
        continue;
      }
      // Исключаем иерархическое самопересечение
      if (isDescendantOf(heldObject, col) || isDescendantOf(col, heldObject)) {
        continue;
      }

      col.updateWorldMatrix(true, false);
      sColliderBox.setFromObject(col);

      // Проверка пересечения Bounding Boxes в мировом пространстве
      if (sHeldBox.intersectsBox(sColliderBox)) {
        const dx1 = sColliderBox.max.x - sHeldBox.min.x;
        const dx2 = sHeldBox.max.x - sColliderBox.min.x;
        const penX = Math.min(dx1, dx2);

        const dy1 = sColliderBox.max.y - sHeldBox.min.y;
        const dy2 = sHeldBox.max.y - sColliderBox.min.y;
        const penY = Math.min(dy1, dy2);

        const dz1 = sColliderBox.max.z - sHeldBox.min.z;
        const dz2 = sHeldBox.max.z - sColliderBox.min.z;
        const penZ = Math.min(dz1, dz2);

        // Находим ось наименьшего сопротивления
        if (penY < penX && penY < penZ && penY < 0.8) {
          const signY = sHeldBox.min.y + sHeldBox.max.y > sColliderBox.min.y + sColliderBox.max.y ? 1 : -1;
          sWorldCorrection.y += signY * penY;
        } else if (penX < penZ && penX < 0.8) {
          const signX = sHeldBox.min.x + sHeldBox.max.x > sColliderBox.min.x + sColliderBox.max.x ? 1 : -1;
          sWorldCorrection.x += signX * penX;
        } else if (penZ < 0.8) {
          const signZ = sHeldBox.min.z + sHeldBox.max.z > sColliderBox.min.z + sColliderBox.max.z ? 1 : -1;
          sWorldCorrection.z += signZ * penZ;
        }
      }
    }
  }

  // 5. Применение коррекции в локальных координатах текущего родителя (VR-контроллер или handRig)
  if (sWorldCorrection.lengthSq() > 0.000001) {
    if (heldObject.parent) {
      sParentInvMatrix.copy(heldObject.parent.matrixWorld).invert();
      sWorldCorrection.transformDirection(sParentInvMatrix);
      heldObject.position.add(sWorldCorrection);
    } else {
      heldObject.position.add(sWorldCorrection);
    }
    heldObject.updateWorldMatrix(true, false);
  }
}

export interface DropResult {
  droppedObject: THREE.Object3D;
  itemMeta: InteractiveObjectInstance | null;
  placementType: ObjectPlacementType;
  isLargeEquipment: boolean;
  finalWorldPosition: THREE.Vector3;
  finalYawRadians: number;
  floorHitY: number;
}

/**
 * Система захвата и дифференцированной физики сброса объектов (InteractionSystem):
 * - Разделяет все интерактивные объекты сцены на 2 категории:
 *   1) Крупное оборудование и статичные конструкторы (isLargeEquipment: true | placementType: 'floor'):
 *      экраны, защитные стены, стойки, дозиметрические шкафы, тяжелые свинцовые блоки.
 *      При отпускании (Drop/Release) запускает Raycast строго вниз Vector3(0, -1, 0), находит пересечение
 *      с Mesh пола (или уровнем y = 0) и автоматически ставит объект на пол с выравниванием по вертикальной оси Y,
 *      сохраняя только горизонтальный поворот по Yaw.
 *   2) Мелкие детали, инструменты и портативные приборы (isLargeEquipment: false | placementType: 'prop'):
 *      дозиметры, флешки, датчики, капсулы источников, образцы породы, ручной инвентарь.
 *      При отпускании (selectend / squeezeend) остаются ровно в той пространственной точке и 3D-ориентации,
 *      где находилась виртуальная рука в момент отпускания (без принудительного притяжения к полу).
 */
export class InteractionSystem {
  public static readonly DOWN_VECTOR = new THREE.Vector3(0, -1, 0);

  private readonly scene: THREE.Scene;
  private readonly downRaycaster = new THREE.Raycaster();
  private readonly interactRaycaster = new THREE.Raycaster();

  // Текущее состояние захвата
  public grabbedObject: THREE.Object3D | null = null;
  public grabbedItemMeta: InteractiveObjectInstance | null = null;
  public activeHolder: THREE.Object3D | null = null;
  public activeControllerIndex: number | null = null;

  // Переиспользуемые векторы и кватернионы (Zero Allocation)
  private readonly tempWorldPos = new THREE.Vector3();
  private readonly tempWorldQuat = new THREE.Quaternion();
  private readonly tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tempRayOrigin = new THREE.Vector3();
  private readonly tempBox = new THREE.Box3();
  private readonly tempWorldNormal = new THREE.Vector3();
  private readonly tempInteractMeshes: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Определяет категорию объекта:
   * - true ('floor'): крупное оборудование, экраны, стены, стойки, шкафы, тяжелые блоки
   * - false ('prop'): мелкие детали, инструменты, капсулы, дозиметры, датчики, ручной инвентарь
   */
  public static isLargeFloorEquipment(
    object: THREE.Object3D,
    itemMeta?: InteractiveObjectInstance | null
  ): boolean {
    if (itemMeta) {
      if (typeof itemMeta.isLargeEquipment === 'boolean') {
        return itemMeta.isLargeEquipment;
      }
      if (itemMeta.placementType === 'floor') return true;
      if (itemMeta.placementType === 'prop') return false;
      if (itemMeta.type === 'shield' || itemMeta.type === 'container' || itemMeta.type === 'drop_zone') return true;
      if (
        itemMeta.type === 'source' ||
        itemMeta.type === 'sample' ||
        itemMeta.type === 'extractable' ||
        itemMeta.type === 'control_unit'
      ) {
        return false;
      }
    }

    const ud = object.userData;
    if (ud) {
      if (typeof ud.isLargeEquipment === 'boolean') {
        return ud.isLargeEquipment;
      }
      if (ud.placementType === 'floor' || ud.type === 'floor') return true;
      if (ud.placementType === 'prop' || ud.type === 'prop') return false;
    }

    const idOrName = (itemMeta?.id || ud?.interactiveId || object.name || '').toLowerCase();
    if (
      idOrName.includes('shield') ||
      idOrName.includes('screen') ||
      idOrName.includes('brick') ||
      idOrName.includes('wall') ||
      idOrName.includes('rack') ||
      idOrName.includes('cabinet') ||
      idOrName.includes('tk6') ||
      idOrName.includes('container')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Поиск интерактивного объекта лучом или непосредственной близостью кисти руки (для кнопки Grip / Squeeze)
   */
  public raycastInteractive(
    rayOrigin: THREE.Vector3,
    rayDirection: THREE.Vector3,
    interactiveList: InteractiveObjectInstance[],
    maxDistance: number = 4.5
  ): InteractiveObjectInstance | null {
    if (interactiveList.length === 0) return null;

    // 1. Сначала проверяем прямое пересечение луча
    this.interactRaycaster.set(rayOrigin, rayDirection);
    this.interactRaycaster.near = 0.01;
    this.interactRaycaster.far = maxDistance;

    this.tempInteractMeshes.length = 0;
    for (let i = 0; i < interactiveList.length; i++) {
      this.tempInteractMeshes.push(interactiveList[i].mesh);
    }
    const hits = this.interactRaycaster.intersectObjects(this.tempInteractMeshes, true);

    if (hits.length > 0) {
      let currentObj: THREE.Object3D | null = hits[0].object;
      while (currentObj) {
        const matched = interactiveList.find(item => item.mesh === currentObj);
        if (matched) {
          return matched;
        }
        currentObj = currentObj.parent;
      }
    }

    // 2. Fallback для хвата рукой вблизи (Grip / Squeeze на мелких деталях в радиусе 0.45 м от кисти)
    let closestItem: InteractiveObjectInstance | null = null;
    let closestDist = 0.45;
    for (let i = 0; i < interactiveList.length; i++) {
      const item = interactiveList[i];
      item.mesh.updateWorldMatrix(true, false);
      this.tempBox.setFromObject(item.mesh);
      const dist = this.tempBox.distanceToPoint(rayOrigin);
      if (dist < closestDist) {
        closestDist = dist;
        closestItem = item;
      }
    }

    return closestItem;
  }

  /**
   * Захват интерактивного объекта в виртуальную руку / контроллер
   */
  public grabObject(
    item: InteractiveObjectInstance,
    holder: THREE.Object3D,
    controllerIndex: number | null = null,
    customGripOffset?: GripOffset
  ): void {
    // Если в руке уже был другой предмет — сначала корректно отпускаем его
    if (this.grabbedObject && this.grabbedObject !== item.mesh) {
      this.releaseObject();
    }

    const targetMesh = item.mesh;
    item.interacted = true;

    // Привязываем объект к родительскому узлу руки / контроллера
    holder.attach(targetMesh);

    // Применяем калиброванный Grip Offset для данного типа предмета
    const gripConf = customGripOffset || GRIP_OFFSETS[item.id] || GRIP_OFFSETS.default;
    targetMesh.position.copy(gripConf.position);
    targetMesh.rotation.copy(gripConf.rotation);

    // Сохраняем базовый локальный офсет в userData для защиты от накопления ошибки при коллизиях
    targetMesh.userData = {
      ...targetMesh.userData,
      interactiveId: item.id,
      isLargeEquipment: InteractionSystem.isLargeFloorEquipment(targetMesh, item),
      placementType: InteractionSystem.isLargeFloorEquipment(targetMesh, item) ? 'floor' : 'prop',
      baseGripPosition: gripConf.position.clone(),
      baseGripRotation: gripConf.rotation.clone()
    };

    targetMesh.updateWorldMatrix(true, true);

    this.grabbedObject = targetMesh;
    this.grabbedItemMeta = item;
    this.activeHolder = holder;
    this.activeControllerIndex = controllerIndex;
  }

  /**
   * Освобождение (Drop / Release) удерживаемого объекта с дифференцированной физикой размещения:
   * 1. Вычисляет мировые трансформации объекта (getWorldPosition, getWorldQuaternion).
   * 2. Отвязывает объект от контроллера в корень сцены: scene.attach(object).
   * 3. Применяет дифференцированную физику:
   *    - Для крупного оборудования ('floor' / isLargeEquipment = true):
   *      Raycast строго вниз Vector3(0, -1, 0) от точки сброса до пересечения с Mesh пола (или y = 0),
   *      выравнивание строго вертикально по оси Y с сохранением только поворота по Yaw.
   *    - Для мелких деталей и приборов ('prop' / isLargeEquipment = false):
   *      сохранение точной мировой позиции и пространственного кватерниона руки в момент отпускания.
   */
  public releaseObject(
    floorCandidates?: THREE.Object3D[],
    excludeRoots?: THREE.Object3D[]
  ): DropResult | null {
    if (!this.grabbedObject) return null;

    const heldObject = this.grabbedObject;
    const itemMeta = this.grabbedItemMeta;

    // Восстанавливаем базовую локальную позицию перед снятием мировых координат,
    // если не было реального проникновения
    heldObject.updateWorldMatrix(true, true);

    // 1. Вычисляем точные мировые координаты и мировой кватернион объекта в момент отпускания
    heldObject.getWorldPosition(this.tempWorldPos);
    heldObject.getWorldQuaternion(this.tempWorldQuat);

    // 2. Отвязываем объект от контроллера / виртуальной руки в корень сцены
    this.scene.attach(heldObject);

    // Очищаем временные данные локального хвата
    if (heldObject.userData) {
      delete heldObject.userData.baseGripPosition;
      delete heldObject.userData.baseGripRotation;
    }

    const isLarge = InteractionSystem.isLargeFloorEquipment(heldObject, itemMeta);
    const placementType: ObjectPlacementType = isLarge ? 'floor' : 'prop';

    let finalYaw = 0;
    let floorHitY = 0;

    if (isLarge) {
      // =========================================================================
      // КАТЕГОРИЯ 1: Крупное оборудование и статичные конструкторы (Snap-to-Floor)
      // =========================================================================
      // Извлекаем только горизонтальный угол поворота Yaw (вокруг вертикальной оси Y),
      // полностью обнуляя Pitch (наклон вперед/назад) и Roll (крен вбок)
      this.tempEuler.setFromQuaternion(this.tempWorldQuat, 'YXZ');
      finalYaw = this.tempEuler.y;

      heldObject.rotation.set(0, finalYaw, 0, 'YXZ');
      heldObject.quaternion.setFromEuler(heldObject.rotation);

      // Запускаем Raycast строго вниз Vector3(0, -1, 0) от текущей точки отпускания
      floorHitY = this.castRayToFloor(
        this.tempWorldPos,
        heldObject,
        floorCandidates,
        excludeRoots
      );

      // Устанавливаем X и Z в точку сброса, а Y выравниваем так, чтобы нижняя грань
      // (подошва/колеса/основание объекта) точно встала на найденную поверхность пола floorHitY
      heldObject.position.set(this.tempWorldPos.x, this.tempWorldPos.y, this.tempWorldPos.z);
      heldObject.updateWorldMatrix(true, true);

      this.tempBox.setFromObject(heldObject);
      if (!this.tempBox.isEmpty()) {
        const pivotToBottomOffset = heldObject.position.y - this.tempBox.min.y;
        heldObject.position.y = floorHitY + pivotToBottomOffset;
      } else {
        heldObject.position.y = floorHitY;
      }

      heldObject.updateWorldMatrix(true, true);
    } else {
      // =========================================================================
      // КАТЕГОРИЯ 2: Мелкие детали, инструменты и портативные приборы (Spatial Placement)
      // =========================================================================
      // Остаются ровно в той пространственной точке и 3D-ориентации (Pitch, Yaw, Roll),
      // где находилась виртуальная рука в момент selectend / squeezeend (без притяжения к полу)
      heldObject.position.copy(this.tempWorldPos);
      heldObject.quaternion.copy(this.tempWorldQuat);

      this.tempEuler.setFromQuaternion(this.tempWorldQuat, 'YXZ');
      finalYaw = this.tempEuler.y;

      // Защита только от случайного погружения под текстуру пола (если рука была опущена ниже y = 0)
      heldObject.updateWorldMatrix(true, true);
      this.tempBox.setFromObject(heldObject);
      if (!this.tempBox.isEmpty() && this.tempBox.min.y < 0.01) {
        heldObject.position.y += 0.01 - this.tempBox.min.y;
        heldObject.updateWorldMatrix(true, true);
      }
      floorHitY = heldObject.position.y;
    }

    const result: DropResult = {
      droppedObject: heldObject,
      itemMeta,
      placementType,
      isLargeEquipment: isLarge,
      finalWorldPosition: heldObject.position.clone(),
      finalYawRadians: finalYaw,
      floorHitY
    };

    // Сбрасываем состояние активного удержания
    this.grabbedObject = null;
    this.grabbedItemMeta = null;
    this.activeHolder = null;
    this.activeControllerIndex = null;

    return result;
  }

  /**
   * Пускает луч строго вниз Vector3(0, -1, 0) от точки отпускания объекта
   * и находит координату Y пересечения с Mesh пола (или возвращает уровень пола y = 0.0)
   */
  private castRayToFloor(
    releaseWorldPos: THREE.Vector3,
    heldObject: THREE.Object3D,
    floorCandidates?: THREE.Object3D[],
    excludeRoots?: THREE.Object3D[]
  ): number {
    // Поднимаем старт луча немного выше точки сброса, чтобы гарантировать пересечение с полом,
    // даже если нижняя часть крупного экрана в руке находилась у самой поверхности пола
    const rayStartY = Math.max(releaseWorldPos.y + 0.6, 1.2);
    this.tempRayOrigin.set(releaseWorldPos.x, rayStartY, releaseWorldPos.z);

    this.downRaycaster.set(this.tempRayOrigin, InteractionSystem.DOWN_VECTOR);
    this.downRaycaster.near = 0;
    this.downRaycaster.far = 50;

    const searchTargets =
      floorCandidates && floorCandidates.length > 0 ? floorCandidates : this.scene.children;

    const hits = this.downRaycaster.intersectObjects(searchTargets, true);

    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const obj = hit.object;

      // Игнорируем сам сбрасываемый объект и все его дочерние элементы
      if (obj === heldObject || isDescendantOf(obj, heldObject)) {
        continue;
      }

      // Игнорируем исключенные группы (например, playerGroup, VR UI, руки)
      if (excludeRoots && excludeRoots.some(root => obj === root || isDescendantOf(obj, root))) {
        continue;
      }

      // Игнорируем вспомогательные линии, точки радиационного поля и невидимые объекты
      if (
        !obj.visible ||
        obj instanceof THREE.Points ||
        obj instanceof THREE.Line ||
        obj.name === 'short_ui_pointer'
      ) {
        continue;
      }

      // Если попали непосредственно в размеченный Mesh пола
      if (obj.userData?.isFloor || obj.name === 'scene_floor') {
        return hit.point.y;
      }

      // Если пересекли горизонтальную опорную поверхность (пол или рабочий стол бокса) ниже точки старта
      if (hit.face && hit.face.normal) {
        this.tempWorldNormal.copy(hit.face.normal).transformDirection(obj.matrixWorld);
        if (this.tempWorldNormal.y > 0.7 && hit.point.y <= releaseWorldPos.y + 0.35) {
          return hit.point.y;
        }
      } else if (Math.abs(hit.point.y) < 0.05) {
        return hit.point.y;
      }
    }

    // Математический фоллбэк уровня пола y = 0.0
    return 0.0;
  }
}
