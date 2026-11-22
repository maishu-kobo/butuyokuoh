export const lightPalettes = [
  { id:'paper', name:'栗色', description:'白い画面に、栗色のボタンと見出し。落ち着いた温かさを添える。',
    darkDescription:'黒い画面に、淡い銅色のボタンと見出し。温かさをアクセントに。' },
  { id:'indigo', name:'藍色', description:'白い画面に、藍色のボタンと見出し。すっきりとした印象に。',
    darkDescription:'黒い画面に、明るい青のボタンと見出し。選択中の操作が際立つ。' },
  { id:'sage', name:'深緑', description:'白い画面に、深緑のボタンと見出し。穏やかな印象に。',
    darkDescription:'黒い画面に、セージ色のボタンと見出し。やわらかな緑を差し色に。' },
] as const;

export type LightPalette = typeof lightPalettes[number]['id'];
export type PreviewAppearance = 'light' | 'dark';

export function readPreviewAppearance(input: unknown): PreviewAppearance {
  return input === 'dark' ? 'dark' : 'light';
}

export function readLightPalette(input: unknown): LightPalette | null {
  return lightPalettes.find(palette => palette.id === input)?.id ?? null;
}
