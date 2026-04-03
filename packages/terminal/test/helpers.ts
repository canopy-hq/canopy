/** Flush all pending promises (drains multi-level .then() chains in useTerminal). */
export async function flushPromises() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

export function makeContainer() {
  const el = document.createElement('div');
  Object.defineProperty(el, 'offsetWidth', { value: 800, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: 600, configurable: true });
  document.body.appendChild(el);
  return el;
}
