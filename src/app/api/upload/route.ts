import { randomBytes } from 'node:crypto';
import { withAccess } from '@/lib/api-access';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import sharp from 'sharp';
import { rememberMemberUpload } from '@/lib/delete-member-account';

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

// ファイル自体は 5MB まで。multipart の境界分だけ本文の上限を広げる。
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 8 * 1024;
const FILE_TOO_LARGE = 'ファイルサイズは5MB以下にしてください';

function contentLengthOverLimit(header: string | null): boolean {
  if (header === null) return false;
  const value = header.trim();
  if (!value) return false;
  if (!/^\d+$/.test(value)) return true;
  const length = Number(value);
  return !Number.isSafeInteger(length) || length > MAX_BODY_BYTES;
}

// 上限を超えたチャンクの時点で読み取りをやめる。超えた分は保持しない。
async function readBoundedBody(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        chunks.length = 0;
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// 向きを画素に焼き、EXIF と GPS と末尾の注記を残さない。GIF はフレームを保つ。
async function withoutLocation(buffer: Buffer, ext: string): Promise<Buffer | null> {
  const format = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext;
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp' && format !== 'gif' && format !== 'avif') {
    return null;
  }
  try {
    // 位置情報を落とすために画素へ戻す。極端に大きい画像はここで止める。
    const image = sharp(buffer, {
      animated: format === 'gif',
      failOn: 'none',
      limitInputPixels: 80_000_000,
    });
    const pipeline = format === 'gif' ? image : image.rotate();
    if (format === 'jpeg') return await pipeline.jpeg().toBuffer();
    if (format === 'png') return await pipeline.png().toBuffer();
    if (format === 'webp') return await pipeline.webp().toBuffer();
    if (format === 'gif') return await pipeline.gif().toBuffer();
    return await pipeline.avif().toBuffer();
  } catch {
    return null;
  }
}

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

async function handlePOST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  try {
    if (contentLengthOverLimit(request.headers.get('content-length'))) {
      await request.body?.cancel().catch(() => undefined);
      return NextResponse.json({ error: FILE_TOO_LARGE }, { status: 400 });
    }

    const bounded = await readBoundedBody(request.body, MAX_BODY_BYTES);
    if (!bounded) {
      return NextResponse.json({ error: FILE_TOO_LARGE }, { status: 400 });
    }

    const contentType = request.headers.get('content-type') || '';
    let formData: FormData;
    try {
      const copy = new Uint8Array(bounded.byteLength);
      copy.set(bounded);
      formData = await new Response(copy, {
        headers: { 'content-type': contentType },
      }).formData();
    } catch {
      return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 });
    }
    const entry = formData.get('file');
    if (!entry || typeof entry === 'string') {
      return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 });
    }
    const file = entry;

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
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: FILE_TOO_LARGE }, { status: 400 });
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
    const stored = await withoutLocation(buffer, ext);
    if (!stored) {
      return NextResponse.json({ error: '画像ファイルとして認識できません' }, { status: 400 });
    }

    // ユーザー ID と時刻からは推測できない名前にする。元のファイル名は使わない。
    const filename = `${randomBytes(32).toString('hex')}.${ext}`;

    // アップロードディレクトリの確認/作成
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const filepath = path.join(uploadDir, filename);
    await writeFile(filepath, stored);
    try {
      rememberMemberUpload(user.id, filename);
    } catch (error) {
      await unlink(filepath).catch(() => undefined);
      throw error;
    }

    const imageUrl = `/uploads/${filename}`;
    return NextResponse.json({ url: imageUrl });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'アップロードに失敗しました' }, { status: 500 });
  }
}

export const POST = withAccess(handlePOST, false);
