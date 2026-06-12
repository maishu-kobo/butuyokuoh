import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

// 許可する拡張子と MIME タイプの対応表（svg は XSS 対策のため明示的に除外）
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  avif: ['image/avif'],
};

// 許可する MIME タイプの一覧
const ALLOWED_MIME_TYPES = new Set(
  Object.values(ALLOWED_EXTENSIONS).flat()
);

// 拡張子の正規パターン（英数字 1〜5 文字のみ。/ や .. や空文字を弾く）
const EXT_PATTERN = /^[a-z0-9]{1,5}$/;

/**
 * バッファの先頭バイト（マジックバイト）から実体が画像かを簡易判定する。
 * 拡張子・MIME 偽装（SVG/HTML を画像と偽る）への二重防御。
 * 戻り値: 判定できた拡張子（jpg/png/gif/webp/avif）または null
 */
function detectImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // GIF: "GIF87a" または "GIF89a"
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'gif';
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }

  // AVIF: 先頭 4 バイトは box size、続く "ftyp" の後にブランド "avif"/"avis"
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') {
      return 'avif';
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 });
    }

    // 拡張子をファイル名から取得し、サニタイズ・検証する
    // （/ や .. の混入によるパストラバーサル、許可外拡張子を弾く）
    const rawExt = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!EXT_PATTERN.test(rawExt) || !(rawExt in ALLOWED_EXTENSIONS)) {
      return NextResponse.json({ error: '対応していない画像形式です' }, { status: 400 });
    }

    // MIME タイプを許可リストでチェック（file.type はクライアント任意のため過信しない）
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json({ error: '対応していない画像形式です' }, { status: 400 });
    }

    // 拡張子と MIME の整合性を確認（例: .png なのに image/jpeg を弾く）
    if (!ALLOWED_EXTENSIONS[rawExt].includes(file.type)) {
      return NextResponse.json({ error: '対応していない画像形式です' }, { status: 400 });
    }

    // ファイルサイズチェック (5MB以下)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'ファイルサイズは5MB以下にしてください' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // マジックバイトで実体が画像かを検証（SVG/HTML 偽装を弾く三重目の防御）
    const detected = detectImageType(buffer);
    if (!detected) {
      return NextResponse.json({ error: '画像ファイルとして認識できません' }, { status: 400 });
    }

    // 検出した実体に基づいて拡張子を決定する。
    // jpg/jpeg は同一実体のため、宣言された拡張子を尊重しつつ実体と矛盾しないものを採用。
    const detectedSet = detected === 'jpg' ? ['jpg', 'jpeg'] : [detected];
    if (!detectedSet.includes(rawExt)) {
      return NextResponse.json({ error: '拡張子とファイルの内容が一致しません' }, { status: 400 });
    }
    // 保存に使う拡張子は検証済みのもののみ（ユーザー入力のファイル名本体は使わない）
    const ext = rawExt;

    // ユニークなファイル名をサーバ側で生成（ユーザー入力のファイル名本体は保存パスに使わない）
    const filename = `${user.id}_${Date.now()}.${ext}`;

    // アップロードディレクトリの確認/作成
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const filepath = path.join(uploadDir, filename);
    await writeFile(filepath, buffer);

    const imageUrl = `/uploads/${filename}`;
    return NextResponse.json({ url: imageUrl });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'アップロードに失敗しました' }, { status: 500 });
  }
}
