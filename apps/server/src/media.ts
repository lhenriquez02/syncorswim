import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';

export type ByteRange =
  | {
      end: number;
      start: number;
      type: 'range';
    }
  | {
      type: 'invalid';
    }
  | {
      type: 'none';
    };

export type MediaRequestOptions = {
  getMediaPath: (roomId: string) => string | null;
};

const mediaRoutePattern = /^\/media\/([^/]+)$/;

export const parseByteRange = (rangeHeader: string | undefined, fileSize: number): ByteRange => {
  if (!rangeHeader) {
    return {
      type: 'none'
    };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  if (!match) {
    return {
      type: 'invalid'
    };
  }

  const rawStart = match[1];
  const rawEnd = match[2];

  if (rawStart === undefined || rawEnd === undefined) {
    return {
      type: 'invalid'
    };
  }

  if (rawStart === '' && rawEnd === '') {
    return {
      type: 'invalid'
    };
  }

  if (fileSize <= 0) {
    return {
      type: 'invalid'
    };
  }

  if (rawStart === '') {
    const suffixLength = Number.parseInt(rawEnd, 10);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return {
        type: 'invalid'
      };
    }

    return {
      end: fileSize - 1,
      start: Math.max(fileSize - suffixLength, 0),
      type: 'range'
    };
  }

  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd === '' ? fileSize - 1 : Number.parseInt(rawEnd, 10);

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return {
      type: 'invalid'
    };
  }

  return {
    end: Math.min(end, fileSize - 1),
    start,
    type: 'range'
  };
};

export const getContentType = (filePath: string): string => {
  const extension = extname(filePath).toLowerCase();

  if (extension === '.mp4' || extension === '.m4v') {
    return 'video/mp4';
  }

  if (extension === '.webm') {
    return 'video/webm';
  }

  if (extension === '.ogg' || extension === '.ogv') {
    return 'video/ogg';
  }

  if (extension === '.mov') {
    return 'video/quicktime';
  }

  if (extension === '.mkv') {
    return 'video/x-matroska';
  }

  return 'application/octet-stream';
};

const sendText = (response: ServerResponse, statusCode: number, message: string): void => {
  response.writeHead(statusCode, {
    'Content-Length': Buffer.byteLength(message),
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(message);
};

export const handleMediaRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  { getMediaPath }: MediaRequestOptions
): Promise<boolean> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const url = new URL(request.url ?? '/', 'http://localhost');
  const match = mediaRoutePattern.exec(url.pathname);

  if (!match) {
    return false;
  }

  const encodedRoomId = match[1];

  if (!encodedRoomId) {
    return false;
  }

  const roomId = decodeURIComponent(encodedRoomId);
  const mediaPath = getMediaPath(roomId);

  if (!mediaPath) {
    sendText(response, 404, 'No media is registered for this room.');
    return true;
  }

  const mediaStats = await stat(mediaPath).catch(() => null);

  if (!mediaStats?.isFile()) {
    sendText(response, 404, 'Configured media file was not found.');
    return true;
  }

  const fileSize = mediaStats.size;
  const contentType = getContentType(mediaPath);
  const byteRange = parseByteRange(request.headers.range, fileSize);

  if (byteRange.type === 'invalid') {
    response.writeHead(416, {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${fileSize}`,
      'Content-Length': 0,
      'Content-Type': contentType
    });
    response.end();
    return true;
  }

  if (byteRange.type === 'none') {
    response.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': fileSize,
      'Content-Type': contentType
    });

    if (request.method === 'HEAD') {
      response.end();
      return true;
    }

    createReadStream(mediaPath).pipe(response);
    return true;
  }

  const contentLength = byteRange.end - byteRange.start + 1;

  response.writeHead(206, {
    'Accept-Ranges': 'bytes',
    'Content-Length': contentLength,
    'Content-Range': `bytes ${byteRange.start}-${byteRange.end}/${fileSize}`,
    'Content-Type': contentType
  });

  if (request.method === 'HEAD') {
    response.end();
    return true;
  }

  createReadStream(mediaPath, {
    end: byteRange.end,
    start: byteRange.start
  }).pipe(response);
  return true;
};
