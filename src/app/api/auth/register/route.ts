import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hashPassword, generateToken, setAuthCookie, User } from '@/lib/auth';
import { normalizeEmail, isValidEmail } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    // 型チェック: email / password は文字列のみ受け付ける（数値・配列・オブジェクト等は拒否）
    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'メールアドレスとパスワードは文字列で指定してください' },
        { status: 400 }
      );
    }

    // 正規化: trim + 小文字化（表記ゆれによる重複登録を防ぐ）
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
      return NextResponse.json(
        { error: 'メールアドレスとパスワードは必須です' },
        { status: 400 }
      );
    }

    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json(
        { error: 'メールアドレスの形式が正しくありません' },
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
    // 既存DBには大文字混じりで保存された行が残っている可能性があるため LOWER 比較で照合する
    // 万一正規化マイグレーションで衝突回避のため残った重複行があっても、ORDER BY id で挙動を決定的にする
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ? ORDER BY id LIMIT 1').get(normalizedEmail);
    if (existing) {
      return NextResponse.json(
        { error: 'このメールアドレスは既に登録されています' },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);

    // 保存は正規化後のメールアドレスで行う
    const result = db.prepare(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
    ).run(normalizedEmail, passwordHash, typeof name === 'string' && name ? name : null);

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
