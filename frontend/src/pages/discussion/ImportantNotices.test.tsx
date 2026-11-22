/**
 * [Gate② FC-064] 確認してほしいお知らせ: メンバーは「確認しました」、編集できる人は誰がまだかを見る。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PlanNoticeItem } from '@/services/api/planNotices';

const m = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), ack: vi.fn() }));
vi.mock('@/services/api/planNotices', () => ({ getNotices: m.get, createNotice: m.create, acknowledgeNotice: m.ack }));

import ImportantNotices from './ImportantNotices';

const n = (over: Partial<PlanNoticeItem> = {}): PlanNoticeItem => ({
  id: 'n1', kind: 'meeting_change', kind_label: '集合の変更', title: '集合は北口 9:00', body: null, created_at: null,
  created_by: 'A', acknowledged: false, acknowledged_at: null, ack_count: 0, member_count: 2, needs_my_ack: true, ...over,
});

beforeEach(() => { m.get.mockReset(); m.create.mockReset(); m.ack.mockReset(); });

describe('確認してほしいお知らせ (FC-064)', () => {
  it('メンバーは「確認しました」を押せて、押した後は確認済みになる', async () => {
    m.get.mockResolvedValue({ items: [n()], can_edit: false });
    m.ack.mockResolvedValue(n({ acknowledged: true, needs_my_ack: false, ack_count: 1 }));
    render(<ImportantNotices planId="p1" />);
    fireEvent.click(await screen.findByTestId('notice-ack-n1'));
    await waitFor(() => expect(m.ack).toHaveBeenCalledWith('p1', 'n1'));
    expect(await screen.findByTestId('notice-acked-n1')).toBeInTheDocument();
    expect(screen.getByTestId('notice-n1')).toHaveTextContent('確認 1/2人');
    expect(screen.queryByTestId('notice-new')).toBeNull();  // 閲覧だけの人は出せない
  });

  it('編集できる人は、まだの人・確認済みの人を見て、新しいお知らせを出せる', async () => {
    m.get.mockResolvedValue({ items: [n({ needs_my_ack: false, members: [
      { name: 'B', acknowledged: false, acknowledged_at: null }, { name: 'C', acknowledged: true, acknowledged_at: null }] })],
    can_edit: true });
    m.create.mockResolvedValue(n({ id: 'n2', kind: 'major_change', kind_label: '重大な変更', title: '2 日目を取りやめ', needs_my_ack: false }));
    render(<ImportantNotices planId="p1" />);
    expect(await screen.findByTestId('notice-members-n1')).toHaveTextContent('まだ: B / 確認済み: C');
    fireEvent.click(screen.getByTestId('notice-new'));
    fireEvent.change(screen.getByTestId('notice-kind'), { target: { value: 'major_change' } });
    fireEvent.change(screen.getByTestId('notice-title'), { target: { value: '2 日目を取りやめ' } });
    fireEvent.click(screen.getByTestId('notice-send'));
    await waitFor(() => expect(m.create).toHaveBeenCalledWith('p1', 'major_change', '2 日目を取りやめ', ''));
    expect(await screen.findByTestId('notice-n2')).toHaveTextContent('重大な変更: 2 日目を取りやめ');
  });

  it('お知らせが無く、出せない人には何も出さない', async () => {
    m.get.mockResolvedValue({ items: [], can_edit: false });
    const { container } = render(<ImportantNotices planId="p1" />);
    await waitFor(() => expect(m.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
