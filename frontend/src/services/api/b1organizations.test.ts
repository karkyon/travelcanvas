/**
 * [Gate B1] FR-041/042 組織の API クライアント(endpoints/organizations.ts)。応答は実backendから採取した fixture。
 */
import { describe, it, expect } from 'vitest';
import fx from './__fixtures__/backendContractResponses.json';
import { api } from './index';
import { ApiDecodeError } from './decode';

type Call = { method: string; url: string; data?: unknown; config?: unknown };

function fake(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const respond = (method: string) => async (url: string, a?: unknown, b?: unknown) => {
    const data = method === 'get' || method === 'delete' ? undefined : a;
    const config = method === 'get' || method === 'delete' ? a : b;
    calls.push({ method, url, data, config });
    const key = `${method} ${url}`;
    if (!(key in responses)) throw new Error(`想定外の呼び出し: ${key}`);
    return { data: responses[key] };
  };
  api.setHttpClientForTesting({ get: respond('get'), post: respond('post'), patch: respond('patch'), delete: respond('delete') });
  return calls;
}

describe('組織 (Gate B1)', () => {
  it('組織・メンバーの URL と本文', async () => {
    const calls = fake({
      'get /organizations': fx.org_list,
      'post /organizations': fx.org_created,
      'post /organizations/o1/members': fx.org_member_added,
      'patch /organizations/o1/members/m1': fx.org_member_added,
      'delete /organizations/o1/members/m1': { success: true },
    });
    expect((await api.getOrganizations())[0]!.role).toBe('owner');
    await api.createOrganization({ name: '東山中学校', brand_color: '#1d4ed8' });
    await api.addOrgMember('o1', { email: 'a@example.com', role: 'member' });
    await api.changeOrgMemberRole('o1', 'm1', 'admin');
    await api.removeOrgMember('o1', 'm1');
    expect(calls.map((c) => [c.method, c.url, c.data])).toEqual([
      ['get', '/organizations', undefined],
      ['post', '/organizations', { name: '東山中学校', brand_color: '#1d4ed8' }],
      ['post', '/organizations/o1/members', { email: 'a@example.com', role: 'member' }],
      ['patch', '/organizations/o1/members/m1', { role: 'admin' }],
      ['delete', '/organizations/o1/members/m1', undefined],
    ]);
  });

  it('配布: 写し・版・確認・複製・改訂', async () => {
    const calls = fake({
      'get /organizations/o1/distributions': fx.distribution_list_member,
      'get /organizations/o1/distributions/d1': fx.distribution_detail,
      'post /organizations/o1/distributions/d1/acknowledge': fx.distribution_ack,
      'post /organizations/o1/distributions/d1/fork': fx.distribution_forked,
      'post /organizations/o1/distributions/d1/revise': fx.distribution_revised,
    });
    const list = await api.getDistributions('o1');
    expect(list[0]!.ack_status).toBeNull(); // メンバーには件数を見せない
    const d = await api.getDistribution('o1', 'd1');
    expect(d.snapshot!.days[0]!.events.map((e) => e.title)).toEqual(['清水寺', '金閣寺']);
    expect(JSON.stringify(d.snapshot)).not.toMatch(/address|latitude|confirmation/);
    await api.acknowledgeDistribution('o1', 'd1', 2);
    expect((await api.forkDistribution('o1', 'd1')).plan_id).toMatch(/^0{8}-/);
    const r = await api.reviseDistribution('o1', 'd1', { base_version: 1, change_note: '午後を追加' });
    expect(r.changes).toEqual({ events_added: 1, events_removed: 0, events_changed: 0, days_before: 1, days_after: 1 });
    expect(calls[2]!.data).toEqual({ version: 2 });
    expect(calls[4]!.data).toEqual({ base_version: 1, change_note: '午後を追加' });
  });

  it('外部連携: 秘密は作った時だけ、一覧には無い。知らないスコープは受理しない', async () => {
    fake({
      'post /organizations/o1/api-clients': fx.api_client_created,
      'get /organizations/o1/api-clients': fx.api_clients,
      'post /organizations/o1/webhooks': fx.webhook_created,
      'get /organizations/o1/webhooks': fx.webhooks,
    });
    expect((await api.createOrgApiClient('o1', { name: 'x', scopes: ['distributions:read'] })).client_secret).toBe('tcs_FIXTURE_PLACEHOLDER');
    const list = await api.getOrgApiClients('o1');
    expect(list.clients.every((c) => c.client_secret === null)).toBe(true);
    expect(Object.keys(list.scopes)).toEqual(['distributions:read', 'acknowledgements:read']);
    expect((await api.createOrgWebhook('o1', { url: 'https://hooks.example.com/x', events: ['distribution.published'] })).secret)
      .toBe('whsec_FIXTURE_PLACEHOLDER');
    expect((await api.getOrgWebhooks('o1')).webhooks[0]!.secret).toBeNull();

    fake({ 'get /organizations/o1/api-clients': { ...fx.api_clients, clients: [{ ...fx.api_clients.clients[0], scopes: ['plans:write'] }] } });
    await expect(api.getOrgApiClients('o1')).rejects.toBeInstanceOf(ApiDecodeError);
  });

  it('Webhook の送信の記録と送り直し', async () => {
    const calls = fake({
      'post /organizations/o1/webhooks/w1/ping': fx.webhook_ping,
      'get /organizations/o1/webhooks/w1/deliveries': fx.webhook_deliveries,
      'post /organizations/o1/webhooks/w1/deliveries/x1/redeliver': fx.webhook_redelivered,
    });
    expect((await api.pingOrgWebhook('o1', 'w1')).status).toBe('delivered');
    expect((await api.getOrgWebhookDeliveries('o1', 'w1')).map((d) => d.status)).toEqual(['delivered', 'failed']);
    expect((await api.redeliverOrgWebhook('o1', 'w1', 'x1')).attempts).toBe(2);
    expect(calls).toHaveLength(3);
  });
});
