type HashProgress = {
  bytesRead: number;
  percent: number;
  totalBytes: number;
};

type HashFileResult =
  | {
      hash: string;
      size: number;
      status: 'complete';
    }
  | {
      message: string;
      status: 'error';
    };

type SyncorswimApi = {
  cancelHash: (requestId: string) => Promise<void>;
  hashFile: (
    requestId: string,
    file: File,
    options?: {
      onProgress?: (progress: HashProgress) => void;
    }
  ) => Promise<HashFileResult>;
};

declare global {
  interface Window {
    syncorswim: SyncorswimApi;
  }
}

export {};
