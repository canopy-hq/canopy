export type CommandCategory = 'project' | 'tab' | 'pty' | 'agent' | 'action' | 'global';

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

export interface CommandContext {
  close: () => void;
}

export interface PanelContext {
  /** Close the entire command menu. */
  close: () => void;
  /** Go back to the command list (keep the menu open). */
  back: () => void;
}

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
  /**
   * Renders a custom panel inline inside the command menu.
   * When present, selecting this item opens the panel instead of calling `action`.
   */
  renderPanel?: (ctx: PanelContext) => React.ReactNode;
  action?: (ctx: CommandContext) => void | Promise<void>;
}

export type Nav = (opts: {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
}) => void;

export interface CommandMenuProps {
  isOpen: boolean;
  onClose: () => void;
  items: CommandItem[];
  activeContextId?: string | null;
  /**
   * When set, the command menu opens directly into this panel.
   * Used by the sidebar "+" button to bypass the command list.
   */
  defaultPanelItem?: CommandItem | null;
}
