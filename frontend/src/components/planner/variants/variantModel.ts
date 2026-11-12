/** [Gate PlanB] 日ごとの案の表示の決まり(純粋関数) */
import type { CheckItem, VariantReason, VariantSummary } from '@/services/api/dayVariants';

export const REASON_LABEL: Record<VariantReason, string> = {
  rain: '雨', party: '人数', transport: '移動手段', delay: '遅れ', fatigue: '疲れ', budget: '予算', closure: '休業', other: 'その他',
};
export const TRANSPORTS: [string, string][] = [['', '指定しない'], ['car', '自家用車'], ['train', '電車・徒歩'], ['bus', 'バス'],
  ['walk', '徒歩'], ['taxi', 'タクシー']];

/** 案の並び: A→E。しまった案は後ろ */
export function sortVariants(list: ReadonlyArray<VariantSummary>): VariantSummary[] {
  return [...list].sort((a, b) => (a.status === 'archived' ? 1 : 0) - (b.status === 'archived' ? 1 : 0) || a.label.localeCompare(b.label));
}

export function activeOf(list: ReadonlyArray<VariantSummary>): VariantSummary | undefined {
  return list.find((v) => v.status === 'active');
}

/** 案の要約の一言(理由・移動の既定・人数) */
export function conditionText(v: VariantSummary): string[] {
  const out: string[] = [];
  if (v.reason_label) out.push(`理由: ${v.reason_label}`);
  const c = v.conditions ?? {};
  const t = TRANSPORTS.find(([k]) => k && k === c.transport_mode);
  if (t) out.push(`移動の既定: ${t[1]}`);
  if (c.party_size) out.push(`${c.party_size}人`);
  if (c.prefer_indoor) out.push('屋内を優先');
  return out;
}

export const LEVEL_ORDER: Record<CheckItem['level'], number> = { bad: 0, warn: 1, info: 2, ok: 3 };

/** 検証の結果を、つながり・予約・時刻の見出しに分ける(重い順) */
export function groupChecks(items: ReadonlyArray<CheckItem>): { title: string; items: CheckItem[] }[] {
  const g = (kinds: CheckItem['kind'][]) => items.filter((i) => kinds.includes(i.kind)).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return [
    { title: '前後のつながり', items: g(['prev', 'next']) },
    { title: '時刻', items: g(['time']) },
    { title: '予約', items: g(['drop', 'booking', 'unbooked']) },
  ].filter((x) => x.items.length > 0);
}
