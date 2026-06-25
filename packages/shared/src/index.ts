export type RoomId = string;
export type ClientId = string;

export type CreateRoomMessage = {
  type: 'room:create';
};

export type JoinRoomMessage = {
  roomId: RoomId;
  type: 'room:join';
};

export type RegisterRoomMediaMessage = {
  durationSeconds?: number | null;
  filePath: string;
  type: 'room:media-register';
};

export type PlaybackAction = 'play' | 'pause' | 'seek' | 'rate-change';

export type PlaybackSyncMessage = {
  action: PlaybackAction;
  paused: boolean;
  playbackRate: number;
  positionSeconds: number;
  sequence: number;
  sentAt: number;
  type: 'playback:sync';
};

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | RegisterRoomMediaMessage
  | PlaybackSyncMessage;

export type HostedMediaMetadata = {
  durationSeconds: number | null;
  filename: string;
  hostedMediaUrl: string;
  mimeType: string;
  size: number;
};

export type RoomCreatedMessage = {
  clientId: ClientId;
  roomId: RoomId;
  type: 'room:created';
};

export type RoomJoinedMessage = {
  clientId: ClientId;
  participantCount: number;
  roomId: RoomId;
  type: 'room:joined';
};

export type RoomParticipantJoinedMessage = {
  clientId: ClientId;
  participantCount: number;
  roomId: RoomId;
  type: 'room:participant-joined';
};

export type RoomMediaRegisteredMessage = {
  media: HostedMediaMetadata;
  roomId: RoomId;
  type: 'room:media-registered';
};

export type PlaybackSyncedMessage = Omit<PlaybackSyncMessage, 'type'> & {
  roomId: RoomId;
  senderId: ClientId;
  type: 'playback:synced';
};

export type ErrorMessage = {
  code:
    | 'invalid-message'
    | 'room-not-found'
    | 'not-room-host'
    | 'not-in-room'
    | 'media-not-found'
    | 'internal-error';
  message: string;
  type: 'error';
};

export type ServerMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | RoomParticipantJoinedMessage
  | RoomMediaRegisteredMessage
  | PlaybackSyncedMessage
  | ErrorMessage;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isPlaybackAction = (value: unknown): value is PlaybackAction => {
  return value === 'play' || value === 'pause' || value === 'seek' || value === 'rate-change';
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

const isSafeInteger = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isSafeInteger(value);
};

export const parseClientMessage = (value: unknown): ClientMessage | null => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'room:create') {
    return {
      type: 'room:create'
    };
  }

  if (value.type === 'room:join' && typeof value.roomId === 'string' && value.roomId.length > 0) {
    return {
      roomId: value.roomId,
      type: 'room:join'
    };
  }

  if (
    value.type === 'room:media-register' &&
    typeof value.filePath === 'string' &&
    value.filePath.length > 0 &&
    (value.durationSeconds === undefined ||
      value.durationSeconds === null ||
      (isFiniteNumber(value.durationSeconds) && value.durationSeconds >= 0))
  ) {
    return {
      durationSeconds: value.durationSeconds ?? null,
      filePath: value.filePath,
      type: 'room:media-register'
    };
  }

  if (
    value.type === 'playback:sync' &&
    isPlaybackAction(value.action) &&
    typeof value.paused === 'boolean' &&
    isFiniteNumber(value.playbackRate) &&
    value.playbackRate > 0 &&
    isFiniteNumber(value.positionSeconds) &&
    value.positionSeconds >= 0 &&
    isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    isFiniteNumber(value.sentAt)
  ) {
    return {
      action: value.action,
      paused: value.paused,
      playbackRate: value.playbackRate,
      positionSeconds: value.positionSeconds,
      sequence: value.sequence,
      sentAt: value.sentAt,
      type: 'playback:sync'
    };
  }

  return null;
};

export const serializeServerMessage = (message: ServerMessage): string => {
  return JSON.stringify(message);
};
