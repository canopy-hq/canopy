import { useCallback, useEffect, useRef, useState } from 'react';
import { useTabsStore } from '../stores/tabs-store';
import type { Tab } from '../stores/tabs-store';

function TabItem({
  tab,
  isActive,
  onSwitch,
  onClose,
}: {
  tab: Tab;
  isActive: boolean;
  onSwitch: () => void;
  onClose: () => void;
}) {
  return (
    <button
      className={`group relative flex items-center gap-1.5 min-w-[120px] max-w-[240px] flex-shrink px-3 h-full rounded-t-md border-t-2 transition-colors cursor-pointer ${
        isActive
          ? 'bg-tab-active-bg border-t-accent text-text-primary'
          : 'bg-tab-inactive-bg border-t-transparent text-text-muted hover:bg-bg-secondary'
      }`}
      onClick={onSwitch}
      title={tab.label}
    >
      <span className="truncate text-xs flex-1 text-left">{tab.label}</span>
      <span
        role="button"
        tabIndex={-1}
        className={`flex items-center justify-center w-4 h-4 rounded-sm text-[10px] leading-none hover:bg-bg-tertiary ${
          isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        x
      </span>
    </button>
  );
}

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const addTab = useTabsStore((s) => s.addTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const switchTab = useTabsStore((s) => s.switchTab);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth;
    setScrollState({
      left: hasOverflow && el.scrollLeft > 0,
      right: hasOverflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    updateScrollState();
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState]);

  // Update scroll state when tabs change
  useEffect(() => {
    updateScrollState();
  }, [tabs.length, updateScrollState]);

  // Build CSS mask for scroll fade
  let maskImage = 'none';
  if (scrollState.left && scrollState.right) {
    maskImage = 'linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)';
  } else if (scrollState.left) {
    maskImage = 'linear-gradient(to right, transparent, black 24px)';
  } else if (scrollState.right) {
    maskImage = 'linear-gradient(to right, black calc(100% - 24px), transparent)';
  }

  return (
    <div className="flex items-center bg-bg-primary border-b border-border h-9 flex-shrink-0">
      <div
        ref={scrollRef}
        className="flex items-stretch h-full flex-1 min-w-0 overflow-x-auto"
        style={{
          scrollbarWidth: 'none',
          maskImage,
          WebkitMaskImage: maskImage,
        }}
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSwitch={() => switchTab(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        ))}
      </div>
      <button
        onClick={addTab}
        title="New Tab"
        className="flex items-center justify-center w-8 h-8 mx-1 text-text-muted hover:text-text-primary text-lg leading-none flex-shrink-0 cursor-pointer"
      >
        +
      </button>
    </div>
  );
}
