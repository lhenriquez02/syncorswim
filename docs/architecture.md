# syncorswim Architecture

## Purpose

syncorswim is a cross-platform desktop app for synchronized watching of video
with shared playback controls. It supports two intended playback modes:

1. Local File Sync Mode
2. Server-Hosted Streaming Mode

In both modes, room membership and playback sync use WebSockets. Playback uses
HTML5 video for the MVP. mpv may be evaluated later if codec support becomes a
blocker.

## Playback Modes

### Local File Sync Mode

Each participant has the same video file on their own machine.

Client behavior:

- user selects a local video file
- client computes SHA-256 without blocking the UI
- client plays the local file through an HTML5 video element
- client reports file fingerprint metadata to the room
- client applies shared playback sync events from the WebSocket server

Server behavior:

- tracks room participants
- compares or records participant file fingerprints
- rejects or warns about mismatched files when compatibility checks are enabled
- relays playback sync events only
- never stores or serves media bytes in this mode

This mode is the best fit when every participant already has the file.

### Server-Hosted Streaming Mode

One participant, usually the room host, uploads or selects a local video file for
the room. The server exposes that file over HTTP, and guests stream it with the
HTML5 video element.

Client behavior:

- host selects a local video file for hosting
- guests receive a media URL for the room
- clients set the HTML5 video `src` to the server-hosted media URL
- clients continue to send and receive playback sync over WebSockets

Server behavior:

- owns one hosted video file per room for the MVP
- exposes the room video over HTTP
- supports `Range: bytes=...` requests
- returns `206 Partial Content` for valid byte-range requests
- returns appropriate headers such as `Content-Range`, `Accept-Ranges`,
  `Content-Length`, and `Content-Type`
- continues to handle room membership and playback sync over WebSockets

HTTP byte-range support is required. HTML5 video seeking depends on being able
to request arbitrary byte ranges; without `Range` and `206 Partial Content`,
seeking and buffering behavior will be unreliable for most video files.

For the MVP, server-hosted streaming is local network/dev first. There is no
cloud storage, upload service, transcoding, CDN, account system, or persistence
requirement yet.

## Folder Structure

```text
syncorswim/
  apps/
    client/
      src/main/       Electron main process
      src/preload/    Electron preload boundary
      src/renderer/   React renderer app
      scripts/        Client development helpers
    server/
      src/            Node.js WebSocket and HTTP media server
      test/           Server integration tests
  packages/
    shared/
      src/            Shared TypeScript protocol types and helpers
  docs/               Architecture and engineering documentation
  scripts/            Repository-level verification scripts
```

## Workspaces

The repository uses npm workspaces:

- `@syncorswim/client`
- `@syncorswim/server`
- `@syncorswim/shared`

The root workspace owns cross-cutting tooling: TypeScript, ESLint, Prettier,
Vitest, CI, and smoke verification. Application workspaces own their runtime
dependencies.

## Client Responsibilities

The Electron client is responsible for local user interaction and playback:

- launch a desktop shell
- let the user choose a playback mode
- select and play a local video file in Local File Sync Mode
- compute file SHA-256 without blocking the UI
- show file name, file size, duration, and hash when available
- connect to the WebSocket server
- create and join rooms
- display participant and room status
- send local playback actions when this client is in a room
- apply remote playback actions from other room participants without
  rebroadcasting them
- in Server-Hosted Streaming Mode, play the room media URL served by the server
- perform local drift correction

The renderer should remain browser-safe. Node-only capabilities should be added
through explicit Electron main/preload APIs when required.

## Server Responsibilities

The Node.js server has two distinct responsibilities.

### WebSocket Server

The WebSocket server coordinates rooms and playback state:

- room creation
- room joining
- participant list
- room owner/host tracking for administrative ownership
- playback sync event validation
- playback sync event broadcast
- last-write-wins ordering by server receive order for the MVP
- structured errors for invalid messages or invalid room operations

Playback authority is shared. The host is not the playback authority; any
participant can play, pause, seek, or change playback rate.

### HTTP Media Server

The HTTP media server serves room media in Server-Hosted Streaming Mode:

- serve the selected room video file
- support `Range: bytes=...`
- return `206 Partial Content` for valid ranges
- return full content only when appropriate
- set media response headers needed by HTML5 video
- keep one hosted video per room for the MVP

The HTTP media server should be implemented as a small explicit module rather
than hidden inside WebSocket room logic. It can share room state with the
WebSocket server while the app is in-memory and process-local.

For the MVP, room state and hosted media state are in-memory and process-local.
Persistence, authentication, authorization, matchmaking, reconnect semantics,
horizontal scaling, cloud storage, and transcoding are deferred.

## Shared Package Responsibilities

`@syncorswim/shared` defines the TypeScript protocol shared by the client and
server:

- client-to-server WebSocket message types
- server-to-client WebSocket message types
- playback mode types
- room metadata types
- media metadata types
- parsing and serialization helpers
- protocol constants that must remain consistent across the boundary

Protocol changes should be made in the shared package first, then consumed by
client and server code in the same feature.

## Room Lifecycle

### Create

1. A client connects to the WebSocket server.
2. The client sends `room:create` with the intended playback mode.
3. The server creates an in-memory room.
4. The requesting client becomes the initial participant and room owner/host.
5. The server replies with `room:created`.

### Configure Media

Local File Sync Mode:

1. Each participant selects a local file.
2. Each client computes a SHA-256 fingerprint.
3. Each client reports file metadata to the room.
4. The server tracks compatibility metadata.
5. Playback sync is allowed once the room has compatible media.

Server-Hosted Streaming Mode:

1. The host selects or uploads one video file for the room.
2. For the current dev milestone, the host registers a local server-side file
   path with a typed WebSocket message.
3. The server records that file as the room media.
4. The server exposes an HTTP media URL for that room.
5. Guests receive the media URL through room state.
6. Guests stream the media URL with the HTML5 video element.

### Join

1. A client connects to the WebSocket server.
2. The client sends `room:join` with a room id.
3. The server validates that the room exists.
4. The server adds the client to the participant list.
5. The server replies to the joining client with `room:joined`.
6. Existing participants receive a participant-joined notification.
7. The joining client receives current room mode and media metadata.

### Leave

For the MVP, leaving is implied by WebSocket close. The server removes the
client from its current room. Empty rooms are deleted.

Host transfer is deferred unless needed for the MVP. The host concept is for
room ownership or future administrative controls, not playback authority.

## Sync Protocol

Playback sync uses shared controls:

- any room participant can play, pause, seek, or change playback rate
- the acting participant sends a typed playback sync message to the WebSocket
  server
- the server adds sender id, room id, and server receive ordering metadata as
  needed
- the server broadcasts the action to room participants
- broadcasting to every participant or excluding the sender are both acceptable;
  the MVP should choose the simpler consistent behavior and document it near the
  server code
- clients apply remote playback actions without immediately rebroadcasting the
  same action
- conflicts are last-write-wins by server receive order for the MVP

Each sync message should include:

- sender id
- room id
- action type
- media time
- paused/playing state
- playback rate
- client timestamp
- sequence or revision if useful

Expected actions:

- play
- pause
- seek
- playback rate change

The same sync protocol applies to both playback modes. Only the video source
changes:

- Local File Sync Mode uses a local object URL or local playback source.
- Server-Hosted Streaming Mode uses the server HTTP media URL.

## Drift Correction Strategy

Drift correction should be incremental and conservative:

1. A participant or periodic room heartbeat publishes current playback state.
2. Each other client estimates the expected position using the state timestamp,
   playback rate, and local receipt time.
3. The client compares expected position to its local video position.
4. Small drift can be corrected by nudging playback rate temporarily.
5. Large drift should trigger a seek to the most recently received room state.

Initial thresholds should be simple constants and documented near the sync code.
For example:

- ignore tiny drift below a low threshold
- nudge playback rate for moderate drift
- seek for large drift

Exact thresholds should be validated during MVP testing with real users and real
files.

## File Compatibility

Local File Sync Mode requires participants to select the same local video file
before synchronized playback is considered valid. The MVP compatibility check
should use SHA-256 hashes:

- each client computes the hash locally
- the client sends hash metadata to the room
- the server compares participant hashes
- mismatched users are warned or blocked from sync

Duration and file size are useful display metadata, but SHA-256 is the primary
compatibility signal.

Server-Hosted Streaming Mode does not require guests to have local file hashes,
because guests stream the host/server media. The hosted media should still have
metadata such as filename, size, duration when known, and optional SHA-256 for
debugging or future integrity checks.

## Tooling

- TypeScript project references provide workspace-aware type checking.
- ESLint uses the flat config format with TypeScript-aware rules.
- Prettier owns formatting.
- Vitest runs unit and integration tests.
- `npm run smoke:electron` verifies the Electron build path in headless
  environments without opening a window.
- GitHub Actions runs install, lint, formatting, type checks, tests, smoke
  verification, and builds.

## MVP Roadmap

1. Monorepo setup
2. Electron client shell
3. Local video file picker and playback
4. SHA-256 file hashing
5. WebSocket server
6. Room create/join flow
7. Shared-control playback sync
8. Drift correction
9. Local File Sync Mode compatibility checks
10. Playback mode selection
11. Server-Hosted Streaming Mode room media metadata
12. HTTP media server with byte-range support
13. Server-hosted room playback URL in the client
14. UI polish
15. Windows packaging

## Future Roadmap

- mpv playback backend for broader codec support
- reconnect handling
- host migration for administrative ownership
- room invite links or codes
- better diagnostics for drift and mismatch issues
- hosted media upload progress
- cloud storage or relay hosting if needed
- transcoding only if HTML5/mpv playback support requires it
- signed builds and auto-update strategy
- packaging for Windows first, then macOS and Linux
