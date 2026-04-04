import { useEffect, useState, useCallback } from 'react';

import { getSetting, getSettingCollection, setSetting } from '@superagent/db';
import { openUrl } from '@tauri-apps/plugin-opener';

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
import { showErrorToast } from '../../lib/toast';
import { Button } from '../ui';

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
    // Skip background refresh if we already know there's no cached connection
    // and we're in loading state — we still need to check the backend.
    // If cached, refresh silently in background to validate token.
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
    <section>
      <h2 className="mb-1 text-[13px] font-semibold text-text-primary">GitHub</h2>
      <p className="mb-4 text-[12px] text-text-muted">
        Connect your GitHub account for PR status, CI checks, and more.
      </p>
      <GitHubAuth
        auth={auth}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onCancel={handleCancel}
      />
    </section>
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
  if (auth.status === 'loading') {
    return <div className="text-[12px] text-text-muted">Checking connection...</div>;
  }

  if (auth.status === 'connected') {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-bg-secondary px-4 py-3">
        <img
          src={auth.connection.avatarUrl}
          alt={auth.connection.username}
          className="h-8 w-8 rounded-full"
        />
        <span className="flex-1 text-[13px] font-medium text-text-primary">
          {auth.connection.username}
        </span>
        <Button variant="destructive-ghost" size="sm" onPress={onDisconnect}>
          Disconnect
        </Button>
      </div>
    );
  }

  if (auth.status === 'connecting') {
    return (
      <div className="space-y-3 rounded-lg bg-bg-secondary px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-text-muted">Enter this code on GitHub:</span>
          <Button
            size="sm"
            onPress={() => void navigator.clipboard.writeText(auth.deviceCode.userCode)}
          >
            Copy code
          </Button>
        </div>
        <div className="text-center font-mono text-2xl font-bold tracking-widest text-text-primary select-all">
          {auth.deviceCode.userCode}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-text-muted">Waiting for authorization...</span>
          <Button variant="ghost" size="sm" onPress={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button variant="primary" size="sm" onPress={onConnect}>
      Connect GitHub
    </Button>
  );
}
