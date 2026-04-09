import { useEffect, useState, useCallback, useRef } from 'react';

import { getSetting, getSettingCollection, setSetting } from '@superagent/db';
import { Button, SectionLabel, Spinner } from '@superagent/ui';
import { useLiveQuery } from '@tanstack/react-db';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Check, GitBranch } from 'lucide-react';

import { pickDirectory } from '../../lib/fs';
import { DEFAULT_WORKTREE_BASE, WORKTREE_BASE_DIR_KEY } from '../../lib/git';
import {
  getConnection,
  disconnect,
  startDeviceFlow,
  pollToken,
  cancelPoll,
  GITHUB_CONNECTION_KEY,
  type GitHubConnection,
  type DeviceCodeInfo,
} from '../../lib/github';
import { CLAUDE_DEFAULT_MODE_KEY, getClaudeDefaultMode } from '../../lib/tab-actions';
import { showErrorToast } from '../../lib/toast';

const sectionDesc = 'mb-4 text-base text-text-muted';
const card = 'rounded-md border border-border/20 bg-bg-secondary';

function friendlyError(raw: string): string {
  if (raw.includes('keychain')) return 'Could not access the system keychain.';
  if (raw.includes('github_api_error')) return 'GitHub rejected the request. Please try again.';
  if (raw.includes('device flow request failed'))
    return 'Could not reach GitHub. Check your connection.';
  return raw;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'disconnected' }
  | { status: 'connecting'; deviceCode: DeviceCodeInfo }
  | { status: 'connected'; connection: GitHubConnection };

function getCachedConnection(): GitHubConnection | null {
  return getSetting<GitHubConnection | null>(
    getSettingCollection().toArray,
    GITHUB_CONNECTION_KEY,
    null,
  );
}

function initialAuthState(): AuthState {
  const cached = getCachedConnection();
  return cached ? { status: 'connected', connection: cached } : { status: 'loading' };
}

export function ConnectionSection() {
  const [auth, setAuth] = useState<AuthState>(initialAuthState);

  useEffect(() => {
    let cancelled = false;
    getConnection()
      .then((conn) => {
        if (cancelled) return;
        setSetting(GITHUB_CONNECTION_KEY, conn);
        setAuth(conn ? { status: 'connected', connection: conn } : { status: 'disconnected' });
      })
      .catch(() => {
        if (!cancelled) setAuth({ status: 'disconnected' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnect = useCallback(async () => {
    try {
      const deviceCode = await startDeviceFlow();
      setAuth({ status: 'connecting', deviceCode });
      void navigator.clipboard.writeText(deviceCode.userCode);
      await openUrl(deviceCode.verificationUri);
      const connection = await pollToken(
        deviceCode.deviceCode,
        deviceCode.interval,
        deviceCode.expiresIn,
      );
      setSetting(GITHUB_CONNECTION_KEY, connection);
      setAuth({ status: 'connected', connection });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (!raw.includes('cancelled')) {
        showErrorToast('GitHub authentication failed', friendlyError(raw));
      }
      setAuth({ status: 'disconnected' });
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
      setSetting(GITHUB_CONNECTION_KEY, null);
      setAuth({ status: 'disconnected' });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      showErrorToast('Disconnect failed', friendlyError(raw));
    }
  }, []);

  const handleCancel = useCallback(() => {
    void cancelPoll();
    setAuth({ status: 'disconnected' });
  }, []);

  return (
    <div className="space-y-8">
      <section>
        <SectionLabel className="mb-3">GitHub</SectionLabel>
        <p className={sectionDesc}>
          Connect your GitHub account for PR status, CI checks, and more.
        </p>
        <GitHubAuth
          auth={auth}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onCancel={handleCancel}
        />
      </section>
      <WorktreeBaseDir />
      <ClaudeDefaultMode />
    </div>
  );
}

function ClaudeDefaultMode() {
  const { data: settings = [] } = useLiveQuery(() => getSettingCollection());
  const mode = getSetting<'bypass' | 'plan'>(
    settings,
    CLAUDE_DEFAULT_MODE_KEY,
    getClaudeDefaultMode(),
  );

  return (
    <section>
      <SectionLabel className="mb-3">Claude Code Default Mode</SectionLabel>
      <p className="mb-3 text-base text-text-muted">
        Default permission mode when launching a Claude Code session.
      </p>
      <fieldset className={`flex gap-px overflow-hidden rounded-md border border-border/20 p-0`}>
        <legend className="sr-only">Claude Code default mode</legend>
        {(['bypass', 'plan'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSetting(CLAUDE_DEFAULT_MODE_KEY, m)}
            className={`flex-1 cursor-pointer px-4 py-2.5 text-left text-base transition-colors ${
              mode === m
                ? 'bg-accent/10 text-accent'
                : 'bg-bg-secondary text-text-muted hover:bg-bg-tertiary hover:text-text-primary'
            }`}
          >
            <span className="font-medium">
              {m === 'bypass' ? 'Bypass permissions' : 'Plan mode'}
            </span>
            <span className="mt-0.5 block text-xs text-text-faint">
              {m === 'bypass' ? 'Skip permission prompts' : 'Review before executing'}
            </span>
          </button>
        ))}
      </fieldset>
    </section>
  );
}

function WorktreeBaseDir() {
  const { data: settings = [] } = useLiveQuery(() => getSettingCollection());
  const currentDir = getSetting<string>(settings, WORKTREE_BASE_DIR_KEY, DEFAULT_WORKTREE_BASE);

  async function handleChoose() {
    const selected = await pickDirectory(
      'Select Worktree Base Directory',
      currentDir.startsWith('~') ? undefined : currentDir,
    );
    if (selected) {
      setSetting(WORKTREE_BASE_DIR_KEY, selected.replace(/\/+$/, ''));
    }
  }

  function handleReset() {
    setSetting(WORKTREE_BASE_DIR_KEY, DEFAULT_WORKTREE_BASE);
  }

  const isDefault = currentDir === DEFAULT_WORKTREE_BASE;

  return (
    <section>
      <SectionLabel className="mb-3">Worktree Base Directory</SectionLabel>
      <p className="mb-3 text-base text-text-muted">
        New worktrees will be created inside this directory.
      </p>
      <div className={`flex items-center gap-2 px-4 py-3 ${card}`}>
        <span className="min-w-0 flex-1 truncate font-mono text-base text-text-primary">
          {currentDir}
        </span>
        <Button variant="ghost" size="sm" onPress={handleChoose}>
          Browse...
        </Button>
        {!isDefault && (
          <Button variant="ghost" size="sm" onPress={handleReset}>
            Reset
          </Button>
        )}
      </div>
    </section>
  );
}

function ConnectingCard({
  deviceCode,
  onCancel,
}: {
  deviceCode: DeviceCodeInfo;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(true); // auto-copied on mount
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => setCopied(false), 3000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(deviceCode.userCode);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 3000);
  }, [deviceCode.userCode]);

  return (
    <div className={`px-4 py-4 ${card}`}>
      <p className="mb-3 text-sm text-text-muted">
        Enter this code on GitHub to authorize Superagent:
      </p>
      <div className="mb-3 flex items-center justify-between gap-4">
        <span className="font-mono text-2xl font-bold tracking-widest text-text-primary select-all">
          {deviceCode.userCode}
        </span>
        <Button variant="ghost" size="sm" onPress={handleCopy}>
          {copied ? (
            <>
              <Check size={13} /> Copied
            </>
          ) : (
            'Copy code'
          )}
        </Button>
      </div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm text-text-muted">
          <Spinner size={12} />
          Waiting for authorization…
        </span>
        <Button variant="destructive-ghost" size="sm" onPress={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function GitHubAuth({
  auth,
  onConnect,
  onDisconnect,
  onCancel,
}: {
  auth: AuthState;
  onConnect: () => void;
  onDisconnect: () => void;
  onCancel: () => void;
}) {
  if (auth.status === 'connecting') {
    return <ConnectingCard deviceCode={auth.deviceCode} onCancel={onCancel} />;
  }

  const isConnected = auth.status === 'connected';

  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${card}`}>
      {isConnected ? (
        <img
          src={auth.connection.avatarUrl}
          alt={auth.connection.username}
          className="h-7 w-7 rounded-full"
        />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-tertiary">
          <GitBranch size={14} className="text-text-faint" />
        </div>
      )}
      <span className="flex-1 font-mono text-base text-text-primary">
        {isConnected ? auth.connection.username : 'Not connected'}
      </span>
      {isConnected ? (
        <Button variant="destructive-ghost" size="sm" onPress={onDisconnect}>
          Disconnect
        </Button>
      ) : (
        <Button variant="primary" size="sm" onPress={onConnect}>
          Connect
        </Button>
      )}
    </div>
  );
}
