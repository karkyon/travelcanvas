/** [Gate PlanB-P6] 今日の画面の「プランB に切り替える」: 合流点・とばす予定・屋外の予定・雨の知らせ・途中の切り替え */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SwitchOptions } from '@/services/api/dayVariants';

const m = vi.hoisted(() => ({ getSwitchOptions: vi.fn(), switchVariant: vi.fn() }));
vi.mock('@/services/api', () => ({ api: {
  get: (url: string, cfg: { params: unknown }) => m.getSwitchOptions(url.split('/')[2], cfg.params).then((data: unknown) => ({ data })),
  post: (url: string, body: unknown, cfg: { headers: Record<string, string> }) =>
    m.switchVariant(url.split('/')[2], url.split('/')[4], Number(cfg.headers['If-Match']), body).then((data: unknown) => ({ data })),
} }));
import TodaySwitchPanel from './TodaySwitchPanel';

const v = { day_id: 'b', local_date: '2026-11-29', label: 'B', name: '雨の日', status: 'standby' as const, reason: 'rain' as const,
  reason_label: '雨', conditions: {}, group_id: null, copied_from_day_id: null, events: 3, first_time: '09:00', last_time: '13:00',
  titles: [] };
const opts = (): SwitchOptions => ({
  revision: 7, date: '2026-11-29', now: '10:00', here_known: true,
  alerts: [{ id: 'a', kind: 'weather', label: '雨天・警報', note: '午後から雨' }],
  options: [{ variant: v, recommended: true, skipped: ['海の博物館'], done: ['二見興玉神社'], done_ids: ['e1'],
    outdoor_after_join: ['海辺でバーベキュー'],
    join: { event_id: 'j', title: '鳥羽水族館', start: '11:30', mode: 'train', travel_minutes: 25, arrive: '10:25', margin_minutes: 65,
      travel_known: true },
    check: { status: 'warn', counts: { ok: 0, info: 0, warn: 1, bad: 0 },
      items: [{ kind: 'weather', level: 'warn', title: '雨の案に屋外の予定: 海辺でバーベキュー', text: '' }] } }],
});
const events = [{ id: 'e1', title: '二見興玉神社', event_type: 'sightseeing', start_at: null, end_at: null, local_start_time: '08:00',
  address: null, latitude: null, longitude: null, has_ticket: false, reservation_id: null }];

describe('TodaySwitchPanel', () => {
  beforeEach(() => { m.getSwitchOptions.mockReset(); m.switchVariant.mockReset(); });

  it('控えの案が無い日は何も出さない', async () => {
    m.getSwitchOptions.mockResolvedValue({ date: '2026-11-29', now: '10:00', alerts: [], options: [] });
    const { container } = render(<TodaySwitchPanel planId="p" date="2026-11-29" events={events as never} onSwitched={vi.fn()} />);
    await waitFor(() => expect(m.getSwitchOptions).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('雨の知らせ・合流点・とばす予定・屋外の予定を出し、途中から切り替える', async () => {
    m.getSwitchOptions.mockResolvedValue(opts());
    m.switchVariant.mockResolvedValue({ revision: 8 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSwitched = vi.fn();
    render(<TodaySwitchPanel planId="p" date="2026-11-29" events={events as never} onSwitched={onSwitched} />);
    const card = await screen.findByTestId('today-switch-B');
    expect(screen.getByTestId('today-switch-alert').textContent).toContain('雨天・警報: 午後から雨');
    expect(card.textContent).toContain('おすすめ');
    expect(card.textContent).toContain('合流: 11:30 鳥羽水族館 ← 電車 25分(10:25 着)');
    expect(card.textContent).toContain('とばす予定: 海の博物館');
    expect(card.textContent).toContain('この後に屋外の予定: 海辺でバーベキュー');
    // 今いる所を選ぶと、その予定から計算し直す
    fireEvent.change(screen.getByTestId('today-switch-from'), { target: { value: 'e1' } });
    await waitFor(() => expect(m.getSwitchOptions).toHaveBeenLastCalledWith('p', { date: '2026-11-29', from_event_id: 'e1' }));
    fireEvent.click(await screen.findByTestId('today-switch-go-B'));
    await waitFor(() => expect(onSwitched).toHaveBeenCalled());
    expect(m.switchVariant).toHaveBeenCalledWith('p', 'b', 7, { reason: 'rain', phase: 'during', join_event_id: 'j',
      done_event_ids: ['e1'], place_label: '二見興玉神社のあたり' });
  });
});
