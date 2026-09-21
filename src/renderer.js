const $ = id => document.getElementById(id);
const { t, getLang, setLang, getFlagSvg } = window.i18n;

const PLATFORMS = ['youtube', 'tiktok', 'telegram'];
const platformNames = { youtube: 'YouTube', tiktok: 'TikTok', telegram: 'Telegram' };
let selectedVideo = null;

function textValue(id) { return $(id).value.trim(); }
function setStatus(value, tone = '') { const node = $('statusText'); node.textContent = value; node.className = tone; }
function syncPlatformCard(platform) { document.querySelector(`[data-platform="${platform}"]`).classList.toggle('is-disabled', !$(`${platform}Enabled`).checked); }
function megabytes(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)} МБ`; }

function updateUI() {
  const currentLang = getLang();
  document.documentElement.lang = currentLang;
  $('currentFlag').innerHTML = getFlagSvg(currentLang);

  $('flagPreviewRu').innerHTML = getFlagSvg('ru');
  $('flagPreviewEn').innerHTML = getFlagSvg('en');
  $('flagPreviewZh').innerHTML = getFlagSvg('zh');

  document.querySelectorAll('.lang-option').forEach(btn => {
    btn.classList.toggle('is-active', btn.getAttribute('data-lang') === currentLang);
  });

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });

  if (!selectedVideo) {
    $('videoName').textContent = t('no_video_selected');
  }

  $('youtubeFormatHint').textContent = $('youtubeFormat').value === 'short'
    ? t('youtube_hint_short')
    : t('youtube_hint_video');
}

function getJob() {
  return {
    targets: { youtube: $('youtubeEnabled').checked, tiktok: $('tiktokEnabled').checked, telegram: $('telegramEnabled').checked },
    youtube: {
      filePath: selectedVideo,
      title: textValue('youtubeTitle'),
      description: textValue('youtubeDescription'),
      tags: textValue('youtubeTags').split(',').map(tag => tag.trim()).filter(Boolean),
      privacy: $('youtubePrivacy').value,
      format: $('youtubeFormat').value
    },
    tiktok: { filePath: selectedVideo, description: textValue('tiktokDescription'), privacy: $('tiktokPrivacy').value },
    telegram: { filePath: selectedVideo, description: textValue('telegramDescription') }
  };
}

function validate(job) {
  if (!Object.values(job.targets).some(Boolean)) return t('validation_no_platform');
  if (!selectedVideo && (job.targets.youtube || job.targets.tiktok)) return t('validation_no_video');
  if (job.targets.youtube && !job.youtube.title) return t('validation_no_youtube_title');
  if (job.targets.tiktok && !job.tiktok.description) return t('validation_no_tiktok_desc');
  if (job.targets.telegram && !selectedVideo && !job.telegram.description) return t('validation_no_telegram_text');
  return null;
}

async function chooseVideo() {
  const filePath = await window.publisher.chooseVideo();
  if (!filePath) return;
  selectedVideo = filePath;
  const filename = filePath.split(/[\\/]/).pop();
  $('videoName').textContent = filename;

  const info = $('videoInfo');
  info.replaceChildren();
  const icon = document.createElement('span');
  icon.className = 'video-icon';
  icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/></svg>';
  const name = document.createElement('strong');
  name.textContent = filename;
  const note = document.createElement('small');
  note.textContent = t('video_ready_note');
  const box = document.createElement('div');
  box.append(name, note);
  info.append(icon, box);
  info.classList.remove('hidden');
  setStatus(t('video_chosen_status'), 'ready');
}

function resetProgress() {
  for (const platform of PLATFORMS) {
    const node = $(`${platform}Progress`);
    node.classList.add('hidden');
    node.querySelector('.progress-track span').style.width = '0%';
    node.querySelector('small').textContent = '';
  }
}

function showProgress({ platform, loaded, total, unit }) {
  const node = $(`${platform}Progress`);
  if (!node) return;
  node.classList.remove('hidden');
  const percent = total ? Math.round((loaded / total) * 100) : 0;
  node.querySelector('.progress-track span').style.width = `${percent}%`;
  node.querySelector('small').textContent = unit === 'channels'
    ? t('progress_channels', { loaded, total })
    : `${percent}% · ${megabytes(loaded)} ${t('progress_of')} ${megabytes(total)}`;
}

function translateResult(text) {
  if (!text) return '';
  if (text === 'Опубликовано') return t('published_badge');
  if (text === 'Отменено пользователем') return t('cancelled_by_user');
  if (text === 'отправлено') return t('sent_badge');
  return text;
}

function renderResults(results) {
  const box = $('results');
  box.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = t('publish_results_heading');
  box.append(heading);

  for (const result of results) {
    const card = document.createElement('article');
    card.className = `result ${result.ok ? 'success' : 'error'}`;

    const badge = document.createElement('span');
    badge.textContent = result.ok ? '✓' : '!';

    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = platformNames[result.id];
    const message = document.createElement('p');
    message.textContent = translateResult(result.message);
    body.append(title, message);

    if (result.link) {
      const link = document.createElement('a');
      link.href = result.link;
      link.textContent = result.link;
      body.append(link);
    }
    if (result.details?.length) {
      const list = document.createElement('ul');
      list.className = 'result-details';
      for (const detail of result.details) {
        const item = document.createElement('li');
        item.className = detail.ok ? 'ok' : 'failed';
        item.textContent = `${detail.target} — ${translateResult(detail.message)}`;
        list.append(item);
      }
      body.append(list);
    }

    card.append(badge, body);
    box.append(card);
  }
  box.classList.remove('hidden');
}

async function cancelPublish() {
  const button = $('cancelButton');
  button.disabled = true;
  setStatus(t('cancelling_status'));
  try {
    await window.publisher.cancelPublish();
  } catch {}
}

async function publish() {
  const job = getJob();
  const problem = validate(job);
  if (problem) { setStatus(problem, 'error-text'); return; }

  $('publishButton').disabled = true;
  $('cancelButton').disabled = false;
  $('cancelButton').classList.remove('hidden');
  $('results').classList.add('hidden');
  resetProgress();
  setStatus(t('publishing_status'));
  try {
    const results = await window.publisher.publish(job);
    renderResults(results);
    const failed = results.filter(item => !item.ok).length;
    setStatus(failed ? t('publish_done_errors', { count: failed }) : t('publish_done_success'), failed ? 'error-text' : 'ready');
  } catch (error) {
    setStatus(error.message || t('publish_failed'), 'error-text');
  } finally {
    $('publishButton').disabled = false;
    $('cancelButton').classList.add('hidden');
    $('cancelButton').disabled = false;
  }
}

function showSettingsError(message) {
  const node = $('settingsError');
  node.textContent = message;
  node.classList.toggle('hidden', !message);
}

function applyConfig(config) {
  $('youtubeClientId').value = config.youtube.clientId || '';
  $('youtubeClientSecret').value = config.youtube.clientSecret || '';
  $('youtubeToken').value = config.youtube.accessToken || '';
  $('tiktokClientKey').value = config.tiktok.clientKey || '';
  $('tiktokClientSecret').value = config.tiktok.clientSecret || '';
  $('tiktokToken').value = config.tiktok.accessToken || '';
  $('tiktokRedirect').textContent = config.tiktok.redirectUri || '';
  $('telegramBotToken').value = config.telegram.botToken || '';
  $('telegramChats').value = config.telegram.chats || '';

  for (const platform of ['youtube', 'tiktok']) {
    const connected = config[platform].connected;
    const status = $(`${platform}Status`);
    status.textContent = connected ? t('status_connected') : t('status_not_connected');
    status.classList.toggle('is-connected', connected);
    $(`${platform}Connect`).textContent = connected ? t('reconnect_account') : t('connect_account');
    $(`${platform}Disconnect`).classList.toggle('hidden', !connected);
  }
}

function collectSettings() {
  return {
    youtube: { clientId: textValue('youtubeClientId'), clientSecret: textValue('youtubeClientSecret'), accessToken: textValue('youtubeToken') },
    tiktok: { clientKey: textValue('tiktokClientKey'), clientSecret: textValue('tiktokClientSecret'), accessToken: textValue('tiktokToken') },
    telegram: { botToken: textValue('telegramBotToken'), chats: $('telegramChats').value.trim() }
  };
}

async function openSettings() {
  showSettingsError('');
  applyConfig(await window.publisher.getConfig());
  $('settingsDialog').showModal();
}

async function saveSettings(event) {
  event.preventDefault();
  await window.publisher.saveConfig(collectSettings());
  $('settingsDialog').close();
  setStatus(t('settings_saved'), 'ready');
}

async function connectPlatform(platform) {
  const button = $(`${platform}Connect`);
  button.disabled = true;
  showSettingsError('');
  try {
    await window.publisher.saveConfig(collectSettings());
    applyConfig(await window.publisher.connect(platform));
  } catch (error) {
    showSettingsError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function disconnectPlatform(platform) {
  showSettingsError('');
  try { applyConfig(await window.publisher.disconnect(platform)); }
  catch (error) { showSettingsError(error.message); }
}

const langPicker = $('langPicker');
const langButton = $('langButton');
const langMenu = $('langMenu');

langButton.addEventListener('click', event => {
  event.stopPropagation();
  const isOpen = !langMenu.classList.contains('hidden');
  langMenu.classList.toggle('hidden', isOpen);
  langPicker.classList.toggle('is-open', !isOpen);
});

document.querySelectorAll('.lang-option').forEach(option => {
  option.addEventListener('click', () => {
    const lang = option.getAttribute('data-lang');
    setLang(lang);
    updateUI();
    langMenu.classList.add('hidden');
    langPicker.classList.remove('is-open');
  });
});

document.addEventListener('click', event => {
  if (!langPicker.contains(event.target)) {
    langMenu.classList.add('hidden');
    langPicker.classList.remove('is-open');
  }
});

$('chooseVideo').addEventListener('click', chooseVideo);
$('publishButton').addEventListener('click', publish);
$('cancelButton').addEventListener('click', cancelPublish);
$('settingsButton').addEventListener('click', openSettings);
$('saveSettings').addEventListener('click', saveSettings);
for (const platform of ['youtube', 'tiktok']) {
  $(`${platform}Connect`).addEventListener('click', () => connectPlatform(platform));
  $(`${platform}Disconnect`).addEventListener('click', () => disconnectPlatform(platform));
}
PLATFORMS.forEach(platform => $(`${platform}Enabled`).addEventListener('change', () => syncPlatformCard(platform)));
$('youtubeFormat').addEventListener('change', () => {
  $('youtubeFormatHint').textContent = $('youtubeFormat').value === 'short'
    ? t('youtube_hint_short')
    : t('youtube_hint_video');
});

window.publisher.onProgress(showProgress);
updateUI();
