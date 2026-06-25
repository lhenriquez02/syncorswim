import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClientMessage, ServerMessage } from '@syncorswim/shared';
import { WebSocket, type RawData } from 'ws';

import { createSyncorswimServer, type SyncorswimServer } from '../src/server.js';

let server: SyncorswimServer | null = null;
let temporaryDirectory: string | null = null;
const sockets = new Set<WebSocket>();
const messageQueues = new WeakMap<WebSocket, RawData[]>();
const messageWaiters = new WeakMap<WebSocket, Array<(data: RawData) => void>>();

const startServer = async (): Promise<string> => {
  server = createSyncorswimServer({
    host: '127.0.0.1',
    port: 0
  });

  await new Promise<void>((resolve, reject) => {
    server?.httpServer.once('listening', resolve);
    server?.httpServer.once('error', reject);
  });

  const address = server.httpServer.address() as AddressInfo;

  return `ws://127.0.0.1:${address.port}`;
};

const connect = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url);
  sockets.add(socket);
  messageQueues.set(socket, []);
  messageWaiters.set(socket, []);

  socket.on('message', (data) => {
    const waiters = messageWaiters.get(socket);
    const waiter = waiters?.shift();

    if (waiter) {
      waiter(data);
      return;
    }

    messageQueues.get(socket)?.push(data);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  return socket;
};

const send = (socket: WebSocket, message: ClientMessage): void => {
  socket.send(JSON.stringify(message));
};

const rawDataToString = (data: RawData): string => {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data)).toString('utf8');
  }

  return data.toString('utf8');
};

const nextMessage = async (socket: WebSocket, label = 'message'): Promise<ServerMessage> => {
  const queuedMessage = messageQueues.get(socket)?.shift();

  if (queuedMessage) {
    return JSON.parse(rawDataToString(queuedMessage)) as ServerMessage;
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const rawMessage = await new Promise<RawData>((resolve, reject) => {
    const waiters = messageWaiters.get(socket) ?? [];
    messageWaiters.set(socket, waiters);
    waiters.push(resolve);

    timeout = setTimeout(() => {
      const activeWaiters = messageWaiters.get(socket);
      const waiterIndex = activeWaiters?.indexOf(resolve) ?? -1;

      if (activeWaiters && waiterIndex >= 0) {
        activeWaiters.splice(waiterIndex, 1);
      }

      reject(new Error(`Timed out waiting for WebSocket ${label}.`));
    }, 1000);
  }).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });

  return JSON.parse(rawDataToString(rawMessage)) as ServerMessage;
};

const createFixtureMedia = async (): Promise<string> => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'syncorswim-room-media-'));
  const filePath = join(temporaryDirectory, 'fixture.mp4');
  await writeFile(filePath, '0123456789');
  return filePath;
};

afterEach(async () => {
  for (const socket of sockets) {
    socket.close();
  }

  sockets.clear();

  if (server) {
    const activeServer = server;

    await new Promise<void>((resolve, reject) => {
      activeServer.close(() => {
        activeServer.httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
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

describe('syncorswim WebSocket server', () => {
  it('creates and joins rooms with typed messages', async () => {
    const url = await startServer();
    const host = await connect(url);
    const guest = await connect(url);

    send(host, {
      type: 'room:create'
    });

    const createdMessage = await nextMessage(host);

    expect(createdMessage.type).toBe('room:created');

    if (createdMessage.type !== 'room:created') {
      throw new Error('Expected room:created response.');
    }

    send(guest, {
      roomId: createdMessage.roomId,
      type: 'room:join'
    });

    const joinedMessage = await nextMessage(guest);
    const participantMessage = await nextMessage(host);

    expect(joinedMessage).toMatchObject({
      participantCount: 2,
      roomId: createdMessage.roomId,
      type: 'room:joined'
    });
    expect(participantMessage).toMatchObject({
      participantCount: 2,
      roomId: createdMessage.roomId,
      type: 'room:participant-joined'
    });
  });

  it('rejects joins for missing rooms', async () => {
    const url = await startServer();
    const socket = await connect(url);

    send(socket, {
      roomId: 'missing',
      type: 'room:join'
    });

    await expect(nextMessage(socket)).resolves.toMatchObject({
      code: 'room-not-found',
      type: 'error'
    });
  });

  it('broadcasts participant playback sync to other room members', async () => {
    const url = await startServer();
    const host = await connect(url);
    const guest = await connect(url);

    send(host, {
      type: 'room:create'
    });

    const createdMessage = await nextMessage(host);

    if (createdMessage.type !== 'room:created') {
      throw new Error('Expected room:created response.');
    }

    send(guest, {
      roomId: createdMessage.roomId,
      type: 'room:join'
    });

    await nextMessage(guest);
    await nextMessage(host);

    send(host, {
      action: 'play',
      paused: false,
      playbackRate: 1,
      positionSeconds: 12.5,
      sequence: 1,
      sentAt: 1000,
      type: 'playback:sync'
    });

    const syncedMessage = await nextMessage(guest);

    expect(syncedMessage).toMatchObject({
      action: 'play',
      paused: false,
      playbackRate: 1,
      positionSeconds: 12.5,
      roomId: createdMessage.roomId,
      sequence: 1,
      type: 'playback:synced'
    });

    if (syncedMessage.type !== 'playback:synced') {
      throw new Error('Expected playback:synced response.');
    }

    expect(typeof syncedMessage.senderId).toBe('string');
  });

  it('allows guests to broadcast playback sync', async () => {
    const url = await startServer();
    const host = await connect(url);
    const guest = await connect(url);

    send(host, {
      type: 'room:create'
    });

    const createdMessage = await nextMessage(host);

    if (createdMessage.type !== 'room:created') {
      throw new Error('Expected room:created response.');
    }

    send(guest, {
      roomId: createdMessage.roomId,
      type: 'room:join'
    });

    await nextMessage(guest);
    await nextMessage(host);

    send(guest, {
      action: 'pause',
      paused: true,
      playbackRate: 1,
      positionSeconds: 8,
      sequence: 1,
      sentAt: 1000,
      type: 'playback:sync'
    });

    const syncedMessage = await nextMessage(host);

    expect(syncedMessage).toMatchObject({
      action: 'pause',
      paused: true,
      playbackRate: 1,
      positionSeconds: 8,
      roomId: createdMessage.roomId,
      sequence: 1,
      type: 'playback:synced'
    });

    if (syncedMessage.type !== 'playback:synced') {
      throw new Error('Expected playback:synced response.');
    }

    expect(typeof syncedMessage.senderId).toBe('string');
  });

  it('lets the host register room media and broadcasts metadata', async () => {
    const url = await startServer();
    const httpUrl = url.replace('ws://', 'http://');
    const host = await connect(url);
    const guest = await connect(url);
    const filePath = await createFixtureMedia();

    send(host, {
      type: 'room:create'
    });

    const createdMessage = await nextMessage(host);

    if (createdMessage.type !== 'room:created') {
      throw new Error('Expected room:created response.');
    }

    send(guest, {
      roomId: createdMessage.roomId,
      type: 'room:join'
    });

    await nextMessage(guest);
    await nextMessage(host);

    send(host, {
      durationSeconds: 12.5,
      filePath,
      type: 'room:media-register'
    });

    const hostMediaMessage = await nextMessage(host);
    const guestMediaMessage = await nextMessage(guest);

    expect(hostMediaMessage).toMatchObject({
      media: {
        durationSeconds: 12.5,
        filename: 'fixture.mp4',
        hostedMediaUrl: `/media/${createdMessage.roomId}`,
        mimeType: 'video/mp4',
        size: 10
      },
      roomId: createdMessage.roomId,
      type: 'room:media-registered'
    });
    expect(guestMediaMessage).toEqual(hostMediaMessage);

    const response = await fetch(`${httpUrl}/media/${createdMessage.roomId}`, {
      headers: {
        Range: 'bytes=0-3'
      }
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-3/10');
    expect(await response.text()).toBe('0123');
  });

  it('sends current room media metadata to participants who join later', async () => {
    const url = await startServer();
    const host = await connect(url);
    const filePath = await createFixtureMedia();

    send(host, {
      type: 'room:create'
    });

    const createdMessage = await nextMessage(host);

    if (createdMessage.type !== 'room:created') {
      throw new Error('Expected room:created response.');
    }

    send(host, {
      durationSeconds: null,
      filePath,
      type: 'room:media-register'
    });

    await expect(nextMessage(host)).resolves.toMatchObject({
      media: {
        hostedMediaUrl: `/media/${createdMessage.roomId}`
      },
      roomId: createdMessage.roomId,
      type: 'room:media-registered'
    });

    const guest = await connect(url);

    send(guest, {
      roomId: createdMessage.roomId,
      type: 'room:join'
    });

    await expect(nextMessage(guest)).resolves.toMatchObject({
      roomId: createdMessage.roomId,
      type: 'room:joined'
    });
    await expect(nextMessage(guest)).resolves.toMatchObject({
      media: {
        hostedMediaUrl: `/media/${createdMessage.roomId}`
      },
      roomId: createdMessage.roomId,
      type: 'room:media-registered'
    });
  });

  it('rejects media registration from non-host participants', async () => {
    const url = await startServer();
    const host = await connect(url);
    const guest = await connect(url);
    const filePath = await createFixtureMedia();

    send(host, {
      type: 'room:create'
    });

    const createdMessage = await nextMessage(host);

    if (createdMessage.type !== 'room:created') {
      throw new Error('Expected room:created response.');
    }

    send(guest, {
      roomId: createdMessage.roomId,
      type: 'room:join'
    });

    await nextMessage(guest);

    send(guest, {
      filePath,
      type: 'room:media-register'
    });

    await expect(nextMessage(guest)).resolves.toMatchObject({
      code: 'not-room-host',
      type: 'error'
    });
  });

  it('returns a clear HTTP error when no media is registered for a room', async () => {
    const url = await startServer();
    const httpUrl = url.replace('ws://', 'http://');
    const response = await fetch(`${httpUrl}/media/missing`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('No media is registered for this room.');
  });
});
