import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const preferred = parseInt(process.env.VITE_PORT ?? '5173');

const port = await new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(preferred, '127.0.0.1', () => {
    resolve((s.address() as { port: number }).port);
    s.close();
  });
  s.on('error', () => {
    s.listen(0, '127.0.0.1', () => {
      resolve((s.address() as { port: number }).port);
      s.close();
    });
  });
});

spawn('tauri', ['dev', '--config', `{"build":{"devUrl":"http://localhost:${port}"}}`], {
  stdio: 'inherit',
  env: { ...process.env, VITE_PORT: String(port) },
}).on('exit', (code) => process.exit(code ?? 0));
