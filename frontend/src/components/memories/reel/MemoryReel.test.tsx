/** [Gate MemoryReel] 思い出リール: 自動で進む・止める・前後・最後の後(全画面)・写真が読めない時は絵 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryReelData } from '@/services/api/memoryReel';

const { getMemoryMedia } = vi.hoisted(() => ({ getMemoryMedia: vi.fn() }));
vi.mock('@/services/api', () => ({ getMemoryMedia }));

import MemoryReel from './MemoryReel';
import { FRAME_MS } from './reelModel';

const data: MemoryReelData = {
  plan_id: 'p1', title: '伊勢・鳥羽', destination: '鳥羽', start_date: '2025-08-09', end_date: '2025-08-10', day_count: 2,
  photo_count: 3, note_count: 0, place_count: 3, member_count: 1, quote: null, fallback_events: [],
  slides: ['夫婦岩', '内宮', 'おかげ横丁'].map((t, i) => ({
    memory_id: `m${i}`, title: t, place_name: null, local_at: `2025-08-09T0${i + 6}:00`, body: null, latitude: null, longitude: null,
  })),
};

/** 写真の読み込み(Promise)を片付ける */
const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
/** 1 コマずつ時間を進める(次のタイマーは描き直した後に置かれる) */
const tick = async (k = 1) => {
  for (let i = 0; i < k; i += 1) {
    await act(async () => { vi.advanceTimersByTime(FRAME_MS); });
    await settle();
  }
};

const current = () => document.querySelector('.tc-reel-slide.is-on b')?.textContent;

describe('MemoryReel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getMemoryMedia.mockReset();
    getMemoryMedia.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('数秒ごとに自動で進み、最後の次は最初に戻る(ホーム)', async () => {
    render(<MemoryReel planId="p1" data={data} variant="inline" />);
    await settle();
    expect(current()).toBe('夫婦岩');
    await tick();
    expect(current()).toBe('内宮');
    await tick(2);
    expect(current()).toBe('夫婦岩');
    // 今と次の写真だけを読む
    expect(getMemoryMedia).toHaveBeenCalledWith('p1', 'm0');
  });

  it('止めると進まない。前後のボタンとキーで動かせる', async () => {
    render(<MemoryReel planId="p1" data={data} variant="inline" />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '自動で流すのを止める' }));
    await tick(3);
    expect(current()).toBe('夫婦岩');
    expect(screen.getByRole('button', { name: '自動で流す' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次の写真' }));
    await settle();
    expect(current()).toBe('内宮');
    expect(screen.getByText('2枚目 / 3枚: 内宮')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '前の写真' }));
    fireEvent.click(screen.getByRole('button', { name: '前の写真' }));
    expect(current()).toBe('おかげ横丁');
    const region = screen.getByRole('region', { name: '伊勢・鳥羽の思い出' });
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    await settle();
    expect(current()).toBe('夫婦岩');
  });

  it('全画面では最後のコマの後に onFinished', async () => {
    const onFinished = vi.fn();
    render(<MemoryReel planId="p1" data={data} variant="full" onFinished={onFinished} onClose={() => {}} />);
    await settle();
    await tick(3);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument();
  });

  it('動きを減らす設定では自動で進めない', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
    render(<MemoryReel planId="p1" data={data} variant="inline" />);
    await settle();
    await tick(2);
    expect(current()).toBe('夫婦岩');
  });

  it('写真が読めない時は行き先の色の絵', async () => {
    getMemoryMedia.mockRejectedValue(new Error('x'));
    render(<MemoryReel planId="p1" data={data} variant="inline" />);
    await settle();
    expect(document.querySelector('.tc-reel-slide.is-on img')).toBeNull();
    expect(document.querySelector('.tc-reel-slide.is-on .tc-reel-cover')).not.toBeNull();
  });
});
