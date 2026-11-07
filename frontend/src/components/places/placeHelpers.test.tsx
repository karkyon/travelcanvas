import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { appendNotes, mergeUrlRows } from './placeHelpers';
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
