import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { appendNotes, candidateHint, mergeUrlRows } from './placeHelpers';
import PlaceSourcesCredit from './PlaceSourcesCredit';

describe('[PlaceLookupJP] 自動取得の候補を入れる', () => {
  it('公式サイトと予約のページを URL の行へ足す(重複なし・5 件まで)', () => {
    expect(mergeUrlRows([''], { website: 'https://a.example/', links: [{ url: 'https://r.example/', label: '楽天トラベル(予約)' }] }))
      .toEqual(['https://a.example/', 'https://r.example/']);
    expect(mergeUrlRows(['https://a.example/'], { website: 'https://a.example/', links: [] })).toEqual(['https://a.example/']);
    expect(mergeUrlRows(['1', '2', '3', '4', '5'], { website: 'https://a.example/' })).toHaveLength(5);
    expect(mergeUrlRows([''], { website: null })).toEqual(['']);
  });
  it('メモへはまだ無い行だけ足す', () => {
    expect(appendNotes('', ['チェックイン 15:00〜'])).toBe('チェックイン 15:00〜');
    expect(appendNotes('予約済み', ['チェックイン 15:00〜', '予約済み'])).toBe('予約済み\nチェックイン 15:00〜');
    expect(appendNotes('x', undefined)).toBe('x');
  });
  it('出典は提供元ごとの決まったリンクで出す', () => {
    render(<PlaceSourcesCredit sources={[{ provider: 'yahoo_local', label: 'Y', credit: 'Webサービス by Yahoo! JAPAN', url: 'https://evil.example/' },
      { provider: 'unknown', label: 'x', credit: 'x', url: 'https://x.example/' }]} />);
    const link = screen.getByRole('link', { name: 'Webサービス by Yahoo! JAPAN' });
    expect(link).toHaveAttribute('href', 'https://developer.yahoo.co.jp/sitemap/');
    expect(screen.queryByText('x')).toBeNull();
  });
});

describe('[PlaceLookupAccuracy] 近くの位置', () => {
  it('予定の位置 → 同じ日の真ん中 → 旅行の真ん中', async () => {
    const { nearPoint } = await import('./placeHelpers');
    expect(nearPoint({ latitude: 1, longitude: 2 })).toEqual({ latitude: 1, longitude: 2 });
    expect(nearPoint(null, [{ latitude: 34.4, longitude: 136.8 }, { latitude: null, longitude: null }, { latitude: 34.5, longitude: 136.9 }]))
      .toEqual({ latitude: 34.5, longitude: 136.9 });
    expect(nearPoint({ latitude: null }, [], [{ latitude: 35, longitude: 139 }])).toEqual({ latitude: 35, longitude: 139 });
    expect(nearPoint(undefined, [], [])).toBeNull();
  });
});

describe('[Gate PlaceTripArea] candidateHint', () => {
  const base = { name: '夫婦岩', address: '三重県伊勢市二見町江', phone: null, website: null, category: null, osm_type: null,
    latitude: 34.5, longitude: 136.8, source_url: null };
  it('旅行先からの距離・住所の細かさ・名前の一部一致を 1 行にする', () => {
    expect(candidateHint({ ...base, distance_km: 6.1, address_level: 2, name_match: 0.79 }, { label: '鳥羽市', prefecture: '三重県' }))
      .toBe('旅行先(鳥羽市)から 6.1km · 住所は町名まで');
    expect(candidateHint({ ...base, distance_km: 0.4, address_level: 3, name_match: 0.5 }, null))
      .toBe('近くの予定から 0.4km · 住所は番地まで · 名前は一部だけ一致');
  });
  it('手がかりが無ければ空(古い応答)', () => {
    expect(candidateHint(base)).toBe('');
    expect(candidateHint({ ...base, address: null, address_level: 0 })).toBe('');
  });
});
