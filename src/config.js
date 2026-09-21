'use strict';
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'autoupload-config.json');
const PREFIX = 'enc:';

const SECRET_PATHS = [
  'youtube.clientSecret', 'youtube.refreshToken', 'youtube.accessToken',
  'tiktok.clientSecret', 'tiktok.refreshToken', 'tiktok.accessToken',
  'telegram.botToken'
];

function blank() {
  return {
    youtube: { clientId: '', clientSecret: '', refreshToken: '', accessToken: '', expiresAt: 0 },
    tiktok: { clientKey: '', clientSecret: '', refreshToken: '', accessToken: '', expiresAt: 0 },
    telegram: { botToken: '', chats: '' }
  };
}

function readPath(target, dotted) {
  return dotted.split('.').reduce((node, key) => (node ? node[key] : undefined), target);
}
function writePath(target, dotted, value) {
  const keys = dotted.split('.');
  const last = keys.pop();
  const node = keys.reduce((acc, key) => (acc[key] = acc[key] || {}), target);
  node[last] = value;
}

function encrypt(value) {
  if (!value) return '';
  try {
    if (!safeStorage.isEncryptionAvailable()) return value;
    return PREFIX + safeStorage.encryptString(value).toString('base64');
  } catch { return value; }
}
function decrypt(value) {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;
  try { return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64')); }
  catch { return ''; }
}

function decryptLegacy(value) {
  if (!value) return '';
  try { return safeStorage.decryptString(Buffer.from(value, 'base64')); }
  catch { return value; }
}

function migrateLegacy(raw) {
  const config = blank();
  config.youtube.accessToken = decryptLegacy(raw.youtubeToken);
  config.tiktok.accessToken = decryptLegacy(raw.tiktokToken);
  config.telegram.botToken = decryptLegacy(raw.telegramBotToken);
  config.telegram.chats = raw.telegramChats || '';
  return config;
}

async function readConfig() {
  let raw;
  try { raw = JSON.parse(await fs.readFile(CONFIG_FILE(), 'utf8')); }
  catch { return blank(); }
  if (raw.version !== 2) return migrateLegacy(raw);

  const config = blank();
  for (const section of Object.keys(config)) Object.assign(config[section], raw[section] || {});
  for (const dotted of SECRET_PATHS) writePath(config, dotted, decrypt(readPath(config, dotted) || ''));
  return config;
}

async function saveConfig(config) {
  const onDisk = JSON.parse(JSON.stringify(config));
  for (const dotted of SECRET_PATHS) writePath(onDisk, dotted, encrypt(readPath(config, dotted) || ''));
  onDisk.version = 2;
  await fs.mkdir(path.dirname(CONFIG_FILE()), { recursive: true });
  await fs.writeFile(CONFIG_FILE(), JSON.stringify(onDisk, null, 2), 'utf8');
}

module.exports = { blank, readConfig, saveConfig };
