/**
 * Компактный сворачиваемый 2D HUD, сервисный инспектор /assembly.glb и итоговый разбор МЧС (Сценарий №4).
 * По умолчанию панели свёрнуты в аккуратные чипы, чтобы оставлять максимум 3D-обзора.
 * Правило WebGL-совместимости: строго без backdrop-blur-* и без animate-pulse.
 */

import React, { useRef, useState } from 'react';
import {
  ShieldAlert,
  Upload,
  RotateCcw,
  CheckCircle2,
  Award,
  Timer,
  Bug,
  XCircle,
  Crosshair,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Truck,
  Navigation
} from 'lucide-react';
import type { Scenario4HudSnapshot } from './config';

interface Scenario4HudProps {
  snapshot: Scenario4HudSnapshot;
  isHudVisible: boolean;
  onRestart: () => void;
  onRetryLoadGlb: () => void;
  onFocusModel: () => void;
  onSelectCustomGlbFile: (file: File) => void;
  onBoardOrExitVehicle: () => void;
  onStartAutopilot: (buildingIndex: number) => void;
  onCancelAutopilot: () => void;
}

export const Scenario4Hud: React.FC<Scenario4HudProps> = ({
  snapshot,
  isHudVisible,
  onRestart,
  onRetryLoadGlb,
  onFocusModel,
  onSelectCustomGlbFile,
  onBoardOrExitVehicle,
  onStartAutopilot,
  onCancelAutopilot
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // По умолчанию обе боковые панели и блок сервисных кнопок свёрнуты, чтобы не перекрывать 3D-сцену
  const [isMissionCollapsed, setIsMissionCollapsed] = useState(true);
  const [isVehicleCollapsed, setIsVehicleCollapsed] = useState(true);
  const [isServiceToolsOpen, setIsServiceToolsOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onSelectCustomGlbFile(file);
    }
    e.target.value = '';
  };

  const mins = Math.floor(snapshot.elapsedSec / 60);
  const secs = Math.floor(snapshot.elapsedSec % 60);
  const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  const isFailed = snapshot.debrief?.outcome === 'FAILED';

  const { vehicle, emergencyOps } = snapshot;
  const hosePct =
    vehicle.maxHoseLengthM > 0
      ? Math.min(100, Math.round((vehicle.hoseLengthM / vehicle.maxHoseLengthM) * 100))
      : 0;
  const smokePct = Math.round(snapshot.smokeExposure01 * 100);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Термическая виньетка при приближении к очагам */}
      {snapshot.thermalHeatLoad01 > 0.06 && (
        <div
          className="pointer-events-none fixed inset-0 z-10 transition-opacity duration-200"
          style={{
            opacity: Math.min(0.85, snapshot.thermalHeatLoad01 * 0.9),
            background:
              'radial-gradient(circle at center, rgba(251,146,60,0) 45%, rgba(234,88,12,0.38) 80%, rgba(185,28,28,0.68) 100%)'
          }}
        />
      )}

      {/* Индикатор асинхронной загрузки /assembly.glb */}
      {snapshot.isLoadingGlb && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/88 pointer-events-auto">
          <div className="w-96 max-w-[90vw] p-5 rounded-xl bg-slate-950 border border-white/15 shadow-2xl space-y-3 text-slate-100">
            <div className="text-xs font-mono text-sky-400 tracking-wide">
              Сценарий №4 · Загрузка 3D-модели АЭС (.glb)
            </div>
            <div className="text-sm font-semibold">{snapshot.loadStatusRu}</div>
            <div className="w-full h-2 rounded bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all duration-150"
                style={{ width: `${Math.max(4, Math.min(100, snapshot.loadProgressPct))}%` }}
              />
            </div>
            <div className="text-right text-xs font-mono tabular-nums text-slate-400">
              {Math.round(snapshot.loadProgressPct)}%
            </div>
          </div>
        </div>
      )}

      {/* Сообщение об ошибке загрузки /assembly.glb */}
      {!snapshot.isLoadingGlb && snapshot.loadErrorRu && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/90 p-4 pointer-events-auto">
          <div className="max-w-lg w-full p-5 rounded-xl bg-slate-950 border border-rose-500/50 shadow-2xl space-y-3.5 text-slate-100">
            <div className="flex items-center gap-2 text-rose-400 text-xs font-mono font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Ошибка загрузки 3D-модели АЭС (/assembly.glb)</span>
            </div>
            <div className="text-sm font-semibold text-white">
              Не удалось загрузить оригинальную модель АЭС через GLTFLoader.
            </div>
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/35 text-xs font-mono text-rose-200 break-words">
              {snapshot.loadErrorRu}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onRetryLoadGlb}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Повторить</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Выбрать локальный .glb</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ВЕРХНИЙ ЛЕВЫЙ УГОЛ: Сворачиваемый чип / карточка миссии и сервис */}
      {isHudVisible && !snapshot.isLoadingGlb && !snapshot.loadErrorRu && !snapshot.debrief && (
        <div className="fixed top-14 left-3 z-30 pointer-events-none flex flex-col gap-1.5 w-[360px] max-w-[calc(100vw-24px)]">
          {isMissionCollapsed ? (
            <button
              type="button"
              onClick={() => setIsMissionCollapsed(false)}
              className="pointer-events-auto self-start px-3 py-1.5 rounded-lg bg-slate-950/90 hover:bg-slate-900 border border-white/12 shadow-lg flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-200 cursor-pointer whitespace-nowrap"
              title="Развернуть карточку миссии"
            >
              <span className="text-sky-300 font-bold">
                Фаза {snapshot.stepNumber}/{snapshot.totalSteps}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-orange-300">
                Очаги {snapshot.firesExtinguished}/{snapshot.totalFires}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-300">
                Эвак. {snapshot.rescuedCount}/{snapshot.totalNpcCount}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">
                Угрозы {emergencyOps.completedOpsCount}/{emergencyOps.totalOpsCount}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>
          ) : (
            <div className="pointer-events-auto px-3 py-2.5 rounded-lg bg-slate-950/92 border border-white/12 shadow-xl space-y-2">
              {/* Заголовок фазы + таймер + свернуть */}
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-sky-300 font-bold truncate">
                  Фаза {snapshot.stepNumber}/{snapshot.totalSteps} · {snapshot.stepTitleRu}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 flex items-center gap-1 tabular-nums whitespace-nowrap">
                    <Timer className="w-3 h-3" />
                    {timeStr}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsMissionCollapsed(true)}
                    className="p-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-white/10 cursor-pointer"
                    title="Свернуть карточку миссии"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="text-xs text-slate-100 leading-snug">{snapshot.instructionRu}</div>

              {/* Единая строка ключевых метрик */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1.5 border-t border-white/10 text-[11px] font-mono tabular-nums text-slate-300">
                <span className="text-orange-300 whitespace-nowrap">
                  Очаги {snapshot.firesExtinguished}/{snapshot.totalFires}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-emerald-300 whitespace-nowrap">
                  Эвак. {snapshot.rescuedCount}/{snapshot.totalNpcCount}
                </span>
                <span className="text-slate-600">·</span>
                {vehicle.isHoseAttached ? (
                  <span className="text-sky-300 whitespace-nowrap">
                    ГМ-70 {vehicle.hoseLengthM.toFixed(0)} м
                  </span>
                ) : (
                  <span
                    className={`whitespace-nowrap ${
                      snapshot.extinguisherStatus === 'EMPTY'
                        ? 'text-rose-400 font-bold'
                        : snapshot.extinguisherStatus === 'ARMED'
                        ? 'text-cyan-300'
                        : 'text-amber-300'
                    }`}
                  >
                    ОУ-5:{' '}
                    {snapshot.extinguisherStatus === 'ON_POST'
                      ? 'на посту'
                      : snapshot.extinguisherStatus === 'HELD_LOCKED'
                      ? `${snapshot.extinguisherChargePct}% [чека]`
                      : snapshot.extinguisherStatus === 'EMPTY'
                      ? 'пуст'
                      : `${snapshot.extinguisherChargePct}%`}
                  </span>
                )}
                {smokePct > 5 && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className={smokePct >= 45 ? 'text-amber-300' : 'text-slate-400'}>
                      Дым {smokePct}%
                    </span>
                  </>
                )}
              </div>

              {/* Лаконичная строка аварийных операций МЧС */}
              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/10 text-[10px] font-mono tabular-nums">
                <span className={emergencyOps.radReconDone ? 'text-emerald-300' : 'text-slate-400'}>
                  ДП-5В: {emergencyOps.radReconDone ? 'Готово' : `${Math.round(emergencyOps.radReconProgress01 * 100)}%`}
                </span>
                <span className={emergencyOps.loopIsolated ? 'text-emerald-300' : 'text-amber-300'}>
                  Контур: {emergencyOps.loopIsolated ? 'Перекрыт' : 'Открыт'}
                </span>
                <span className={emergencyOps.casualtyStabilized ? 'text-emerald-300' : 'text-rose-300'}>
                  Медпомощь: {emergencyOps.casualtyStabilized ? 'Оказана' : 'Ожидает'}
                </span>
              </div>

              {/* Сворачиваемое сервисное меню (Фокус [K], Узлы, .GLB) */}
              <div className="pt-1.5 border-t border-white/10 flex items-center justify-between gap-2 text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => setIsServiceToolsOpen(v => !v)}
                  className="flex items-center gap-1 text-slate-400 hover:text-slate-200 cursor-pointer whitespace-nowrap"
                >
                  {isServiceToolsOpen ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  <span>Сервис и .glb</span>
                </button>

                {isServiceToolsOpen && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={onFocusModel}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-white/10 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      title="Центрировать камеру на Box3 модели [K]"
                    >
                      <Crosshair className="w-3 h-3" />
                      <span>Фокус [K]</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsInspectorOpen(v => !v)}
                      className={`px-2 py-0.5 rounded border flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        isInspectorOpen
                          ? 'bg-sky-900/70 border-sky-500/60 text-sky-200'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-white/10'
                      }`}
                      title="Диагностика узлов /assembly.glb"
                    >
                      <Bug className="w-3 h-3" />
                      <span>Узлы</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-sky-300 border border-white/10 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      title="Загрузить локальный .glb-файл"
                    >
                      <Upload className="w-3 h-3" />
                      <span>.GLB</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Инспектор графа .glb (открывается только вручную через Сервис -> Узлы) */}
          {!isMissionCollapsed && isServiceToolsOpen && isInspectorOpen && snapshot.inspectionReport && (
            <div className="pointer-events-auto p-3 rounded-lg bg-slate-950/95 border border-white/12 text-[11px] font-mono text-slate-200 space-y-1.5 shadow-xl max-h-56 overflow-y-auto">
              <div className="flex items-center justify-between text-sky-300 font-bold">
                <span>Инспектор АЭС ({snapshot.inspectionReport.sourceKind})</span>
                <span className="tabular-nums">{snapshot.inspectionReport.boundingBoxSize.join('×')} м</span>
              </div>
              <div className="text-slate-400 tabular-nums">
                Узлов: {snapshot.inspectionReport.totalNodes} · Мешей:{' '}
                {snapshot.inspectionReport.totalMeshes} · Оборудование:{' '}
                <span className="text-emerald-300">{snapshot.installedEquipmentCount}</span>
              </div>
              {snapshot.inspectionReport.buildingVolumes.length > 0 && (
                <div className="pt-1 border-t border-white/10 text-[10px] text-slate-400 space-y-0.5 tabular-nums">
                  {snapshot.inspectionReport.buildingVolumes.map((b, idx) => (
                    <div key={idx} className="truncate">
                      • {b.name}: {b.size.join('×')} м · пол Y={b.interiorFloorY} м
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {snapshot.warningBannerRu && (
            <div className="px-3 py-2 rounded-lg bg-rose-950/95 border border-rose-500/80 text-xs text-rose-100 font-medium flex items-center gap-2 shadow-lg">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{snapshot.warningBannerRu}</span>
            </div>
          )}
        </div>
      )}

      {/* НИЖНИЙ ЛЕВЫЙ УГОЛ: Сворачиваемый чип / панель техники МЧС Узбекистана (АЦ-40) */}
      {isHudVisible && !snapshot.isLoadingGlb && !snapshot.loadErrorRu && !snapshot.debrief && (
        <div className="fixed bottom-16 left-3 z-30 pointer-events-none w-[320px] max-w-[calc(100vw-24px)]">
          {isVehicleCollapsed ? (
            <div className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950/90 border border-white/12 shadow-lg text-[11px] font-mono tabular-nums text-slate-200">
              <button
                type="button"
                onClick={() => setIsVehicleCollapsed(false)}
                className="flex items-center gap-1.5 hover:text-white cursor-pointer whitespace-nowrap"
                title="Развернуть управление машиной АЦ-40 и рукавом"
              >
                <Truck className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="font-semibold">АЦ-40</span>
                <span className="text-slate-600">·</span>
                <span className={vehicle.isSeated ? 'text-emerald-300' : 'text-slate-400'}>
                  {vehicle.isSeated
                    ? `${vehicle.speedKmh} км/ч`
                    : vehicle.autopilotTargetName
                    ? `→ ${vehicle.autopilotTargetName}`
                    : vehicle.isHoseAttached
                    ? `Рукав ${vehicle.hoseLengthM.toFixed(0)}/${vehicle.maxHoseLengthM}м`
                    : 'На посту'}
                </span>
                <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>

              {(vehicle.isSeated || vehicle.nearDoor) && (
                <button
                  type="button"
                  onClick={onBoardOrExitVehicle}
                  className={`ml-1 px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer whitespace-nowrap ${
                    vehicle.isSeated
                      ? 'bg-rose-900/70 hover:bg-rose-800 border-rose-500/50 text-rose-100'
                      : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-slate-950'
                  }`}
                >
                  {vehicle.isSeated ? 'Выйти [Enter]' : 'Сесть [Enter]'}
                </button>
              )}
            </div>
          ) : (
            <div className="pointer-events-auto px-3 py-2.5 rounded-lg bg-slate-950/92 border border-white/12 shadow-xl space-y-2 text-[11px] font-mono">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-slate-100 font-semibold truncate">
                  <Truck className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="truncate">АЦ-40 МЧС</span>
                  <span className="text-slate-600">·</span>
                  <span className={`tabular-nums ${vehicle.isSeated ? 'text-emerald-300' : 'text-slate-400'}`}>
                    {vehicle.isSeated ? `${vehicle.speedKmh} км/ч` : vehicle.nearDoor ? 'У двери' : 'На посту'}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={onBoardOrExitVehicle}
                    className={`px-2 py-0.5 rounded border text-[10px] font-semibold cursor-pointer whitespace-nowrap ${
                      vehicle.isSeated
                        ? 'bg-rose-900/70 hover:bg-rose-800 border-rose-500/50 text-rose-100'
                        : vehicle.nearDoor
                        ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-slate-950'
                        : 'bg-slate-900 hover:bg-slate-800 border-white/12 text-slate-300'
                    }`}
                  >
                    {vehicle.isSeated ? 'Выйти [Enter]' : 'В кабину [Enter]'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsVehicleCollapsed(true)}
                    className="p-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-white/10 cursor-pointer"
                    title="Свернуть панель техники"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Автопилот между корпусами */}
              {vehicle.targets.length > 0 && (
                <div className="space-y-1 pt-1.5 border-t border-white/10">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Navigation className="w-3 h-3 text-sky-400" />
                      <span>
                        {vehicle.autopilotTargetName
                          ? `Маршрут → ${vehicle.autopilotTargetName}`
                          : 'Автопилот [B]:'}
                      </span>
                    </span>
                    {vehicle.autopilotTargetName && (
                      <button
                        type="button"
                        onClick={onCancelAutopilot}
                        className="text-rose-300 hover:text-rose-200 underline cursor-pointer"
                      >
                        Стоп
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {vehicle.targets.slice(0, 4).map(t => {
                      const isActiveTarget = vehicle.autopilotTargetName === t.name;
                      return (
                        <button
                          key={t.index}
                          type="button"
                          onClick={() => onStartAutopilot(t.index)}
                          className={`px-2 py-0.5 rounded border text-[10px] tabular-nums cursor-pointer whitespace-nowrap ${
                            isActiveTarget
                              ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-semibold'
                              : 'bg-slate-900 hover:bg-slate-800 border-white/10 text-slate-300'
                          }`}
                        >
                          {t.name.replace(/^Корпус\s*/i, 'Корп. ')} · {t.distanceM}м
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Пожарный рукав */}
              <div className="space-y-1 pt-1.5 border-t border-white/10">
                <div className="flex items-center justify-between text-[10px] tabular-nums">
                  <span
                    className={
                      vehicle.hoseOverstretched
                        ? 'text-amber-300 font-semibold'
                        : vehicle.isHoseAttached
                        ? 'text-sky-300'
                        : 'text-slate-400'
                    }
                  >
                    Рукав {vehicle.isHoseAttached ? 'подключён' : 'на катушке'}
                  </span>
                  <span className="text-slate-300">
                    {vehicle.hoseLengthM.toFixed(1)} / {vehicle.maxHoseLengthM} м
                  </span>
                </div>
                <div className="w-full h-1.5 rounded bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      vehicle.hoseOverstretched
                        ? 'bg-amber-400'
                        : vehicle.isHoseAttached
                        ? 'bg-sky-400'
                        : 'bg-slate-600'
                    }`}
                    style={{ width: `${vehicle.isHoseAttached ? Math.max(4, hosePct) : 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Финальный протокол разбора МЧС (COMPLETED / FAILED) */}
      {snapshot.debrief && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/88 p-4 pointer-events-auto">
          <div
            className={`max-w-2xl w-full rounded-xl bg-slate-950 border shadow-2xl p-6 space-y-4 text-slate-100 ${
              isFailed ? 'border-rose-500/55' : 'border-emerald-500/45'
            }`}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <div
                  className={`text-xs font-mono flex items-center gap-1.5 ${
                    isFailed ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {isFailed ? (
                    <XCircle className="w-4 h-4" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>
                    {isFailed
                      ? 'Операция МЧС Узбекистана прервана'
                      : 'Операция МЧС Узбекистана завершена'}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-white mt-1">
                  Итоговый протокол разбора (Сценарий №4)
                </h2>
              </div>
              <div
                className={`px-3 py-1.5 rounded-lg border font-mono text-sm font-bold flex items-center gap-1.5 ${
                  isFailed
                    ? 'bg-rose-500/15 border-rose-400/50 text-rose-300'
                    : 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300'
                }`}
              >
                <Award className="w-4 h-4" />
                <span>Класс {snapshot.debrief.grade}</span>
              </div>
            </div>

            <div
              className={`text-xs font-medium border rounded-lg px-3.5 py-2 ${
                isFailed
                  ? 'text-rose-200 bg-rose-950/35 border-rose-500/40'
                  : 'text-emerald-300 bg-emerald-950/35 border-emerald-500/30'
              }`}
            >
              {snapshot.debrief.gradeLabelRu}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono tabular-nums">
              <div className="p-3 rounded-lg bg-slate-900/70 border border-white/10">
                <div className="text-[10px] text-slate-400">ВРЕМЯ ОПЕРАЦИИ</div>
                <div className="text-base font-bold text-white mt-0.5">{timeStr}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/70 border border-white/10">
                <div className="text-[10px] text-slate-400">СПАСЕНО ПЕРСОНАЛА</div>
                <div className="text-base font-bold text-emerald-300 mt-0.5">
                  {snapshot.debrief.rescuedCount} / {snapshot.debrief.totalNpcCount} чел.
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/70 border border-white/10">
                <div className="text-[10px] text-slate-400">ПОТУШЕНО ОЧАГОВ</div>
                <div className="text-base font-bold text-orange-300 mt-0.5">
                  {snapshot.debrief.extinguishedFires} / {snapshot.debrief.totalFires}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/70 border border-white/10">
                <div className="text-[10px] text-slate-400">ОУ-5 / СРЕДСТВА</div>
                <div className="text-base font-bold text-sky-300 mt-0.5">
                  {snapshot.debrief.remainingExtinguisherPct}% ({snapshot.debrief.cylindersUsed} балл.)
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/70 border border-white/10">
                <div className="text-[10px] text-slate-400">ДОЗА ALARA</div>
                <div className="text-base font-bold text-amber-300 mt-0.5">
                  {(snapshot.debrief.cumulativeDoseMsv * 1000).toFixed(1)} мкЗв
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/70 border border-white/10">
                <div className="text-[10px] text-slate-400">ПИК ТЕПЛОВОЙ НАГР.</div>
                <div className="text-base font-bold text-rose-300 mt-0.5">
                  {snapshot.debrief.peakHeatLoadPct}%
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
              <div
                className={`px-2.5 py-1.5 rounded-lg border ${
                  snapshot.debrief.radReconDone
                    ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-900/70 border-white/10 text-slate-400'
                }`}
              >
                Разведка ДП-5В: {snapshot.debrief.radReconDone ? 'ДА' : 'НЕТ'}
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-lg border ${
                  snapshot.debrief.loopIsolated
                    ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-900/70 border-white/10 text-slate-400'
                }`}
              >
                Контур перекрыт: {snapshot.debrief.loopIsolated ? 'ДА' : 'НЕТ'}
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-lg border ${
                  snapshot.debrief.casualtyStabilized
                    ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-900/70 border-white/10 text-slate-400'
                }`}
              >
                Медпомощь: {snapshot.debrief.casualtyStabilized ? 'ДА' : 'НЕТ'}
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-lg border ${
                  snapshot.debrief.usedHoseOrVehicle
                    ? 'bg-sky-950/35 border-sky-500/40 text-sky-300'
                    : 'bg-slate-900/70 border-white/10 text-slate-400'
                }`}
              >
                АЦ-40 / Рукав: {snapshot.debrief.usedHoseOrVehicle ? 'ДА' : 'НЕТ'}
              </div>
            </div>

            {snapshot.debrief.safetyErrors.length > 0 ? (
              <div className="p-3 rounded-lg bg-rose-950/35 border border-rose-500/40 text-xs space-y-1">
                <div className="font-bold text-rose-300">
                  Замечания по безопасности ({snapshot.debrief.safetyErrors.length}):
                </div>
                <ul className="list-disc list-inside text-rose-200 space-y-0.5">
                  {snapshot.debrief.safetyErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-emerald-950/25 border border-emerald-500/30 text-xs text-emerald-200">
                Нарушений правил пожарной и радиационной безопасности не зафиксировано.
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Загрузить .glb</span>
              </button>
              <button
                type="button"
                onClick={onRestart}
                className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Пройти сценарий заново</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
