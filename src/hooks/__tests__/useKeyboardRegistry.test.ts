import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useKeyboardRegistry, type Keybinding } from '../useKeyboardRegistry';

describe('useKeyboardRegistry', () => {
  it('calls action when matching Cmd+D keydown fires', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'd', meta: true, action },
    ];
    renderHook(() => useKeyboardRegistry(bindings));

    fireEvent.keyDown(document, { key: 'd', metaKey: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it('calls preventDefault and stopPropagation on matched shortcut', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'd', meta: true, action },
    ];
    renderHook(() => useKeyboardRegistry(bindings));

    const event = new KeyboardEvent('keydown', {
      key: 'd',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    document.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
  });

  it('does NOT call preventDefault on unmatched key', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'd', meta: true, action },
    ];
    renderHook(() => useKeyboardRegistry(bindings));

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: false,
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);

    expect(preventSpy).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it('listener is on capture phase', () => {
    const action = vi.fn();
    const addSpy = vi.spyOn(document, 'addEventListener');
    const bindings: Keybinding[] = [
      { key: 'd', meta: true, action },
    ];
    renderHook(() => useKeyboardRegistry(bindings));

    const captureCall = addSpy.mock.calls.find(
      (call) => call[0] === 'keydown' && (call[2] as AddEventListenerOptions)?.capture === true,
    );
    expect(captureCall).toBeDefined();
    addSpy.mockRestore();
  });

  it('matches shift:true binding only when shiftKey is true', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'd', meta: true, shift: true, action },
    ];
    renderHook(() => useKeyboardRegistry(bindings));

    // Without shift - should not match
    fireEvent.keyDown(document, { key: 'd', metaKey: true, shiftKey: false });
    expect(action).not.toHaveBeenCalled();

    // With shift - should match
    fireEvent.keyDown(document, { key: 'd', metaKey: true, shiftKey: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it('matches alt:true binding only when altKey is true', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'd', meta: true, alt: true, action },
    ];
    renderHook(() => useKeyboardRegistry(bindings));

    // Without alt - should not match
    fireEvent.keyDown(document, { key: 'd', metaKey: true, altKey: false });
    expect(action).not.toHaveBeenCalled();

    // With alt - should match
    fireEvent.keyDown(document, { key: 'd', metaKey: true, altKey: true });
    expect(action).toHaveBeenCalledOnce();
  });
});
