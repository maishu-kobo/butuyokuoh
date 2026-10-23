// 写真から登録のAPIの形。画面とサーバーが同じ型を使う。
// 登録の保存は候補の表ができてから（#90、#96）。ここではリクエストの形だけを確かめる。
import { accessoryScore, preferMainProduct } from './accessory';
import { canonicalCandidateImageUrl } from './image-hosts';

export const CAPTURE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export const CaptureMessages = {
  onePhoto: '写真は1枚だけ選べます',
  photoUnreadable: 'この写真は読めません',
  photoTooLarge: '写真は5MBまでです',
  searchInput: '商品名を入れて探してください',
  searchFailed: '候補を取得できませんでした。もう一度試すか、商品名を入れて登録してください',
  searchUnconfigured: 'ストア検索のキーが未設定のため候補を出せません。商品名を確認して登録してください',
  aiFailed: '写真から商品を判定できませんでした。商品名を入れて探してください',
  aiRetryable: '写真の判定に失敗しました。もう一度試すか、商品名を入れてください',
  aiTimeout: '写真からの判定が時間内に終わりませんでした。商品名を入れて探してください',
  registerInput: '登録する候補を確認してください',
} as const;

export type CaptureSite = 'yahoo' | 'rakuten';

export type CaptureMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export type CaptureErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_ORIGIN'
  | 'UNSUPPORTED_MEDIA'
  | 'PHOTO_TOO_LARGE'
  | 'PHOTO_UNREADABLE'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_INVALID_RESPONSE'
  | 'AI_LIMIT'
  | 'SEARCH_FAILED'
  | 'SEARCH_NOT_CONFIGURED'
  | 'SEARCH_TIMEOUT'
  | 'NO_CANDIDATES'
  | 'CANDIDATE_NOT_FOUND'
  | 'ALREADY_REGISTERED';

export interface SiteFailure {
  site: CaptureSite;
  code: CaptureErrorCode;
  error: string;
}

export interface CaptureErrorBody {
  code: CaptureErrorCode;
  error: string;
  failures?: SiteFailure[];
  retryable?: boolean;
}

export type CaptureResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CaptureErrorBody; status: number };

export interface CaptureCandidate {
  id: string;
  site: CaptureSite;
  title: string;
  price: number;
  url: string;
  fetchedAt: string;
  shopName: string;
  jan?: string;
  imageUrl?: string;
}

export interface ProductGuess {
  name: string;
  brand: string | null;
  model: string | null;
  jan: string | null;
}

export type IdentifyConfidence = 'sure' | 'unsure' | 'unreadable';

export interface IdentifyResponse {
  confidence: IdentifyConfidence;
  products: ProductGuess[];
}

export interface IdentifyInput {
  mediaType: string;
  bytes: Uint8Array;
}

export interface SearchQuery {
  name: string;
  brand: string | null;
  model: string | null;
  jan: string | null;
}

export interface SearchResponse {
  candidates: CaptureCandidate[];
  amazonUrl: string;
  failures: SiteFailure[];
}

export interface RegisterRequest {
  candidateIds: string[];
}

export interface RegisterResponse {
  comparisonGroupId: number | null;
  itemIds: number[];
}

export interface ProductIdentifier {
  identify(input: IdentifyInput): Promise<CaptureResult<IdentifyResponse>>;
}

export interface SiteSearch {
  search(query: SearchQuery): Promise<CaptureResult<CaptureCandidate[]>>;
}

export interface CapturePorts {
  identifier: ProductIdentifier;
  yahoo: SiteSearch;
  rakuten: SiteSearch;
}

export function captureFailure(code: CaptureErrorCode, error: string, status: number, failures?: SiteFailure[]): CaptureResult<never> {
  return { ok: false, error: failures ? { code, error, failures } : { code, error }, status };
}

export function isValidJan(value: string): boolean {
  if (!/^\d{8}$|^\d{13}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const check = digits.pop();
  const weights = digits.length === 12
    ? [1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3]
    : [3, 1, 3, 1, 3, 1, 3];
  const sum = digits.reduce((total, digit, index) => total + digit * weights[index], 0);
  return (10 - (sum % 10)) % 10 === check;
}

const CANDIDATE_ID = /^(yahoo|rakuten):[a-z0-9-]{1,64}$/;
const ASSOCIATE_TAG = /^[A-Za-z0-9-]{1,64}$/;
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'heif', 'mif1', 'msf1']);

export function parseSearchQuery(input: unknown): CaptureResult<SearchQuery> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return captureFailure('INVALID_INPUT', CaptureMessages.searchInput, 400);
  }
  const body = input as Record<string, unknown>;
  if (body.name !== undefined && typeof body.name !== 'string') {
    return captureFailure('INVALID_INPUT', CaptureMessages.searchInput, 400);
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length > 200) return captureFailure('INVALID_INPUT', CaptureMessages.searchInput, 400);

  let jan: string | null = null;
  if (body.jan !== undefined && body.jan !== null && body.jan !== '') {
    if (typeof body.jan !== 'string') return captureFailure('INVALID_INPUT', CaptureMessages.searchInput, 400);
    const trimmed = body.jan.trim();
    if (trimmed && isValidJan(trimmed)) jan = trimmed;
  }

  const brand = optionalLabel(body.brand);
  if (typeof brand !== 'string' && brand !== null) return brand;
  const model = optionalLabel(body.model);
  if (typeof model !== 'string' && model !== null) return model;
  if (!name && !jan) return captureFailure('INVALID_INPUT', CaptureMessages.searchInput, 400);
  return { ok: true, value: { name, brand, model, jan } };
}

function optionalLabel(value: unknown): string | null | CaptureResult<never> {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return captureFailure('INVALID_INPUT', CaptureMessages.searchInput, 400);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 80) return captureFailure('INVALID_INPUT', CaptureMessages.searchInput, 400);
  return trimmed;
}

export function parseRegisterRequest(input: unknown): CaptureResult<RegisterRequest> {
  const invalid = captureFailure('INVALID_INPUT', CaptureMessages.registerInput, 400);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid;
  const ids = (input as { candidateIds?: unknown }).candidateIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 20) return invalid;
  if (ids.some(id => typeof id !== 'string' || !CANDIDATE_ID.test(id))) return invalid;
  if (new Set(ids).size !== ids.length) return invalid;
  return { ok: true, value: { candidateIds: [...ids] } };
}

export function amazonSearchUrl(query: { name: string; jan?: string | null }, associateTag?: string | null): string {
  const keyword = query.jan && isValidJan(query.jan) ? query.jan : query.name.trim();
  const url = new URL('https://www.amazon.co.jp/s');
  url.searchParams.set('k', keyword);
  if (associateTag && ASSOCIATE_TAG.test(associateTag)) url.searchParams.set('tag', associateTag);
  return url.toString();
}

export function isAllowedCandidateUrl(site: CaptureSite, url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    const hosts = site === 'yahoo'
      ? ['shopping.yahoo.co.jp', 'store.shopping.yahoo.co.jp']
      : ['item.rakuten.co.jp'];
    return hosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function sortCandidates(candidates: CaptureCandidate[], query: SearchQuery): CaptureCandidate[] {
  const name = query.name.toLocaleLowerCase('ja-JP');
  const prefer = preferMainProduct(query, query.jan != null && isValidJan(query.jan));
  const rank = (item: CaptureCandidate) => ({
    jan: query.jan && item.jan === query.jan ? 0 : 1,
    accessory: prefer ? accessoryScore(item.title) : 0,
    named: name && item.title.toLocaleLowerCase('ja-JP').includes(name) ? 0 : 1,
  });
  return [...candidates].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    return left.jan - right.jan
      || left.accessory - right.accessory
      || left.named - right.named
      || a.price - b.price
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

export function decodeCapturePhoto(parts: { mediaType: string; bytes: Uint8Array }[]): CaptureResult<{ mediaType: CaptureMediaType; bytes: Uint8Array }> {
  if (parts.length !== 1) return captureFailure('INVALID_INPUT', CaptureMessages.onePhoto, 400);
  const part = parts[0];
  if (part.bytes.byteLength > CAPTURE_PHOTO_MAX_BYTES) {
    return captureFailure('PHOTO_TOO_LARGE', CaptureMessages.photoTooLarge, 413);
  }
  const declared = part.mediaType.split(';')[0].trim().toLowerCase();
  const sniffed = sniffImage(part.bytes);
  if (declared === 'image/heic' || declared === 'image/heif' || declared === 'image/heic-sequence' || declared === 'image/heif-sequence' || sniffed === 'heif') {
    return captureFailure('UNSUPPORTED_MEDIA', CaptureMessages.photoUnreadable, 415);
  }
  if (sniffed === 'image/jpeg' || sniffed === 'image/png' || sniffed === 'image/webp') {
    return { ok: true, value: { mediaType: sniffed, bytes: part.bytes } };
  }
  return captureFailure('PHOTO_UNREADABLE', CaptureMessages.photoUnreadable, 400);
}

export function sniffImage(bytes: Uint8Array): CaptureMediaType | 'heif' | null {
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 12))) return 'heif';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let text = '';
  for (let index = start; index < end && index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

export function acceptCandidate(item: CaptureCandidate): CaptureCandidate | null {
  if (item.site !== 'yahoo' && item.site !== 'rakuten') return null;
  if (typeof item.id !== 'string' || !CANDIDATE_ID.test(item.id) || !item.id.startsWith(`${item.site}:`)) return null;
  if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200) return null;
  if (typeof item.shopName !== 'string' || !item.shopName.trim() || item.shopName.length > 80) return null;
  if (!Number.isSafeInteger(item.price) || item.price < 0) return null;
  if (typeof item.fetchedAt !== 'string' || Number.isNaN(Date.parse(item.fetchedAt))) return null;
  if (item.jan !== undefined && !isValidJan(item.jan)) return null;
  if (!isAllowedCandidateUrl(item.site, item.url)) return null;
  const accepted: CaptureCandidate = {
    id: item.id,
    site: item.site,
    title: item.title,
    price: item.price,
    url: item.url,
    fetchedAt: item.fetchedAt,
    shopName: item.shopName,
  };
  if (item.jan) accepted.jan = item.jan;
  if (typeof item.imageUrl === 'string') {
    const image = canonicalCandidateImageUrl(item.site, item.imageUrl);
    if (image) accepted.imageUrl = image;
  }
  return accepted;
}
