/** [Gate HomeLive] 旅行中のホームの決まり */
import { describe, it, expect } from 'vitest';
import { clockIn, guideUrl, liveState, untilLabel } from './tripLiveModel';

describe('[HomeLive] 旅行中のホーム', () => {
  it('案内: 座標があれば公共交通の道順、無ければ住所で探す。どちらも無ければ出さない', () => {
    expect(guideUrl({ latitude: 35, longitude: 135, address: null }, { latitude: 35.1, longitude: 135.2, address: null }))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=35.1%2C135.2&travelmode=transit&origin=35%2C135');
    expect(guideUrl(null, { latitude: null, longitude: null, address: '京都駅' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=%E4%BA%AC%E9%83%BD%E9%A7%85');
    expect(guideUrl(null, { latitude: null, longitude: null, address: null })).toBeNull();
  });
  it('残り時間と状態', () => {
    expect(untilLabel(0)).toBe('まもなく');
    expect(untilLabel(45)).toBe('あと 45 分');
    expect(untilLabel(125)).toBe('あと 2 時間 5 分');
    expect(untilLabel(null)).toBeNull();
    expect(liveState('a', 'a', 'b', [])).toBe('now');
    expect(liveState('b', 'a', 'b', [])).toBe('next');
    expect(liveState('c', 'a', 'b', ['c'])).toBe('done');
    expect(liveState('d', 'a', 'b', ['c'])).toBe('later');
  });
  it('現地の時刻(旅行先のタイムゾーン)', () => {
    expect(clockIn(Date.UTC(2026, 10, 15, 0, 5), 'Asia/Tokyo')).toBe('09:05');
    expect(clockIn(Date.UTC(2026, 10, 15, 0, 5), 'Not/AZone')).toMatch(/^\d{2}:\d{2}$/);
  });
});
