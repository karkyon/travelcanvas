/**
 * [Gate ConsultAI] 旅行相談の AI・Google の表示の決まり(使えない理由・利用枠の言葉)。
 */
import type { ConsultAiStatus, ConsultOperation, ConsultUsage } from '@/services/api/consultAi';

const REASON_LABEL: Record<string, string> = {
  secret_unverified: '管理者が鍵の有効性をまだ確かめていません',
  secret_verification_expired: '鍵の確認の期限が切れています(管理者が確認し直します)',
  secret_verification_stale: '設定が変わったため、鍵の確認のやり直しが要ります',
  secret_rejected: '提供元が鍵を受け付けていません',
  secret_missing: '鍵が登録されていません',
  secret_backend_unavailable: '鍵の保管先が設定されていません',
  secret_backend_unconfigured: '鍵の保管先が設定されていません',
};

/** この操作を今使えない理由(使えれば null) */
export function operationBlocker(status: ConsultAiStatus | null, op: ConsultOperation, needsConsent = false): string | null {
  if (!status) return '状態を確かめています';
  const s = status.operations[op];
  if (status.class === 'guest') return 'ゲストでは使えません(会員になると使えます)';
  if (!s.included) return `${status.class_label} のクラスには含まれません`;
  if (needsConsent && !status.consent.ai_processing) return 'AI の利用に同意していません';
  if (s.suspended) return '費用の確認のため、運用者が止めています';
  if (!s.key_ready) return REASON_LABEL[s.reason ?? ''] ?? '提供元の準備が整っていません';
  return null;
}

export const usageLabel = (u: ConsultUsage | undefined | null): string | null =>
  u ? `この相談の利用枠: 使用 ¥${Math.ceil(Number(u.plan_used))} / 上限 ¥${Math.round(Number(u.plan_cap))}` : null;
