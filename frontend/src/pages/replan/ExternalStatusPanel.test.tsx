/**
 * [Gate Remaining-2] FR-030 外の情報(気象庁の警報・注意報・運行情報)の画面テスト。
 * - 押した時だけ取りに行く。発表中の警報を色と名前で出し、「状況として登録」で登録の欄の値を渡す
 * - 取れない提供元・運行情報の設定が無い時の案内
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ getExternalStatus: vi.fn() }));
vi.mock('@/services/api/remaining2', () => ({ getExternalStatus: m.getExternalStatus }));

import ExternalStatusPanel from './ExternalStatusPanel';
import { formFromTransit, formFromWarnings, toLocalInput } from './replanModel';

const base = {
  plan_id: 'p1', server_time: '2026-11-13T00:00:00Z', can_edit: true,
  days: [{ day_id: 'd1', local_date: '2026-11-13' }],
  providers: { jma: { enabled: true, source: '気象庁' }, odpt: { configured: false, source: 'ODPT' } },
  unavailable: [] as string[], transit: [] as never[],
};

beforeEach(() => m.getExternalStatus.mockReset());

describe('ExternalStatusPanel', () => {
  it('押した時だけ取り、発表中の警報を登録の欄へ渡す', async () => {
    m.getExternalStatus.mockResolvedValue({
      ...base,
      weather: [{ day_id: 'd1', local_date: '2026-11-13', office: '130000', office_name: '東京都',
        report_at: '2026-11-13T05:00:00+09:00', area_name: '千代田区', source: '気象庁',
        warnings: [{ code: '03', name: '大雨警報', level: 'warning', status: '発表', disruptive: true }] }],
    });
    const onUse = vi.fn();
    render(<ExternalStatusPanel planId="p1" canEdit onUse={onUse} />);
    expect(m.getExternalStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '外の情報を確かめる' }));
    expect(await screen.findByText('大雨警報')).toBeInTheDocument();
    expect(screen.getByText(/鉄道の運行情報は提供元の設定が無い/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '状況として登録' }));
    const [form, msg] = onUse.mock.calls[0]!;
    expect(form).toMatchObject({ kind: 'weather', day_id: 'd1', source_label: '気象庁', confidence: 'confirmed',
      note: '大雨警報(千代田区)' });
    expect(msg).toContain('2026-11-13');
  });

  it('取れない・予定が無い時の案内', async () => {
    m.getExternalStatus.mockResolvedValue({ ...base, days: [], weather: [], unavailable: ['jma'] });
    render(<ExternalStatusPanel planId="p1" canEdit={false} onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '外の情報を確かめる' }));
    await waitFor(() => expect(screen.getByText(/気象庁の情報を取れませんでした/)).toBeInTheDocument());
    expect(screen.getByText(/今日・明日の予定がありません/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '状況として登録' })).toBeNull();
  });
});

describe('replanModel の外の情報の変換', () => {
  it('時刻の変換と運行情報', () => {
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput('x')).toBe('');
    expect(toLocalInput('2026-11-13T05:07:00Z')).toMatch(/^2026-11-1\dT\d{2}:07$/);
    const f = formFromTransit({ railway: '山手線', status: '運転見合わせ', text: '人身事故', observed_at: null,
      source: 'ODPT', suggested_kind: 'cancellation', event_ids: ['e1', 'e2'] });
    expect(f).toMatchObject({ kind: 'cancellation', event_id: 'e1', note: '山手線: 運転見合わせ 人身事故' });
    const w = formFromWarnings({ day_id: 'd', area_name: null, report_at: null, source: '気象庁',
      warnings: [{ name: '雷注意報' }, { name: '強風注意報' }] });
    expect(w.note).toBe('雷注意報・強風注意報');
  });
});
