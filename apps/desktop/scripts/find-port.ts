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

process.stdout.write(String(port));
