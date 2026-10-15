/**
 * [Gate P10] 外部状況(アラート、FR-030)・安全な再計画(FR-031)の表示名・入力検証・整形。
 *
 * backend(app/services/replan.py、replan-v1)の規則に合わせる:
 *   - 遅延・運休: 影響を受ける予定(時刻あり)と遅れの見込み15〜720分。休業・中止: 予定。雨天・警報: 日(予定は任意)
 *   - 取得時刻は未来にできない。取得から3時間を過ぎた情報は「古い情報」として示す(現在値のように見せない)
 *   - 再計画案は本案を変えない。適用できるのは案を作った後に本案が変わっていない時だけ(変わっていれば作り直す)
 */
import type {
  AlertConfidence, AlertCreateData, AlertKind, AlertSource, AlertStatus, ReplanCandidate, ReplanChange,
  ReplanErrorDetail, ReplanState,
} from '@/services/api';

export const KIND_OPTIONS: { value: AlertKind; label: string; help: string }[] = [
  { value: 'delay', label: '遅延', help: '電車・飛行機などが遅れて、予定に遅れて着く' },
  { value: 'cancellation', label: '運休・欠航', help: '乗る予定の便が無くなり、別の手段で遅れて着く' },
  { value: 'closure', label: '休業・中止', help: '行く予定の場所が休み、またはイベントが中止になった' },
  { value: 'weather', label: '雨天・警報', help: 'その日の屋外の予定ができない' },
];
export const KIND_LABEL = Object.fromEntries(KIND_OPTIONS.map((o) => [o.value, o.label])) as Record<AlertKind, string>;

export const CONFIDENCE_LABEL: Record<AlertConfidence, string> = { confirmed: '確認済み', reported: '未確認の情報' };
export const SOURCE_LABEL: Record<AlertSource, string> = { user_report: '利用者の報告', route_status: '登録済み経路の運行状態' };
export const STATUS_LABEL: Record<AlertStatus, string> = { active: '対応中', resolved: '解決済み', dismissed: '取り下げ' };
export const REPLAN_STATE_LABEL: Record<ReplanState, string> = {
  proposed: '検討中', applied: '適用済み', applied_undone: '適用後に取り消し', rejected: '採用せず',
};

export const needsEvent = (kind: AlertKind) => kind !== 'weather';
export const needsDelay = (kind: AlertKind) => kind === 'delay' || kind === 'cancellation';

export interface AlertForm {
  kind: AlertKind;
  event_id: string;
  day_id: string;
  delay_minutes: string;
  source: AlertSource;
  source_label: string;
  confidence: AlertConfidence;
  /** datetime-local の値(端末の現地時刻)。空なら登録した時刻 */
  observed_at: string;
  note: string;
}

export const emptyAlertForm = (): AlertForm => ({
  kind: 'delay', event_id: '', day_id: '', delay_minutes: '60', source: 'user_report', source_label: '',
  confidence: 'reported', observed_at: '', note: '',
});

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function alertFormToPayload(f: AlertForm, nowMs: number = Date.now()): Result<AlertCreateData> {
  const data: AlertCreateData = { kind: f.kind, source: f.source, confidence: f.confidence };
  if (needsEvent(f.kind)) {
    if (!f.event_id) return { ok: false, error: '影響を受ける予定を選んでください' };
    data.event_id = f.event_id;
  } else {
    if (!f.day_id) return { ok: false, error: '影響を受ける日を選んでください' };
    data.day_id = f.day_id;
    if (f.event_id) data.event_id = f.event_id;
  }
  if (needsDelay(f.kind)) {
    const raw = f.delay_minutes.trim();
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!(n >= 15 && n <= 720)) return { ok: false, error: '遅れの見込みは15〜720分で入力してください' };
    data.delay_minutes = n;
  }
  const label = f.source_label.trim();
  if (label.length > 100) return { ok: false, error: '情報源は100文字までです' };
  if (label) data.source_label = label;
  if (f.observed_at) {
    const ms = Date.parse(f.observed_at);
    if (Number.isNaN(ms)) return { ok: false, error: '取得時刻の形式が正しくありません' };
    if (ms > nowMs + 10 * 60_000) return { ok: false, error: '取得時刻に未来の時刻は指定できません' };
    data.observed_at = new Date(ms).toISOString();
  }
  const note = f.note.trim();
  if (note.length > 500) return { ok: false, error: 'メモは500文字までです' };
  if (note) data.note = note;
  return { ok: true, data };
}

/** 「HH:MM取得(N分前)」。古い情報は呼び出し側で別に注意を出す */
export function formatObserved(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return '取得時刻不明';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '取得時刻不明';
  const d = new Date(ms);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const mins = Math.max(0, Math.floor((nowMs - ms) / 60_000));
  const ago = mins < 60 ? `${mins}分前` : mins < 24 * 60 ? `${Math.floor(mins / 60)}時間前` : `${Math.floor(mins / 1440)}日前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}取得(${ago})`;
}

export function formatMinutes(m: number | null): string {
  if (m === null) return '—';
  if (m === 0) return '変わらない';
  const sign = m < 0 ? '−' : '+';
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const r = abs % 60;
  return `${sign}${h > 0 ? `${h}時間` : ''}${r > 0 || h === 0 ? `${r}分` : ''}`;
}

const md = (date: string) => {
  const [, mm, dd] = date.split('-');
  return `${Number(mm)}/${Number(dd)}`;
};

export function describeChange(c: ReplanChange): string {
  const before = c.before_time ?? '時刻未定';
  const after = c.after_time ?? '時刻未定';
  if (c.before_date !== c.after_date) return `${c.title}: ${md(c.before_date)} ${before} → ${md(c.after_date)} ${after}`;
  return `${c.title}: ${before} → ${after}`;
}

export function formatCost(c: ReplanCandidate['cost_impact']): string {
  if (!c) return '—';
  if (c.lost_paid_count === 0) return '外す予定に支払い済みの費用はありません';
  const amount = Number(c.lost_paid_amount).toLocaleString('ja-JP');
  const extra = c.unconverted_count > 0 ? `(ほかに換算できない費用${c.unconverted_count}件)` : '';
  return `外す予定に支払い済みの費用 ${amount} ${c.currency}(${c.lost_paid_count}件)${extra}`;
}

/** 2つの案が同じ結果か(変わる予定・外す予定が同じ) */
export function sameOutcome(a: ReplanCandidate, b: ReplanCandidate): boolean {
  const key = (c: ReplanCandidate) => JSON.stringify([
    c.changes.map((x) => [x.event_id, x.after_date, x.after_time]).sort(),
    c.lost.map((x) => x.event_id).sort(),
  ]);
  return a.available && b.available && key(a) === key(b);
}

export function confirmText(c: ReplanCandidate): string {
  const notify = c.notify_member_names.length > 0
    ? `${c.notify_member_names.join('、')}さんへ変更を通知します。`
    : '';
  return `案${c.id}「${c.label}」で旅程を変更します。変わる予定${c.metrics.changed_count}件・外す予定${c.metrics.lost_count}件。`
    + `${notify}あとからプランの「元に戻す」で取り消せます。よろしいですか?`;
}

const CONFLICT_REASON: Record<string, string> = {
  changed_in_plan: '旅程で変更されています',
  deleted_in_plan: '旅程から削除されています',
  locked: '確定(ロック)されています',
  has_relations: '予約・移動・文書と紐付いたため外せません',
  has_reservation: '予約と紐付いたため動かせません',
  day_missing: '移す先の日程がありません',
};

/** 再計画の409を、画面の案内(code・文言・食い違った予定)にする */
export function replanErrorInfo(error: unknown): { code: ReplanErrorDetail['code'] | null; message: string; items: string[] } {
  const detail = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as Partial<ReplanErrorDetail>;
    const items = (d.conflicts ?? []).map((c) => `「${c.title ?? '予定'}」: ${CONFLICT_REASON[c.reason] ?? c.reason}`);
    return { code: (d.code as ReplanErrorDetail['code']) ?? null, message: d.message ?? '処理に失敗しました', items };
  }
  return { code: null, message: typeof detail === 'string' && detail ? detail : '処理に失敗しました', items: [] };
}
