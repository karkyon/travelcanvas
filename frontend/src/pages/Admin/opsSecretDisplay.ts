/**
 * [Gate AdminUAT] 運用コンソールの鍵の表示を、登録の状態と接続確認の状態から1つに決める(食い違いを出さない)。
 *
 * - 登録済み(DB)の鍵には「本物の鍵を登録してください」を出さない。旧 .env の情報は「旧設定の詳細」へ畳む
 * - 確認済み・未確認・拒否・未判定・期限切れ・設定変更後を区別する。表示を成功に固定しない(backend の判定のまま)
 * - 今の構成で使わない鍵(Google のブラウザ用)は「設定不要」。必須の設定の不足と同じ警告にしない
 * - 鍵の確認と、提供元の停止・会員クラス・枠による利用の制限は別に書く
 */
import type { OpsProvider, OpsSecretSlot, OpsVerifyState } from '@/services/api/opsConsole';

export type Tone = 'tc-pill--good' | 'tc-pill--warn' | 'tc-pill--bad' | 'tc-pill--blue' | '';
export interface SecretDisplay { code: string; text: string; tone: Tone; detail: string | null }

const VERIFIED_TEXT: Record<OpsVerifyState, { text: string; tone: Tone }> = {
  accepted: { text: '登録済み・接続確認済み', tone: 'tc-pill--good' },
  unverified: { text: '登録済み・接続は未確認(送らない)', tone: 'tc-pill--warn' },
  rejected: { text: '登録済み・提供元が拒否(送らない)', tone: 'tc-pill--bad' },
  inconclusive: { text: '登録済み・確認は未判定(到達できない・混雑)', tone: 'tc-pill--warn' },
  expired: { text: '登録済み・確認の期限切れ(確認し直す)', tone: 'tc-pill--warn' },
  stale: { text: '登録済み・設定変更後(確認し直す)', tone: 'tc-pill--warn' },
};
const OTHER_TEXT: Record<string, { text: string; tone: Tone }> = {
  disabled: { text: '無効化済み(送らない)', tone: 'tc-pill--warn' },
  placeholder: { text: 'サンプル値(使えない)', tone: 'tc-pill--bad' },
  invalid: { text: '形が正しくない(使えない)', tone: 'tc-pill--bad' },
  decrypt_failed: { text: '復号できない(使えない)', tone: 'tc-pill--bad' },
  backend_unavailable: { text: '保管先が未接続(送らない)', tone: 'tc-pill--bad' },
  not_defined: { text: 'コードに設定の項目なし', tone: '' },
  not_needed: { text: '不要', tone: '' },
};
export const NOT_REQUIRED_TEXT = '現在の構成では使用しません。設定不要';

/** 「2026年11月4日 15時06分」の形(端末の時刻帯) */
export function formatJaDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}時${mm}分`;
}

function fromParts(status: string, verify: OpsVerifyState | null | undefined, required: boolean,
  expiresAt: string | null | undefined): SecretDisplay {
  if (status === 'configured') {
    const state: OpsVerifyState = verify ?? 'unverified';
    const v = VERIFIED_TEXT[state] ?? { text: `登録済み・${state}`, tone: '' as Tone };
    const until = formatJaDateTime(expiresAt);
    const detail = state === 'accepted'
      ? `CMSで登録したキーをDBから取得します。${until ? `確認期限：${until}` : '確認期限：不明'}`
      : state === 'unverified' ? '「有効性を確認」が通るまで、この鍵では送りません'
        : 'この鍵では送りません。「有効性を確認」で確かめ直してください(鍵の再入力は不要)';
    return { code: `configured:${state}`, text: v.text, tone: v.tone,
      detail: required ? detail : `${detail}。${NOT_REQUIRED_TEXT}` };
  }
  if (status === 'missing') {
    return required
      ? { code: 'missing', text: '未登録(必要)', tone: 'tc-pill--warn', detail: 'この画面の「鍵を登録する」から登録してください(.env には書きません)' }
      : { code: 'not_required', text: NOT_REQUIRED_TEXT, tone: '', detail: null };
  }
  const o = OTHER_TEXT[status] ?? { text: status, tone: '' as Tone };
  return { code: status, text: o.text, tone: o.tone, detail: null };
}

/**
 * [Gate OpsFreeKeys] 無料の提供元(場所の自動取得・動画の読み取り)の鍵。backend は「有効性を確認」を待たず、登録した版を
 * そのまま使う(provider_secrets.resolve)。「設定不要」「未確認(送らない)」と出すと、実際の動きと食い違う
 */
export const FREE_IN_USE_TEXT = '登録済み・自動取得で使用中';
export const FREE_MISSING_TEXT = '任意・未登録(登録すると自動取得で使います)';
function freeDisplay(slot: OpsSecretSlot): SecretDisplay | null {
  if (!slot.free) return null;
  if (slot.status === 'configured') {
    return { code: 'free:configured', text: FREE_IN_USE_TEXT, tone: 'tc-pill--good',
      detail: '無料の提供元です。「有効性を確認」は無く、利用者が自動取得・動画の読み取りを押した時にこの鍵で送ります(使った分の請求なし)' };
  }
  if (slot.status === 'missing') {
    return { code: 'free:missing', text: FREE_MISSING_TEXT, tone: '',
      detail: '登録しなくてもアプリは動きます(この提供元へは送らず、OpenStreetMap などだけで探します)' };
  }
  return null;
}

/** 秘密情報・権限の1つの鍵 */
export function secretDisplay(slot: OpsSecretSlot): SecretDisplay {
  const free = freeDisplay(slot);
  if (free) return free;
  const required = slot.required ?? true;
  return fromParts(slot.status, slot.verification?.state, required, slot.verification?.expires_at);
}

/** API・契約と接続の表の1行(鍵の欄) */
export function providerSecretDisplay(p: OpsProvider): SecretDisplay {
  const required = p.secret_required ?? true;
  return fromParts(p.secret, (p.secret_verification as OpsVerifyState | null | undefined) ?? null, required, null);
}

/**
 * 旧 .env の情報。prominent は鍵の行に出す案内(DB 未登録で必要な時だけ)。detail は「旧設定の詳細」に畳む文。
 * DB に登録済みなら、再登録を促さない。
 */
export function legacyDisplay(slot: OpsSecretSlot): { prominent: string | null; detail: string | null } {
  const l = slot.env_legacy;
  if (!l?.present) return { prominent: null, detail: null };
  const registered = slot.source === 'cms' && slot.status !== 'missing';
  const required = slot.required ?? true;
  if (registered) {
    if (l.placeholder) return { prominent: null, detail: '旧.envにサンプル値が残っていますが、使用していません。現在のDB登録キーの利用には影響しません。' };
    return { prominent: null, detail: l.importable
      ? '旧.envにも値がありますが、使用していません(取得元はDB登録キーだけ)。入れ替える時だけ「旧 .env から取り込む」を使えます。'
      : '旧.envの値は形が正しくなく、使用していません。現在のDB登録キーの利用には影響しません。' };
  }
  if (!required) {
    return { prominent: null, detail: '旧.envに値がありますが、現在の構成ではこの鍵を使いません。' };
  }
  if (l.placeholder) {
    return { prominent: 'この鍵はまだ登録されていません。この画面の「鍵を登録する」から登録してください',
      detail: '旧.envにサンプル値(CHANGE_ME など)が残っていますが、使用していません。' };
  }
  return l.importable
    ? { prominent: 'この鍵はまだ登録されていません。登録するか「旧 .env から取り込む」を使ってください',
      detail: '旧.envに値があります(取得元ではありません)。' }
    : { prominent: 'この鍵はまだ登録されていません。この画面の「鍵を登録する」から登録してください',
      detail: '旧.envの値は形が正しくないため使えません。' };
}

/** 鍵の確認とは別の、利用の制限の説明 */
export function restrictionNote(slot: OpsSecretSlot): string {
  const stopped = slot.suspended_providers ?? [];
  const head = stopped.length > 0 ? `提供元を止めています: ${stopped.join('・')}(送らない)` : '提供元の停止: なし';
  return `利用の制限(鍵の確認とは別): ${head} · 会員クラス・1旅行 50円の枠は利用者ごと(概要の「旅行相談の UAT の準備」で確認)`;
}
