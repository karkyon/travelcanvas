/** [Gate JourneyEnds] 日の最初・最後の出発・到着・宿の決め方 */
import { describe, it, expect } from 'vitest';
import { anchorText, dayAnchors, nightlyLodging } from './journeyModel';

type Ev = { title: string; category: string; location_name?: string };
let n = 0;
const d = (...events: Ev[]) => ({ events: events.map((e) => ({ id: `e${++n}`, ...e })) as never[] });
const mid0 = (plan: Parameters<typeof dayAnchors>[0]) => dayAnchors(plan, 1);
const hotel = (title: string): Ev => ({ title, category: 'accommodation' });
const sight = (title: string): Ev => ({ title, category: 'sightseeing' });

describe('旅のつなぎの行', () => {
  it('宿はその日の最後の「宿」の予定。無い日は前の宿に連泊の想定、前にも無ければ null', () => {
    expect(nightlyLodging([d(sight('a')), d(hotel('A館'), hotel('B館')), d(sight('b')), d()]).map((x) => x && { place: x.place, continued: x.continued }))
      .toEqual([null, { place: 'B館', continued: false }, { place: 'B館', continued: true }, { place: 'B館', continued: true }]);
  });

  it('出発・到着を出す旅行: 1 日目の最初に出発、最終日の最後に到着。途中の日は宿', () => {
    const plan = { journey_enabled: true, journey_start_place: '自宅', journey_start_time: '07:30:00', journey_end_place: ' ', journey_end_time: null,
      days: [d(hotel('鳥羽の宿')), d(sight('水族館')), d(sight('伊勢神宮'))] };
    const first = dayAnchors(plan, 0);
    expect(first.start).toMatchObject({ kind: 'departure', place: '自宅', time: '07:30' });
    expect(mid0(plan).start?.eventId).toBeTruthy();
    expect(first.end).toMatchObject({ kind: 'lodging-to', place: '鳥羽の宿', continued: false });
    const mid = dayAnchors(plan, 1);
    expect(mid.start).toMatchObject({ kind: 'lodging-from', place: '鳥羽の宿' });
    expect(mid.end).toMatchObject({ kind: 'lodging-to', continued: true });
    const last = dayAnchors(plan, 2);
    expect(last.end).toMatchObject({ kind: 'arrival', place: null });
    expect(anchorText(last.end!)).toEqual({ label: '帰着', body: '帰着地(未設定)' });
    expect(anchorText(first.start!).body).toBe('自宅 · 07:30');
  });

  it('出さない旅行は出発・到着なし。宿が無ければ「未設定」。1 日の旅行は何も出さない', () => {
    const plan = { journey_enabled: false, days: [d(sight('a')), d(sight('b'))] };
    expect(dayAnchors(plan, 0)).toEqual({ start: null, end: { kind: 'lodging-missing', place: null, time: null, continued: false } });
    expect(dayAnchors(plan, 1)).toEqual({ start: null, end: null });
    expect(dayAnchors({ days: [d(sight('a'))] }, 0)).toEqual({ start: null, end: null });
  });

  it('[JourneyMove] 出発・帰着に移動手段と所要時間、宿の行に宿の予定の ID', () => {
    const plan = { journey_enabled: true, journey_start_mode: 'driving', journey_start_minutes: 40, journey_end_mode: 'train',
      journey_end_minutes: null, days: [d(hotel('鳥羽の宿')), d(sight('水族館'))] };
    expect(dayAnchors(plan, 0).start).toMatchObject({ kind: 'departure', mode: 'driving', minutes: 40 });
    expect(dayAnchors(plan, 1).end).toMatchObject({ kind: 'arrival', mode: 'train', minutes: null });
    const hotelId = (plan.days[0]!.events[0] as unknown as { id: string }).id;
    expect(dayAnchors(plan, 1).start).toMatchObject({ kind: 'lodging-from', eventId: hotelId });
    expect(dayAnchors(plan, 0).end).toMatchObject({ kind: 'lodging-to', eventId: hotelId });
  });
});
