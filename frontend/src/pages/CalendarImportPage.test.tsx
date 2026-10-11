/**
 * [Gate P8] CalendarImportPage(FR-036 カレンダー取込)の画面テスト。
 *
 * - ファイルを選ぶと取り込み案を表示し(本案は変えない)、追加・変更は既定で選択、取り込まない予定は理由を表示
 * - 「日程が無い日は追加する」を切り替えると選び直した条件で再度確認する
 * - 選んだ予定だけを、確認した時点のrevisionで適用し、「元に戻す」で取り消せることを案内する
 * - 失敗はサーバの説明を表示する
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CalendarImportPreview } from '@/services/api';

const m = vi.hoisted(() => ({ previewCalendarImport: vi.fn(), applyCalendarImport: vi.fn() }));
vi.mock('@/services/api', () => m);

import CalendarImportPage from './CalendarImportPage';

const preview = (createDays = false): CalendarImportPreview => ({
  plan_id: 'p1', plan_revision: 7, timezone_id: 'Asia/Tokyo', create_missing_days: createDays,
  summary: { total: 3, create: 1, update: 1, skip: 1, skipped_by_reason: { recurring: 1 } },
  candidates: [
    { index: 0, uid: 'x@g', title: '伏見稲荷', local_date: '2026-11-01', local_start_time: '15:00', is_all_day: false,
      address: '京都市伏見区', action: 'create', reason: null, event_id: null, changes: null, day_exists: createDays },
    { index: 1, uid: 'event-e1@travelcanvas.app', title: '清水寺', local_date: '2026-11-01', local_start_time: '11:30',
      is_all_day: false, address: null, action: 'update', reason: null, event_id: 'e1',
      changes: { local_start_time: { before: '10:00', after: '11:30' } }, day_exists: true },
    { index: 2, uid: 'r@g', title: '毎週の会議', local_date: '2026-11-02', local_start_time: '09:00', is_all_day: false,
      address: null, action: 'skip', reason: 'recurring', event_id: null, changes: null, day_exists: false },
  ],
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/calendar-import']}>
      <Routes><Route path="/planner/:planId/calendar-import" element={<CalendarImportPage />} /></Routes>
    </MemoryRouter>
  );
}

const pickFile = () => {
  const f = new File(['BEGIN:VCALENDAR'], 'a.ics', { type: 'text/calendar' });
  fireEvent.change(screen.getByLabelText(/ICSファイル/), { target: { files: [f] } });
  return f;
};

beforeEach(() => {
  m.previewCalendarImport.mockReset();
  m.applyCalendarImport.mockReset();
});

describe('CalendarImportPage (Gate P8)', () => {
  it('取り込み案を表示し、選んだ予定だけを確認時のrevisionで適用する', async () => {
    m.previewCalendarImport.mockResolvedValue(preview());
    m.applyCalendarImport.mockResolvedValue({ plan_revision: 8, created: 0, updated: 1, created_days: 0 });
    renderPage();
    const f = pickFile();
    await waitFor(() => expect(m.previewCalendarImport).toHaveBeenCalledWith('p1', f, false));
    expect(await screen.findByTestId('import-summary')).toHaveTextContent('3件中、追加1件・変更1件・取り込まない1件');
    expect(screen.getByText('開始時刻 10:00 → 11:30')).toBeInTheDocument();
    expect(screen.getByText(/繰り返しの予定は取り込めません/)).toBeInTheDocument();
    expect(screen.getByText(/日程を追加します/)).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox').filter((b) => !(b as HTMLInputElement).disabled && b.closest('li'));
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[0]!); // 追加を外す
    fireEvent.click(screen.getByRole('button', { name: '選んだ予定を取り込む' }));
    await waitFor(() => expect(m.applyCalendarImport).toHaveBeenCalledWith('p1', [
      { action: 'update', event_id: 'e1', title: '清水寺', local_date: '2026-11-01', local_start_time: '11:30', is_all_day: false, address: null },
    ], false, 7));
    expect(await screen.findByTestId('import-result')).toHaveTextContent('取り込みました(追加0件・変更1件)。プラン画面の「元に戻す」で取り消せます。');
    expect(screen.queryByTestId('import-summary')).toBeNull();
  });

  it('日程の追加を選ぶと、その条件で確認し直して適用する', async () => {
    m.previewCalendarImport.mockImplementation(async (_p: string, _f: File, days: boolean) => preview(days));
    m.applyCalendarImport.mockResolvedValue({ plan_revision: 8, created: 1, updated: 1, created_days: 1 });
    renderPage();
    pickFile();
    await screen.findByTestId('import-summary');
    fireEvent.click(screen.getByRole('checkbox', { name: /日程を追加して取り込む/ }));
    await waitFor(() => expect(m.previewCalendarImport).toHaveBeenLastCalledWith('p1', expect.any(File), true));
    await waitFor(() => expect(screen.queryByText(/日程を追加します/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '選んだ予定を取り込む' }));
    await waitFor(() => expect(m.applyCalendarImport).toHaveBeenCalledWith('p1', expect.any(Array), true, 7));
    expect(await screen.findByTestId('import-result')).toHaveTextContent('日程の追加1日');
  });

  it('読み込み・適用の失敗はサーバの説明を表示する', async () => {
    m.previewCalendarImport.mockRejectedValueOnce({ response: { data: { detail: 'ICS(iCalendar)形式のファイルではありません' } } });
    renderPage();
    pickFile();
    expect(await screen.findByRole('alert')).toHaveTextContent('ICS(iCalendar)形式のファイルではありません');
    m.previewCalendarImport.mockResolvedValue(preview());
    m.applyCalendarImport.mockRejectedValue({ response: { status: 409, data: { detail: 'revision mismatch' } } });
    pickFile();
    await screen.findByTestId('import-summary');
    fireEvent.click(screen.getByRole('button', { name: '選んだ予定を取り込む' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('revision mismatch');
  });
});
