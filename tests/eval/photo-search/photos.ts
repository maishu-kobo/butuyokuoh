// 写真に実際に写っているもの。ファイル名と同じ id を、次のライブ評価でも使う。
export interface PhotoCase {
  id: string;
  previousId: string;
  depicts: string;
  category: string;
}

export const PHOTO_CASES: PhotoCase[] = [
  { id: 'balenciaga-arena', previousId: 'balenciaga-shoes', depicts: 'Balenciaga Arena の白いハイカットスニーカー', category: 'shoes' },
  { id: 'adidas-leather-tennis', previousId: 'balenciaga-type-in-model', depicts: 'Adidas のレザーテニスシューズ', category: 'shoes' },
  { id: 'nike-cortez', previousId: 'nike-sneakers', depicts: 'Nike Cortez', category: 'shoes' },
  { id: 'converse-all-star', previousId: 'converse-complete', depicts: 'Converse All Star の黒いスニーカー', category: 'shoes' },
  { id: 'oxford-brogue', previousId: 'regal-dress-shoes', depicts: 'オックスフォードのブローグ靴の部位図', category: 'shoes' },
  { id: 'birkenstock-arizona', previousId: 'birkenstock-sandals', depicts: 'Birkenstock Arizona', category: 'shoes' },
  { id: 'prada-tooled-handbag', previousId: 'lv-handbag', depicts: '1935–45年の Prada の型押し革ハンドバッグ', category: 'bags' },
  { id: 'trekking-backpack', previousId: 'northface-backpack', depicts: 'トレッキングポールと靴が写ったバックパック', category: 'bags' },
  { id: 'rune-cotton-tote', previousId: 'muji-tote', depicts: 'ルーン文字の入ったコットントート', category: 'bags' },
  { id: 'iphone-5', previousId: 'iphone', depicts: 'iPhone 5', category: 'electronics' },
  { id: 'bose-headphones', previousId: 'sony-headphones', depicts: 'Bose QuietComfort 25', category: 'electronics' },
  { id: 'adapted-mirrorless-camera', previousId: 'canon-camera', depicts: 'ミラーレスカメラに付けたレンズ', category: 'electronics' },
  { id: 'broken-laptop-2006', previousId: 'macbook', depicts: '2006年の壊れたノートパソコン', category: 'electronics' },
  { id: 'casio-g-shock', previousId: 'gshock', depicts: 'Casio G-Shock', category: 'electronics' },
  { id: 'mac-lipstick', previousId: 'dior-lipstick', depicts: 'MAC の口紅', category: 'cosmetics' },
  { id: 'coty-suma-perfume', previousId: 'chanel-perfume', depicts: 'Coty の Suma 香水', category: 'cosmetics' },
  { id: 'denim-jacket', previousId: 'levis-jacket', depicts: 'デニムジャケットのディテール', category: 'apparel' },
  { id: 'blue-jeans', previousId: 'levis-jeans', depicts: 'ジーンズをはいた人物', category: 'apparel' },
  { id: 'hema-white-tshirt', previousId: 'uniqlo-shirt', depicts: 'HEMA の白い T シャツ', category: 'apparel' },
  { id: 'ceramic-mugs', previousId: 'iittala-mug', depicts: '陶器のマグカップ', category: 'household' },
  { id: 'dyson-v10-vacuum', previousId: 'dyson-vacuum', depicts: 'Dyson Cyclone V10 Absolute', category: 'household' },
  { id: 'pen-writing-example', previousId: 'pilot-pen', depicts: 'Example と書いているペン', category: 'household' },
  { id: 'alb-wristwatch', previousId: 'rolex-brand-only', depicts: 'A.L.B の腕時計', category: 'electronics' },
];
