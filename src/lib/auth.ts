import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { createAuthSession, deleteExpiredAuthSessions } from './db.js';

const scryptAsync = promisify(scrypt);

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH).toString('hex');
    const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
    return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    const [salt, storedKey] = hash.split(':');
    if (!salt || !storedKey) return false;
    const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
    const stored = Buffer.from(storedKey, 'hex');
    if (key.length !== stored.length) return false;
    return timingSafeEqual(key, stored);
}

export function generateSessionToken(): string {
    return randomBytes(32).toString('hex');
}

export function sessionExpiresAt(): string {
    const d = new Date();
    d.setDate(d.getDate() + SESSION_DAYS);
    return d.toISOString();
}

export async function startSession(userId: number): Promise<string> {
    await deleteExpiredAuthSessions();
    const token = generateSessionToken();
    const expiresAt = sessionExpiresAt();
    await createAuthSession(token, userId, expiresAt);
    return token;
}
