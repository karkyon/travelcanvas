/** [Gate G6] PublicJournalPage(公開した旅行記、未認証)の画面テスト。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/g6Responses.json';
import type { PublicJournal } from '@/services/api/types/g6';

const g6 = vi.hoisted(() => ({ getPublicJournal: vi.fn(), getPublicJournalPhoto: vi.fn() }));
vi.mock('@/services/api/g6', () => g6);

import PublicJournalPage from './PublicJournalPage';

const journal = fx.public_journal as PublicJournal;

function renderPage(token = 'tok') {
  return render(
    <MemoryRouter initialEntries={[`/journal/${token}`]}>
      <Routes>
        <Route path="/journal/:token" element={<PublicJournalPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of Object.values(g6)) fn.mockReset();
  window.URL.createObjectURL = vi.fn(() => 'blob:journal');
  window.URL.revokeObjectURL = vi.fn();
});

describe('PublicJournalPage', () => {
  it('題名・日ごとの記録・写真を出し、座標は出さない', async () => {
    g6.getPublicJournal.mockResolvedValue({ ...journal, route: [{ lat: 34.99, lng: 135.78 }, { lat: 35.0, lng: 135.79 }] });
    g6.getPublicJournalPhoto.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    const { container } = renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: '京都の旅行記' })).toBeInTheDocument();
    expect(g6.getPublicJournal).toHaveBeenCalledWith('tok');
    expect(screen.getByText('清水寺は朝が静か')).toBeInTheDocument();
    expect(screen.getByText('清水の舞台')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: '旅の写真' })).toHaveAttribute('src', 'blob:journal');
    expect(g6.getPublicJournalPhoto).toHaveBeenCalledWith('tok', journal.photo_ids[0]);
    expect(screen.getByRole('img', { name: '大まかな移動の形(2地点)' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/34\.99|135\.78/);
  });

  it('公開をやめた・URL が違う時は見つからないとだけ示す', async () => {
    g6.getPublicJournal.mockRejectedValue({ response: { status: 404 } });
    renderPage('gone');
    expect(await screen.findByRole('alert')).toHaveTextContent('この旅行記は見つかりません');
  });
});
