// 写真検索の評価ケース。モデルの生JSONは、ブランドだけが商品名になる報告と
// 種類が name 以外の欄に入る形を含む。画像の出典は sources.ts。
export interface EvalRawProduct {
  name: string;
  brand: string | null;
  model: string | null;
  productType?: string | null;
  color?: string | null;
  jan?: string | null;
}

export interface EvalCase {
  id: string;
  label: string;
  category: string;
  callout?: boolean;
  // 生の応答に種類の語が無い。コード側では種類を復元できない。
  typeAbsent?: boolean;
  raw: {
    confidence: 'sure' | 'unsure';
    products: [EvalRawProduct];
  };
  brandToken: string;
  groupTerms: string[];
  colorToken: string | null;
  modelToken: string | null;
  rightTerms: string[];
  wrongTerms: string[];
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'balenciaga-shoes',
    label: 'バレンシアガの靴',
    category: 'shoes',
    callout: true,
    raw: {
      confidence: 'sure',
      products: [{ name: 'バレンシアガ', brand: 'バレンシアガ', model: 'バレンシアガ', productType: 'スニーカー', color: 'ブラック', jan: null }],
    },
    brandToken: 'バレンシアガ',
    groupTerms: ['スニーカー', 'シューズ'],
    colorToken: 'ブラック',
    modelToken: null,
    rightTerms: ['スニーカー', 'シューズ', 'スニーカー トリプルS', 'シューズ メンズ', 'スニーカー 黒'],
    wrongTerms: ['ハンドバッグ', 'トートバッグ', 'ショルダーバッグ', '財布', 'リュック'],
  },
  {
    id: 'balenciaga-type-in-model',
    label: 'バレンシアガの靴（種類が型番欄）',
    category: 'shoes',
    callout: true,
    raw: {
      confidence: 'sure',
      products: [{ name: 'バレンシアガ', brand: 'バレンシアガ', model: 'スニーカー', jan: null }],
    },
    brandToken: 'バレンシアガ',
    groupTerms: ['スニーカー', 'シューズ'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['スニーカー', 'シューズ', 'スニーカー トリプルS', 'シューズ レディース', 'スニーカー ホワイト'],
    wrongTerms: ['ハンドバッグ', 'トートバッグ', 'ショルダーバッグ', '財布', 'リュック'],
  },
  {
    id: 'nike-sneakers',
    label: 'ナイキのスニーカー',
    category: 'shoes',
    raw: {
      confidence: 'sure',
      products: [{ name: 'ナイキ エアフォース', brand: 'ナイキ', model: 'エアフォース', productType: 'スニーカー', color: 'ホワイト', jan: null }],
    },
    brandToken: 'ナイキ',
    groupTerms: ['スニーカー', 'シューズ'],
    colorToken: 'ホワイト',
    modelToken: 'エアフォース',
    rightTerms: ['スニーカー', 'シューズ', 'エアフォース スニーカー', 'シューズ ホワイト', 'スニーカー メンズ'],
    wrongTerms: ['Tシャツ', 'キャップ', 'バッグ', 'ソックス', 'ジャケット'],
  },
  {
    id: 'converse-complete',
    label: 'コンバースのスニーカー（名前が足りている）',
    category: 'shoes',
    raw: {
      confidence: 'sure',
      products: [{ name: 'コンバース オールスター ブラック スニーカー', brand: 'コンバース', model: 'オールスター', productType: 'スニーカー', color: 'ブラック', jan: null }],
    },
    brandToken: 'コンバース',
    groupTerms: ['スニーカー', 'シューズ'],
    colorToken: 'ブラック',
    modelToken: 'オールスター',
    rightTerms: ['スニーカー', 'シューズ', 'オールスター スニーカー', 'スニーカー ブラック', 'シューズ ローカット'],
    wrongTerms: ['Tシャツ', 'キャップ', 'バッグ', 'ソックス', 'ジャケット'],
  },
  {
    id: 'regal-dress-shoes',
    label: 'リーガルの革靴',
    category: 'shoes',
    raw: {
      confidence: 'sure',
      products: [{ name: 'リーガル', brand: 'リーガル', model: 'リーガル', productType: '革靴', color: 'ブラウン', jan: null }],
    },
    brandToken: 'リーガル',
    groupTerms: ['革靴', 'シューズ'],
    colorToken: 'ブラウン',
    modelToken: null,
    rightTerms: ['革靴', 'シューズ', '革靴 ストレートチップ', 'シューズ ビジネス', '革靴 ブラウン'],
    wrongTerms: ['ハンドバッグ', '財布', 'Tシャツ', 'キャップ', 'ジャケット'],
  },
  {
    id: 'birkenstock-sandals',
    label: 'ビルケンシュトックのサンダル',
    category: 'shoes',
    raw: {
      confidence: 'sure',
      products: [{ name: 'ビルケンシュトック', brand: 'ビルケンシュトック', model: 'ビルケンシュトック', productType: 'サンダル', jan: null }],
    },
    brandToken: 'ビルケンシュトック',
    groupTerms: ['サンダル'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['サンダル', 'サンダル アリゾナ', 'サンダル ボストン', 'サンダル メンズ', 'サンダル レディース'],
    wrongTerms: ['ハンドバッグ', 'ソックス', 'Tシャツ', 'キャップ', 'ジャケット'],
  },
  {
    id: 'lv-handbag',
    label: 'ルイヴィトンのハンドバッグ',
    category: 'bags',
    raw: {
      confidence: 'sure',
      products: [{ name: 'ルイヴィトン', brand: 'ルイヴィトン', model: 'スピーディ', productType: 'ハンドバッグ', jan: null }],
    },
    brandToken: 'ルイヴィトン',
    groupTerms: ['ハンドバッグ', 'バッグ'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['ハンドバッグ', 'バッグ', 'ハンドバッグ スピーディ', 'バッグ モノグラム', 'ハンドバッグ レディース'],
    wrongTerms: ['スニーカー', '財布', 'Tシャツ', 'キャップ', '香水'],
  },
  {
    id: 'northface-backpack',
    label: 'ノースフェイスのリュック',
    category: 'bags',
    raw: {
      confidence: 'sure',
      products: [{ name: 'ノースフェイス', brand: 'ザ・ノース・フェイス', model: null, productType: 'リュック', color: 'ブラック', jan: null }],
    },
    brandToken: 'ノースフェイス',
    groupTerms: ['リュック', 'バックパック'],
    colorToken: 'ブラック',
    modelToken: null,
    rightTerms: ['リュック', 'バックパック', 'リュック ブラック', 'バックパック 30L', 'リュック メンズ'],
    wrongTerms: ['ジャケット', 'Tシャツ', 'キャップ', 'スニーカー', '財布'],
  },
  {
    id: 'muji-tote',
    label: '無印良品のトートバッグ',
    category: 'bags',
    raw: {
      confidence: 'sure',
      products: [{ name: '無印良品 トートバッグ', brand: '無印良品', model: null, productType: 'トートバッグ', jan: null }],
    },
    brandToken: '無印良品',
    groupTerms: ['トートバッグ', 'バッグ'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['トートバッグ', 'バッグ', 'トートバッグ A4', 'バッグ 帆布', 'トートバッグ 大'],
    wrongTerms: ['スニーカー', 'ボールペン', 'Tシャツ', 'ジャケット', 'マグカップ'],
  },
  {
    id: 'iphone',
    label: 'iPhone',
    category: 'electronics',
    raw: {
      confidence: 'sure',
      products: [{ name: 'iPhone', brand: 'Apple', model: '15', productType: 'スマートフォン', jan: null }],
    },
    brandToken: 'iPhone',
    groupTerms: ['スマートフォン', 'iPhone'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['スマートフォン', 'iPhone', 'iPhone 本体', 'スマートフォン 128GB', 'iPhone 15'],
    wrongTerms: ['ヘッドホン', 'カメラ', 'ノートパソコン', '腕時計', 'ハンドバッグ'],
  },
  {
    id: 'sony-headphones',
    label: 'ソニーのヘッドホン',
    category: 'electronics',
    raw: {
      confidence: 'sure',
      products: [{ name: 'ソニー', brand: 'ソニー', model: 'WH-1000XM5', productType: 'ヘッドホン', color: 'ブラック', jan: null }],
    },
    brandToken: 'ソニー',
    groupTerms: ['ヘッドホン', 'ヘッドフォン'],
    colorToken: 'ブラック',
    modelToken: null,
    rightTerms: ['ヘッドホン', 'ヘッドフォン', 'ヘッドホン ワイヤレス', 'ヘッドフォン ブラック', 'ヘッドホン オーバーイヤー'],
    wrongTerms: ['カメラ', '腕時計', 'スニーカー', 'ハンドバッグ', 'Tシャツ'],
  },
  {
    id: 'canon-camera',
    label: 'キヤノンのカメラ',
    category: 'electronics',
    raw: {
      confidence: 'sure',
      products: [{ name: 'キヤノン EOS R6 カメラ', brand: 'キヤノン', model: 'EOS R6', productType: 'カメラ', jan: null }],
    },
    brandToken: 'キヤノン',
    groupTerms: ['カメラ'],
    colorToken: null,
    modelToken: 'EOS R6',
    rightTerms: ['カメラ', 'カメラ ボディ', 'カメラ ミラーレス', 'カメラ 本体', 'カメラ フルサイズ'],
    wrongTerms: ['ヘッドホン', '腕時計', 'スニーカー', 'ハンドバッグ', 'Tシャツ'],
  },
  {
    id: 'macbook',
    label: 'MacBook',
    category: 'electronics',
    raw: {
      confidence: 'sure',
      products: [{ name: 'MacBook', brand: 'Apple', model: 'Pro', productType: 'ノートパソコン', jan: null }],
    },
    brandToken: 'MacBook',
    groupTerms: ['ノートパソコン', 'MacBook'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['ノートパソコン', 'MacBook', 'MacBook 本体', 'ノートパソコン 13インチ', 'MacBook Pro'],
    wrongTerms: ['カメラ', 'ヘッドホン', '腕時計', 'ハンドバッグ', 'Tシャツ'],
  },
  {
    id: 'dior-lipstick',
    label: 'ディオールの口紅',
    category: 'cosmetics',
    raw: {
      confidence: 'sure',
      products: [{ name: 'ディオール', brand: 'ディオール', model: '999', productType: '口紅', color: 'レッド', jan: null }],
    },
    brandToken: 'ディオール',
    groupTerms: ['口紅', 'リップ'],
    colorToken: 'レッド',
    modelToken: null,
    rightTerms: ['口紅', 'リップ', '口紅 レッド', 'リップ 999', '口紅 リフィル'],
    wrongTerms: ['香水', 'スニーカー', 'ハンドバッグ', 'Tシャツ', '腕時計'],
  },
  {
    id: 'chanel-perfume',
    label: 'シャネルの香水',
    category: 'cosmetics',
    raw: {
      confidence: 'sure',
      products: [{ name: 'シャネル', brand: 'シャネル', model: 'シャネル', productType: '香水', jan: null }],
    },
    brandToken: 'シャネル',
    groupTerms: ['香水', 'フレグランス'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['香水', 'フレグランス', '香水 50ml', 'フレグランス オードトワレ', '香水 本体'],
    wrongTerms: ['口紅', 'ハンドバッグ', 'スニーカー', '財布', 'Tシャツ'],
  },
  {
    id: 'uniqlo-shirt',
    label: 'ユニクロのTシャツ',
    category: 'apparel',
    raw: {
      confidence: 'sure',
      products: [{ name: 'ユニクロ', brand: 'ユニクロ', model: null, productType: 'Tシャツ', color: '白', jan: null }],
    },
    brandToken: 'ユニクロ',
    groupTerms: ['Tシャツ', 'シャツ'],
    colorToken: '白',
    modelToken: null,
    rightTerms: ['Tシャツ', 'シャツ', 'Tシャツ 白', 'シャツ クルーネック', 'Tシャツ メンズ'],
    wrongTerms: ['ジーンズ', 'スニーカー', 'ハンドバッグ', 'ソックス', 'ジャケット'],
  },
  {
    id: 'levis-jacket',
    label: 'リーバイスのジャケット',
    category: 'apparel',
    raw: {
      confidence: 'sure',
      products: [{ name: 'リーバイス デニムジャケット', brand: 'リーバイス', model: null, productType: 'ジャケット', jan: null }],
    },
    brandToken: 'リーバイス',
    groupTerms: ['ジャケット'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['ジャケット', 'ジャケット Gジャン', 'ジャケット トラッカー', 'ジャケット メンズ', 'ジャケット ブルー'],
    wrongTerms: ['ジーンズ', 'Tシャツ', 'キャップ', 'スニーカー', 'ハンドバッグ'],
  },
  {
    id: 'levis-jeans',
    label: 'リーバイスのジーンズ',
    category: 'apparel',
    raw: {
      confidence: 'sure',
      products: [{ name: 'リーバイス', brand: 'リーバイス', model: '501', productType: 'ジーンズ', color: 'ブルー', jan: null }],
    },
    brandToken: 'リーバイス',
    groupTerms: ['ジーンズ', 'デニム'],
    colorToken: 'ブルー',
    modelToken: null,
    rightTerms: ['ジーンズ', 'デニム', 'ジーンズ 501', 'デニム ストレート', 'ジーンズ ブルー'],
    wrongTerms: ['ジャケット', 'Tシャツ', 'キャップ', 'スニーカー', 'ハンドバッグ'],
  },
  {
    id: 'iittala-mug',
    label: 'イッタラのマグカップ',
    category: 'household',
    raw: {
      confidence: 'sure',
      products: [{ name: 'イッタラ', brand: 'イッタラ', model: 'テエマ', productType: 'マグカップ', color: 'ホワイト', jan: null }],
    },
    brandToken: 'イッタラ',
    groupTerms: ['マグカップ', 'マグ'],
    colorToken: 'ホワイト',
    modelToken: null,
    rightTerms: ['マグカップ', 'マグ', 'マグカップ ホワイト', 'マグ ティーマ', 'マグカップ ペア'],
    wrongTerms: ['スニーカー', 'ハンドバッグ', 'Tシャツ', 'ボールペン', '掃除機'],
  },
  {
    id: 'dyson-vacuum',
    label: 'ダイソンの掃除機',
    category: 'household',
    raw: {
      confidence: 'sure',
      products: [{ name: 'ダイソン', brand: 'ダイソン', model: 'V15', productType: '掃除機', jan: null }],
    },
    brandToken: 'ダイソン',
    groupTerms: ['掃除機'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['掃除機', '掃除機 コードレス', '掃除機 スティック', '掃除機 本体', '掃除機 サイクロン'],
    wrongTerms: ['スニーカー', 'ハンドバッグ', 'Tシャツ', 'マグカップ', 'カメラ'],
  },
  {
    id: 'gshock',
    label: 'カシオ G-SHOCK',
    category: 'electronics',
    raw: {
      confidence: 'sure',
      products: [{ name: 'カシオ G-SHOCK', brand: 'カシオ', model: 'G-SHOCK', productType: '腕時計', jan: null }],
    },
    brandToken: 'カシオ',
    groupTerms: ['腕時計', 'G-SHOCK'],
    colorToken: null,
    modelToken: 'G-SHOCK',
    rightTerms: ['腕時計', 'G-SHOCK', '腕時計 デジタル', 'G-SHOCK 本体', '腕時計 メンズ'],
    wrongTerms: ['スニーカー', 'ハンドバッグ', 'カメラ', 'ヘッドホン', 'Tシャツ'],
  },
  {
    id: 'pilot-pen',
    label: 'パイロットのボールペン',
    category: 'household',
    raw: {
      confidence: 'sure',
      products: [{ name: 'パイロット', brand: 'パイロット', model: 'ジュース', productType: 'ボールペン', color: 'ブラック', jan: null }],
    },
    brandToken: 'パイロット',
    groupTerms: ['ボールペン'],
    colorToken: 'ブラック',
    modelToken: null,
    rightTerms: ['ボールペン', 'ボールペン 0.5', 'ボールペン 黒', 'ボールペン ジェル', 'ボールペン 替芯'],
    wrongTerms: ['スニーカー', 'ハンドバッグ', 'Tシャツ', 'マグカップ', 'ジャケット'],
  },
  {
    id: 'rolex-brand-only',
    label: 'ロレックス（種類の語が応答に無い）',
    category: 'electronics',
    typeAbsent: true,
    raw: {
      confidence: 'sure',
      products: [{ name: 'ロレックス', brand: 'ロレックス', model: 'ロレックス', jan: null }],
    },
    brandToken: 'ロレックス',
    groupTerms: ['腕時計'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['腕時計', '腕時計 デイトナ', '腕時計 サブマリーナ', '腕時計 メンズ', '腕時計 自動巻き'],
    wrongTerms: ['スニーカー', 'ハンドバッグ', 'Tシャツ', 'カメラ', 'キャップ'],
  },
  {
    id: 'gucci-brand-only',
    label: 'グッチ（種類の語が応答に無い）',
    category: 'apparel',
    typeAbsent: true,
    raw: {
      confidence: 'sure',
      products: [{ name: 'グッチ', brand: 'グッチ', model: 'グッチ', jan: null }],
    },
    brandToken: 'グッチ',
    groupTerms: ['スニーカー', 'バッグ'],
    colorToken: null,
    modelToken: null,
    rightTerms: ['スニーカー', 'バッグ', 'スニーカー レザー', 'バッグ ショルダー', 'スニーカー メンズ'],
    wrongTerms: ['財布', 'キャップ', '香水', 'Tシャツ', '腕時計'],
  },
];
