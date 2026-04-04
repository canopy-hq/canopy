import { useEffect, useState, useCallback } from 'react';

import { setSetting } from '@superagent/db';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';

import { Button, Kbd, Tooltip } from '../components/ui';

import { Button } from '../components/ui/Button';
import {
  getConnection,
  disconnect,
  startDeviceFlow,
  pollToken,
  type GitHubConnection,
  type DeviceCodeInfo,
} from '../lib/github';

type AuthState =
  | { status: 'loading' }
  | { status: 'disconnected' }
  | { status: 'connecting'; deviceCode: DeviceCodeInfo }
  | { status: 'connected'; connection: GitHubConnection }
  | { status: 'error'; message: string };

function SettingsRoute() {
  const navigate = useNavigate();
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void navigate({ to: '/' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Check connection status on mount
  useEffect(() => {
    let cancelled = false;
    getConnection()
      .then((conn) => {
        if (cancelled) return;
        setSetting('github:connection', conn);
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
      window.open(deviceCode.verificationUri, '_blank');

      const connection = await pollToken(deviceCode.deviceCode, deviceCode.interval);
      setSetting('github:connection', connection);
      setAuth({ status: 'connected', connection });
    } catch (e) {
      setAuth({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    await disconnect();
    setSetting('github:connection', null);
    setAuth({ status: 'disconnected' });
  }, []);

  const handleCancel = useCallback(() => {
    setAuth({ status: 'disconnected' });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-5">
        <span className="text-sm font-semibold text-text-primary">Settings</span>
        <Tooltip
          label={
            <>
              Close <Kbd>Esc</Kbd>
            </>
          }
          placement="left"
        >
          <Button
            iconOnly
            variant="ghost"
            aria-label="Close settings"
            onPress={() => void navigate({ to: '/' })}
          >
            <X size={13} strokeWidth={1.8} />
          </Button>
        </Tooltip>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-lg space-y-8">
          {/* GitHub Section */}
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
        </div>
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

  if (auth.status === 'error') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-destructive/[0.08] px-4 py-3 text-[12px] text-destructive">
          {auth.message}
        </div>
        <Button variant="primary" size="sm" onPress={onConnect}>
          Try again
        </Button>
      </div>
    );
  }

  // disconnected
  return (
    <Button variant="primary" size="sm" onPress={onConnect}>
      Connect GitHub
    </Button>
  );
}

export default SettingsRoute;

export const Route = createFileRoute('/settings')({ component: SettingsRoute });
