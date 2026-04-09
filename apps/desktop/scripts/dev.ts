import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(desktopDir, '../..');

const rebuild = process.argv.includes('--rebuild');
if (rebuild) {
  const daemonBin = resolve(repoRoot, 'target/debug/superagent-pty-daemon');
  spawnSync('pkill', ['-f', 'superagent-pty-daemon'], { stdio: 'ignore' });
  spawnSync('rm', ['-f', daemonBin], { stdio: 'ignore' });
  console.log('[dev] daemon killed and binary removed — will rebuild on start');
}

// Fixed identifier — keeps dev/prod data dirs separate without creating per-worktree dirs.
const devIdentifier = 'com.superagent.dev';

// Start Vite directly so it picks its own port atomically — no probe/race condition.
const vite = spawn('bun', ['run', 'dev'], {
  cwd: desktopDir,
  stdio: ['inherit', 'pipe', 'inherit'],
  env: process.env,
});

// Sniff Vite's stdout for the bound port, forwarding output as we go.
const port = await new Promise<number>((resolve, reject) => {
  let buf = '';
  vite.stdout!.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    process.stdout.write(text);
    buf += text;
    const match = buf.match(/localhost:(\d+)/);
    if (match) resolve(parseInt(match[1]));
  });
  vite.on('error', reject);
  vite.once('exit', (code) => reject(new Error(`Vite exited prematurely (code ${code})`)));
});

// Forward remaining Vite output
vite.stdout!.on('data', (chunk: Buffer) => process.stdout.write(chunk));

// Resolve the codesign runner script (signs dev binary to prevent Keychain prompts)
const codesignRunner = resolve(repoRoot, 'scripts/cargo-codesign.sh');

// Use the codesign runner if it exists and is executable, otherwise plain cargo
const runnerArgs = (await Bun.file(codesignRunner).exists()) ? ['--runner', codesignRunner] : [];

// Start Tauri pointed at the actual port Vite bound.
const tauri = spawn(
  'tauri',
  [
    'dev',
    ...runnerArgs,
    '--config',
    `{"identifier":"${devIdentifier}","build":{"devUrl":"http://localhost:${port}"}}`,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      RUST_LOG: process.env.RUST_LOG ?? 'debug',
      RUST_BACKTRACE: process.env.RUST_BACKTRACE ?? '1',
    },
  },
);

const cleanup = () => {
  vite.kill();
  tauri.kill();
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

tauri.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
