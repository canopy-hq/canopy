import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFlag = process.argv[process.argv.indexOf('--env') + 1];
if (envFlag !== 'dev' && envFlag !== 'prod') {
  console.error('Usage: bun scripts/reset-db.ts --env <dev|prod>');
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const dbPath =
  envFlag === 'dev'
    ? join(
        homedir(),
        'Library',
        'Application Support',
        `com.superagent.dev-${new Bun.CryptoHasher('md5').update(repoRoot).digest('hex').slice(0, 8)}`,
        'superagent.db',
      )
    : join(homedir(), 'Library', 'Application Support', 'com.superagent.app', 'superagent.db');

spawnSync('rm', ['-f', dbPath], { stdio: 'ignore' });
console.log(`[reset-db] ${envFlag} DB reset: ${dbPath}`);
