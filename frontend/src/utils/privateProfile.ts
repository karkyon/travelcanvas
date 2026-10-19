/**
 * [Gate C1] FR-023 秘匿プロフィールの画面側の純粋関数(入力の検査・表示の文面)。
 * 検査の規則は backend/app/services/private_profile.py の clean_item と同じ。
 */
import type { PrivateProfileItem, PrivateProfileItemInput, PrivateProfileKind } from '@/services/api';

export const KIND_OPTIONS: { kind: PrivateProfileKind; label: string; type: 'time' | 'number' | 'text'; units: string[]; hint: string }[] = [
  { kind: 'earliest_start', label: '開始が早すぎない', type: 'time', units: [], hint: 'この時刻より前に始まる予定があると知らせます' },
  { kind: 'latest_end', label: '終わりが遅すぎない', type: 'time', units: [], hint: 'この時刻より後に続く予定があると知らせます' },
  { kind: 'daily_travel_max', label: '1日の移動の上限', type: 'number', units: ['minutes', 'hours', 'km'], hint: '移動区間の合計で判定します' },
  { kind: 'meal_interval_max', label: '食事の間隔', type: 'number', units: ['minutes', 'hours'], hint: '食事の予定どうしの間隔の上限' },
  { kind: 'trip_budget_max', label: '旅行の予算の上限', type: 'number', units: ['JPY', 'USD', 'EUR'], hint: '予約・移動の費用の合計で判定します' },
  { kind: 'avoid_text', label: '避けたいこと', type: 'text', units: [], hint: '予定の名前・説明にこの語があると知らせます(例: 階段、生魚)' },
  { kind: 'avoid_transport', label: '避けたい移動手段', type: 'text', units: [], hint: '例: 飛行機、バス' },
];

export const UNIT_LABEL: Record<string, string> = { minutes: '分', hours: '時間', km: 'km', JPY: '円', USD: 'ドル', EUR: 'ユーロ' };

export const kindOption = (kind: PrivateProfileKind) => KIND_OPTIONS.find((o) => o.kind === kind)!;

export interface ItemDraft {
  kind: PrivateProfileKind;
  label: string;
  hardness: 'hard' | 'soft';
  value: string;
  unit: string;
}

export const emptyDraft = (kind: PrivateProfileKind = 'earliest_start'): ItemDraft => ({
  kind, label: '', hardness: 'hard', value: '', unit: kindOption(kind).units[0] ?? '',
});

/** 入力を項目にする。不正なら理由の文字列を返す */
export function draftToItem(d: ItemDraft): PrivateProfileItemInput | string {
  const opt = kindOption(d.kind);
  const label = d.label.trim();
  if (!label || label.length > 60) return '名前は1〜60文字で入力してください';
  if (opt.type === 'time') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.value)) return '時刻を入力してください';
    return { kind: d.kind, label, hardness: d.hardness, value: d.value, unit: null };
  }
  if (opt.type === 'number') {
    const n = Number(d.value);
    if (d.value.trim() === '' || !Number.isFinite(n) || n < 0) return '0以上の数を入力してください';
    if (!opt.units.includes(d.unit)) return '単位を選んでください';
    return { kind: d.kind, label, hardness: d.hardness, value: n, unit: d.unit };
  }
  const text = d.value.trim();
  if (!text || text.length > 200) return '1〜200文字で入力してください';
  return { kind: d.kind, label, hardness: d.hardness, value: text, unit: null };
}

/** 一覧の表示(本人だけが見る) */
export function describeItem(item: PrivateProfileItem): string {
  const opt = kindOption(item.kind);
  const strength = item.hardness === 'hard' ? '必ず守る' : 'できれば';
  if (item.kind === 'earliest_start') return `${opt.label}: ${item.value}より後に始める(${strength})`;
  if (item.kind === 'latest_end') return `${opt.label}: ${item.value}より前に終える(${strength})`;
  if (opt.type === 'number') return `${opt.label}: ${item.value}${UNIT_LABEL[item.unit ?? ''] ?? item.unit ?? ''}まで(${strength})`;
  return `${opt.label}: 「${item.value}」(${strength})`;
}
