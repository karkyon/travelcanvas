/**
 * [Gate P4] しおり画面の整形・入力検証(bookletModel)の単体テスト。
 */
import { THEME_WORDS, fontUrl } from './bookletThemes';
import { buildOverview, buildTimeline, longDate, shortDate, unplacedMoves, THEME_OPTIONS } from './bookletModel';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPTIONS, defaultValidUntil, describeIncludes, eventTypeLabel, isSensitive, orderSections, tocSections,
  validUntilToIso,
} from './bookletModel';

describe('bookletModel (Gate P4)', () => {
  it('章は決まった順に並べ、目次には表紙・目次を載せない', () => {
    expect(orderSections(['notes', 'cover', 'schedule'])).toEqual(['cover', 'schedule', 'notes']);
    expect(tocSections(DEFAULT_OPTIONS.sections)).toEqual(['schedule', 'map', 'reservations', 'packing', 'contacts', 'costs', 'notes']);
  });

  it('機密項目の判定と表示', () => {
    expect(isSensitive(DEFAULT_OPTIONS.includes)).toBe(false);
    const inc = { ...DEFAULT_OPTIONS.includes, phones: true, confirmation_numbers: true };
    expect(isSensitive(inc)).toBe(true);
    expect(describeIncludes(inc)).toBe('含む機密項目: 予約番号・電話番号');
    expect(describeIncludes(DEFAULT_OPTIONS.includes)).toBe('機密項目なし');
  });

  it('有効期限: 初期値は旅行の翌週(過ぎていれば30日後)で90日以内、過去と90日超は拒否', () => {
    const now = new Date('2026-10-11T12:00:00');
    expect(defaultValidUntil('2026-11-03', now)).toBe('2026-11-10');
    expect(defaultValidUntil('2026-01-01', now)).toBe('2026-11-10');
    expect(defaultValidUntil('2027-12-01', now)).toBe('2027-01-09');
    expect(defaultValidUntil(null, now)).toBe('2026-11-10');
    expect(validUntilToIso('2026-10-10', now)).toEqual({ ok: false, error: '有効期限には今日以降の日付を指定してください' });
    expect(validUntilToIso('2027-03-01', now).ok).toBe(false);
    expect(validUntilToIso('', now).ok).toBe(false);
    const ok = validUntilToIso('2026-10-20', now);
    expect(ok.ok && new Date(ok.data).getTime()).toBe(new Date('2026-10-20T23:59:59').getTime());
  });

  it('予定の種類は文字で示す(白黒でも区別できる)。未知の値はそのまま', () => {
    expect(eventTypeLabel('sightseeing')).toBe('観光');
    expect(eventTypeLabel('custom')).toBe('custom');
  });
});

describe('[Gate BookletPatterns] 大日程と日別の行程', () => {
  const ev = (title: string, event_type: string, t: string | null, reservations: { type: string; provider_name: string | null; status: string }[] = []) => ({
    title, event_type, local_start_time: t, is_all_day: false, end: null, place_name: null, address: null, locked: false, reservations,
  });
  const day = (date: string, events: ReturnType<typeof ev>[]) => ({ date, title: null, timezone_id: 'Asia/Tokyo', events });
  const move = { mode: 'train', from_label: '清水寺', to_label: '祇園', departure: '2027-04-10 12:00', arrival: '2027-04-10 12:20', duration_minutes: 20, transport_number: null, platform: null, status: 'planned', is_estimate: false };

  it('曜日は端末の時刻帯に関係なく書かれた日付で決まる', () => {
    expect(shortDate('2027-04-10')).toBe('4/10(土)');
    expect(longDate('2027-04-10')).toBe('2027年4月10日(土)');
    expect(longDate(null)).toBe('日付未定');
  });
  it('大日程は主な予定と、期間が重なる宿泊の予約を 1 行にする', () => {
    const d = day('2027-04-10', [ev('駅へ', 'transport', '09:00'), ev('清水寺', 'sightseeing', '10:00'), ev('祇園', 'meal', '12:00')]);
    const rows = buildOverview({ schedule: { days: [d], transport: [] }, reservations: [{ type: 'accommodation', provider_name: '京の宿', status: 'confirmed', start: '2027-04-10 15:00', end: '2027-04-11 10:00', timezone_id: null, guest_count: null, confirmation: null, confirmation_is_full: false, contact_phone: null, cancellation_deadline: null, payment_status: null }] });
    expect(rows[0]).toMatchObject({ no: 1, highlights: ['清水寺', '祇園'], stay: '京の宿', start: '09:00' });
  });
  it('移動は出発する予定の後へ入り、どの日にも入らない移動は別に残る', () => {
    const d = day('2027-04-10', [ev('清水寺', 'sightseeing', '10:00'), ev('祇園', 'meal', '13:00')]);
    expect(buildTimeline(d, [move]).map((x) => x.kind)).toEqual(['event', 'move', 'event']);
    expect(unplacedMoves([d], [move, { ...move, departure: null }])).toHaveLength(1);
  });
  it('12 パターンのどれも見出しの言葉と字体を持つ', () => {
    for (const t of THEME_OPTIONS) {
      expect(THEME_WORDS[t.value].day(1)).toBeTruthy();
      expect(fontUrl(t.value)).toContain('fonts.googleapis.com');
    }
    expect(THEME_OPTIONS).toHaveLength(15);
  });
});
