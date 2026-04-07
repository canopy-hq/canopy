import { useState, useCallback, useEffect, useRef } from 'react';
import { Dialog, Heading, Tab, TabList, TabPanel, Tabs } from 'react-aria-components';

import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { FolderOpen } from 'lucide-react';
import * as v from 'valibot';

import * as gitApi from '../lib/git';
import { importLocalProject, startProjectClone } from '../lib/project-actions';
import { Button, Spinner } from './ui';

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
  ) {
    return 'This folder does not exist';
  }
  if (
    lower.includes('not a git') ||
    lower.includes('could not find repository') ||
    lower.includes('no git')
  ) {
    return 'Not a git repository — select a folder containing a .git directory';
  }
  if (lower.includes('permission denied')) {
    return 'Permission denied — check folder access';
  }
  return 'Could not open this repository';
}

async function pickDirectory(title: string): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false, title });
    return typeof selected === 'string' ? selected : null;
  } catch {
    return null;
  }
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-md border border-border/40 bg-bg-primary/60 px-3 py-2 font-mono text-sm text-text-primary outline-none placeholder:text-text-faint/50 focus:border-border/70 focus:bg-bg-primary';

const labelCls =
  'mb-2 block font-mono text-xs font-medium tracking-widest text-text-faint uppercase';
const errorCls = 'mt-1.5 font-mono text-xs text-destructive/80';

const tabCls = ({ isSelected }: { isSelected: boolean }) =>
  `cursor-pointer rounded-md px-3 py-1.5 font-mono text-xs font-medium outline-none transition-colors ${
    isSelected ? 'bg-bg-tertiary text-text-primary' : 'text-text-muted hover:text-text-secondary'
  }`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface BranchStep {
  path: string;
  name: string;
  branches: gitApi.BranchInfo[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [branchStep, setBranchStep] = useState<BranchStep | null>(null);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [projectName, setProjectName] = useState('');

  // Stores the validated git repo info, set inside onChangeAsync validator
  const branchResultRef = useRef<BranchStep | null>(null);
  const localPathRef = useRef<HTMLInputElement>(null);
  const cloneUrlRef = useRef<HTMLInputElement>(null);

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

  // ── Local form ────────────────────────────────────────────────────────────

  const localForm = useForm({
    defaultValues: { path: '' },
    onSubmit: () => {
      const result = branchResultRef.current;
      if (!result) return;
      const head = result.branches.find((b) => b.is_head)?.name ?? result.branches[0]?.name ?? '';
      setBranchStep(result);
      setSelectedBranch(head);
      setProjectName(result.name);
    },
  });

  // ── Clone form ────────────────────────────────────────────────────────────

  const cloneForm = useForm({
    defaultValues: { url: '', dest: '' },
    onSubmit: ({ value }) => {
      startProjectClone(value.url.trim(), value.dest.trim(), navigate);
      onClose();
    },
  });

  // ── Branch step confirm ───────────────────────────────────────────────────

  const handleConfirmLocal = useCallback(() => {
    if (!branchStep) return;
    const branch =
      branchStep.branches.find((b) => b.name === selectedBranch) ?? branchStep.branches[0];
    if (!branch) return;
    importLocalProject(branchStep.path, projectName, branch, navigate);
    onClose();
  }, [branchStep, selectedBranch, projectName, navigate, onClose]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="w-[480px] rounded-lg border border-border/60 bg-bg-secondary p-5 shadow-xl">
        <Dialog className="outline-none" aria-label="Add Project">
          <Heading
            slot="title"
            className="mb-4 font-mono text-base leading-none font-medium text-text-primary"
          >
            Add Project
          </Heading>

          {branchStep ? (
            <BranchStepView
              branchStep={branchStep}
              selectedBranch={selectedBranch}
              onBranchChange={setSelectedBranch}
              projectName={projectName}
              onNameChange={setProjectName}
              onBack={() => setBranchStep(null)}
              onConfirm={handleConfirmLocal}
            />
          ) : (
            <Tabs
              onSelectionChange={(key) => {
                if (key === 'clone') cloneUrlRef.current?.focus();
              }}
            >
              <TabList className="mb-4 flex gap-1 rounded-lg bg-bg-primary/40 p-1">
                <Tab id="local" className={tabCls}>
                  Local
                </Tab>
                <Tab id="clone" className={tabCls}>
                  Clone from URL
                </Tab>
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
                      try {
                        const info = await gitApi.importRepo(trimmed);
                        const branches = await gitApi.listBranches(info.path);
                        branchResultRef.current = { path: info.path, name: info.name, branches };
                        return undefined;
                      } catch (err) {
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
                      <FieldFeedback field={field} validatingLabel="Checking…" />
                    </div>
                  )}
                </localForm.Field>

                <div className="mt-5 flex items-center justify-end gap-2">
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
                </div>
              </TabPanel>

              <TabPanel id="clone">
                <div className="mb-3">
                  <cloneForm.Field
                    name="url"
                    validators={{
                      onChange: ({ value }) => parseSchema(urlSchema, value),
                      onChangeAsync: async ({ value }) => {
                        const trimmed = value.trim();
                        if (!trimmed) return undefined;
                        try {
                          await gitApi.checkRemote(trimmed);
                          return undefined;
                        } catch (err) {
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
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          placeholder="https://github.com/owner/repo.git"
                          className={inputCls}
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <FieldFeedback field={field} validatingLabel="Checking repository…" />
                      </div>
                    )}
                  </cloneForm.Field>
                </div>

                <div className="mb-5">
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
                        <FieldFeedback field={field} />
                      </div>
                    )}
                  </cloneForm.Field>
                </div>

                <div className="flex items-center justify-end gap-2">
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
                        Start Clone
                      </Button>
                    )}
                  </cloneForm.Subscribe>
                </div>
              </TabPanel>
            </Tabs>
          )}
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
  return (
    <>
      {isValidating && validatingLabel && (
        <p className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-text-faint">
          <Spinner size={10} />
          {validatingLabel}
        </p>
      )}
      {showError && <p className={errorCls}>{String(errors[0])}</p>}
    </>
  );
}

function BranchStepView({
  branchStep,
  selectedBranch,
  onBranchChange,
  projectName,
  onNameChange,
  onBack,
  onConfirm,
}: {
  branchStep: BranchStep;
  selectedBranch: string;
  onBranchChange: (v: string) => void;
  projectName: string;
  onNameChange: (v: string) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div>
      <div className="mb-4">
        <label htmlFor="branch-select" className={labelCls}>
          Branch
        </label>
        <select
          id="branch-select"
          value={selectedBranch}
          onChange={(e) => onBranchChange(e.target.value)}
          className={inputCls}
        >
          {branchStep.branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
              {b.is_head ? ' (HEAD)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-5">
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

      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onPress={onBack}>
          Back
        </Button>
        <Button variant="primary" onPress={onConfirm} isDisabled={!projectName.trim()}>
          Add Project
        </Button>
      </div>
    </div>
  );
}
