# syncorswim

Cross-platform desktop application monorepo.

## Workspace Layout

- `apps/client` - Electron, React, and TypeScript desktop client.
- `apps/server` - Node.js and TypeScript server workspace.
- `packages/shared` - Shared TypeScript types and utilities for future use.
- `docs` - Project architecture and engineering documentation.

## Common Commands

```sh
npm install
npm run lint
npm run format:check
npm run typecheck
npm test
npm run smoke:electron
npm run build
```

## Development

This repository is intentionally scaffold-only. Application behavior, product
features, API routes, persistence, authentication, and synchronization logic have
not been implemented yet.

### Client Shell

```sh
npm run dev
```

Starts the Vite development server and launches the Electron desktop shell
against it.

```sh
npm run build
npm start
```

Builds the production renderer and Electron main/preload files, then launches
the built desktop shell.

```sh
npm run dev --workspace @syncorswim/server
```

Starts the local WebSocket server on `ws://localhost:3001` by default. Set
`PORT` to override the port.

To test the server-hosted streaming milestone, start the server:

```sh
npm run dev --workspace @syncorswim/server
```

Create a room and register a dev-only local media path with a WebSocket client.
The current development protocol message is:

```json
{
  "type": "room:media-register",
  "filePath": "/absolute/path/to/video.mp4",
  "durationSeconds": null
}
```

After registration, test the HTTP media endpoint with the created room id:

```sh
curl -I http://localhost:3001/media/<roomId>
curl -v -H "Range: bytes=0-1023" http://localhost:3001/media/<roomId> -o /tmp/syncorswim-sample.bin
curl -v -H "Range: bytes=999999999999-" http://localhost:3001/media/<roomId>
```

Valid range requests should return `206 Partial Content` with `Content-Range`,
`Accept-Ranges`, `Content-Length`, and `Content-Type` headers. Invalid ranges
should return `416`. Rooms without registered media return a clear `404`.

```sh
npm run smoke:electron
```

Runs a headless Electron build verification without launching a desktop window.
It compiles shared code, Electron main/preload code, the Vite renderer, and the
server, then checks that expected build artifacts were created.
