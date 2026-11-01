// 運営者名・連絡先。空のままだと tests/legal-pages.test.ts が落ちる。
export const OPERATOR_NAME = '物欲王 運営チーム';
export const CONTACT_EMAIL = 'sota+butuyokuoh@mail.grokbot.com';

export const FOREIGN_PRIVACY_SYSTEMS_URL =
  'https://www.ppc.go.jp/personalinfo/legal/kaiseihogohou/#gaikoku';

export const GOOGLE_PRIVACY_POLICY_URL = 'https://policies.google.com/privacy';
export const CLOUDFLARE_PRIVACY_POLICY_URL = 'https://www.cloudflare.com/privacypolicy/';

/** 初回の制定日（表示用）。改定しても変えない。 */
export const LEGAL_ENACTED_DATE = '2026年10月30日';

/** 最新の改定日。文面を変えたらここを更新する。 */
export const LEGAL_REVISED_DATE = '2026年10月31日';

/** 現行の効力発生日（最新の改定日と同じ）。 */
export const LEGAL_EFFECTIVE_DATE = LEGAL_REVISED_DATE;
