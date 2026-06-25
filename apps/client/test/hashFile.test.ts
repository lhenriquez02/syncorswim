import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { HashFileError, hashFile } from '../src/main/hashFile.js';

let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, {
      force: true,
      recursive: true
    });
  }

  temporaryDirectory = null;
});

const createTemporaryFile = async (contents: string): Promise<string> => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'syncorswim-hash-'));
  const filePath = join(temporaryDirectory, 'video-fixture.txt');
  await writeFile(filePath, contents);
  return filePath;
};

describe('hashFile', () => {
  it('hashes a file with streaming progress', async () => {
    const filePath = await createTemporaryFile('abc');
    const progressEvents: number[] = [];

    const result = await hashFile(filePath, {
      onProgress: (progress) => {
        progressEvents.push(progress.percent);
      }
    });

    expect(result).toEqual({
      hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      size: 3
    });
    expect(progressEvents[0]).toBe(0);
    expect(progressEvents.at(-1)).toBe(100);
  });

  it('returns a useful error when the file cannot be read', async () => {
    await expect(hashFile('/definitely/missing/syncorswim-video.mp4')).rejects.toThrow(
      HashFileError
    );
    await expect(hashFile('/definitely/missing/syncorswim-video.mp4')).rejects.toThrow(
      'Unable to read the selected file'
    );
  });
});
