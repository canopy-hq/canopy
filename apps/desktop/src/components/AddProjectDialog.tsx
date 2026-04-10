import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ComboBox,
  Dialog,
  Heading,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  Button as AriaButton,
} from 'react-aria-components';

import { getSettingCollection, getSetting } from '@canopy/db';
import { Button, Spinner, Tabs, TabList, Tab, TabPanel } from '@canopy/ui';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronDown, FolderOpen } from 'lucide-react';
import { tv } from 'tailwind-variants';
import * as v from 'valibot';

import { pickDirectory } from '../lib/fs';
import * as gitApi from '../lib/git';
import { importLocalProject, startProjectClone } from '../lib/project-actions';

// ── Valibot schemas ───────────────────────────────────────────────────────────

const pathSchema = v.pipe(v.string(), v.minLength(1, 'Repository path is required'));
const urlSchema = v.pipe(v.string(), v.minLength(1, 'Repository URL is required'));
const destSchema = v.pipe(v.string(), v.minLength(1, 'Destination directory is required'));

function parseSchema(schema: v.BaseSchema<string, string, v.BaseIssue<unknown>>, value: string) {
  const result = v.safeParse(schema, value);
  return result.success ? undefined : result.issues[0]?.message;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function friendlyLocalError(msg: string): string {
  const lower = msg.toLowerCase();
  if (
    lower.includes('no such file') ||
    lower.includes('not found') ||
    lower.includes("doesn't exist") ||
    lower.includes('does not exist')
  )
    return 'This folder does not exist';
  if (
    lower.includes('not a git') ||
    lower.includes('could not find repository') ||
    lower.includes('no git')
  )
    return 'Not a git repository — select a folder containing a .git directory';
  if (lower.includes('permission denied')) return 'Permission denied — check folder access';
  return 'Could not open this repository';
}

function repoNameFromUrl(url: string): string {
  return (
    url
      .trim()
      .replace(/\.git$/, '')
      .split('/')
      .pop() ?? ''
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-md border border-edge/40 bg-base/60 px-3 py-2 font-mono text-sm text-fg outline-none placeholder:text-placeholder focus:border-edge/70 focus:bg-base';

const labelCls = 'mb-2 block font-mono text-xs font-medium tracking-widest text-fg-faint uppercase';
const errorCls = 'font-mono text-xs text-danger/80';

const stepCircle = tv({
  base: 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color] duration-300',
  variants: {
    status: {
      active: 'border-transparent bg-accent/15 font-mono text-xs text-accent',
      valid: 'border-transparent bg-accent/20 text-accent',
      pending: 'border-edge/30 bg-transparent font-mono text-xs text-fg-faint',
    },
  },
});

const stepLabel = tv({
  base: 'font-mono text-sm transition-colors duration-300',
  variants: { active: { true: 'text-fg', false: 'text-fg-faint' } },
});

// Only the entering panel fades in — the leaving panel vanishes instantly to avoid crossfade flicker.
const stepPanel = tv({
  base: 'absolute inset-0',
  variants: {
    active: {
      true: 'opacity-100 transition-opacity duration-200 pointer-events-auto',
      false: 'opacity-0 transition-none pointer-events-none',
    },
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceResult =
  | { kind: 'local'; path: string; name: string; branches: gitApi.BranchInfo[] }
  | { kind: 'clone'; url: string; dest: string; name: string; branches: gitApi.BranchInfo[] };

// ── Component ─────────────────────────────────────────────────────────────────

export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [sourceResult, setSourceResult] = useState<SourceResult | null>(null);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [projectName, setProjectName] = useState('');
  const [activeTab, setActiveTab] = useState<'local' | 'clone'>('local');

  // Local: branches preloaded during path validation
  const branchResultRef = useRef<{
    path: string;
    name: string;
    branches: gitApi.BranchInfo[];
  } | null>(null);
  const localGenRef = useRef(0);

  // Clone: branches preloaded during URL validation
  const cloneResultRef = useRef<{ name: string; branches: gitApi.BranchInfo[] } | null>(null);
  const cloneGenRef = useRef(0);

  const localPathRef = useRef<HTMLInputElement>(null);
  const cloneUrlRef = useRef<HTMLInputElement>(null);

  const isStep2 = sourceResult !== null;

  // Keep step 2 content alive during the exit slide animation so the panel
  // doesn't animate with empty contents when clicking "Back".
  const step2SourceRef = useRef<SourceResult | null>(null);
  if (sourceResult !== null) step2SourceRef.current = sourceResult;
  const step2Source = step2SourceRef.current;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    localPathRef.current?.focus();
  }, []);

  const pickHead = (branches: gitApi.BranchInfo[]) =>
    branches.find((b) => b.is_head)?.name ?? branches[0]?.name ?? '';

  // ── Local form ────────────────────────────────────────────────────────────

  const localForm = useForm({
    defaultValues: { path: '' },
    onSubmit: () => {
      const result = branchResultRef.current;
      if (!result) return;
      setSourceResult({ kind: 'local', ...result });
      setSelectedBranch(pickHead(result.branches));
      setProjectName(result.name);
    },
  });

  // ── Clone form ────────────────────────────────────────────────────────────

  const cloneForm = useForm({
    defaultValues: {
      url: '',
      dest: getSetting<string>(getSettingCollection().toArray, 'lastCloneDest', ''),
    },
    onSubmit: ({ value }: { value: { url: string; dest: string } }) => {
      const result = cloneResultRef.current;
      if (!result) return;
      const url = value.url.trim();
      const dest = value.dest.trim();
      setSourceResult({ kind: 'clone', url, dest, name: result.name, branches: result.branches });
      setSelectedBranch(pickHead(result.branches));
      setProjectName(result.name);
    },
  });

  // ── Step 2 confirm ────────────────────────────────────────────────────────

  const handleConfirm = useCallback(() => {
    if (!sourceResult) return;
    const branch =
      sourceResult.branches.find((b) => b.name === selectedBranch) ?? sourceResult.branches[0];
    if (!branch) return;
    if (sourceResult.kind === 'local') {
      importLocalProject(sourceResult.path, projectName, branch, navigate);
    } else {
      startProjectClone(sourceResult.url, sourceResult.dest, projectName, branch.name, navigate);
    }
    onClose();
  }, [sourceResult, selectedBranch, projectName, navigate, onClose]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="w-[480px] rounded-lg border border-edge/60 bg-raised shadow-xl">
        <Dialog className="outline-none" aria-label="Add Project">
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <Heading slot="title" className="font-mono leading-none font-medium text-base text-fg">
              Add Project
            </Heading>
          </div>

          <div className="px-5 pb-5">
            {/* Funnel step indicator — always rendered */}
            <div className="mb-5 flex items-center">
              {/* Left edge line */}
              <div className="flex-1 border-t border-dashed border-edge/20" />

              {/* Step 1 */}
              <div className="flex items-center gap-2 px-3">
                <span className={stepCircle({ status: isStep2 ? 'valid' : 'active' })}>
                  {isStep2 ? <Check size={9} strokeWidth={2.5} /> : '1'}
                </span>
                <span className={stepLabel({ active: !isStep2 })}>Source</span>
              </div>

              {/* Progress line */}
              <div className="relative flex-[2]">
                <div className="absolute inset-0 border-t border-dashed border-edge/20" />
                <div
                  className="absolute top-0 left-0 border-t border-accent/40 transition-[width] duration-500 ease-in-out"
                  style={{ width: isStep2 ? '100%' : '0%' }}
                />
              </div>

              {/* Step 2 */}
              <div className="flex items-center gap-2 px-3">
                <span className={stepCircle({ status: isStep2 ? 'active' : 'pending' })}>2</span>
                <span className={stepLabel({ active: isStep2 })}>Configure</span>
              </div>

              {/* Right edge line */}
              <div className="flex-1 border-t border-dashed border-edge/20" />
            </div>

            {/* Fixed-height panel container — both steps always mounted, slides between them */}
            <div className="relative h-[208px] overflow-hidden">
              <div className={stepPanel({ active: !isStep2 })}>
                <Tabs
                  selectedKey={activeTab}
                  onSelectionChange={(key) => {
                    const tab = key as 'local' | 'clone';
                    setActiveTab(tab);
                    setTimeout(
                      () => (tab === 'local' ? localPathRef : cloneUrlRef).current?.focus(),
                      0,
                    );
                  }}
                >
                  <TabList border={false} className="mb-4">
                    <Tab id="local">Local</Tab>
                    <Tab id="clone">Clone from URL</Tab>
                  </TabList>
                  <TabPanel id="local">
                    <localForm.Field
                      name="path"
                      validators={{
                        onChange: ({ value }) => parseSchema(pathSchema, value),
                        onChangeAsync: async ({ value }) => {
                          const trimmed = value.trim();
                          if (!trimmed) return undefined;
                          branchResultRef.current = null;
                          const gen = ++localGenRef.current;
                          try {
                            const info = await gitApi.importRepo(trimmed);
                            const branches = await gitApi.listBranches(info.path);
                            if (localGenRef.current !== gen) return undefined;
                            branchResultRef.current = {
                              path: info.path,
                              name: info.name,
                              branches,
                            };
                            return undefined;
                          } catch (err) {
                            if (localGenRef.current !== gen) return undefined;
                            return friendlyLocalError(String(err));
                          }
                        },
                        onChangeAsyncDebounceMs: 600,
                      }}
                    >
                      {(field) => (
                        <div>
                          <label htmlFor="local-path" className={labelCls}>
                            Repository path
                          </label>
                          <div className="flex items-stretch gap-2">
                            <input
                              ref={localPathRef}
                              id="local-path"
                              type="text"
                              value={field.state.value}
                              onChange={(e) => {
                                branchResultRef.current = null;
                                field.handleChange(e.target.value);
                              }}
                              onBlur={field.handleBlur}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void localForm.handleSubmit();
                              }}
                              placeholder="/path/to/repo"
                              className={`${inputCls} flex-1`}
                              autoComplete="off"
                              spellCheck={false}
                            />
                            <Button
                              variant="secondary"
                              onPress={async () => {
                                const path = await pickDirectory('Select Git Repository');
                                if (path) {
                                  branchResultRef.current = null;
                                  field.handleChange(path);
                                }
                              }}
                              aria-label="Browse"
                              className="h-auto shrink-0 px-2.5"
                            >
                              <FolderOpen size={14} />
                            </Button>
                          </div>
                          <div className="mt-1.5 h-4">
                            <FieldFeedback field={field} validatingLabel="Checking…" />
                          </div>
                        </div>
                      )}
                    </localForm.Field>
                  </TabPanel>
                  <TabPanel id="clone">
                    <div className="space-y-4">
                      <cloneForm.Field
                        name="url"
                        validators={{
                          onChange: ({ value }) => parseSchema(urlSchema, value),
                          onChangeAsync: async ({ value }) => {
                            const trimmed = value.trim();
                            if (!trimmed) return undefined;
                            cloneResultRef.current = null;
                            const gen = ++cloneGenRef.current;
                            try {
                              const branches = await gitApi.listRemoteBranches(trimmed);
                              if (cloneGenRef.current !== gen) return undefined;
                              cloneResultRef.current = { name: repoNameFromUrl(trimmed), branches };
                              return undefined;
                            } catch (err) {
                              if (cloneGenRef.current !== gen) return undefined;
                              return String(err);
                            }
                          },
                          onChangeAsyncDebounceMs: 800,
                        }}
                      >
                        {(field) => (
                          <div>
                            <label htmlFor="clone-url" className={labelCls}>
                              Repository URL
                            </label>
                            <input
                              ref={cloneUrlRef}
                              id="clone-url"
                              type="text"
                              value={field.state.value}
                              onChange={(e) => {
                                cloneResultRef.current = null;
                                field.handleChange(e.target.value);
                              }}
                              onBlur={field.handleBlur}
                              placeholder="https://github.com/owner/repo.git"
                              className={inputCls}
                              autoComplete="off"
                              spellCheck={false}
                            />
                            <div className="mt-1.5 h-4">
                              <FieldFeedback field={field} validatingLabel="Checking repository…" />
                            </div>
                          </div>
                        )}
                      </cloneForm.Field>
                      <cloneForm.Field
                        name="dest"
                        validators={{ onChange: ({ value }) => parseSchema(destSchema, value) }}
                      >
                        {(field) => (
                          <div>
                            <label htmlFor="clone-dest" className={labelCls}>
                              Destination directory
                            </label>
                            <div className="flex items-stretch gap-2">
                              <input
                                id="clone-dest"
                                type="text"
                                value={field.state.value}
                                onChange={(e) => field.handleChange(e.target.value)}
                                onBlur={field.handleBlur}
                                placeholder="~/Developer"
                                className={`${inputCls} flex-1`}
                                autoComplete="off"
                                spellCheck={false}
                              />
                              <Button
                                variant="secondary"
                                onPress={async () => {
                                  const path = await pickDirectory('Choose destination directory');
                                  if (path) field.handleChange(path);
                                }}
                                aria-label="Browse"
                                className="h-auto shrink-0 px-2.5"
                              >
                                <FolderOpen size={14} />
                              </Button>
                            </div>
                            <div className="mt-1.5 h-4">
                              <FieldFeedback field={field} />
                            </div>
                          </div>
                        )}
                      </cloneForm.Field>
                    </div>
                  </TabPanel>
                </Tabs>
              </div>

              <div className={stepPanel({ active: isStep2 })}>
                {step2Source && (
                  <>
                    <div className="mb-4 flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 font-mono text-[10px] tracking-widest text-fg-faint uppercase">
                        {step2Source.kind === 'local' ? 'Repo' : 'URL'}
                      </span>
                      <span className="min-w-0 truncate font-mono text-sm text-fg-dim">
                        {step2Source.kind === 'local' ? step2Source.path : step2Source.url}
                      </span>
                    </div>
                    <ConfigureStep
                      sourceResult={step2Source}
                      selectedBranch={selectedBranch}
                      onBranchChange={setSelectedBranch}
                      projectName={projectName}
                      onNameChange={setProjectName}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-edge/20 px-5 py-4">
            {isStep2 ? (
              <>
                <Button variant="secondary" onPress={() => setSourceResult(null)}>
                  Back
                </Button>
                <Button variant="primary" onPress={handleConfirm} isDisabled={!projectName.trim()}>
                  {sourceResult?.kind === 'clone' ? 'Start Clone' : 'Add Project'}
                </Button>
              </>
            ) : activeTab === 'local' ? (
              <>
                <Button variant="secondary" onPress={onClose}>
                  Cancel
                </Button>
                <localForm.Subscribe selector={(s) => s.canSubmit && !s.isValidating}>
                  {(canSubmit) => (
                    <Button
                      variant="primary"
                      onPress={() => void localForm.handleSubmit()}
                      isDisabled={!canSubmit}
                    >
                      Next
                    </Button>
                  )}
                </localForm.Subscribe>
              </>
            ) : (
              <>
                <Button variant="secondary" onPress={onClose}>
                  Cancel
                </Button>
                <cloneForm.Subscribe selector={(s) => s.canSubmit && !s.isValidating}>
                  {(canSubmit) => (
                    <Button
                      variant="primary"
                      onPress={() => void cloneForm.handleSubmit()}
                      isDisabled={!canSubmit}
                    >
                      Next
                    </Button>
                  )}
                </cloneForm.Subscribe>
              </>
            )}
          </div>
        </Dialog>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldFeedback({
  field,
  validatingLabel,
}: {
  field: {
    state: {
      meta: { isDirty: boolean; isTouched: boolean; isValidating: boolean; errors: unknown[] };
    };
  };
  validatingLabel?: string;
}) {
  const { isDirty, isTouched, isValidating, errors } = field.state.meta;
  const showError = (isDirty || isTouched) && !isValidating && errors.length > 0;
  if (isValidating && validatingLabel) {
    return (
      <p className="flex items-center gap-1.5 font-mono text-xs text-fg-faint">
        <Spinner size={10} />
        {validatingLabel}
      </p>
    );
  }
  if (showError) return <p className={errorCls}>{String(errors[0])}</p>;
  return null;
}

function branchLabel(b: gitApi.BranchInfo) {
  return b.is_head ? `${b.name} (HEAD)` : b.name;
}

function BranchComboBox({
  branches,
  selectedBranch,
  onBranchChange,
}: {
  branches: gitApi.BranchInfo[];
  selectedBranch: string;
  onBranchChange: (name: string) => void;
}) {
  const sorted = useMemo(
    () => [...branches].sort((a, b) => (a.is_head ? -1 : b.is_head ? 1 : 0)),
    [branches],
  );

  const selected = sorted.find((b) => b.name === selectedBranch) ?? null;
  const selectedLabel = selected ? branchLabel(selected) : '';
  const [inputValue, setInputValue] = useState(() => selectedLabel);

  const filtered = useMemo(() => {
    if (!inputValue || inputValue === selectedLabel) return sorted;
    const q = inputValue.toLowerCase().replace(' (head)', '').trim();
    return sorted.filter((b) => b.name.toLowerCase().includes(q));
  }, [sorted, inputValue, selectedLabel]);

  return (
    <ComboBox
      className="w-full"
      selectedKey={selectedBranch}
      inputValue={inputValue}
      items={filtered}
      menuTrigger="focus"
      onSelectionChange={(key) => {
        const branch = branches.find((b) => b.name === key);
        if (branch) {
          onBranchChange(branch.name);
          setInputValue(branchLabel(branch));
        }
      }}
      onInputChange={setInputValue}
    >
      <div className="relative flex items-center">
        <Input className={`${inputCls} pr-8`} autoComplete="off" spellCheck={false} />
        <AriaButton className="absolute right-2.5 flex items-center text-fg-faint outline-none hover:text-fg">
          <ChevronDown size={13} />
        </AriaButton>
      </div>
      <Popover
        offset={4}
        className="w-(--trigger-width) overflow-hidden rounded-md border border-edge/60 bg-raised shadow-xl outline-none"
      >
        <ListBox
          className="max-h-52 overflow-y-auto p-1 outline-none"
          renderEmptyState={() => (
            <div className="px-2 py-1.5 font-mono text-xs text-fg-faint">No branches found</div>
          )}
        >
          {(b: gitApi.BranchInfo) => (
            <ListBoxItem
              id={b.name}
              textValue={b.name}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 font-mono text-sm text-fg-dim outline-none data-[focused]:bg-surface data-[focused]:text-fg data-[selected]:text-accent"
            >
              <span className="flex-1 truncate">{b.name}</span>
              {b.is_head && (
                <span className="shrink-0 font-mono text-xs text-fg-faint">(HEAD)</span>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}

function ConfigureStep({
  sourceResult,
  selectedBranch,
  onBranchChange,
  projectName,
  onNameChange,
}: {
  sourceResult: SourceResult;
  selectedBranch: string;
  onBranchChange: (v: string) => void;
  projectName: string;
  onNameChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Branch</label>
        <BranchComboBox
          branches={sourceResult.branches}
          selectedBranch={selectedBranch}
          onBranchChange={onBranchChange}
        />
      </div>
      <div>
        <label htmlFor="project-name" className={labelCls}>
          Project name
        </label>
        <input
          id="project-name"
          type="text"
          value={projectName}
          onChange={(e) => onNameChange(e.target.value)}
          className={inputCls}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
