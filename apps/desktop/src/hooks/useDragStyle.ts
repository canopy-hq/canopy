import { useEffect } from 'react';

/**
 * While `active` is true, injects a global <style> tag that forces the
 * grabbing cursor and disables pointer events on all elements so nothing
 * is interactive during a drag. Removed automatically on deactivation or
 * component unmount.
 */
export function useDragStyle(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const style = document.createElement('style');
    style.textContent = '* { cursor: grabbing !important; pointer-events: none !important; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, [active]);
}
