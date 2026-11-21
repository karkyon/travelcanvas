/**
 * [Gate② UX P0] 候補箱の「場所を探す」の結果の出典に確からしさの共通の印を出す(docs/ux/certainty_display.md §4)。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiscoverResults from './DiscoverResults';
import type { NearbyResult } from '@/services/api/types/g11discover';

const result = (over: Partial<NearbyResult> = {}): NearbyResult => ({
  id: 'r1', provider: 'overpass', name: '伊勢神宮', category: null,
  location: { latitude: 34.45, longitude: 136.72, address: null },
  retrieved_at: '2026-11-21T09:41:00Z', distance_m: 500, within_radius: true, radius_guaranteed: true, ...over,
});
const renderWith = (results: NearbyResult[]) => render(
  <DiscoverResults results={results} base={null} saved={{}} busyId={null} canEdit={false} onSave={vi.fn()}
    lastSaved={null} onViewCandidates={vi.fn()} />);

describe('DiscoverResults の確からしさの印', () => {
  it('取得時刻がある時は出典を「実データ」、距離を「概算」で示す', () => {
    renderWith([result()]);
    const src = screen.getByTestId('discover-cert-source');
    expect(src).toHaveAttribute('data-cert', 'live');
    expect(src).toHaveTextContent('OpenStreetMap · 取得 09:41');
    expect(screen.getByTestId('discover-cert-distance')).toHaveAttribute('data-cert', 'estimate');
  });

  it('取得時刻が無い時は実データと言わず「不明」にする', () => {
    renderWith([result({ retrieved_at: null })]);
    expect(screen.getByTestId('discover-cert-source')).toHaveAttribute('data-cert', 'unknown');
  });
});
