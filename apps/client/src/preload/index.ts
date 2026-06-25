import { contextBridge, ipcRenderer, webUtils } from 'electron';

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

type HashProgressMessage = HashProgress & {
  requestId: string;
};

type HashFileOptions = {
  onProgress?: (progress: HashProgress) => void;
};

type SyncorswimApi = {
  cancelHash: (requestId: string) => Promise<void>;
  hashFile: (requestId: string, file: File, options?: HashFileOptions) => Promise<HashFileResult>;
};

const api: SyncorswimApi = {
  cancelHash: async (requestId) => {
    await ipcRenderer.invoke('hash-file:cancel', requestId);
  },
  hashFile: async (requestId, file, options) => {
    const filePath = webUtils.getPathForFile(file);

    if (!filePath) {
      return {
        message: 'Unable to resolve a local path for the selected file.',
        status: 'error'
      };
    }

    const handleProgress = (
      _event: Electron.IpcRendererEvent,
      message: HashProgressMessage
    ): void => {
      if (message.requestId !== requestId) {
        return;
      }

      options?.onProgress?.({
        bytesRead: message.bytesRead,
        percent: message.percent,
        totalBytes: message.totalBytes
      });
    };

    ipcRenderer.on('hash-file:progress', handleProgress);

    try {
      return (await ipcRenderer.invoke('hash-file:start', {
        filePath,
        requestId
      })) as HashFileResult;
    } finally {
      ipcRenderer.off('hash-file:progress', handleProgress);
    }
  }
};

contextBridge.exposeInMainWorld('syncorswim', api);
