/**
 * ALARA-Planner Pro VR — Движок оперативных вводных, тактических ловушек и хронологического разбора (Debriefing)
 *
 * Обеспечивает нелинейную тактическую симуляцию МЧС:
 * - Выдача радиовводной без линейных спойлеров («Подойди сюда / нажми E»)
 * - Фиксация хронологии ключевых событий, ошибок, «тупиковых» ситуаций и тактических исправлений
 * - Контекстные нормативные ссылки (НРБ-99/2009, ОСПОРБ-99/2010, ВППБ 01-02-95*, БУ ПО МЧС)
 * - Схемы отсеков для Тактического Планшета [Tab]
 */

export type TacticalEventKind = 'DISPATCH' | 'RECON' | 'TRAP' | 'VIOLATION' | 'RECOVERY' | 'SUCCESS';

export interface TacticalTimelineEvent {
  id: string;
  code: string;
  elapsedSec: number;
  kind: TacticalEventKind;
  titleRu: string;
  detailRu: string;
  correctActionRu?: string;
  normativeRu?: string;
  zoneTagRu?: string;
  doseRateMicroSv: number;
  cumulativeDoseMsv: number;
}

export interface OperationalBriefingSpec {
  scenarioId: number;
  callsignRu: string;
  radioDispatchRu: string;
  tacticalObjectiveRu: string;
  knownThreatsRu: string[];
  regulatoryBasisRu: string;
  mapZones: Array<{
    id: string;
    labelRu: string;
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
    tone: 'safe' | 'warn' | 'danger' | 'equip';
  }>;
}

export const OPERATIONAL_BRIEFINGS: Readonly<Record<number, OperationalBriefingSpec>> = {
  1: {
    scenarioId: 1,
    callsignRu: 'РХБЗ-1 • Гермообъём ВВЭР-1200',
    radioDispatchRu:
      'ОПЕРАТИВНАЯ ВВОДНАЯ: В отсеке ГЦК зафиксирован рост гамма-фона. Впереди по коридору — закрытая инспекционная дверь технологического бокса, справа — бетонированная галерея обхода. Определите распределение мощности дозы, локализуйте источник и выйдите через санпропускник в пределах наряда-допуска.',
    tacticalObjectiveRu:
      'Провести радиационную разведку у закрытых конструкций прибором ДП-5В, подобрать поддиапазон без зашкала, исключить вход в неразведанное горячее пятно и выполнить локализацию с минимальной дозой.',
    knownThreatsRu: [
      'Скрытое горячее пятно Co-60 / Cs-137 за закрытой гермодверью',
      'Риск перегрузки (зашкала) чувствительного поддиапазона ДП-5В [Q]',
      'Открытый фрагмент ТВЭЛ (захват только щипцами ЦМ-1.5 [6]) и просыпь'
    ],
    regulatoryBasisRu: 'НРБ-99/2009 • ОСПОРБ-99/2010 п. 3.12 • Боевой устав РХБЗ МЧС',
    mapZones: [
      { id: 'spawn', labelRu: 'Рубеж входа', xPct: 24, yPct: 74, wPct: 28, hPct: 20, tone: 'safe' },
      { id: 'door', labelRu: 'Гермодверь (Замер!)', xPct: 20, yPct: 45, wPct: 34, hPct: 10, tone: 'warn' },
      { id: 'hotspot', labelRu: 'Бокс ГЦК / Пятно', xPct: 16, yPct: 12, wPct: 40, hPct: 30, tone: 'danger' },
      { id: 'shield', labelRu: 'Ширма Pb / САР-1', xPct: 6, yPct: 48, wPct: 14, hPct: 22, tone: 'equip' },
      { id: 'bypass', labelRu: 'Бетонный обход', xPct: 68, yPct: 26, wPct: 24, hPct: 60, tone: 'safe' },
      { id: 'evac', labelRu: 'Шлюз выхода', xPct: 68, yPct: 8, wPct: 24, hPct: 16, tone: 'safe' }
    ]
  },
  2: {
    scenarioId: 2,
    callsignRu: 'ГДЗС-2 • Кабельная полуэтажка 6 кВ',
    radioDispatchRu:
      'ОПЕРАТИВНАЯ ВВОДНАЯ: На кабельной эстакаде 6 кВ пожар при полном обесточивании (SBO) и плотном задымлении. В отсеке находятся повреждённая бочка РАО и пострадавший оператор. Подайте средства тушения с учётом высокого напряжения и теплового потока, затем проведите эвакуацию в САР-2.',
    tacticalObjectiveRu:
      'Обеспечить видимость фонарём [F], исключить поражение током 6 кВ, подавить очаг тактикой «натиск — отход» без повторного воспламенения и эвакуировать пострадавшего с РАО.',
    knownThreatsRu: [
      'Нулевая видимость при SBO и нарастающее задымление под перекрытием',
      'Высокое напряжение 6 кВ (вода из ПК-50 смертельно опасна до обесточивания!)',
      'Критический тепловой поток < 2.8 м и повторное воспламенение при недотушивании'
    ],
    regulatoryBasisRu: 'ВППБ 01-02-95* • Боевой устав ПО МЧС (Работа ГДЗС в электроустановках)',
    mapZones: [
      { id: 'spawn', labelRu: 'Вход в отсек', xPct: 34, yPct: 76, wPct: 32, hPct: 18, tone: 'safe' },
      { id: 'breaker', labelRu: 'Рубильник 6 кВ', xPct: 6, yPct: 38, wPct: 20, hPct: 22, tone: 'equip' },
      { id: 'fire', labelRu: 'Эстакада (Очаг)', xPct: 30, yPct: 12, wPct: 40, hPct: 28, tone: 'danger' },
      { id: 'hydrant', labelRu: 'ПК-50 (Вода!)', xPct: 74, yPct: 44, wPct: 20, hPct: 20, tone: 'warn' },
      { id: 'sar', labelRu: 'Зона САР-2', xPct: 70, yPct: 68, wPct: 24, hPct: 24, tone: 'safe' }
    ]
  },
  3: {
    scenarioId: 3,
    callsignRu: 'СПАС-3 • Шлюз и отсек комбинированной аварии',
    radioDispatchRu:
      'ОПЕРАТИВНАЯ ВВОДНАЯ: В блочном отсеке наложенная авария: пролив радиоактивного аэрозоля теплоносителя (SBO) и открытый высокотемпературный тепловой факел у арматуры. Входной шлюз оснащён стойкой сменных СИЗ. Выполните переключение схемы аварийного питания и расхолаживания ПГ без теплового и аэрозольного поражения.',
    tacticalObjectiveRu:
      'Оценить совместимость экипировки до углубления в зону, при выявлении термической или аэрозольной угрозы отступить в чистый шлюз и подобрать адекватные СИЗ (включая [Tab] / стойку шлюза [E]).',
    knownThreatsRu: [
      'Лёгкие СИЗ (Л-1 / без СИЗ) не выдерживают тепловой поток у факела',
      'Боёвка пожарного (БОП-1) без изолирующего РХБ-контура пропускает аэрозоль в глубине',
      'Необходимость отхода в шлюз и выбора комбинированной защиты (Пневмокостюм Pb + АСВ-2)'
    ],
    regulatoryBasisRu: 'НРБ-99/2009 • ОПБ-88/97 (НП-001-15) • Регламент подбора СИЗ МЧС',
    mapZones: [
      { id: 'airlock', labelRu: 'Шлюз СИЗ (Чисто)', xPct: 28, yPct: 72, wPct: 44, hPct: 22, tone: 'safe' },
      { id: 'thermal', labelRu: 'Тепловой факел', xPct: 12, yPct: 26, wPct: 28, hPct: 28, tone: 'danger' },
      { id: 'aerosol', labelRu: 'Аэрозоль / БПУ', xPct: 42, yPct: 18, wPct: 30, hPct: 34, tone: 'warn' },
      { id: 'mdnu', labelRu: 'МДНУ-150 / Ввод', xPct: 76, yPct: 30, wPct: 18, hPct: 32, tone: 'equip' },
      { id: 'sar', labelRu: 'Контейнер САР-3', xPct: 74, yPct: 68, wPct: 20, hPct: 22, tone: 'safe' }
    ]
  }
};

export function getOperationalBriefing(scenarioId: number): OperationalBriefingSpec | null {
  return OPERATIONAL_BRIEFINGS[scenarioId] ?? null;
}

export class TacticalDebriefingRecorder {
  private events: TacticalTimelineEvent[] = [];
  private recordedCodes = new Set<string>();
  private seq = 0;

  public reset(scenarioId: number, initialDoseRateMicroSv = 0): void {
    this.events = [];
    this.recordedCodes.clear();
    this.seq = 0;

    const briefing = getOperationalBriefing(scenarioId);
    if (briefing) {
      this.recordOnce({
        code: `DISPATCH_S${scenarioId}`,
        elapsedSec: 0,
        kind: 'DISPATCH',
        titleRu: 'Получена оперативная вводная',
        detailRu: briefing.radioDispatchRu,
        normativeRu: briefing.regulatoryBasisRu,
        zoneTagRu: briefing.callsignRu,
        doseRateMicroSv: initialDoseRateMicroSv,
        cumulativeDoseMsv: 0
      });
    }
  }

  public recordOnce(
    params: Omit<TacticalTimelineEvent, 'id'>,
    allowRepeat = false
  ): TacticalTimelineEvent | null {
    if (!allowRepeat && this.recordedCodes.has(params.code)) {
      return null;
    }
    this.recordedCodes.add(params.code);
    this.seq += 1;
    const evt: TacticalTimelineEvent = {
      id: `evt_${this.seq}_${params.code}`,
      ...params
    };
    this.events.push(evt);
    return evt;
  }

  public hasCode(code: string): boolean {
    return this.recordedCodes.has(code);
  }

  public getEvents(): TacticalTimelineEvent[] {
    return [...this.events];
  }

  public getTrapCount(): number {
    return this.events.filter(e => e.kind === 'TRAP' || e.kind === 'VIOLATION').length;
  }

  public getRecoveryCount(): number {
    return this.events.filter(e => e.kind === 'RECOVERY').length;
  }
}
