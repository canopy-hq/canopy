import { getSetting, getSettingCollection, setSetting } from '@superagent/db';
import {
  themes,
  themeNames,
  applyFontSizeToAll,
  DEFAULT_TERMINAL_FONT_SIZE,
  type ThemeName,
  type CssThemeProperties,
} from '@superagent/terminal';
import { useLiveQuery } from '@tanstack/react-db';
import { tv } from 'tailwind-variants';

const themeCard = tv({
  base: 'flex cursor-pointer flex-col gap-2 rounded-lg border p-2 transition-colors',
  variants: {
    selected: { true: 'border-accent', false: 'border-border hover:border-text-muted/30' },
  },
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ThemePreview({ css }: { css: CssThemeProperties }) {
  return (
    <div className="flex h-16 overflow-hidden rounded" style={{ backgroundColor: css.bgPrimary }}>
      <div
        className="w-1/4 border-r"
        style={{ backgroundColor: css.bgSecondary, borderColor: css.border }}
      >
        <div className="mx-1.5 mt-3 space-y-1">
          <div
            className="h-1 rounded-full"
            style={{ backgroundColor: css.textMuted, opacity: 0.5 }}
          />
          <div
            className="h-1 w-3/4 rounded-full"
            style={{ backgroundColor: css.textMuted, opacity: 0.3 }}
          />
        </div>
      </div>
      <div className="flex-1 p-2" style={{ backgroundColor: css.bgTertiary }}>
        <div className="space-y-1.5">
          <div
            className="h-1 w-2/3 rounded-full"
            style={{ backgroundColor: css.textPrimary, opacity: 0.6 }}
          />
          <div
            className="h-1 w-1/2 rounded-full"
            style={{ backgroundColor: css.textMuted, opacity: 0.4 }}
          />
          <div className="mt-2 h-1.5 w-1/4 rounded-full" style={{ backgroundColor: css.accent }} />
        </div>
      </div>
    </div>
  );
}

export function AppearanceSection() {
  const { data: settings = [] } = useLiveQuery(() => getSettingCollection());
  const currentTheme = getSetting<ThemeName>(settings, 'theme', 'obsidian');
  const currentFontSize = getSetting<number>(
    settings,
    'terminalFontSize',
    DEFAULT_TERMINAL_FONT_SIZE,
  );

  const handleSelect = (name: ThemeName) => {
    setSetting('theme', name);
    document.documentElement.setAttribute('data-theme', name);
  };

  const handleFontSizeChange = (size: number) => {
    const clamped = Math.max(10, Math.min(24, size));
    setSetting('terminalFontSize', clamped);
    applyFontSizeToAll(clamped);
  };

  return (
    <section className="space-y-8">
      <h2 className="mb-1 text-base font-semibold text-text-primary">Theme</h2>
      <p className="mb-4 text-md text-text-muted">Choose a theme for the application.</p>
      <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme selection">
        {themeNames.map((name) => (
          <div
            key={name}
            role="radio"
            aria-checked={currentTheme === name}
            aria-label={capitalize(name)}
            className={themeCard({ selected: currentTheme === name })}
            onClick={() => handleSelect(name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleSelect(name);
              }
            }}
            tabIndex={0}
          >
            <ThemePreview css={themes[name].css} />
            <span className="text-sm font-medium text-text-primary">{capitalize(name)}</span>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-1 text-base font-semibold text-text-primary">Terminal Font Size</h2>
        <p className="mb-3 text-md text-text-muted">Adjust the font size used in terminal panes.</p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={24}
            step={1}
            value={currentFontSize}
            onChange={(e) => handleFontSizeChange(Number(e.target.value))}
            className="h-1 w-40 cursor-pointer appearance-none rounded-full bg-border accent-accent"
            aria-label="Terminal font size"
          />
          <span className="min-w-[3ch] text-center text-base text-text-primary tabular-nums">
            {currentFontSize}
          </span>
        </div>
      </div>
    </section>
  );
}
