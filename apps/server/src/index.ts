import { createSyncorswimServer, parsePort } from './server.js';

const port = parsePort(process.env.PORT);
const server = createSyncorswimServer({
  port
});

server.httpServer.on('listening', () => {
  console.log(`syncorswim server listening on ws://localhost:${port}`);

  console.log('Register room media with a room:media-register WebSocket message.');
});

server.httpServer.on('error', (error) => {
  console.error('syncorswim WebSocket server error:', error);
  process.exitCode = 1;
});
