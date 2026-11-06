/** [Gate Footprints2] 旅の足あとの地図のデータと計算(画面の部品 FootprintMaps から分けた) */
import { WORLD_ROWS, WORLD_STEP, WORLD_TOP } from './worldGrid';

export type Region = 'hokkaido' | 'tohoku' | 'kanto' | 'chubu' | 'kinki' | 'chugoku' | 'shikoku' | 'kyushu';

/** 地方の色(行った県の地の色)。文字の色は明るさから選ぶ(onColor) */
export const REGION_COLOR: Record<Region, string> = {
  hokkaido: '#2f86c8', tohoku: '#1e9a8a', kanto: '#5a9a35', chubu: '#a4b42a',
  kinki: '#e8a317', chugoku: '#e57a2e', shikoku: '#dc5f86', kyushu: '#d1493f',
};
export const REGION_LABEL: Record<Region, string> = {
  hokkaido: '北海道', tohoku: '東北', kanto: '関東', chubu: '中部', kinki: '近畿', chugoku: '中国', shikoku: '四国', kyushu: '九州・沖縄',
};

/** [名前, 地方, x, y, 幅, 高さ](升目の単位。x は西 → 東、y は北 → 南) */
export const PREF_TILES: ReadonlyArray<readonly [string, Region, number, number, number, number]> = [
  ['北海道', 'hokkaido', 10, 0, 3, 2],
  ['青森県', 'tohoku', 10, 2.3, 2, 1], ['秋田県', 'tohoku', 10, 3.3, 1, 1], ['岩手県', 'tohoku', 11, 3.3, 1, 1],
  ['山形県', 'tohoku', 10, 4.3, 1, 1], ['宮城県', 'tohoku', 11, 4.3, 1, 1], ['福島県', 'tohoku', 10, 5.3, 2, 1],
  ['群馬県', 'kanto', 10, 6.3, 1, 1], ['栃木県', 'kanto', 11, 6.3, 1, 1], ['埼玉県', 'kanto', 10, 7.3, 1, 1],
  ['茨城県', 'kanto', 11, 7.3, 1, 1], ['東京都', 'kanto', 10, 8.3, 1, 1], ['千葉県', 'kanto', 11, 8.3, 1, 1.6],
  ['神奈川県', 'kanto', 10, 9.3, 1, 1],
  ['新潟県', 'chubu', 9, 5.3, 1, 1], ['富山県', 'chubu', 8, 5.3, 1, 1], ['石川県', 'chubu', 7, 4.6, 1, 1.7],
  ['福井県', 'chubu', 7, 6.3, 1, 1], ['長野県', 'chubu', 9, 6.3, 1, 1.5], ['岐阜県', 'chubu', 8, 6.3, 1, 1.5],
  ['山梨県', 'chubu', 9, 7.8, 1, 1], ['愛知県', 'chubu', 8, 7.8, 1, 1], ['静岡県', 'chubu', 8.6, 8.8, 1.4, 1],
  ['滋賀県', 'kinki', 7, 7.3, 1, 1], ['京都府', 'kinki', 6, 6.8, 1, 1.5], ['兵庫県', 'kinki', 5, 6.8, 1, 1.5],
  ['大阪府', 'kinki', 5, 8.3, 1, 1], ['奈良県', 'kinki', 6, 8.3, 1, 1], ['三重県', 'kinki', 7, 8.3, 1, 1.5],
  ['和歌山県', 'kinki', 5.5, 9.3, 1.5, 1],
  ['鳥取県', 'chugoku', 4, 6.8, 1, 1], ['島根県', 'chugoku', 3, 6.8, 1, 1], ['岡山県', 'chugoku', 4, 7.8, 1, 1],
  ['広島県', 'chugoku', 3, 7.8, 1, 1], ['山口県', 'chugoku', 2, 7.3, 1, 1.5],
  ['香川県', 'shikoku', 4, 9, 1, 1], ['愛媛県', 'shikoku', 3, 9, 1, 1], ['徳島県', 'shikoku', 4, 10, 1, 1],
  ['高知県', 'shikoku', 3, 10, 1, 1],
  ['福岡県', 'kyushu', 1, 8.3, 1, 1], ['佐賀県', 'kyushu', 0, 8.3, 1, 1], ['長崎県', 'kyushu', 0, 9.3, 1, 1],
  ['大分県', 'kyushu', 2, 8.8, 1, 1], ['熊本県', 'kyushu', 1, 9.3, 1, 1], ['宮崎県', 'kyushu', 2, 9.8, 1, 1.2],
  ['鹿児島県', 'kyushu', 1, 10.3, 1, 1.2], ['沖縄県', 'kyushu', 0, 12, 1, 1],
];

/** 色の明るさから、上に載せる文字の色(白か濃い紺)を選ぶ(WCAG のコントラストの高い方) */
export function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const white = 1.05 / (L + 0.05);
  const dark = (L + 0.05) / (0.0137 + 0.05); // #10202e
  return white >= dark ? '#ffffff' : '#10202e';
}

export const AREA_COLOR: Record<string, string> = {
  N: '#2f86c8', S: '#1e9a8a', E: '#7d6bc2', F: '#e8a317', A: '#e57a2e', J: '#d1493f', O: '#2aa3b8',
};
export const AREA_LABEL: Record<string, string> = {
  N: '北米', S: '南米', E: 'ヨーロッパ', F: 'アフリカ', A: 'アジア', J: '日本', O: 'オセアニア',
};
export const C = 6; // 升目(3°)の大きさ

export interface MapPoint { lat: number; lng: number; state: 'visited' | 'planned'; label: string }

/** 経度・緯度 → 地図の位置(正距円筒。升目と同じ割合) */
export function project(lat: number, lng: number): { x: number; y: number } {
  const la = Math.max(WORLD_TOP - WORLD_ROWS.length * WORLD_STEP, Math.min(WORLD_TOP, lat));
  return { x: ((lng + 180) / WORLD_STEP) * C, y: ((WORLD_TOP - la) / WORLD_STEP) * C };
}

