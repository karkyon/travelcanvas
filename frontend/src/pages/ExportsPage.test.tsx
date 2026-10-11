/**
 * [Gate P5] ExportsPage(FR-036 書き出し)の画面テスト。
 *
 * - 各形式のボタンが選択どおりの条件で書き出し、ファイルとして保存させる
 * - 書き出さなかった件数・除外した件数を案内する(黙って欠落させない)
 * - 正確な位置を選ぶと注意を出す。失敗はエラー表示
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const m = vi.hoisted(() => ({ downloadItineraryExport: vi.fn() }));
vi.mock('@/services/api', () => m);

import ExportsPage from './ExportsPage';
import { describeResult } from './exports/exportModel';

const file = (filename: string, count: number, skipped = 0, excluded = 0) =>
  ({ blob: new Blob(['x']), filename, count, skipped, excluded });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/exports']}>
      <Routes><Route path="/planner/:planId/exports" element={<ExportsPage />} /></Routes>
    </MemoryRouter>
  );
}

let clicked: string[] = [];

beforeEach(() => {
  m.downloadItineraryExport.mockReset();
  clicked = [];
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  });
});

describe('ExportsPage (Gate P5)', () => {
  it('ICS: 既定は住所なし。住所を選ぶと含め、保存して件数を案内する', async () => {
    m.downloadItineraryExport.mockResolvedValue(file('calendar.ics', 7, 1));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'ICSを書き出す' }));
    await waitFor(() => expect(m.downloadItineraryExport).toHaveBeenCalledWith('p1', 'ics', { include_addresses: false }));
    expect(await screen.findByTestId('export-result')).toHaveTextContent('calendar.ics を書き出しました(7件)。出発時刻のない移動1件は含めていません。');
    expect(clicked).toEqual(['travelcanvas-calendar.ics']);
    fireEvent.click(screen.getAllByRole('checkbox', { name: /住所を含める/ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'ICSを書き出す' }));
    await waitFor(() => expect(m.downloadItineraryExport).toHaveBeenLastCalledWith('p1', 'ics', { include_addresses: true }));
  });

  it('GPX・KML: 既定は約1km単位・宿泊除外。正確な位置を選ぶと注意を出す', async () => {
    m.downloadItineraryExport.mockResolvedValue(file('places.gpx', 2, 2, 1));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'GPXを書き出す' }));
    await waitFor(() => expect(m.downloadItineraryExport).toHaveBeenCalledWith('p1', 'gpx', { precision: 'approx', exclude_accommodation: true }));
    expect(await screen.findByTestId('export-result')).toHaveTextContent('(2地点)。位置が登録されていない予定2件は含めていません。宿泊場所1件は選択により除外しました。');
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /正確な位置/ }));
    expect(screen.getByRole('note')).toHaveTextContent('特定されるおそれ');
    fireEvent.click(screen.getByRole('checkbox', { name: '宿泊場所を除外する' }));
    m.downloadItineraryExport.mockResolvedValue(file('places.kml', 3));
    fireEvent.click(screen.getByRole('button', { name: 'KMLを書き出す' }));
    await waitFor(() => expect(m.downloadItineraryExport).toHaveBeenLastCalledWith('p1', 'kml', { precision: 'exact', exclude_accommodation: false }));
  });

  it('失敗したらエラーを表示する', async () => {
    m.downloadItineraryExport.mockRejectedValue({ response: { data: { detail: 'アクセス権限がありません' } } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'CSVを書き出す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('アクセス権限がありません');
    expect(clicked).toEqual([]);
  });

  it('0件のときは登録を促す', () => {
    expect(describeResult('csv', file('itinerary.csv', 0))).toContain('書き出す内容がありません');
  });
});
