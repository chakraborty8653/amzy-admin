import { Capacitor } from '@capacitor/core';
import { TelegramNative } from './telegramNative';

export const TELEGRAM_SESSION_KEY = 'teleflix_telegram_session';
const BACKEND_REQUEST_TIMEOUT_MS = 20_000;
let cachedTelegramSessionToken: string | null | undefined;

const backendBaseUrl = import.meta.env.VITE_SUPABASE_FUNCTION_URL?.replace(/\/+$/, '');
const publicWebBaseUrl = 'https://amzy.chakrabortycompliance.in';
export const PUBLIC_PRIVACY_POLICY_URL = `${publicWebBaseUrl}/legal/privacy.html`;
export const PUBLIC_ACCOUNT_DELETION_URL = `${publicWebBaseUrl}/legal/delete-account.html`;

function readBrowserSessionToken(): string | null {
  try {
    return localStorage.getItem(TELEGRAM_SESSION_KEY)
      || sessionStorage.getItem(TELEGRAM_SESSION_KEY);
  } catch {
    return null;
  }
}

function removeBrowserSessionToken(): void {
  try {
    localStorage.removeItem(TELEGRAM_SESSION_KEY);
    sessionStorage.removeItem(TELEGRAM_SESSION_KEY);
  } catch {
    // Browser storage can be full or unavailable on this origin.
  }
}

export async function initializeTelegramSessionToken(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { token } = await TelegramNative.getCloudSessionToken();
      if (token) {
        cachedTelegramSessionToken = token;
        return token;
      }
      const legacyToken = readBrowserSessionToken();
      if (legacyToken) {
        await TelegramNative.setCloudSessionToken({ token: legacyToken });
        removeBrowserSessionToken();
        cachedTelegramSessionToken = legacyToken;
        return legacyToken;
      }
      cachedTelegramSessionToken = null;
      return null;
    } catch (error) {
      cachedTelegramSessionToken = readBrowserSessionToken();
      console.error('Could not restore the native cloud session token:', error);
      return cachedTelegramSessionToken;
    }
  }
  cachedTelegramSessionToken = readBrowserSessionToken();
  return cachedTelegramSessionToken;
}

export function getTelegramSessionToken(): string | null {
  if (cachedTelegramSessionToken !== undefined) return cachedTelegramSessionToken;
  const token = readBrowserSessionToken();
  let localToken: string | null = null;
  try {
    localToken = localStorage.getItem(TELEGRAM_SESSION_KEY);
  } catch {
    return token;
  }
  if (token && !localToken) {
    try {
      localStorage.setItem(TELEGRAM_SESSION_KEY, token);
      sessionStorage.removeItem(TELEGRAM_SESSION_KEY);
    } catch {
      return token;
    }
  }
  return token;
}

export async function setTelegramSessionToken(token: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await TelegramNative.setCloudSessionToken({ token });
    cachedTelegramSessionToken = token;
    removeBrowserSessionToken();
    return;
  }
  localStorage.setItem(TELEGRAM_SESSION_KEY, token);
  sessionStorage.removeItem(TELEGRAM_SESSION_KEY);
  cachedTelegramSessionToken = token;
}

export async function clearTelegramSessionToken(): Promise<void> {
  cachedTelegramSessionToken = null;
  if (Capacitor.isNativePlatform()) {
    await TelegramNative.clearCloudSessionToken();
  }
  removeBrowserSessionToken();
}

export function getBackendUrl(path: string): string {
  const baseUrl = backendBaseUrl || '/api';
  return `${baseUrl}/${path.replace(/^\/+/, '')}`;
}

async function fetchBackend(
  path: string,
  init: RequestInit,
  token: string | null,
  requestUrl = getBackendUrl(path),
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, BACKEND_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(init.signal?.reason);

  if (init.signal?.aborted) {
    abortFromCaller();
  } else {
    init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  try {
    return await fetch(requestUrl, { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error('Supabase request timed out. Check your internet connection and retry.', { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
}

function getAdminBackendUrl(path: string): string {
  const isLocalAdmin = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  const baseUrl = isLocalAdmin ? '/api' : backendBaseUrl || '/api';
  return `${baseUrl}/${path.replace(/^\/+/, '')}`;
}

export function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetchBackend(path, init, getTelegramSessionToken());
}

export function adminBackendFetch(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetchBackend(path, init, accessToken, getAdminBackendUrl(path));
}
