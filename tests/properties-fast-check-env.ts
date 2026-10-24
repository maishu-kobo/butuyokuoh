// 特性テスト用。本番の DB も data/butuyokuoh.db も開かない。
// db.ts を読むどの import よりも先に読むこと。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'butuyokuoh-properties-'));
const dbPath = join(directory, 'app.sqlite');
const production = join(process.cwd(), 'data', 'butuyokuoh.db');

if (dbPath === production || dbPath.includes(`${join('data', 'butuyokuoh.db')}`)) {
  throw new Error('refusing to use the application database');
}

process.env.BUTUYOKUOH_DB_PATH = dbPath;
process.env.JWT_SECRET = 'property-only-jwt-secret';
process.env.AUTH_SECRET = 'property-only-auth-secret';
process.env.NEXTAUTH_SECRET = 'property-only-auth-secret';
delete process.env.GUEST_MODE_ENABLED;

export const propertyDbDirectory = directory;
export const propertyDbPath = dbPath;
