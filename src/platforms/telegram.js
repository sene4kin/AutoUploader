'use strict';
const fs = require('node:fs/promises');
const { openAsBlob } = require('node:fs');
const path = require('node:path');
const { mimeFor, apiError, formatSize } = require('./shared');

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

function parseChats(raw) {
  return String(raw || '').split(/[\n,;]/).map(item => item.trim()).filter(Boolean);
}

async function sendToChat(chatId, token, job, blob, filename, signal) {
  let response;
  if (blob) {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', job.description);
    form.set('parse_mode', 'HTML');
    form.set('supports_streaming', 'true');
    form.set('video', blob, filename);
    response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: form, signal });
  } else {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: job.description })
    });
  }
  if (!response.ok) throw new Error(await apiError(response));
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || 'Ошибка Telegram.');
  return result;
}

async function publish(job, token, chats, onProgress, signal) {
  const targets = parseChats(chats);
  if (!targets.length) throw new Error('Добавьте хотя бы один ID или @username Telegram-канала в настройках.');
  if (!job.filePath && !job.description) throw new Error('Для текстовой публикации Telegram добавьте текст.');

  let blob = null;
  let filename = null;
  if (job.filePath) {
    const stat = await fs.stat(job.filePath);
    if (stat.size > MAX_VIDEO_BYTES) {
      throw new Error(`Telegram не принимает через ботов файлы больше 50 МБ, а этот — ${formatSize(stat.size)}. Сожмите ролик или опубликуйте его вручную.`);
    }
    blob = await openAsBlob(job.filePath, { type: mimeFor(job.filePath) });
    filename = path.basename(job.filePath);
  }

  onProgress({ loaded: 0, total: targets.length, unit: 'channels' });

  let done = 0;
  const outcomes = await Promise.allSettled(targets.map(async chatId => {
    if (signal?.aborted) throw new Error('Отменено пользователем');
    await sendToChat(chatId, token, job, blob, filename, signal);
    done += 1;
    onProgress({ loaded: done, total: targets.length, unit: 'channels' });
    return chatId;
  }));

  const details = outcomes.map((outcome, index) => ({
    target: targets[index],
    ok: outcome.status === 'fulfilled',
    message: outcome.status === 'fulfilled' ? 'отправлено' : outcome.reason.message
  }));
  const sent = details.filter(item => item.ok).length;
  const kind = blob ? 'Видео' : 'Текст';

  let message;
  if (signal?.aborted) message = 'Отменено пользователем';
  else if (!sent) message = `Не удалось отправить ни в один канал из ${targets.length}`;
  else if (sent === targets.length) message = `${kind} опубликован${blob ? 'о' : ''} во все каналы (${sent})`;
  else message = `${kind} доставлен${blob ? 'о' : ''} в ${sent} из ${targets.length} каналов`;

  return { ok: sent === targets.length, message, link: null, details };
}

module.exports = { publish, parseChats, MAX_VIDEO_BYTES };
