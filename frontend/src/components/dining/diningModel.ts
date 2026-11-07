/**
 * [Gate SpotInfo] 食事の場所の情報(サーバーの app/services/dining.py と同じ項目・同じキー)。
 * グルメサイト(ホットペッパーグルメのお店の情報・食べログの店舗基本情報)の項目を参考に、旅の計画で
 * 「行くか・いつ行くか・どう行くか」を決めるのに効くものへ絞った。
 */
export interface DiningInfo {
  genres?: string[];
  signature?: string | null;
  budget_lunch?: string | null;
  budget_dinner?: string | null;
  hours?: string | null;
  closed?: string | null;
  reservation?: 'required' | 'recommended' | 'possible' | 'not_accepted' | null;
  parking?: 'yes' | 'nearby' | 'none' | null;
  parking_note?: string | null;
  seats?: number | null;
  private_room?: boolean | null;
  smoking?: 'no' | 'separated' | 'yes' | null;
  payment?: Array<'cash' | 'card' | 'emoney' | 'qr'>;
  features?: string[];
  moods?: string[];
  access?: string | null;
  wait_note?: string | null;
}

export const GENRES: Array<[string, string]> = [
  ['washoku', '和食'], ['sushi', '寿司'], ['kaisen', '海鮮'], ['ramen', 'ラーメン'], ['soba_udon', 'そば・うどん'],
  ['yakiniku', '焼肉'], ['yakitori', '焼き鳥'], ['tempura', '天ぷら'], ['tonkatsu', 'とんかつ・揚げ物'],
  ['okonomiyaki', 'お好み焼き・粉もの'], ['kyodo', '郷土料理'], ['izakaya', '居酒屋'], ['nabe', '鍋'], ['unagi', 'うなぎ'],
  ['teishoku', '定食・食堂'], ['curry', 'カレー'], ['chinese', '中華'], ['korean', '韓国料理'], ['asian', 'アジア・エスニック'],
  ['italian', 'イタリアン'], ['french', 'フレンチ'], ['western', '洋食'], ['steak', 'ステーキ・ハンバーグ'], ['burger', 'ハンバーガー'],
  ['cafe', 'カフェ'], ['sweets', 'スイーツ・甘味'], ['bakery', 'パン'], ['bar', 'バー・お酒'], ['buffet', 'ビュッフェ'], ['other', 'その他'],
];
export const MAX_GENRES = 3;
export const BUDGETS: Array<[string, string]> = [
  ['u1000', '〜1,000円'], ['1000_2000', '1,000〜2,000円'], ['2000_3000', '2,000〜3,000円'], ['3000_5000', '3,000〜5,000円'],
  ['5000_10000', '5,000〜10,000円'], ['10000_20000', '10,000〜20,000円'], ['o20000', '20,000円〜'],
];
export const RESERVATION: Record<string, string> = {
  required: '予約が必要', recommended: '予約がおすすめ', possible: '予約できる', not_accepted: '予約不可(並ぶ)',
};
export const PARKING: Record<string, string> = { yes: '駐車場あり', nearby: '近くにコインパーキング', none: '駐車場なし' };
export const SMOKING: Record<string, string> = { no: '全席禁煙', separated: '分煙', yes: '喫煙可' };
export const PAYMENT: Array<[string, string]> = [['cash', '現金'], ['card', 'カード'], ['emoney', '電子マネー'], ['qr', 'QR 決済']];
export const FEATURES: Array<[string, string]> = [
  ['kids', '子ども連れ歓迎'], ['takeout', 'テイクアウト'], ['vegetarian', 'ベジタリアン対応'], ['english_menu', '英語メニュー'],
  ['outdoor', 'テラス席'], ['view', '景色が良い'], ['counter', 'カウンター席'], ['tatami', '座敷'], ['wheelchair', '車いすで入れる'],
  ['lunch', 'ランチあり'], ['late_night', '夜遅くまで'], ['all_you_can_drink', '飲み放題'], ['pet', 'ペット可'], ['wifi', 'Wi-Fi'],
];
export const MOODS: Array<[string, string]> = [
  ['date', 'デート'], ['family', '家族で'], ['solo', 'ひとりで'], ['friends', '友だちと'], ['business', '接待・会食'], ['local', '地元の人気店'],
];

const label = (list: Array<[string, string]>, key: string | null | undefined) => list.find(([k]) => k === key)?.[1] ?? null;
export const genreLabel = (k: string) => label(GENRES, k) ?? k;
export const budgetLabel = (k: string | null | undefined) => label(BUDGETS, k);

/** 空の項目を除いた保存の形(全て空なら null) */
export function cleanDining(d: DiningInfo | null | undefined): DiningInfo | null {
  if (!d) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
    if (out[k] === '') delete out[k];
  }
  return Object.keys(out).length ? (out as DiningInfo) : null;
}

/** 今の値が空の項目だけを埋める(利用者が入れた値は変えない) */
export function mergeEmptyDining(current: DiningInfo | null | undefined, found: DiningInfo | null | undefined): DiningInfo | null {
  const base: Record<string, unknown> = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(found ?? {})) {
    const now = base[k];
    if (now === undefined || now === null || now === '' || (Array.isArray(now) && now.length === 0)) base[k] = v;
  }
  return cleanDining(base as DiningInfo);
}

/** 短い要約(カードの上の小さな印) */
export function diningBadges(d: DiningInfo | null | undefined): string[] {
  if (!d) return [];
  const out: string[] = [];
  const lunch = budgetLabel(d.budget_lunch);
  const dinner = budgetLabel(d.budget_dinner);
  if (lunch) out.push(`昼 ${lunch}`);
  if (dinner) out.push(`夜 ${dinner}`);
  if (d.reservation) out.push(RESERVATION[d.reservation] ?? d.reservation);
  if (d.parking) out.push(PARKING[d.parking] ?? d.parking);
  if (d.smoking) out.push(SMOKING[d.smoking] ?? d.smoking);
  if (d.private_room) out.push('個室あり');
  return out;
}
