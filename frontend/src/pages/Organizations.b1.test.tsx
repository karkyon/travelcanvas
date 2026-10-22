/**
 * [Gate B1] FR-041/042 組織の画面(一覧・組織・配布)。応答は実backendから採取した fixture。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fx from './../services/api/__fixtures__/backendContractResponses.json';

const m = vi.hoisted(() => ({
  getOrganizations: vi.fn(), createOrganization: vi.fn(), getOrganization: vi.fn(), getDistributions: vi.fn(),
  getOrgMembers: vi.fn(), getOrgApiClients: vi.fn(), getOrgWebhooks: vi.fn(), getPlans: vi.fn(),
  publishDistribution: vi.fn(), addOrgMember: vi.fn(), changeOrgMemberRole: vi.fn(), removeOrgMember: vi.fn(),
  createOrgApiClient: vi.fn(), revokeOrgApiClient: vi.fn(), createOrgWebhook: vi.fn(), revokeOrgWebhook: vi.fn(),
  pingOrgWebhook: vi.fn(), getOrgWebhookDeliveries: vi.fn(), redeliverOrgWebhook: vi.fn(),
  getDistribution: vi.fn(), getDistributionAcks: vi.fn(), acknowledgeDistribution: vi.fn(), forkDistribution: vi.fn(),
  reviseDistribution: vi.fn(), revokeDistribution: vi.fn(),
  rotateOrgApiClientSecret: vi.fn(), retireOrgApiClientPrevious: vi.fn(), rotateOrgWebhookSecret: vi.fn(),
  retireOrgWebhookPrevious: vi.fn(),
}));
vi.mock('@/services/api', () => ({ default: m, api: m }));

import OrganizationsPage from './OrganizationsPage';
import OrganizationPage from './OrganizationPage';
import DistributionPage from './DistributionPage';

const ORG = fx.org_created.id;
const DIST = fx.distribution_detail.id;
const admin = { ...fx.org_created, role: 'owner' as const };
const member = fx.org_detail_member;

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/organizations/:orgId" element={<OrganizationPage />} />
        <Route path="/organizations/:orgId/distributions/:distId" element={<DistributionPage />} />
        <Route path="/planner/:planId" element={<p>プランナー</p>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getOrganizations.mockResolvedValue(fx.org_list);
  m.getDistributions.mockResolvedValue(fx.distribution_list_admin);
  m.getOrgMembers.mockResolvedValue(fx.org_members);
  m.getOrgApiClients.mockResolvedValue({ ...fx.api_clients, clients: [] });
  m.getOrgWebhooks.mockResolvedValue({ ...fx.webhooks, webhooks: [] });
  m.getPlans.mockResolvedValue({ data: [{ id: 'p1', title: '修学旅行' }] });
});

describe('組織の一覧 (Gate B1)', () => {
  it('参加している組織を出し、組織を作る', async () => {
    m.createOrganization.mockResolvedValue(fx.org_created);
    at('/organizations');
    expect(await screen.findByText('東山中学校')).toBeInTheDocument();
    expect(screen.getByText('オーナー・メンバー 2人')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('組織の名前'), '西山高校');
    await userEvent.click(screen.getByRole('button', { name: '組織を作る' }));
    await waitFor(() => expect(m.createOrganization).toHaveBeenCalledWith({ name: '西山高校', brand_color: '#1d4ed8' }));
  });
});

describe('組織の画面 (Gate B1)', () => {
  it('メンバーには管理の項目を出さず、自分の確認の状態を出す', async () => {
    m.getOrganization.mockResolvedValue(member);
    m.getDistributions.mockResolvedValue(fx.distribution_list_member);
    at(`/organizations/${ORG}`);
    expect(await screen.findByRole('heading', { name: '東山中学校', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('未確認')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'メンバー' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '外部連携' })).toBeNull();
    expect(m.getOrgMembers).not.toHaveBeenCalled();
  });

  it('管理者: 配布・メンバー・API クライアント(秘密は作った時だけ)・Webhook', async () => {
    m.getOrganization.mockResolvedValue(admin);
    m.publishDistribution.mockResolvedValue(fx.distribution_published);
    m.addOrgMember.mockResolvedValue(fx.org_member_added);
    m.createOrgApiClient.mockResolvedValue(fx.api_client_created);
    m.createOrgWebhook.mockResolvedValue(fx.webhook_created);
    at(`/organizations/${ORG}`);
    expect(await screen.findByText(/確認 0\/2人/)).toBeInTheDocument();
    expect(screen.getByText(/予約・予約番号・住所・メモ・位置は配布しません/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('配布する旅行(自分の旅行)'), 'p1');
    await userEvent.click(screen.getByRole('button', { name: '配布する' }));
    await waitFor(() => expect(m.publishDistribution).toHaveBeenCalledWith(ORG, { plan_id: 'p1', title: undefined, change_note: undefined }));

    await userEvent.type(screen.getByLabelText('会員のメールアドレス'), 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'メンバーを足す' }));
    await waitFor(() => expect(m.addOrgMember).toHaveBeenCalledWith(ORG, { email: 'new@example.com', role: 'member' }));

    await userEvent.type(screen.getByLabelText('連携の名前'), '旅行会社');
    await userEvent.click(screen.getByRole('button', { name: 'API クライアントを作る' }));
    expect(await screen.findByDisplayValue('tcs_FIXTURE_PLACEHOLDER')).toBeInTheDocument();
    expect(screen.getByText('秘密は今だけ表示されます。安全な場所に控えてください。')).toBeInTheDocument();
    expect(m.createOrgApiClient).toHaveBeenCalledWith(ORG, { name: '旅行会社', scopes: ['distributions:read'] });

    await userEvent.type(screen.getByLabelText('送り先の URL(https)'), 'https://hooks.example.com/x');
    await userEvent.click(screen.getByRole('button', { name: 'Webhook を登録する' }));
    expect(await screen.findByDisplayValue('whsec_FIXTURE_PLACEHOLDER')).toBeInTheDocument();
    expect(m.createOrgWebhook).toHaveBeenCalledWith(ORG, {
      url: 'https://hooks.example.com/x', events: ['distribution.published', 'distribution.revised'],
    });
  });

  it('最後のオーナーを変えようとした理由を表示する', async () => {
    m.getOrganization.mockResolvedValue(admin);
    m.changeOrgMemberRole.mockRejectedValue({ response: { status: 409, data: fx.org_error_last_owner } });
    at(`/organizations/${ORG}`);
    const select = await screen.findByLabelText('sensei の役割');
    await userEvent.selectOptions(select, 'member');
    expect(await screen.findByRole('alert')).toHaveTextContent('組織には owner が1人以上必要です');
  });

  it('Webhook の送信の記録と送り直し', async () => {
    m.getOrganization.mockResolvedValue(admin);
    m.getOrgWebhooks.mockResolvedValue({ ...fx.webhooks, webhooks: [{ ...fx.webhook_created, secret: null }] });
    m.getOrgWebhookDeliveries.mockResolvedValue(fx.webhook_deliveries);
    m.redeliverOrgWebhook.mockResolvedValue(fx.webhook_redelivered);
    at(`/organizations/${ORG}`);
    await userEvent.click(await screen.findByRole('button', { name: /送信の記録/ }));
    const log = await screen.findByRole('list', { name: /送信の記録/ });
    expect(within(log).getByText(/失敗\(500\)/)).toBeInTheDocument();
    await userEvent.click(within(log).getByRole('button', { name: '送り直す' }));
    await waitFor(() => expect(m.redeliverOrgWebhook).toHaveBeenCalledWith(ORG, fx.webhook_created.id, fx.webhook_deliveries[1]!.id));
  });
});

describe('外部連携の秘密・鍵の切り替え (Gate G2 FR-042)', () => {
  it('秘密を猶予つきで切り替え(新しい秘密は1回だけ表示)、前の秘密をすぐ失効する。dead の送信は送り直せる', async () => {
    m.getOrganization.mockResolvedValue(admin);
    const rotated = fx.api_client_rotated;
    m.getOrgApiClients.mockResolvedValue({ ...fx.g2_api_clients });
    m.rotateOrgApiClientSecret.mockResolvedValue(rotated);
    m.retireOrgApiClientPrevious.mockResolvedValue(fx.api_client_retired);
    m.getOrgWebhooks.mockResolvedValue({ ...fx.g2_webhooks });
    m.rotateOrgWebhookSecret.mockResolvedValue(fx.webhook_rotated);
    m.getOrgWebhookDeliveries.mockResolvedValue(fx.g2_webhook_deliveries);
    m.redeliverOrgWebhook.mockResolvedValue(fx.g2_webhook_redelivered);
    at(`/organizations/${ORG}`);
    const name = fx.g2_api_clients.clients[0]!.name;
    expect(await screen.findByText(/前の秘密は .* まで使えます/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/切り替えの猶予/));
    await userEvent.type(screen.getByLabelText(/切り替えの猶予/), '48');
    await userEvent.click(screen.getByRole('button', { name: `API クライアント「${name}」の秘密を切り替える` }));
    await waitFor(() => expect(m.rotateOrgApiClientSecret).toHaveBeenCalledWith(ORG, fx.g2_api_clients.clients[0]!.id, 48));
    expect(await screen.findByLabelText('client_secret')).toHaveValue('tcs_FIXTURE_PLACEHOLDER');
    await userEvent.click(screen.getByRole('button', { name: `API クライアント「${name}」の前の秘密をすぐ失効する` }));
    await waitFor(() => expect(m.retireOrgApiClientPrevious).toHaveBeenCalledWith(ORG, fx.g2_api_clients.clients[0]!.id, true));
    const hook = fx.g2_webhooks.webhooks[0]!;
    await userEvent.click(screen.getByRole('button', { name: `Webhook「${hook.url}」の署名の鍵を切り替える` }));
    await waitFor(() => expect(m.rotateOrgWebhookSecret).toHaveBeenCalledWith(ORG, hook.id, 48));
    await userEvent.click(screen.getByRole('button', { name: `Webhook「${hook.url}」の送信の記録` }));
    const log = await screen.findByRole('list', { name: /送信の記録/ });
    expect(within(log).getByText(/送り直しの上限に達しました/)).toBeInTheDocument();
    await userEvent.click(within(log).getByRole('button', { name: '送り直す' }));
    await waitFor(() => expect(m.redeliverOrgWebhook).toHaveBeenCalled());
  });
});

describe('配布の画面 (Gate B1)', () => {
  it('メンバー: 写しを見て、最新版を確認し、自分の旅行として複製する', async () => {
    m.getOrganization.mockResolvedValue(member);
    m.getDistribution.mockResolvedValue(fx.distribution_detail);
    m.acknowledgeDistribution.mockResolvedValue({ ...fx.distribution_detail, acknowledged: true, my_ack_version: 2 });
    m.forkDistribution.mockResolvedValue(fx.distribution_forked);
    at(`/organizations/${ORG}/distributions/${DIST}`);
    expect(await screen.findByRole('heading', { name: '配布: 修学旅行', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('あなたの確認: 版1を確認済み・改訂があります')).toBeInTheDocument();
    expect(screen.getByText('金閣寺')).toBeInTheDocument();
    expect(screen.getByText('説明: 午後を追加')).toBeInTheDocument();
    expect(m.getDistributionAcks).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '版2を確認しました' }));
    await waitFor(() => expect(m.acknowledgeDistribution).toHaveBeenCalledWith(ORG, DIST, 2));
    await userEvent.click(screen.getByRole('button', { name: '自分の旅行として複製' }));
    expect(await screen.findByText('プランナー')).toBeInTheDocument();
  });

  it('管理者: 確認の状況と改訂(変わった件数)', async () => {
    m.getOrganization.mockResolvedValue(admin);
    m.getDistribution.mockResolvedValue({ ...fx.distribution_revised });
    m.getDistributionAcks.mockResolvedValue(fx.distribution_acks);
    m.reviseDistribution.mockResolvedValue({ ...fx.distribution_revised, version: 3 });
    at(`/organizations/${ORG}/distributions/${DIST}`);
    expect(await screen.findByText('最新版(版2)を確認 0人・未確認 2人')).toBeInTheDocument();
    expect(screen.getByText(/hogosha.*版1まで確認/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('改訂の説明'), '集合時刻を変更');
    await userEvent.click(screen.getByRole('button', { name: '改訂する' }));
    await waitFor(() => expect(m.reviseDistribution).toHaveBeenCalledWith(ORG, DIST, { base_version: 2, change_note: '集合時刻を変更' }));
    expect(await screen.findByRole('status')).toHaveTextContent('版3にしました(予定の追加 1・削除 0・変更 0)');
  });
});
