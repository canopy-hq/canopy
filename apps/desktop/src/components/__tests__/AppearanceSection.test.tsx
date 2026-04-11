import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

const { mockSetSetting, mockApplyThemeToAll, mockApplyFontSizeToAll } = vi.hoisted(() => ({
  mockSetSetting: vi.fn(),
  mockApplyThemeToAll: vi.fn(),
  mockApplyFontSizeToAll: vi.fn(),
}));

vi.mock('@canopy/db', () => ({
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
  getSetting: (_settings: unknown[], _key: string, fallback: unknown) => fallback,
  getSettingCollection: () => ({ toArray: [] }),
}));

vi.mock('@tanstack/react-db', () => ({ useLiveQuery: () => ({ data: [] }) }));

vi.mock('@canopy/terminal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@canopy/terminal')>();
  return {
    ...actual,
    applyThemeToAll: mockApplyThemeToAll,
    applyFontSizeToAll: mockApplyFontSizeToAll,
  };
});

import { AppearanceSection } from '../settings/AppearanceSection';

describe('AppearanceSection', () => {
  beforeEach(() => {
    mockSetSetting.mockReset();
    mockApplyThemeToAll.mockReset();
    mockApplyFontSizeToAll.mockReset();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(cleanup);

  it('renders all 8 theme cards', () => {
    const { getAllByRole } = render(<AppearanceSection />);
    expect(getAllByRole('radio')).toHaveLength(8);
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

  it('each card has data-theme matching its theme name', () => {
    const { getAllByRole } = render(<AppearanceSection />);
    const cards = getAllByRole('radio');
    const expectedNames = [
      'obsidian',
      'carbon',
      'graphite',
      'slate',
      'midnight',
      'void',
      'smoke',
      'ash',
    ];
    cards.forEach((card, i) => {
      expect(card).toHaveAttribute('data-theme', expectedNames[i]);
    });
  });

  it('default theme has aria-checked=true, others false', () => {
    const { getAllByRole } = render(<AppearanceSection />);
    const cards = getAllByRole('radio');
    // getSetting returns the fallback ('obsidian') since settings is []
    expect(cards[0]).toHaveAttribute('aria-checked', 'true');
    cards.slice(1).forEach((card) => {
      expect(card).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('clicking a theme calls applyThemeToAll', () => {
    const { getByText } = render(<AppearanceSection />);
    fireEvent.click(getByText('Ash'));
    expect(mockApplyThemeToAll).toHaveBeenCalledWith('ash');
  });

  it('Enter key on a card selects the theme', () => {
    const { getByText } = render(<AppearanceSection />);
    fireEvent.keyDown(getByText('Slate').closest('[role="radio"]')!, { key: 'Enter' });
    expect(mockSetSetting).toHaveBeenCalledWith('theme', 'slate');
  });

  it('font size slider calls setSetting with the new value', () => {
    const { getByRole } = render(<AppearanceSection />);
    const slider = getByRole('slider');
    fireEvent.change(slider, { target: { value: '16' } });
    expect(mockSetSetting).toHaveBeenCalledWith('terminalFontSize', 16);
    expect(mockApplyFontSizeToAll).toHaveBeenCalledWith(16);
  });

  it('font size slider clamps values to [10, 24]', () => {
    const { getByRole } = render(<AppearanceSection />);
    const slider = getByRole('slider');
    fireEvent.change(slider, { target: { value: '5' } });
    expect(mockSetSetting).toHaveBeenCalledWith('terminalFontSize', 10);
    fireEvent.change(slider, { target: { value: '30' } });
    expect(mockSetSetting).toHaveBeenCalledWith('terminalFontSize', 24);
  });
});
