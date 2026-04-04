import { invoke } from '@tauri-apps/api/core';

export const GITHUB_CONNECTION_KEY = 'github:connection';

export interface DeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface GitHubConnection {
  username: string;
  avatarUrl: string;
}

export function startDeviceFlow(): Promise<DeviceCodeInfo> {
  return invoke<DeviceCodeInfo>('github_start_device_flow');
}

export function pollToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<GitHubConnection> {
  return invoke<GitHubConnection>('github_poll_token', { deviceCode, interval, expiresIn });
}

export function getConnection(): Promise<GitHubConnection | null> {
  return invoke<GitHubConnection | null>('github_get_connection');
}

export function cancelPoll(): Promise<void> {
  return invoke<void>('github_cancel_poll');
}

export function disconnect(): Promise<void> {
  return invoke<void>('github_disconnect');
}

// ── PR Status types ──────────────────────────────────────────────────

export type PrState = 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED';

export interface PrInfo {
  branch: string;
  number: number;
  state: PrState;
  url: string;
}

export function getPrStatuses(repoPaths: string[]): Promise<Record<string, PrInfo[]>> {
  return invoke<Record<string, PrInfo[]>>('github_get_pr_statuses', { repoPaths });
}
