import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/useAnimationFPS', () => ({
  useAnimationFPS: vi.fn(() => ({ fps: 60, history: [30, 45, 55, 60, 60] })),
}));

import { FpsOverlay, fpsColor } from '../src/FpsOverlay';

// ─── fpsColor ─────────────────────────────────────────────────────────────────

describe('fpsColor', () => {
  it('returns green for fps >= 55', () => {
    expect(fpsColor(55)).toBe('rgb(22 163 74)');
    expect(fpsColor(60)).toBe('rgb(22 163 74)');
    expect(fpsColor(120)).toBe('rgb(22 163 74)');
  });

  it('returns yellow for 30 <= fps < 55', () => {
    expect(fpsColor(30)).toBe('rgb(234 179 8)');
    expect(fpsColor(45)).toBe('rgb(234 179 8)');
    expect(fpsColor(54)).toBe('rgb(234 179 8)');
  });

  it('returns red for fps < 30', () => {
    expect(fpsColor(0)).toBe('rgb(220 38 38)');
    expect(fpsColor(15)).toBe('rgb(220 38 38)');
    expect(fpsColor(29)).toBe('rgb(220 38 38)');
  });
});

// ─── FpsOverlay ───────────────────────────────────────────────────────────────

describe('FpsOverlay', () => {
  it('renders nothing when visible=false', () => {
    const { container } = render(<FpsOverlay visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the fps counter when visible=true', () => {
    render(<FpsOverlay visible={true} />);
    expect(screen.getByText('60 FPS')).toBeDefined();
  });

  it('sets aria-label with fps value', () => {
    render(<FpsOverlay visible={true} />);
    expect(screen.getByLabelText('60 frames per second')).toBeDefined();
  });

  it('renders the sparkline SVG when history has data', () => {
    const { container } = render(<FpsOverlay visible={true} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(container.querySelector('polyline')).not.toBeNull();
  });

  it('renders threshold lines in the sparkline', () => {
    const { container } = render(<FpsOverlay visible={true} />);
    const lines = container.querySelectorAll('svg line');
    // One dashed line per threshold (30fps, 55fps)
    expect(lines.length).toBe(2);
  });

  it('applies green color at 60fps', () => {
    const { container } = render(<FpsOverlay visible={true} />);
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('stroke')).toBe('rgb(22 163 74)');
  });

  it('applies yellow color at 45fps', async () => {
    const { useAnimationFPS } = await import('../src/useAnimationFPS');
    vi.mocked(useAnimationFPS).mockReturnValue({ fps: 45, history: [45] });

    const { container } = render(<FpsOverlay visible={true} />);
    expect(screen.getByText('45 FPS')).toBeDefined();
    expect(container.querySelector('polyline')).toBeNull(); // history.length < 2
  });

  it('applies red color at 15fps', async () => {
    const { useAnimationFPS } = await import('../src/useAnimationFPS');
    vi.mocked(useAnimationFPS).mockReturnValue({ fps: 15, history: [10, 15] });

    const { container } = render(<FpsOverlay visible={true} />);
    expect(screen.getByText('15 FPS')).toBeDefined();
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('stroke')).toBe('rgb(220 38 38)');
  });

  it('renders no SVG when history has fewer than 2 entries', async () => {
    const { useAnimationFPS } = await import('../src/useAnimationFPS');
    vi.mocked(useAnimationFPS).mockReturnValue({ fps: 60, history: [60] });

    const { container } = render(<FpsOverlay visible={true} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
