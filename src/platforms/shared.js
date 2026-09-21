'use strict';
const path = require('node:path');

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo'
};

function mimeFor(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'video/mp4';
}

async function apiError(response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data.error?.message || data.error_description || data.message || data.description || text;
  } catch {
    return text || response.statusText;
  }
}

async function readChunk(handle, offset, size) {
  const buffer = Buffer.allocUnsafe(size);
  let filled = 0;
  while (filled < size) {
    const { bytesRead } = await handle.read(buffer, filled, size - filled, offset + filled);
    if (bytesRead === 0) throw new Error('Файл закончился раньше, чем ожидалось — возможно, его изменили во время загрузки.');
    filled += bytesRead;
  }
  return buffer;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
  return `${Math.round(bytes / 1024 / 1024)} МБ`;
}

module.exports = { mimeFor, apiError, readChunk, formatSize };
