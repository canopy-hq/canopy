import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const envFlag = process.argv[process.argv.indexOf('--env') + 1];
if (envFlag !== 'dev' && envFlag !== 'prod') {
  console.error('Usage: bun scripts/reset-db.ts --env <dev|prod>');
  process.exit(1);
}

const dbPath =
  envFlag === 'dev'
    ? join(homedir(), 'Library', 'Application Support', 'com.canopy.dev', 'canopy.db')
    : join(homedir(), 'Library', 'Application Support', 'com.canopy.app', 'canopy.db');

spawnSync('rm', ['-f', dbPath], { stdio: 'ignore' });
console.log(`[reset-db] ${envFlag} DB reset: ${dbPath}`);
