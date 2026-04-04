import type { Tab, Workspace } from '@superagent/db';

/** Find the workspace that owns a given workspaceItemId (branch/worktree/root). */
export function resolveWorkspace(
  workspaceItemId: string,
  workspaces: Workspace[],
): Workspace | undefined {
  return workspaces.find((w) => workspaceItemId.startsWith(w.id));
}

/** Find the workspace that owns a given tab. */
export function resolveWorkspaceForTab(tab: Tab, workspaces: Workspace[]): Workspace | undefined {
  return resolveWorkspace(tab.workspaceItemId, workspaces);
}
