import { useState, useEffect, useRef } from 'react';

const SAMPLE_WINDOW = 60;
const UPDATE_INTERVAL_MS = 250;

// 60s of history at ~4 samples/sec
export const HISTORY_SIZE = 240;

export interface AnimationFPS {
  fps: number;
  history: number[];
}

export function useAnimationFPS(): AnimationFPS {
  const [state, setState] = useState<AnimationFPS>({ fps: 0, history: [] });
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const rafId = useRef(0);
  const timestamps = useRef<number[]>([]);
  const lastUpdate = useRef(0);
  const history = useRef<number[]>([]);

  useEffect(() => {
    const handler = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => {
    if (!pageVisible) return;

    function tick(now: number) {
      const ts = timestamps.current;
      ts.push(now);
      if (ts.length > SAMPLE_WINDOW) ts.shift();

      if (ts.length >= 2 && now - lastUpdate.current >= UPDATE_INTERVAL_MS) {
        const elapsed = ts[ts.length - 1]! - ts[0]!;
        const computed = Math.round(((ts.length - 1) / elapsed) * 1000);

        const hist = history.current;
        hist.push(computed);
        if (hist.length > HISTORY_SIZE) hist.shift();

        setState({ fps: computed, history: [...hist] });
        lastUpdate.current = now;
      }

      rafId.current = requestAnimationFrame(tick);
    }

    rafId.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId.current);
      timestamps.current = [];
    };
  }, [pageVisible]);

  return state;
}
