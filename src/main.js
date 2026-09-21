'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const { readConfig, saveConfig } = require('./config');
const oauth = require('./oauth');
const youtube = require('./platforms/youtube');
const tiktok = require('./platforms/tiktok');
const telegram = require('./platforms/telegram');

function createWindow() {
  const win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#10131a',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

function safeView(config) {
  const manual = credentials => (credentials.refreshToken ? '' : credentials.accessToken || '');
  return {
    youtube: {
      clientId: config.youtube.clientId,
      clientSecret: config.youtube.clientSecret,
      accessToken: manual(config.youtube),
      connected: Boolean(config.youtube.refreshToken),
      redirectUri: oauth.expectedRedirectUri('youtube')
    },
    tiktok: {
      clientKey: config.tiktok.clientKey,
      clientSecret: config.tiktok.clientSecret,
      accessToken: manual(config.tiktok),
      connected: Boolean(config.tiktok.refreshToken),
      redirectUri: oauth.expectedRedirectUri('tiktok')
    },
    telegram: { botToken: config.telegram.botToken, chats: config.telegram.chats }
  };
}

function applySettings(config, values) {
  config.youtube.clientId = values.youtube?.clientId || '';
  config.youtube.clientSecret = values.youtube?.clientSecret || '';
  config.tiktok.clientKey = values.tiktok?.clientKey || '';
  config.tiktok.clientSecret = values.tiktok?.clientSecret || '';
  config.telegram.botToken = values.telegram?.botToken || '';
  config.telegram.chats = values.telegram?.chats || '';

  for (const platform of ['youtube', 'tiktok']) {
    if (config[platform].refreshToken) continue;
    config[platform].accessToken = values[platform]?.accessToken || '';
    config[platform].expiresAt = 0;
  }
  return config;
}

async function assertReadable(filePath) {
  try { await fs.access(filePath); }
  catch { throw new Error('Выбранный файл больше недоступен — перевыберите ролик.'); }
}

ipcMain.handle('choose-video', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Видео', extensions: ['mp4', 'mov', 'm4v', 'webm', 'avi'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('config:get', async () => safeView(await readConfig()));

ipcMain.handle('config:save', async (_event, values) => {
  const config = applySettings(await readConfig(), values);
  await saveConfig(config);
  return safeView(config);
});

ipcMain.handle('oauth:connect', async (_event, platform) => {
  const config = await readConfig();
  await oauth.connect(platform, config[platform]);
  await saveConfig(config);
  return safeView(config);
});

ipcMain.handle('oauth:disconnect', async (_event, platform) => {
  const config = await readConfig();
  Object.assign(config[platform], { refreshToken: '', accessToken: '', expiresAt: 0 });
  await saveConfig(config);
  return safeView(config);
});

let currentAbortController = null;

ipcMain.handle('publish:cancel', async () => {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    return true;
  }
  return false;
});

ipcMain.handle('publish', async (event, job) => {
  const config = await readConfig();
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  let queue = Promise.resolve();
  const persist = () => {
    queue = queue.then(() => saveConfig(config));
    return queue;
  };
  const report = platform => payload => {
    if (!event.sender.isDestroyed()) event.sender.send('publish:progress', { platform, ...payload });
  };

  const tasks = [];
  if (job.targets.youtube) {
    tasks.push({ id: 'youtube', run: async () => {
      await assertReadable(job.youtube.filePath);
      const token = await oauth.ensureAccessToken('youtube', config.youtube, persist);
      return youtube.publish(job.youtube, token, report('youtube'), signal);
    } });
  }
  if (job.targets.tiktok) {
    tasks.push({ id: 'tiktok', run: async () => {
      await assertReadable(job.tiktok.filePath);
      const token = await oauth.ensureAccessToken('tiktok', config.tiktok, persist);
      return tiktok.publish(job.tiktok, token, report('tiktok'), signal);
    } });
  }
  if (job.targets.telegram) {
    tasks.push({ id: 'telegram', run: async () => {
      if (job.telegram.filePath) await assertReadable(job.telegram.filePath);
      if (!config.telegram.botToken) throw new Error('В настройках нет токена Telegram-бота.');
      return telegram.publish(job.telegram, config.telegram.botToken, config.telegram.chats, report('telegram'), signal);
    } });
  }
  if (!tasks.length) throw new Error('Выберите хотя бы одну площадку.');

  let results;
  try {
    results = await Promise.all(tasks.map(async task => {
      try {
        return { id: task.id, ok: true, ...(await task.run()) };
      } catch (error) {
        const isAborted = signal.aborted || error.name === 'AbortError' || error.message?.includes('aborted');
        return { id: task.id, ok: false, message: isAborted ? 'Отменено пользователем' : error.message };
      }
    }));
  } finally {
    currentAbortController = null;
  }
  await queue.catch(() => {});
  return results;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
