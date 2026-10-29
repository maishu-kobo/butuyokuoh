// 検索語は長い方から試す。0 件ならブランド欄を外し、次に型番欄を外す。
// 商品名に種類があるときは、その後で型番の語だけを外す。種類は残し、ブランド名だけにはしない。
// JAN があるときはそれだけを使う。
// 件数が 1 以上のとき、題にブランドが無くても取り直さない。
// 店の題はブランドを省くことが多く、取り直すと今の候補と回数を変えてしまう。
import { isValidJan, type SearchQuery } from './contract';
import { shorterQueryKeepingType } from './product-query';

function label(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

export function textQueryVariants(query: SearchQuery): SearchQuery[] {
  if (query.jan && isValidJan(query.jan)) return [query];
  const name = query.name.trim();
  const brand = label(query.brand);
  const model = label(query.model);
  // 3回目が時間予算の最後になる。型番が商品名に埋まっているときは、ここで種類を残して型番だけ外す。
  const shortened = shorterQueryKeepingType(name, model);
  const steps: SearchQuery[] = [
    { name, brand, model, jan: null },
    { name, brand: null, model, jan: null },
    { name: shortened ?? name, brand: null, model: null, jan: null },
  ];
  const seen = new Set<string>();
  const variants: SearchQuery[] = [];
  for (const step of steps) {
    if (!step.name) continue;
    const key = `${step.name}\0${step.brand ?? ''}\0${step.model ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(step);
  }
  return variants;
}
