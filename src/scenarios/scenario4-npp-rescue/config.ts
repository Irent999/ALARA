/**
 * Реэкспорт конфигурации и типов Сценария №4 из модулей src/npp/, src/state/, src/mechanics/
 */

export {
  NPP_NODE_CONFIG,
  SCENARIO_4_CONFIG,
  SCENARIO_4_TRANSFORM,
  type Scenario4TransformConfig,
  type Scenario4OrientationMode,
  type WallColliderBox
} from '../../npp/nppNodeConfig';
export {
  SCENARIO4_PHASES as SCENARIO4_STEPS,
  SCENARIO4_PHASE_ORDER as SCENARIO4_STEP_ORDER,
  type Scenario4PhaseId as Scenario4StepId,
  type Scenario4PhaseMeta as Scenario4StepMeta,
  type Scenario4DebriefSummary,
  type Scenario4HudSnapshot
} from '../../state/scenario4StateMachine';
export type {
  ExtinguisherLifecycleState,
  ExtinguisherStatus
} from '../../mechanics/extinguisherSystem';
export type { NpcEvacState } from '../../mechanics/npcEvacuationSystem';
export type { BuildingVolumeInfo } from '../../npp/nppSceneInspector';
export type { VehicleAutopilotTarget } from '../../mechanics/mchsVehicleSystem';
export type { EmergencyOpsSnapshot } from '../../mechanics/emergencyOpsSystem';
