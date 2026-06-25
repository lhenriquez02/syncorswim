import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { createServer } from 'vite';

const currentFile = fileURLToPath(import.meta.url);
const clientRoot = dirname(dirname(currentFile));

const run = (command, args) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: clientRoot,
      shell: false,
      stdio: 'inherit'
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
};

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

await run(npmCommand, ['run', 'build:main']);

const server = await createServer({
  configFile: join(clientRoot, 'vite.config.ts'),
  root: clientRoot,
  server: {
    host: '127.0.0.1'
  }
});

await server.listen();
server.printUrls();

const rendererUrl = server.resolvedUrls?.local[0];

if (!rendererUrl) {
  await server.close();
  throw new Error('Vite did not expose a local development URL.');
}

const electronProcess = spawn(electronPath, ['.'], {
  cwd: clientRoot,
  env: {
    ...process.env,
    SYNCORSWIM_RENDERER_URL: rendererUrl
  },
  shell: false,
  stdio: 'inherit'
});

const shutdown = async () => {
  electronProcess.kill();
  await server.close();
};

process.once('SIGINT', () => {
  void shutdown().finally(() => {
    process.exit(0);
  });
});

process.once('SIGTERM', () => {
  void shutdown().finally(() => {
    process.exit(0);
  });
});

electronProcess.once('exit', (code) => {
  void server.close().finally(() => {
    process.exit(code ?? 0);
  });
});
