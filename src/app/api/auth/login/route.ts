import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyPassword, generateToken, setAuthCookie, User } from '@/lib/auth';
import { normalizeEmail, isValidEmail } from '@/lib/email';

interface DbUser extends User {
  password_hash: string;
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    // 型チェック: email / password は文字列のみ受け付ける（数値・配列・オブジェクト等は拒否）
    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'メールアドレスとパスワードは文字列で指定してください' },
        { status: 400 }
      );
    }

    // 正規化: trim + 小文字化（register と同じ正規化を適用し、表記ゆれでもログイン可能にする）
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
      return NextResponse.json(
        { error: 'メールアドレスとパスワードを入力してください' },
        { status: 400 }
      );
    }

    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json(
        { error: 'メールアドレスの形式が正しくありません' },
        { status: 400 }
      );
    }

    const db = getDb();
    // 既存DBには大文字混じりで保存された行が残っている可能性があるため LOWER 比較で照合する
    const dbUser = db.prepare(
      'SELECT id, email, name, password_hash, created_at FROM users WHERE LOWER(email) = ?'
    ).get(normalizedEmail) as DbUser | undefined;

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
