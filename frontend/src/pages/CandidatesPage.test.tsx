/**
 * [Gate C2] CandidatesPage(候補箱、FR-007)の画面テスト。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { CandidateList } from '@/services/api';

const m = vi.hoisted(() => ({
  getCandidates: vi.fn(), createCandidate: vi.fn(), updateCandidate: vi.fn(), deleteCandidate: vi.fn(),
  scheduleCandidate: vi.fn(), mergeCandidate: vi.fn(), getPlanDetail: vi.fn(), createCandidateFromSearch: vi.fn(),
}));
vi.mock('@/services/api', () => ({ ...m, default: { getPlanDetail: m.getPlanDetail } }));

vi.mock('./candidates/CandidateVoting', () => ({ default: () => null }));
// [Gate DiscoverUX] 近くを探す部品は、押すと検索結果を画面へ渡すだけの代わりにする。地図は印の数だけを出す
const NEAR = vi.hoisted(() => [
  { id: 'n1', provider: 'overpass', name: '二見興玉神社・夫婦岩', category: '絶景', distance_m: 1800, within_radius: true,
    radius_guaranteed: true, retrieved_at: '2026-11-10T02:24:00+00:00',
    location: { latitude: 34.509, longitude: 136.785, address: '三重県伊勢市二見町江' } },
  { id: 'n2', provider: 'overpass', name: '伊勢シーパラダイス', category: '水族館', distance_m: 2100, within_radius: true,
    radius_guaranteed: true, retrieved_at: '2026-11-10T02:24:00+00:00',
    location: { latitude: 34.511, longitude: 136.79, address: '三重県伊勢市二見町江' } },
]);
vi.mock('./discover/NearbyDiscover', () => ({
  default: ({ onResults }: { onResults?: (r: unknown[], b: unknown) => void }) => (
    <button type="button" onClick={() => onResults?.(NEAR, { id: 'b', label: '旅程の場所', latitude: 34.5, longitude: 136.78 })}>近くを探す(代わり)</button>
  ),
}));
vi.mock('./discover/DiscoverMap', () => ({
  default: ({ pins, label }: { pins: unknown[]; label: string }) => <div data-testid="discover-map">{`${label} ${pins.length}件`}</div>,
}));
import CandidatesPage from './CandidatesPage';

const dupes = fx.candidates_duplicates as unknown as CandidateList;
const C3 = '00000000-0000-4000-8000-0000000000c3';
const C4 = '00000000-0000-4000-8000-0000000000c4';
const D1 = '00000000-0000-4000-8000-0000000000c2';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/planner/p1/candidates']}>
    <Routes><Route path="/planner/:planId/candidates" element={<CandidatesPage />} /></Routes>
  </MemoryRouter>,
);

const wish = vi.hoisted(() => ({ createWishSpot: vi.fn(), enrichWishSpot: vi.fn() }));
vi.mock('@/services/api/spotIntake', () => wish);

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getPlanDetail.mockResolvedValue({ data: { days: [{ id: D1, local_date: '2026-11-01', timezone_id: 'Asia/Tokyo', sort_order: 0 }] } });
  window.confirm = vi.fn(() => true);
  window.localStorage.clear();
});

describe('CandidatesPage (Gate C2)', () => {
  it('候補の出典・登録した人・重複の理由を出し、まとめられる', async () => {
    m.getCandidates.mockResolvedValue({ ...dupes, can_edit: true });
    m.mergeCandidate.mockResolvedValue(fx.candidates_merged);
    renderPage();
    const list = await screen.findByRole('region', { name: '候補の一覧' });
    expect(within(list).getByText(/重複の可能性がある候補が 1組あります/)).toBeInTheDocument();
    const cards = within(list).getAllByRole('article');
    expect(cards).toHaveLength(2);
    const first = cards[0]!;
    expect(within(first).getByRole('link', { name: 'kiyomizudera.or.jp' })).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(first).toHaveTextContent('taro が');
    expect(within(first).getByText(/同じ名前・100m以内/)).toBeInTheDocument();
    const second = cards[1]!;
    fireEvent.click(within(second).getByRole('button', { name: /にまとめる$/ }));
    await waitFor(() => expect(m.mergeCandidate).toHaveBeenCalledWith('p1', C4, C3, 1));
    expect(await screen.findByRole('status')).toHaveTextContent('は候補箱から消しました');
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('候補箱から消え'));
  });

  it('[SpotInfo] カードを押すと詳細が開き、行きたい場所に保存すると空の項目を自動で埋める', async () => {
    m.getCandidates.mockResolvedValue({ ...dupes, can_edit: true });
    wish.createWishSpot.mockResolvedValue({ id: 'w1' });
    wish.enrichWishSpot.mockResolvedValue({ spot: { id: 'w1' }, filled: ['phone', 'dining'], matched: true, source: {} });
    renderPage();
    const list = await screen.findByRole('region', { name: '候補の一覧' });
    const first = within(list).getAllByRole('article')[0]!;
    const title = first.querySelector('h3 button') as HTMLButtonElement;
    fireEvent.click(title);
    const dialog = await screen.findByTestId('candidate-detail');
    fireEvent.click(within(dialog).getByTestId('candidate-save-wish'));
    await waitFor(() => expect(wish.createWishSpot).toHaveBeenCalledTimes(1));
    expect(wish.createWishSpot.mock.calls[0]![0]).toMatchObject({ name: 'kiyomizudera.or.jp' });
    expect(wish.enrichWishSpot).toHaveBeenCalledWith('w1');
    expect(await within(dialog).findByText(/電話・食事の情報 を自動で入れました/)).toBeInTheDocument();
  });

  it('候補を足す(名前か URL が要る)', async () => {
    m.getCandidates.mockResolvedValue({ ...fx.candidates_empty, can_edit: true });
    m.createCandidate.mockResolvedValue(fx.candidate_created);
    renderPage();
    const form = await screen.findByRole('form', { name: '候補を追加' });
    fireEvent.click(within(form).getByRole('button', { name: '候補に追加' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('名前か URL を入力してください');
    fireEvent.change(within(form).getByLabelText('URL(任意)'), { target: { value: 'https://www.kiyomizudera.or.jp/?utm_source=x' } });
    fireEvent.change(within(form).getByLabelText('優先度'), { target: { value: '1' } });
    fireEvent.click(within(form).getByRole('button', { name: '候補に追加' }));
    await waitFor(() => expect(m.createCandidate).toHaveBeenCalledWith('p1', {
      title: null, source_url: 'https://www.kiyomizudera.or.jp/?utm_source=x', note: null, priority: 1,
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('候補を追加しました');
  });

  it('旅程に追加は日・時刻と revision を送り、見る人には操作を出さない', async () => {
    m.getCandidates.mockResolvedValue({ ...fx.candidates_merged, can_edit: true });
    m.scheduleCandidate.mockResolvedValue(fx.candidate_scheduled);
    const { unmount } = renderPage();
    const card = await screen.findByRole('article', { name: 'kiyomizudera.or.jp' });
    fireEvent.change(within(card).getByLabelText('時刻'), { target: { value: '09:00' } });
    fireEvent.click(within(card).getByRole('button', { name: 'kiyomizudera.or.jpを旅程に追加' }));
    await waitFor(() => expect(m.scheduleCandidate).toHaveBeenCalledWith('p1', C3, { day_id: D1, local_start_time: '09:00' }, 1));
    expect(await within(await screen.findByRole('article', { name: 'kiyomizudera.or.jp' })).findByTestId('candidate-status'))
      .toHaveTextContent('予定に配置済み');
    unmount();

    m.getCandidates.mockResolvedValue({ ...fx.candidates_merged, can_edit: false });
    renderPage();
    await screen.findByRole('region', { name: '候補の一覧' });
    expect(screen.queryByRole('form', { name: '候補を追加' })).toBeNull();
    expect(screen.queryByRole('button', { name: /旅程に追加/ })).toBeNull();
  });

  it('[DiscoverUX] 探す(未保存の検索結果)と保存済みの候補を分け、保存すると札と件数が変わり、候補一覧へ移れる', async () => {
    m.getCandidates.mockResolvedValue({ ...dupes, can_edit: true });
    m.createCandidateFromSearch.mockResolvedValue({ ...dupes, can_edit: true, counts: { ...dupes.counts, open: dupes.counts.open + 1 } });
    renderPage();
    const search = await screen.findByRole('region', { name: '場所を探す' });
    expect(search).toHaveTextContent('まだこの旅行には保存されていません');
    expect(screen.getByRole('region', { name: new RegExp(`この旅行に保存済みの候補 ${dupes.counts.open}`) })).toBeInTheDocument();
    fireEvent.click(within(search).getByText('近くを探す(代わり)'));
    const results = await screen.findByTestId('discover-results');
    expect(results).toHaveTextContent('検索結果 2件未保存の検索結果');
    expect(within(results).getByTestId('nearby-state-n1')).toHaveTextContent('未保存');
    fireEvent.click(within(results).getByTestId('nearby-add-n1'));
    await waitFor(() => expect(m.createCandidateFromSearch).toHaveBeenCalledWith('p1', 'n1'));
    expect(await within(results).findByTestId('discover-saved-notice')).toHaveTextContent('「二見興玉神社・夫婦岩」をこの旅行の候補に保存しました');
    expect(within(results).getByTestId('nearby-state-n1')).toHaveTextContent('候補に保存済み');
    expect(within(results).getByTestId('nearby-add-n1')).toHaveTextContent('✓ 保存済み');
    expect(screen.getByTestId('disc-tab-count')).toHaveTextContent(String(dupes.counts.open + 1));
    // 地図に切り替えると、基点と位置の分かる結果を出す
    fireEvent.click(within(results).getByTestId('discover-results-map'));
    expect(await within(results).findByTestId('discover-map')).toHaveTextContent('検索結果の地図 2件');
    expect(screen.getByRole('link', { name: 'ライブラリを見る →' })).toHaveAttribute('href', '/spots');
  });

  it('[DiscoverUX] 保存済みの候補も地図で見られる(位置の分からない候補は数を示す)', async () => {
    m.getCandidates.mockResolvedValue({ ...dupes, can_edit: true });
    renderPage();
    fireEvent.click(await screen.findByTestId('candidate-view-map'));
    expect(await screen.findByTestId('discover-map')).toHaveTextContent('この旅行の候補の地図');
  });
});
