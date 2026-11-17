/**
 * [Gate ChatConsensus] 相談を話し合い中心にする口(backend/app/api/v1/discussion.py)。
 *
 * - createDecision: 「これで決まり」。投票なしで決定として記録する(旅程への反映は g4.ts の adoptPoll と同じ)
 * - suggestPollOptions: 話し合いから AI が選択肢の候補を出す(任意・押した時だけ。Idempotency-Key は押した1回ごとに1つ。
 *   何も保存しない。同意・枠が無い時は送らない)
 * 画面の中で失敗を案内するため、共通のエラーの toast は出さない(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, nullable, object, str, type Decoder } from './decode';
import { poll } from './decoders';
import type { DecisionCreateData, Poll, PollOptionSuggestion } from './types/discussion';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

const suggestion: Decoder<PollOptionSuggestion> = object<PollOptionSuggestion>({
  suggestion: object({ title: nullable(str), options: arrayOf(object({ label: str, quote: str })) }),
  saved: (v, path) => bool(v, path) as false,
  notice: str,
});

export async function createDecision(planId: string, data: DecisionCreateData): Promise<Poll> {
  const response = await api.post(`/plans/${planId}/polls/decision`, data, SILENT);
  return decodeResponse(response.data, poll, 'POST /plans/{plan_id}/polls/decision');
}

export async function suggestPollOptions(
  planId: string, input: { topic?: string; comment_ids?: string[] }, idempotencyKey: string,
): Promise<PollOptionSuggestion> {
  const response = await api.post(`/plans/${planId}/polls/suggest-options`, input,
    { ...SILENT, headers: { 'Idempotency-Key': idempotencyKey } });
  return decodeResponse(response.data, suggestion, 'POST /plans/{plan_id}/polls/suggest-options');
}
