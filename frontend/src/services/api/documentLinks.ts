/**
 * [Gate TripKitFix] 文書を予約・チケット・予定へ関連付ける(POST /plans/{plan_id}/documents/{document_id}/links)。
 *
 * 最初に読む JS を小さく保つため(scripts/ci/check_bundle_budget.py・上限 430kB)、CompleteTravelAPI には足さず、
 * 使う画面(文書の画面。後から読む塊)がここを直接 import する(remaining2.ts と同じ形)。
 * ファイルは複製しない(参照だけを足す)。別の旅行の予約・予定は backend が 404 で拒む。
 */
import { api } from './index';
import { decodeResponse } from './decode';
import type { DocumentLink } from './types';

export type DocumentLinkTarget = { entity_type: 'reservation' | 'ticket' | 'event'; entity_id: string };

export async function createDocumentLink(planId: string, documentId: string, body: DocumentLinkTarget): Promise<DocumentLink> {
  const response = await api.post(`/plans/${planId}/documents/${documentId}/links`, body);
  return decodeResponse(response.data, (await import('./decoders')).documentLink,
    'POST /plans/{plan_id}/documents/{document_id}/links');
}
