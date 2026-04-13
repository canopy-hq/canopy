import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(desktopDir, '../..');
const bundleDir = resolve(repoRoot, 'target/release/bundle');
const appPath = resolve(bundleDir, 'macos/Canopy.app');

// Build the Tauri app (runs beforeBuildCommand + vite build internally)
const build = spawn('tauri', ['build', '--bundles', 'app,dmg'], {
  cwd: desktopDir,
  stdio: 'inherit',
});

build.on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1);

  // Bundle the PTY daemon binary alongside the main executable.
  // beforeBuildCommand builds it to target/release/ but Tauri only bundles the
  // main binary. The Rust code locates the daemon via current_exe().parent(),
  // which resolves to Contents/MacOS/ inside the .app bundle.
  const daemonSrc = resolve(repoRoot, 'target/release/canopy-pty-daemon');
  if (!existsSync(daemonSrc)) {
    console.error(`Error: PTY daemon binary not found at ${daemonSrc}`);
    console.error('Ensure beforeBuildCommand ran: cargo build --release --bin canopy-pty-daemon');
    process.exit(1);
  }
  const daemonDst = resolve(appPath, 'Contents/MacOS/canopy-pty-daemon');
  copyFileSync(daemonSrc, daemonDst);
  chmodSync(daemonDst, 0o755);

  // Strip macOS quarantine so the unsigned app opens without Gatekeeper blocking it.
  // Users can also run: xattr -cr /path/to/Canopy.app
  const xattr = spawn('xattr', ['-cr', appPath], { stdio: 'inherit' });
  xattr.on('exit', () => {
    console.log(`\nBuild complete (unsigned):`);
    console.log(`  .app  → ${appPath}`);
    console.log(`  .dmg  → ${resolve(bundleDir, 'dmg/')}`);
    console.log(`\nOpen with: open "${appPath}"`);
  });
});
