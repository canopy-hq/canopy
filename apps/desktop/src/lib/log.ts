import { invoke } from '@tauri-apps/api/core';

/** Send an info-level log to the Rust terminal (eprintln). */
export function logInfo(message: string): void {
  void invoke('log_info', { message });
}
