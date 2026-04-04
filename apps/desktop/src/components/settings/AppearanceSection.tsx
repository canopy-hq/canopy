import { getSetting, getSettingCollection, setSetting } from '@superagent/db';
import { themes, themeNames, type ThemeName, type CssThemeProperties } from '@superagent/terminal';
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
      {/* Sidebar strip */}
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
      {/* Content area */}
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

  const handleSelect = (name: ThemeName) => {
    setSetting('theme', name);
    document.documentElement.setAttribute('data-theme', name);
  };

  return (
    <section>
      <h2 className="mb-1 text-[13px] font-semibold text-text-primary">Theme</h2>
      <p className="mb-4 text-[12px] text-text-muted">Choose a theme for the application.</p>
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
            <span className="text-[11px] font-medium text-text-primary">{capitalize(name)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
