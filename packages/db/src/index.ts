export { initDb, getDb } from './client';
export { runMigrations } from './migrate';
export { hydrateCollections } from './hydrate';
export * from './schema';
export * from './types';

export { getWorkspaceCollection } from './collections/workspaces';
export {
  getTabCollection,
  insertTabAndActivate,
  deleteTabAndUpdateActive,
} from './collections/tabs';
export { getSessionCollection } from './collections/sessions';
export { getSettingCollection, getSetting, setSetting } from './collections/settings';
export { agentCollection } from './collections/agents';
export type { AgentInfo } from './collections/agents';
export { uiCollection, getUiState, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX } from './collections/ui';
export type { UiState } from './collections/ui';
