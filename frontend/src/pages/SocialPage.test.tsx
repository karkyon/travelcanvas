/**
 * [FR-063] SNS の下書きとリール: 段の流れ・字数の目安・ハッシュタグの札・文だけの出す先はリールを飛ばす・
 * MP4 が無い時の文・共有が無い時は保存だけ・作る途中でやめる・書き出しの記録。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const m = vi.hoisted(() => ({ draft: vi.fn(), polish: vi.fn(), faces: vi.fn(), record: vi.fn(), blob: vi.fn(), render: vi.fn(),
  load: vi.fn() }));
vi.mock('@/services/api/social', () => ({ getSocialDraft: m.draft, polishSocialText: m.polish, getFaceBoxes: m.faces,
  recordReelExport: m.record, getMemoryBlob: m.blob }));
vi.mock('@/services/api/photoFeatures', () => ({ getMemoryThumbnail: vi.fn(async () => new Blob(['x'])) }));
vi.mock('./social/reelRender', async (orig) => ({ ...(await orig<typeof import('./social/reelRender')>()), renderReel: m.render,
  loadFrameImage: m.load, wakeLockAvailable: () => true }));

import SocialPage from './SocialPage';
import { RenderCancelled } from './social/reelRender';

const draft = (o: Record<string, unknown> = {}) => ({ text: '伊勢へ1泊2日。\n内宮 → おかげ横丁\n行った場所 2 か所', hashtags: ['#伊勢', '#内宮', '#旅の記録'],
  excluded: { home_near: 1, names: 0 }, audios: [], route_shape: [[0, 0], [1, 1]], title: '伊勢の旅',
  period: { start: '2026-11-28', end: '2026-11-29' }, char_limit: 4000, photo_range: [3, 20],
  photos: ['a', 'b', 'c', 'd'].map((id) => ({ memory_id: id, taken_at: '2026-11-28', owner_is_me: true, allowed: true, place_name: id })), ...o });

const renderPage = (path = '/planner/p1/social') => render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/planner/:planId/social" element={<SocialPage />} /></Routes></MemoryRouter>);

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.draft.mockResolvedValue(draft());
  m.blob.mockResolvedValue(new Blob(['img']));
  m.load.mockResolvedValue({ width: 100, height: 100 });
  m.record.mockResolvedValue({ id: 'r1' });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:video');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('SNS の下書きとリール (FR-063)', () => {
  it('選ぶ → 文: 外した数・字数の目安・ハッシュタグの札・AI で整える', async () => {
    renderPage();
    expect(await screen.findByTestId('social-excluded')).toHaveTextContent('自宅の近く 1 件');
    expect(await screen.findByText('写真(4 / 3〜20 枚)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '次へ(文)' }));
    const area = screen.getByLabelText('投稿の文(そのまま直せます)') as HTMLTextAreaElement;
    expect(area.value).toContain('#伊勢 #内宮 #旅の記録');
    expect(screen.getByTestId('social-count')).toHaveTextContent('/ 4,000 字(画面に出るのは最初の 2 行ほど)');
    fireEvent.click(screen.getByRole('button', { name: '#内宮' }));
    expect(area.value).toContain('#伊勢 #旅の記録');
    m.polish.mockResolvedValue('整えた文');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'AI で整える' })); });
    expect(m.polish).toHaveBeenCalledWith('p1', expect.stringContaining('伊勢へ1泊2日。'), 'tiktok');
    expect(area.value).toBe('整えた文');
  });

  it('文だけの出す先(X)はリールの段が無く、字数の上限が 140', async () => {
    m.draft.mockResolvedValue(draft({ char_limit: 140, photo_range: [1, 10] }));
    renderPage();
    await screen.findByTestId('social-excluded');
    fireEvent.click(screen.getByTestId('social-style-x'));
    await waitFor(() => expect(m.draft).toHaveBeenLastCalledWith('p1', expect.objectContaining({ style: 'x' })));
    expect(screen.queryByRole('button', { name: '3 リール' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '次へ(文)' }));
    expect(screen.getByTestId('social-count')).toHaveTextContent('/ 140 字');
    expect(screen.queryByRole('button', { name: '次へ(リール)' })).toBeNull();
  });

  it('リール: 作って保存。MP4 が無い時は文を出し、共有が無い時は保存だけ。記録を送る', async () => {
    m.render.mockResolvedValue({ blob: new Blob(['v'], { type: 'video/webm' }), mime: 'video/webm', ext: 'webm', mp4: false, seconds: 34, bitrate: 8e6 });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
    renderPage('/planner/p1/social?step=3');
    await screen.findByText('音楽は TikTok・Instagram のアプリで付けてください');
    await act(async () => { fireEvent.click(screen.getByTestId('reel-make')); });
    const result = await screen.findByTestId('reel-result');
    expect(result).toHaveTextContent('この端末では WebM になります');
    expect(screen.getByRole('link', { name: '保存' })).toHaveAttribute('download', '伊勢の旅_tiktok.webm');
    expect(screen.queryByRole('button', { name: '共有' })).toBeNull();
    expect(m.record).toHaveBeenCalledWith('p1', expect.objectContaining({ style: 'tiktok', frame_count: 4, status: 'ready' }));
    expect(m.record.mock.calls[0]![1]).not.toHaveProperty('memory_ids');
  });

  it('作る途中でやめる', async () => {
    let reject: (e: unknown) => void = () => undefined;
    m.render.mockImplementation((_i: unknown, o: { signal: AbortSignal }) => new Promise((_r, rj) => {
      reject = rj; o.signal.addEventListener('abort', () => rj(new RenderCancelled()));
    }));
    renderPage('/planner/p1/social?step=3');
    await screen.findByText('音楽は TikTok・Instagram のアプリで付けてください');
    await act(async () => { fireEvent.click(screen.getByTestId('reel-make')); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'やめる' })); });
    expect(await screen.findByText('動画を作るのをやめました')).toBeTruthy();
    expect(m.record).not.toHaveBeenCalled();
    void reject;
  });

  it('写真が足りない時は作らない', async () => {
    m.draft.mockResolvedValue(draft({ photos: draft().photos.slice(0, 2) }));
    renderPage('/planner/p1/social?step=3');
    await screen.findByText('音楽は TikTok・Instagram のアプリで付けてください');
    await act(async () => { fireEvent.click(screen.getByTestId('reel-make')); });
    expect(screen.getByRole('alert')).toHaveTextContent('写真を 3 枚以上選んでください');
    expect(m.render).not.toHaveBeenCalled();
  });
});
