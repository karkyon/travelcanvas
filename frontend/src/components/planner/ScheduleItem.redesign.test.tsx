/**
 * [Gate TimelineRedesign] 旅程のカード: 地図と同じ番号・カードの中の並べ替え・写真の枠・「詳細を見る」(以前の右の欄の中身)・
 * 地図のピンから選ばれた時に詳細を開く。
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScheduleItem from './ScheduleItem';

const base = {
  id: 'e1', title: '赤福 本店', startTime: '14:15', endTime: '14:45', duration: 30, locationName: '',
  address: '〒516-0025 三重県伊勢市宇治中之切町26', category: 'dining', priority: 'medium' as const,
};
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('ScheduleItem(作り直し)', () => {
  it('地図と同じ番号を出し、押すと地図でこの予定を選ぶ', () => {
    const onPickMap = vi.fn();
    wrap(<ScheduleItem {...base} mapNumber={4} onPickMap={onPickMap} />);
    const num = screen.getByRole('button', { name: '地図で見る(4番)' });
    expect(num).toHaveTextContent('4');
    fireEvent.click(num);
    expect(onPickMap).toHaveBeenCalledWith('e1');
  });

  it('位置の無い予定には番号を出さない', () => {
    wrap(<ScheduleItem {...base} />);
    expect(screen.queryByTestId('schedule-num-e1')).toBeNull();
  });

  it('並べ替えのボタンはカードの中に出す', () => {
    wrap(<ScheduleItem {...base} reorder={<button type="button">「赤福 本店」を上へ移す</button>} />);
    expect(screen.getByRole('button', { name: '「赤福 本店」を上へ移す' }).closest('.tc-event-reorder')).not.toBeNull();
  });

  it('写真が無く編集できる時は「写真を追加」の枠。押すと写真を選ぶ', () => {
    const onPhoto = vi.fn();
    wrap(<ScheduleItem {...base} onPhoto={onPhoto} />);
    const btn = screen.getByTestId('schedule-photo-e1');
    expect(btn).toHaveTextContent('写真を追加');
    fireEvent.click(btn);
    expect(onPhoto).toHaveBeenCalledWith('e1');
    expect(screen.queryByTestId('schedule-image')).toBeNull();
  });

  it('写真がある時は横長に出し、押すと選び直す', () => {
    const onPhoto = vi.fn();
    wrap(<ScheduleItem {...base} onPhoto={onPhoto} image={{ src: 'blob:x', credit: '© 撮影者' }} />);
    const img = screen.getByTestId('schedule-image');
    expect(img.querySelector('img')!.getAttribute('src')).toBe('blob:x');
    expect(img).toHaveTextContent('© 撮影者');
    fireEvent.click(screen.getByTestId('schedule-photo-e1'));
    expect(onPhoto).toHaveBeenCalledWith('e1');
  });

  it('「詳細を見る」で以前の右の欄の中身(時刻・照合・出典・移動・場所・連絡先・メモ)を開く', () => {
    wrap(<ScheduleItem {...base} planId="p1" notes="持ち帰りも買う" contactInfo={{ phone: '0596-22-7000' }}
      latitude={34.46} longitude={136.72}
      hours={{ tone: 'good', symbol: '✓', text: '営業時間内', sourceText: 'Google' }}
      arrival={{ mode: 'walk', text: '徒歩 1分', isEstimate: true, status: 'planned', crossZone: null, zoneUnknown: false } as never} />);
    expect(screen.queryByTestId('schedule-detail-e1')).toBeNull();
    const more = screen.getByTestId('schedule-more-e1');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    const d = screen.getByTestId('schedule-detail-e1');
    expect(d).toHaveTextContent('時刻14:15〜14:45');
    expect(d).toHaveTextContent('予定との照合✓ 営業時間内');
    expect(d).toHaveTextContent('出典・確認Google');
    expect(screen.getByTestId('schedule-arrival')).toHaveTextContent('徒歩 1分(推定)');
    expect(d).toHaveTextContent('場所〒516-0025 三重県伊勢市宇治中之切町26');
    expect(d).toHaveTextContent('メモ持ち帰りも買う');
    expect(screen.getByRole('link', { name: /予約/ })).toHaveAttribute('href', '/planner/p1/reservations');
    expect(screen.getByRole('link', { name: /地図/ }).getAttribute('href')).toContain('mlat=34.46');
    fireEvent.click(more);
    expect(screen.queryByTestId('schedule-detail-e1')).toBeNull();
  });

  it('時刻が無く照合も無い時は、照合を作らない', () => {
    wrap(<ScheduleItem {...base} startTime="" endTime="" />);
    fireEvent.click(screen.getByTestId('schedule-more-e1'));
    const d = screen.getByTestId('schedule-detail-e1');
    expect(d).toHaveTextContent('時刻未定');
    expect(d).toHaveTextContent('時刻を決めると照合します(任意)');
    expect(screen.getByTestId('schedule-arrival')).toHaveTextContent('区間なし');
  });

  it('地図のピンから選ばれると(focusSignal が増えると)詳細を開いて、このカードまで送る', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { rerender } = wrap(<ScheduleItem {...base} focusSignal={0} />);
    expect(screen.queryByTestId('schedule-detail-e1')).toBeNull();
    rerender(<MemoryRouter><ScheduleItem {...base} focusSignal={1} /></MemoryRouter>);
    expect(screen.getByTestId('schedule-detail-e1')).toBeInTheDocument();
    expect(scroll).toHaveBeenCalled();
  });

  it('予約の札は中の段、予約の操作は上の段に出す', () => {
    wrap(<ScheduleItem {...base} badge={<span data-testid="b-status">未予約</span>} bookingAction={<button type="button">予約の操作</button>} />);
    expect(screen.getByTestId('b-status').closest('.tc-event-line')).not.toBeNull();
    expect(screen.getByRole('button', { name: '予約の操作' }).closest('.tc-event-topline')).not.toBeNull();
  });

  it('[Gate BookingJump] 詳細の「予約」は、この予定の予約があればその予約を開く(無ければ予約の一覧)', () => {
    const { unmount } = wrap(<ScheduleItem {...base} planId="p1" reservationId="r-9" />);
    fireEvent.click(screen.getByTestId('schedule-more-e1'));
    expect(screen.getByTestId('schedule-reservation-e1')).toHaveAttribute('href', '/planner/p1/reservations?open=r-9');
    unmount();
    wrap(<ScheduleItem {...base} planId="p1" />);
    fireEvent.click(screen.getByTestId('schedule-more-e1'));
    expect(screen.getByTestId('schedule-reservation-e1')).toHaveAttribute('href', '/planner/p1/reservations');
  });
});
