/**
 * [FR-062] ♡ 今度行きたいに残すのシート(DD-2026-11-22-01 §5.5)。
 * 近くの候補は 2 タップで保存・閉じ方 4 つ・圏外で溜める・取り消し・ゲスト・2 択。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  quick: vi.fn(), nearby: vi.fn(), del: vi.fn(), patch: vi.fn(), queue: vi.fn(), box: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('@/services/api/spotIntake', () => ({
  quickSaveWish: m.quick, nearbyCandidates: m.nearby, deleteWishSpot: m.del, patchWishSpot: m.patch,
}));
vi.mock('@/utils/wishQueue', async (orig) => ({ ...(await orig<typeof import('@/utils/wishQueue')>()), queueWish: m.queue }));
vi.mock('@/utils/offlineSession', () => ({ currentOfflineSession: () => ({ userId: 'u1', sessionTag: 't' }) }));
vi.mock('@/services/api/travelDay', () => ({ keepForNextTrip: m.box }));
vi.mock('react-hot-toast', () => ({ toast: m.toast }));
vi.mock('@/components/search/PlaceFinder', () => ({
  default: ({ onPick, tab }: { onPick: (d: unknown) => void; tab: string }) => (
    <button type="button" onClick={() => onPick({ name: '探した店', address: null, latitude: 34.1, longitude: 136.1,
      category: 'restaurant', description: null, sourceUrl: null })}>{`finder-${tab}`}</button>),
}));

import { WishSheet } from './WishSheet';
import WishHeartButton from './WishHeartButton';
import { WISH_SHEET_EVENT } from './wishEvents';
import { keepMissed } from '@/pages/today/live/keepMissed';

const created = (name: string) => ({ spot: { id: 's1', name, wish_kind: 'next', again_count: 0 }, created: true, merged_into: null, previous: null });

function grantPosition(accuracy = 20) {
  Object.defineProperty(navigator, 'permissions', { configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) } });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 34.46227, longitude: 136.72538, accuracy } } as GeolocationPosition),
  } });
}

beforeEach(() => {
  Object.values(m).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  m.toast.success.mockReset(); m.toast.error.mockReset();
  m.nearby.mockResolvedValue({ results: [{ name: '赤福 本店', genre: 'restaurant', distance_m: 120, lat: 34.4623, lng: 136.7256, address: '伊勢市' }],
    source: ['overpass'] });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('♡ 今度行きたいに残す (FR-062)', () => {
  it('位置の許可がある時は近くの候補を出し、行を押すとその場で保存して閉じる(2 タップ)', async () => {
    grantPosition();
    m.quick.mockResolvedValue(created('赤福 本店'));
    const onClose = vi.fn();
    render(<WishSheet open options={{ planId: 'p1', sourceKind: 'quick' }} onClose={onClose} />);
    const row = await screen.findByRole('button', { name: /赤福 本店/ });
    expect(m.nearby).toHaveBeenCalledWith(34.46227, 136.72538);
    fireEvent.click(row);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(m.quick).toHaveBeenCalledWith(expect.objectContaining({ name: '赤福 本店', latitude: 34.4623, longitude: 136.7256,
      wish_kind: 'next', source_kind: 'quick', source_plan_id: 'p1', genre: 'restaurant' }));
    expect(m.quick.mock.calls[0][0].client_id).toMatch(/^[A-Za-z0-9]{16,}$/);
    expect(m.toast).toHaveBeenCalled();  // 取り消しのできる知らせ
    expect(m.toast.mock.calls[0][1]).toEqual({ duration: 6000 });
  });

  it('ひとこと・いつ・また行きたいを一緒に送る', async () => {
    grantPosition();
    m.quick.mockResolvedValue(created('赤福 本店'));
    render(<WishSheet open options={{}} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /また行きたい/ }));
    fireEvent.change(screen.getByLabelText('ひとこと(任意)'), { target: { value: '朝に行く' } });
    fireEvent.click(screen.getByRole('radio', { name: 'いつか' }));
    fireEvent.click(await screen.findByRole('button', { name: /赤福 本店/ }));
    await waitFor(() => expect(m.quick).toHaveBeenCalledWith(expect.objectContaining({ wish_kind: 'again', wish_note: '朝に行く',
      wish_when: 'someday' })));
  });

  it('位置の許可が無い時は許可のボタンを出し、勝手に位置を取らない', async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) } });
    const get = vi.fn();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: get } });
    render(<WishSheet open options={{}} onClose={vi.fn()} />);
    expect(await screen.findByText('近くの候補を出すには位置の許可が要ります')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '位置の許可' })).toBeTruthy();
  });

  it('位置が粗い(100m より大きい)時は近くの候補を出さない', async () => {
    grantPosition(500);
    render(<WishSheet open options={{}} onClose={vi.fn()} />);
    expect(await screen.findByText(/位置が粗いため/)).toBeTruthy();
    expect(m.nearby).not.toHaveBeenCalled();
  });

  it('閉じるボタン・背景・Esc・下へ払うで閉じる', async () => {
    grantPosition();
    const onClose = vi.fn();
    render(<WishSheet open options={{}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.click(screen.getByTestId('wish-sheet-backdrop'));
    fireEvent.keyDown(window, { key: 'Escape' });
    const dlg = screen.getByRole('dialog');
    fireEvent.touchStart(dlg, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(dlg, { changedTouches: [{ clientY: 300 }] });
    expect(onClose).toHaveBeenCalledTimes(4);
    await screen.findByRole('button', { name: /赤福 本店/ });
  });

  it('名前で探す・今の予定の場所から残せる(今の予定の場所は当日の時だけ)', async () => {
    grantPosition();
    m.quick.mockResolvedValue(created('探した店'));
    const { unmount } = render(<WishSheet open options={{}} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '今の予定の場所' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '名前で探す' }));
    fireEvent.click(await screen.findByText('finder-search'));
    await waitFor(() => expect(m.quick).toHaveBeenCalledWith(expect.objectContaining({ name: '探した店', genre: 'restaurant' })));
    unmount();
    m.quick.mockClear();
    render(<WishSheet open options={{ sourceKind: 'today', currentPlace: { name: '内宮', address: null, latitude: 34.45, longitude: 136.72,
      category: null, description: null, sourceUrl: null } }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '今の予定の場所' }));
    await waitFor(() => expect(m.quick).toHaveBeenCalledWith(expect.objectContaining({ name: '内宮', source_kind: 'today' })));
  });

  it('通信できない時は端末に溜めて知らせる', async () => {
    grantPosition();
    m.quick.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', isAxiosError: true }));
    m.queue.mockResolvedValue(true);
    const onClose = vi.fn();
    render(<WishSheet open options={{}} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: /赤福 本店/ }));
    await waitFor(() => expect(m.queue).toHaveBeenCalled());
    expect(m.toast).toHaveBeenCalledWith('端末に残しました。つながった時に送ります', expect.anything());
    expect(onClose).toHaveBeenCalled();
  });

  it('取り消し: 作った時は削除、既にあった時は元の値に戻す', async () => {
    grantPosition();
    m.quick.mockResolvedValueOnce(created('赤福 本店'));
    m.del.mockResolvedValue(undefined);
    render(<WishSheet open options={{}} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /赤福 本店/ }));
    await waitFor(() => expect(m.toast).toHaveBeenCalled());
    const render1 = m.toast.mock.calls[0][0] as (t: { id: string }) => JSX.Element;
    const { getByRole, unmount } = render(render1({ id: 't1' }));
    await act(async () => { fireEvent.click(getByRole('button', { name: '取り消す' })); });
    expect(m.del).toHaveBeenCalledWith('s1');
    unmount();

    m.toast.mockClear();
    m.quick.mockResolvedValueOnce({ spot: { id: 's2', name: '赤福 本店', wish_kind: 'again', again_count: 1 }, created: false,
      merged_into: 's2', previous: { wish_kind: 'next', again_count: 0, wish_note: null, wish_when: null } });
    m.patch.mockResolvedValue({});
    render(<WishSheet open options={{ kind: 'again' }} onClose={vi.fn()} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /赤福 本店/ })).slice(-1)[0]);
    await waitFor(() => expect(m.toast).toHaveBeenCalled());
    const r2 = m.toast.mock.calls[0][0] as (t: { id: string }) => JSX.Element;
    const view = render(r2({ id: 't2' }));
    expect(view.getByTestId('wish-saved-toast').textContent).toContain('もう残してあります(また行きたい 2 回目)');
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '取り消す' })); });
    expect(m.patch).toHaveBeenCalledWith('s2', { wish_kind: 'next', again_count: 0, wish_note: null, wish_when: null });
  });

  it('ヘッダーの ♡: ゲストは「ログインすると残せます」、会員はシートを開く出来事を出す', () => {
    const seen = vi.fn();
    window.addEventListener(WISH_SHEET_EVENT, seen);
    const { rerender } = render(<WishHeartButton isGuest />);
    fireEvent.click(screen.getByRole('button', { name: '今度行きたいに残す' }));
    expect(m.toast).toHaveBeenCalledWith('ログインすると残せます');
    expect(seen).not.toHaveBeenCalled();
    rerender(<WishHeartButton isGuest={false} />);
    fireEvent.click(screen.getByRole('button', { name: '今度行きたいに残す' }));
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener(WISH_SHEET_EVENT, seen);
  });

  it('当日の「次の旅の候補に」の 2 択: 今度行きたい(行きたい場所)/ この旅行の候補箱', async () => {
    m.quick.mockResolvedValue(created('外宮'));
    m.box.mockResolvedValue({});
    const place = { title: '外宮', address: '伊勢市', latitude: 34.48, longitude: 136.70 };
    await keepMissed('p1', place, 'wish');
    expect(m.quick).toHaveBeenCalledWith(expect.objectContaining({ name: '外宮', wish_kind: 'next', source_kind: 'today',
      source_plan_id: 'p1', wish_note: '旅の当日に行けなかった場所' }));
    expect(m.box).not.toHaveBeenCalled();
    await keepMissed('p1', place, 'box');
    expect(m.box).toHaveBeenCalledWith('p1', place);
  });
});
