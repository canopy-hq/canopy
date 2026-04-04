import { invoke } from '@tauri-apps/api/core';

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

export function disconnect(): Promise<void> {
  return invoke<void>('github_disconnect');
}
