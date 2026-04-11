import { useState, useCallback, useEffect, useRef } from 'react';
import { Dialog, Heading } from 'react-aria-components';

import { Button, Kbd } from '@canopy/ui';
import { tv } from 'tailwind-variants';

import { getClaudeDefaultMode } from '../lib/tab-actions';
import { ClaudeCodeIcon } from './ClaudeCodeIcon';

type Mode = 'bypass' | 'plan';

const modeCard = tv({
  base: 'flex flex-1 cursor-pointer flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors appearance-none outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
  variants: {
    selected: {
      true: 'border-accent/60 bg-accent/[0.06] text-fg',
      false: 'border-edge/40 bg-base/40 text-fg-muted hover:border-edge/60 hover:bg-base/70',
    },
  },
});

interface ModeCardProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}

function ModeCard({ selected, onSelect, title, description }: ModeCardProps) {
  return (
    <button type="button" onClick={onSelect} className={modeCard({ selected })}>
      <span className="font-mono text-sm leading-none font-medium">{title}</span>
      <span className="font-mono text-sm leading-relaxed text-fg-faint">{description}</span>
    </button>
  );
}

export function ClaudeCodeSetupDialog({
  worktreeName,
  onLaunch,
  onSkip,
}: {
  worktreeName: string;
  onLaunch: (mode: Mode, prompt?: string) => void;
  onSkip: () => void;
}) {
  const [mode, setMode] = useState<Mode>(getClaudeDefaultMode);
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleLaunch = useCallback(() => {
    onLaunch(mode, prompt.trim() || undefined);
  }, [mode, prompt, onLaunch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
      if (e.key === 'Enter' && e.metaKey) handleLaunch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip, handleLaunch]);

  // Focus textarea on mount for quick prompt entry
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSkip();
      }}
      role="presentation"
    >
      <div className="w-[460px] rounded-lg border border-edge/60 bg-raised p-5 shadow-xl">
        <Dialog className="outline-none" aria-label="Launch Claude Code">
          <div className="mb-4 flex items-center gap-2.5">
            <ClaudeCodeIcon size={16} className="shrink-0 text-claude" />
            <div>
              <Heading
                slot="title"
                className="font-mono leading-none font-medium text-base text-fg"
              >
                Launch Claude Code
              </Heading>
              <p className="mt-1 font-mono text-sm text-fg-faint">{worktreeName} is ready</p>
            </div>
          </div>

          <fieldset className="mb-4 border-none p-0">
            <legend className="mb-2 font-mono text-xs font-medium tracking-widest text-fg-faint uppercase">
              Mode
            </legend>
            <div className="flex gap-2">
              <ModeCard
                selected={mode === 'bypass'}
                onSelect={() => setMode('bypass')}
                title="Bypass permissions"
                description="Skip permission prompts"
              />
              <ModeCard
                selected={mode === 'plan'}
                onSelect={() => setMode('plan')}
                title="Plan mode"
                description="Review before executing"
              />
            </div>
          </fieldset>

          <div className="mb-5">
            <label
              htmlFor="claude-setup-prompt"
              className="mb-2 block font-mono text-xs font-medium tracking-widest text-fg-faint uppercase"
            >
              Initial prompt{' '}
              <span className="tracking-normal text-fg-faint/60 normal-case">(optional)</span>
            </label>
            <textarea
              id="claude-setup-prompt"
              ref={textareaRef}
              value={prompt}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you want Claude to work on…"
              rows={3}
              className="w-full resize-none rounded-md border border-edge/40 bg-base/60 px-3 py-2 font-mono text-sm text-fg outline-none placeholder:text-placeholder focus:border-edge/70 focus:bg-base"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onPress={onSkip}>
              Skip
            </Button>
            <Button variant="primary" onPress={handleLaunch}>
              <ClaudeCodeIcon size={13} className="text-white/80" />
              Schedule launch
              <Kbd className="opacity-60">⌘↵</Kbd>
            </Button>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
