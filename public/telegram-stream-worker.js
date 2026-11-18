const STREAM_PATH = '/__amzy_telegram_stream__/';
const MAX_CHUNK_SIZE = 1024 * 1024;
const streamQueues = new Map();
const streamOwners = new Map();

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'amzy-telegram-claim-clients') {
    event.waitUntil(self.clients.claim());
  } else if (event.data?.type === 'amzy-telegram-register-stream' && event.data.token && event.source?.id) {
    streamOwners.set(event.data.token, event.source.id);
  } else if (event.data?.type === 'amzy-telegram-close-stream' && event.data.token) {
    streamOwners.delete(event.data.token);
    streamQueues.delete(event.data.token);
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(STREAM_PATH)) return;
  event.respondWith(serveTelegramVideo(event));
});

async function serveTelegramVideo(event) {
  const url = new URL(event.request.url);
  const token = decodeURIComponent(url.pathname.slice(STREAM_PATH.length));
  const size = Number(url.searchParams.get('size'));
  const mimeType = allowedVideoMimeType(url.searchParams.get('mime'));
  if (!token || !Number.isSafeInteger(size) || size <= 0) {
    return new Response('Invalid Telegram stream reference.', { status: 400 });
  }
  if (event.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: streamHeaders(mimeType) });
  }
  if (event.request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...streamHeaders(mimeType), 'Content-Length': String(size) },
    });
  }
  if (event.request.method !== 'GET') {
    return new Response('Method not allowed.', { status: 405 });
  }

  const range = event.request.headers.get('range');
  if (range) {
    const parsed = parseRange(range, size);
    if (!parsed) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
      });
    }
    const end = Math.min(parsed.end, parsed.start + MAX_CHUNK_SIZE - 1);
    try {
      const data = await requestRange(event, token, parsed.start, end - parsed.start + 1);
      const bytes = decodeBase64(data);
      if (bytes.byteLength === 0) throw new Error('Telegram returned an empty video segment.');
      const actualEnd = parsed.start + bytes.byteLength - 1;
      return new Response(bytes, {
        status: 206,
        headers: {
          ...streamHeaders(mimeType),
          'Content-Length': String(bytes.byteLength),
          'Content-Range': `bytes ${parsed.start}-${actualEnd}/${size}`,
        },
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'Could not load Telegram video data.', { status: 502 });
    }
  }

  let offset = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (offset >= size) {
        controller.close();
        return;
      }
      try {
        const length = Math.min(MAX_CHUNK_SIZE, size - offset);
        const data = await requestRange(event, token, offset, length);
        const bytes = decodeBase64(data);
        if (bytes.byteLength === 0) throw new Error('Telegram returned an empty video segment.');
        offset += bytes.byteLength;
        controller.enqueue(bytes);
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: { ...streamHeaders(mimeType), 'Content-Length': String(size) },
  });
}

async function requestRange(event, token, offset, length) {
  const previous = streamQueues.get(token) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => requestRangeFromApp(event, token, offset, length));
  streamQueues.set(token, current);
  try {
    return await current;
  } finally {
    if (streamQueues.get(token) === current) streamQueues.delete(token);
  }
}

async function requestRangeFromApp(event, token, offset, length) {
  const clientId = streamOwners.get(token) || event.clientId;
  const client = clientId ? await self.clients.get(clientId) : null;
  if (!client) throw new Error('AMZY player is no longer available.');

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error('Telegram stream timed out. Check your connection and try again.'));
    }, 30000);
    channel.port1.onmessage = (messageEvent) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (messageEvent.data?.error) {
        reject(new Error(messageEvent.data.error));
      } else if (typeof messageEvent.data?.data === 'string') {
        resolve(messageEvent.data.data);
      } else {
        reject(new Error('Telegram returned an invalid video segment.'));
      }
    };
    client.postMessage({
      type: 'amzy-telegram-stream-read',
      token,
      offset,
      length,
    }, [channel.port2]);
  });
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function streamHeaders(mimeType) {
  return {
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeType,
    'Access-Control-Allow-Origin': self.location.origin,
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

function allowedVideoMimeType(value) {
  const mimeType = (value || '').split(';', 1)[0].trim().toLowerCase();
  return new Set([
    'video/mp4',
    'video/webm',
    'video/x-matroska',
    'video/quicktime',
    'video/3gpp',
    'video/x-msvideo',
  ]).has(mimeType) ? mimeType : 'video/mp4';
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
