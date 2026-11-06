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
  Booklet, BookletDay, BookletEvent, BookletExport, BookletIncludes, BookletOptions, BookletSection, BookletTheme,
  BookletTransport, BookletWarning,
} from '@/services/api';

export const THEME_OPTIONS: { value: BookletTheme; label: string; help: string; swatch: [string, string] }[] = [
  { value: 'simple', label: '簡潔', help: '情報を絞ってすぐ印刷', swatch: ['#111111', '#ffffff'] },
  { value: 'functional', label: '機能的', help: '時間軸と地図。日ごとに色分け', swatch: ['#0b6bcb', '#eef2f6'] },
  { value: 'business', label: '仕事', help: '紺の報告書形式。出張向け', swatch: ['#14304f', '#ffffff'] },
  { value: 'family', label: '家族', help: '絵本のように明るく、丸く', swatch: ['#2fa8cf', '#ffcf3f'] },
  { value: 'friends', label: '友人・仲間', help: '雑誌のように大胆に', swatch: ['#ff3f6c', '#fff600'] },
  { value: 'wild', label: 'ワイルド', help: '探検の航海日誌', swatch: ['#23331f', '#e8a33d'] },
  { value: 'lovers', label: '恋人', help: '手紙のようにやわらかく', swatch: ['#e98f73', '#fbf3ea'] },
  { value: 'elegant', label: 'エレガント', help: '深緑と金。明朝のガイドブック', swatch: ['#16302b', '#c9ad6e'] },
  { value: 'calm', label: '落ち着いた', help: '和綴じ風。大きな文字で読みやすく', swatch: ['#5a4a3a', '#e8e2d0'] },
  { value: 'solo', label: '一人旅', help: '方眼の手帳', swatch: ['#1c4e72', '#faf8f1'] },
  { value: 'school', label: '学校・団体', help: 'コピーして配れる行程表', swatch: ['#000000', '#dddddd'] },
  { value: 'space', label: '宇宙旅行', help: '黒と銀の飛行計画書', swatch: ['#090d12', '#ffb547'] },
  { value: 'resort', label: 'リゾート', help: '南の海と砂浜。休日の旅に', swatch: ['#13a3b4', '#fbe6c4'] },
  { value: 'cute', label: 'かわいい', help: '丸みのある柔らかい配色', swatch: ['#f06292', '#fde7ef'] },
  { value: 'accessible', label: 'アクセシブル', help: '大きな文字・高コントラスト', swatch: ['#000000', '#ffff00'] },
  { value: 'mono', label: '白黒', help: '色なしで印刷しても区別できる', swatch: ['#444444', '#ffffff'] },
];

/** [Gate BookletPatterns] 必ず載せる章(タイトル・日程・エリア・地図・大日程・日別の行程表) */
export const REQUIRED_SECTIONS: BookletSection[] = ['cover', 'schedule', 'map'];

export const SECTION_OPTIONS: { value: BookletSection; label: string }[] = [
  { value: 'cover', label: '表紙' },
  { value: 'toc', label: '目次' },
  { value: 'schedule', label: '大日程と日別の行程表' },
  { value: 'map', label: '地図' },
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

// ===== [Gate BookletPatterns] 大日程と日別の行程表 =====

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const ymd = (text: string): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
/** 2026-11-21 → 11/21(土)。端末の時刻帯に関係なく、書かれた日付の曜日にする */
export function shortDate(text: string): string {
  const d = ymd(text);
  if (!d) return text;
  return `${d[1]}/${d[2]}(${WEEK[new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDay()]})`;
}
export function longDate(text: string | null | undefined): string {
  const d = text ? ymd(text) : null;
  return d ? `${d[0]}年${d[1]}月${d[2]}日(${WEEK[new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDay()]})` : '日付未定';
}
export const clock = (t: string | null | undefined): string => (t ? (/\d{1,2}:\d{2}/.exec(t)?.[0] ?? t) : '');

const isStay = (e: BookletEvent): boolean =>
  ['accommodation', 'lodging'].includes(e.event_type) || e.reservations.some((r) => r.type === 'accommodation');
const isMove = (e: BookletEvent): boolean => ['transport', 'transportation'].includes(e.event_type);

export interface OverviewRow {
  no: number; date: string; title: string | null; start: string; highlights: string[]; more: number; stay: string | null;
}

/** 大日程: 1 日を 1 行にする。宿は予定か、期間が重なる宿泊の予約から決める */
export function buildOverview(b: Pick<Booklet, 'schedule' | 'reservations'>): OverviewRow[] {
  return (b.schedule?.days ?? []).map((d, i) => {
    const stayEvent = d.events.find(isStay);
    const reserved = (b.reservations ?? []).find((r) => r.type === 'accommodation' && r.start && r.status !== 'cancelled'
      && r.start.slice(0, 10) <= d.date && (r.end ? r.end.slice(0, 10) > d.date : r.start.slice(0, 10) === d.date));
    const main = d.events.filter((e) => !isStay(e) && !isMove(e));
    const list = main.length ? main : d.events.filter((e) => !isStay(e));
    const first = d.events.find((e) => e.local_start_time);
    return {
      no: i + 1, date: d.date, title: d.title, start: clock(first?.local_start_time), highlights: list.slice(0, 4).map((e) => e.title),
      more: Math.max(0, list.length - 4),
      stay: reserved?.provider_name ?? stayEvent?.reservations.find((r) => r.type === 'accommodation')?.provider_name
        ?? stayEvent?.place_name ?? stayEvent?.title ?? null,
    };
  });
}

export type TimelineItem = { kind: 'event'; event: BookletEvent } | { kind: 'move'; move: BookletTransport };

/** 日別の行程: 出発日がこの日の移動を、出発する予定の後(無ければ時刻の順)へ入れる */
export function buildTimeline(day: BookletDay, transport: BookletTransport[]): TimelineItem[] {
  const items: TimelineItem[] = day.events.map((event) => ({ kind: 'event', event }));
  const moves = transport.filter((t) => t.departure?.startsWith(day.date))
    .sort((a, b) => (a.departure ?? '').localeCompare(b.departure ?? ''));
  for (const move of moves) {
    let at = -1;
    items.forEach((x, i) => { if (x.kind === 'event' && x.event.title === move.from_label) at = i; });
    if (at < 0) {
      const time = clock(move.departure);
      items.forEach((x, i) => { if (x.kind === 'event' && clock(x.event.local_start_time) && clock(x.event.local_start_time) <= time) at = i; });
    }
    items.splice(at + 1, 0, { kind: 'move', move });
  }
  return items;
}

/** どの日にも入らない移動(出発の日時が未定か、日程の外) */
export const unplacedMoves = (days: BookletDay[], transport: BookletTransport[]): BookletTransport[] =>
  transport.filter((t) => !days.some((d) => t.departure?.startsWith(d.date)));

/** 印字の前に、字体と地図の画像の読み込みを待つ(上限 5 秒。読めない地図の画像があっても印刷する) */
export async function printWhenReady(root: Document = document): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('.bk img')).filter((i) => !i.complete);
  const loaded = Promise.all(images.map((i) => new Promise((done) => {
    i.addEventListener('load', done, { once: true });
    i.addEventListener('error', done, { once: true });
  })));
  await Promise.race([Promise.all([loaded, root.fonts?.ready]), new Promise((done) => { setTimeout(done, 5000); })]);
  window.print();
}

// ===== [Gate BookletQR] Google マップのリンク(公式の Maps URLs。API の費用はかからない) =====

/** Google マップの経路で渡せる地点の上限(出発 + 途中 9 + 到着) */
export const MAX_ROUTE_STOPS = 11;
const at = (p: { latitude: number; longitude: number }) => `${p.latitude},${p.longitude}`;

const routeUrl = (list: { latitude: number; longitude: number }[]): string => {
  const middle = list.slice(1, -1).map(at).join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(at(list[0]!))}&destination=${encodeURIComponent(at(list[list.length - 1]!))}`
    + `${middle ? `&waypoints=${encodeURIComponent(middle)}` : ''}`;
};

/** 1 日の順路のリンク。上限を超える日は、つなぎ目の地点を重ねて分ける(途中を落とさない)。地点が 2 つ未満なら無し */
export function googleDayRoutes(stops: { latitude: number; longitude: number }[]): string[] {
  const list = stops.filter((p, i) => i === 0 || at(p) !== at(stops[i - 1]!));
  if (list.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i < list.length - 1; i += MAX_ROUTE_STOPS - 1) out.push(routeUrl(list.slice(i, i + MAX_ROUTE_STOPS)));
  return out;
}

export const MY_MAP_URL = /^https:\/\/www\.google\.com\/maps\/d\/[A-Za-z0-9_\-./?=&%#~+]*$/;
