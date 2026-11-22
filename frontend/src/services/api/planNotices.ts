/**
 * [Gate② FC-064] 重大な変更・集合の変更のお知らせと「確認しました」(backend/app/api/v1/discussion.py の notices)。
 */
import { api } from './index';
import { arrayOf, bool, decodeResponse, int, nullable, object, oneOf, optional, str, type Decoder } from './decode';

export type NoticeKind = 'major_change' | 'meeting_change';
export interface NoticeMember { name: string; acknowledged: boolean; acknowledged_at: string | null }
export interface PlanNoticeItem {
  id: string; kind: NoticeKind; kind_label: string; title: string; body: string | null; created_at: string | null;
  created_by: string; acknowledged: boolean; acknowledged_at: string | null; ack_count: number; member_count: number;
  needs_my_ack: boolean; members?: NoticeMember[];
}
export interface PlanNoticeList { items: PlanNoticeItem[]; can_edit: boolean }

const member: Decoder<NoticeMember> = object<NoticeMember>({ name: str, acknowledged: bool, acknowledged_at: nullable(str) });
const item: Decoder<PlanNoticeItem> = object<PlanNoticeItem>({
  id: str, kind: oneOf('major_change', 'meeting_change'), kind_label: str, title: str, body: nullable(str),
  created_at: nullable(str), created_by: str, acknowledged: bool, acknowledged_at: nullable(str), ack_count: int,
  member_count: int, needs_my_ack: bool, members: optional(arrayOf(member)),
});
const list: Decoder<PlanNoticeList> = object<PlanNoticeList>({ items: arrayOf(item), can_edit: bool });

export async function getNotices(planId: string): Promise<PlanNoticeList> {
  return decodeResponse((await api.get(`/plans/${planId}/notices`)).data, list, 'GET /plans/{plan_id}/notices');
}
export async function createNotice(planId: string, kind: NoticeKind, title: string, body?: string): Promise<PlanNoticeItem> {
  const r = await api.post(`/plans/${planId}/notices`, { kind, title, body: body?.trim() || null });
  return decodeResponse(r.data, item, 'POST /plans/{plan_id}/notices');
}
export async function acknowledgeNotice(planId: string, noticeId: string): Promise<PlanNoticeItem> {
  const r = await api.post(`/plans/${planId}/notices/${noticeId}/ack`, {});
  return decodeResponse(r.data, item, 'POST /plans/{plan_id}/notices/{notice_id}/ack');
}
