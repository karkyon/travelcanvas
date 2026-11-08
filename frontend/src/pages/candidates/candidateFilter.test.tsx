import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PlanCandidateItem } from '@/services/api';
import { EMPTY_FILTER, applyFilter, areaOf, facets, kindOf, parseTags } from './candidateFilter';

const m = vi.hoisted(() => ({
  getCandidates: vi.fn(), createCandidate: vi.fn(), updateCandidate: vi.fn(), deleteCandidate: vi.fn(),
  scheduleCandidate: vi.fn(), mergeCandidate: vi.fn(), getPlanDetail: vi.fn(),
}));
vi.mock('@/services/api', () => ({ ...m, default: { getPlanDetail: m.getPlanDetail } }));
vi.mock('./CandidateVoting', () => ({ default: () => null }));
vi.mock('@/services/api/spotIntake', () => ({ createWishSpot: vi.fn(), enrichWishSpot: vi.fn() }));
import CandidatesPage from '../CandidatesPage';

const item = (over: Partial<PlanCandidateItem>): PlanCandidateItem => ({
  id: 'x', title: 'x', note: null, source_kind: 'search', source_url: null, source_label: null, provider: 'wikipedia',
  retrieved_at: null, place_id: null, category: null, address: null, latitude: null, longitude: null, priority: 2, tags: [],
  status: 'open', status_label: '候補', scheduled_event_id: null, merged_into_id: null, created_by: 'me',
  created_at: '2026-11-03T11:42:00Z', revision: 1, duplicates: [], merged_from: [], ...over,
});
const items = [
  item({ id: 'a', title: '鳥羽城', category: 'castle', address: '三重県鳥羽市鳥羽3丁目', latitude: 34.48, longitude: 136.84, priority: 1, tags: ['朝'] }),
  item({ id: 'b', title: '鳥羽マルシェ', category: 'marketplace', address: '〒517-0011 三重県鳥羽市鳥羽1-2383', latitude: 34.486, longitude: 136.843, tags: ['朝', '雨の日'] }),
  item({ id: 'c', title: '伊勢うどん 岡田屋', category: 'restaurant', address: '三重県伊勢市宇治今在家町31', latitude: 34.46, longitude: 136.72, status: 'scheduled', status_label: '予定に配置済み' }),
  item({ id: 'd', title: '見送った店', category: 'cafe', status: 'dismissed', status_label: '見送り', created_at: '2026-11-05T00:00:00Z' }),
];

describe('[CandidateFilters] 絞り込みの決まり', () => {
  it('種類・エリア・言葉・タグ・状態・並べ替え', () => {
    expect(kindOf(items[0]!)).toBe('sight');
    expect(kindOf(items[1]!)).toBe('shop');
    expect(kindOf(items[2]!)).toBe('food');
    expect(areaOf('〒517-0011 三重県鳥羽市鳥羽1-2383')).toBe('鳥羽市');
    expect(areaOf('東京都渋谷区神南1')).toBe('渋谷区');
    expect(areaOf(null)).toBeNull();
    expect(applyFilter(items, EMPTY_FILTER).map((c) => c.id)).toEqual(['a', 'b', 'c']);  // 見送り以外・優先度順
    expect(applyFilter(items, { ...EMPTY_FILTER, status: 'all', sort: 'new' })[0]!.id).toBe('d');
    expect(applyFilter(items, { ...EMPTY_FILTER, areas: ['鳥羽市'] }).map((c) => c.id)).toEqual(['a', 'b']);
    expect(applyFilter(items, { ...EMPTY_FILTER, tags: ['朝', '雨の日'] }).map((c) => c.id)).toEqual(['b']);
    expect(applyFilter(items, { ...EMPTY_FILTER, q: 'うどん' }).map((c) => c.id)).toEqual(['c']);
    expect(applyFilter(items, { ...EMPTY_FILTER, sort: 'distance' }, { latitude: 34.46, longitude: 136.72 })[0]!.id).toBe('c');
    expect(facets(items).tags).toEqual([['朝', 2], ['雨の日', 1]]);
    expect(parseTags('#雨の日、朝 子ども,')).toEqual(['雨の日', '朝', '子ども']);
  });
});

describe('[CandidateFilters] 候補箱の画面', () => {
  beforeEach(() => {
    for (const fn of Object.values(m)) fn.mockReset();
    window.localStorage.clear();
    m.getPlanDetail.mockResolvedValue({ data: { days: [] } });
    m.getCandidates.mockResolvedValue({ plan_id: 'p1', items, counts: { open: 2, scheduled: 1, dismissed: 1 }, duplicate_pairs: 0, can_edit: true });
  });
  const renderPage = () => render(
    <MemoryRouter initialEntries={['/planner/p1/candidates']}>
      <Routes><Route path="/planner/:planId/candidates" element={<CandidatesPage />} /></Routes>
    </MemoryRouter>,
  );

  it('言葉・エリア・タグで絞り、一覧の表示に切り替え、条件を覚える', async () => {
    renderPage();
    const list = await screen.findByRole('region', { name: '候補の一覧' });
    expect(within(list).getAllByRole('article')).toHaveLength(3);
    fireEvent.click(screen.getByTestId('candidate-area-鳥羽市'));
    expect(screen.getByTestId('candidate-shown')).toHaveTextContent('4件中 2件');
    fireEvent.click(screen.getByTestId('candidate-tag-雨の日'));
    expect(screen.getByTestId('candidate-shown')).toHaveTextContent('4件中 1件');
    fireEvent.click(screen.getByTestId('candidate-view-list'));
    expect(within(screen.getByTestId('candidate-list')).getAllByRole('listitem')).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem('tc-candidate-filter:p1') ?? '{}').view).toBe('list');
    fireEvent.click(screen.getByTestId('candidate-clear'));
    expect(screen.getByTestId('candidate-shown')).toHaveTextContent('4件中 3件');
    fireEvent.change(screen.getByTestId('candidate-q'), { target: { value: '該当なし' } });
    expect(screen.getByTestId('candidate-none')).toBeInTheDocument();
  });

  it('タグを足して保存する', async () => {
    m.updateCandidate.mockResolvedValue({ plan_id: 'p1', items, counts: { open: 2, scheduled: 1, dismissed: 1 }, duplicate_pairs: 0 });
    renderPage();
    await screen.findByRole('region', { name: '候補の一覧' });
    fireEvent.click(screen.getByRole('button', { name: '鳥羽城のタグを編集' }));
    fireEvent.change(screen.getByLabelText('鳥羽城に足すタグ'), { target: { value: '#絶景, 写真' } });
    fireEvent.click(screen.getByTestId('candidate-tags-add'));
    await waitFor(() => expect(m.updateCandidate).toHaveBeenCalledWith('p1', 'a', { tags: ['朝', '絶景', '写真'] }, 1));
  });
});
