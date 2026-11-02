# UI revision screenshot fonts

These two WOFF2 files are fixed Google Fonts subsets of Noto Sans JP and Noto Serif JP, obtained on 2026-10-30 solely to render Japanese screenshot fixtures on the CI runner.

- Source: https://fonts.googleapis.com/css2 (Noto Sans JP / Noto Serif JP, weights 400 and 700; text subset from the two prototype files).
- Licenses: OFL-NotoSansJP.txt and OFL-NotoSerifJP.txt.
- Family sources: https://github.com/google/fonts/tree/main/ofl/notosansjp and https://github.com/google/fonts/tree/main/ofl/notoserifjp.
- Both weights returned identical WOFF2 bytes per family; the CSS retains the provider's face definitions.
- ui-revision-font.ts reads these bytes locally and injects data URLs. Tests do not call Google Fonts.
- No application dependency, external font request, or production CSS change is introduced by these fixtures.
