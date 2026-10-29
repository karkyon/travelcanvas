/**
 * [FR059-B] 利用枠の表示の決まり(画面から切り離した計算だけ)。docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §6。
 */
import type { MyEntitlements, PlanningUsage } from '@/services/api/types/planningUsage';

export const yen = (s: string | null | undefined): number => (s ? Math.ceil(Number(s)) : 0);

export function resetLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function usageMessage(u: PlanningUsage): { symbol: string; tone: 'muted' | 'warn' | 'bad'; text: string } | null {
  const remaining = yen(u.plan_remaining_jpy);
  switch (u.state) {
    case 'guest':
      return { symbol: 'ⓘ', tone: 'muted', text: 'ゲスト・共有の閲覧では外部の AI・有料の検索を使いません(0円)。会員になると使えます' };
    case 'warning':
      return { symbol: '⚠', tone: 'warn',
        text: `この旅行の旅程相談の枠が残り少なくなっています(残り ${remaining}円)。次の操作の前に最大額を確かめます` };
    case 'limit_reached':
      return { symbol: '■', tone: 'bad',
        text: `この旅行の利用枠(${u.plan_cap_yen}円)に達したため、外部の AI・有料の検索を止めました。作った案と予定はそのまま残ります。`
          + '手での編集・保存した候補・公式サイトの確認で続けられます' };
    case 'monthly_limit_reached':
    case 'monthly_plans_reached':
      return { symbol: '■', tone: 'bad',
        text: `今月の旅程相談の枠(${u.class_label})に達しました。次のリセットは ${resetLabel(u.reset_at)}(UTC)です。`
          + '作った案と予定はそのまま残り、手で続けられます' };
    default:
      return null;
  }
}

export function classLine(e: MyEntitlements): string {
  if (e.class === 'guest') return 'ゲストでは外部の AI・有料の検索を使いません(0円)';
  const parts = [`クラス: ${e.class_label}`, `1旅行 ${yen(e.plan_cap_jpy)}円まで`];
  if (e.monthly_cap_jpy !== null) parts.push(`今月 ${yen(e.monthly_used_jpy)}円 / ${yen(e.monthly_cap_jpy)}円`);
  if (e.plans_per_month !== null) parts.push(`今月の旅行 ${e.plans_used_this_month} / ${e.plans_per_month}`);
  return parts.join(' · ');
}
