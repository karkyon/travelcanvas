/**
 * [Gate B1] FR-041 組織の画面で使う純粋関数。
 */
import type { OrgDistribution, OrgRole, PublicSharedPlan } from '@/services/api';

export const ROLE_LABEL: Record<OrgRole, string> = { owner: 'オーナー', admin: '管理者', member: 'メンバー' };

export const isOrgAdmin = (role: OrgRole | undefined): boolean => role === 'owner' || role === 'admin';

/** 配布版の写しを、共有の閲覧と同じ表示(SharedPlanView)の形にする */
export function snapshotToSharedPlan(dist: OrgDistribution): PublicSharedPlan | null {
  const s = dist.snapshot;
  if (!s) return null;
  return {
    plan_id: dist.id,
    title: s.title,
    description: s.description,
    destination: s.destination,
    start_date: s.start_date,
    end_date: s.end_date,
    days: s.days.map((d) => ({
      date: d.date,
      title: d.title,
      events: d.events.map((e) => ({
        title: e.title, event_type: e.event_type, local_start_time: e.local_start_time, is_all_day: e.is_all_day,
      })),
    })),
    permission: 'view',
    can_edit: false,
  };
}

/** 確認の状態の文言(メンバー本人から見た) */
export function myAckLabel(dist: OrgDistribution): string {
  if (dist.acknowledged) return `最新版(版${dist.version})を確認済み`;
  if (dist.my_ack_version != null) return `版${dist.my_ack_version}を確認済み・改訂があります`;
  return '未確認';
}

export const fmtDateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }) : '';
