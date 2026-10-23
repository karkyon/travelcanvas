/**
 * [Gate C2] PlacePage(場所の詳細、FR-008)の画面テスト。
 * [Gate G4] MAP-02 例外の日・入口・その日の営業時間・出典の違い。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { PlaceInfo } from '@/services/api';

const m = vi.hoisted(() => ({
  getPlaceInfo: vi.fn(), updatePlace: vi.fn(), putOpeningHours: vi.fn(),
  putSpecialHours: vi.fn(), putEntrances: vi.fn(), getDayHours: vi.fn(),
}));
vi.mock('@/services/api', () => ({ getPlaceInfo: m.getPlaceInfo, updatePlace: m.updatePlace, putOpeningHours: m.putOpeningHours }));
vi.mock('@/services/api/g4', () => ({ putSpecialHours: m.putSpecialHours, putEntrances: m.putEntrances, getDayHours: m.getDayHours }));

import PlacePage from './PlacePage';

const C5 = '00000000-0000-4000-8000-0000000000c5';
const info = fx.place_info as unknown as PlaceInfo;

const renderPage = () => render(
  <MemoryRouter initialEntries={[`/planner/p1/places/${C5}`]}>
    <Routes><Route path="/planner/:planId/places/:placeId" element={<PlacePage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('PlacePage (Gate C2)', () => {
  it('変えた項目だけを revision つきで保存し、出典を示す', async () => {
    m.getPlaceInfo.mockResolvedValue(info);
    m.updatePlace.mockResolvedValue(fx.place_updated);
    renderPage();
    const form = await screen.findByRole('form', { name: '場所の情報を直す' });
    expect(screen.getByTestId('source-name')).toHaveTextContent('出典: 登録した URL');
    fireEvent.change(within(form).getByLabelText('電話'), { target: { value: '075-551-1234' } });
    fireEvent.change(within(form).getByLabelText('入口'), { target: { value: '仁王門から' } });
    fireEvent.change(within(form).getByLabelText('別名(「、」区切り)'), { target: { value: '音羽山清水寺' } });
    fireEvent.change(within(form).getByLabelText('予約'), { target: { value: 'no' } });
    fireEvent.click(within(form).getByRole('button', { name: '場所の情報を保存' }));
    await waitFor(() => expect(m.updatePlace).toHaveBeenCalledWith(C5, {
      phone: '075-551-1234', entrance_note: '仁王門から', aliases: ['音羽山清水寺'], reservation_required: false,
    }, 1));
    expect(await screen.findByTestId('source-phone')).toHaveTextContent('出典: 利用者の入力');
    expect(screen.getByRole('button', { name: '電話をかける(075-551-1234)' })).toBeInTheDocument();
  });

  it('営業時間を足して保存する。直せない人には入力を出さない', async () => {
    m.getPlaceInfo.mockResolvedValue(fx.place_updated);
    m.putOpeningHours.mockResolvedValue(fx.place_hours);
    const { unmount } = renderPage();
    const hours = await screen.findByRole('region', { name: '営業時間' });
    fireEvent.click(within(hours).getByRole('button', { name: '営業時間を追加' }));
    fireEvent.click(within(hours).getByRole('button', { name: '営業時間を保存' }));
    await waitFor(() => expect(m.putOpeningHours).toHaveBeenCalledWith(C5, [{ day_of_week: 0, open_time: '09:00', close_time: '17:00' }], 2));
    expect(await screen.findByRole('status')).toHaveTextContent('営業時間を保存しました');
    unmount();

    m.getPlaceInfo.mockResolvedValue({ ...info, can_edit: false });
    renderPage();
    const form = await screen.findByRole('form', { name: '場所の情報を直す' });
    expect(within(form).getByLabelText('電話')).toBeDisabled();
    expect(within(form).queryByRole('button', { name: '場所の情報を保存' })).toBeNull();
    expect(screen.getByText(/この場所を使うすべての旅行を編集できる人だけが直せます/)).toBeInTheDocument();
  });

  it('見られない場所は案内する', async () => {
    m.getPlaceInfo.mockRejectedValue(new Error('404'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('場所を取得できませんでした');
  });

  it('[G4] 例外の日・入口を保存し、その日の営業時間と出典の違いを示す', async () => {
    const base = { ...(fx.place_updated as unknown as PlaceInfo), special_hours: [], entrances: [],
      source_history: { phone: [
        { value: '075-222', provider: 'user', label: '利用者の入力', source_url: null, retrieved_at: null },
        { value: '075-111', provider: 'url', label: '登録した URL', source_url: null, retrieved_at: null }] } };
    m.getPlaceInfo.mockResolvedValue(base);
    m.putSpecialHours.mockResolvedValue({ ...base, revision: 3 });
    m.putEntrances.mockResolvedValue({ ...base, revision: 4 });
    m.getDayHours.mockResolvedValue({ date: '2026-12-31', source: 'special', closed: true, note: '年末', windows: [],
      summary: '12/31(木) は臨時休業' });
    renderPage();
    const sp = await screen.findByRole('region', { name: '例外の日' });
    fireEvent.click(within(sp).getByRole('button', { name: '例外の日を追加' }));
    fireEvent.change(within(sp).getByLabelText('日付'), { target: { value: '2026-12-31' } });
    fireEvent.change(within(sp).getByLabelText('メモ'), { target: { value: '年末' } });
    fireEvent.click(within(sp).getByRole('button', { name: '例外の日を保存' }));
    await waitFor(() => expect(m.putSpecialHours).toHaveBeenCalledWith(C5, [{ local_date: '2026-12-31', kind: 'closed',
      open_time: null, close_time: null, last_entry: null, last_order: null, note: '年末' }], 2));
    fireEvent.change(within(sp).getByLabelText('その日の営業時間を確かめる'), { target: { value: '2026-12-31' } });
    fireEvent.click(within(sp).getByRole('button', { name: '確かめる' }));
    expect(await within(sp).findByLabelText('その日の営業時間')).toHaveTextContent('12/31(木) は臨時休業(例外の日)(年末)');
    expect(m.getDayHours).toHaveBeenCalledWith(C5, '2026-12-31');

    const en = screen.getByRole('region', { name: '入口' });
    fireEvent.click(within(en).getByRole('button', { name: '入口を追加' }));
    fireEvent.change(within(en).getByLabelText('名前'), { target: { value: '正面' } });
    fireEvent.change(within(en).getByLabelText('緯度'), { target: { value: '35.0' } });
    fireEvent.change(within(en).getByLabelText('経度'), { target: { value: '135.7' } });
    fireEvent.change(within(en).getByLabelText('段差なし'), { target: { value: 'yes' } });
    fireEvent.click(within(en).getByRole('button', { name: '入口を保存' }));
    await waitFor(() => expect(m.putEntrances).toHaveBeenCalledWith(C5, [{ label: '正面', latitude: 35, longitude: 135.7,
      note: null, accessible: true }], 3));

    const hist = screen.getByRole('region', { name: '出典による違い' });
    expect(hist).toHaveTextContent('075-222 — 利用者の入力');
    expect(hist).toHaveTextContent('075-111 — 登録した URL');
  });
});
