import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { getDb } from './db';
import { auth } from '@/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'butuyokuoh-secret-key-change-in-production';
const TOKEN_COOKIE_NAME = 'butuyokuoh_token';

export interface User {
  id: number;
  email: string;
  name: string | null;
  created_at: string;
}

export interface JWTPayload {
  userId: number;
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(user: User): string {
  return jwt.sign(
    { userId: user.id, email: user.email } as JWTPayload,
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<User | null> {
  // First check NextAuth session
  try {
    const session = await auth();
    if (session?.user?.id) {
      const db = getDb();
      const user = db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').get(Number(session.user.id)) as User | undefined;
      if (user) return user;
    }
  } catch (e) {
    // NextAuth not available, continue to legacy auth
  }

  // Fallback to legacy cookie-based auth
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE_NAME)?.value;
  
  if (!token) return null;
  
  const payload = verifyToken(token);
  if (!payload) return null;
  
  const db = getDb();
  const user = db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').get(payload.userId) as User | undefined;
  
  return user || null;
}

export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: '/',
  });
}

export async function clearAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(TOKEN_COOKIE_NAME);
}

export function getUserIdFromToken(token: string): number | null {
  const payload = verifyToken(token);
  return payload?.userId || null;
}
