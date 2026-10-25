import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'butuyokuoh-register-body-'));
const dbPath = join(directory, 'app.sqlite');
if (dbPath.includes(join('data', 'butuyokuoh.db'))) {
  throw new Error('refusing to use the application database');
}
process.env.BUTUYOKUOH_DB_PATH = dbPath;
process.env.JWT_SECRET = 'register-body-test-only';
