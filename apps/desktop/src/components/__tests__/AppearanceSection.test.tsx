import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

const mockSetSetting = vi.fn();

vi.mock('@superagent/db', () => ({
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
  getSetting: (_settings: unknown[], _key: string, fallback: unknown) => fallback,
  getSettingCollection: () => ({ toArray: [] }),
}));

vi.mock('@tanstack/react-db', () => ({ useLiveQuery: () => ({ data: [] }) }));

import { AppearanceSection } from '../settings/AppearanceSection';

describe('AppearanceSection', () => {
  beforeEach(() => {
    mockSetSetting.mockReset();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(cleanup);

  it('renders all 8 theme cards', () => {
    const { getAllByRole } = render(<AppearanceSection />);
    const buttons = getAllByRole('radio');
    expect(buttons).toHaveLength(8);
  });

  it('renders theme names as labels', () => {
    const { getByText } = render(<AppearanceSection />);
    expect(getByText('Obsidian')).toBeInTheDocument();
    expect(getByText('Carbon')).toBeInTheDocument();
    expect(getByText('Void')).toBeInTheDocument();
  });

  it('clicking a theme card calls setSetting and updates data-theme', () => {
    const { getByText } = render(<AppearanceSection />);
    fireEvent.click(getByText('Carbon'));
    expect(mockSetSetting).toHaveBeenCalledWith('theme', 'carbon');
    expect(document.documentElement.getAttribute('data-theme')).toBe('carbon');
  });
});
