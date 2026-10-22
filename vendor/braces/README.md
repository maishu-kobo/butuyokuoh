# braces 3.0.4 (local)

This is [braces](https://github.com/micromatch/braces) 3.0.3 with the nesting-depth guard from the unmerged pull request [micromatch/braces#79](https://github.com/micromatch/braces/pull/79).

npm still publishes 3.0.3 as the latest release, and [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) covers every version `<=3.0.3`. `eslint-config-next@16.4.2` depends on `fast-glob@3.3.1`, which depends on `micromatch`, which depends on `braces`. Downgrading `eslint-config-next` to 14.2.35 is the only fix `npm audit` offers, and that would drop the Next.js 16 lint rules.

The guard caps brace and parenthesis nesting at 256. Patterns the linter actually uses stay expanded the same way. Deeper patterns become literal text instead of overflowing the stack.

Delete this directory and the `braces` override once upstream publishes a fixed release.
