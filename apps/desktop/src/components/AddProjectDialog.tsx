import { useState, useCallback, useEffect, useRef } from 'react';
import { Dialog, Heading } from 'react-aria-components';

import { useNavigate } from '@tanstack/react-router';
import { FolderOpen } from 'lucide-react';
import { tv } from 'tailwind-variants';

import * as gitApi from '../lib/git';
import { importLocalProject, startProjectClone } from '../lib/project-actions';
import { Button } from './ui';

type Tab = 'local' | 'clone';

const tab = tv({
  base: 'cursor-pointer rounded-md px-3 py-1.5 font-mono text-xs font-medium transition-colors',
  variants: {
    active: {
      true: 'bg-bg-tertiary text-text-primary',
      false: 'text-text-muted hover:text-text-secondary',
    },
  },
});

const inputClass =
  'w-full rounded-md border border-border/40 bg-bg-primary/60 px-3 py-2 font-mono text-sm text-text-primary outline-none placeholder:text-text-faint/50 focus:border-border/70 focus:bg-bg-primary';

const errorClass = 'mt-1.5 font-mono text-xs text-destructive/80';

interface BranchStep {
  path: string;
  name: string;
  branches: gitApi.BranchInfo[];
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

export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('local');

  // Local tab state
  const [localPath, setLocalPath] = useState('');
  const [localError, setLocalError] = useState('');
  const [localValidating, setLocalValidating] = useState(false);

  // Clone tab state
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneDest, setCloneDest] = useState('');
  const [cloneUrlError, setCloneUrlError] = useState('');
  const [cloneDestError, setCloneDestError] = useState('');

  // Branch/name step (shared)
  const [branchStep, setBranchStep] = useState<BranchStep | null>(null);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [projectName, setProjectName] = useState('');

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

  useEffect(() => {
    if (activeTab === 'clone') cloneUrlRef.current?.focus();
  }, [activeTab]);

  const openBrowseForLocal = useCallback(async () => {
    const path = await pickDirectory('Select Git Repository');
    if (path) {
      setLocalPath(path);
      setLocalError('');
    }
  }, []);

  const openBrowseForDest = useCallback(async () => {
    const path = await pickDirectory('Choose destination directory');
    if (path) {
      setCloneDest(path);
      setCloneDestError('');
    }
  }, []);

  const validateLocalPath = useCallback(async (path: string) => {
    if (!path.trim()) return;
    setLocalValidating(true);
    setLocalError('');
    try {
      const info = await gitApi.importRepo(path.trim());
      const branches = await gitApi.listBranches(info.path);
      const head = branches.find((b) => b.is_head)?.name ?? branches[0]?.name ?? '';
      setBranchStep({ path: info.path, name: info.name, branches });
      setSelectedBranch(head);
      setProjectName(info.name);
    } catch (err) {
      setLocalError(
        String(err).includes('not found') || String(err).includes('not a git')
          ? 'Not a git repository'
          : String(err),
      );
    } finally {
      setLocalValidating(false);
    }
  }, []);

  const handleLocalSubmit = useCallback(async () => {
    await validateLocalPath(localPath);
  }, [localPath, validateLocalPath]);

  const handleConfirmLocal = useCallback(() => {
    if (!branchStep) return;
    const branch =
      branchStep.branches.find((b) => b.name === selectedBranch) ?? branchStep.branches[0];
    if (!branch) return;
    importLocalProject(branchStep.path, projectName, branch, navigate);
    onClose();
  }, [branchStep, selectedBranch, projectName, navigate, onClose]);

  const handleStartClone = useCallback(() => {
    let valid = true;
    if (!cloneUrl.trim()) {
      setCloneUrlError('Repository URL is required');
      valid = false;
    } else {
      setCloneUrlError('');
    }
    if (!cloneDest.trim()) {
      setCloneDestError('Destination directory is required');
      valid = false;
    } else {
      setCloneDestError('');
    }
    if (!valid) return;

    startProjectClone(cloneUrl.trim(), cloneDest.trim(), navigate);
    onClose();
  }, [cloneUrl, cloneDest, navigate, onClose]);

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
          <Heading slot="title" className="mb-4 font-mono text-base font-medium text-text-primary">
            Add Project
          </Heading>

          {branchStep ? (
            /* Step 2: branch + name */
            <div>
              <div className="mb-4">
                <label className="mb-1.5 block font-mono text-xs font-medium tracking-widest text-text-faint uppercase">
                  Branch
                </label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className={inputClass}
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
                <label className="mb-1.5 block font-mono text-xs font-medium tracking-widest text-text-faint uppercase">
                  Project name
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className={inputClass}
                  autoComplete="off"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onPress={() => setBranchStep(null)}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  onPress={handleConfirmLocal}
                  isDisabled={!projectName.trim()}
                >
                  Add Project
                </Button>
              </div>
            </div>
          ) : (
            /* Step 1: source selection */
            <div>
              {/* Tabs */}
              <div className="mb-4 flex gap-1 rounded-lg bg-bg-primary/40 p-1">
                <button
                  type="button"
                  className={tab({ active: activeTab === 'local' })}
                  onClick={() => setActiveTab('local')}
                >
                  Local
                </button>
                <button
                  type="button"
                  className={tab({ active: activeTab === 'clone' })}
                  onClick={() => setActiveTab('clone')}
                >
                  Clone from URL
                </button>
              </div>

              {activeTab === 'local' ? (
                <div>
                  <label className="mb-1.5 block font-mono text-xs font-medium tracking-widest text-text-faint uppercase">
                    Repository path
                  </label>
                  <div className="flex gap-2">
                    <input
                      ref={localPathRef}
                      type="text"
                      value={localPath}
                      onChange={(e) => {
                        setLocalPath(e.target.value);
                        setLocalError('');
                      }}
                      onBlur={() => void validateLocalPath(localPath)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleLocalSubmit();
                      }}
                      placeholder="/path/to/repo"
                      className={inputClass}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      variant="secondary"
                      onPress={() => void openBrowseForLocal()}
                      aria-label="Browse"
                    >
                      <FolderOpen size={14} />
                    </Button>
                  </div>
                  {localError && <p className={errorClass}>{localError}</p>}

                  <div className="mt-5 flex justify-end gap-2">
                    <Button variant="secondary" onPress={onClose}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onPress={() => void handleLocalSubmit()}
                      isDisabled={!localPath.trim() || localValidating}
                    >
                      {localValidating ? 'Validating…' : 'Next'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-3">
                    <label className="mb-1.5 block font-mono text-xs font-medium tracking-widest text-text-faint uppercase">
                      Repository URL
                    </label>
                    <input
                      ref={cloneUrlRef}
                      type="text"
                      value={cloneUrl}
                      onChange={(e) => {
                        setCloneUrl(e.target.value);
                        setCloneUrlError('');
                      }}
                      placeholder="https://github.com/owner/repo.git"
                      className={inputClass}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {cloneUrlError && <p className={errorClass}>{cloneUrlError}</p>}
                  </div>

                  <div className="mb-5">
                    <label className="mb-1.5 block font-mono text-xs font-medium tracking-widest text-text-faint uppercase">
                      Destination directory
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={cloneDest}
                        onChange={(e) => {
                          setCloneDest(e.target.value);
                          setCloneDestError('');
                        }}
                        placeholder="~/Developer"
                        className={inputClass}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <Button
                        variant="secondary"
                        onPress={() => void openBrowseForDest()}
                        aria-label="Browse"
                      >
                        <FolderOpen size={14} />
                      </Button>
                    </div>
                    {cloneDestError && <p className={errorClass}>{cloneDestError}</p>}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button variant="secondary" onPress={onClose}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onPress={handleStartClone}
                      isDisabled={!cloneUrl.trim() || !cloneDest.trim()}
                    >
                      Start Clone
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Dialog>
      </div>
    </div>
  );
}
