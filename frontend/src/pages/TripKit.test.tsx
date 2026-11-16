/**
 * [Gate TripKit] 旅行箱 UI/UX 改修(2026-11-15)の画面テスト。
 *
 * - 旅行箱の切り替え: 6 つの画面と検索へ移れ、今の画面を aria-current で示す。「その他」で残りを開ける
 * - 概要: 準備状況・取込の実データから「次に確認すること」を重い順に出す。見られない項目は「見られません」と分ける
 * - 検索: URL の条件で情報内検索 API を呼び、見つかった種類だけを出す。0 件・失敗(再試行)を分ける
 * - 予約の一覧の判定: 要確認(未確定・変更・期限 72 時間以内・未払い)、番号は伏せた末尾だけで探す、現地の日付でまとめる
 * - チケットの全画面: 使用済み・期限切れを文字で出し、Escape で閉じる
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { FinanceSummary, ImportJob, Readiness, Reservation, SearchResults, Ticket, TravelDocument } from '@/services/api';

const m = vi.hoisted(() => ({
  getReservations: vi.fn(),
  getReadiness: vi.fn(),
  getFinanceSummary: vi.fn(),
  getDocuments: vi.fn(),
  getImportJobs: vi.fn(),
  searchPlan: vi.fn(),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, ...m };
});

vi.mock('@/hooks/useTripContext', () => ({
  useTripContext: () => ({ title: '滋賀の旅', destination: '滋賀', startDate: '2026-11-15', endDate: '2026-11-16' }),
}));

import TripKitPage from './TripKitPage';
import TripKitSearchPage from './TripKitSearchPage';
import TicketFullscreen from '@/components/share/TicketFullscreen';
import { ticketWarning } from '@/components/share/ticketState';
import { attentionReasons, filterReservations, groupByDay } from './reservations/reservationListModel';

const Where: React.FC = () => <span data-testid="where">{`${useLocation().pathname}${useLocation().search}`}</span>;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/planner/:planId/kit" element={<><TripKitPage /><Where /></>} />
        <Route path="/planner/:planId/kit/search" element={<><TripKitSearchPage /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const res = (o: Partial<Reservation>): Reservation => ({ ...(fx.reservation as unknown as Reservation), ...o });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getReservations.mockResolvedValue(fx.reservation_list as unknown as Reservation[]);
  m.getReadiness.mockResolvedValue(fx.readiness_attention as unknown as Readiness);
  m.getFinanceSummary.mockResolvedValue(fx.finance_summary as unknown as FinanceSummary);
  m.getDocuments.mockResolvedValue(fx.document_list as unknown as TravelDocument[]);
  m.getImportJobs.mockResolvedValue([{ ...(fx.import_job as unknown as ImportJob), status: 'review_required' }]);
  m.searchPlan.mockResolvedValue(fx.search_plan_query as unknown as SearchResults);
});

describe('旅行箱の切り替え', () => {
  it('概要・予約・準備・費用・文書・取込と検索へ移れ、今の画面を示す。その他から残りを開ける', async () => {
    renderAt('/planner/p1/kit');
    const nav = await screen.findByRole('navigation', { name: '旅行箱の中の画面' });
    for (const name of ['概要', '予約・チケット', '準備・持ち物', '予算・費用', '文書', '予約の取込']) {
      expect(within(nav).getByRole('link', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: /概要/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '旅行箱を検索' })).toHaveAttribute('href', '/planner/p1/kit/search');
    fireEvent.click(within(nav).getByRole('button', { name: /その他/ }));
    const menu = within(nav).getByRole('list', { name: '旅行箱のその他の画面' });
    expect(within(menu).getAllByRole('link').map((a) => a.textContent)).toEqual(['文書', '予約の取込', '旅行箱を検索']);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(within(nav).queryByRole('list', { name: '旅行箱のその他の画面' })).toBeNull());
  });
});

describe('旅行箱の概要', () => {
  it('取込の確認待ちと準備状況の項目を、重い順に「次に確認すること」に出し、押すと該当の画面へ', async () => {
    renderAt('/planner/p1/kit');
    const todo = await screen.findByRole('list', { name: '次に確認すること' });
    const items = within(todo).getAllByRole('link');
    expect(items[0]).toHaveTextContent('読み取った予約の内容を確認');
    expect(items[0]).toHaveAttribute('href', '/planner/p1/imports?st=review');
    expect(todo).toHaveTextContent('「京都ホテル」に予約がありません');
    // 旅行の情報: 件数は API の値から
    const areas = await screen.findByRole('heading', { name: '旅行の情報' });
    expect(areas.parentElement).toHaveTextContent(`${(fx.reservation_list as unknown[]).length}件`);
  });

  it('費用を見られない役割では「見られません」と出し、他の項目は出す(失敗と分ける)', async () => {
    m.getFinanceSummary.mockRejectedValue({ response: { status: 403, data: { detail: 'forbidden' } } });
    m.getDocuments.mockRejectedValue({ response: { status: 500, data: { detail: '一時的な失敗' } } });
    renderAt('/planner/p1/kit');
    expect(await screen.findByText('予算・費用は、この旅行での役割では見られません')).toBeInTheDocument();
    const err = await screen.findByText(/一時的な失敗/);
    expect(within(err).getByRole('button', { name: 'もう一度読む' })).toBeInTheDocument();
    m.getDocuments.mockResolvedValue([]);
    fireEvent.click(within(err).getByRole('button', { name: 'もう一度読む' }));
    await waitFor(() => expect(screen.getByText('まだ文書がありません')).toBeInTheDocument());
  });
});

describe('旅行箱を検索', () => {
  it('URL の言葉で情報内検索 API を呼び、見つかった種類で絞り、条件をはずせる', async () => {
    renderAt('/planner/p1/kit/search?q=清水');
    await waitFor(() => expect(m.searchPlan).toHaveBeenCalledWith('p1', '清水', null));
    expect(await screen.findByRole('list', { name: '予定の結果' })).toHaveTextContent('清水寺');
    const kinds = screen.getByRole('group', { name: '見つかった種類で絞り込む' });
    fireEvent.click(within(kinds).getByRole('button', { name: /候補/ }));
    await waitFor(() => expect(screen.queryByRole('list', { name: '予定の結果' })).toBeNull());
    expect(screen.getByTestId('where')).toHaveTextContent('cat=candidate');
    fireEvent.click(screen.getByRole('button', { name: '条件「種類: 候補」をはずす' }));
    expect(await screen.findByRole('list', { name: '予定の結果' })).toBeInTheDocument();
  });

  it('絞り込みは API の filter で送り、0 件と失敗(再試行)を分ける', async () => {
    m.searchPlan.mockResolvedValueOnce({ ...(fx.search_plan_query as unknown as SearchResults), categories: [], total: 0 });
    renderAt('/planner/p1/kit/search?f=reservation');
    await waitFor(() => expect(m.searchPlan).toHaveBeenCalledWith('p1', '', 'reservation'));
    expect(await screen.findByText('見つかりませんでした。')).toBeInTheDocument();
    m.searchPlan.mockRejectedValueOnce({ response: { status: 429, data: { detail: 'too many' } } });
    fireEvent.change(screen.getByLabelText('検索する言葉'), { target: { value: 'ホテル' } });
    fireEvent.click(screen.getByRole('button', { name: '検索する' }));
    expect(await screen.findByText(/検索が多すぎました/)).toBeInTheDocument();
    m.searchPlan.mockResolvedValueOnce(fx.search_plan_query as unknown as SearchResults);
    fireEvent.click(screen.getByRole('button', { name: 'もう一度検索する' }));
    expect(await screen.findByRole('list', { name: '予定の結果' })).toBeInTheDocument();
  });
});

describe('予約の一覧の判定', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  const tl = (t: string) => ({ train: '鉄道', accommodation: '宿泊' }[t] ?? t);

  it('要確認は API の値から: 未確定・変更あり・取消期限 72 時間以内・未払い', () => {
    expect(attentionReasons(res({ status: 'candidate', total_amount: null }), now)).toEqual(['未確定']);
    expect(attentionReasons(res({ status: 'confirmed', total_amount: 5000, payment_status: 'paid', cancellation_deadline: '2026-11-11T00:00:00Z' }), now))
      .toEqual(['取消期限まで あと1日']);
    expect(attentionReasons(res({ status: 'confirmed', total_amount: 5000, payment_status: null, cancellation_deadline: null }), now)).toEqual(['支払状況が未入力']);
    expect(attentionReasons(res({ status: 'confirmed', total_amount: 5000, payment_status: 'paid', cancellation_deadline: null }), now)).toEqual([]);
  });

  it('予約番号は伏せた形の末尾(3文字以上)だけで探し、現地の日付でまとめる', () => {
    const a = res({ id: 'a', provider_name: 'JR', type: 'train', confirmation_number_masked: '****8K2Q', start_at: '2026-11-15T23:35:00Z', timezone_id: 'Asia/Tokyo' });
    const b = res({ id: 'b', provider_name: '湯元館', type: 'accommodation', confirmation_number_masked: '****1234', start_at: '2026-11-15T06:00:00Z', timezone_id: 'Asia/Tokyo' });
    const c = { q: '', st: '', type: '', sort: 'date' };
    expect(filterReservations([a, b], { ...c, q: '8k2q' }, now, tl).map((r) => r.id)).toEqual(['a']);
    expect(filterReservations([a, b], { ...c, q: '2Q' }, now, tl)).toEqual([]);
    expect(filterReservations([a, b], { ...c, q: '宿泊' }, now, tl).map((r) => r.id)).toEqual(['b']);
    const groups = groupByDay(filterReservations([a, b], c, now, tl), 'date');
    expect(groups.map((g) => g.items.map((r) => r.id))).toEqual([['b'], ['a']]); // a は現地で 11/16
  });
});

describe('チケットの全画面(SC-12)', () => {
  const t = fx.ticket as unknown as Ticket;
  it('使用済み・期限切れ・有効期間の前を文字で出す', () => {
    const now = Date.parse('2026-11-10T00:00:00Z');
    expect(ticketWarning({ ...t, status: 'used' }, now)).toBe('使用済みのチケットです');
    expect(ticketWarning({ ...t, status: 'active', valid_to: '2026-11-01T00:00:00Z', valid_from: null }, now)).toBe('有効期限が切れています');
    expect(ticketWarning({ ...t, status: 'active', valid_from: '2026-12-01T00:00:00Z', valid_to: null }, now)).toBe('まだ有効期間の前です');
  });
  it('コードと、通信なしの扱い・見せられる人を出し、Escape で閉じる', async () => {
    const onClose = vi.fn();
    render(<TicketFullscreen ticket={{ ...t, status: 'revoked', offline_allowed: true }} code="ABC-123" reservationTitle="近江酒造" timezone="Asia/Tokyo" onClose={onClose} />);
    const dlg = screen.getByRole('dialog', { name: /近江酒造/ });
    await screen.findByRole('img', { name: /のコード/ });
    expect(dlg).toHaveTextContent('取り消されたチケットです');
    expect(dlg).toHaveTextContent('旅行パックに保存すれば通信なしでも表示できます');
    expect(within(dlg).getByRole('button', { name: '全画面のチケットを閉じる' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
