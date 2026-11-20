import { LabQuestManager } from './questManager';
import { AlaraTimeTask, createLabTasks } from './labTasks';
import type { QuestConfig, QuestHooks } from './questTypes';

export * from './questTypes';
export { LabQuestManager, TaskValidator, mean, relStd } from './questManager';
export * from './labTasks';

/** Фабрика: менеджер с пятью заданиями; хук звукового лимита ALARA подключается автоматически. */
export function createLabQuest(cfg: Partial<QuestConfig> = {}, hooks: QuestHooks = {}): LabQuestManager {
  const tasks = createLabTasks();
  const manager = new LabQuestManager(tasks, cfg, hooks);
  (tasks[3] as AlaraTimeTask).onLimitReached = () => hooks.onAlaraLimitReached?.();
  return manager;
}
