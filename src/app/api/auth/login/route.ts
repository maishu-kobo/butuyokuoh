import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyPassword, generateToken, setAuthCookie, User } from '@/lib/auth';

interface DbUser extends User {
  password_hash: string;
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'メールアドレスとパスワードを入力してください' },
        { status: 400 }
      );
    }

    const db = getDb();
    const dbUser = db.prepare(
      'SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?'
    ).get(email) as DbUser | undefined;

    if (!dbUser) {
      return NextResponse.json(
        { error: 'メールアドレスまたはパスワードが正しくありません' },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, dbUser.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'メールアドレスまたはパスワードが正しくありません' },
        { status: 401 }
      );
    }

    const user: User = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      created_at: dbUser.created_at,
    };

    const token = generateToken(user);
    await setAuthCookie(token);

    return NextResponse.json({ user, token });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'ログインに失敗しました' },
      { status: 500 }
    );
  }
}
