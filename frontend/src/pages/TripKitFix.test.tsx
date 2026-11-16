/**
 * [Gate TripKitFix] 旅行箱の補正(状態の意味・画面のつながり)の試験。
 *
 * - 準備: 出発前チェック(予約・支払い・期限・予算)と持ち物・担当を分けて数える。持ち物 0 件は「リスト未作成」
 * - 費用: settlement_state で「立替なし / 精算が残っています / 精算済み」を出す(画面で推測しない)
 * - 予約: 合計は通貨ごと(換算しない)。支払いの札と、要確認から直す操作の言葉。詳細で支払い状況を版つきで保存する
 * - 文書: 関連の件数(関連なし)、候補はファイル名の語の重なりで並べるだけ。関連付けは既存の API で参照だけを足す
 * - 検索語: URL に置かない(古い URL の ?q= は読み、URL から消す)
 * - 「予約を追加」: 取り込む・手入力を選ぶメニュー。Esc で閉じる
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { FinanceSummary, Readiness, Reservation, TravelDocument } from '@/services/api';

const m = vi.hoisted(() => ({
  updateReservation: vi.fn(),
  createDocumentLink: vi.fn(),
  getReservations: vi.fn(),
  getPlanDetail: vi.fn(),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    updateReservation: m.updateReservation,
    getReservations: m.getReservations,
    default: { ...actual.default, getPlanDetail: m.getPlanDetail },
  };
});

vi.mock('@/services/api/documentLinks', () => ({ createDocumentLink: m.createDocumentLink }));

import { checkCounts, departureBreakdown } from './preparation/preparationModel';
import { settlementTile } from './expenses/financeModel';
import { fixLabel, paymentText, paymentTone, reservationTotals } from './reservations/reservationListModel';
import { linkCandidates, nameTokens, relationCount } from './documents/documentLinkModel';
import ReservationPaymentEditor from './reservations/ReservationPaymentEditor';
import DocumentLinkDialog from './documents/DocumentLinkDialog';
import PackingPanel from './preparation/PackingPanel';
import { KitAddReservation } from '@/components/shell/KitParts';
import { MEMORY_ONLY_Q, useQueryState } from '@/components/shell/tripKitModel';

const readiness = (by: Partial<Readiness['counts']['by_category']>): Readiness => ({
  ...(fx.readiness_attention as unknown as Readiness),
  counts: {
    total: Object.values(by).reduce((a, b) => a + (b ?? 0), 0),
    by_severity: { high: 0, medium: 1, low: 0 },
    by_category: { unreserved: 0, unconfirmed: 0, unpaid: 0, deadline: 0, unassigned: 0, packing: 0, budget: 0, ...by },
  },
});
const res = (o: Partial<Reservation>): Reservation => ({ ...(fx.reservation as unknown as Reservation), ...o });

beforeEach(() => { for (const fn of Object.values(m)) fn.mockReset(); });

describe('準備: 出発前チェックと持ち物を分ける', () => {
  it('支払いの確認は出発前チェックに数え、持ち物の不足・担当は別に数える', () => {
    const cc = checkCounts(readiness({ unpaid: 1, packing: 2, unassigned: 1 }))!;
    expect(cc.departure).toBe(1);
    expect(cc.packing).toBe(3);
    expect(departureBreakdown(cc)).toBe('支払い 1');
    expect(departureBreakdown(checkCounts(readiness({}))!)).toBe('予約・支払い・期限・予算は問題なし');
    expect(departureBreakdown(checkCounts(readiness({ unreserved: 1, unconfirmed: 1, deadline: 1 }))!)).toBe('予約 1 · 予約 1 · 期限 1');
    expect(checkCounts(null)).toBeNull();
  });

  it('持ち物が 0 件の時は「リスト未作成」と、候補から作る・1つずつ足すを出す', () => {
    const onShow = vi.fn();
    const onAdd = vi.fn();
    render(<MemoryRouter><PackingPanel items={[]} canEdit myUserId={null} suggestions={null} conditions={{}} isLoadingSuggestions={false}
      onConditionsChange={vi.fn()} onShowSuggestions={onShow} onAdoptSuggestion={vi.fn()} onApplyQuantity={vi.fn()} onAdd={onAdd}
      onEdit={vi.fn()} onDelete={vi.fn()} onStatusChange={vi.fn()} /></MemoryRouter>);
    expect(screen.getByTestId('packing-empty')).toHaveTextContent('持ち物のリストはまだありません');
    fireEvent.click(screen.getByRole('button', { name: '候補から作る' }));
    fireEvent.click(screen.getByRole('button', { name: '1つずつ足す' }));
    expect(onShow).toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalled();
  });
});

describe('費用: 精算の状態', () => {
  const base = fx.finance_summary as unknown as FinanceSummary;
  it('none は「立替なし」、open は「精算が残っています」、settled だけ「精算済み」', () => {
    expect(settlementTile({ ...base, settlement_state: 'none', is_settled: true })).toMatchObject({ value: '立替なし', tone: 'muted' });
    expect(settlementTile({ ...base, settlement_state: 'open', is_settled: false })).toMatchObject({ value: '精算が残っています', tone: 'warn' });
    expect(settlementTile({ ...base, settlement_state: 'settled', is_settled: true }).value).toBe('精算済み');
  });
  it('契約の見本: 支出の無い概要は none', () => {
    expect((fx.finance_summary_empty as unknown as FinanceSummary).settlement_state).toBe('none');
  });
});

describe('予約: 一覧の要点', () => {
  it('合計は通貨ごとに足し、換算しない。支払い済みも出す', () => {
    expect(reservationTotals([
      res({ total_amount: 84100, currency: 'JPY', payment_status: null }),
      res({ total_amount: 12480, currency: 'JPY', payment_status: 'paid' }),
      res({ total_amount: null }),
    ])).toEqual({ text: '96,580 円', paidText: '支払い済み 12,480 円' });
    expect(reservationTotals([res({ total_amount: 100, currency: 'USD' }), res({ total_amount: 5000, currency: 'JPY' })]).text)
      .toBe('100 USD + 5,000 円');
    expect(reservationTotals([]).text).toBe('—');
  });
  it('支払いの札と、要確認から直す操作の言葉', () => {
    expect(paymentText(res({ total_amount: 1000, payment_status: null }))).toBe('支払い 未入力');
    expect(paymentTone(res({ total_amount: 1000, payment_status: null, status: 'confirmed' }))).toBe('warn');
    expect(paymentTone(res({ total_amount: 1000, payment_status: 'paid' }))).toBe('ok');
    expect(paymentText(res({ total_amount: null, payment_status: null }))).toBe('—');
    expect(fixLabel(['支払状況が未入力'])).toBe('支払い状況を入れる');
    expect(fixLabel(['未確定'])).toBe('予約を確定する');
  });
  it('詳細で支払い状況を入れると、予約の版(If-Match)つきで保存する', async () => {
    const r = res({ id: 'r1', total_amount: 84100, currency: 'JPY', payment_status: null, status: 'confirmed', revision: 3 });
    const saved = { ...r, payment_status: 'on_site', revision: 4 };
    m.updateReservation.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<ReservationPaymentEditor reservation={r} planId="p1" onSaved={onSaved} formatDateTime={(v) => v ?? ''} />);
    expect(screen.getByText(/支払状況が未入力/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('支払い状況を入れる'), { target: { value: 'on_site' } });
    fireEvent.click(save);
    await waitFor(() => expect(m.updateReservation).toHaveBeenCalledWith('p1', 'r1', { payment_status: 'on_site' }, 3));
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(await screen.findByRole('status')).toHaveTextContent('保存しました');
  });
  it('保存に失敗したら理由を出す(閲覧者・版の衝突)', async () => {
    m.updateReservation.mockRejectedValue({ response: { status: 403, data: { detail: '編集する権限がありません' } } });
    render(<ReservationPaymentEditor reservation={res({ id: 'r1', payment_status: null })} planId="p1" onSaved={vi.fn()} formatDateTime={() => ''} />);
    fireEvent.change(screen.getByLabelText('支払い状況を入れる'), { target: { value: 'paid' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('編集する権限がありません');
  });
});

describe('文書: 関連付け', () => {
  const doc = (o: Partial<TravelDocument>): TravelDocument => ({ ...((fx.document_list as unknown as TravelDocument[])[0]!), ...o });
  it('関連の件数: 予約などへの関連と領収書の合計。件数が無い応答は「分からない」(null)', () => {
    expect(relationCount(doc({ link_count: 0, receipt_count: 0 }))).toBe(0);
    expect(relationCount(doc({ link_count: 1, receipt_count: 2 }))).toBe(3);
    expect(relationCount(doc({ link_count: undefined, receipt_count: undefined }))).toBeNull();
  });
  it('候補はファイル名と名前の語が重なるものを上に出す(勝手には関連付けない)', () => {
    expect(nameTokens('鳥羽の宿_予約確認.pdf').has('鳥羽')).toBe(true);
    const list = linkCandidates('鳥羽の宿_予約確認.pdf', [
      res({ id: 'a', provider_name: '近鉄特急', status: 'confirmed' }),
      res({ id: 'b', provider_name: '鳥羽の宿', status: 'confirmed' }),
      res({ id: 'c', provider_name: '取消した宿', status: 'cancelled' }),
    ], [{ id: 'd1', local_date: '2026-11-28', events: [{ id: 'e1', title: '海女小屋の昼食' }] }] as never);
    expect(list[0]).toMatchObject({ kind: 'reservation', id: 'b' });
    expect(list[0]!.score).toBeGreaterThan(0);
    expect(list.some((t) => t.id === 'c')).toBe(false);
    expect(list.find((t) => t.id === 'e1')).toMatchObject({ kind: 'event', sub: '1日目 2026-11-28' });
  });
  it('選んだ予約へ、既存の API で関連付ける', async () => {
    m.getReservations.mockResolvedValue([res({ id: 'r9', provider_name: '海女小屋', status: 'confirmed' })]);
    m.getPlanDetail.mockResolvedValue({ data: { days: [] } });
    m.createDocumentLink.mockResolvedValue({ id: 'l1' });
    const onLinked = vi.fn();
    const onClose = vi.fn();
    render(<DocumentLinkDialog planId="p1" doc={doc({ id: 'd1', original_filename: '海女小屋_案内.pdf' })} onClose={onClose} onLinked={onLinked} />);
    const picks = await screen.findAllByRole('radio', { name: /予約: 海女小屋/ });
    fireEvent.click(picks[0]!);
    fireEvent.click(screen.getByRole('button', { name: '関連付ける' }));
    await waitFor(() => expect(m.createDocumentLink).toHaveBeenCalledWith('p1', 'd1', { entity_type: 'reservation', entity_id: 'r9' }));
    expect(onLinked).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

const Where: React.FC = () => <span data-testid="where">{useLocation().search}</span>;
const SearchBox: React.FC = () => {
  const [cond, setCond] = useQueryState({ q: '', st: '' }, MEMORY_ONLY_Q);
  return (
    <>
      <input aria-label="検索" value={cond.q} onChange={(e) => setCond({ q: e.target.value })} />
      <button type="button" onClick={() => setCond({ st: 'attention' })}>要確認</button>
      <span data-testid="q">{cond.q}</span>
    </>
  );
};

describe('SEC 検索語を URL に置かない', () => {
  it('入れた検索語は画面の中だけ。ほかの条件は今までどおり URL に置く', () => {
    render(<MemoryRouter initialEntries={['/x']}><Routes><Route path="/x" element={<><SearchBox /><Where /></>} /></Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('検索'), { target: { value: '7421' } });
    expect(screen.getByTestId('q')).toHaveTextContent('7421');
    expect(screen.getByTestId('where').textContent).not.toContain('7421');
    fireEvent.click(screen.getByRole('button', { name: '要確認' }));
    expect(screen.getByTestId('where')).toHaveTextContent('?st=attention');
    expect(screen.getByTestId('q')).toHaveTextContent('7421');
  });
  it('古い URL の ?q= は読み込んで、URL から消す', async () => {
    render(<MemoryRouter initialEntries={['/x?q=SECRET&st=attention']}><Routes><Route path="/x" element={<><SearchBox /><Where /></>} /></Routes></MemoryRouter>);
    expect(screen.getByTestId('q')).toHaveTextContent('SECRET');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?st=attention'));
  });
});

describe('「予約を追加」', () => {
  it('取り込む・手入力を選べる。Esc で閉じてボタンへ戻る', async () => {
    const onImport = vi.fn();
    const onManual = vi.fn();
    render(<KitAddReservation onImport={onImport} onManual={onManual} />);
    const btn = screen.getByRole('button', { name: /予約を追加/ });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([expect.stringContaining('メール・画像から取り込む'), expect.stringContaining('手入力で作る')]);
    await waitFor(() => expect(items[0]).toHaveFocus());
    act(() => { fireEvent.keyDown(items[0]!, { key: 'Escape' }); });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(btn).toHaveFocus();
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('menuitem', { name: /手入力で作る/ }));
    expect(onManual).toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });
});
