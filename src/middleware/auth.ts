import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';

const SESSION_COOKIE = 'teleflix_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  username?: string;
  provider: 'firebase' | 'telegram';
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

interface TelegramSession extends AuthenticatedUser {
  provider: 'telegram';
  exp: number;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  }
  return secret;
}

function signSessionPayload(payload: string): string {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

export function createTelegramSessionCookie(user: Omit<TelegramSession, 'exp' | 'provider'>): string {
  const session: TelegramSession = {
    ...user,
    provider: 'telegram',
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = signSessionPayload(payload);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${payload}.${signature}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearTelegramSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

export function getRequestCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export function getTelegramSessionUser(req: Request): AuthenticatedUser | null {
  const token = getRequestCookie(req, SESSION_COOKIE);
  if (!token) return null;

  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;

    const expected = Buffer.from(signSessionPayload(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TelegramSession;
    if (
      session.provider !== 'telegram' ||
      typeof session.uid !== 'string' ||
      typeof session.exp !== 'number' ||
      session.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      uid: session.uid,
      name: session.name,
      picture: session.picture,
      username: session.username,
      provider: 'telegram',
    };
  } catch {
    return null;
  }
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decodedToken: DecodedIdToken = await adminAuth.verifyIdToken(authHeader.slice(7));
      req.user = { ...decodedToken, provider: 'firebase' };
      return next();
    } catch (error) {
      console.error('Error verifying Firebase ID token:', error);
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  }

  const telegramUser = getTelegramSessionUser(req);
  if (telegramUser) {
    req.user = telegramUser;
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized: Missing or invalid session' });
};
