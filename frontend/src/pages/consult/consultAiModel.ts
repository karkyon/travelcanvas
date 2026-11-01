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

/**
 * [Gate SearchUAT] 「候補を探す」の検索元 Google を今使えるか。使えなければ理由と解決の操作(検索欄の近くに出す)。
 * 鍵の確認・会員クラス・停止はサーバーの判定(/trip-intents/ai/status)、利用枠はこの相談の使用額。
 */
export function googleSearchAvailability(status: ConsultAiStatus | null, usage: ConsultUsage | null):
  { ok: boolean; reason: string | null; fix: string | null; usage: string | null } {
  if (!status) return { ok: false, reason: '利用の条件を確かめています', fix: null, usage: null };
  const s = status.operations['places.search'];
  const deny = (reason: string, fix: string | null) => ({ ok: false, reason, fix, usage: null });
  if (status.class === 'guest') return deny('ゲストでは使えません', 'ログインまたは会員登録すると使えます');
  if (!s.included) {
    return deny(`${status.class_label} のクラスには Google の検索が含まれません`,
      'Trip 以上のクラスで使えます(試験では管理者が 運用コンソール › 会員クラス で切り替え)');
  }
  if (s.suspended) return deny('費用の確認のため、運用者が Google の検索を止めています', '運用者が 運用コンソール › API・契約と接続 で戻すと使えます');
  if (!s.key_ready) {
    return deny(REASON_LABEL[s.reason ?? ''] ?? '提供元の準備が整っていません',
      '管理者が 運用コンソール › 秘密情報・権限 で鍵の「有効性を確認」をすると使えます(鍵の再入力は不要)');
  }
  if (usage && Number(usage.plan_remaining) <= 0) {
    return deny('この相談の利用枠(上限)に達しました', 'OpenStreetMap(無料)で探せます。下書きを作ると旅行の枠に移ります');
  }
  return { ok: true, reason: null, fix: null, usage: usageLabel(usage) };
}
