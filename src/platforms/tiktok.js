'use strict';
const fs = require('node:fs/promises');
const { mimeFor, apiError, readChunk } = require('./shared');

const CREATOR_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
const INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';

const DEFAULT_CHUNK = 10 * 1024 * 1024;
const MAX_CHUNK = 64 * 1024 * 1024;
const MAX_CHUNKS = 1000;

function planChunks(size) {
  let chunkSize = Math.min(DEFAULT_CHUNK, size);
  if (Math.floor(size / chunkSize) > MAX_CHUNKS) {
    chunkSize = Math.min(MAX_CHUNK, Math.ceil(size / MAX_CHUNKS));
  }
  return { chunkSize, count: Math.max(1, Math.floor(size / chunkSize)) };
}

async function readCreatorInfo(token, signal) {
  const response = await fetch(CREATOR_URL, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' }
  });
  if (!response.ok) throw new Error(await apiError(response));
  const info = await response.json();
  if (info.error?.code && info.error.code !== 'ok') {
    throw new Error(info.error.message || 'Не удалось прочитать настройки аккаунта TikTok.');
  }
  return info;
}

async function publish(job, token, onProgress, signal) {
  const stat = await fs.stat(job.filePath);
  const total = stat.size;
  if (!total) throw new Error('Файл пустой.');

  const creatorInfo = await readCreatorInfo(token, signal);
  const allowedPrivacy = creatorInfo.data?.privacy_level_options || [];
  if (!allowedPrivacy.includes(job.privacy)) {
    throw new Error('Выбранный уровень видимости недоступен для этого TikTok-аккаунта.');
  }

  const { chunkSize, count } = planChunks(total);
  const response = await fetch(INIT_URL, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: job.description,
        privacy_level: job.privacy || 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: total,
        chunk_size: chunkSize,
        total_chunk_count: count
      }
    })
  });
  if (!response.ok) throw new Error(await apiError(response));
  const created = await response.json();
  const uploadUrl = created.data?.upload_url;
  if (!uploadUrl) throw new Error(created.error?.message || 'TikTok не вернул URL для загрузки.');

  const mime = mimeFor(job.filePath);
  onProgress({ loaded: 0, total });

  const handle = await fs.open(job.filePath, 'r');
  try {
    for (let index = 0; index < count; index += 1) {
      if (signal?.aborted) throw new Error('Отменено пользователем');
      const start = index * chunkSize;
      const end = index === count - 1 ? total : start + chunkSize;
      const chunk = await readChunk(handle, start, end - start);
      const sent = await fetch(uploadUrl, {
        method: 'PUT',
        signal,
        headers: { 'Content-Type': mime, 'Content-Range': `bytes ${start}-${end - 1}/${total}` },
        body: chunk
      });
      if (!sent.ok) throw new Error(await apiError(sent));
      onProgress({ loaded: end, total });
    }
  } finally {
    await handle.close();
  }

  return { message: 'Отправлено в TikTok', link: null };
}

module.exports = { publish, planChunks };
