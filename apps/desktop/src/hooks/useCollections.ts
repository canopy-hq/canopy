/**
 * Reactive hooks for all TanStack DB collections.
 * Uses useLiveQuery from @tanstack/react-db for React integration.
 */
import { useLiveQuery } from '@tanstack/react-db';
import {
  getWorkspaceCollection,
  getTabCollection,
  getSettingCollection,
  agentCollection,
  uiCollection,
  getUiState,
} from '@superagent/db';

export function useWorkspaces() {
  const { data = [] } = useLiveQuery(() => getWorkspaceCollection());
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
