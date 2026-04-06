# @superagent/fps

Dev-only FPS meter overlay. **Rendered only when `import.meta.env.DEV` is true** — zero cost in production builds.

## Usage

```tsx
import { FpsOverlay } from '@superagent/fps';

// Drop anywhere in the React tree — renders a fixed overlay at top-right
<FpsOverlay />;
```

The overlay shows current FPS as a color-coded number + a 60-second sparkline graph.

## Color thresholds

```ts
import { fpsColor } from '@superagent/fps';

fpsColor(fps); // 'green' ≥55 | 'yellow' ≥30 | 'red' <30
```

Dashed reference lines at 30 FPS (warn) and 55 FPS (good) are drawn on the sparkline.

## Hook (if you need raw data)

```ts
const { fps, history } = useAnimationFPS();
// fps: current frame rate (last 60 frames)
// history: number[] — last 240 samples (~60 seconds at 250ms intervals)
```

Sampling pauses automatically when the page is hidden (`document.visibilityState`).
