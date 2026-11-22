/**
 * ALARA-Planner Pro — Сетевой движок кооперативной работы расчета РХБЗ (MultiplayerManager.ts)
 *
 * Реализует:
 * а) Распределение штатных ролей аварийно-спасательного звена:
 *    - RECON_DOSIMETRIST (Разведчик-дозиметрист: поиск источников, замер МЭД и построение карты изодоз)
 *    - LIQUIDATOR_OPERATOR (Оператор-ликвидатор: монтаж свинцовых экранов, закрытие вентилей, эвакуация пеналов)
 *    - INCIDENT_COMMANDER (Командир пункта управления ЧС: координация, контроль лимитов доз и времени)
 * б) Высокочастотную синхронизацию 6DoF-трансформаций VR-шлема и контроллеров рук (Headset, Left/Right Hand)
 *    с алгоритмом предсказания и сглаживания траектории (Dead Reckoning + Slerp) для стабильных 90 FPS.
 * в) Репликацию физического состояния объектов сцены: координаты защитных экранов, статус задвижек,
 *    активность зон выброса и индивидуальную телеметрию МЭД/ЧСС каждого участника звена.
 */

import * as THREE from 'three';

export type CoopSquadRole = 'RECON_DOSIMETRIST' | 'LIQUIDATOR_OPERATOR' | 'INCIDENT_COMMANDER';

export interface RoleSimulationModifiers {
  /** Множитель скорости выполнения операций с удержанием (задвижки, рубильники, дезактивация) */
  holdActionSpeedMultiplier: number;
  /** Дополнительная дальность взаимодействия и замеров (м) */
  interactionReachBonusM: number;
  /** Ускорение отклика дозиметра / радиационной доразведки */
  detectorResponseBonus: number;
  /** Множитель скорости тушения очагов возгорания (ОУ-5 / ГМ-70) */
  fireSuppressionMultiplier: number;
  /** Коэффициент снижения психофизиологического и теплового стресса (< 1 = выше устойчивость) */
  stressDampingFactor: number;
  /** Порог раннего предупреждения о приближении к лимиту наряда-допуска (доля от H_limit) */
  earlyWarningRatio: number;
}

export interface RoleSpecification {
  role: CoopSquadRole;
  titleRu: string;
  callsignRu: string;
  badgeCodeRu: string;
  responsibilitiesRu: string;
  prioritySummaryRu: string;
  primaryColorHex: string;
  accentHexNumber: number;
  recommendedRemoteToolId: 'hand' | 'extended_arm' | 'manipulator_15m' | 'telescopic_rod_3m';
  modifiers: RoleSimulationModifiers;
}

export const COOP_ROLE_SPECIFICATIONS: Readonly<Record<CoopSquadRole, RoleSpecification>> = {
  RECON_DOSIMETRIST: {
    role: 'RECON_DOSIMETRIST',
    titleRu: 'Разведчик-дозиметрист',
    callsignRu: 'АТОМ-1 (Разведка)',
    badgeCodeRu: 'АТОМ-1',
    responsibilitiesRu: 'Поиск локальных очагов ИИИ, спектрометрия и триангуляция градиента МЭД',
    prioritySummaryRu: 'Доразведка ×1.35 · Отклик ДП-5В +35% · Дальность замера +0.35 м',
    primaryColorHex: '#38bdf8',
    accentHexNumber: 0x38bdf8,
    recommendedRemoteToolId: 'telescopic_rod_3m',
    modifiers: {
      holdActionSpeedMultiplier: 1.05,
      interactionReachBonusM: 0.35,
      detectorResponseBonus: 1.35,
      fireSuppressionMultiplier: 1.0,
      stressDampingFactor: 0.9,
      earlyWarningRatio: 0.8
    }
  },
  LIQUIDATOR_OPERATOR: {
    role: 'LIQUIDATOR_OPERATOR',
    titleRu: 'Оператор-ликвидатор',
    callsignRu: 'АТОМ-2 (Ликвидатор)',
    badgeCodeRu: 'АТОМ-2',
    responsibilitiesRu: 'Установка свинцовых экранов, перекрытие аварийных вентилей и сбор источников в КЗ',
    prioritySummaryRu: 'Работы и задвижки ×1.35 · Тушение ×1.30 · Дальность +0.25 м',
    primaryColorHex: '#f59e0b',
    accentHexNumber: 0xf59e0b,
    recommendedRemoteToolId: 'manipulator_15m',
    modifiers: {
      holdActionSpeedMultiplier: 1.35,
      interactionReachBonusM: 0.25,
      detectorResponseBonus: 1.0,
      fireSuppressionMultiplier: 1.3,
      stressDampingFactor: 0.88,
      earlyWarningRatio: 0.8
    }
  },
  INCIDENT_COMMANDER: {
    role: 'INCIDENT_COMMANDER',
    titleRu: 'Командир расчета (ПУ ЧС)',
    callsignRu: 'ШТАБ-0 (Командир)',
    badgeCodeRu: 'ШТАБ-0',
    responsibilitiesRu: 'Тактическое управление, контроль нарядов-допусков и телеметрии экипажа',
    prioritySummaryRu: 'Стресс −22% · Ранний контроль ALARA (70%) · Координация +0.60 м',
    primaryColorHex: '#10b981',
    accentHexNumber: 0x10b981,
    recommendedRemoteToolId: 'extended_arm',
    modifiers: {
      holdActionSpeedMultiplier: 1.12,
      interactionReachBonusM: 0.6,
      detectorResponseBonus: 1.15,
      fireSuppressionMultiplier: 1.1,
      stressDampingFactor: 0.78,
      earlyWarningRatio: 0.7
    }
  }
};

export interface SixDoFPose {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  linearVelocity: [number, number, number];
}

export interface NetworkPlayerState {
  peerId: string;
  callsign: string;
  role: CoopSquadRole;
  headsetPose: SixDoFPose;
  leftControllerPose: SixDoFPose;
  rightControllerPose: SixDoFPose;
  localDoseRateMsvPerHour: number;
  accumulatedDoseMsv: number;
  heartRateBpm: number;
  flashlightActive: boolean;
  lastTimestampMs: number;
}

export interface SharedWorldObjectState {
  objectId: string;
  objectType: 'LEAD_SHIELD' | 'LEAK_VALVE' | 'CONTAINMENT_CASK' | 'PLUME_SOURCE';
  position: [number, number, number];
  quaternion: [number, number, number, number];
  isSecuredOrClosed: boolean;
  attenuationMultiplier: number;
  updatedByPeerId: string;
  updatedAtMs: number;
}

export type NetworkPacket =
  | {
      type: 'PLAYER_POSE_SYNC';
      payload: NetworkPlayerState;
    }
  | {
      type: 'WORLD_OBJECT_MUTATION';
      payload: SharedWorldObjectState;
    }
  | {
      type: 'COMMANDER_DIRECTIVE';
      payload: {
        senderPeerId: string;
        targetRole: CoopSquadRole | 'ALL';
        directiveTextRu: string;
        timestampMs: number;
      };
    };

/**
 * Буфер Dead Reckoning для одного удаленного VR-игрока:
 * выполняет линейную экстраполяцию по вектору скорости и сферическую интерполяцию (SLERP)
 * ориентации шлема и контроллеров для безупречной плавности 90 Гц между сетевыми пакетами (20–30 Гц).
 */
export class DeadReckoningTransformBuffer {
  private currentHeadPos = new THREE.Vector3();
  private targetHeadPos = new THREE.Vector3();
  private headVelocity = new THREE.Vector3();
  private currentHeadQuat = new THREE.Quaternion();
  private targetHeadQuat = new THREE.Quaternion();

  private currentLeftPos = new THREE.Vector3();
  private targetLeftPos = new THREE.Vector3();
  private leftVelocity = new THREE.Vector3();
  private currentLeftQuat = new THREE.Quaternion();
  private targetLeftQuat = new THREE.Quaternion();

  private currentRightPos = new THREE.Vector3();
  private targetRightPos = new THREE.Vector3();
  private rightVelocity = new THREE.Vector3();
  private currentRightQuat = new THREE.Quaternion();
  private targetRightQuat = new THREE.Quaternion();

  private lastPacketTimeMs = performance.now();

  constructor(initialState: NetworkPlayerState) {
    this.applySnapshotImmediate(initialState);
  }

  public applySnapshotImmediate(state: NetworkPlayerState): void {
    this.currentHeadPos.fromArray(state.headsetPose.position);
    this.targetHeadPos.fromArray(state.headsetPose.position);
    this.headVelocity.fromArray(state.headsetPose.linearVelocity);
    this.currentHeadQuat.fromArray(state.headsetPose.quaternion);
    this.targetHeadQuat.fromArray(state.headsetPose.quaternion);

    this.currentLeftPos.fromArray(state.leftControllerPose.position);
    this.targetLeftPos.fromArray(state.leftControllerPose.position);
    this.leftVelocity.fromArray(state.leftControllerPose.linearVelocity);
    this.currentLeftQuat.fromArray(state.leftControllerPose.quaternion);
    this.targetLeftQuat.fromArray(state.leftControllerPose.quaternion);

    this.currentRightPos.fromArray(state.rightControllerPose.position);
    this.targetRightPos.fromArray(state.rightControllerPose.position);
    this.rightVelocity.fromArray(state.rightControllerPose.linearVelocity);
    this.currentRightQuat.fromArray(state.rightControllerPose.quaternion);
    this.targetRightQuat.fromArray(state.rightControllerPose.quaternion);

    this.lastPacketTimeMs = performance.now();
  }

  public pushNetworkSnapshot(state: NetworkPlayerState): void {
    this.targetHeadPos.fromArray(state.headsetPose.position);
    this.headVelocity.fromArray(state.headsetPose.linearVelocity);
    this.targetHeadQuat.fromArray(state.headsetPose.quaternion);

    this.targetLeftPos.fromArray(state.leftControllerPose.position);
    this.leftVelocity.fromArray(state.leftControllerPose.linearVelocity);
    this.targetLeftQuat.fromArray(state.leftControllerPose.quaternion);

    this.targetRightPos.fromArray(state.rightControllerPose.position);
    this.rightVelocity.fromArray(state.rightControllerPose.linearVelocity);
    this.targetRightQuat.fromArray(state.rightControllerPose.quaternion);

    this.lastPacketTimeMs = performance.now();
  }

  /**
   * Вызывается каждый кадр рендера (90 FPS, dt ~ 0.0111 с).
   * Предсказывает положение по вектору скорости (Dead Reckoning) и плавно притягивает к целевой точке.
   */
  public sampleInterpolatedFrame(dtSec: number): {
    headPosition: THREE.Vector3;
    headQuaternion: THREE.Quaternion;
    leftHandPosition: THREE.Vector3;
    leftHandQuaternion: THREE.Quaternion;
    rightHandPosition: THREE.Vector3;
    rightHandQuaternion: THREE.Quaternion;
  } {
    const timeSincePacketSec = Math.min(0.25, (performance.now() - this.lastPacketTimeMs) / 1000.0);
    const blendFactor = Math.min(1.0, dtSec * 14.0);

    // Экстраполяция целевой точки по скорости (Dead Reckoning)
    const predictedHead = this.targetHeadPos
      .clone()
      .addScaledVector(this.headVelocity, timeSincePacketSec);
    const predictedLeft = this.targetLeftPos
      .clone()
      .addScaledVector(this.leftVelocity, timeSincePacketSec);
    const predictedRight = this.targetRightPos
      .clone()
      .addScaledVector(this.rightVelocity, timeSincePacketSec);

    this.currentHeadPos.lerp(predictedHead, blendFactor);
    this.currentHeadQuat.slerp(this.targetHeadQuat, blendFactor);

    this.currentLeftPos.lerp(predictedLeft, blendFactor);
    this.currentLeftQuat.slerp(this.targetLeftQuat, blendFactor);

    this.currentRightPos.lerp(predictedRight, blendFactor);
    this.currentRightQuat.slerp(this.targetRightQuat, blendFactor);

    return {
      headPosition: this.currentHeadPos.clone(),
      headQuaternion: this.currentHeadQuat.clone(),
      leftHandPosition: this.currentLeftPos.clone(),
      leftHandQuaternion: this.currentLeftQuat.clone(),
      rightHandPosition: this.currentRightPos.clone(),
      rightHandQuaternion: this.currentRightQuat.clone()
    };
  }
}

/**
 * Главный сетевой менеджер кооперативной сессии (WebSockets + BroadcastChannel + AI Squad Simulation)
 */
export class MultiplayerManager {
  public readonly localPeerId: string;
  private localRole: CoopSquadRole = 'RECON_DOSIMETRIST';
  private wsConnection: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private remotePlayers: Map<string, NetworkPlayerState> = new Map();
  private deadReckoningBuffers: Map<string, DeadReckoningTransformBuffer> = new Map();
  private sharedWorldObjects: Map<string, SharedWorldObjectState> = new Map();
  private isConnected = false;
  private simulationTimerId: number | null = null;

  private onPeersUpdatedCallback?: (peers: NetworkPlayerState[]) => void;
  private onWorldObjectMutatedCallback?: (obj: SharedWorldObjectState) => void;
  private onDirectiveReceivedCallback?: (directiveTextRu: string, senderCallsign: string) => void;

  constructor(initialRole: CoopSquadRole = 'RECON_DOSIMETRIST') {
    this.localPeerId = `peer-${Math.random().toString(36).substring(2, 8)}`;
    this.localRole = initialRole;
  }

  public getRole(): CoopSquadRole {
    return this.localRole;
  }

  public setRole(role: CoopSquadRole): void {
    this.localRole = role;
    this.seedSimulatedSquadPeers();
  }

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Подключение к мультиплеерной комнате (WebSocket + межканальная синхронизация вкладок BroadcastChannel)
   */
  public connect(wsEndpointUrl?: string): void {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.broadcastChannel = new BroadcastChannel('alara_vr_coop_channel_v1');
      this.broadcastChannel.onmessage = (event: MessageEvent<NetworkPacket>) => {
        if (event.data) {
          this.handleIncomingPacket(event.data);
        }
      };
    }

    if (wsEndpointUrl) {
      try {
        this.wsConnection = new WebSocket(wsEndpointUrl);
        this.wsConnection.onopen = () => {
          this.isConnected = true;
        };
        this.wsConnection.onmessage = event => {
          try {
            const packet = JSON.parse(String(event.data)) as NetworkPacket;
            this.handleIncomingPacket(packet);
          } catch {
            // Игнорируем некорректные пакеты
          }
        };
      } catch {
        this.isConnected = true;
      }
    } else {
      this.isConnected = true;
    }

    // Инициализация штатного расчета РХБЗ (напарники звена) для совместной отработки в реальном времени
    this.seedSimulatedSquadPeers();
    this.startSquadTelemetryTicker();
  }

  public disconnect(): void {
    this.isConnected = false;
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    if (this.simulationTimerId !== null) {
      window.clearInterval(this.simulationTimerId);
      this.simulationTimerId = null;
    }
  }

  /**
   * Отправка собственной 6DoF-трансформации VR-шлема, контроллеров и локальной МЭД
   */
  public broadcastLocalPlayerState(params: {
    headPosition: [number, number, number];
    headQuaternion: [number, number, number, number];
    velocity: [number, number, number];
    leftHandPosition: [number, number, number];
    rightHandPosition: [number, number, number];
    localDoseRateMsvPerHour: number;
    accumulatedDoseMsv: number;
    heartRateBpm: number;
    flashlightActive: boolean;
  }): void {
    if (!this.isConnected) return;

    const spec = COOP_ROLE_SPECIFICATIONS[this.localRole];
    const state: NetworkPlayerState = {
      peerId: this.localPeerId,
      callsign: spec.callsignRu,
      role: this.localRole,
      headsetPose: {
        position: params.headPosition,
        quaternion: params.headQuaternion,
        linearVelocity: params.velocity
      },
      leftControllerPose: {
        position: params.leftHandPosition,
        quaternion: params.headQuaternion,
        linearVelocity: params.velocity
      },
      rightControllerPose: {
        position: params.rightHandPosition,
        quaternion: params.headQuaternion,
        linearVelocity: params.velocity
      },
      localDoseRateMsvPerHour: params.localDoseRateMsvPerHour,
      accumulatedDoseMsv: params.accumulatedDoseMsv,
      heartRateBpm: params.heartRateBpm,
      flashlightActive: params.flashlightActive,
      lastTimestampMs: performance.now()
    };

    this.sendPacket({
      type: 'PLAYER_POSE_SYNC',
      payload: state
    });
  }

  /**
   * Синхронизация перемещения свинцового экрана, перекрытия аварийного вентиля или закрытия контейнера
   */
  public broadcastWorldObjectMutation(mutation: Omit<SharedWorldObjectState, 'updatedByPeerId' | 'updatedAtMs'>): void {
    const fullState: SharedWorldObjectState = {
      ...mutation,
      updatedByPeerId: this.localPeerId,
      updatedAtMs: performance.now()
    };
    this.sharedWorldObjects.set(fullState.objectId, fullState);
    if (this.onWorldObjectMutatedCallback) {
      this.onWorldObjectMutatedCallback(fullState);
    }
    this.sendPacket({
      type: 'WORLD_OBJECT_MUTATION',
      payload: fullState
    });
  }

  /**
   * Передача тактического приказа от Командира расчета в эфир звена
   */
  public sendCommanderDirective(directiveTextRu: string, targetRole: CoopSquadRole | 'ALL' = 'ALL'): void {
    const packet: NetworkPacket = {
      type: 'COMMANDER_DIRECTIVE',
      payload: {
        senderPeerId: this.localPeerId,
        targetRole,
        directiveTextRu,
        timestampMs: Date.now()
      }
    };
    this.sendPacket(packet);
    if (this.onDirectiveReceivedCallback) {
      this.onDirectiveReceivedCallback(
        directiveTextRu,
        COOP_ROLE_SPECIFICATIONS[this.localRole].callsignRu
      );
    }
  }

  public getRemotePeers(): NetworkPlayerState[] {
    return Array.from(this.remotePlayers.values());
  }

  public getInterpolatedPeerFrame(peerId: string, dtSec: number) {
    const buf = this.deadReckoningBuffers.get(peerId);
    if (!buf) return null;
    return buf.sampleInterpolatedFrame(dtSec);
  }

  public onPeersUpdated(cb: (peers: NetworkPlayerState[]) => void): void {
    this.onPeersUpdatedCallback = cb;
  }

  public onWorldObjectMutated(cb: (obj: SharedWorldObjectState) => void): void {
    this.onWorldObjectMutatedCallback = cb;
  }

  public onDirectiveReceived(cb: (directiveTextRu: string, senderCallsign: string) => void): void {
    this.onDirectiveReceivedCallback = cb;
  }

  private sendPacket(packet: NetworkPacket): void {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(packet);
      } catch {
        // Игнорируем ошибку закрытого канала
      }
    }
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify(packet));
    }
  }

  private handleIncomingPacket(packet: NetworkPacket): void {
    if (packet.type === 'PLAYER_POSE_SYNC') {
      const peer = packet.payload;
      if (peer.peerId === this.localPeerId) return;
      this.remotePlayers.set(peer.peerId, peer);
      const existingBuf = this.deadReckoningBuffers.get(peer.peerId);
      if (existingBuf) {
        existingBuf.pushNetworkSnapshot(peer);
      } else {
        this.deadReckoningBuffers.set(peer.peerId, new DeadReckoningTransformBuffer(peer));
      }
      if (this.onPeersUpdatedCallback) {
        this.onPeersUpdatedCallback(this.getRemotePeers());
      }
    } else if (packet.type === 'WORLD_OBJECT_MUTATION') {
      const obj = packet.payload;
      this.sharedWorldObjects.set(obj.objectId, obj);
      if (this.onWorldObjectMutatedCallback) {
        this.onWorldObjectMutatedCallback(obj);
      }
    } else if (packet.type === 'COMMANDER_DIRECTIVE') {
      if (this.onDirectiveReceivedCallback) {
        this.onDirectiveReceivedCallback(
          packet.payload.directiveTextRu,
          packet.payload.senderPeerId
        );
      }
    }
  }

  private seedSimulatedSquadPeers(): void {
    this.remotePlayers.clear();
    this.deadReckoningBuffers.clear();

    const allRoles: CoopSquadRole[] = [
      'RECON_DOSIMETRIST',
      'LIQUIDATOR_OPERATOR',
      'INCIDENT_COMMANDER'
    ];
    const partnerRoles = allRoles.filter(r => r !== this.localRole);

    partnerRoles.forEach((role, idx) => {
      const spec = COOP_ROLE_SPECIFICATIONS[role];
      const peerId = `sim-squad-${role.toLowerCase()}`;
      const baseX = idx === 0 ? -2.2 : 2.4;
      const baseZ = idx === 0 ? -1.8 : 1.5;

      const peerState: NetworkPlayerState = {
        peerId,
        callsign: spec.callsignRu,
        role,
        headsetPose: {
          position: [baseX, 1.68, baseZ],
          quaternion: [0, 0, 0, 1],
          linearVelocity: [0.12, 0, -0.08]
        },
        leftControllerPose: {
          position: [baseX - 0.28, 1.25, baseZ - 0.35],
          quaternion: [0, 0, 0, 1],
          linearVelocity: [0.12, 0, -0.08]
        },
        rightControllerPose: {
          position: [baseX + 0.28, 1.25, baseZ - 0.35],
          quaternion: [0, 0, 0, 1],
          linearVelocity: [0.12, 0, -0.08]
        },
        localDoseRateMsvPerHour: idx === 0 ? 1.85 : 0.42,
        accumulatedDoseMsv: idx === 0 ? 0.024 : 0.008,
        heartRateBpm: idx === 0 ? 112 : 88,
        flashlightActive: true,
        lastTimestampMs: performance.now()
      };

      this.remotePlayers.set(peerId, peerState);
      this.deadReckoningBuffers.set(peerId, new DeadReckoningTransformBuffer(peerState));
    });

    if (this.onPeersUpdatedCallback) {
      this.onPeersUpdatedCallback(this.getRemotePeers());
    }
  }

  private startSquadTelemetryTicker(): void {
    if (this.simulationTimerId !== null) {
      window.clearInterval(this.simulationTimerId);
    }
    this.simulationTimerId = window.setInterval(() => {
      const t = performance.now() * 0.001;
      this.remotePlayers.forEach((peer, idxKey) => {
        const phase = idxKey.includes('liquidator') ? 1.7 : 0.0;
        const nextX = Number((Math.sin(t * 0.45 + phase) * 2.6).toFixed(3));
        const nextZ = Number((Math.cos(t * 0.35 + phase) * 2.1).toFixed(3));
        const vx = Number((Math.cos(t * 0.45 + phase) * 1.15).toFixed(3));
        const vz = Number((-Math.sin(t * 0.35 + phase) * 0.75).toFixed(3));

        const distToOrigin = Math.max(0.8, Math.hypot(nextX, nextZ));
        const simulatedDoseRate = Number((4.8 / (distToOrigin * distToOrigin)).toFixed(3));
        const updatedPeer: NetworkPlayerState = {
          ...peer,
          headsetPose: {
            position: [nextX, 1.68, nextZ],
            quaternion: [0, Math.sin(t * 0.2) * 0.3, 0, Math.cos(t * 0.2)],
            linearVelocity: [vx, 0, vz]
          },
          leftControllerPose: {
            position: [nextX - 0.25, 1.22, nextZ - 0.35],
            quaternion: [0, 0, 0, 1],
            linearVelocity: [vx, 0, vz]
          },
          rightControllerPose: {
            position: [nextX + 0.25, 1.22, nextZ - 0.35],
            quaternion: [0, 0, 0, 1],
            linearVelocity: [vx, 0, vz]
          },
          localDoseRateMsvPerHour: simulatedDoseRate,
          accumulatedDoseMsv: Number((peer.accumulatedDoseMsv + simulatedDoseRate / 7200.0).toFixed(4)),
          heartRateBpm: Math.round(86 + simulatedDoseRate * 7.5),
          lastTimestampMs: performance.now()
        };

        this.remotePlayers.set(peer.peerId, updatedPeer);
        this.deadReckoningBuffers.get(peer.peerId)?.pushNetworkSnapshot(updatedPeer);
      });

      if (this.onPeersUpdatedCallback) {
        this.onPeersUpdatedCallback(this.getRemotePeers());
      }
    }, 500);
  }
}
