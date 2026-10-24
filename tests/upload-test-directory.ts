// node:test の各ファイルは別プロセス。アップロードを触るテスト同士で保存先を共有しない。
// アプリのモジュールが process.cwd() を読む前に、このファイルを import する。
import { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalDirectory = process.cwd();
const directory = mkdtempSync(join(tmpdir(), 'butuyokuoh-upload-test-'));
process.chdir(directory);

after(() => {
  process.chdir(originalDirectory);
  rmSync(directory, { recursive: true, force: true });
});
