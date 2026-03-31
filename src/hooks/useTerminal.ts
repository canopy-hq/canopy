import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { spawnTerminal, writeToPty, resizePty } from '../lib/pty';
import { useTerminalStore } from '../stores/terminal';

export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const setPtyId = useTerminalStore((s) => s.setPtyId);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0a14',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(container);

    // WebGL must load AFTER open()
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
    });
    term.loadAddon(webglAddon);

    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    let ptyId: number | null = null;

    // Spawn PTY and wire data
    spawnTerminal((data) => {
      term.write(data);
    }).then((id) => {
      ptyId = id;
      setPtyId(id);

      // Send user input to PTY
      term.onData((data: string) => {
        writeToPty(id, data);
      });

      // Send binary input to PTY (for special keys)
      term.onBinary((data: string) => {
        const bytes = Array.from(data, (c) => c.charCodeAt(0));
        writeToPty(id, String.fromCharCode(...bytes));
      });

      // Sync initial size
      resizePty(id, term.rows, term.cols);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ptyId !== null) {
        resizePty(ptyId, term.rows, term.cols);
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      setPtyId(null);
    };
  }, [containerRef, setPtyId]);

  return termRef;
}
