/**
 * [Gate G11 段階8] 候補箱の投票の表示の決まり(画面から切り離した計算だけ)。
 */
import type { Poll, PollOption, VoteValue } from '@/services/api/types/discussion';

export const CHOICES: Array<{ value: VoteValue; label: string; symbol: string }> = [
  { value: 'love', label: '行きたい', symbol: '♥' },
  { value: 'ok', label: '行ってもいい', symbol: '○' },
  { value: 'concern', label: '気になる点がある', symbol: '△' },
  { value: 'veto', label: '行きたくない', symbol: '✕' },
];
export const MAX_OPTIONS = 20;

/** 候補箱の投票(候補を選択肢にした、締め切っていない投票の新しいもの) */
export function candidatePoll(polls: Poll[]): Poll | null {
  const open = polls.filter((p) => !p.is_closed && !p.decided_option_id && p.options.some((o) => o.candidate_id));
  return open.length ? open[0]! : null;
}

export function countsText(o: PollOption): string {
  if (!o.counts) return `回答 ${o.responders}人(匿名の投票は3人の回答まで件数を出しません)`;
  return CHOICES.map((c) => `${c.symbol} ${c.label} ${o.counts![c.value]}`).join(' · ');
}
