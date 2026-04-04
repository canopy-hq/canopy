import { useAnimationFPS } from './useAnimationFPS';

const GRAPH_W = 200;
const GRAPH_H = 48;
const MAX_FPS = 65;
const WARN_FPS = 30;
const GOOD_FPS = 55;
const THRESHOLDS = [WARN_FPS, GOOD_FPS];

export function fpsColor(fps: number): string {
  if (fps >= GOOD_FPS) return 'rgb(22 163 74)'; // green-600
  if (fps >= WARN_FPS) return 'rgb(234 179 8)'; // yellow-500
  return 'rgb(220 38 38)'; // red-600
}

function Sparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;

  const points = history
    .map((fps, i) => {
      const x = (i / (history.length - 1)) * GRAPH_W;
      const y = GRAPH_H - (Math.min(fps, MAX_FPS) / MAX_FPS) * GRAPH_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={GRAPH_W} height={GRAPH_H} className="block">
      {THRESHOLDS.map((t) => {
        const y = GRAPH_H - (t / MAX_FPS) * GRAPH_H;
        return (
          <line
            key={t}
            x1={0}
            y1={y}
            x2={GRAPH_W}
            y2={y}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        );
      })}
      <polyline
        points={points}
        fill="none"
        stroke={fpsColor(history[history.length - 1])}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FpsOverlayInner() {
  const { fps, history } = useAnimationFPS();

  return (
    <div
      className="fixed right-2 top-2 z-50 pointer-events-none rounded overflow-hidden"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      aria-label={`${fps} frames per second`}
    >
      <div className="px-2 py-1 font-mono text-xs" style={{ color: fpsColor(fps) }}>
        {fps} FPS
      </div>
      <Sparkline history={history} />
    </div>
  );
}

export interface FpsOverlayProps {
  visible: boolean;
}

export function FpsOverlay({ visible }: FpsOverlayProps) {
  if (!import.meta.env.DEV) return null;
  if (!visible) return null;
  return <FpsOverlayInner />;
}
