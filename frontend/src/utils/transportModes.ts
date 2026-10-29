/**
 * [Gate G11] 移動手段の表示の語彙(docs/ux/G11_UIUX全範囲_実装仕様.md §4、DOC-13)。UIX-M04。
 *
 * - アイコンだけで伝えない: 必ず名前と組にする(画面に出す・読み上げる)
 * - train(鉄道)を新幹線と推測しない。shinkansen は区間で明示された時だけ
 * - helicopter は「要手配」。所要時間を推定しない
 * - 値が無い・知らない値は「移動手段未設定」(既定の電車のアイコンを出さない)
 * - 古い画面の値(car・plane・subway・boat・tram・transit・other)も同じ表で読む
 * - bus は路線バス、express_bus は高速バス(区別する前に保存した高速バスは bus のまま。推測で直さない)
 */
export interface TransportModeInfo {
  /** 正式な値(区間の mode) */
  mode: string | null;
  icon: string | null;
  label: string;
  /** 補足(要手配など)。無ければ null */
  note: string | null;
  /** 所要時間を推定してよいか(ヘリは false) */
  estimable: boolean;
}

const TABLE: Record<string, Omit<TransportModeInfo, 'mode'>> = {
  walking: { icon: '🚶', label: '徒歩', note: null, estimable: true },
  bicycle: { icon: '🚲', label: '自転車', note: null, estimable: true },
  bus: { icon: '🚌', label: '路線バス', note: null, estimable: true },
  express_bus: { icon: '🚍', label: '高速バス', note: null, estimable: true },
  train: { icon: '🚃', label: '鉄道', note: null, estimable: true },
  shinkansen: { icon: '🚄', label: '新幹線', note: null, estimable: true },
  driving: { icon: '🚗', label: '自家用車', note: null, estimable: true },
  taxi: { icon: '🚕', label: 'タクシー', note: null, estimable: true },
  ferry: { icon: '⛴️', label: '船', note: null, estimable: true },
  flight: { icon: '✈️', label: '飛行機', note: null, estimable: true },
  helicopter: { icon: '🚁', label: 'ヘリ', note: '要手配', estimable: false },
  mixed: { icon: '🔀', label: '乗り継ぎ', note: null, estimable: true },
  // 古い画面の値
  subway: { icon: '🚇', label: '地下鉄', note: null, estimable: true },
  tram: { icon: '🚋', label: '路面電車', note: null, estimable: true },
  transit: { icon: '🚉', label: '公共交通', note: null, estimable: true },
};

const ALIAS: Record<string, string> = { car: 'driving', plane: 'flight', boat: 'ferry' };

export const UNSET_LABEL = '移動手段未設定';

export function transportMode(mode: string | null | undefined): TransportModeInfo {
  const key = mode ? (ALIAS[mode] ?? mode) : null;
  const hit = key ? TABLE[key] : undefined;
  if (!key || !hit) return { mode: null, icon: null, label: UNSET_LABEL, note: null, estimable: false };
  return { mode: key, ...hit };
}

/** 「🚶 徒歩 · 18分」の形(所要時間が無い時は「所要時間未計算」、ヘリは「所要時間未確定」。0分と区別する) */
export function transportText(mode: string | null | undefined, minutes: number | null | undefined): string {
  const m = transportMode(mode);
  if (!m.mode) return m.label;
  const name = `${m.icon} ${m.label}${m.note ? `(${m.note})` : ''}`;
  if (!m.estimable && (minutes === null || minutes === undefined)) return `${name} · 所要時間未確定`;
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return `${name} · 所要時間未計算`;
  return `${name} · ${durationLabel(minutes)}`;
}

export function durationLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const mm = total % 60;
  if (h === 0) return `${mm}分`;
  return mm ? `${h}時間${mm}分` : `${h}時間`;
}

/** 凡例(画面の正本のモックの「🚶 徒歩 / 🚌 路線バス / 🚍 高速バス / 🚄 新幹線 / 🚕 タクシー / 🚗 自家用車 / 🚁 ヘリ(要手配)」) */
export const LEGEND_MODES = ['walking', 'bicycle', 'bus', 'express_bus', 'train', 'shinkansen', 'taxi', 'driving', 'flight',
  'helicopter'] as const;
