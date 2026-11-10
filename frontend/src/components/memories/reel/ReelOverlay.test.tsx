/** [Gate MemoryReel] 全画面の思い出リール・終わりの画面(S2・S4) */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryReelData } from '@/services/api/memoryReel';

const { getMemoryReel, getMemoryMedia } = vi.hoisted(() => ({ getMemoryReel: vi.fn(), getMemoryMedia: vi.fn() }));
vi.mock('@/services/api/memoryReel', () => ({ getMemoryReel }));
vi.mock('@/services/api', () => ({ getMemoryMedia }));

import ReelOverlay from './ReelOverlay';

const reel = (planId: string, title: string): MemoryReelData => ({
  plan_id: planId, title, destination: '三重県鳥羽市', start_date: '2025-08-09', end_date: '2025-08-10', day_count: 2,
  photo_count: 38, note_count: 9, place_count: 7, member_count: 4, quote: 'また来たいね、と全員一致',
  slides: [{ memory_id: `${planId}-m`, title: '夫婦岩', place_name: null, local_at: '2025-08-09T06:12', body: null,
    latitude: 34.5, longitude: 136.8 }],
  fallback_events: [],
});

const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });

describe('ReelOverlay', () => {
  beforeEach(() => {
    getMemoryReel.mockReset();
    getMemoryReel.mockImplementation(async (id: string) => reel(id, id === 'a' ? '伊勢・鳥羽' : '箱根'));
    getMemoryMedia.mockResolvedValue(new Blob(['x']));
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  });
  afterEach(() => { document.body.style.overflow = ''; });

  it('全画面で開き、Esc で閉じる。開いている間は後ろを動かさない', async () => {
    const onClose = vi.fn();
    render(<MemoryRouter><ReelOverlay start={{ planId: 'a', title: '伊勢・鳥羽', badge: '1年前の夏' }} onClose={onClose} /></MemoryRouter>);
    await settle();
    const dialog = screen.getByRole('dialog', { name: '伊勢・鳥羽の思い出' });
    expect(dialog).toHaveTextContent('1年前の夏');
    expect(dialog).toHaveTextContent('2025年8月9日〜10日');
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('終わりの画面: ひとこと・旅の数・同じ場所でもう一度・次の思い出へ', async () => {
    render(
      <MemoryRouter>
        <ReelOverlay start={{ planId: 'a', title: '伊勢・鳥羽', badge: null }}
          trips={[{ planId: 'a', title: '伊勢・鳥羽', badge: null }, { planId: 'b', title: '箱根', badge: '同じ季節の旅' }]}
          onClose={() => {}} />
      </MemoryRouter>,
    );
    await settle();
    fireEvent.click(screen.getByTestId('memory-reel-to-end'));
    const end = screen.getByTestId('memory-reel-end');
    expect(end).toHaveTextContent('三重県鳥羽市の旅、おしまい。');
    expect(end).toHaveTextContent('「また来たいね、と全員一致」');
    expect(end).toHaveTextContent('写真38');
    expect(end).toHaveTextContent('一緒に4人');
    expect(screen.getByTestId('memory-reel-replan')).toHaveAttribute('href',
      `/planner?new=1&destination=${encodeURIComponent('三重県鳥羽市')}`);
    // 動きを減らす設定では次の思い出を自動で始めない。「見る」で次の旅へ
    expect(screen.getByTestId('memory-reel-next-trip')).toHaveTextContent('箱根');
    fireEvent.click(screen.getByRole('button', { name: '見る' }));
    await settle();
    expect(getMemoryReel).toHaveBeenLastCalledWith('b');
    expect(screen.getByRole('dialog', { name: '箱根の思い出' })).toBeInTheDocument();
  });

  it('読み込めない時は知らせて閉じられる', async () => {
    getMemoryReel.mockRejectedValue(new Error('x'));
    const onClose = vi.fn();
    render(<MemoryRouter><ReelOverlay start={{ planId: 'a', title: '伊勢・鳥羽', badge: null }} onClose={onClose} /></MemoryRouter>);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('思い出を読み込めませんでした');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalled();
  });
});
