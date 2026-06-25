import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { handleMediaRequest, parseByteRange } from '../src/media.js';

let server: Server | null = null;
let temporaryDirectory: string | null = null;

const startMediaServer = async (mediaPath: string): Promise<string> => {
  server = createServer((request, response) => {
    void handleMediaRequest(request, response, {
      getMediaPath: () => mediaPath
    }).then((handled) => {
      if (!handled) {
        response.writeHead(404);
        response.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server?.once('listening', resolve);
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1');
  });

  const address = server.address() as AddressInfo;

  return `http://127.0.0.1:${address.port}`;
};

const createFixtureFile = async (): Promise<string> => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'syncorswim-media-'));
  const filePath = join(temporaryDirectory, 'fixture.mp4');
  await writeFile(filePath, '0123456789');
  return filePath;
};

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  server = null;

  if (temporaryDirectory) {
    await rm(temporaryDirectory, {
      force: true,
      recursive: true
    });
  }

  temporaryDirectory = null;
});

describe('parseByteRange', () => {
  it('returns none when no range header is provided', () => {
    expect(parseByteRange(undefined, 100)).toEqual({
      type: 'none'
    });
  });

  it('parses explicit byte ranges', () => {
    expect(parseByteRange('bytes=10-19', 100)).toEqual({
      end: 19,
      start: 10,
      type: 'range'
    });
  });

  it('parses open-ended byte ranges', () => {
    expect(parseByteRange('bytes=90-', 100)).toEqual({
      end: 99,
      start: 90,
      type: 'range'
    });
  });

  it('parses suffix byte ranges', () => {
    expect(parseByteRange('bytes=-10', 100)).toEqual({
      end: 99,
      start: 90,
      type: 'range'
    });
  });

  it('clamps end bytes to the file size', () => {
    expect(parseByteRange('bytes=90-200', 100)).toEqual({
      end: 99,
      start: 90,
      type: 'range'
    });
  });

  it('rejects invalid or unsatisfiable ranges', () => {
    expect(parseByteRange('bytes=100-120', 100)).toEqual({
      type: 'invalid'
    });
    expect(parseByteRange('bytes=20-10', 100)).toEqual({
      type: 'invalid'
    });
    expect(parseByteRange('items=0-10', 100)).toEqual({
      type: 'invalid'
    });
    expect(parseByteRange('bytes=0-10,20-30', 100)).toEqual({
      type: 'invalid'
    });
  });
});

describe('handleMediaRequest', () => {
  it('serves byte ranges with partial content headers', async () => {
    const mediaPath = await createFixtureFile();
    const baseUrl = await startMediaServer(mediaPath);
    const response = await fetch(`${baseUrl}/media/dev`, {
      headers: {
        Range: 'bytes=2-5'
      }
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(await response.text()).toBe('2345');
  });

  it('returns 416 for invalid ranges', async () => {
    const mediaPath = await createFixtureFile();
    const baseUrl = await startMediaServer(mediaPath);
    const response = await fetch(`${baseUrl}/media/dev`, {
      headers: {
        Range: 'bytes=10-20'
      }
    });

    expect(response.status).toBe(416);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-range')).toBe('bytes */10');
  });
});
