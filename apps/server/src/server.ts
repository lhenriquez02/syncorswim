import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import { basename } from 'node:path';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  parseClientMessage,
  serializeServerMessage,
  type ClientId,
  type ClientMessage,
  type ErrorMessage,
  type HostedMediaMetadata,
  type RoomId,
  type ServerMessage
} from '@syncorswim/shared';
import { getContentType, handleMediaRequest } from './media.js';

type ClientConnection = {
  id: ClientId;
  roomId: RoomId | null;
  socket: WebSocket;
};

type Room = {
  clients: Set<ClientId>;
  hostId: ClientId;
  id: RoomId;
  media: RoomMedia | null;
};

type RoomMedia = {
  filePath: string;
  metadata: HostedMediaMetadata;
};

export type SyncorswimServerOptions = {
  host?: string;
  port: number;
};

export type SyncorswimServer = WebSocketServer & {
  httpServer: HttpServer;
};

export const DEFAULT_PORT = 3001;

const createRoomId = (): RoomId => {
  return randomUUID().slice(0, 8);
};

const parseRawMessage = (data: RawData): ClientMessage | null => {
  try {
    const rawText = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : data instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(data)).toString('utf8')
        : data.toString('utf8');

    return parseClientMessage(JSON.parse(rawText));
  } catch {
    return null;
  }
};

export const parsePort = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
};

export const createSyncorswimServer = (options: SyncorswimServerOptions): SyncorswimServer => {
  const rooms = new Map<RoomId, Room>();
  const clients = new Map<ClientId, ClientConnection>();
  const httpServer = createServer((request, response) => {
    void handleMediaRequest(request, response, {
      getMediaPath: (roomId) => rooms.get(roomId)?.media?.filePath ?? null
    }).then((handled) => {
      if (!handled) {
        response.writeHead(404, {
          'Content-Length': 9,
          'Content-Type': 'text/plain; charset=utf-8'
        });
        response.end('Not found');
      }
    });
  });

  const server = new WebSocketServer({
    server: httpServer
  }) as SyncorswimServer;

  server.httpServer = httpServer;
  httpServer.listen({
    host: options.host,
    port: options.port
  });

  const send = (client: ClientConnection, message: ServerMessage): void => {
    if (client.socket.readyState !== client.socket.OPEN) {
      return;
    }

    client.socket.send(serializeServerMessage(message));
  };

  const sendError = (client: ClientConnection, error: Omit<ErrorMessage, 'type'>): void => {
    send(client, {
      ...error,
      type: 'error'
    });
  };

  const leaveCurrentRoom = (client: ClientConnection): void => {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);

    if (!room) {
      client.roomId = null;
      return;
    }

    if (room.hostId === client.id) {
      for (const clientId of room.clients) {
        const roomClient = clients.get(clientId);

        if (roomClient) {
          roomClient.roomId = null;
        }
      }

      rooms.delete(room.id);
      return;
    }

    room.clients.delete(client.id);

    if (room.clients.size === 0) {
      rooms.delete(room.id);
    }

    client.roomId = null;
  };

  const broadcastToRoom = (
    room: Room,
    message: ServerMessage,
    options: {
      excludeClientId?: ClientId;
    } = {}
  ): void => {
    for (const clientId of room.clients) {
      if (clientId === options.excludeClientId) {
        continue;
      }

      const client = clients.get(clientId);

      if (client) {
        send(client, message);
      }
    }
  };

  const handleCreateRoom = (client: ClientConnection): void => {
    leaveCurrentRoom(client);

    const room: Room = {
      clients: new Set([client.id]),
      hostId: client.id,
      id: createRoomId(),
      media: null
    };

    rooms.set(room.id, room);
    client.roomId = room.id;

    send(client, {
      clientId: client.id,
      roomId: room.id,
      type: 'room:created'
    });
  };

  const registerRoomMedia = async (
    client: ClientConnection,
    message: Extract<ClientMessage, { type: 'room:media-register' }>
  ): Promise<void> => {
    if (!client.roomId) {
      sendError(client, {
        code: 'not-in-room',
        message: 'Create or join a room before registering media.'
      });
      return;
    }

    const room = rooms.get(client.roomId);

    if (!room) {
      sendError(client, {
        code: 'room-not-found',
        message: `Room ${client.roomId} does not exist.`
      });
      return;
    }

    if (room.hostId !== client.id) {
      sendError(client, {
        code: 'not-room-host',
        message: 'Only the room host can register hosted media.'
      });
      return;
    }

    const mediaStats = await stat(message.filePath).catch(() => null);

    if (!mediaStats?.isFile()) {
      sendError(client, {
        code: 'media-not-found',
        message: 'The requested media file does not exist or is not readable by the server.'
      });
      return;
    }

    const metadata: HostedMediaMetadata = {
      durationSeconds: message.durationSeconds ?? null,
      filename: basename(message.filePath),
      hostedMediaUrl: `/media/${encodeURIComponent(room.id)}`,
      mimeType: getContentType(message.filePath),
      size: mediaStats.size
    };

    room.media = {
      filePath: message.filePath,
      metadata
    };

    broadcastToRoom(room, {
      media: metadata,
      roomId: room.id,
      type: 'room:media-registered'
    });
  };

  const handleJoinRoom = (client: ClientConnection, roomId: RoomId): void => {
    const room = rooms.get(roomId);

    if (!room) {
      sendError(client, {
        code: 'room-not-found',
        message: `Room ${roomId} does not exist.`
      });
      return;
    }

    leaveCurrentRoom(client);
    room.clients.add(client.id);
    client.roomId = room.id;

    const participantCount = room.clients.size;

    send(client, {
      clientId: client.id,
      participantCount,
      roomId: room.id,
      type: 'room:joined'
    });

    if (room.media) {
      send(client, {
        media: room.media.metadata,
        roomId: room.id,
        type: 'room:media-registered'
      });
    }

    broadcastToRoom(
      room,
      {
        clientId: client.id,
        participantCount,
        roomId: room.id,
        type: 'room:participant-joined'
      },
      {
        excludeClientId: client.id
      }
    );
  };

  const handleClientMessage = (client: ClientConnection, message: ClientMessage): void => {
    if (message.type === 'room:create') {
      handleCreateRoom(client);
      return;
    }

    if (message.type === 'room:join') {
      handleJoinRoom(client, message.roomId);
      return;
    }

    if (message.type === 'room:media-register') {
      void registerRoomMedia(client, message);
      return;
    }

    if (!client.roomId) {
      sendError(client, {
        code: 'not-in-room',
        message: 'Join or create a room before syncing playback.'
      });
      return;
    }

    const room = rooms.get(client.roomId);

    if (!room) {
      sendError(client, {
        code: 'room-not-found',
        message: `Room ${client.roomId} does not exist.`
      });
      return;
    }

    broadcastToRoom(
      room,
      {
        action: message.action,
        paused: message.paused,
        playbackRate: message.playbackRate,
        positionSeconds: message.positionSeconds,
        roomId: room.id,
        senderId: client.id,
        sequence: message.sequence,
        sentAt: message.sentAt,
        type: 'playback:synced'
      },
      {
        excludeClientId: client.id
      }
    );
  };

  server.on('connection', (socket) => {
    const client: ClientConnection = {
      id: randomUUID(),
      roomId: null,
      socket
    };

    clients.set(client.id, client);

    socket.on('message', (data) => {
      const message = parseRawMessage(data);

      if (!message) {
        sendError(client, {
          code: 'invalid-message',
          message: 'Expected a valid syncorswim client message.'
        });
        return;
      }

      handleClientMessage(client, message);
    });

    socket.on('close', () => {
      leaveCurrentRoom(client);
      clients.delete(client.id);
    });

    socket.on('error', () => {
      leaveCurrentRoom(client);
      clients.delete(client.id);
    });
  });

  return server;
};
