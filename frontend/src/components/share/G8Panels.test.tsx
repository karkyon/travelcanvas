/** [Gate G8] 所有者の移譲(申し出・受け入れ)・出典つきの訂正・訂正の申し出・定期の処理の画面テスト。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/g8Responses.json';
import type {
  CorrectionRequest, CorrectionsOverview, OpsJobs, OwnershipInfo, OwnershipTransfer,
} from '@/services/api/types/g8';

const g8 = vi.hoisted(() => ({
  getOwnership: vi.fn(), requestOwnershipTransfer: vi.fn(), cancelOwnershipTransfer: vi.fn(),
  getIncomingTransfers: vi.fn(), acceptOwnershipTransfer: vi.fn(), declineOwnershipTransfer: vi.fn(),
  getCorrections: vi.fn(), createCorrection: vi.fn(), revertCorrection: vi.fn(),
  listCorrectionRequests: vi.fn(), createCorrectionRequest: vi.fn(), resolveCorrectionRequest: vi.fn(),
  getOpsJobs: vi.fn(),
}));
vi.mock('@/services/api/g8', () => g8);

import OwnershipTransferPanel from './OwnershipTransferPanel';
import IncomingTransfers from '@/components/notifications/IncomingTransfers';
import CorrectionsCard from '@/pages/privacy/CorrectionsCard';
import CorrectionRequestsPage from '@/pages/CorrectionRequestsPage';
import AdminJobsPanel from '@/pages/Admin/AdminJobsPanel';
import Surface from '@/components/design/Surface';

const owner = fx.ownership_info_owner as OwnershipInfo;
const pending = fx.ownership_info_pending as OwnershipInfo;
const incoming = fx.ownership_incoming as OwnershipTransfer[];
const corrections = fx.corrections_list as CorrectionsOverview;
const requests = fx.correction_requests_owner as CorrectionRequest[];
const jobs = fx.admin_jobs as OpsJobs;
const conflict = (message: string) => ({ response: { status: 409, data: { detail: { code: 'x', message } } } });

beforeEach(() => {
  for (const fn of Object.values(g8)) fn.mockReset();
});

describe('OwnershipTransferPanel', () => {
  it('所有者は相手・残り方・パスワードを入れて申し出、手続き中は取り下げられる', async () => {
    g8.getOwnership.mockResolvedValueOnce(owner).mockResolvedValue(pending);
    g8.requestOwnershipTransfer.mockResolvedValue(pending.pending);
    render(<OwnershipTransferPanel planId="p1" />);
    const submit = await screen.findByRole('button', { name: '移譲を申し出る' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('引き継ぐ人'), { target: { value: owner.candidates[0]!.collaborator_id } });
    fireEvent.change(screen.getByLabelText('引き継いだ後のあなた'), { target: { value: 'viewer' } });
    fireEvent.change(screen.getByLabelText('本人確認のためのパスワード'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('ひとこと(任意・500文字まで)'), { target: { value: ' お願い ' } });
    fireEvent.click(submit);
    await waitFor(() => expect(g8.requestOwnershipTransfer).toHaveBeenCalledWith('p1',
      owner.candidates[0]!.collaborator_id, 'pw', 'viewer', 'お願い'));
    expect(await screen.findByRole('status')).toHaveTextContent('さんへ申し出ました');
    expect(await screen.findByTestId('ownership-pending')).toHaveTextContent('編集者として残る');
    g8.cancelOwnershipTransfer.mockResolvedValue({ ...pending.pending, status: 'cancelled' });
    g8.getOwnership.mockResolvedValue(owner);
    fireEvent.click(screen.getByRole('button', { name: '申し出を取り下げる' }));
    await waitFor(() => expect(g8.cancelOwnershipTransfer).toHaveBeenCalledWith('p1'));
    expect(await screen.findByRole('status')).toHaveTextContent('取り下げました');
  });

  it('所有者でなければ出さない。相手がいない・失敗は案内する', async () => {
    g8.getOwnership.mockResolvedValue({ ...owner, role: 'editor' });
    const { container, unmount } = render(<OwnershipTransferPanel planId="p1" />);
    await waitFor(() => expect(g8.getOwnership).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();
    g8.getOwnership.mockResolvedValue({ ...owner, candidates: [] });
    render(<OwnershipTransferPanel planId="p1" />);
    expect(await screen.findByText(/移譲できる相手がいません/)).toBeInTheDocument();
  });

  it('申し出の失敗(パスワード違いなど)は理由を出す', async () => {
    g8.getOwnership.mockResolvedValue(owner);
    g8.requestOwnershipTransfer.mockRejectedValue(conflict('パスワードが正しくありません'));
    render(<OwnershipTransferPanel planId="p1" />);
    fireEvent.change(await screen.findByLabelText('引き継ぐ人'), { target: { value: owner.candidates[0]!.collaborator_id } });
    fireEvent.change(screen.getByLabelText('本人確認のためのパスワード'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '移譲を申し出る' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('パスワードが正しくありません');
  });
});

describe('IncomingTransfers', () => {
  it('自分あての申し出をパスワードで受け入れ・断れる。無ければ出さない', async () => {
    g8.getIncomingTransfers.mockResolvedValueOnce(incoming).mockResolvedValue([]);
    g8.acceptOwnershipTransfer.mockResolvedValue({ ...incoming[0], status: 'accepted' });
    render(<IncomingTransfers />);
    const item = await screen.findByTestId(`incoming-transfer-${incoming[0]!.id}`);
    expect(item).toHaveTextContent('「移譲」の所有者を引き継ぐ申し出');
    const accept = within(item).getByRole('button', { name: '所有者を引き継ぐ' });
    expect(accept).toBeDisabled();
    fireEvent.change(within(item).getByLabelText('受け入れるにはパスワード'), { target: { value: 'pw' } });
    fireEvent.click(accept);
    await waitFor(() => expect(g8.acceptOwnershipTransfer).toHaveBeenCalledWith(incoming[0]!.id, 'pw'));
    expect(await screen.findByRole('status')).toHaveTextContent('「移譲」の所有者になりました。');
  });

  it('断る', async () => {
    g8.getIncomingTransfers.mockResolvedValueOnce(incoming).mockResolvedValue([]);
    g8.declineOwnershipTransfer.mockResolvedValue({ ...incoming[0], status: 'declined' });
    render(<IncomingTransfers />);
    fireEvent.click(await screen.findByRole('button', { name: '断る' }));
    await waitFor(() => expect(g8.declineOwnershipTransfer).toHaveBeenCalledWith(incoming[0]!.id));
    expect(await screen.findByRole('status')).toHaveTextContent('断りました');
  });

  it('取得に失敗しても何も出さない', async () => {
    g8.getIncomingTransfers.mockRejectedValue(new Error('x'));
    const { container } = render(<IncomingTransfers />);
    await waitFor(() => expect(g8.getIncomingTransfers).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CorrectionsCard', () => {
  it('出典を添えて表示名を訂正し、履歴から取り消せる', async () => {
    g8.getCorrections.mockResolvedValue(corrections);
    g8.createCorrection.mockResolvedValue(fx.corrections_self_created);
    render(<CorrectionsCard />);
    expect(await screen.findByText('今の値: 訂正後の名前')).toBeInTheDocument();
    expect(screen.queryByLabelText('本人確認のためのパスワード')).toBeNull();
    fireEvent.change(screen.getByLabelText('正しい値'), { target: { value: '新しい名前' } });
    fireEvent.change(screen.getByLabelText('根拠(出典)'), { target: { value: 'official_document' } });
    fireEvent.change(screen.getByLabelText('根拠の補足(任意・500文字まで)'), { target: { value: ' 旅券 ' } });
    fireEvent.click(screen.getByRole('button', { name: '訂正する' }));
    await waitFor(() => expect(g8.createCorrection).toHaveBeenCalledWith(
      { field: 'username', value: '新しい名前', source: 'official_document', source_note: '旅券' }));
    expect(await screen.findByRole('status')).toHaveTextContent('を訂正しました');
    const history = screen.getByRole('list', { name: '訂正の履歴' });
    expect(history).toHaveTextContent('表示名: user_c2049db2e2 → 訂正後の名前');
    expect(history).toHaveTextContent('出典: 本人の申告(表記)');
    g8.revertCorrection.mockResolvedValue({ ...corrections.history[0], status: 'reverted' });
    fireEvent.click(within(history).getByRole('button', { name: 'この訂正を取り消す' }));
    await waitFor(() => expect(g8.revertCorrection).toHaveBeenCalledWith(corrections.history[0]!.id, undefined));
    expect(await screen.findByRole('status')).toHaveTextContent('訂正を取り消しました。');
  });

  it('メールアドレスはパスワードが要り、取り消しにも要る', async () => {
    const emailHist = { ...corrections, history: [{ ...corrections.history[0]!, field: 'email', field_label: 'メールアドレス' }] };
    g8.getCorrections.mockResolvedValue(emailHist);
    g8.createCorrection.mockResolvedValue({ ...fx.corrections_self_created, field: 'email', field_label: 'メールアドレス' });
    render(<CorrectionsCard />);
    fireEvent.change(await screen.findByLabelText('直す項目'), { target: { value: 'email' } });
    fireEvent.change(screen.getByLabelText('正しい値'), { target: { value: 'a@example.com' } });
    const submit = screen.getByRole('button', { name: '訂正する' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('本人確認のためのパスワード'), { target: { value: 'pw' } });
    fireEvent.click(submit);
    await waitFor(() => expect(g8.createCorrection).toHaveBeenCalledWith(
      { field: 'email', value: 'a@example.com', source: 'self_statement', password: 'pw' }));
    expect(await screen.findByRole('status')).toHaveTextContent('確認済みの印は外れます');
    fireEvent.click(screen.getByRole('button', { name: 'この訂正を取り消す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('パスワードを入力してください');
    expect(g8.revertCorrection).not.toHaveBeenCalled();
    g8.revertCorrection.mockResolvedValue({ ...emailHist.history[0], status: 'reverted' });
    fireEvent.change(screen.getByLabelText('メールアドレスの訂正を取り消す時のパスワード'), { target: { value: 'pw2' } });
    fireEvent.click(screen.getByRole('button', { name: 'この訂正を取り消す' }));
    await waitFor(() => expect(g8.revertCorrection).toHaveBeenCalledWith(emailHist.history[0]!.id, 'pw2'));
  });
});

function renderRequests() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/corrections']}>
      <Routes><Route path="/planner/:planId/corrections" element={<CorrectionRequestsPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('CorrectionRequestsPage', () => {
  it('所有者は届いた申し出に対応・見送りを記録する', async () => {
    g8.getOwnership.mockResolvedValue(owner);
    g8.listCorrectionRequests.mockResolvedValue(requests);
    g8.resolveCorrectionRequest.mockResolvedValue(fx.correction_request_resolved);
    renderRequests();
    const row = await screen.findByTestId(`correction-request-${requests[0]!.id}`);
    expect(row).toHaveTextContent('名義: B');
    expect(row).toHaveTextContent('出典: 予約の確認書');
    expect(screen.queryByRole('button', { name: '所有者へ申し出る' })).toBeNull();
    fireEvent.change(within(row).getByLabelText('ひとこと(任意)'), { target: { value: '確認できず' } });
    fireEvent.click(within(row).getByRole('button', { name: '見送る' }));
    await waitFor(() => expect(g8.resolveCorrectionRequest).toHaveBeenCalledWith('p1', requests[0]!.id, 'declined', '確認できず'));
    expect(await screen.findByRole('status')).toHaveTextContent('見送ったことを記録しました。');
  });

  it('参加者は根拠を添えて申し出る', async () => {
    g8.getOwnership.mockResolvedValue({ ...owner, role: 'editor', candidates: [] });
    g8.listCorrectionRequests.mockResolvedValueOnce([]).mockResolvedValue([{ ...requests[0]!, requester_name: undefined }]);
    g8.createCorrectionRequest.mockResolvedValue(fx.correction_request_created);
    renderRequests();
    expect(await screen.findByText('申し出はありません。')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: '所有者へ申し出る' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('どの情報か(例: 予約の名義)'), { target: { value: '名義' } });
    fireEvent.change(screen.getByLabelText('正しい内容'), { target: { value: 'B' } });
    fireEvent.change(screen.getByLabelText('根拠(出典)'), { target: { value: 'booking_document' } });
    fireEvent.click(submit);
    await waitFor(() => expect(g8.createCorrectionRequest).toHaveBeenCalledWith('p1',
      { field_label: '名義', proposed_value: 'B', source: 'booking_document' }));
    expect(await screen.findByRole('status')).toHaveTextContent('所有者へ申し出ました');
    expect(await screen.findByRole('list', { name: 'あなたの申し出' })).toHaveTextContent('確認待ち');
  });
});

describe('AdminJobsPanel', () => {
  it('処理ごとの状態と、確認が要る処理を出す', async () => {
    g8.getOpsJobs.mockResolvedValue({
      ...jobs,
      attention: ['account-deletions'],
      jobs: jobs.jobs.map((j) => (j.job === 'account-deletions'
        ? { ...j, state: 'failing', consecutive_failures: 3, last_error: 'OperationalError' } : j)),
    });
    render(<AdminJobsPanel />);
    const table = await screen.findByRole('table', { name: '定期の処理の状態' });
    const ok = within(table).getByRole('rowheader', { name: 'webhook-retry' }).closest('tr')!;
    expect(ok).toHaveTextContent('5分ごと');
    expect(ok).toHaveTextContent('正常');
    const bad = within(table).getByRole('rowheader', { name: 'account-deletions' }).closest('tr')!;
    expect(bad).toHaveTextContent('1日ごと');
    expect(bad).toHaveTextContent('失敗が続いている');
    expect(bad).toHaveTextContent('3回(OperationalError)');
    expect(screen.getByRole('alert')).toHaveTextContent('確認が要る処理: account-deletions');
    expect(within(table).getByRole('rowheader', { name: 'abuse-scan' }).closest('tr')).toHaveTextContent('1時間ごと');
  });

  it('取得の失敗', async () => {
    g8.getOpsJobs.mockRejectedValue({ response: { status: 403, data: { detail: '管理者だけが使えます' } } });
    render(<AdminJobsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('管理者だけが使えます');
  });
});

describe('Surface', () => {
  it('面の種類のクラスと要素を付ける(既定は solid)', () => {
    const { rerender } = render(<Surface aria-label="面">中身</Surface>);
    const el = screen.getByLabelText('面');
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveClass('tc-surface', 'tc-surface--solid', 'p-4');
    expect(el).toHaveAttribute('data-surface', 'solid');
    rerender(<Surface aria-label="面" variant="glass" as="header" padding="none" className="x">中身</Surface>);
    const g = screen.getByLabelText('面');
    expect(g.tagName).toBe('HEADER');
    expect(g).toHaveClass('tc-surface--glass', 'x');
    expect(g).not.toHaveClass('p-4');
  });
});
