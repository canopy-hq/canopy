import {
  getGroupCollection,
  getProjectCollection,
  getTabCollection,
  getSettingCollection,
  agentCollection,
  uiCollection,
  getUiState,
} from '@superagent/db';
/**
 * Reactive hooks for all TanStack DB collections.
 * Uses useLiveQuery from @tanstack/react-db for React integration.
 */
import { useLiveQuery } from '@tanstack/react-db';

export function useGroups() {
  const { data = [] } = useLiveQuery(() => getGroupCollection());
  return data;
}

export function useProjects() {
  const { data = [] } = useLiveQuery(() => getProjectCollection());
  return data;
}

export function useTabs() {
  const { data = [] } = useLiveQuery(() => getTabCollection());
  return data;
}

export function useSettings() {
  const { data = [] } = useLiveQuery(() => getSettingCollection());
  return data;
}

export function useAgents() {
  const { data = [] } = useLiveQuery(() => agentCollection);
  return data;
}

export function useUiState() {
  const { data } = useLiveQuery(() => uiCollection);
  return data?.[0] ?? getUiState();
}
