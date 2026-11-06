/**
 * [Gate G7] FR-005 予定の時間と、保存する前の影響の確認。
 * [Gate PlanSpotEdit] 課題 #3-④: 開始 〜 終了を 1 行に。終了は既定で「この場所での時間」、印で「終了時刻」へ切り替え。
 * 「終わる日」の選択は外し、終了時刻の時はカレンダーの印で終わる日付を入れる(既定は日付なし)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React, { useState } from 'react';
import fx from '@/services/api/__fixtures__/g7Responses.json';

const g7 = vi.hoisted(() => ({ previewEventImpact: vi.fn() }));
vi.mock('@/services/api/g7', () => ({ previewEventImpact: g7.previewEventImpact }));

import EventTimeImpact, { type EndValue } from './EventTimeImpact';
import { endFromStay, stayMinutes } from './eventTimeModel';

let last: EndValue = { time: '', offset: 0 };
const Host: React.FC<{ start?: string; end?: EndValue; withStart?: boolean }> = ({ start = '22:30', end: initial = { time: '', offset: 0 }, withStart = true }) => {
  const [startTime, setStart] = useState(start);
  const [end, setEnd] = useState<EndValue>(initial);
  last = end;
  return (
    <EventTimeImpact planId="p1" eventId="e1" startTime={startTime} end={end} dayDate="2026-11-28"
      onEndChange={(v) => { last = v; setEnd(v); }} onStartChange={withStart ? setStart : undefined} />
  );
};

beforeEach(() => { g7.previewEventImpact.mockReset(); last = { time: '', offset: 0 }; });

describe('時間の計算', () => {
  it('滞在の分 ⇔ 終了(日をまたぐ・2 日後まで)', () => {
    expect(endFromStay('10:00', 90)).toEqual({ time: '11:30', offset: 0 });
    expect(endFromStay('22:30', 8 * 60)).toEqual({ time: '06:30', offset: 1 });
    expect(endFromStay('10:00', 3 * 1440)).toBeNull();
    expect(endFromStay('', 30)).toBeNull();
    expect(stayMinutes('22:30', { time: '06:30', offset: 1 })).toBe(480);
    expect(stayMinutes('10:00', { time: '', offset: 0 })).toBeNull();
  });
});

describe('EventTimeImpact', () => {
  it('開始 〜 終了を 1 行に並べ、既定は「この場所での時間」。時間を入れると終了(日をまたげば翌日)を決める', () => {
    render(<Host start="10:00" />);
    expect(screen.getByLabelText('開始時刻')).toHaveValue('10:00');
    expect(screen.queryByLabelText('終わる日')).toBeNull(); // 「終わる日」の選択は無い
    fireEvent.change(screen.getByLabelText('滞在(時間)'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('滞在(分)'), { target: { value: '30' } });
    expect(last).toEqual({ time: '11:30', offset: 0 });
    expect(screen.getByTestId('end-note')).toHaveTextContent('終了は 11:30 です');
    // 開始を変えても長さは保つ
    fireEvent.change(screen.getByLabelText('開始時刻'), { target: { value: '23:00' } });
    expect(last).toEqual({ time: '00:30', offset: 1 });
    expect(screen.getByTestId('end-note')).toHaveTextContent('翌日');
  });

  it('開始が無い時は滞在時間を入れられないと伝える', () => {
    render(<Host start="" />);
    expect(screen.getByLabelText('滞在(時間)')).toBeDisabled();
    expect(screen.getByText('開始時刻を入れると、この場所での時間で終わりを決められます')).toBeInTheDocument();
  });

  it('印で終了時刻に切り替え、開始より前の時刻は翌日として扱う。カレンダーの印で終わる日付も入れられる(2 日後まで)', () => {
    render(<Host start="22:30" />);
    fireEvent.click(screen.getByTestId('end-mode-toggle'));
    fireEvent.change(screen.getByLabelText('終了時刻'), { target: { value: '06:10' } });
    expect(last).toEqual({ time: '06:10', offset: 1 });
    expect(screen.getByTestId('end-note')).toHaveTextContent('翌日として扱います');
    const dateToggle = screen.getByTestId('end-date-toggle');
    expect(dateToggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(dateToggle);
    const date = screen.getByLabelText('終わる日');
    expect(date).toHaveValue('2026-11-29');
    expect(date).toHaveAttribute('min', '2026-11-28');
    expect(date).toHaveAttribute('max', '2026-11-30');
    fireEvent.change(date, { target: { value: '2026-11-30' } });
    expect(last).toEqual({ time: '06:10', offset: 2 });
  });

  it('日をまたいで終わる予定は、終了時刻と日付で開く', () => {
    render(<Host start="22:30" end={{ time: '06:10', offset: 1 }} />);
    expect(screen.getByLabelText('終了時刻')).toHaveValue('06:10');
    expect(screen.getByLabelText('終わる日')).toHaveValue('2026-11-29');
  });

  it('翌日に終わる時刻を入れて影響を確かめる(旅程は変えない)', async () => {
    g7.previewEventImpact.mockResolvedValue(fx.impact_preview);
    render(<Host />);
    fireEvent.click(screen.getByTestId('end-mode-toggle'));
    fireEvent.change(screen.getByLabelText('終了時刻'), { target: { value: '06:10' } });
    fireEvent.click(screen.getByRole('button', { name: '変更の影響を確かめる' }));
    const status = await screen.findByRole('status', { name: '変更の影響' });
    expect(g7.previewEventImpact).toHaveBeenCalledWith('p1', 'e1',
      { local_start_time: '22:30', local_end_time: '06:10', end_day_offset: 1 });
    expect(status).toHaveTextContent('終了は開始の1日後です');
    expect(within(status).getByRole('list', { name: '新たに出る問題' }).querySelectorAll('li')).toHaveLength(4);
  });

  it('終了時刻が無ければ終わる日を送らない・失敗は画面に出す', async () => {
    g7.previewEventImpact.mockImplementation(async () => { throw Object.assign(new Error('422'), { response: { status: 422, data: { detail: { message: '開始より前に終わります' } } } }); });
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: '変更の影響を確かめる' }));
    expect(g7.previewEventImpact).toHaveBeenCalledWith('p1', 'e1', { local_start_time: '22:30', local_end_time: null });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('開始より前に終わります');
  });
});
