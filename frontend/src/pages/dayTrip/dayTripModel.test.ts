import { describe, it, expect } from 'vitest';
import type { AlongResult, DayTripLeg } from '@/services/api/dayTrip';
import { decodePolyline } from '@/services/api/dayTrip';
import { arrivalAt, compareRoads, durationText, etaText, homeEta, nextWidth, rowLine, tollText } from './dayTripModel';

const leg = (o: Partial<DayTripLeg>): DayTripLeg => ({ leg: 'out', origin: { label: 'a', lat: 0, lng: 0 }, destination: { label: 'b', lat: 0, lng: 0 },
  road: 'highway', depart_at: '09:00', home_by: '19:00', polyline: '', distance_m: 48000, duration_s: 4320, toll_jpy: 1320,
  provider: 'google', arrive_at: '10:12', computed_at: '', revision: 1, ...o });

describe('日帰りの見込みの計算 (FR-061)', () => {
  it('時間・距離・料金の文', () => {
    expect(durationText(4320)).toBe('1時間12分');
    expect(durationText(2700)).toBe('45分');
    expect(tollText(1320, 'highway')).toBe('料金 約1,320円');
    expect(tollText(null, 'local')).toBe('料金なし');
    expect(tollText(null, 'highway')).toBe('料金 不明');
  });
  it('行の文(寄り道の時間・高速を降りる札・直線は時間なし)', () => {
    const r = { off_m: 300, detour_min: 6, at_km: 12, exit_unknown: false } as AlongResult;
    expect(rowLine(r)).toBe('ルートから 300m · 寄り道 +6分 · 12km 目');
    expect(rowLine({ ...r, detour_min: null, off_m: 2500 })).toBe('ルートから 2.5km · 12km 目');
    expect(rowLine({ ...r, exit_unknown: true })).toContain('高速を降りる場合 +約15分');
  });
  it('着く見込みは前の寄り道の分だけ遅れ、家に着く見込みも足す', () => {
    const out = leg({});
    expect(arrivalAt(out, 48, 24, [])).toBe('09:36');
    const added = [{ key: 'x', leg: 'out' as const, at_km: 10, detour_min: 6, stay_min: 40 }];
    expect(arrivalAt(out, 48, 24, added)).toBe('10:22');
    const back = leg({ leg: 'back', depart_at: '16:30', duration_s: 4320 });
    expect(homeEta(back, added)).toBe('18:28');
    expect(etaText('18:40', '19:00')).toEqual({ text: '家に着く見込み 18:40(19:00 まで あと 20 分)', late: false });
    expect(etaText('19:10', '19:00')?.late).toBe(true);
  });
  it('幅を 1 段広げる・比べる道', () => {
    expect(nextWidth(300)).toBe(1000);
    expect(nextWidth(5000)).toBeNull();
    expect(compareRoads('auto')).toEqual(['auto', 'local']);
    expect(compareRoads('local')).toEqual(['local', 'highway']);
  });
  it('線を読む(Google の encoded polyline)', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });
});
