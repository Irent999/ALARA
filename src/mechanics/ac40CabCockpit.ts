/**
 * ALARA — Облегчённая кабина водителя автомобиля АЦ-40 МЧС (Сценарий №4)
 * (src/mechanics/ac40CabCockpit.ts)
 *
 * Содержит только базовый лёгкий каркас и минимум приборов без тяжёлого рендера:
 * - Полый корпус кабины, остекление, простые боковые зеркала
 * - Простой козырёк и один компактный индикаторный экран (256x128, не чаще 4 Гц и только при изменении данных)
 * - Рулевое колесо на колонке и базовые сиденья (без теней, 3D-тумблеров и мелкого декора)
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

export class Ac40CabCockpit {
  public readonly rootGroup = new THREE.Group();
  private readonly steeringWheelSpinGroup = new THREE.Group();

  private interiorBuilt = false;
  private clusterCanvas: HTMLCanvasElement | null = null;
  private clusterCtx: CanvasRenderingContext2D | null = null;
  private clusterTex: THREE.CanvasTexture | null = null;

  private readonly disposables: Array<{ dispose: () => void }> = [];
  private lastDrawMs = -1;
  private lastStateKey = '';

  constructor(_maxAnisotropy = 2) {
    this.rootGroup.name = 'ac40_cab_cockpit';
    this.buildCabShellAndGlass();
  }

  public isInteriorBuilt(): boolean {
    return this.interiorBuilt;
  }

  public ensureInteriorBuilt(): void {
    if (this.interiorBuilt) return;
    this.interiorBuilt = true;

    this.clusterCanvas = document.createElement('canvas');
    this.clusterCanvas.width = 256;
    this.clusterCanvas.height = 128;
    this.clusterCtx = this.clusterCanvas.getContext('2d');
    this.clusterTex = this.track(new THREE.CanvasTexture(this.clusterCanvas));
    this.clusterTex.colorSpace = THREE.SRGBColorSpace;

    this.buildMinimalInterior();
    this.drawClusterScreen(
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
    const halfW = cfg.cabWidthM * 0.5;
    const cabLen = cfg.cabFrontZ - cfg.cabRearZ;
    const cabCenterZ = (cfg.cabFrontZ + cfg.cabRearZ) * 0.5;

    const redPaint = this.track(
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4, metalness: 0.2 })
    );
    const whiteTrim = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45, metalness: 0.1 })
    );
    const darkTrimMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85, metalness: 0.1 })
    );
    const glassMat = this.track(
      new THREE.MeshBasicMaterial({
        color: cfg.windshield.tintHex,
        transparent: true,
        opacity: cfg.windshield.opacity,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );

    // Пол кабины
    const floor = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM - 0.06, 0.12, cabLen)),
      darkTrimMat
    );
    floor.position.set(0, cfg.cabFloorY - 0.06, cabCenterZ);
    this.rootGroup.add(floor);

    // Передний передок ниже стекла
    const frontNoseHeight = cfg.cowlTopY - 0.72;
    const frontNose = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM, frontNoseHeight, 0.42)),
      redPaint
    );
    frontNose.position.set(0, 0.72 + frontNoseHeight * 0.5, cfg.cabFrontZ - 0.21);
    this.rootGroup.add(frontNose);

    const frontWhiteStrip = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM + 0.02, 0.18, 0.04)),
      whiteTrim
    );
    frontWhiteStrip.position.set(0, 1.29, cfg.cabFrontZ + 0.008);
    this.rootGroup.add(frontWhiteStrip);

    // Боковые двери (нижние панели + белая полоса + простые зеркала)
    const doorLowerH = cfg.cowlTopY - 0.72;
    const doorPanelGeo = this.track(new THREE.BoxGeometry(0.08, doorLowerH, cabLen - 0.04));
    const doorStripeGeo = this.track(new THREE.BoxGeometry(0.02, 0.18, cabLen - 0.08));
    const sideWinGeo = this.track(new THREE.PlaneGeometry(1.56, 0.68));
    const mirrorGeo = this.track(new THREE.BoxGeometry(0.14, 0.3, 0.05));
    const aPillarGeo = this.track(new THREE.BoxGeometry(0.09, 0.84, 0.1));
    const bPillarGeo = this.track(new THREE.BoxGeometry(0.1, 0.82, 0.2));

    [-1, 1].forEach(sideSign => {
      const doorOuter = new THREE.Mesh(doorPanelGeo, redPaint);
      doorOuter.position.set(sideSign * (halfW - 0.04), 0.72 + doorLowerH * 0.5, cabCenterZ);
      this.rootGroup.add(doorOuter);

      const doorStripe = new THREE.Mesh(doorStripeGeo, whiteTrim);
      doorStripe.position.set(sideSign * (halfW + 0.005), 1.29, cabCenterZ);
      this.rootGroup.add(doorStripe);

      const aPillar = new THREE.Mesh(aPillarGeo, darkTrimMat);
      aPillar.position.set(sideSign * (halfW - 0.05), 1.83, 2.79);
      aPillar.rotation.x = cfg.windshield.tiltXRad;
      this.rootGroup.add(aPillar);

      const bPillar = new THREE.Mesh(bPillarGeo, redPaint);
      bPillar.position.set(sideSign * (halfW - 0.055), 1.84, cfg.cabRearZ + 0.1);
      this.rootGroup.add(bPillar);

      const sideWin = new THREE.Mesh(sideWinGeo, glassMat);
      sideWin.position.set(sideSign * (halfW - 0.04), 1.82, 1.88);
      sideWin.rotation.y = sideSign * (Math.PI / 2);
      sideWin.renderOrder = 3;
      this.rootGroup.add(sideWin);

      const mirror = new THREE.Mesh(mirrorGeo, darkTrimMat);
      mirror.position.set(sideSign * (halfW + 0.14), 1.78, 2.66);
      mirror.rotation.y = -sideSign * 0.2;
      this.rootGroup.add(mirror);
    });

    // Задняя стенка и крыша
    const rearWall = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM, 0.85, 0.09)),
      redPaint
    );
    rearWall.position.set(0, 1.15, cfg.cabRearZ);
    const roof = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(cfg.cabWidthM, 0.09, 1.86)),
      redPaint
    );
    roof.position.set(0, cfg.cabRoofY, 1.86);
    this.rootGroup.add(rearWall, roof);

    // Лобовое стекло
    const wsPane = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(cfg.windshield.widthM, cfg.windshield.heightM)),
      glassMat
    );
    wsPane.position.set(0, cfg.windshield.centerY, cfg.windshield.centerZ);
    wsPane.rotation.x = cfg.windshield.tiltXRad;
    wsPane.renderOrder = 4;
    this.rootGroup.add(wsPane);
  }

  private buildMinimalInterior(): void {
    const dCfg = AC40_CAB_CONFIG.dashboard;
    const wCfg = AC40_CAB_CONFIG.steeringWheel;

    const dashMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8, metalness: 0.12 })
    );
    const trimMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.72, metalness: 0.2 })
    );
    const screenMat = this.track(
      new THREE.MeshBasicMaterial({ map: this.clusterTex! })
    );

    // Базовые блоки сидений
    const seatGeo = this.track(new THREE.BoxGeometry(0.46, 0.22, 0.44));
    const backGeo = this.track(new THREE.BoxGeometry(0.44, 0.56, 0.1));
    [wCfg.pivotPos[0], -wCfg.pivotPos[0]].forEach(sx => {
      const cushion = new THREE.Mesh(seatGeo, trimMat);
      cushion.position.set(sx, AC40_CAB_CONFIG.cabFloorY + 0.2, 1.4);
      const back = new THREE.Mesh(backGeo, trimMat);
      back.position.set(sx, AC40_CAB_CONFIG.cabFloorY + 0.55, 1.16);
      this.rootGroup.add(cushion, back);
    });

    // Передняя панель и козырёк с базовым индикатором
    const dashBody = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(dCfg.widthM, 0.32, dCfg.depthM)),
      dashMat
    );
    dashBody.position.set(dCfg.centerX, dCfg.baseY, dCfg.centerZ);
    this.rootGroup.add(dashBody);

    const binnaclePivot = new THREE.Group();
    binnaclePivot.position.set(dCfg.clusterOffsetX, dCfg.clusterOffsetY, dCfg.clusterOffsetZ);
    binnaclePivot.rotation.x = Math.abs(dCfg.clusterTiltXRad);

    const housing = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(dCfg.screenWidthM + 0.06, dCfg.screenHeightM + 0.05, 0.1)),
      dashMat
    );
    housing.position.set(0, 0, 0.045);

    const visorTop = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(dCfg.screenWidthM + 0.08, 0.028, 0.14)),
      trimMat
    );
    visorTop.position.set(0, dCfg.screenHeightM * 0.5 + 0.025, -0.02);

    const clusterScreen = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(dCfg.screenWidthM, dCfg.screenHeightM)),
      screenMat
    );
    clusterScreen.position.set(0, 0, -0.01);
    clusterScreen.rotation.y = Math.PI;

    binnaclePivot.add(housing, visorTop, clusterScreen);
    this.rootGroup.add(binnaclePivot);

    // Рулевая колонка и руль
    const colGroup = new THREE.Group();
    colGroup.position.set(wCfg.pivotPos[0], wCfg.pivotPos[1], wCfg.pivotPos[2]);
    colGroup.rotation.x = wCfg.tiltXRad;

    const column = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.04, 0.048, 0.34, 8)),
      trimMat
    );
    column.rotation.x = Math.PI / 2;
    column.position.set(0, 0, 0.18);
    colGroup.add(column);

    const rim = new THREE.Mesh(
      this.track(new THREE.TorusGeometry(wCfg.radiusM, wCfg.tubeRadiusM, 8, 20)),
      dashMat
    );
    const hub = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 10)),
      trimMat
    );
    hub.rotation.x = Math.PI / 2;
    const spoke = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(wCfg.radiusM * 1.85, 0.032, 0.02)),
      trimMat
    );
    this.steeringWheelSpinGroup.add(rim, hub, spoke);
    colGroup.add(this.steeringWheelSpinGroup);
    this.rootGroup.add(colGroup);
  }

  public update(telemetry: Ac40CockpitTelemetry, nowMs: number): void {
    if (!this.interiorBuilt) return;
    this.steeringWheelSpinGroup.rotation.z = THREE.MathUtils.clamp(
      -telemetry.steerAngleRad * 5.0,
      -AC40_CAB_CONFIG.steeringWheel.maxVisualTurnRad,
      AC40_CAB_CONFIG.steeringWheel.maxVisualTurnRad
    );
    this.drawClusterScreen(telemetry, nowMs, false);
  }

  private drawClusterScreen(
    t: Ac40CockpitTelemetry,
    nowMs: number,
    force: boolean
  ): void {
    if (!this.clusterCtx || !this.clusterTex) return;

    const gear = t.isAutopilot ? 'A' : t.speedKmh > 0 ? (t.throttle < -0.05 ? 'R' : 'D') : 'N';
    const stateKey = `${t.speedKmh}|${gear}|${t.isHoseAttached ? 1 : 0}|${t.beaconsOn ? 1 : 0}|${t.hasAlert ? 1 : 0}`;

    if (
      !force &&
      stateKey === this.lastStateKey &&
      this.lastDrawMs >= 0 &&
      nowMs - this.lastDrawMs < AC40_CAB_CONFIG.canvasRefreshMinIntervalMs
    ) {
      return;
    }
    if (!force && this.lastDrawMs >= 0 && nowMs - this.lastDrawMs < AC40_CAB_CONFIG.canvasRefreshMinIntervalMs) {
      return;
    }

    this.lastDrawMs = nowMs;
    this.lastStateKey = stateKey;

    const ctx = this.clusterCtx;
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = t.hasAlert ? '#ef4444' : '#334155';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 252, 124);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 42px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${t.speedKmh}`, 18, 56);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('КМ/Ч', 18, 76);

    ctx.fillStyle = gear === 'A' ? '#38bdf8' : gear === 'R' ? '#f59e0b' : '#22c55e';
    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(gear, 236, 54);

    // Простые базовые индикаторы систем (МАЯК / РУКАВ / ТРЕВОГА)
    const pills: ReadonlyArray<{ label: string; active: boolean; color: string }> = [
      { label: 'МАЯК', active: t.beaconsOn, color: '#38bdf8' },
      { label: 'РУКАВ', active: t.isHoseAttached, color: '#f59e0b' },
      { label: 'АВАР', active: t.hasAlert, color: '#ef4444' }
    ];
    pills.forEach((p, idx) => {
      const px = 14 + idx * 78;
      ctx.fillStyle = p.active ? p.color : '#1e293b';
      ctx.fillRect(px, 90, 72, 24);
      ctx.fillStyle = p.active ? '#090d16' : '#64748b';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.label, px + 36, 106);
    });

    this.clusterTex.needsUpdate = true;
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables.length = 0;
    this.clusterCanvas = null;
    this.clusterCtx = null;
    this.clusterTex = null;
    this.rootGroup.parent?.remove(this.rootGroup);
  }
}
