/**
 * ALARA-Planner Pro — Строгая типизация структуры сценариев ЧС и РХБЗ
 * (src/scenarios/types.ts)
 */

import { RadionuclideId, ShieldMaterialId } from '../physics/PhysicsEngine';
import { PasquillStabilityClass } from '../physics/gostPhysics';

// ============================================================================
// 1. ТИПЫ СОСТОЯНИЙ СТЕЙТ-МАШИНЫ И КАТЕГОРИЙ СЦЕНАРИЕВ
// ============================================================================

export type ScenarioLifecycleState =
  | 'INIT'
  | 'RUNNING'
  | 'CRITICAL_WARNING'
  | 'COMPLETED'
  | 'FAILED';

export type ScenarioCategory =
  | 'NPP'
  | 'Medical'
  | 'Industrial'
  | 'Military'
  | 'Environmental';

export type ObjectiveStatus = 'pending' | 'completed' | 'failed';

export type ObjectiveCriticality = 'low' | 'medium' | 'high' | 'critical';

export type HazardEntityType =
  | 'point_source'
  | 'plume'
  | 'leak_valve'
  | 'debris';

export type HazardMeshArchetype =
  | 'fuel_assembly_fragment'
  | 'graphite_block'
  | 'sealed_isotope_capsule'
  | 'tuk_transport_cask'
  | 'high_pressure_steam_valve'
  | 'corroded_waste_drum'
  | 'radiochem_puddle';

// ============================================================================
// 2. ИНТЕРФЕЙС ЗАДАЧИ (SCENARIO OBJECTIVE)
// ============================================================================

export interface ScenarioObjective {
  /** Уникальный идентификатор задачи внутри сценария */
  readonly id: string;
  /** Подробное тактико-техническое описание задачи для спасателя */
  readonly description: string;
  /** Текущий статус выполнения задачи */
  status: ObjectiveStatus;
  /** Уровень критичности задачи для предотвращения эскалации аварии */
  readonly criticality: ObjectiveCriticality;
  /** Максимально допустимое время выполнения этапа от старта миссии (с) */
  readonly timeThresholdSec: number;
  /** Контрольный предел накопленной эквивалентной дозы для данного этапа (мЗв) */
  readonly doseLimitMsv: number;
  /** Опциональная привязка к ID объекта угрозы HazardEntity для автоматического зачета */
  readonly targetEntityId?: string;
  /** Радиус взаимодействия или дозиметрической разведки вокруг целевого объекта (м) */
  readonly requiredProximityMeters?: number;
}

// ============================================================================
// 3. ИНТЕРФЕЙС ФИЗИЧЕСКОГО ИСТОЧНИКА УГРОЗЫ (HAZARD ENTITY)
// ============================================================================

export interface HazardGeometryData {
  /** Архетип 3D-геометрии для генератора мешей HazardSourceSpawner */
  readonly archetype: HazardMeshArchetype;
  /** Габаритные размеры или радиус [x, y, z] в метрах */
  readonly dimensionsMeters: readonly [number, number, number];
  /** Поворот объекта в радианах [rotX, rotY, rotZ] */
  readonly rotationEulerRad?: readonly [number, number, number];
  /** Базовый цвет материала (Hex) */
  readonly primaryColorHex: number;
  /** Эмиссионный цвет подсветки / индикации (Hex) */
  readonly emissiveColorHex?: number;
  /** Активировать ли шейдер свечения Вавилова — Черенкова вокруг объекта */
  readonly hasCherenkovGlow?: boolean;
  /** Радиус ореола Вавилова — Черенкова в метрах */
  readonly cherenkovRadiusMeters?: number;
  /** Параметры объемного аэрозольного плюма (для типов 'plume' и 'leak_valve') */
  readonly plumeConfig?: {
    readonly plumeLengthMeters: number;
    readonly releaseHeightMeters: number;
    readonly aerosolColorHex: number;
    readonly baseOpacity: number;
  };
}

export interface HazardEntity {
  /** Уникальный идентификатор источника угрозы */
  readonly id: string;
  /** Наименование узла или источника в оперативной сводке */
  readonly nameRu: string;
  /** Физический класс угрозы: точечный источник, аэрозольный плюм, аварийный вентиль, радиоактивный обломок */
  readonly type: HazardEntityType;
  /** Мировые координаты источника [x, y, z] в метрах */
  readonly position: readonly [number, number, number];
  /** Паспортная активность радионуклида A в гигабеккерелях (ГБк, 1 ГБк = 10⁹ Бк) */
  readonly activityGbk: number;
  /** Ключ радионуклида из физического ядра PhysicsEngine.ts */
  readonly radionuclideKey: RadionuclideId;
  /** Опциональный материал первичного защитного экрана вокруг источника по ГОСТ */
  readonly materialShieldKey?: ShieldMaterialId;
  /** Эффективная толщина первичного защитного экрана (в сантиметрах) */
  readonly shieldThicknessCm?: number;
  /** Геометрические и визуальные параметры для 3D-спавнера HazardSourceSpawner */
  readonly geometryData: HazardGeometryData;
  /** Флаг локализации / обезвреживания источника в ходе выполнения миссии */
  isMitigated?: boolean;
}

// ============================================================================
// 4. ИНТЕРФЕЙС АТМОСФЕРНЫХ УСЛОВИЙ И ПОЛНОЙ КОНФИГУРАЦИИ СЦЕНАРИЯ (SCENARIO DATA)
// ============================================================================

export interface ScenarioAtmosphereConfig {
  /** Скорость воздушного потока / вентиляции на объекте (м/с) */
  readonly windSpeedMps: number;
  /** Азимут направления ветра в плоскости XZ (радианы) */
  readonly windDirectionRad: number;
  /** Класс атмосферной устойчивости по Паскуиллу — Гиффорду (A..F) */
  readonly stabilityClass: PasquillStabilityClass;
  /** Температура среды (°C) */
  readonly ambientTemperatureC: number;
  /** Относительная влажность / плотность пара (%) */
  readonly humidityPercent: number;
  /** Признак аварийного затемнения помещения (требуется тактический фонарь 5500K) */
  readonly isLowLightEmergency: boolean;
  /** Дальность прямой оптической видимости в аэрозоле/дыму (м) */
  readonly visibilityRangeMeters: number;
}

export interface ScenarioData {
  /** Номер сценария (1..12) */
  readonly id: number;
  /** Кодовый индекс оперативного сценария */
  readonly codeName: string;
  /** Полное наименование сценария ЧС */
  readonly title: string;
  /** Отраслевая категория ЧС */
  readonly category: ScenarioCategory;
  /** Оперативно-тактическая сводка и радиационная обстановка */
  readonly description: string;
  /** Стартовая позиция спасателя в мировых координатах [x, y, z] (м) */
  readonly playerStartPosition: readonly [number, number, number];
  /** Предельно допустимая накопленная эквивалентная доза за операцию по наряду-допуску (мЗв) */
  readonly doseLimitMsv: number;
  /** Контрольный норматив времени выполнения операции (с) */
  readonly maxDurationSec: number;
  /** Обязательность применения изолирующего комплекта СИЗ в зоне работ */
  readonly requireHazmatPpe: boolean;
  /** Начальные метеорологические и микроклиматические параметры среды */
  readonly atmosphere: ScenarioAtmosphereConfig;
  /** Массив физических источников радиационных и химико-радиационных угроз */
  readonly hazards: ReadonlyArray<HazardEntity>;
  /** Упорядоченный граф тактических задач сценария */
  readonly objectives: ReadonlyArray<ScenarioObjective>;
}
