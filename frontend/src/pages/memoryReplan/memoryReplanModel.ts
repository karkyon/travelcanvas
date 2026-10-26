/**
 * [Gate P17] Memory Replan(FR-057)の説明文。根拠(件数・旅行・例)を必ず書く(CA-015 説明可能)。
 */
import type { G7Insight, G7Proposal } from '@/services/api/types/g7';
import { eventTypeLabel } from '@/pages/booklet/bookletModel';

const plansText = (plans: string[]) => (plans.length > 2 ? `${plans.slice(0, 2).join('・')}ほか` : plans.join('・'));

export function insightText(i: G7Insight): string {
  const type = i.event_type ? eventTypeLabel(i.event_type) : '';
  switch (i.kind) {
    case 'stay_longer':
      return `「${type}」の予定では、実際の滞在が予定より平均${i.minutes}分長くなっています`;
    case 'stay_shorter':
      return `「${type}」の予定では、実際の滞在が予定より平均${i.minutes}分短くなっています`;
    case 'late_arrival':
      return `予定の開始より平均${i.minutes}分遅れて着いています。予定の間に余裕をとると安心です`;
    case 'often_skipped':
      return `「${type}」の予定は${i.samples}件のうち${i.skipped ?? 0}件に行きませんでした。候補として扱うのも一案です`;
    case 'slow_transport':
      return `${i.mode_label ?? i.mode ?? '移動'}の後は、予定より平均${i.minutes}分遅れて着いています`;
    default:
      return '';
  }
}

export function basisText(i: G7Insight): string {
  const who = i.basis === 'same_party' && i.party_label ? `同じ同行者(${i.party_label})の旅行の` : '';
  return `根拠: ${who}${plansText(i.plans)}の${i.samples}件(例: ${i.examples.join('、')})`;
}

/** [Gate G7] 提案の見出し(区間の提案は手段と分) */
export function proposalTitle(p: G7Proposal, typeLabel: (t: string) => string): string {
  if (p.target === 'segment') return `移動(${p.mode ?? ''})の前の余裕を${p.minutes}分足す`;
  return `「${typeLabel(p.event_type ?? 'other')}」の予定の後ろを${p.minutes}分ずらす`;
}

export const KEPT_REASON: Record<'locked' | 'has_reservation' | 'next_day', string> = {
  locked: '確定(ロック)しているため動かしません(その後ろの予定も)',
  has_reservation: '予約と紐付いているため動かしません(その後ろの予定も)',
  next_day: 'ずらすと日をまたぐため動かしません',
};
