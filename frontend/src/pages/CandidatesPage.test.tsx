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
  scheduleCandidate: vi.fn(), mergeCandidate: vi.fn(), getPlanDetail: vi.fn(),
}));
vi.mock('@/services/api', () => ({ ...m, default: { getPlanDetail: m.getPlanDetail } }));

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

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getPlanDetail.mockResolvedValue({ data: { days: [{ id: D1, local_date: '2026-11-01', timezone_id: 'Asia/Tokyo', sort_order: 0 }] } });
  window.confirm = vi.fn(() => true);
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
    expect(await screen.findByRole('status')).toHaveTextContent('にまとめました');
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
});
