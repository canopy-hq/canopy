import { spawn } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(desktopDir, '../..');
const bundleDir = resolve(repoRoot, 'target/release/bundle');
const appPath = resolve(bundleDir, 'macos/Canopy.app');
const dmgDir = resolve(bundleDir, 'dmg');
const dmgPath = resolve(dmgDir, 'Canopy.dmg');

// Build the .app only — DMG is created below *after* daemon injection so the
// DMG contains the daemon. Building app,dmg together would produce a DMG
// before the daemon copy step runs.
const build = spawn('tauri', ['build', '--bundles', 'app'], { cwd: desktopDir, stdio: 'inherit' });

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
  xattr.on('exit', (xattrCode) => {
    if (xattrCode !== 0) process.exit(xattrCode ?? 1);

    // Create the DMG from the fully-assembled .app (daemon already injected).
    // Staging dir: .app + /Applications symlink → standard drag-to-install layout.
    mkdirSync(dmgDir, { recursive: true });
    const stagingDir = mkdtempSync(resolve(tmpdir(), 'canopy-dmg-'));

    const cpApp = spawn('cp', ['-R', appPath, stagingDir], { stdio: 'inherit' });
    cpApp.on('exit', (cpCode) => {
      if (cpCode !== 0) {
        rmSync(stagingDir, { recursive: true, force: true });
        process.exit(cpCode ?? 1);
      }

      symlinkSync('/Applications', resolve(stagingDir, 'Applications'));

      const hdiutil = spawn(
        'hdiutil',
        [
          'create',
          '-volname',
          'Canopy',
          '-srcfolder',
          stagingDir,
          '-ov',
          '-format',
          'UDZO',
          dmgPath,
        ],
        { stdio: 'inherit' },
      );
      hdiutil.on('exit', (hdiCode) => {
        rmSync(stagingDir, { recursive: true, force: true });
        if (hdiCode !== 0) process.exit(hdiCode ?? 1);

        console.log(`\nBuild complete (unsigned):`);
        console.log(`  .app  → ${appPath}`);
        console.log(`  .dmg  → ${dmgPath}`);
        console.log(`\nOpen with: open "${appPath}"`);
      });
    });
  });
});
