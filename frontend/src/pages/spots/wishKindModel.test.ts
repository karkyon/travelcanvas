import { describe, it, expect } from 'vitest';
import type { WishSpot } from '@/services/api/spotIntake';
import { dayTripHref, groupByRegion, kindCounts, kindOf, regionOf, sortNear, sourceText } from './wishKindModel';

const s = (o: Partial<WishSpot>): WishSpot => ({ id: o.name ?? 'x', name: 'x', description: null, category: 'other', address: null,
  latitude: null, longitude: null, price_range: null, image_url: null, created_at: '2026-11-28T03:00:00Z', ...o });

describe('行きたい場所の札・元・地域・近い順 (FR-062)', () => {
  it('今までの行(wish_kind null)は今度に数える。エリアは種類より優先', () => {
    const list = [s({ name: 'a' }), s({ name: 'b', wish_kind: 'next' }), s({ name: 'c', wish_kind: 'again' }),
      s({ name: 'd', wish_kind: 'again', wish_scope: 'area' })];
    expect(list.map(kindOf)).toEqual(['next', 'next', 'again', 'area']);
    expect(kindCounts(list)).toEqual({ all: 4, next: 2, again: 1, area: 1 });
  });
  it('残した元の文', () => {
    expect(sourceText(s({ source_kind: 'today', source_label: '伊勢・おかげ横丁の旅', wish_note: '時間がなくて行けず' })))
      .toBe('伊勢・おかげ横丁の旅(11/28)の当日に保存 · 『時間がなくて行けず』');
    expect(sourceText(s({ source_kind: 'route', source_label: '桂坂・西山の森' }))).toBe('日帰り『桂坂・西山の森』のルートから保存');
    expect(sourceText(s({ source_kind: 'visit', again_count: 2 }))).toBe('旅の記録から保存 · また行きたい 2 回');
    expect(sourceText(s({}))).toBeNull();
  });
  it('地域でまとめる(都道府県・市区町村。住所なしは最後)', () => {
    expect(regionOf('三重県伊勢市宇治中之切町26')).toBe('三重県 伊勢市');
    expect(regionOf('〒100-0001 東京都千代田区千代田1-1')).toBe('東京都 千代田区');
    expect(regionOf('京都府京都市西京区')).toBe('京都府 京都市');
    expect(regionOf(null)).toBe('住所なし');
    const g = groupByRegion([s({ name: 'x', address: null }), s({ name: 'a', address: '三重県伊勢市1' }), s({ name: 'b', address: '三重県伊勢市2' })]);
    expect(g.map((x) => [x.region, x.items.length])).toEqual([['三重県 伊勢市', 2], ['住所なし', 1]]);
  });
  it('近い順(位置の無い場所は最後)', () => {
    const list = [s({ name: 'far', latitude: 35, longitude: 136 }), s({ name: 'none' }), s({ name: 'near', latitude: 34.46, longitude: 136.72 })];
    expect(sortNear(list, { lat: 34.46, lng: 136.72 }).map((x) => x.name)).toEqual(['near', 'far', 'none']);
  });
  it('ここから日帰りの値の受け渡し', () => {
    expect(dayTripHref('abc-1')).toBe('/planner?new=1&mode=day&spot=abc-1');
  });
});
