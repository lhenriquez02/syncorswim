import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HashFileError, hashFile } from './hashFile.js';

type HashFileRequest = {
  filePath: string;
  requestId: string;
};

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFile);
const rendererUrl = process.env.SYNCORSWIM_RENDERER_URL;

const preloadPath = join(currentDirectory, '../preload/index.js');
const rendererIndexPath = join(currentDirectory, '../renderer/index.html');
const activeHashRequests = new Map<string, AbortController>();

const isHashFileRequest = (value: unknown): value is HashFileRequest => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'filePath' in value &&
    'requestId' in value &&
    typeof value.filePath === 'string' &&
    typeof value.requestId === 'string'
  );
};

ipcMain.handle('hash-file:start', async (event, value: unknown) => {
  if (!isHashFileRequest(value)) {
    return {
      message: 'Invalid hash request.',
      status: 'error'
    };
  }

  const abortController = new AbortController();
  activeHashRequests.set(value.requestId, abortController);

  try {
    const result = await hashFile(value.filePath, {
      signal: abortController.signal,
      onProgress: (progress) => {
        event.sender.send('hash-file:progress', {
          ...progress,
          requestId: value.requestId
        });
      }
    });

    return {
      hash: result.hash,
      size: result.size,
      status: 'complete'
    };
  } catch (error) {
    const message =
      error instanceof HashFileError
        ? error.message
        : 'An unexpected error occurred while hashing the file.';

    return {
      message,
      status: 'error'
    };
  } finally {
    activeHashRequests.delete(value.requestId);
  }
});

ipcMain.handle('hash-file:cancel', (_event, requestId: unknown) => {
  if (typeof requestId !== 'string') {
    return;
  }

  activeHashRequests.get(requestId)?.abort();
  activeHashRequests.delete(requestId);
});

const createMainWindow = (): void => {
  const mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#f7f8fa',
    height: 720,
    minHeight: 560,
    minWidth: 860,
    show: false,
    title: 'syncorswim',
    width: 1080,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  void mainWindow.loadFile(rendererIndexPath);
};

app.name = 'syncorswim';

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [mainWindow] = BrowserWindow.getAllWindows();

    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
