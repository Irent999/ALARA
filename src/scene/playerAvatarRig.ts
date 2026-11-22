/**
 * ALARA-Planner Pro VR — 3D-Модель тела и экипировки персонажа-дозиметриста в сцене
 * (PlayerAvatarRig)
 *
 * Архитектурные и визуальные особенности:
 * 1. Детализированная анатомическая форма тела:
 *    - Моделированный торс с анатомическими изгибами грудной клетки, пояса и плечевого пояса.
 *    - Защитные рукава и плечевые гермошвы, ведущие к анатомическим кистям HazmatHandRig.
 *    - Сегментированные ноги с защитными наколенниками и реалистичными сапогами (протекторная подошва, подносок, хомуты).
 *    - Тактический дозиметрический бейдж и карманный дозиметр-ручка ДКП-50А на нагрудном кармане.
 * 2. Динамическая спецодежда (PPE / СИЗ):
 *    - Х/б спецовка / халат (none): белая хлопчатобумажная ткань с матовой текстурой.
 *    - Костюм Л-1 (l1_suit): полуглянцевая вулканизированная прорезиненная ткань оливкового цвета, защитные чулки с хлястиками.
 *    - Скафандр КИХ-4 (kih4_suit): ярко-оранжевый герметичный полимерный комплекс, гермошлем с панорамным светофильтром.
 *    - Свинцовый фартук (lead_apron): цианово-синий виниловый свинцовый фартук 0.5 мм Pb с защитой щитовидной железы и перекрестными ремнями.
 *    - Бронежилет ликвидатора (heavy_lead_armor): свинцово-стальной наборный бронежилет 2.5 мм Pb с наплечниками.
 *    - СИЗОД: Лепесток-200, Противогаз ГП-7, автономный дыхательный аппарат АСВ-2 (двойной баллон 300 бар, манометр, гофрошланг).
 */

import * as THREE from 'three';
import {
  CharacterPPEState,
  SUIT_DEFINITIONS,
  SuitTypeId,
  RespiratorTypeId
} from '../components/CharacterCustomizer3D';
import {
  createBopReflectiveStripeTexture,
  createMchsBackPatchTexture,
  createMchsChevronTexture
} from './mchsTextures';

export class PlayerAvatarRig {
  public rootGroup: THREE.Group;

  // Части тела и костюма
  private suitMeshes: THREE.Mesh[] = [];
  private torsoMesh: THREE.Mesh;
  private collarMesh: THREE.Mesh;
  private leftShoulderMesh: THREE.Mesh;
  private rightShoulderMesh: THREE.Mesh;
  private leftUpperArmMesh: THREE.Mesh;
  private rightUpperArmMesh: THREE.Mesh;
  private leftThighMesh: THREE.Mesh;
  private rightThighMesh: THREE.Mesh;
  private leftCalfMesh: THREE.Mesh;
  private rightCalfMesh: THREE.Mesh;

  // Обувь и наколенники
  private leftBootGroup: THREE.Group;
  private rightBootGroup: THREE.Group;
  private leftKneePad: THREE.Mesh;
  private rightKneePad: THREE.Mesh;

  // Накладные элементы СИЗ
  private leadApronGroup: THREE.Group;
  private leadPauldronsGroup: THREE.Group;
  private scbaUnitGroup: THREE.Group;
  private helmetGroup: THREE.Group;
  private bopGearGroup: THREE.Group;
  private bopHeadMeshes: THREE.Object3D[] = [];
  private mchsInsigniaGroup: THREE.Group;
  private gasMaskGroup: THREE.Group;
  private gp7vmTubeMesh: THREE.Mesh;
  private ppm88MaskGroup: THREE.Group;
  private lepestokGroup: THREE.Group;

  // Детали экипировки (нагрудный дозиметр и бейдж допуска)
  private chestAccessoriesGroup: THREE.Group;

  public currentSuitId: SuitTypeId = 'none';
  public currentRespiratorId: RespiratorTypeId = 'none';
  public firstPersonHeadHidden = true;
  public isFirstPersonMode = false;
  private readonly tempCamEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(initialState: CharacterPPEState = { suitId: 'none', respiratorId: 'none', instrumentId: 'dp5' }) {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'player_avatar_rig';

    const initialSuit = SUIT_DEFINITIONS[initialState.suitId] || SUIT_DEFINITIONS.none;
    const suitMat = new THREE.MeshStandardMaterial({
      color: initialSuit.colorHex,
      roughness: initialSuit.roughness,
      metalness: initialSuit.metalness,
      name: 'player_suit_material'
    });

    const bootRubberMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.5,
      metalness: 0.12
    });

    const soleMat = new THREE.MeshStandardMaterial({
      color: 0x020617,
      roughness: 0.85,
      metalness: 0.05
    });

    // ------------------------------------------------------------------------
    // 1. АНАТОМИЧЕСКИЙ ТОРС И ШЕЯ
    // ------------------------------------------------------------------------
    // Грудная клетка (конический анатомический объем с сужением к поясу)
    const chestGeo = new THREE.CylinderGeometry(0.24, 0.20, 0.40, 24);
    chestGeo.scale(1.15, 1.0, 0.72);
    this.torsoMesh = new THREE.Mesh(chestGeo, suitMat);
    this.torsoMesh.position.set(0, 1.25, -0.04);
    this.torsoMesh.castShadow = true;
    this.rootGroup.add(this.torsoMesh);
    this.suitMeshes.push(this.torsoMesh);

    // Тазовая область и нижняя часть живота
    const pelvisGeo = new THREE.CylinderGeometry(0.20, 0.21, 0.22, 24);
    pelvisGeo.scale(1.12, 1.0, 0.74);
    const pelvisMesh = new THREE.Mesh(pelvisGeo, suitMat);
    pelvisMesh.position.set(0, 0.96, -0.04);
    pelvisMesh.castShadow = true;
    this.rootGroup.add(pelvisMesh);
    this.suitMeshes.push(pelvisMesh);

    // Гермоворотник комбинезона вокруг шеи
    const collarGeo = new THREE.TorusGeometry(0.12, 0.038, 16, 24);
    collarGeo.rotateX(Math.PI / 2);
    this.collarMesh = new THREE.Mesh(collarGeo, suitMat);
    this.collarMesh.position.set(0, 1.46, -0.04);
    this.rootGroup.add(this.collarMesh);
    this.suitMeshes.push(this.collarMesh);

    // ------------------------------------------------------------------------
    // 2. ПЛЕЧИ И ВЕРХНИЕ РУКАВА (соединение к кистям оператора)
    // ------------------------------------------------------------------------
    const shoulderGeo = new THREE.SphereGeometry(0.095, 16, 16);
    shoulderGeo.scale(1.1, 0.9, 1.0);

    this.leftShoulderMesh = new THREE.Mesh(shoulderGeo, suitMat);
    this.leftShoulderMesh.position.set(-0.28, 1.38, -0.04);
    this.rootGroup.add(this.leftShoulderMesh);
    this.suitMeshes.push(this.leftShoulderMesh);

    this.rightShoulderMesh = new THREE.Mesh(shoulderGeo, suitMat);
    this.rightShoulderMesh.position.set(0.28, 1.38, -0.04);
    this.rootGroup.add(this.rightShoulderMesh);
    this.suitMeshes.push(this.rightShoulderMesh);

    // Рукава (направлены вниз и немного вперед)
    const armGeo = new THREE.CylinderGeometry(0.082, 0.068, 0.32, 16);
    this.leftUpperArmMesh = new THREE.Mesh(armGeo, suitMat);
    this.leftUpperArmMesh.position.set(-0.31, 1.20, 0.02);
    this.leftUpperArmMesh.rotation.set(0.2, 0, 0.15);
    this.rootGroup.add(this.leftUpperArmMesh);
    this.suitMeshes.push(this.leftUpperArmMesh);

    this.rightUpperArmMesh = new THREE.Mesh(armGeo, suitMat);
    this.rightUpperArmMesh.position.set(0.31, 1.20, 0.02);
    this.rightUpperArmMesh.rotation.set(0.2, 0, -0.15);
    this.rootGroup.add(this.rightUpperArmMesh);
    this.suitMeshes.push(this.rightUpperArmMesh);

    // ------------------------------------------------------------------------
    // 3. АНАТОМИЧЕСКИЕ НОГИ И НАКОЛЕННИКИ
    // ------------------------------------------------------------------------
    const thighGeo = new THREE.CylinderGeometry(0.105, 0.085, 0.42, 18);
    this.leftThighMesh = new THREE.Mesh(thighGeo, suitMat);
    this.leftThighMesh.position.set(-0.14, 0.68, -0.04);
    this.rootGroup.add(this.leftThighMesh);
    this.suitMeshes.push(this.leftThighMesh);

    this.rightThighMesh = new THREE.Mesh(thighGeo, suitMat);
    this.rightThighMesh.position.set(0.14, 0.68, -0.04);
    this.rootGroup.add(this.rightThighMesh);
    this.suitMeshes.push(this.rightThighMesh);

    const calfGeo = new THREE.CylinderGeometry(0.085, 0.075, 0.38, 18);
    this.leftCalfMesh = new THREE.Mesh(calfGeo, suitMat);
    this.leftCalfMesh.position.set(-0.14, 0.32, -0.04);
    this.rootGroup.add(this.leftCalfMesh);
    this.suitMeshes.push(this.leftCalfMesh);

    this.rightCalfMesh = new THREE.Mesh(calfGeo, suitMat);
    this.rightCalfMesh.position.set(0.14, 0.32, -0.04);
    this.rootGroup.add(this.rightCalfMesh);
    this.suitMeshes.push(this.rightCalfMesh);

    // Рифленые резиновые наколенники
    const kneeGeo = new THREE.BoxGeometry(0.11, 0.12, 0.04);
    const kneeMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.6,
      metalness: 0.2
    });
    this.leftKneePad = new THREE.Mesh(kneeGeo, kneeMat);
    this.leftKneePad.position.set(-0.14, 0.48, 0.04);
    this.rootGroup.add(this.leftKneePad);

    this.rightKneePad = new THREE.Mesh(kneeGeo, kneeMat);
    this.rightKneePad.position.set(0.14, 0.48, 0.04);
    this.rootGroup.add(this.rightKneePad);

    // ------------------------------------------------------------------------
    // 4. ДЕТАЛИЗИРОВАННЫЕ САПОГИ С ПРОТЕКТОРОМ И ХОМУТАМИ
    // ------------------------------------------------------------------------
    this.leftBootGroup = this.createDetailedBoot(bootRubberMat, soleMat);
    this.leftBootGroup.position.set(-0.14, 0, 0);
    this.rootGroup.add(this.leftBootGroup);

    this.rightBootGroup = this.createDetailedBoot(bootRubberMat, soleMat);
    this.rightBootGroup.position.set(0.14, 0, 0);
    this.rootGroup.add(this.rightBootGroup);

    // ------------------------------------------------------------------------
    // 5. АКСЕССУАРЫ ДОЗИМЕТРИСТА (Нагрудный дозиметр ДКП-50А и бейдж)
    // ------------------------------------------------------------------------
    this.chestAccessoriesGroup = new THREE.Group();
    // Карманный прямопоказывающий дозиметр (карандаш)
    const penGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.14, 16);
    const penMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.25
    });
    const penMesh = new THREE.Mesh(penGeo, penMat);
    penMesh.position.set(-0.11, 1.30, 0.10);
    penMesh.rotation.set(0, 0, -0.15);
    this.chestAccessoriesGroup.add(penMesh);

    // Бейдж радиационной безопасности с символом Trefoil
    const badgeGeo = new THREE.BoxGeometry(0.07, 0.09, 0.008);
    const badgeMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      roughness: 0.3,
      metalness: 0.1
    });
    const badgeMesh = new THREE.Mesh(badgeGeo, badgeMat);
    badgeMesh.position.set(0.10, 1.28, 0.10);
    this.chestAccessoriesGroup.add(badgeMesh);

    this.rootGroup.add(this.chestAccessoriesGroup);

    // ------------------------------------------------------------------------
    // 6. СВИНЦОВЫЙ ФАРТУК (0.5 мм Pb) С ВОРОТНИКОМ И ПЕРЕКРЕСТНЫМИ РЕМНЯМИ
    // ------------------------------------------------------------------------
    this.leadApronGroup = new THREE.Group();
    const apronBibGeo = new THREE.BoxGeometry(0.44, 0.68, 0.04);
    const apronMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.32,
      metalness: 0.35,
      name: 'lead_apron_mat'
    });
    const apronBib = new THREE.Mesh(apronBibGeo, apronMat);
    apronBib.position.set(0, 1.08, 0.09);
    this.leadApronGroup.add(apronBib);

    // Воротник для защиты щитовидной железы
    const thyroidCollarGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.08, 18, 1, true, -Math.PI / 2, Math.PI);
    const thyroidCollar = new THREE.Mesh(thyroidCollarGeo, apronMat);
    thyroidCollar.position.set(0, 1.45, 0.03);
    this.leadApronGroup.add(thyroidCollar);

    // Тактические ремни на спине
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
    const strapGeo = new THREE.BoxGeometry(0.05, 0.64, 0.015);
    const strapL = new THREE.Mesh(strapGeo, strapMat);
    strapL.position.set(-0.10, 1.15, -0.16);
    strapL.rotation.z = 0.25;
    this.leadApronGroup.add(strapL);

    const strapR = new THREE.Mesh(strapGeo, strapMat);
    strapR.position.set(0.10, 1.15, -0.16);
    strapR.rotation.z = -0.25;
    this.leadApronGroup.add(strapR);

    this.leadApronGroup.visible = false;
    this.rootGroup.add(this.leadApronGroup);

    // ------------------------------------------------------------------------
    // 7. ТЯЖЕЛЫЕ СВИНЦОВЫЕ НАПЛЕЧНИКИ ЛИКВИДАТОРА (2.5 мм Pb)
    // ------------------------------------------------------------------------
    this.leadPauldronsGroup = new THREE.Group();
    const pauldronGeo = new THREE.CylinderGeometry(0.13, 0.14, 0.16, 16, 1, true);
    const heavyArmorMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.45,
      metalness: 0.75
    });
    const pauldronL = new THREE.Mesh(pauldronGeo, heavyArmorMat);
    pauldronL.position.set(-0.30, 1.38, -0.04);
    pauldronL.rotation.z = -0.25;
    this.leadPauldronsGroup.add(pauldronL);

    const pauldronR = new THREE.Mesh(pauldronGeo, heavyArmorMat);
    pauldronR.position.set(0.30, 1.38, -0.04);
    pauldronR.rotation.z = 0.25;
    this.leadPauldronsGroup.add(pauldronR);

    this.leadPauldronsGroup.visible = false;
    this.rootGroup.add(this.leadPauldronsGroup);

    // ------------------------------------------------------------------------
    // 8. ДЫХАТЕЛЬНЫЙ АППАРАТ АСВ-2 (Баллон 300 бар, манометр, шланг)
    // ------------------------------------------------------------------------
    this.scbaUnitGroup = new THREE.Group();
    const tankGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.54, 20);
    const tankYellowMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.85,
      roughness: 0.2
    });

    const tank1 = new THREE.Mesh(tankGeo, tankYellowMat);
    tank1.position.set(-0.08, 1.18, -0.22);
    this.scbaUnitGroup.add(tank1);

    const tank2 = new THREE.Mesh(tankGeo, tankYellowMat);
    tank2.position.set(0.08, 1.18, -0.22);
    this.scbaUnitGroup.add(tank2);

    // Манометр высокого давления на плечевом ремне
    const gaugeGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.02, 16);
    const gaugeMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.9, roughness: 0.1 });
    const gauge = new THREE.Mesh(gaugeGeo, gaugeMat);
    gauge.position.set(-0.18, 1.32, 0.12);
    gauge.rotation.x = Math.PI / 3;
    this.scbaUnitGroup.add(gauge);

    // Гофрированный дыхательный шланг
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.42, -0.22),
      new THREE.Vector3(0.12, 1.48, -0.10),
      new THREE.Vector3(0.08, 1.50, 0.10),
      new THREE.Vector3(0, 1.48, 0.14)
    ]);
    const hoseGeo = new THREE.TubeGeometry(hoseCurve, 20, 0.016, 8, false);
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
    const hose = new THREE.Mesh(hoseGeo, hoseMat);
    this.scbaUnitGroup.add(hose);

    this.scbaUnitGroup.visible = false;
    this.rootGroup.add(this.scbaUnitGroup);

    // ------------------------------------------------------------------------
    // 8.5. БОЕВАЯ ОДЕЖДА ПОЖАРНОГО МЧС (БОП-1) И НАШИВКИ «МЧС УЗБЕКИСТАНА»
    // ------------------------------------------------------------------------
    this.mchsInsigniaGroup = new THREE.Group();
    const chevronMat = new THREE.MeshBasicMaterial({
      map: createMchsChevronTexture(),
      transparent: true,
      side: THREE.DoubleSide
    });
    const chevronGeo = new THREE.PlaneGeometry(0.082, 0.102);
    const leftChevron = new THREE.Mesh(chevronGeo, chevronMat);
    leftChevron.position.set(-0.37, 1.32, 0.01);
    leftChevron.rotation.y = -Math.PI / 2;
    this.mchsInsigniaGroup.add(leftChevron);

    const rightChevron = new THREE.Mesh(chevronGeo, chevronMat);
    rightChevron.position.set(0.37, 1.32, 0.01);
    rightChevron.rotation.y = Math.PI / 2;
    this.mchsInsigniaGroup.add(rightChevron);

    const backPatchMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.10),
      new THREE.MeshBasicMaterial({ map: createMchsBackPatchTexture(), side: THREE.DoubleSide })
    );
    backPatchMesh.position.set(0, 1.34, -0.185);
    backPatchMesh.rotation.y = Math.PI;
    this.mchsInsigniaGroup.add(backPatchMesh);
    this.mchsInsigniaGroup.visible = false;
    this.rootGroup.add(this.mchsInsigniaGroup);

    this.bopGearGroup = new THREE.Group();
    const bopStripeMat = new THREE.MeshStandardMaterial({
      map: createBopReflectiveStripeTexture(),
      roughness: 0.24,
      metalness: 0.45,
      emissive: new THREE.Color(0x65a30d),
      emissiveIntensity: 0.25
    });
    const bopChestBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.255, 0.238, 0.06, 24, 1, true),
      bopStripeMat
    );
    bopChestBand.scale.set(1.16, 1.0, 0.74);
    bopChestBand.position.set(0, 1.24, -0.04);
    this.bopGearGroup.add(bopChestBand);

    const bopWaistBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.215, 0.220, 0.06, 24, 1, true),
      bopStripeMat
    );
    bopWaistBand.scale.set(1.14, 1.0, 0.76);
    bopWaistBand.position.set(0, 0.96, -0.04);
    this.bopGearGroup.add(bopWaistBand);

    const bopLegBandL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.087, 0.084, 0.055, 18),
      bopStripeMat
    );
    bopLegBandL.position.set(-0.14, 0.34, -0.04);
    this.bopGearGroup.add(bopLegBandL);

    const bopLegBandR = bopLegBandL.clone();
    bopLegBandR.position.x = 0.14;
    this.bopGearGroup.add(bopLegBandR);

    // Пожарный шлем МЧС ШПМ с золотистым забралом
    const bopHelmetShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.175, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
      new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.25, metalness: 0.22 })
    );
    bopHelmetShell.position.set(0, 1.62, -0.04);
    this.bopGearGroup.add(bopHelmetShell);
    this.bopHeadMeshes.push(bopHelmetShell);

    const bopVisor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.165, 0.165, 0.10, 20, 1, true, -Math.PI * 0.38, Math.PI * 0.76),
      new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        metalness: 0.9,
        roughness: 0.08,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide
      })
    );
    bopVisor.position.set(0, 1.58, -0.02);
    this.bopGearGroup.add(bopVisor);
    this.bopHeadMeshes.push(bopVisor);

    this.bopGearGroup.visible = false;
    this.rootGroup.add(this.bopGearGroup);

    // ------------------------------------------------------------------------
    // 9. ГОЛОВНЫЕ УБОРЫ И СИЗОД (Шлем КИХ-4, ППМ-88, ГП-7 / ГП-7ВМ, Лепесток-200)
    // ------------------------------------------------------------------------
    this.helmetGroup = new THREE.Group();
    const helmetSphereGeo = new THREE.SphereGeometry(0.21, 24, 24);
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.28,
      metalness: 0.18
    });
    const helmetBase = new THREE.Mesh(helmetSphereGeo, helmetMat);
    helmetBase.position.set(0, 1.62, -0.04);
    this.helmetGroup.add(helmetBase);

    // Золотистый панорамный иллюминатор скафандра КИХ-4
    const visorGeo = new THREE.SphereGeometry(0.18, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.45);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      metalness: 0.95,
      roughness: 0.08,
      transparent: true,
      opacity: 0.88
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.62, 0.04);
    visor.rotation.x = Math.PI / 2;
    this.helmetGroup.add(visor);

    this.helmetGroup.visible = false;
    this.rootGroup.add(this.helmetGroup);

    // Панорамная маска ППМ-88
    this.ppm88MaskGroup = new THREE.Group();
    const ppmSeal = new THREE.Mesh(
      new THREE.SphereGeometry(0.145, 18, 18),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.72 })
    );
    ppmSeal.position.set(0, 1.58, 0.01);
    this.ppm88MaskGroup.add(ppmSeal);

    const ppmGlass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.138, 0.128, 0.13, 24, 1, true, -Math.PI * 0.4, Math.PI * 0.8),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        roughness: 0.08,
        metalness: 0.88,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide
      })
    );
    ppmGlass.position.set(0, 1.59, 0.035);
    this.ppm88MaskGroup.add(ppmGlass);

    const ppmFilter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.046, 0.046, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.65 })
    );
    ppmFilter.rotation.x = Math.PI / 2;
    ppmFilter.position.set(0, 1.49, 0.15);
    this.ppm88MaskGroup.add(ppmFilter);
    this.ppm88MaskGroup.visible = false;
    this.rootGroup.add(this.ppm88MaskGroup);

    // Противогаз ГП-7 / ГП-7ВМ
    this.gasMaskGroup = new THREE.Group();
    const maskFaceGeo = new THREE.SphereGeometry(0.15, 18, 18);
    const maskMat = new THREE.MeshStandardMaterial({ color: 0x292524, roughness: 0.65 });
    const maskFace = new THREE.Mesh(maskFaceGeo, maskMat);
    maskFace.position.set(0, 1.58, 0.02);
    this.gasMaskGroup.add(maskFace);

    // Фильтрующая коробка ГП-7 сбоку
    const filterBoxGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.09, 18);
    const filterMat = new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.5, metalness: 0.3 });
    const filterBox = new THREE.Mesh(filterBoxGeo, filterMat);
    filterBox.position.set(0.12, 1.52, 0.06);
    filterBox.rotation.z = Math.PI / 3;
    this.gasMaskGroup.add(filterBox);

    this.gp7vmTubeMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.35 })
    );
    this.gp7vmTubeMesh.position.set(-0.08, 1.48, 0.13);
    this.gp7vmTubeMesh.rotation.z = -0.35;
    this.gp7vmTubeMesh.visible = false;
    this.gasMaskGroup.add(this.gp7vmTubeMesh);

    this.gasMaskGroup.visible = false;
    this.rootGroup.add(this.gasMaskGroup);

    // Респиратор Лепесток-200
    this.lepestokGroup = new THREE.Group();
    const lepGeo = new THREE.SphereGeometry(0.09, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const lepMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.9 });
    const lepMesh = new THREE.Mesh(lepGeo, lepMat);
    lepMesh.position.set(0, 1.54, 0.11);
    lepMesh.rotation.x = Math.PI / 2;
    this.lepestokGroup.add(lepMesh);

    this.lepestokGroup.visible = false;
    this.rootGroup.add(this.lepestokGroup);

    // Применяем стартовое состояние
    this.updatePPEState(initialState);
  }

  /**
   * Генератор детализированного защитного сапога (протектор, подносок, голенище)
   */
  private createDetailedBoot(rubberMat: THREE.Material, soleMat: THREE.Material): THREE.Group {
    const group = new THREE.Group();

    // Подошва с агрессивным протектором
    const soleGeo = new THREE.BoxGeometry(0.13, 0.035, 0.28);
    const sole = new THREE.Mesh(soleGeo, soleMat);
    sole.position.set(0, 0.018, 0.04);
    group.add(sole);

    // Усиленный подносок сапога (носок)
    const toeGeo = new THREE.CylinderGeometry(0.062, 0.065, 0.08, 16);
    toeGeo.scale(1.0, 0.7, 1.3);
    const toe = new THREE.Mesh(toeGeo, rubberMat);
    toe.position.set(0, 0.06, 0.10);
    group.add(toe);

    // Голенище сапога с герметизирующим раструбом
    const shaftGeo = new THREE.CylinderGeometry(0.082, 0.076, 0.20, 18);
    const shaft = new THREE.Mesh(shaftGeo, rubberMat);
    shaft.position.set(0, 0.14, -0.01);
    group.add(shaft);

    return group;
  }

  /**
   * Смена материала комбинезона/рукавов по типу спецодежды
   */
  public setPpeSuit(suitId: string): void {
    const safeSuitId = (suitId as SuitTypeId) in SUIT_DEFINITIONS ? (suitId as SuitTypeId) : 'none';
    this.updatePPEState({
      suitId: safeSuitId,
      respiratorId: this.currentRespiratorId,
      instrumentId: 'dp5'
    });
  }

  /**
   * Полное динамическое обновление спецодежды (PPE / СИЗ) в реальном времени
   */
  public updatePPEState(state: CharacterPPEState): void {
    this.currentSuitId = state.suitId;
    this.currentRespiratorId = state.respiratorId;

    const suit = SUIT_DEFINITIONS[state.suitId] || SUIT_DEFINITIONS.none;

    const newSuitMat = new THREE.MeshStandardMaterial({
      color: suit.colorHex,
      roughness: suit.roughness,
      metalness: suit.metalness,
      name: `player_suit_${state.suitId}`
    });

    // Обновляем все элементы ткани тела, плеч, рукавов и ног
    for (const mesh of this.suitMeshes) {
      mesh.material = newSuitMat;
    }

    // 1. Свинцовый фартук (Pb 0.50 мм)
    if (state.suitId === 'lead_apron') {
      this.leadApronGroup.visible = true;
      this.leadPauldronsGroup.visible = false;
      const mat = (this.leadApronGroup.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.color.setHex(0x0284c7);
      mat.metalness = 0.35;
    }
    // 2. Тяжелый бронежилет ликвидатора (Pb 2.5 мм)
    else if (state.suitId === 'heavy_lead_armor') {
      this.leadApronGroup.visible = true;
      this.leadPauldronsGroup.visible = true;
      const mat = (this.leadApronGroup.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.color.setHex(0x334155);
      mat.metalness = 0.80;
    } else {
      this.leadApronGroup.visible = false;
      this.leadPauldronsGroup.visible = false;
    }

    // 3. Гермошлем КИХ-4, БОП-1 и шевроны МЧС
    //    В режиме от первого лица (firstPersonHeadHidden) скрываем шлемы и маски на уровне глаз,
    //    чтобы исключить клиппинг/клинья по краям фрустума камеры.
    this.helmetGroup.visible = !this.firstPersonHeadHidden && state.suitId === 'kih4_suit';
    this.bopGearGroup.visible = state.suitId === 'bop_suit';
    this.bopHeadMeshes.forEach(m => {
      m.visible = !this.firstPersonHeadHidden;
    });
    this.mchsInsigniaGroup.visible = state.suitId !== 'none';

    // 4. СИЗОД: АСВ-2 (баллоны на спине), ППМ-88, ГП-7 / ГП-7ВМ, Лепесток-200
    this.scbaUnitGroup.visible = state.respiratorId === 'asv2_scba';
    this.ppm88MaskGroup.visible = !this.firstPersonHeadHidden && state.respiratorId === 'ppm88_mask';
    this.gasMaskGroup.visible =
      !this.firstPersonHeadHidden &&
      (state.respiratorId === 'gp7_gasmask' || state.respiratorId === 'gp7vm_gasmask');
    this.gp7vmTubeMesh.visible = !this.firstPersonHeadHidden && state.respiratorId === 'gp7vm_gasmask';
    this.lepestokGroup.visible = !this.firstPersonHeadHidden && state.respiratorId === 'lepestok_200';

    if (this.isFirstPersonMode) {
      this.rootGroup.visible = false;
    }
  }

  /**
   * Полное скрытие 3D-тела/СИЗ персонажа в режиме от первого лица,
   * гарантирующее отсутствие клиппинга торса, плеч и воротника в кадре камеры.
   */
  public setFirstPersonMode(enabled: boolean): void {
    this.isFirstPersonMode = enabled;
    this.firstPersonHeadHidden = enabled;
    this.rootGroup.visible = !enabled;
  }

  /**
   * Следование за поворотом взгляда оператора в десктопном режиме
   */
  public updatePose(camera: THREE.Camera): void {
    if (this.isFirstPersonMode) return;
    this.tempCamEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    this.rootGroup.rotation.y = this.tempCamEuler.y;
  }
}
