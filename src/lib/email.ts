// メールアドレスの正規化と形式検証の共通ユーティリティ
// register / login の両 API で同じ正規化・検証を適用するためここに集約する

// 簡易かつ堅実な形式チェック:
// 空白を含まないローカル部 @ 空白を含まないドメイン部（ドットを1つ以上含む）
// 区切りを文字列検索で検査し、長い不正入力でもバックトラックしない。

// 前後の空白を除去し、小文字に統一する
// 表記ゆれ（Foo@Example.com / foo@example.com）による重複登録・ログイン失敗を防ぐ
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// 正規化済みのメールアドレスが妥当な形式かを判定する
export function isValidEmail(email: string): boolean {
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  // ドットの両側に1文字以上必要。連続ドットも従来どおり扱う。
  const dot = domain.indexOf('.', 1);
  return dot > 0 && dot < domain.length - 1;
}
