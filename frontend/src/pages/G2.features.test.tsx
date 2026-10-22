/**
 * [Gate G2] 画面: FR-045 参加者に見せない項目(所有者の設定・参加者への知らせ)、FR-040 サポートへの閲覧の許可(本人)・
 * 運用とサポート閲覧(管理者)。応答は実backendから採取した fixture。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import { api } from '@/services/api';
import type { AdminOperations, AdminShareLink, AdminSupportGrant, MemberPolicy, SupportGrant, SupportGrantList, SupportView } from '@/services/api';
import MemberPolicyPanel from '@/components/share/MemberPolicyPanel';
import MemberPolicyNotice from '@/components/planner/MemberPolicyNotice';
import SupportAccessSection from '@/components/settings/SupportAccessSection';
import AdminSupport from './Admin/AdminSupport';

const ownerPolicy = fx.member_policy_owner as unknown as MemberPolicy;
const viewerPolicy = fx.member_policy_viewer as unknown as MemberPolicy;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('参加者に見せない項目 (Gate G2 FR-045)', () => {
  it('所有者: 役割ごとに選んで保存する。予約を選ぶとチケット・予約番号も選ばれる', async () => {
    vi.spyOn(api, 'getMemberPolicy').mockResolvedValue({ ...ownerPolicy, roles: { editor: [], viewer: [] } });
    const put = vi.spyOn(api, 'putMemberPolicy').mockResolvedValue(ownerPolicy);
    render(<MemberPolicyPanel planId="p1" />);
    const box = await screen.findByRole('checkbox', { name: '閲覧者に「予約」を見せない' });
    await userEvent.click(box);
    expect(screen.getByRole('checkbox', { name: '閲覧者に「チケット・QR」を見せない' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '閲覧者に「チケット・QR」を見せない' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '役割ごとの設定を保存する' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('p1', {
      editor: [], viewer: ['reservations', 'reservation_secrets', 'tickets'],
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('役割ごとの設定を保存しました');
  });

  it('所有者: 1人だけの設定と、役割の設定に戻す', async () => {
    const member = ownerPolicy.members![0]!;
    vi.spyOn(api, 'getMemberPolicy').mockResolvedValue({
      ...ownerPolicy, members: [{ ...member, hidden: ['costs'], effective_hidden: ['costs'] }],
    });
    const put = vi.spyOn(api, 'putMemberOverride').mockResolvedValue(ownerPolicy);
    render(<MemberPolicyPanel planId="p1" />);
    expect(await screen.findByText(/この人だけの設定・見せない項目: 費用・予算・精算/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${member.email} を役割の設定に戻す` }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('p1', member.id, null));
  });

  it('参加者には設定を出さず、旅程の画面で隠された項目を知らせる', async () => {
    vi.spyOn(api, 'getMemberPolicy').mockResolvedValue(viewerPolicy);
    const { container } = render(<MemberPolicyPanel planId="p1" />);
    render(<MemberPolicyNotice planId="p1" />);
    expect(await screen.findByTestId('member-policy-notice')).toHaveTextContent('予定のメモ・予約・予約番号・PIN の表示・チケット・QR');
    expect(container).toBeEmptyDOMElement();
  });
});

describe('サポートへの閲覧の許可 (Gate G2 FR-040 本人)', () => {
  it('目的・範囲・期間・パスワードで許可し、取り消す', async () => {
    const list = fx.support_grants as unknown as SupportGrantList;
    vi.spyOn(api, 'getSupportGrants').mockResolvedValue(list);
    vi.spyOn(api, 'getPlans').mockResolvedValue({ success: true, data: [{ id: 'p1', title: '修学旅行B1', days: [] }] } as never);
    const create = vi.spyOn(api, 'createSupportGrant').mockResolvedValue(fx.support_grant_created as unknown as SupportGrant);
    const revoke = vi.spyOn(api, 'revokeSupportGrant').mockResolvedValue(fx.support_grant_revoked as unknown as SupportGrant);
    render(<SupportAccessSection />);
    await userEvent.type(await screen.findByLabelText('目的(担当者に伝わります)'), '表示の不具合の調査');
    await userEvent.selectOptions(screen.getByLabelText('見せる範囲'), 'p1');
    await userEvent.clear(screen.getByLabelText(/期間/));
    await userEvent.type(screen.getByLabelText(/期間/), '2');
    await userEvent.type(screen.getByLabelText('本人確認のためのパスワード'), 'pw-123456');
    await userEvent.click(screen.getByRole('button', { name: '許可する' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      purpose: '表示の不具合の調査', hours: 2, plan_id: 'p1', ticket_ref: null, password: 'pw-123456',
    }));
    const active = list.grants.find((g) => g.state === 'active')!;
    await userEvent.click(screen.getByRole('button', { name: `「${active.purpose}」の許可を取り消す` }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(active.id));
  });

  it('許可できない理由を出す(パスワードの誤り)', async () => {
    vi.spyOn(api, 'getSupportGrants').mockResolvedValue(fx.support_grants as unknown as SupportGrantList);
    vi.spyOn(api, 'getPlans').mockResolvedValue({ success: true, data: [] } as never);
    vi.spyOn(api, 'createSupportGrant').mockRejectedValue({
      response: { status: 403, data: { detail: { code: 'reauth_failed', message: 'パスワードが正しくありません' } } },
    });
    render(<SupportAccessSection />);
    await userEvent.type(await screen.findByLabelText('目的(担当者に伝わります)'), '調査');
    await userEvent.type(screen.getByLabelText('本人確認のためのパスワード'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: '許可する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('パスワードが正しくありません');
  });
});

describe('運用とサポート (Gate G2 FR-040 管理者)', () => {
  it('運用の要約・共有リンクの停止・許可の閲覧(読み取り専用)', async () => {
    vi.spyOn(api, 'getAdminOperations').mockResolvedValue(fx.admin_operations as unknown as AdminOperations);
    const links = (fx.admin_share_links as unknown as { share_links: AdminShareLink[] }).share_links;
    vi.spyOn(api, 'getAdminShareLinks').mockResolvedValue(links);
    const grants = (fx.admin_support_grants as unknown as { grants: AdminSupportGrant[] }).grants;
    vi.spyOn(api, 'getAdminSupportGrants').mockResolvedValue(grants);
    const revoke = vi.spyOn(api, 'revokeAdminShareLink').mockResolvedValue({ id: links[0]!.id, revoked_at: 'x' });
    const view = vi.spyOn(api, 'viewAdminSupportGrant').mockResolvedValue(fx.admin_support_view_plan as unknown as SupportView);
    render(<MemoryRouter><AdminSupport /></MemoryRouter>);
    expect(await screen.findByText('有効な共有リンク', { selector: 'p' })).toBeInTheDocument();
    const stop = screen.getByRole('button', { name: `共有リンク ${links[0]!.token_prefix} を止める` });
    expect(stop).toBeDisabled();
    await userEvent.type(screen.getByLabelText('止める理由(所有者に伝わります)'), '不正な大量アクセス');
    await userEvent.click(stop);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(links[0]!.id, '不正な大量アクセス'));
    const g = grants.find((x) => x.scope === 'plan')!;
    await userEvent.click(screen.getByRole('button', { name: `${g.user_label} の許可(旅行「${g.plan_title}」)で閲覧する` }));
    await waitFor(() => expect(view).toHaveBeenCalledWith(g.id));
    const panel = await screen.findByLabelText('旅行の内容(読み取り専用)');
    expect(within(panel).getByText(/清水寺B1/)).toBeInTheDocument();
    expect(within(panel).getByText(/予約番号 伏せています/)).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('京都市東山区B1');
    expect(panel).not.toHaveTextContent('集合メモB1');
  });
});
