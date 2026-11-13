/** [Gate Remaining-5] FR-036 カレンダーの購読(作る・止める・ほかの人が作った) */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({ getCalendarFeed: vi.fn(), createCalendarFeed: vi.fn(), deleteCalendarFeed: vi.fn() }));
vi.mock('@/services/api/remaining5', () => m);

import CalendarFeedCard from './CalendarFeedCard';

const off = { enabled: false, url: null, webcal_url: null };

beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));

describe('CalendarFeedCard', () => {
  it('作ると webcal の URL を出し、止められる', async () => {
    m.getCalendarFeed.mockResolvedValue(off);
    m.createCalendarFeed.mockResolvedValue({ enabled: true, url: 'https://a/api/v1/public/calendar/t.ics',
      webcal_url: 'webcal://a/api/v1/public/calendar/t.ics' });
    m.deleteCalendarFeed.mockResolvedValue(off);
    render(<CalendarFeedCard planId="p" />);
    fireEvent.click(await screen.findByRole('button', { name: '購読の URL を作る' }));
    expect(await screen.findByTestId('calendar-feed-url')).toHaveValue('webcal://a/api/v1/public/calendar/t.ics');
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    expect(await screen.findByRole('button', { name: '購読の URL を作る' })).toBeInTheDocument();
  });

  it('ほかのメンバーが作った時は案内', async () => {
    m.getCalendarFeed.mockResolvedValue({ enabled: true, url: null, webcal_url: null, by_other: true });
    render(<CalendarFeedCard planId="p" />);
    expect(await screen.findByText(/ほかのメンバーが購読の URL を作っています/)).toBeInTheDocument();
  });
});
