/**
 * [Gate② FC-026] 候補箱の候補への報告(閉業・住所の誤り・危険・重複)。backend/app/api/v1/candidates.py の reports。
 * 報告すると、候補が場所に紐付いていればその場所の出典を「要確認」にする(サーバー側)。
 */
import { api } from './index';

export type ReportReason = 'closed' | 'wrong_address' | 'dangerous' | 'duplicate';
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  closed: '閉業・休業', wrong_address: '住所・位置の誤り', dangerous: '危険・注意', duplicate: '重複',
};

export async function reportCandidate(planId: string, candidateId: string, reason: ReportReason, note?: string,
): Promise<{ reports: Record<string, number>; sources_marked_stale: number }> {
  const r = await api.post(`/plans/${planId}/candidates/${candidateId}/reports`, { reason, note: note?.trim() || null });
  const raw = r.data as { reports?: Record<string, number>; sources_marked_stale?: number };
  return { reports: raw.reports ?? {}, sources_marked_stale: Number(raw.sources_marked_stale ?? 0) };
}
