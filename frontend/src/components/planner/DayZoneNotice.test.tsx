import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DayZoneNotice from './DayZoneNotice';
import { needsZoneFix } from '@/utils/deviceZone';

const setDayTimeZone = vi.fn();
vi.mock('@/store/planStore', () => ({
  usePlanStore: (sel: (s: { setDayTimeZone: typeof setDayTimeZone }) => unknown) => sel({ setDayTimeZone }),
}));

function deviceIs(tz: string | undefined) {
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    (() => ({ resolvedOptions: () => ({ timeZone: tz }) })) as unknown as typeof Intl.DateTimeFormat);
}

describe('[Gate2 G2-04] DayZoneNotice', () => {
  beforeEach(() => { setDayTimeZone.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('needsZoneFix: UTC の日で端末が UTC でない時だけ', () => {
    expect(needsZoneFix('UTC', 'Asia/Tokyo')).toBe(true);
    expect(needsZoneFix('UTC', 'UTC')).toBe(false);
    expect(needsZoneFix('Asia/Tokyo', 'Asia/Tokyo')).toBe(false);
    expect(needsZoneFix('Europe/London', 'Asia/Tokyo')).toBe(false);
    expect(needsZoneFix(undefined, 'Asia/Tokyo')).toBe(false);
    expect(needsZoneFix('UTC', undefined)).toBe(false);
  });

  it('UTC の日で端末が日本なら知らせを出し、押すと端末の時刻帯で付け替える', async () => {
    deviceIs('Asia/Tokyo');
    setDayTimeZone.mockResolvedValue(true);
    render(<DayZoneNotice dayId="d1" dayZone="UTC" />);
    expect(screen.getByTestId('day-zone-notice')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Asia\/Tokyo に合わせる/ }));
    await waitFor(() => expect(setDayTimeZone).toHaveBeenCalledWith('d1', 'Asia/Tokyo'));
  });

  it('付け替えに失敗したら理由と次の手を出す', async () => {
    deviceIs('Asia/Tokyo');
    setDayTimeZone.mockResolvedValue(false);
    render(<DayZoneNotice dayId="d1" dayZone="UTC" />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('日の時刻帯が日本なら何も出さない', () => {
    deviceIs('Asia/Tokyo');
    render(<DayZoneNotice dayId="d1" dayZone="Asia/Tokyo" />);
    expect(screen.queryByTestId('day-zone-notice')).toBeNull();
  });
});
