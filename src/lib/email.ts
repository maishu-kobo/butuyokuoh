// メールアドレスの正規化と形式検証の共通ユーティリティ
// register / login の両 API で同じ正規化・検証を適用するためここに集約する

// 簡易かつ堅実な形式チェック:
// 空白を含まないローカル部 @ 空白を含まないドメイン部（ドットを1つ以上含む）
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 前後の空白を除去し、小文字に統一する
// 表記ゆれ（Foo@Example.com / foo@example.com）による重複登録・ログイン失敗を防ぐ
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// 正規化済みのメールアドレスが妥当な形式かを判定する
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}
