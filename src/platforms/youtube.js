'use strict';
const fs = require('node:fs/promises');
const { mimeFor, apiError, readChunk } = require('./shared');

const INIT_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const CHUNK_SIZE = 8 * 1024 * 1024;

async function openSession(job, token, size, mime, signal) {
  const payload = {
    snippet: {
      title: job.title,
      description: job.description,
      tags: job.tags || [],
      categoryId: job.categoryId || '22'
    },
    status: { privacyStatus: job.privacy || 'private', selfDeclaredMadeForKids: false }
  };
  const response = await fetch(INIT_URL, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': mime
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await apiError(response));
  const uploadUrl = response.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube не вернул URL для загрузки.');
  return uploadUrl;
}

async function publish(job, token, onProgress, signal) {
  const stat = await fs.stat(job.filePath);
  const total = stat.size;
  if (!total) throw new Error('Файл пустой.');

  const mime = mimeFor(job.filePath);
  const uploadUrl = await openSession(job, token, total, mime, signal);
  onProgress({ loaded: 0, total });

  const handle = await fs.open(job.filePath, 'r');
  let finished = null;
  try {
    let offset = 0;
    while (offset < total) {
      if (signal?.aborted) throw new Error('Отменено пользователем');
      const end = Math.min(offset + CHUNK_SIZE, total);
      const chunk = await readChunk(handle, offset, end - offset);
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        signal,
        redirect: 'manual',
        headers: { 'Content-Type': mime, 'Content-Range': `bytes ${offset}-${end - 1}/${total}` },
        body: chunk
      });

      if (response.status === 308) {
        const range = response.headers.get('range');
        const accepted = range ? Number(range.split('-').pop()) + 1 : end;
        if (!Number.isFinite(accepted) || accepted <= offset) {
          throw new Error('YouTube не принял очередной фрагмент файла. Попробуйте загрузить ролик заново.');
        }
        offset = accepted;
        onProgress({ loaded: offset, total });
        continue;
      }
      if (!response.ok) throw new Error(await apiError(response));
      finished = await response.json();
      onProgress({ loaded: total, total });
      break;
    }
  } finally {
    await handle.close();
  }

  if (!finished?.id) throw new Error('YouTube принял файл, но не вернул идентификатор видео.');
  return { message: 'Опубликовано', link: `https://youtu.be/${finished.id}` };
}

module.exports = { publish };
