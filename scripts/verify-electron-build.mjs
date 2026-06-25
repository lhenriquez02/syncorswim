import { spawn } from 'node:child_process';
import { log } from 'node:console';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = process.cwd();

const run = (args) => {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, {
      cwd: root,
      shell: false,
      stdio: 'inherit'
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${npmCommand} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
};

const removeBuildOutputs = async () => {
  await Promise.all([
    rm(join(root, 'apps/client/dist'), { force: true, recursive: true }),
    rm(join(root, 'apps/server/dist'), { force: true, recursive: true }),
    rm(join(root, 'packages/shared/dist'), { force: true, recursive: true })
  ]);
};

const assertFile = (relativePath) => {
  const absolutePath = join(root, relativePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Expected build artifact was not created: ${relativePath}`);
  }
};

const assertRendererAssets = async () => {
  const assetsPath = join(root, 'apps/client/dist/renderer/assets');
  const assets = await readdir(assetsPath);

  if (!assets.some((asset) => asset.endsWith('.js'))) {
    throw new Error('Expected Vite renderer JavaScript asset was not created.');
  }
};

await removeBuildOutputs();

await run(['run', 'build', '--workspace', '@syncorswim/shared', '--', '--force']);
await run(['run', 'build:main', '--workspace', '@syncorswim/client', '--', '--force']);
await run(['run', 'build:renderer', '--workspace', '@syncorswim/client']);
await run(['run', 'build', '--workspace', '@syncorswim/server', '--', '--force']);

assertFile('packages/shared/dist/index.js');
assertFile('packages/shared/dist/index.d.ts');
assertFile('apps/client/dist/main/index.js');
assertFile('apps/client/dist/preload/index.js');
assertFile('apps/client/dist/renderer/index.html');
assertFile('apps/server/dist/index.js');
assertFile('apps/server/dist/index.d.ts');
await assertRendererAssets();

log('Headless Electron build verification passed.');
