import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = resolve(desktopDir, 'src-tauri/target/release/bundle');
const appPath = resolve(bundleDir, 'macos/Superagent.app');

// Build the Tauri app (runs beforeBuildCommand + vite build internally)
const build = spawn('tauri', ['build'], { cwd: desktopDir, stdio: 'inherit' });

build.on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1);

  // Strip macOS quarantine so the unsigned app opens without Gatekeeper blocking it.
  // Users can also run: xattr -cr /path/to/Superagent.app
  const xattr = spawn('xattr', ['-cr', appPath], { stdio: 'inherit' });
  xattr.on('exit', () => {
    console.log(`\nBuild complete (unsigned):`);
    console.log(`  .app  → ${appPath}`);
    console.log(`  .dmg  → ${resolve(bundleDir, 'dmg/')}`);
    console.log(`\nOpen with: open "${appPath}"`);
  });
});
