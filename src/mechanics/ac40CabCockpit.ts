/**
 * ALARA — Детализированная кабина водителя и пульт МЧС автомобиля АЦ-40 (Сценарий №4)
 * (src/mechanics/ac40CabCockpit.ts)
 *
 * Строит объёмный интерьер и каркас кабины АЦ-40 МЧС Узбекистана:
 * - Полый структурный каркас кабины (передний капот, стойки A/B, двери с внутренней обивкой,
 *   крыша с козырьками и плафоном, пол с резиновым ковриком и педальным узлом, кресла расчёта)
 * - Реалистичное панорамное лобовое стекло и боковые стёкла (прозрачность + рамка + щётки стеклоочистителя)
 * - Наружные зеркала заднего вида на кронштейнах
 * - Торпедо с солнцезащитным козырьком и анимированным рулевым колесом
 * - Динамический щиток приборов водителя (CanvasTexture, спидометр, тахометр, передача/автопилот, индикаторы)
 * - Центральную консоль управления пожарно-насосной частью МЧС (давление, расход, длина рукава 0..58 м,
 *   физические 3D-тумблеры с подсветкой активных состояний)
 *
 * Оптимизация: перерисовка CanvasTexture выполняется не чаще 12.5 Гц (80 мс) и только при изменении данных.
 */

import * as THREE from 'three';
import { AC40_CAB_CONFIG, SCENARIO_4_CONFIG } from '../npp/nppNodeConfig';

export interface Ac40CockpitTelemetry {
  readonly isSeated: boolean;
  readonly speedKmh: number;
  readonly steerAngleRad: number;
  readonly throttle: number;
  readonly isAutopilot: boolean;
  readonly autopilotTargetName: string | null;
  readonly isHoseAttached: boolean;
  readonly isSpraying: boolean;
  readonly hoseLengthM: number;
  readonly maxHoseLengthM: number;
  readonly hoseOverstretched: boolean;
  readonly beaconsOn: boolean;
  readonly commsActive: boolean;
  readonly hasAlert: boolean;
}

interface ToggleSwitchVisual {
  readonly leverPivot: THREE.Group;
  readonly ledMat: THREE.MeshStandardMaterial;
}

export class Ac40CabCockpit {
  public readonly rootGroup = new THREE.Group();
  private readonly steeringWheelSpinGroup = new THREE.Group();

  private readonly maxAnisotropy: number;
  private interiorBuilt = false;

  private clusterCanvas: HTMLCanvasElement | null = null;
  private clusterCtx: CanvasRenderingContext2D | null = null;
  private clusterTex: THREE.CanvasTexture | null = null;

  private pumpCanvas: HTMLCanvasElement | null = null;
  private pumpCtx: CanvasRenderingContext2D | null = null;
  private pumpTex: THREE.CanvasTexture | null = null;

  private switchPump: ToggleSwitchVisual | null = null;
  private switchHose: ToggleSwitchVisual | null = null;
  private switchBeacons: ToggleSwitchVisual | null = null;
  private switchComms: ToggleSwitchVisual | null = null;

  private readonly disposables: Array<{ dispose: () => void }> = [];

  private lastDrawMs = -1;
  private lastStateKey = '';

  constructor(maxAnisotropy = 4) {
    this.rootGroup.name = 'ac40_cab_cockpit';
    this.maxAnisotropy = Math.max(1, Math.min(8, maxAnisotropy));

    // На старте строим только лёгкий внешний каркас кабины и остекление;
    // тяжёлый интерьер, рулевая колонка и CanvasTexture-дисплеи собираются лениво при подходе/посадке.
    this.buildCabShellAndGlass();
  }

  public isInteriorBuilt(): boolean {
    return this.interiorBuilt;
  }

  public ensureInteriorBuilt(): void {
    if (this.interiorBuilt) return;
    this.interiorBuilt = true;

    this.clusterCanvas = document.createElement('canvas');
    this.clusterCanvas.width = 512;
    this.clusterCanvas.height = 256;
    this.clusterCtx = this.clusterCanvas.getContext('2d')!;
    this.clusterTex = this.track(new THREE.CanvasTexture(this.clusterCanvas));
    this.clusterTex.colorSpace = THREE.SRGBColorSpace;
    this.clusterTex.anisotropy = this.maxAnisotropy;

    this.pumpCanvas = document.createElement('canvas');
    this.pumpCanvas.width = 512;
    this.pumpCanvas.height = 384;
    this.pumpCtx = this.pumpCanvas.getContext('2d')!;
    this.pumpTex = this.track(new THREE.CanvasTexture(this.pumpCanvas));
    this.pumpTex.colorSpace = THREE.SRGBColorSpace;
    this.pumpTex.anisotropy = this.maxAnisotropy;

    this.buildSeatsAndControls();
    this.buildDashboardAndWheel();

    const switches = this.buildPumpConsole();
    this.switchPump = switches.pump;
    this.switchHose = switches.hose;
    this.switchBeacons = switches.beacons;
    this.switchComms = switches.comms;

    this.drawScreens(
      {
        isSeated: false,
        speedKmh: 0,
        steerAngleRad: 0,
        throttle: 0,
        isAutopilot: false,
        autopilotTargetName: null,
        isHoseAttached: false,
        isSpraying: false,
        hoseLengthM: 0,
        maxHoseLengthM: SCENARIO_4_CONFIG.HOSE.maxLengthM,
        hoseOverstretched: false,
        beaconsOn: true,
        commsActive: true,
        hasAlert: false
      },
      0,
      true
    );
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildCabShellAndGlass(): void {
    const cfg = AC40_CAB_CONFIG;
    const halfW = cfg.cabWidthM * 0.5; // 1.14 м
    const cabLen = cfg.cabFrontZ - cfg.cabRearZ; // 2.00 м
    const cabCenterZ = (cfg.cabFrontZ + cfg.cabRearZ) * 0.5; // 1.96 м

    const redPaint = this.track(
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.36, metalness: 0.24 })
    );
    const whiteTrim = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.42, metalness: 0.1 })
    );
    const blueStripeMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.4, metalness: 0.15 })
    );
    const interiorTrimMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.78, metalness: 0.18 })
    );
    const darkRubberMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.88, metalness: 0.08 })
    );
    const headlinerMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85, metalness: 0.05 })
    );
    const chromeMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.25, metalness: 0.85 })
    );
    const mirrorSurfaceMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.06, metalness: 0.94 })
    );
    const headlightMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xfef9c3,
        emissive: 0xfef08a,
        emissiveIntensity: 0.9,
        roughness: 0.15
      })
    );
    const windshieldGlassMat = this.track(
      new THREE.MeshStandardMaterial({
        color: cfg.windshield.tintHex,
        roughness: 0.08,
        metalness: 0.14,
        transparent: true,
        opacity: cfg.windshield.opacity,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    const sideGlassMat = this.track(
      new THREE.MeshStandardMaterial({
        color: cfg.windshield.tintHex,
        roughness: 0.1,
        metalness: 0.15,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );

    // 1. Пол кабины, центральный моторный тоннель и педали
    const floor = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM - 0.06, 0.14, cabLen)),
      darkRubberMat
    );
    floor.position.set(0, cfg.cabFloorY - 0.07, cabCenterZ);
    floor.receiveShadow = true;
    this.rootGroup.add(floor);

    const engineTunnel = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.48, 0.24, cabLen - 0.14)),
      interiorTrimMat
    );
    engineTunnel.position.set(0, cfg.cabFloorY + 0.1, cabCenterZ);
    this.rootGroup.add(engineTunnel);

    // Педальный узел под рулевой колонкой (газ, тормоз, сцепление)
    const pedalGeo = this.track(new THREE.BoxGeometry(0.06, 0.11, 0.02));
    [-0.1, 0.0, 0.1].forEach((dx, idx) => {
      const pedal = new THREE.Mesh(pedalGeo, idx === 0 ? chromeMat : darkRubberMat);
      pedal.position.set(cfg.steeringWheel.pivotPos[0] + dx, cfg.cabFloorY + 0.11, 2.52);
      pedal.rotation.x = -0.45;
      this.rootGroup.add(pedal);
    });

    // 2. Передний щиток/капот ниже лобового стекла (y = 0.72..1.46) — без перекрытия обзора!
    const frontNoseHeight = cfg.cowlTopY - 0.72;
    const frontNose = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM, frontNoseHeight, 0.42)),
      redPaint
    );
    frontNose.position.set(0, 0.72 + frontNoseHeight * 0.5, cfg.cabFrontZ - 0.21);
    frontNose.castShadow = true;
    this.rootGroup.add(frontNose);

    // Чёрная решётка радиатора и фары снаружи на передке
    const grille = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(1.42, 0.36, 0.04)),
      darkRubberMat
    );
    grille.position.set(0, 1.06, cfg.cabFrontZ + 0.01);
    this.rootGroup.add(grille);

    const headlightGeo = this.track(new THREE.BoxGeometry(0.24, 0.14, 0.04));
    [-0.86, 0.86].forEach(hx => {
      const hl = new THREE.Mesh(headlightGeo, headlightMat);
      hl.position.set(hx, 1.02, cfg.cabFrontZ + 0.015);
      this.rootGroup.add(hl);
    });

    // Белая наружная полоса МЧС только на переднем бампере/боковинах (НЕ сквозь салон!)
    const frontWhiteStrip = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM + 0.02, 0.18, 0.04)),
      whiteTrim
    );
    frontWhiteStrip.position.set(0, 1.29, cfg.cabFrontZ + 0.008);
    this.rootGroup.add(frontWhiteStrip);

    // 3. Боковые двери кабины (левая и правая) — нижние панели + внутренняя обивка + подлокотники
    const doorLowerH = cfg.cowlTopY - 0.72;
    const doorPanelGeo = this.track(new THREE.BoxGeometry(0.08, doorLowerH, cabLen - 0.04));
    const doorExtStripeGeo = this.track(new THREE.BoxGeometry(0.02, 0.18, cabLen - 0.08));
    const doorBlueThinGeo = this.track(new THREE.BoxGeometry(0.022, 0.05, cabLen - 0.08));
    const doorCardGeo = this.track(new THREE.BoxGeometry(0.04, doorLowerH - 0.12, cabLen - 0.2));
    const armrestGeo = this.track(new THREE.BoxGeometry(0.08, 0.05, 0.44));

    [-1, 1].forEach(sideSign => {
      const outerX = sideSign * (halfW - 0.04);
      const doorOuter = new THREE.Mesh(doorPanelGeo, redPaint);
      doorOuter.position.set(outerX, 0.72 + doorLowerH * 0.5, cabCenterZ);
      doorOuter.castShadow = true;
      this.rootGroup.add(doorOuter);

      const doorStripe = new THREE.Mesh(doorExtStripeGeo, whiteTrim);
      doorStripe.position.set(sideSign * (halfW + 0.005), 1.29, cabCenterZ);
      this.rootGroup.add(doorStripe);

      const doorBlue = new THREE.Mesh(doorBlueThinGeo, blueStripeMat);
      doorBlue.position.set(sideSign * (halfW + 0.007), 1.2, cabCenterZ);
      this.rootGroup.add(doorBlue);

      const doorCard = new THREE.Mesh(doorCardGeo, interiorTrimMat);
      doorCard.position.set(sideSign * (halfW - 0.085), 0.76 + doorLowerH * 0.5, cabCenterZ);
      this.rootGroup.add(doorCard);

      const armrest = new THREE.Mesh(armrestGeo, darkRubberMat);
      armrest.position.set(sideSign * (halfW - 0.11), 1.28, 1.72);
      this.rootGroup.add(armrest);
    });

    // 4. Задняя стенка кабины (z = cabRearZ) со смотровым окном
    const rearLower = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM, 0.8, 0.09)),
      redPaint
    );
    rearLower.position.set(0, 1.12, cfg.cabRearZ);
    const rearUpper = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM, 0.24, 0.09)),
      redPaint
    );
    rearUpper.position.set(0, 2.12, cfg.cabRearZ);
    const rearInnerTrim = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM - 0.16, 0.68, 0.04)),
      interiorTrimMat
    );
    rearInnerTrim.position.set(0, 1.2, cfg.cabRearZ + 0.05);
    this.rootGroup.add(rearLower, rearUpper, rearInnerTrim);

    // 5. Передние наклонные стойки A, средние стойки B, верхний козырёк крыши и потолок
    const aPillarGeo = this.track(new THREE.BoxGeometry(0.095, 0.84, 0.11));
    const bPillarGeo = this.track(new THREE.BoxGeometry(0.11, 0.82, 0.22));
    [-1, 1].forEach(sideSign => {
      const aPillar = new THREE.Mesh(aPillarGeo, darkRubberMat);
      aPillar.position.set(sideSign * (halfW - 0.05), 1.83, 2.79);
      aPillar.rotation.x = cfg.windshield.tiltXRad;
      this.rootGroup.add(aPillar);

      const bPillar = new THREE.Mesh(bPillarGeo, redPaint);
      bPillar.position.set(sideSign * (halfW - 0.055), 1.84, cfg.cabRearZ + 0.11);
      this.rootGroup.add(bPillar);

      // Верхняя оконная рама двери
      const doorTopRail = new THREE.Mesh(
        this.track(new THREE.BoxGeometry(0.09, 0.09, 1.72)),
        redPaint
      );
      doorTopRail.position.set(sideSign * (halfW - 0.045), cfg.cabRoofY - 0.045, 1.9);
      this.rootGroup.add(doorTopRail);

      // Боковое остекление двери
      const sideWin = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(1.56, 0.68)),
        sideGlassMat
      );
      sideWin.position.set(sideSign * (halfW - 0.04), 1.82, 1.88);
      sideWin.rotation.y = sideSign * (Math.PI / 2);
      sideWin.renderOrder = 3;
      this.rootGroup.add(sideWin);

      // Наружные зеркала заднего вида (корпус + кронштейн + зеркальная плоскость)
      const mirrorGroup = new THREE.Group();
      mirrorGroup.position.set(sideSign * (halfW + 0.16), 1.78, 2.66);
      mirrorGroup.rotation.y = -sideSign * 0.24;

      const armTop = new THREE.Mesh(
        this.track(new THREE.CylinderGeometry(0.014, 0.014, 0.24, 8)),
        darkRubberMat
      );
      armTop.rotation.z = Math.PI / 2;
      armTop.position.set(-sideSign * 0.1, 0.11, -0.02);

      const armBot = new THREE.Mesh(
        this.track(new THREE.CylinderGeometry(0.014, 0.014, 0.24, 8)),
        darkRubberMat
      );
      armBot.rotation.z = Math.PI / 2;
      armBot.position.set(-sideSign * 0.1, -0.11, -0.02);

      const mirrorHousing = new THREE.Mesh(
        this.track(new THREE.BoxGeometry(0.16, 0.34, 0.06)),
        darkRubberMat
      );
      const mirrorFace = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(0.13, 0.30)),
        mirrorSurfaceMat
      );
      mirrorFace.position.set(0, 0, -0.032);
      mirrorFace.rotation.y = Math.PI;

      mirrorGroup.add(armTop, armBot, mirrorHousing, mirrorFace);
      this.rootGroup.add(mirrorGroup);
    });

    // Крыша кабины и потолочная полка с солнцезащитными козырьками
    const roofOuter = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM, 0.09, 1.86)),
      redPaint
    );
    roofOuter.position.set(0, cfg.cabRoofY, 1.86);
    roofOuter.castShadow = true;
    this.rootGroup.add(roofOuter);

    const roofLiner = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM - 0.16, 0.03, 1.74)),
      headlinerMat
    );
    roofLiner.position.set(0, cfg.cabRoofY - 0.045, 1.86);
    this.rootGroup.add(roofLiner);

    // Верхняя перемычка над лобовым стеклом + противосолнечный козырёк водителя
    const headerBar = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM - 0.04, 0.11, 0.16)),
      interiorTrimMat
    );
    headerBar.position.set(0, cfg.cabRoofY - 0.06, 2.71);
    this.rootGroup.add(headerBar);

    const sunVisor = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.56, 0.11, 0.02)),
      headlinerMat
    );
    sunVisor.position.set(cfg.steeringWheel.pivotPos[0], cfg.cabRoofY - 0.13, 2.58);
    sunVisor.rotation.x = 0.65;
    this.rootGroup.add(sunVisor);

    // 6. Лобовое стекло в тонкой резиновой рамке + щётки стеклоочистителей
    const wsGroup = new THREE.Group();
    wsGroup.position.set(0, cfg.windshield.centerY, cfg.windshield.centerZ);
    wsGroup.rotation.x = cfg.windshield.tiltXRad;

    const wsPane = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(cfg.windshield.widthM, cfg.windshield.heightM)),
      windshieldGlassMat
    );
    wsPane.renderOrder = 4;
    wsGroup.add(wsPane);

    // Тонкий уплотнитель по периметру стекла
    const sealTop = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.windshield.widthM + 0.06, 0.035, 0.035)),
      darkRubberMat
    );
    sealTop.position.set(0, cfg.windshield.heightM * 0.5, 0);
    const sealBot = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.windshield.widthM + 0.06, 0.045, 0.045)),
      darkRubberMat
    );
    sealBot.position.set(0, -cfg.windshield.heightM * 0.5, 0);
    wsGroup.add(sealTop, sealBot);

    // Две щётки стеклоочистителя внизу лобового стекла
    const wiperGeo = this.track(new THREE.BoxGeometry(0.56, 0.018, 0.018));
    [-0.45, 0.45].forEach(wx => {
      const wiper = new THREE.Mesh(wiperGeo, darkRubberMat);
      wiper.position.set(wx, -cfg.windshield.heightM * 0.5 + 0.045, 0.025);
      wiper.rotation.z = 0.07;
      wsGroup.add(wiper);
    });

    this.rootGroup.add(wsGroup);
  }

  private buildSeatsAndControls(): void {
    const seatFabricMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.06 })
    );
    const seatFrameMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.65, metalness: 0.45 })
    );

    const driverX = AC40_CAB_CONFIG.steeringWheel.pivotPos[0];
    // Кресло водителя (слева +X) и кресло командира расчёта (справа -X)
    [driverX, -driverX].forEach(sx => {
      const seatGroup = new THREE.Group();
      seatGroup.position.set(sx, AC40_CAB_CONFIG.cabFloorY, 1.38);

      const pedestal = new THREE.Mesh(
        this.track(new THREE.BoxGeometry(0.36, 0.24, 0.38)),
        seatFrameMat
      );
      pedestal.position.set(0, 0.12, 0);

      const cushion = new THREE.Mesh(
        this.track(new THREE.BoxGeometry(0.48, 0.12, 0.46)),
        seatFabricMat
      );
      cushion.position.set(0, 0.28, 0.04);

      const backrest = new THREE.Mesh(
        this.track(new THREE.BoxGeometry(0.46, 0.58, 0.11)),
        seatFabricMat
      );
      backrest.position.set(0, 0.58, -0.22);
      backrest.rotation.x = -0.1;

      const headrest = new THREE.Mesh(
        this.track(new THREE.BoxGeometry(0.24, 0.16, 0.09)),
        seatFabricMat
      );
      headrest.position.set(0, 0.94, -0.25);

      seatGroup.add(pedestal, cushion, backrest, headrest);
      this.rootGroup.add(seatGroup);
    });

    // Рычаг КПП на центральном моторном тоннеле (справа от водителя)
    const shiftBoot = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.04, 0.065, 0.09, 12)),
      seatFrameMat
    );
    shiftBoot.position.set(0.14, AC40_CAB_CONFIG.cabFloorY + 0.26, 1.98);
    const shiftShaft = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.011, 0.013, 0.26, 10)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.3, metalness: 0.8 }))
    );
    shiftShaft.position.set(0.14, AC40_CAB_CONFIG.cabFloorY + 0.38, 1.98);
    shiftShaft.rotation.x = -0.15;
    const shiftKnob = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(0.032, 12, 10)),
      seatFrameMat
    );
    shiftKnob.position.set(0.14, AC40_CAB_CONFIG.cabFloorY + 0.51, 1.96);
    this.rootGroup.add(shiftBoot, shiftShaft, shiftKnob);
  }

  private buildDashboardAndWheel(): void {
    const dCfg = AC40_CAB_CONFIG.dashboard;
    const wCfg = AC40_CAB_CONFIG.steeringWheel;

    const dashPolymerMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.78, metalness: 0.14 })
    );
    const dashAccentMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.62, metalness: 0.24 })
    );
    const metalAccentMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.34, metalness: 0.78 })
    );
    const rimMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.68, metalness: 0.16 })
    );
    const screenMat = this.track(
      new THREE.MeshStandardMaterial({
        map: this.clusterTex!,
        emissiveMap: this.clusterTex!,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.92,
        roughness: 0.35,
        metalness: 0.08
      })
    );

    // 1. Основная торпедо по ширине кабины + верхняя полка
    const dashBody = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(dCfg.widthM, 0.34, dCfg.depthM)),
      dashPolymerMat
    );
    dashBody.position.set(dCfg.centerX, dCfg.baseY, dCfg.centerZ);
    this.rootGroup.add(dashBody);

    const dashTopDeck = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(dCfg.widthM - 0.04, 0.05, dCfg.depthM + 0.06)),
      dashAccentMat
    );
    dashTopDeck.position.set(dCfg.centerX, dCfg.baseY + 0.18, dCfg.centerZ + 0.02);
    this.rootGroup.add(dashTopDeck);

    // Поручень расчёта на пассажирской стороне
    const grabBar = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 10)),
      metalAccentMat
    );
    grabBar.rotation.z = Math.PI / 2;
    grabBar.position.set(-0.56, dCfg.baseY + 0.14, dCfg.centerZ - 0.24);
    this.rootGroup.add(grabBar);

    // Дефлекторы обдува
    const ventGeo = this.track(new THREE.BoxGeometry(0.14, 0.06, 0.02));
    [-0.36, -0.78, 0.92].forEach(vx => {
      const vent = new THREE.Mesh(ventGeo, rimMat);
      vent.position.set(vx, dCfg.baseY + 0.08, dCfg.centerZ - dCfg.depthM * 0.5 - 0.01);
      this.rootGroup.add(vent);
    });

    // 2. Козырёк и корпус щитка приборов перед водителем
    const binnaclePivot = new THREE.Group();
    binnaclePivot.position.set(dCfg.clusterOffsetX, dCfg.clusterOffsetY, dCfg.clusterOffsetZ);
    binnaclePivot.rotation.x = Math.abs(dCfg.clusterTiltXRad);

    const housing = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(dCfg.screenWidthM + 0.08, dCfg.screenHeightM + 0.06, 0.14)),
      dashPolymerMat
    );
    housing.position.set(0, 0, 0.06);

    const visorTop = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(dCfg.screenWidthM + 0.10, 0.032, 0.18)),
      dashAccentMat
    );
    visorTop.position.set(0, dCfg.screenHeightM * 0.5 + 0.03, -0.02);

    const visorLeft = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.03, dCfg.screenHeightM + 0.04, 0.14)),
      dashAccentMat
    );
    visorLeft.position.set(dCfg.screenWidthM * 0.5 + 0.035, 0, -0.01);

    const visorRight = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.03, dCfg.screenHeightM + 0.04, 0.14)),
      dashAccentMat
    );
    visorRight.position.set(-dCfg.screenWidthM * 0.5 - 0.035, 0, -0.01);

    // Экран щитка приборов (нормаль повернута к водителю на -Z)
    const clusterScreen = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(dCfg.screenWidthM, dCfg.screenHeightM)),
      screenMat
    );
    clusterScreen.position.set(0, 0, -0.012);
    clusterScreen.rotation.y = Math.PI;

    binnaclePivot.add(housing, visorTop, visorLeft, visorRight, clusterScreen);
    this.rootGroup.add(binnaclePivot);

    // 3. Рулевая колонка и поворотное рулевое колесо АЦ-40
    const columnPivot = new THREE.Group();
    columnPivot.position.set(wCfg.pivotPos[0], wCfg.pivotPos[1], wCfg.pivotPos[2]);
    columnPivot.rotation.x = wCfg.tiltXRad;

    const columnTube = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.038, 0.048, 0.36, 14)),
      dashPolymerMat
    );
    columnTube.rotation.x = Math.PI / 2;
    columnTube.position.set(0, 0, 0.18);
    columnPivot.add(columnTube);

    // Подрулевые переключатели (повороты / дворники)
    const stalkGeo = this.track(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8));
    const stalkL = new THREE.Mesh(stalkGeo, rimMat);
    stalkL.rotation.z = Math.PI / 2;
    stalkL.position.set(0.09, 0.02, 0.06);
    const stalkR = new THREE.Mesh(stalkGeo, rimMat);
    stalkR.rotation.z = Math.PI / 2;
    stalkR.position.set(-0.09, 0.02, 0.06);
    columnPivot.add(stalkL, stalkR);

    // Поворачиваемая часть руля
    const rim = new THREE.Mesh(
      this.track(new THREE.TorusGeometry(wCfg.radiusM, wCfg.tubeRadiusM, 14, 32)),
      rimMat
    );
    const hub = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.065, 0.072, 0.045, 18)),
      dashAccentMat
    );
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, 0, -0.01);

    // Красная метка «МЧС» в центре ступицы
    const hubBadge = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 16)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.3, metalness: 0.4 }))
    );
    hubBadge.rotation.x = Math.PI / 2;
    hubBadge.position.set(0, 0, -0.034);

    // 3 спицы руля
    const spokeHGeo = this.track(new THREE.BoxGeometry(wCfg.radiusM * 1.9, 0.034, 0.018));
    const spokeH = new THREE.Mesh(spokeHGeo, metalAccentMat);
    spokeH.position.set(0, -0.02, 0.004);

    const spokeVGeo = this.track(new THREE.BoxGeometry(0.042, wCfg.radiusM * 0.92, 0.018));
    const spokeV = new THREE.Mesh(spokeVGeo, metalAccentMat);
    spokeV.position.set(0, -wCfg.radiusM * 0.46, 0.004);

    this.steeringWheelSpinGroup.add(rim, hub, hubBadge, spokeH, spokeV);
    columnPivot.add(this.steeringWheelSpinGroup);
    this.rootGroup.add(columnPivot);
  }

  private buildPumpConsole(): {
    pump: ToggleSwitchVisual;
    hose: ToggleSwitchVisual;
    beacons: ToggleSwitchVisual;
    comms: ToggleSwitchVisual;
  } {
    const pCfg = AC40_CAB_CONFIG.pumpConsole;

    const consoleBoxMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.65, metalness: 0.25 })
    );
    const plateMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.45 })
    );
    const chromeMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.22, metalness: 0.88 })
    );
    const stopBtnMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0x991b1b,
        emissiveIntensity: 0.35,
        roughness: 0.32
      })
    );
    const screenMat = this.track(
      new THREE.MeshStandardMaterial({
        map: this.pumpTex!,
        emissiveMap: this.pumpTex!,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.9,
        roughness: 0.32,
        metalness: 0.06
      })
    );

    const consolePivot = new THREE.Group();
    consolePivot.position.set(pCfg.pos[0], pCfg.pos[1], pCfg.pos[2]);
    // Отрицательный yaw поворачивает нормаль -Z влево (+X) к водителю
    consolePivot.rotation.y = -Math.abs(pCfg.yawRad);

    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.x = Math.abs(pCfg.tiltXRad);
    consolePivot.add(tiltGroup);

    const body = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(pCfg.widthM, pCfg.heightM, 0.14)),
      consoleBoxMat
    );
    body.position.set(0, 0, 0.07);
    tiltGroup.add(body);

    const bezel = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(pCfg.widthM - 0.03, pCfg.heightM - 0.03, 0.02)),
      plateMat
    );
    bezel.position.set(0, 0, 0.0);
    tiltGroup.add(bezel);

    // Дисплей параметров насоса, давления и рукава
    const screen = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(pCfg.screenWidthM, pCfg.screenHeightM)),
      screenMat
    );
    screen.position.set(0, 0.048, -0.012);
    screen.rotation.y = Math.PI;
    tiltGroup.add(screen);

    // Ряд из 4 3D-тумблеров с подсветкой (Насос, Рукав, Маяки, Связь)
    const makeSwitch = (xPos: number): ToggleSwitchVisual => {
      const swGroup = new THREE.Group();
      swGroup.position.set(xPos, -0.095, -0.012);

      const collar = new THREE.Mesh(
        this.track(new THREE.CylinderGeometry(0.011, 0.013, 0.012, 10)),
        chromeMat
      );
      collar.rotation.x = Math.PI / 2;

      const leverPivot = new THREE.Group();
      const stick = new THREE.Mesh(
        this.track(new THREE.CylinderGeometry(0.004, 0.006, 0.028, 8)),
        chromeMat
      );
      stick.rotation.x = Math.PI / 2;
      stick.position.set(0, 0, -0.015);
      leverPivot.add(stick);

      const ledMat = this.track(
        new THREE.MeshStandardMaterial({
          color: 0x334155,
          emissive: 0x000000,
          emissiveIntensity: 0.9,
          roughness: 0.25
        })
      );
      const led = new THREE.Mesh(
        this.track(new THREE.BoxGeometry(0.034, 0.012, 0.008)),
        ledMat
      );
      led.position.set(0, 0.024, 0);

      swGroup.add(collar, leverPivot, led);
      tiltGroup.add(swGroup);
      return { leverPivot, ledMat };
    };

    const pump = makeSwitch(0.14);
    const hose = makeSwitch(0.055);
    const beacons = makeSwitch(-0.03);
    const comms = makeSwitch(-0.115);

    // Вентиль-регулятор давления + кнопка аварийного останова насоса справа на панели
    const knob = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.022, 0.025, 0.022, 14)),
      chromeMat
    );
    knob.rotation.x = Math.PI / 2;
    knob.position.set(-0.185, -0.07, -0.016);

    const stopBtn = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.018, 0.018, 0.018, 14)),
      stopBtnMat
    );
    stopBtn.rotation.x = Math.PI / 2;
    stopBtn.position.set(-0.185, -0.125, -0.016);
    tiltGroup.add(knob, stopBtn);

    this.rootGroup.add(consolePivot);
    return { pump, hose, beacons, comms };
  }

  private setSwitchVisual(
    sw: ToggleSwitchVisual,
    active: boolean,
    colorHex: number
  ): void {
    sw.leverPivot.rotation.x = active ? -0.38 : 0.38;
    if (active) {
      sw.ledMat.color.setHex(colorHex);
      sw.ledMat.emissive.setHex(colorHex);
      sw.ledMat.emissiveIntensity = 1.15;
    } else {
      sw.ledMat.color.setHex(0x334155);
      sw.ledMat.emissive.setHex(0x000000);
      sw.ledMat.emissiveIntensity = 0;
    }
  }

  public update(telemetry: Ac40CockpitTelemetry, nowMs: number): void {
    if (!this.interiorBuilt) {
      if (!telemetry.isSeated) return;
      this.ensureInteriorBuilt();
    }

    // 1. Поворот рулевого колеса пропорционально углу руления (работает и в ручном режиме, и на автопилоте)
    this.steeringWheelSpinGroup.rotation.z =
      -telemetry.steerAngleRad * AC40_CAB_CONFIG.steeringWheel.maxVisualTurnRad;

    // 2. Обновление положений и подсветки 3D-тумблеров на пульте МЧС
    const beaconBlink = telemetry.beaconsOn && Math.floor(nowMs / 280) % 2 === 0;
    if (this.switchPump) {
      this.setSwitchVisual(
        this.switchPump,
        telemetry.isSpraying || telemetry.isHoseAttached,
        telemetry.isSpraying ? 0x10b981 : 0x0ea5e9
      );
    }
    if (this.switchHose) {
      this.setSwitchVisual(
        this.switchHose,
        telemetry.isHoseAttached,
        telemetry.hoseOverstretched ? 0xf59e0b : 0x14b8a6
      );
    }
    if (this.switchBeacons) {
      this.setSwitchVisual(
        this.switchBeacons,
        telemetry.beaconsOn,
        beaconBlink ? 0x0ea5e9 : 0xf59e0b
      );
    }
    if (this.switchComms) {
      this.setSwitchVisual(this.switchComms, telemetry.commsActive, 0x14b8a6);
    }

    // 3. Оптимизированное обновление CanvasTexture (<= 12.5 Гц и только при изменении показаний)
    this.drawScreens(telemetry, nowMs, false);
  }

  private drawScreens(
    telemetry: Ac40CockpitTelemetry,
    nowMs: number,
    force: boolean
  ): void {
    if (!force && nowMs - this.lastDrawMs < AC40_CAB_CONFIG.canvasRefreshMinIntervalMs) {
      return;
    }

    const speed = Math.max(0, Math.round(telemetry.speedKmh));
    const rpm = Math.round(
      750 + speed * 42 + Math.abs(telemetry.throttle) * 320 + (telemetry.isSpraying ? 450 : 0)
    );
    const rpmQuantized = Math.round(rpm / 50) * 50;
    const gear = telemetry.isAutopilot
      ? 'A'
      : speed === 0
      ? 'N'
      : telemetry.throttle < -0.1
      ? 'R'
      : speed < 14
      ? '1'
      : speed < 28
      ? '2'
      : '3';
    const hoseQuant = Math.round(telemetry.hoseLengthM * 2) / 2;
    const beaconPhase = telemetry.beaconsOn ? (Math.floor(nowMs / 280) % 2) + 1 : 0;

    const stateKey = [
      speed,
      rpmQuantized,
      gear,
      telemetry.isAutopilot ? 1 : 0,
      telemetry.autopilotTargetName ?? '',
      hoseQuant,
      telemetry.isHoseAttached ? 1 : 0,
      telemetry.isSpraying ? 1 : 0,
      telemetry.hoseOverstretched ? 1 : 0,
      beaconPhase,
      telemetry.commsActive ? 1 : 0,
      telemetry.hasAlert ? 1 : 0
    ].join('|');

    if (!force && stateKey === this.lastStateKey) {
      return;
    }

    if (!this.clusterTex || !this.pumpTex || !this.clusterCtx || !this.pumpCtx) {
      return;
    }

    this.lastDrawMs = nowMs;
    this.lastStateKey = stateKey;

    this.renderDriverClusterCanvas(telemetry, speed, rpmQuantized, gear, beaconPhase);
    this.clusterTex.needsUpdate = true;

    this.renderPumpConsoleCanvas(telemetry, hoseQuant, beaconPhase);
    this.pumpTex.needsUpdate = true;
  }

  private renderDriverClusterCanvas(
    t: Ac40CockpitTelemetry,
    speedKmh: number,
    rpm: number,
    gear: string,
    beaconPhase: number
  ): void {
    const ctx = this.clusterCtx!;
    const w = 512;
    const h = 256;

    ctx.fillStyle = '#070D14';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.24)';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Левый циферблат — СПИДОМЕТР (0..90 км/ч)
    this.drawDial(ctx, {
      cx: 118,
      cy: 118,
      r: 82,
      min: 0,
      max: 90,
      value: Math.min(90, speedKmh),
      step: 15,
      accent: '#0EA5E9',
      warnThreshold: 60,
      title: 'КМ/Ч',
      digitalText: `${speedKmh}`,
      subLabel: 'СКОРОСТЬ'
    });

    // Правый циферблат — ТАХОМЕТР (0..4 ×1000)
    const rpmK = Math.min(4.0, rpm / 1000);
    this.drawDial(ctx, {
      cx: 394,
      cy: 118,
      r: 82,
      min: 0,
      max: 4,
      value: rpmK,
      step: 1,
      accent: '#14B8A6',
      warnThreshold: 3.0,
      title: '×1000',
      digitalText: `${rpmK.toFixed(1)}`,
      subLabel: 'ОБОРОТЫ'
    });

    // Центральный информационный блок (Режим + Передача + Цель)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(204, 18, 104, 146);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(204, 18, 104, 146);

    ctx.textAlign = 'center';
    ctx.fillStyle = t.isAutopilot ? '#0EA5E9' : '#94A3B8';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(t.isAutopilot ? 'АВТОПИЛОТ' : 'РУЧНОЙ', 256, 38);

    ctx.fillStyle = t.isAutopilot ? '#0EA5E9' : gear === 'R' ? '#F59E0B' : '#F1F5F9';
    ctx.font = 'bold 46px monospace';
    ctx.fillText(gear, 256, 94);

    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('РЕЖИМ / КПП', 256, 114);

    if (t.autopilotTargetName) {
      ctx.fillStyle = '#14B8A6';
      ctx.font = 'bold 11px sans-serif';
      const shortTarget = t.autopilotTargetName.replace(/^Корпус\s*/i, 'К-');
      ctx.fillText(`→ ${shortTarget}`, 256, 142, 96);
    } else {
      ctx.fillStyle = '#94A3B8';
      ctx.font = '11px monospace';
      ctx.fillText('АЦ-40 МЧС', 256, 142);
    }

    // Нижняя строка контрольных индикаторов
    const lamps: ReadonlyArray<{ label: string; active: boolean; color: string }> = [
      {
        label: 'МАЯКИ',
        active: t.beaconsOn,
        color: beaconPhase === 1 ? '#0EA5E9' : '#F59E0B'
      },
      {
        label: 'ТОРМОЗ (P)',
        active: speedKmh === 0,
        color: '#EF4444'
      },
      {
        label: 'НАСОС ПН-40',
        active: t.isHoseAttached || t.isSpraying,
        color: t.isSpraying ? '#10B981' : '#0EA5E9'
      },
      {
        label: 'АВАРИЯ',
        active: t.hasAlert || t.hoseOverstretched,
        color: '#EF4444'
      }
    ];

    const slotW = 114;
    lamps.forEach((lamp, i) => {
      const lx = 22 + i * (slotW + 5);
      const ly = 212;
      ctx.fillStyle = lamp.active ? `${lamp.color}33` : 'rgba(30, 41, 59, 0.55)';
      ctx.fillRect(lx, ly, slotW, 28);
      ctx.strokeStyle = lamp.active ? lamp.color : 'rgba(148, 163, 184, 0.18)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(lx, ly, slotW, 28);

      ctx.fillStyle = lamp.active ? lamp.color : '#64748B';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(lamp.label, lx + slotW * 0.5, ly + 18);
    });
  }

  private drawDial(
    ctx: CanvasRenderingContext2D,
    opts: {
      cx: number;
      cy: number;
      r: number;
      min: number;
      max: number;
      value: number;
      step: number;
      accent: string;
      warnThreshold: number;
      title: string;
      digitalText: string;
      subLabel: string;
    }
  ): void {
    const startAngle = Math.PI * 0.78;
    const endAngle = Math.PI * 2.22;
    const span = endAngle - startAngle;

    // Фон шкалы
    ctx.beginPath();
    ctx.arc(opts.cx, opts.cy, opts.r, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 10;
    ctx.stroke();

    // Активная дуга
    const frac = THREE.MathUtils.clamp((opts.value - opts.min) / (opts.max - opts.min), 0, 1);
    if (frac > 0.005) {
      ctx.beginPath();
      ctx.arc(opts.cx, opts.cy, opts.r, startAngle, startAngle + span * frac);
      ctx.strokeStyle = opts.value >= opts.warnThreshold ? '#F59E0B' : opts.accent;
      ctx.lineWidth = 10;
      ctx.stroke();
    }

    // Деления шкалы
    for (let v = opts.min; v <= opts.max + 0.0001; v += opts.step) {
      const f = (v - opts.min) / (opts.max - opts.min);
      const ang = startAngle + span * f;
      const x1 = opts.cx + Math.cos(ang) * (opts.r - 12);
      const y1 = opts.cy + Math.sin(ang) * (opts.r - 12);
      const x2 = opts.cx + Math.cos(ang) * (opts.r + 2);
      const y2 = opts.cy + Math.sin(ang) * (opts.r + 2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = v >= opts.warnThreshold ? '#EF4444' : '#CBD5E1';
      ctx.lineWidth = 2;
      ctx.stroke();

      const tx = opts.cx + Math.cos(ang) * (opts.r - 24);
      const ty = opts.cy + Math.sin(ang) * (opts.r - 24);
      ctx.fillStyle = '#94A3B8';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${v}`, tx, ty + 4);
    }

    // Стрелка прибора
    const needleAng = startAngle + span * frac;
    ctx.beginPath();
    ctx.moveTo(opts.cx, opts.cy);
    ctx.lineTo(
      opts.cx + Math.cos(needleAng) * (opts.r - 16),
      opts.cy + Math.sin(needleAng) * (opts.r - 16)
    );
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(opts.cx, opts.cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#F1F5F9';
    ctx.fill();

    // Цифровое окно внизу шкалы
    ctx.textAlign = 'center';
    ctx.fillStyle = '#F1F5F9';
    ctx.font = 'bold 26px monospace';
    ctx.fillText(opts.digitalText, opts.cx, opts.cy + 42);

    ctx.fillStyle = opts.accent;
    ctx.font = 'bold 11px monospace';
    ctx.fillText(opts.title, opts.cx, opts.cy + 58);

    ctx.fillStyle = '#64748B';
    ctx.font = '10px sans-serif';
    ctx.fillText(opts.subLabel, opts.cx, opts.cy - 22);
  }

  private renderPumpConsoleCanvas(
    t: Ac40CockpitTelemetry,
    hoseM: number,
    beaconPhase: number
  ): void {
    const ctx = this.pumpCtx!;
    const w = 512;
    const h = 384;

    ctx.fillStyle = '#070D14';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.24)';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Шапка пульта ПН-40У МЧС Узбекистана
    ctx.fillStyle = '#0B1117';
    ctx.fillRect(10, 10, w - 20, 46);
    ctx.fillStyle = '#0EA5E9';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('МЧС УЗБЕКИСТАНА · ПУЛЬТ ПН-40У', 22, 39);

    const statusText = t.isSpraying
      ? 'ПОДАЧА'
      : t.isHoseAttached
      ? 'ГОТОВ'
      : 'РЕЗЕРВ';
    const statusColor = t.isSpraying
      ? '#10B981'
      : t.isHoseAttached
      ? '#0EA5E9'
      : '#94A3B8';
    ctx.fillStyle = `${statusColor}28`;
    ctx.fillRect(388, 16, 106, 32);
    ctx.strokeStyle = statusColor;
    ctx.strokeRect(388, 16, 106, 32);
    ctx.fillStyle = statusColor;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(statusText, 441, 37);

    // Карточка 1: Давление насоса (МПа)
    const pressureMpa = t.isSpraying ? 0.78 : t.isHoseAttached ? 0.42 : 0.0;
    const flowLps = t.isSpraying ? 40 : t.isHoseAttached ? 12 : 0;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(16, 70, 234, 114);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.strokeRect(16, 70, 234, 114);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94A3B8';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('ДАВЛЕНИЕ НАСОСА', 28, 92);

    ctx.fillStyle = pressureMpa > 0.6 ? '#10B981' : pressureMpa > 0 ? '#0EA5E9' : '#64748B';
    ctx.font = 'bold 34px monospace';
    ctx.fillText(`${pressureMpa.toFixed(2)}`, 28, 136);
    ctx.font = 'bold 16px monospace';
    ctx.fillText('МПа', 124, 136);

    ctx.fillStyle = '#1E293B';
    ctx.fillRect(28, 152, 208, 14);
    ctx.fillStyle = pressureMpa > 0.6 ? '#10B981' : '#0EA5E9';
    ctx.fillRect(28, 152, Math.round(208 * Math.min(1, pressureMpa / 1.0)), 14);

    // Карточка 2: Подача воды / пены (л/с)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(262, 70, 234, 114);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.strokeRect(262, 70, 234, 114);

    ctx.fillStyle = '#94A3B8';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('ПОДАЧА (ВОДА / ПЕНА)', 274, 92);

    ctx.fillStyle = flowLps > 20 ? '#14B8A6' : flowLps > 0 ? '#0EA5E9' : '#64748B';
    ctx.font = 'bold 34px monospace';
    ctx.fillText(`${flowLps}`, 274, 136);
    ctx.font = 'bold 16px monospace';
    ctx.fillText('л/с', 330, 136);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '12px monospace';
    ctx.fillText(t.isSpraying ? 'РАСПЫЛ: АКТИВЕН' : 'ЛИНИЯ: ГМ-70', 274, 166);

    // Карточка 3: Размотка пожарного рукава (0..58 м)
    const maxLen = Math.max(1, t.maxHoseLengthM);
    const hoseRatio = Math.min(1, hoseM / maxLen);
    const hoseColor = t.hoseOverstretched
      ? hoseRatio >= 0.96
        ? '#EF4444'
        : '#F59E0B'
      : t.isHoseAttached
      ? '#14B8A6'
      : '#64748B';

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(16, 196, w - 32, 96);
    ctx.strokeStyle = t.hoseOverstretched ? '#F59E0B' : 'rgba(148, 163, 184, 0.2)';
    ctx.strokeRect(16, 196, w - 32, 96);

    ctx.fillStyle = '#94A3B8';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('ДЛИНА РУКАВНОЙ ЛИНИИ ГМ-70', 28, 218);

    ctx.textAlign = 'right';
    ctx.fillStyle = hoseColor;
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`${hoseM.toFixed(1)} / ${maxLen.toFixed(0)} м`, w - 28, 222);

    ctx.fillStyle = '#1E293B';
    ctx.fillRect(28, 238, w - 56, 22);
    ctx.fillStyle = hoseColor;
    ctx.fillRect(28, 238, Math.round((w - 56) * hoseRatio), 22);

    ctx.textAlign = 'left';
    ctx.fillStyle = t.hoseOverstretched ? '#F59E0B' : '#94A3B8';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(
      t.hoseOverstretched
        ? 'ВНИМАНИЕ: НАТЯЖЕНИЕ РУКАВА > 85%'
        : t.isHoseAttached
        ? 'СТВОЛ ГМ-70 РАЗВЁРНУТ В ЗОНЕ ОПЕРАЦИИ'
        : 'РУКАВ НАМОТАН НА КАТУШКУ',
      28,
      279
    );

    // Карточка 4: Подписи над физическими 3D-тумблерами внизу
    const switchTiles: ReadonlyArray<{ label: string; state: string; active: boolean; color: string }> = [
      {
        label: 'НАСОС',
        state: t.isSpraying ? 'ПУСК' : t.isHoseAttached ? 'ГОТ' : 'ВЫКЛ',
        active: t.isSpraying || t.isHoseAttached,
        color: t.isSpraying ? '#10B981' : '#0EA5E9'
      },
      {
        label: 'РУКАВ',
        state: t.isHoseAttached ? `${hoseM.toFixed(0)}м` : 'КАТУШ',
        active: t.isHoseAttached,
        color: t.hoseOverstretched ? '#F59E0B' : '#14B8A6'
      },
      {
        label: 'МАЯКИ',
        state: t.beaconsOn ? 'ВКЛ' : 'ВЫКЛ',
        active: t.beaconsOn,
        color: beaconPhase === 1 ? '#0EA5E9' : '#F59E0B'
      },
      {
        label: 'СВЯЗЬ',
        state: t.commsActive ? 'МЧС' : 'ТИХ',
        active: t.commsActive,
        color: '#14B8A6'
      }
    ];

    const tileW = 114;
    switchTiles.forEach((item, idx) => {
      const tx = 16 + idx * (tileW + 8);
      const ty = 304;
      ctx.fillStyle = item.active ? `${item.color}22` : 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(tx, ty, tileW, 64);
      ctx.strokeStyle = item.active ? item.color : 'rgba(148, 163, 184, 0.18)';
      ctx.strokeRect(tx, ty, tileW, 64);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#94A3B8';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(item.label, tx + tileW * 0.5, ty + 23);

      ctx.fillStyle = item.active ? item.color : '#64748B';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(item.state, tx + tileW * 0.5, ty + 47);
    });
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.rootGroup.parent?.remove(this.rootGroup);
  }
}
