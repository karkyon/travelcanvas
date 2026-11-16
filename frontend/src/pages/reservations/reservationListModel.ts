/**
 * [Gate TripKit] 予約・チケットの一覧の検索・絞り込み・並べ替えと、カードに出す期限・状態の判定。
 *
 * - 検索は一覧の API が返した値だけで行う(予約番号は伏せた形の末尾だけ。平文の番号・PIN は扱わない)
 * - 「要確認」は API の値から決まるものだけ: 未確定・変更あり、取消期限が 72 時間以内、支払いが未払い
 * - 日時は予約のタイムゾーンで表示する(無い時は端末の時刻と明記)
 */
import type { Reservation } from '@/services/api';

export const RESERVATION_STATUS_LABEL: Record<string, string> = {
  candidate: '未確定', confirmed: '確定', modified: '変更あり', cancelled: 'キャンセル', used: '利用済み', no_show: '不参加',
};

export const PAYMENT_LABEL: Record<string, string> = {
  paid: '支払済み', unpaid: '未払い', partial: '一部支払い', refunded: '返金済み', pending: '支払い待ち', on_site: '現地払い',
  not_required: '支払い不要', free: '無料',
};
/** 準備状況(backend readiness.py)と同じ判定: 支払いが済んだとみなす状態 */
const SETTLED_PAYMENT = new Set(['paid', 'not_required', 'free', 'refunded']);

export type ResSort = 'date' | 'deadline' | 'added';
export interface ResCond { q: string; st: string; type: string; sort: string }

const HOUR = 3600_000;

export function deadlineState(r: Reservation, nowMs: number): { level: 'past' | 'soon' | 'ok'; label: string } | null {
  if (!r.cancellation_deadline) return null;
  const t = Date.parse(r.cancellation_deadline);
  if (Number.isNaN(t)) return null;
  if (t < nowMs) return { level: 'past', label: '取消期限を過ぎています' };
  const h = (t - nowMs) / HOUR;
  if (h <= 72) return { level: 'soon', label: h < 24 ? `取消期限まで あと${Math.max(1, Math.floor(h))}時間` : `取消期限まで あと${Math.ceil(h / 24)}日` };
  return { level: 'ok', label: '' };
}

/** 確認が必要か(理由つき)。API にある値だけで判定する */
export function attentionReasons(r: Reservation, nowMs: number): string[] {
  const out: string[] = [];
  if (r.status === 'candidate') out.push('未確定');
  if (r.status === 'modified') out.push('変更あり');
  const d = deadlineState(r, nowMs);
  if (d?.level === 'soon' && r.status !== 'cancelled' && r.status !== 'used') out.push(d.label);
  if ((r.status === 'confirmed' || r.status === 'modified') && (r.total_amount ?? 0) > 0) {
    const p = (r.payment_status ?? '').trim().toLowerCase();
    if (!SETTLED_PAYMENT.has(p)) out.push(p ? '未払い' : '支払状況が未入力');
  }
  return out;
}

export function isSoon(r: Reservation, nowMs: number): boolean {
  if (!r.start_at) return false;
  const t = Date.parse(r.start_at);
  return !Number.isNaN(t) && t >= nowMs - 6 * HOUR && t <= nowMs + 7 * 24 * HOUR;
}

export const STATUS_FILTERS: { value: string; label: string; test: (r: Reservation, now: number) => boolean; attention?: boolean }[] = [
  { value: 'attention', label: '要確認', test: (r, n) => attentionReasons(r, n).length > 0, attention: true },
  { value: 'soon', label: '近日(7日以内)', test: (r, n) => isSoon(r, n) && r.status !== 'cancelled' },
  { value: 'confirmed', label: '確定', test: (r) => r.status === 'confirmed' },
  { value: 'modified', label: '変更あり', test: (r) => r.status === 'modified' },
  { value: 'cancelled', label: 'キャンセル', test: (r) => r.status === 'cancelled' },
  { value: 'used', label: '利用済み', test: (r) => r.status === 'used' },
];

/** 伏せた予約番号の見えている末尾(英数字)。例 "****8K2Q" → "8K2Q" */
export function visibleSuffix(masked: string | null): string {
  return (masked ?? '').replace(/[^0-9A-Za-z]/g, '');
}

export function matchesQuery(r: Reservation, q: string, typeLabel: (t: string) => string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const fields = [r.provider_name, typeLabel(r.type), r.notes, r.holder_name].map((v) => (v ?? '').toLowerCase());
  const suffix = visibleSuffix(r.confirmation_number_masked).toLowerCase();
  return words.every((w) => fields.some((f) => f.includes(w)) || (w.length >= 3 && suffix.length > 0 && suffix.endsWith(w)));
}

export function filterReservations(list: Reservation[], c: ResCond, nowMs: number, typeLabel: (t: string) => string): Reservation[] {
  const st = STATUS_FILTERS.find((f) => f.value === c.st);
  const out = list.filter((r) => (!st || st.test(r, nowMs)) && (!c.type || r.type === c.type) && matchesQuery(r, c.q, typeLabel));
  const key = (r: Reservation): number => {
    const v = c.sort === 'deadline' ? r.cancellation_deadline : c.sort === 'added' ? r.created_at : r.start_at;
    const t = v ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };
  return [...out].sort((a, b) => (c.sort === 'added' ? key(b) - key(a) : key(a) - key(b)));
}

/** 予約のタイムゾーンでの日付(グループの見出し用)と時刻 */
export function zonedParts(iso: string | null, tz: string | null): { date: string; dateKey: string; time: string; tzNote: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const zone = tz ?? undefined;
  try {
    const date = d.toLocaleDateString('ja-JP', { timeZone: zone, month: 'numeric', day: 'numeric', weekday: 'short' });
    const dateKey = d.toLocaleDateString('sv-SE', { timeZone: zone });
    const time = d.toLocaleTimeString('ja-JP', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
    return { date, dateKey, time, tzNote: tz ? `現地時刻(${tz})` : '端末の時刻' };
  } catch {
    return null;
  }
}

export function groupByDay(list: Reservation[], sort: string): Array<{ key: string; label: string; items: Reservation[] }> {
  if (sort !== 'date') return [{ key: 'all', label: '', items: list }];
  const groups: Array<{ key: string; label: string; items: Reservation[] }> = [];
  for (const r of list) {
    const p = zonedParts(r.start_at, r.timezone_id);
    const key = p?.dateKey ?? 'none';
    const label = p ? p.date : '日時が未設定';
    const g = groups.find((x) => x.key === key);
    if (g) g.items.push(r); else groups.push({ key, label, items: [r] });
  }
  return groups;
}

/**
 * [Gate TripKitFix] 予約の合計。通貨ごとに足し、1 つの通貨だけなら「96,580 円」、混ざっていれば通貨ごとに並べる
 * (為替で勝手に換算しない)。支払いが済んだ分も同じ通貨で出す。金額の無い予約は数えない。
 */
export function reservationTotals(rs: Reservation[]): { text: string; paidText: string } {
  const sum = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const r of rs) {
    if (r.total_amount == null) continue;
    const c = (r.currency ?? '').trim() || '—';
    sum.set(c, (sum.get(c) ?? 0) + r.total_amount);
    if (SETTLED_PAYMENT.has((r.payment_status ?? '').trim().toLowerCase())) paid.set(c, (paid.get(c) ?? 0) + r.total_amount);
  }
  const fmt = (m: Map<string, number>) => Array.from(m.entries())
    .map(([c, v]) => `${v.toLocaleString('ja-JP')} ${c === 'JPY' ? '円' : c}`).join(' + ');
  if (sum.size === 0) return { text: '—', paidText: '金額の入った予約はありません' };
  return { text: fmt(sum), paidText: paid.size ? `支払い済み ${fmt(paid)}` : '支払い済みはまだありません' };
}

/** [Gate TripKitFix] 一覧の支払いの札(未入力・未払いは注意の色) */
export function paymentText(r: Reservation): string {
  const p = (r.payment_status ?? '').trim().toLowerCase();
  if (!p) return r.total_amount != null && r.total_amount > 0 ? '支払い 未入力' : '—';
  return PAYMENT_LABEL[p] ?? p;
}
export function paymentTone(r: Reservation): 'warn' | 'ok' | undefined {
  const p = (r.payment_status ?? '').trim().toLowerCase();
  if (SETTLED_PAYMENT.has(p)) return 'ok';
  if (r.status === 'cancelled' || r.status === 'used') return undefined;
  return (r.total_amount ?? 0) > 0 ? 'warn' : undefined;
}

/** [Gate TripKitFix] 要確認の行から、直す画面(詳細)を開くボタンの言葉 */
export function fixLabel(reasons: string[]): string {
  if (reasons.some((x) => x === '支払状況が未入力' || x === '未払い')) return '支払い状況を入れる';
  if (reasons.includes('未確定')) return '予約を確定する';
  if (reasons.includes('変更あり')) return '変更を確かめる';
  return '期限を確かめる';
}

/** [Gate TripKitFix] 予約の詳細で選べる支払い状況(画面に出す順) */
export const PAYMENT_CHOICES = ['paid', 'on_site', 'unpaid', 'partial', 'pending', 'not_required', 'free', 'refunded'] as const;
