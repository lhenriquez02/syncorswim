import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export type HashProgress = {
  bytesRead: number;
  percent: number;
  totalBytes: number;
};

export type HashFileResult = {
  hash: string;
  size: number;
};

export type HashFileOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: HashProgress) => void;
};

export class HashFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HashFileError';
  }
}

export const hashFile = async (
  filePath: string,
  { onProgress, signal }: HashFileOptions = {}
): Promise<HashFileResult> => {
  if (filePath.trim().length === 0) {
    throw new HashFileError('No file path was provided for hashing.');
  }

  const fileStats = await stat(filePath).catch((error: unknown) => {
    throw new HashFileError(
      'Unable to read the selected file. It may have moved or been deleted.',
      {
        cause: error
      }
    );
  });

  if (!fileStats.isFile()) {
    throw new HashFileError('The selected path is not a regular file.');
  }

  const totalBytes = fileStats.size;
  let bytesRead = 0;
  const hash = createHash('sha256');
  const stream = createReadStream(filePath, {
    highWaterMark: 1024 * 1024,
    signal
  });

  onProgress?.({
    bytesRead,
    percent: totalBytes === 0 ? 100 : 0,
    totalBytes
  });

  return await new Promise<HashFileResult>((resolve, reject) => {
    stream.on('data', (chunk: string | Buffer) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesRead += buffer.byteLength;
      hash.update(buffer);

      onProgress?.({
        bytesRead,
        percent: totalBytes === 0 ? 100 : Math.min(100, (bytesRead / totalBytes) * 100),
        totalBytes
      });
    });

    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.name === 'AbortError') {
        reject(new HashFileError('File hashing was cancelled.', { cause: error }));
        return;
      }

      if (error.code === 'EACCES' || error.code === 'EPERM') {
        reject(
          new HashFileError('Permission was denied while reading the selected file.', {
            cause: error
          })
        );
        return;
      }

      reject(new HashFileError('Unable to hash the selected file.', { cause: error }));
    });

    stream.on('end', () => {
      onProgress?.({
        bytesRead: totalBytes,
        percent: 100,
        totalBytes
      });

      resolve({
        hash: hash.digest('hex'),
        size: totalBytes
      });
    });
  });
};
