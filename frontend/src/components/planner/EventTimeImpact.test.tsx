/** [Gate G7] FR-005 終了時刻・終わる日の入力と、保存する前の影響の確認。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React, { useState } from 'react';
import fx from '@/services/api/__fixtures__/g7Responses.json';

const g7 = vi.hoisted(() => ({ previewEventImpact: vi.fn() }));
vi.mock('@/services/api/g7', () => ({ previewEventImpact: g7.previewEventImpact }));

import EventTimeImpact, { type EndValue } from './EventTimeImpact';

const Host: React.FC = () => {
  const [end, setEnd] = useState<EndValue>({ time: '', offset: 0 });
  return <EventTimeImpact planId="p1" eventId="e1" startTime="22:30" end={end} onEndChange={setEnd} />;
};

beforeEach(() => { g7.previewEventImpact.mockReset(); });

describe('EventTimeImpact', () => {
  it('翌日に終わる時刻を入れて影響を確かめる(旅程は変えない)', async () => {
    g7.previewEventImpact.mockResolvedValue(fx.impact_preview);
    render(<Host />);
    fireEvent.change(screen.getByLabelText('終了時刻'), { target: { value: '06:10' } });
    fireEvent.change(screen.getByLabelText('終わる日'), { target: { value: '1' } });
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
