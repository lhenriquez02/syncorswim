import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type {
  ClientMessage,
  PlaybackAction,
  PlaybackSyncedMessage,
  ServerMessage
} from '@syncorswim/shared';

type SelectedVideo = {
  name: string;
  size: number;
  url: string;
};

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
type RoomRole = 'none' | 'host' | 'guest';

type HashState =
  | {
      status: 'idle';
    }
  | {
      percent: number;
      status: 'hashing';
    }
  | {
      hash: string;
      status: 'complete';
    }
  | {
      message: string;
      status: 'error';
    };

const formatDuration = (duration: number | null): string => {
  if (duration === null || !Number.isFinite(duration)) {
    return 'Not available';
  }

  const totalSeconds = Math.floor(duration);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatFileSize = (bytes: number | null): string => {
  if (bytes === null) {
    return 'Not available';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const createHashRequestId = (): string => {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const serverUrl = 'ws://localhost:3001';
const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];

const parseServerMessage = (data: string): ServerMessage | null => {
  try {
    const message = JSON.parse(data) as Partial<ServerMessage>;

    if (!message || typeof message.type !== 'string') {
      return null;
    }

    return message as ServerMessage;
  } catch {
    return null;
  }
};

export const App = (): JSX.Element => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomSocketRef = useRef<WebSocket | null>(null);
  const activeHashRequestRef = useRef<string | null>(null);
  const roomRoleRef = useRef<RoomRole>('none');
  const playbackSequenceRef = useRef(0);
  const suppressPlaybackBroadcastUntilRef = useRef(0);
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [hashState, setHashState] = useState<HashState>({ status: 'idle' });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [roomCode, setRoomCode] = useState('');
  const [joinRoomCode, setJoinRoomCode] = useState('');
  const [roomRole, setRoomRole] = useState<RoomRole>('none');
  const [roomMessage, setRoomMessage] = useState(
    'Connect to the local server to create or join a room.'
  );

  const updateRoomRole = (role: RoomRole): void => {
    roomRoleRef.current = role;
    setRoomRole(role);
  };

  useEffect(() => {
    return () => {
      if (selectedVideo) {
        URL.revokeObjectURL(selectedVideo.url);
      }
    };
  }, [selectedVideo]);

  useEffect(() => {
    return () => {
      if (activeHashRequestRef.current) {
        void window.syncorswim.cancelHash(activeHashRequestRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const socket = new WebSocket(serverUrl);
    roomSocketRef.current = socket;
    setConnectionStatus('connecting');

    socket.addEventListener('open', () => {
      setConnectionStatus('connected');
      setRoomMessage('Connected to local room server.');
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        return;
      }

      const message = parseServerMessage(event.data);

      if (!message) {
        setRoomMessage('Received an unreadable server message.');
        return;
      }

      if (message.type === 'room:created') {
        setRoomCode(message.roomId);
        setJoinRoomCode(message.roomId);
        updateRoomRole('host');
        setRoomMessage('Room created. Share this code with guests.');
        return;
      }

      if (message.type === 'room:joined') {
        setRoomCode(message.roomId);
        updateRoomRole('guest');
        setRoomMessage(`Joined room with ${message.participantCount} participant(s).`);
        return;
      }

      if (message.type === 'room:participant-joined') {
        setRoomMessage(
          `A guest joined. ${message.participantCount} participant(s) are now connected.`
        );
        return;
      }

      if (message.type === 'playback:synced') {
        applyRemotePlayback(message);
        return;
      }

      if (message.type === 'room:media-registered') {
        setRoomMessage(`Room media registered: ${message.media.filename}`);
        return;
      }

      setRoomMessage(message.message);
    });

    socket.addEventListener('close', () => {
      if (roomSocketRef.current !== socket) {
        return;
      }

      setConnectionStatus('disconnected');
      updateRoomRole('none');
      setRoomMessage('Disconnected from local room server.');
    });

    socket.addEventListener('error', () => {
      if (roomSocketRef.current !== socket) {
        return;
      }

      setConnectionStatus('error');
      updateRoomRole('none');
      setRoomMessage('Unable to connect to ws://localhost:3001. Start the server and reload.');
    });

    return () => {
      if (roomSocketRef.current === socket) {
        roomSocketRef.current = null;
      }

      socket.close();
    };
  }, []);

  const sendRoomMessage = (message: ClientMessage): void => {
    const socket = roomSocketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setRoomMessage('Not connected to the room server.');
      return;
    }

    socket.send(JSON.stringify(message));
  };

  const sendPlaybackSync = (action: PlaybackAction): void => {
    const video = videoRef.current;

    if (
      !video ||
      roomRoleRef.current === 'none' ||
      Date.now() < suppressPlaybackBroadcastUntilRef.current
    ) {
      return;
    }

    playbackSequenceRef.current += 1;

    sendRoomMessage({
      action,
      paused: video.paused,
      playbackRate: video.playbackRate,
      positionSeconds: video.currentTime,
      sequence: playbackSequenceRef.current,
      sentAt: Date.now(),
      type: 'playback:sync'
    });
  };

  const applyRemotePlayback = (message: PlaybackSyncedMessage): void => {
    const video = videoRef.current;

    if (!video || roomRoleRef.current === 'none') {
      return;
    }

    suppressPlaybackBroadcastUntilRef.current = Date.now() + 750;

    video.playbackRate = message.playbackRate;
    setPlaybackRate(message.playbackRate);

    if (Math.abs(video.currentTime - message.positionSeconds) > 0.25) {
      video.currentTime = message.positionSeconds;
    }

    if (message.paused) {
      video.pause();
      setIsPlaying(false);
      return;
    }

    void video.play();
    setIsPlaying(true);
  };

  const startHashing = async (file: File): Promise<void> => {
    const requestId = createHashRequestId();

    if (activeHashRequestRef.current) {
      void window.syncorswim.cancelHash(activeHashRequestRef.current);
    }

    activeHashRequestRef.current = requestId;
    setHashState({
      percent: 0,
      status: 'hashing'
    });

    const result = await window.syncorswim.hashFile(requestId, file, {
      onProgress: (progress) => {
        if (requestId !== activeHashRequestRef.current) {
          return;
        }

        setHashState({
          percent: progress.percent,
          status: 'hashing'
        });
      }
    });

    if (requestId !== activeHashRequestRef.current) {
      return;
    }

    activeHashRequestRef.current = null;

    if (result.status === 'complete') {
      setHashState({
        hash: result.hash,
        status: 'complete'
      });
      return;
    }

    setHashState({
      message: result.message,
      status: 'error'
    });
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const url = URL.createObjectURL(file);

    setSelectedVideo({
      name: file.name,
      size: file.size,
      url
    });
    setDuration(null);
    setIsPlaying(false);
    setPlaybackRate(1);
    void startHashing(file);
  };

  const handleLoadedMetadata = (): void => {
    setDuration(videoRef.current?.duration ?? null);
  };

  const handleTogglePlayback = (): void => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (video.paused) {
      void video.play();
      return;
    }

    video.pause();
  };

  const handlePlaybackRateChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const video = videoRef.current;
    const nextPlaybackRate = Number(event.target.value);

    setPlaybackRate(nextPlaybackRate);

    if (!video) {
      return;
    }

    video.playbackRate = nextPlaybackRate;
  };

  const handleCreateRoom = (): void => {
    sendRoomMessage({
      type: 'room:create'
    });
  };

  const handleJoinRoom = (): void => {
    const normalizedRoomCode = joinRoomCode.trim();

    if (normalizedRoomCode.length === 0) {
      setRoomMessage('Enter a room code to join.');
      return;
    }

    sendRoomMessage({
      roomId: normalizedRoomCode,
      type: 'room:join'
    });
  };

  const hashDisplay = (() => {
    if (!selectedVideo) {
      return 'No file selected';
    }

    if (hashState.status === 'hashing') {
      return `Hashing... ${Math.floor(hashState.percent)}%`;
    }

    if (hashState.status === 'complete') {
      return hashState.hash;
    }

    if (hashState.status === 'error') {
      return hashState.message;
    }

    return 'Not available';
  })();
  const canUseRooms = connectionStatus === 'connected';

  return (
    <main className="app-shell">
      <section className="video-workspace" aria-labelledby="workspace-title">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">syncorswim</p>
            <h1 id="workspace-title">Local video player</h1>
          </div>
          <label className="file-picker">
            Choose video
            <input accept="video/*" type="file" onChange={handleFileChange} />
          </label>
        </header>

        <section className="room-panel" aria-label="Room controls">
          <div className="room-status-grid">
            <div>
              <span className="detail-label">Connection</span>
              <span className={`status-pill status-pill-${connectionStatus}`}>
                {connectionStatus}
              </span>
            </div>
            <div>
              <span className="detail-label">Room code</span>
              <span className="detail-value">{roomCode || 'Not in a room'}</span>
            </div>
            <div>
              <span className="detail-label">Role</span>
              <span className="detail-value">{roomRole}</span>
            </div>
          </div>

          <div className="room-actions">
            <button
              className="secondary-button"
              disabled={!canUseRooms}
              type="button"
              onClick={handleCreateRoom}
            >
              Create room
            </button>
            <div className="join-room-form">
              <input
                aria-label="Room code"
                disabled={!canUseRooms}
                placeholder="Room code"
                type="text"
                value={joinRoomCode}
                onChange={(event) => setJoinRoomCode(event.target.value)}
              />
              <button
                className="secondary-button"
                disabled={!canUseRooms}
                type="button"
                onClick={handleJoinRoom}
              >
                Join room
              </button>
            </div>
          </div>

          <p className="room-message">{roomMessage}</p>
        </section>

        <div className="player-surface">
          {selectedVideo ? (
            <video
              ref={videoRef}
              className="video-player"
              controls
              src={selectedVideo.url}
              onEnded={() => setIsPlaying(false)}
              onLoadedMetadata={handleLoadedMetadata}
              onPause={() => {
                setIsPlaying(false);
                sendPlaybackSync('pause');
              }}
              onPlay={() => {
                setIsPlaying(true);
                sendPlaybackSync('play');
              }}
              onRateChange={() => {
                const currentPlaybackRate = videoRef.current?.playbackRate ?? 1;
                setPlaybackRate(currentPlaybackRate);
                sendPlaybackSync('rate-change');
              }}
              onSeeked={() => sendPlaybackSync('seek')}
            />
          ) : (
            <div className="empty-state">
              <p>Select a local video file to preview it here.</p>
            </div>
          )}
        </div>

        <footer className="video-details">
          <div>
            <span className="detail-label">File</span>
            <span className="detail-value">{selectedVideo?.name ?? 'No file selected'}</span>
          </div>
          <div>
            <span className="detail-label">Size</span>
            <span className="detail-value">{formatFileSize(selectedVideo?.size ?? null)}</span>
          </div>
          <div>
            <span className="detail-label">Duration</span>
            <span className="detail-value">{formatDuration(duration)}</span>
          </div>
          <div className="hash-detail">
            <span className="detail-label">SHA-256</span>
            <span className="detail-value hash-value">{hashDisplay}</span>
          </div>
          <label className="rate-control">
            <span className="detail-label">Speed</span>
            <select
              disabled={!selectedVideo}
              value={playbackRate}
              onChange={handlePlaybackRateChange}
            >
              {playbackRates.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}x
                </option>
              ))}
            </select>
          </label>
          <button
            className="playback-button"
            disabled={!selectedVideo}
            type="button"
            onClick={handleTogglePlayback}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </footer>
      </section>
    </main>
  );
};
