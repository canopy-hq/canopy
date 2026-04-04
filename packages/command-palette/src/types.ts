export type CommandCategory = 'workspace' | 'tab' | 'pty' | 'agent' | 'action';

export type CommandIcon =
  | 'branch'
  | 'worktree'
  | 'tab'
  | 'agent'
  | 'settings'
  | 'split'
  | 'sidebar'
  | 'folder'
  | 'plus'
  | 'x';

export interface CommandItem {
  id: string;
  label: string;
  category: CommandCategory;
  keywords?: string[];
  icon?: CommandIcon;
  shortcut?: string;
  agentStatus?: 'running' | 'waiting' | 'idle';
  /** Group label for sectioned views (e.g. workspace name in the tabs section). */
  group?: string;
  /** Stable context ID used to filter root-section tabs to the active project. */
  contextId?: string;
  /** Lazy child items — presence enables drill-down for this item. */
  children?: () => CommandItem[];
  action: (ctx: CommandContext) => void | Promise<void>;
}

export interface CommandContext {
  close: () => void;
}

export interface CommandMenuProps {
  isOpen: boolean;
  onClose: () => void;
  items: CommandItem[];
  activeContextId?: string | null;
}
