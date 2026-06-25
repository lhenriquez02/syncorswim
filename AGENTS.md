# syncorswim Agent Guide

## Product

syncorswim is a cross-platform desktop app like Teleparty for synchronized video
watching. It supports two intended playback modes:

1. Local File Sync Mode: each participant has the same local file, files are
   verified by SHA-256 fingerprint/hash, and the server only relays sync events.
2. Server-Hosted Streaming Mode: a host selects or uploads one video file for
   the room, the server serves it over HTTP with byte-range support, and guests
   stream it with the HTML5 video element.

Playback sync covers:

- play
- pause
- seek
- playback rate
- periodic drift correction

## Intended Stack

- Electron, React, and TypeScript client
- Node.js and TypeScript WebSocket server
- npm workspaces monorepo
- Shared TypeScript message types
- HTML5 video for the MVP
- Node HTTP media serving with `Range: bytes=...` and `206 Partial Content` for
  Server-Hosted Streaming Mode
- mpv may be considered later for better codec support

Ask before changing the stack or introducing major new dependencies.

## Development Rules

- Implement one feature at a time.
- Keep changes small and testable.
- After each feature, ensure build and tests pass.
- Do not add production polish before the MVP works.
- Prefer simple readable code over clever abstractions.
- Document important architecture decisions.
- Do not modify unrelated files.
- Preserve existing user changes in the working tree.
- Use shared TypeScript types for client/server protocol changes.
- Keep application behavior deterministic enough to test.

## MVP Order

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

## Verification

Run the relevant checks after each feature. For broad changes, run:

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run smoke:electron
npm run build
```

Some tests may need permission to bind a local loopback WebSocket server in
sandboxed environments.

## Architecture Notes

- Keep Electron renderer code browser-safe. Do not import Node-only modules into
  the renderer.
- Use Electron main/preload boundaries deliberately when native capabilities are
  required.
- Keep server room state simple and in-memory until the MVP proves the protocol.
- Treat playback as shared-control: any participant may play, pause, seek, or
  change speed. Keep host status only for room ownership or future admin actions.
- Keep Server-Hosted Streaming Mode local network/dev first: one hosted video
  per room, no cloud storage, no transcoding, no persistence yet.
- HTTP media serving must support byte ranges. HTML5 video seeking depends on
  valid `Range: bytes=...` handling and `206 Partial Content` responses.
- Keep shared package exports runtime-agnostic where possible.
- Do not add persistence, authentication, matchmaking, packaging, or advanced
  codec work before the MVP step that requires it.
