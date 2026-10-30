// 選んだ variant だけがこの文を足す。既定の指示文は変えない。
// 見本の固有名詞は書かない。写すと商品名として捨てられる。

export const EVIDENCE_BRAND_RULES = [
  'ブランドは、写真に見える根拠があるときだけ書く。',
  '読めるブランドの文字は、ロゴでなくても必ず根拠になる。瓶、文字盤、ラベル、メダル、箱に印刷された文字を読めたら、そのブランドを書く。',
  '根拠は、その読めた文字、または金具・形・足床のようにそのブランドだと分かる見た目。',
  '見えていないブランドは空にする。推測で見えないブランドを足さない。',
  '印刷されていない数字の世代や型番は書かない。自信があっても、読めた文字に無い数字は外す。',
  '数字を外してもシリーズと種類は残す。ブランド名だけにしない。靴は靴、バッグはバッグ、服は服のまま。',
].join('');

export const WORKERS_EVIDENCE_SUFFIX = `${EVIDENCE_BRAND_RULES}根拠は各productのvisibleTextに短く書く。根拠が無ければvisibleTextは空文字。nameに種類を残す。`;

export const GEMINI_EVIDENCE_SUFFIX = `${EVIDENCE_BRAND_RULES}根拠はevidenceに短く書く。根拠が無ければevidenceは空文字。productNameとcategoryに種類を残す。`;
