import { useRef } from 'react';
import { Menu, MenuItem, Popover, SubmenuTrigger } from 'react-aria-components';

import { ChevronRight } from 'lucide-react';

export type ContextMenuAction = {
  type?: 'action';
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  checked?: boolean;
};

export type ContextMenuSubmenuItem = {
  type: 'submenu';
  label: string;
  icon?: React.ReactNode;
  items: ContextMenuItemDef[];
};

export type ContextMenuItemDef = ContextMenuAction | ContextMenuSubmenuItem;

const itemCls =
  'flex cursor-default items-center gap-2 px-3 py-1.5 text-base text-text-secondary outline-none data-[focused]:bg-bg-tertiary data-[disabled]:opacity-40';

const panelCls =
  'min-w-[180px] rounded-lg border border-border/60 bg-bg-secondary py-1 shadow-lg outline-none';

export function ContextMenu({
  x,
  y,
  onClose,
  items,
}: {
  x: number;
  y: number;
  onClose: () => void;
  items: ContextMenuItemDef[];
}) {
  const triggerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {/* Virtual trigger at click coordinates — Popover portals itself */}
      <div
        ref={triggerRef}
        aria-hidden
        style={{ position: 'fixed', left: x, top: y, width: 0, height: 0, pointerEvents: 'none' }}
      />
      <Popover
        triggerRef={triggerRef}
        isOpen
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        placement="bottom start"
        className={panelCls}
      >
        <Menu
          className="outline-none"
          onAction={(key) => {
            const item = items.find(
              (it): it is ContextMenuAction => it.type !== 'submenu' && it.label === String(key),
            );
            if (item) item.onSelect();
          }}
        >
          {items.map((item) => {
            if (item.type === 'submenu') {
              return (
                <SubmenuTrigger key={item.label}>
                  <MenuItem className={itemCls}>
                    {item.icon != null && <span className="shrink-0">{item.icon}</span>}
                    <span className="flex-1">{item.label}</span>
                    <ChevronRight size={12} className="text-text-faint" />
                  </MenuItem>
                  <Popover className={panelCls} offset={-4}>
                    <Menu
                      aria-label={item.label}
                      className="outline-none"
                      onAction={(key) => {
                        const sub = item.items.find(
                          (it): it is ContextMenuAction =>
                            it.type !== 'submenu' && it.label === String(key),
                        );
                        if (sub) {
                          sub.onSelect();
                          onClose();
                        }
                      }}
                    >
                      {item.items.map((sub) => {
                        if (sub.type === 'submenu') return null;
                        return (
                          <MenuItem
                            key={sub.label}
                            id={sub.label}
                            className={`${itemCls} ${sub.destructive ? 'text-destructive data-[focused]:text-destructive' : ''}`}
                          >
                            {sub.icon != null && <span className="shrink-0">{sub.icon}</span>}
                            <span className="flex-1">{sub.label}</span>
                            {sub.checked && (
                              <span className="ml-auto text-[10px] text-text-faint">✓</span>
                            )}
                          </MenuItem>
                        );
                      })}
                    </Menu>
                  </Popover>
                </SubmenuTrigger>
              );
            }

            return (
              <MenuItem
                key={item.label}
                id={item.label}
                className={`${itemCls} ${item.destructive ? 'text-destructive data-[focused]:text-destructive' : ''}`}
              >
                {item.icon != null && <span className="shrink-0">{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
                {item.checked && <span className="ml-auto text-[10px] text-text-faint">✓</span>}
              </MenuItem>
            );
          })}
        </Menu>
      </Popover>
    </>
  );
}
