import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hashPassword, generateToken, setAuthCookie, User } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'メールアドレスとパスワードは必須です' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'パスワードは6文字以上で入力してください' },
        { status: 400 }
      );
    }

    const db = getDb();

    // メールアドレスの重複チェック
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return NextResponse.json(
        { error: 'このメールアドレスは既に登録されています' },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);

    const result = db.prepare(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
    ).run(email, passwordHash, name || null);

    const user = db.prepare(
      'SELECT id, email, name, created_at FROM users WHERE id = ?'
    ).get(result.lastInsertRowid) as User;

    const token = generateToken(user);
    await setAuthCookie(token);

    return NextResponse.json({ user, token });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { error: '登録に失敗しました' },
      { status: 500 }
    );
  }
}
