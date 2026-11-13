/** [Gate TDay-Push / TDay-Transit] 当日の設定の「端末への通知」と、乗換で調べた時刻を入れる部品 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TodayEvent } from '@/services/api';
import type { GuideEvent } from '@/services/api/travelDay';

const m = vi.hoisted(() => ({
  support: 'ok' as string,
  cfg: {
    available: true, public_key: 'BPK', kinds: { depart: true, rain: true, morning: true, crew: true }, devices: [],
    notice: 'お知らせ',
  },
  getPushConfig: vi.fn(), putPushKinds: vi.fn(), sendTestPush: vi.fn(), enablePush: vi.fn(), disablePush: vi.fn(),
  syncThisDevice: vi.fn(), saveTransitTime: vi.fn(),
}));

vi.mock('@/services/api/push', () => ({
  pushSupport: () => m.support, getPushConfig: m.getPushConfig, putPushKinds: m.putPushKinds,
  sendTestPush: m.sendTestPush, enablePush: m.enablePush, disablePush: m.disablePush, syncThisDevice: m.syncThisDevice,
}));
vi.mock('@/services/api/travelDay', () => ({ saveTransitTime: m.saveTransitTime }));

import PushPanel from './PushPanel';
import TransitTime from './TransitTime';

const device = { id: 'd1', label: 'Android Chrome', at: '2026-11-13T00:00:00Z', current_key: true };

beforeEach(() => {
  m.support = 'ok';
  for (const f of [m.getPushConfig, m.putPushKinds, m.sendTestPush, m.enablePush, m.disablePush, m.syncThisDevice,
    m.saveTransitTime]) f.mockReset();
  m.getPushConfig.mockResolvedValue(m.cfg);
  m.syncThisDevice.mockResolvedValue(null);
});

describe('端末への通知', () => {
  it('押した時だけ許可を求めて登録し、試しに送れる', async () => {
    m.enablePush.mockResolvedValue({ ...m.cfg, devices: [device] });
    m.sendTestPush.mockResolvedValue({ ...m.cfg, devices: [device], sent: 1, removed: 0, failed: 0 });
    render(<PushPanel />);
    const toggle = await screen.findByTestId('today-push-toggle');
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(m.enablePush).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '試しに送る' })).toBeDisabled();
    fireEvent.click(toggle);
    await screen.findByText('この端末に通知を送ります');
    expect(m.enablePush).toHaveBeenCalledWith('BPK');
    expect(screen.getByText('登録した端末 1台')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '試しに送る' }));
    await screen.findByText(/1台の端末に送りました/);
  });

  it('種類を切り替えると保存する(登録済みの端末)', async () => {
    m.syncThisDevice.mockResolvedValue({ ...m.cfg, devices: [device] });
    m.putPushKinds.mockResolvedValue({ ...m.cfg, devices: [device], kinds: { ...m.cfg.kinds, rain: false } });
    render(<PushPanel />);
    const rain = await screen.findByRole('checkbox', { name: /雨の兆し/ });
    await waitFor(() => expect(rain).not.toBeDisabled());
    fireEvent.click(rain);
    await waitFor(() => expect(m.putPushKinds).toHaveBeenCalledWith({ rain: false }));
    await waitFor(() => expect(rain).not.toBeChecked());
  });

  it('http の画面・iPhone のブラウザでは使い方を案内して押せない', async () => {
    m.support = 'insecure';
    const { unmount } = render(<PushPanel />);
    expect(await screen.findByRole('note')).toHaveTextContent('https で開いた画面でだけ使えます');
    expect(screen.getByTestId('today-push-toggle')).toBeDisabled();
    unmount();
    m.support = 'ios_needs_home_screen';
    render(<PushPanel />);
    expect(await screen.findByRole('note')).toHaveTextContent('ホーム画面に追加');
  });
});

const next: TodayEvent = {
  id: 'b', title: 'テラス', event_type: 'activity', start_at: '2026-11-13T02:00:00Z', end_at: null,
  local_start_time: '11:00', address: null, latitude: 35.0143, longitude: 135.879, has_ticket: false,
  reservation_id: null, time_source: 'local_start_time', departure_at: null, transport_mode: null, transport_status: null,
};
const from: TodayEvent = { ...next, id: 'a', title: 'ホテル', latitude: 35.0045, longitude: 135.8686 };
const guide: GuideEvent = {
  event_id: 'b', place_id: null, phone: null, image_memory_id: null, end_at: null, end_estimated: false,
  travel_minutes: 40, travel_mode: 'walking', distance_km: 1.5, travel_source: 'estimate',
  leave_by: '2026-11-13T01:20:00Z', fit: 'indoor', hours: null, start_at: '2026-11-13T02:00:00Z', from_event_id: 'a',
  segment_id: null, segment_revision: null, segment_departure_at: null,
};

describe('乗換で調べた時刻', () => {
  it('外の地図の乗換を開け、調べた時刻を区間に入れる', async () => {
    m.saveTransitTime.mockResolvedValue({});
    const onSaved = vi.fn();
    render(<TransitTime planId="p1" next={next} from={from} guide={guide} localDate="2026-11-13" timeZone="Asia/Tokyo"
      onSaved={onSaved} />);
    const link = screen.getByRole('link', { name: /乗換を調べる/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('travelmode=transit'));
    expect(link).toHaveAttribute('href', expect.stringContaining('origin=35.0045%2C135.8686'));
    fireEvent.click(screen.getByRole('button', { name: '調べた時刻を入れる' }));
    fireEvent.change(screen.getByLabelText('出発(任意)'), { target: { value: '10:20' } });
    fireEvent.change(screen.getByLabelText('所要(分)'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'この時刻で合図を出す' }));
    await screen.findByText(/保存しました/);
    expect(m.saveTransitTime).toHaveBeenCalledWith('p1', {
      to_event_id: 'b', from_event_id: 'a', segment_id: null, segment_revision: null, mode: 'train',
      duration_minutes: 25, departure_at: '2026-11-13T01:20:00.000Z',
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('保存できない時は理由を出す', async () => {
    m.saveTransitTime.mockRejectedValue(new Error('x'));
    render(<TransitTime planId="p1" next={next} from={from} guide={{ ...guide, segment_id: 's1', segment_revision: 3 }}
      localDate="2026-11-13" timeZone="Asia/Tokyo" onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '調べた時刻を入れる' }));
    fireEvent.change(screen.getByLabelText('所要(分)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'この時刻で合図を出す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした');
    expect(m.saveTransitTime.mock.calls[0]?.[1]).toMatchObject({ segment_id: 's1', segment_revision: 3, departure_at: null });
  });
});
