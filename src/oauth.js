'use strict';
const { BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');

const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

const PROVIDERS = {
  youtube: {
    label: 'YouTube',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
    idField: 'clientId',
    idParam: 'client_id',
    port: 0,
    redirectPath: '',
    authParams: { access_type: 'offline', prompt: 'consent select_account' }
  },
  tiktok: {
    label: 'TikTok',
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scope: 'video.publish',
    idField: 'clientKey',
    idParam: 'client_key',
    port: 8723,
    redirectPath: '/callback',
    authParams: {}
  }
};

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function redirectUri(provider, port) {
  return `http://127.0.0.1:${port}${provider.redirectPath}`;
}

function expectedRedirectUri(platform) {
  const provider = PROVIDERS[platform];
  if (!provider) return '';
  return provider.port ? redirectUri(provider, provider.port) : `http://127.0.0.1:<порт>${provider.redirectPath}`;
}

const DONE_PAGE = [
  '<!doctype html><meta charset="utf-8"><title>AutoUpload</title>',
  '<body style="font-family:system-ui;background:#10131a;color:#f4f7fb;display:grid;place-items:center;height:100vh;margin:0">',
  '<div style="text-align:center"><h2>Готово</h2><p>Аккаунт подключён. Можно вернуться в AutoUpload.</p></div>'
].join('');

function startCallbackServer(provider, state) {
  return new Promise((resolve, reject) => {
    let settle;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (provider.redirectPath && url.pathname !== provider.redirectPath) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE);
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error) settle(new Error(`${provider.label} отказал в доступе: ${error}`));
      else if (url.searchParams.get('state') !== state) settle(new Error('Не совпал параметр state — авторизация отклонена.'));
      else if (!code) settle(new Error('Сервис не вернул код авторизации.'));
      else settle(null, code);
    });

    server.on('error', reject);
    server.listen(provider.port, '127.0.0.1', () => {
      const port = server.address().port;
      const waiter = new Promise((done, fail) => {
        settle = (error, code) => (error ? fail(error) : done(code));
      });
      resolve({ port, waiter, close: () => server.close(), fail: error => settle(error) });
    });
  });
}

function openAuthWindow(url, onClosed) {
  const win = new BrowserWindow({
    width: 540,
    height: 720,
    autoHideMenuBar: true,
    title: 'Подключение аккаунта',
    backgroundColor: '#10131a',
    webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:autoupload-oauth' }
  });
  win.on('closed', onClosed);
  win.loadURL(url);
  return win;
}

async function tokenRequest(provider, params) {
  let response;
  try {
    response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params)
    });
  } catch (error) {
    throw new Error(`Не удалось связаться с ${provider.label}: ${error.message}`);
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(text || response.statusText); }
  const failure = data.error_description || data.error?.message || (typeof data.error === 'string' ? data.error : '');
  if (!response.ok || failure) throw new Error(failure || `${provider.label} ответил ошибкой ${response.status}.`);
  return data;
}

function applyTokens(credentials, data) {
  credentials.accessToken = data.access_token || '';
  credentials.expiresAt = data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : 0;
  if (data.refresh_token) credentials.refreshToken = data.refresh_token;
}

function requireClient(provider, credentials) {
  const clientId = credentials[provider.idField];
  if (!clientId || !credentials.clientSecret) {
    throw new Error(`Укажите Client ID и Client secret для ${provider.label} в настройках.`);
  }
  return clientId;
}

async function connect(platform, credentials) {
  const provider = PROVIDERS[platform];
  if (!provider) throw new Error(`Неизвестная площадка: ${platform}`);
  const clientId = requireClient(provider, credentials);

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const server = await startCallbackServer(provider, state);
  const uri = redirectUri(provider, server.port);
  const authUrl = new URL(provider.authUrl);
  authUrl.search = new URLSearchParams({
    [provider.idParam]: clientId,
    redirect_uri: uri,
    response_type: 'code',
    scope: provider.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...provider.authParams
  }).toString();

  let closedByUs = false;
  const timer = setTimeout(() => server.fail(new Error('Время на авторизацию истекло.')), FLOW_TIMEOUT_MS);
  const win = openAuthWindow(authUrl.toString(), () => {
    if (!closedByUs) server.fail(new Error('Окно авторизации закрыто до завершения.'));
  });

  let code;
  try {
    code = await server.waiter;
  } finally {
    clearTimeout(timer);
    server.close();
    closedByUs = true;
    if (!win.isDestroyed()) win.close();
  }

  const data = await tokenRequest(provider, {
    [provider.idParam]: clientId,
    client_secret: credentials.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: uri,
    code_verifier: verifier
  });
  applyTokens(credentials, data);
  if (!credentials.refreshToken) {
    throw new Error(`${provider.label} не выдал refresh token. Отзовите доступ приложения в настройках аккаунта и подключитесь заново.`);
  }
  return credentials;
}

async function refresh(platform, credentials) {
  const provider = PROVIDERS[platform];
  const clientId = requireClient(provider, credentials);
  const data = await tokenRequest(provider, {
    [provider.idParam]: clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken
  });
  applyTokens(credentials, data);
  return credentials;
}

async function ensureAccessToken(platform, credentials, persist) {
  const provider = PROVIDERS[platform];
  const stillFresh = credentials.expiresAt && credentials.expiresAt - Date.now() > EXPIRY_MARGIN_MS;
  if (credentials.accessToken && stillFresh) return credentials.accessToken;

  if (credentials.refreshToken) {
    await refresh(platform, credentials);
    await persist();
    return credentials.accessToken;
  }
  if (credentials.accessToken) return credentials.accessToken;
  throw new Error(`Аккаунт ${provider.label} не подключён. Откройте настройки и нажмите «Подключить».`);
}

module.exports = { connect, refresh, ensureAccessToken, expectedRedirectUri, PROVIDERS };
