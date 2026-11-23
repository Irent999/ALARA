/**
 * ALARA — Дополнительные аварийно-спасательные операции МЧС на АЭС (Сценарий №4)
 * (src/mechanics/emergencyOpsSystem.ts)
 *
 * Реализует 3 тактические механики, интегрированные в общий сценарий:
 * 1. Радиационная доразведка у входа в корпус (RAD_RECON)
 * 2. Перекрытие аварийного контура / вытяжной вентиляции (LOOP_ISOLATION — снижает дым в корпусах)
 * 3. Первичная стабилизация пострадавшего работника АЭС (CASUALTY_TRIAGE — подача кислорода)
 */

import * as THREE from 'three';
import { SCENARIO_4_CONFIG } from '../npp/nppNodeConfig';
import { TargetMarkerSprite } from './targetMarkerSprite';

export interface EmergencyOpsSnapshot {
  readonly radReconDone: boolean;
  readonly radReconProgress01: number;
  readonly loopIsolated: boolean;
  readonly casualtyStabilized: boolean;
  readonly smokeMultiplier: number;
  readonly completedOpsCount: number;
  readonly totalOpsCount: number;
  readonly nearestPendingPromptRu: string | null;
}

export class EmergencyOpsSystem {
  public readonly rootGroup = new THREE.Group();

  public readonly radReconPos = new THREE.Vector3();
  public readonly loopIsolationPos = new THREE.Vector3();
  public readonly casualtyTriagePos = new THREE.Vector3();

  public radReconDone = false;
  public radReconTimerSec = 0;
  public loopIsolated = false;
  public casualtyStabilized = false;

  private readonly radRingMat: THREE.MeshBasicMaterial;
  private readonly radLedMat: THREE.MeshStandardMaterial;
  private readonly valveWheelGroup = new THREE.Group();
  private readonly valveRingMat: THREE.MeshBasicMaterial;
  private readonly valveLedMat: THREE.MeshStandardMaterial;
  private readonly casualtyRingMat: THREE.MeshBasicMaterial;
  private readonly casualtyMaskMesh: THREE.Mesh;

  private readonly disposables: Array<{ dispose: () => void }> = [];
  private animClockSec = 0;
  private reachBonusM = 0;
  private radReconSpeedMultiplier = 1.0;
  private targetMarkersVisible = true;

  private readonly radMarkerSprite = new TargetMarkerSprite(2.45, 0.72);
  private readonly valveMarkerSprite = new TargetMarkerSprite(2.55, 0.75);
  private readonly casualtyMarkerSprite = new TargetMarkerSprite(2.55, 0.75);

  public setTargetMarkersVisible(visible: boolean): void {
    this.targetMarkersVisible = visible;
    this.radMarkerSprite.sprite.visible = visible && !this.radReconDone;
    this.valveMarkerSprite.sprite.visible = visible && !this.loopIsolated;
    this.casualtyMarkerSprite.sprite.visible = visible && !this.casualtyStabilized;
  }

  public setRoleModifiers(reachBonusM: number, radReconSpeedMultiplier: number): void {
    this.reachBonusM = Math.max(0, reachBonusM);
    this.radReconSpeedMultiplier = Math.max(0.5, radReconSpeedMultiplier);
  }

  constructor(params: {
    radReconPos: THREE.Vector3;
    loopIsolationPos: THREE.Vector3;
    casualtyTriagePos: THREE.Vector3;
  }) {
    this.rootGroup.name = 'npp_emergency_ops_root';
    this.radReconPos.copy(params.radReconPos);
    this.loopIsolationPos.copy(params.loopIsolationPos);
    this.casualtyTriagePos.copy(params.casualtyTriagePos);

    // 1. Пост радиационной доразведки у входного шлюза
    const radMats = this.buildRadReconStation();
    this.radRingMat = radMats.ringMat;
    this.radLedMat = radMats.ledMat;

    // 2. Узел задвижки аварийного контура и вентиляции внутри Корпуса 1
    const valveMats = this.buildLoopIsolationStation();
    this.valveRingMat = valveMats.ringMat;
    this.valveLedMat = valveMats.ledMat;

    // 3. Пострадавший оператор внутри Корпуса 2 (первая помощь и кислород)
    const casMats = this.buildCasualtyTriageStation();
    this.casualtyRingMat = casMats.ringMat;
    this.casualtyMaskMesh = casMats.maskMesh;

    this.radMarkerSprite.sprite.position.set(this.radReconPos.x, this.radReconPos.y + 2.55, this.radReconPos.z);
    this.valveMarkerSprite.sprite.position.set(this.loopIsolationPos.x, this.loopIsolationPos.y + 2.75, this.loopIsolationPos.z);
    this.casualtyMarkerSprite.sprite.position.set(this.casualtyTriagePos.x, this.casualtyTriagePos.y + 2.55, this.casualtyTriagePos.z);
    this.rootGroup.add(
      this.radMarkerSprite.sprite,
      this.valveMarkerSprite.sprite,
      this.casualtyMarkerSprite.sprite
    );
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildRadReconStation(): {
    ringMat: THREE.MeshBasicMaterial;
    ledMat: THREE.MeshStandardMaterial;
  } {
    const g = new THREE.Group();
    g.position.copy(this.radReconPos);

    const metalMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.72 })
    );
    const yellowMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.42, metalness: 0.25 })
    );
    const ledMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xd97706,
        emissiveIntensity: 0.85
      })
    );
    const ringMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55
      })
    );

    const pole = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.05, 0.08, 1.35, 10)),
      metalMat
    );
    pole.position.y = 0.68;
    const head = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.32, 0.24, 0.22)),
      yellowMat
    );
    head.position.y = 1.42;
    const led = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(0.08, 10, 10)),
      ledMat
    );
    led.position.y = 1.62;
    const ring = new THREE.Mesh(
      this.track(new THREE.RingGeometry(0.85, 1.05, 28)),
      ringMat
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;

    g.add(pole, head, led, ring);
    this.rootGroup.add(g);
    return { ringMat, ledMat };
  }

  private buildLoopIsolationStation(): {
    ringMat: THREE.MeshBasicMaterial;
    ledMat: THREE.MeshStandardMaterial;
  } {
    const g = new THREE.Group();
    g.position.copy(this.loopIsolationPos);

    const pipeMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.35, metalness: 0.8 })
    );
    const bodyMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.65 })
    );
    const redWheelMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.38, metalness: 0.35 })
    );
    const ledMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 0.9
      })
    );
    const ringMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.62
      })
    );

    const cabinet = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.82, 1.55, 0.54)),
      bodyMat
    );
    cabinet.position.set(0, 0.78, -0.35);
    cabinet.castShadow = true;

    const pipe = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.14, 0.14, 1.4, 12)),
      pipeMat
    );
    pipe.position.set(0, 0.7, 0.05);

    const wheelRim = new THREE.Mesh(
      this.track(new THREE.TorusGeometry(0.28, 0.038, 10, 20)),
      redWheelMat
    );
    const spokeA = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.54, 0.04, 0.04)),
      redWheelMat
    );
    const spokeB = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.04, 0.54, 0.04)),
      redWheelMat
    );
    this.valveWheelGroup.add(wheelRim, spokeA, spokeB);
    this.valveWheelGroup.position.set(0, 1.15, 0.24);

    const led = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(0.08, 10, 10)),
      ledMat
    );
    led.position.set(0, 1.65, -0.2);

    const ring = new THREE.Mesh(
      this.track(new THREE.RingGeometry(0.75, 0.95, 28)),
      ringMat
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;

    g.add(cabinet, pipe, this.valveWheelGroup, led, ring);
    this.rootGroup.add(g);
    return { ringMat, ledMat };
  }

  private buildCasualtyTriageStation(): {
    ringMat: THREE.MeshBasicMaterial;
    maskMesh: THREE.Mesh;
  } {
    const g = new THREE.Group();
    g.position.copy(this.casualtyTriagePos);

    const suitMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6, metalness: 0.1 })
    );
    const darkMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 })
    );
    const helmetMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 })
    );
    const medBagMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.45 })
    );
    const maskMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.5
      })
    );
    const ringMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65
      })
    );

    const matPad = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.95, 0.08, 1.85)),
      darkMat
    );
    matPad.position.y = 0.04;

    const torso = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.42, 0.24, 0.66)),
      suitMat
    );
    torso.position.set(0, 0.2, -0.05);

    const head = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(0.14, 14, 12)),
      helmetMat
    );
    head.position.set(0, 0.24, -0.48);

    const legGeo = this.track(new THREE.CylinderGeometry(0.08, 0.07, 0.62, 10));
    legGeo.rotateX(Math.PI / 2);
    const legL = new THREE.Mesh(legGeo, suitMat);
    legL.position.set(-0.12, 0.16, 0.55);
    const legR = new THREE.Mesh(legGeo, suitMat);
    legR.position.set(0.12, 0.16, 0.55);

    const maskMesh = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.14, 0.1, 0.14)),
      maskMat
    );
    maskMesh.position.set(0, 0.3, -0.56);
    maskMesh.visible = false;

    const medBag = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.32, 0.22, 0.22)),
      medBagMat
    );
    medBag.position.set(0.45, 0.15, -0.2);

    const ring = new THREE.Mesh(
      this.track(new THREE.RingGeometry(0.88, 1.08, 28)),
      ringMat
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;

    g.add(matPad, torso, head, legL, legR, maskMesh, medBag, ring);
    this.rootGroup.add(g);
    return { ringMat, maskMesh };
  }

  public tryInteract(playerPos: THREE.Vector3): {
    handled: boolean;
    kind: 'RAD_RECON' | 'LOOP_ISOLATION' | 'CASUALTY_TRIAGE' | null;
    titleRu: string | null;
    messageRu: string | null;
  } {
    const cfg = SCENARIO_4_CONFIG.EMERGENCY_OPS;
    const bonus = this.reachBonusM;

    if (!this.radReconDone && playerPos.distanceTo(this.radReconPos) <= cfg.radReconRadiusM + bonus) {
      this.completeRadRecon();
      return {
        handled: true,
        kind: 'RAD_RECON',
        titleRu: 'РАДИАЦИОННАЯ РАЗВЕДКА ВЫПОЛНЕНА',
        messageRu: 'Периметр корпуса проверен ДП-5В, уровни излучения введены в протокол ALARA.'
      };
    }

    if (
      !this.loopIsolated &&
      playerPos.distanceTo(this.loopIsolationPos) <= cfg.loopIsolationRadiusM + bonus
    ) {
      this.loopIsolated = true;
      this.valveRingMat.color.setHex(0x22c55e);
      this.valveLedMat.color.setHex(0x22c55e);
      this.valveLedMat.emissive.setHex(0x16a34a);
      return {
        handled: true,
        kind: 'LOOP_ISOLATION',
        titleRu: 'АВАРИЙНЫЙ КОНТУР ПЕРЕКРЫТ',
        messageRu: 'Задвижка закрыта, включена аварийная вытяжка — задымление в корпусах снижено на 65%!'
      };
    }

    if (
      !this.casualtyStabilized &&
      playerPos.distanceTo(this.casualtyTriagePos) <= cfg.casualtyTriageRadiusM + bonus
    ) {
      this.casualtyStabilized = true;
      this.casualtyRingMat.color.setHex(0x22c55e);
      this.casualtyMaskMesh.visible = true;
      return {
        handled: true,
        kind: 'CASUALTY_TRIAGE',
        titleRu: 'ПОСТРАДАВШИЙ СТАБИЛИЗИРОВАН',
        messageRu: 'Подана кислородная маска и наложен первичный контроль дозы. Готов к эвакуации!'
      };
    }

    return { handled: false, kind: null, titleRu: null, messageRu: null };
  }

  private completeRadRecon(): void {
    this.radReconDone = true;
    this.radReconTimerSec = SCENARIO_4_CONFIG.EMERGENCY_OPS.radReconDurationSec;
    this.radRingMat.color.setHex(0x22c55e);
    this.radLedMat.color.setHex(0x22c55e);
    this.radLedMat.emissive.setHex(0x16a34a);
  }

  public update(dt: number, playerPos: THREE.Vector3): {
    justCompletedRadRecon: boolean;
    smokeMultiplier: number;
  } {
    this.animClockSec += dt;
    let justCompletedRadRecon = false;

    // Автоматическая доразведка при нахождении возле входного поста ДП-5В (ускоряется при роли Дозиметриста АТОМ-1 и штанге)
    if (!this.radReconDone) {
      const distRad = playerPos.distanceTo(this.radReconPos);
      if (distRad <= SCENARIO_4_CONFIG.EMERGENCY_OPS.radReconRadiusM + this.reachBonusM) {
        this.radReconTimerSec += dt * this.radReconSpeedMultiplier;
        if (this.radReconTimerSec >= SCENARIO_4_CONFIG.EMERGENCY_OPS.radReconDurationSec) {
          this.completeRadRecon();
          justCompletedRadRecon = true;
        }
      }
    }

    // Плавное вращение штурвала задвижки после перекрытия
    if (this.loopIsolated && this.valveWheelGroup.rotation.z < Math.PI * 2) {
      this.valveWheelGroup.rotation.z = Math.min(
        Math.PI * 2,
        this.valveWheelGroup.rotation.z + dt * 4.5
      );
    }

    const distRad = playerPos.distanceTo(this.radReconPos);
    const distValve = playerPos.distanceTo(this.loopIsolationPos);
    const distCas = playerPos.distanceTo(this.casualtyTriagePos);

    this.radMarkerSprite.sync(
      {
        title: `ДОРАЗВЕДКА ДП-5В · ${Math.round(distRad)} м`,
        subtitle: `У входа · Прогресс ${Math.min(100, Math.round((this.radReconTimerSec / SCENARIO_4_CONFIG.EMERGENCY_OPS.radReconDurationSec) * 100))}%`,
        accentHex: '#FACC15',
        bgHex: 'rgba(66, 32, 6, 0.88)'
      },
      distRad,
      this.targetMarkersVisible && !this.radReconDone
    );

    this.valveMarkerSprite.sync(
      {
        title: `АВАР. ЗАДВИЖКА · ${Math.round(distValve)} м`,
        subtitle: 'Корпус №1 · Перекрыть контур [E]',
        accentHex: '#EF4444',
        bgHex: 'rgba(69, 10, 10, 0.9)'
      },
      distValve,
      this.targetMarkersVisible && !this.loopIsolated
    );

    this.casualtyMarkerSprite.sync(
      {
        title: `ПОСТРАДАВШИЙ · ${Math.round(distCas)} м`,
        subtitle: 'Корпус №2 · Подать кислород [E]',
        accentHex: '#38BDF8',
        bgHex: 'rgba(8, 47, 73, 0.9)'
      },
      distCas,
      this.targetMarkersVisible && !this.casualtyStabilized
    );

    this.radRingMat.opacity = this.radReconDone
      ? 0.25
      : 0.42 + Math.sin(this.animClockSec * 4.0) * 0.18;
    this.valveRingMat.opacity = this.loopIsolated
      ? 0.25
      : 0.45 + Math.sin(this.animClockSec * 4.5) * 0.2;
    this.casualtyRingMat.opacity = this.casualtyStabilized
      ? 0.25
      : 0.45 + Math.sin(this.animClockSec * 3.8) * 0.2;

    return {
      justCompletedRadRecon,
      smokeMultiplier: this.loopIsolated
        ? SCENARIO_4_CONFIG.EMERGENCY_OPS.smokeReductionFactor
        : 1.0
    };
  }

  public getNearestPendingPrompt(playerPos: THREE.Vector3): {
    promptRu: string;
    pos: THREE.Vector3;
    colorHex: number;
  } | null {
    const cfg = SCENARIO_4_CONFIG.EMERGENCY_OPS;
    const bonus = this.reachBonusM;

    if (!this.radReconDone && playerPos.distanceTo(this.radReconPos) <= cfg.radReconRadiusM + bonus) {
      const pct = Math.min(100, Math.round((this.radReconTimerSec / cfg.radReconDurationSec) * 100));
      return {
        promptRu: `[E] — Завершить радиационную доразведку у входа (${pct}%)`,
        pos: this.radReconPos,
        colorHex: 0xfacc15
      };
    }

    if (!this.loopIsolated && playerPos.distanceTo(this.loopIsolationPos) <= cfg.loopIsolationRadiusM + bonus) {
      return {
        promptRu: '[E] / Курок — Перекрыть задвижку аварийного контура и включить вытяжку',
        pos: this.loopIsolationPos,
        colorHex: 0xef4444
      };
    }

    if (
      !this.casualtyStabilized &&
      playerPos.distanceTo(this.casualtyTriagePos) <= cfg.casualtyTriageRadiusM + bonus
    ) {
      return {
        promptRu: '[E] / Курок — Оказать медпомощь пострадавшему (кислород/сортировка)',
        pos: this.casualtyTriagePos,
        colorHex: 0x38bdf8
      };
    }

    return null;
  }

  public getSnapshot(playerPos: THREE.Vector3): EmergencyOpsSnapshot {
    const completed =
      (this.radReconDone ? 1 : 0) +
      (this.loopIsolated ? 1 : 0) +
      (this.casualtyStabilized ? 1 : 0);
    const nearest = this.getNearestPendingPrompt(playerPos);

    return {
      radReconDone: this.radReconDone,
      radReconProgress01: this.radReconDone
        ? 1
        : Math.min(1, this.radReconTimerSec / SCENARIO_4_CONFIG.EMERGENCY_OPS.radReconDurationSec),
      loopIsolated: this.loopIsolated,
      casualtyStabilized: this.casualtyStabilized,
      smokeMultiplier: this.loopIsolated
        ? SCENARIO_4_CONFIG.EMERGENCY_OPS.smokeReductionFactor
        : 1.0,
      completedOpsCount: completed,
      totalOpsCount: 3,
      nearestPendingPromptRu: nearest?.promptRu ?? null
    };
  }

  public dispose(): void {
    this.radMarkerSprite.dispose();
    this.valveMarkerSprite.dispose();
    this.casualtyMarkerSprite.dispose();
    this.disposables.forEach(d => d.dispose());
    this.rootGroup.parent?.remove(this.rootGroup);
  }
}
