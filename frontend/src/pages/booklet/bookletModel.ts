/**
 * [Gate P4] しおり・印刷(FR-034/035/046)の表示名・入力検証・整形。
 *
 * backend(app/services/booklet.py、booklet-v1)の規則に合わせる:
 *   - 章は決まった順に並ぶ(選んだ順ではない)
 *   - 予約番号・住所・電話・参加者名を含めると「機密情報を含む版」になり、有効期限(90日以内)が必須、
 *     作成者名の透かしが入る。含められるのは旅行の所有者だけ
 *   - QR・チケットの中身はどの設定でも含めない
 */
import type {
  BookletExport, BookletIncludes, BookletOptions, BookletSection, BookletTheme, BookletWarning,
} from '@/services/api';

export const THEME_OPTIONS: { value: BookletTheme; label: string; help: string }[] = [
  { value: 'simple', label: '簡潔', help: '情報を絞った標準の見た目' },
  { value: 'cute', label: 'かわいい', help: '丸みのある柔らかい配色' },
  { value: 'family', label: '家族', help: '大きめの見出しと集合時刻の強調' },
  { value: 'school', label: '学校', help: '行程表形式。引率・配布向け' },
  { value: 'business', label: '出張', help: '移動と予約を中心に簡潔に' },
  { value: 'accessible', label: 'アクセシブル', help: '大きな文字・高コントラスト' },
  { value: 'mono', label: '白黒', help: '色なしで印刷しても区別できる' },
];

export const SECTION_OPTIONS: { value: BookletSection; label: string }[] = [
  { value: 'cover', label: '表紙' },
  { value: 'toc', label: '目次' },
  { value: 'schedule', label: '日程' },
  { value: 'map', label: '地図(場所の一覧)' },
  { value: 'reservations', label: '予約' },
  { value: 'packing', label: '持ち物' },
  { value: 'contacts', label: '連絡先' },
  { value: 'costs', label: '費用' },
  { value: 'notes', label: '注意事項' },
];
export const SECTION_LABEL = Object.fromEntries(SECTION_OPTIONS.map((o) => [o.value, o.label])) as Record<BookletSection, string>;

export const INCLUDE_OPTIONS: { key: keyof BookletIncludes; label: string; help: string }[] = [
  { key: 'confirmation_numbers', label: '予約番号(全桁)', help: '含めない場合は末尾4桁以外を伏せます' },
  { key: 'addresses', label: '住所・座標', help: '含めない場合は施設名だけを載せます' },
  { key: 'phones', label: '電話番号', help: '予約先の連絡先電話' },
  { key: 'participants', label: '参加者の名前', help: '含めない場合は人数だけを載せます' },
];

export const WARNING_TEXT: Record<BookletWarning, string> = {
  stale_revision: 'この版の作成後に旅程が更新されています。最新の内容は新しい版を作成してください。',
  contains_sensitive: '機密情報(予約番号・住所・電話・参加者名のいずれか)を含みます。取り扱いに注意してください。',
  qr_not_included: 'チケット・QRコードは含めていません。当日はアプリのチケット画面で表示してください。',
  unconverted_expenses: '換算レートが未入力の外貨の支出は、費用の合計に含まれていません。',
};

export const DEFAULT_OPTIONS: BookletOptions = {
  theme: 'simple',
  density: 'normal',
  format: 'print',
  sections: ['cover', 'toc', 'schedule', 'map', 'reservations', 'packing', 'contacts', 'costs', 'notes'],
  includes: { confirmation_numbers: false, addresses: false, phones: false, participants: false },
};

export const MAX_VALID_DAYS = 90;

const EVENT_TYPE_LABEL: Record<string, string> = {
  sightseeing: '観光', activity: 'アクティビティ', meal: '食事', dining: '食事', restaurant: '食事',
  transport: '移動', transportation: '移動', accommodation: '宿泊', lodging: '宿泊', shopping: '買い物',
  meeting: '集合', museum: '美術館・博物館', other: 'その他',
};
export const eventTypeLabel = (t: string): string => EVENT_TYPE_LABEL[t] ?? t;

const RESERVATION_TYPE_LABEL: Record<string, string> = {
  accommodation: '宿泊', flight: '航空', train: '鉄道', bus: 'バス', ferry: '船', rental_car: 'レンタカー',
  restaurant: '飲食', activity: '体験', admission: '入場', other: 'その他',
};
export const reservationTypeLabel = (t: string): string => RESERVATION_TYPE_LABEL[t] ?? t;

const RESERVATION_STATUS_LABEL: Record<string, string> = {
  candidate: '候補', confirmed: '確定', modified: '変更済み', cancelled: '取消', used: '利用済み', no_show: '不泊・不参加',
};
export const reservationStatusLabel = (s: string): string => RESERVATION_STATUS_LABEL[s] ?? s;

const MODE_LABEL: Record<string, string> = {
  walking: '徒歩', driving: '車', train: '鉄道', bus: 'バス', ferry: '船', flight: '航空', bicycle: '自転車',
  taxi: 'タクシー', mixed: '混合',
};
export const modeLabel = (m: string): string => MODE_LABEL[m] ?? m;

export const isSensitive = (inc: BookletIncludes): boolean => Object.values(inc).some(Boolean);

/** 選んだ章を決まった順に並べる(backendと同じ順) */
export const orderSections = (sections: BookletSection[]): BookletSection[] =>
  SECTION_OPTIONS.map((o) => o.value).filter((s) => sections.includes(s));

/** 目次に載せる章(表紙・目次自身は除く) */
export const tocSections = (sections: BookletSection[]): BookletSection[] =>
  orderSections(sections).filter((s) => s !== 'cover' && s !== 'toc');

const pad = (n: number) => String(n).padStart(2, '0');
export const toDateInput = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 有効期限の初期値: 旅行の最終日の翌週(過ぎていれば今日から30日)。90日を超えないよう丸める。 */
export function defaultValidUntil(endDate: string | null | undefined, now: Date = new Date()): string {
  const limit = new Date(now.getTime() + MAX_VALID_DAYS * 86_400_000);
  let d = new Date(now.getTime() + 30 * 86_400_000);
  if (endDate && /^\d{4}-\d{2}-\d{2}/.test(endDate)) {
    const end = new Date(`${endDate.slice(0, 10)}T00:00:00`);
    const candidate = new Date(end.getTime() + 7 * 86_400_000);
    if (candidate > now) d = candidate;
  }
  return toDateInput(d > limit ? limit : d);
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** 有効期限(日付)→ その日の終わり(端末の時刻帯)のISO文字列。過去・90日超は拒否する。 */
export function validUntilToIso(dateText: string, now: Date = new Date()): Result<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return { ok: false, error: '有効期限の日付を入力してください' };
  const d = new Date(`${dateText}T23:59:59`);
  if (Number.isNaN(d.getTime())) return { ok: false, error: '有効期限の日付が正しくありません' };
  if (d <= now) return { ok: false, error: '有効期限には今日以降の日付を指定してください' };
  if (d.getTime() > now.getTime() + MAX_VALID_DAYS * 86_400_000) {
    return { ok: false, error: `有効期限は${MAX_VALID_DAYS}日以内で指定してください` };
  }
  return { ok: true, data: d.toISOString() };
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${toDateInput(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const EXPORT_STATE_LABEL: Record<BookletExport['state'], string> = {
  active: '有効', revoked: '失効', expired: '期限切れ',
};

export function describeIncludes(inc: BookletIncludes): string {
  const names = INCLUDE_OPTIONS.filter((o) => inc[o.key]).map((o) => o.label.replace('(全桁)', ''));
  return names.length ? `含む機密項目: ${names.join('・')}` : '機密項目なし';
}
