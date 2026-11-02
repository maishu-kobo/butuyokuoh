import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
// Resolve the copy actually used by the TypeScript parser, not a root-level copy.
const parserRequire = createRequire(require.resolve('@typescript-eslint/typescript-estree'));
const { Minimatch, minimatch } = parserRequire('minimatch');

test('the parser matcher dependency bounds level-2 parent-pattern expansion', () => {
  // GHSA-g3hv-75wg-m249: **/../ can amplify preprocessing even without braces.
  // A small fixed input reproduces the missing limit without exhausting memory.
  const limit = 32;
  const matcher = new Minimatch('**/../a/b/'.repeat(8) + 'target.ts', {
    optimizationLevel: 2,
    braceExpandMax: limit,
  });
  assert.ok(matcher.set.length <= limit, `expanded to ${matcher.set.length} alternatives`);
});

test('the TypeScript parser matcher keeps allowDefaultProject matching behavior', () => {
  // These are the function and options used by typescript-estree's project service.
  for (const [file, pattern, expected] of [
    ['example.ts', '*.ts', true],
    ['.config.ts', '*.ts', true],
    ['example.js', '*.ts', false],
    ['src/example.ts', '*.ts', false],
    ['src/example.ts', 'src/*.ts', true],
    ['example.tsx', '*.{ts,tsx}', true],
  ] as const) {
    assert.equal(minimatch(file, pattern, { dot: true }), expected, `${file}: ${pattern}`);
  }
});

test('existing import and accessibility rules still execute legacy glob APIs', async () => {
  const eslint = new ESLint({
    overrideConfig: [{
      rules: {
        'import/no-internal-modules': ['error', { forbid: ['private/**'] }],
        'jsx-a11y/control-has-associated-label': ['error', { controlComponents: ['ButtonIcon'] }],
      },
    }],
  });
  const [result] = await eslint.lintText(
    "import 'private/secret'; export default function Example() { return <ButtonIcon />; }",
    { filePath: 'src/lint-dependency-probe.tsx' },
  );
  assert.equal(result.fatalErrorCount, 0);
  assert.ok(result.messages.some(message => message.ruleId === 'import/no-internal-modules'));
  assert.ok(result.messages.some(message => message.ruleId === 'jsx-a11y/control-has-associated-label'));
});
