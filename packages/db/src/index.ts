export { initDb, getDb } from './client';
export { runMigrations } from './migrate';
export { hydrateCollections } from './hydrate';
export * from './schema';
export * from './types';

export { getGroupCollection } from './collections/groups';
export { getProjectCollection } from './collections/projects';
export { getTabCollection, insertTab, deleteTab } from './collections/tabs';
export { getSessionCollection } from './collections/sessions';
export { getSettingCollection, getSetting, setSetting } from './collections/settings';
export { agentCollection } from './collections/agents';
export type { AgentInfo, AgentStatus } from './collections/agents';
export {
  uiCollection,
  getUiState,
  syncNavStateToLocalStorage,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
} from './collections/ui';
export type { UiState, CloneProgress, NavEntry } from './collections/ui';
