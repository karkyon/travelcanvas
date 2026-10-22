/**
 * 組織・B2B(FR-041)・外部連携の管理(FR-042)
 *
 * [Gate B1] backend/app/api/v1/organizations.py。組織・メンバー・配布(写し・版・閲覧確認・複製)・
 * API クライアント(client_credentials)・Webhook(署名つき)。外部向けの /oauth/token・/ext/* は画面からは使わない。
 */
import { PlanSearchApi } from './planSearch';
import type {
  DistributionAckList, ForkResult, Organization, OrgApiClient, OrgApiClientList, OrgApiScope, OrgDistribution,
  OrgMember, OrgRole, OrgWebhook, OrgWebhookDelivery, OrgWebhookEvent, OrgWebhookList,
} from '../types';
import { arrayOf, decodeResponse } from '../decode';

/** [Gate G2] 組織の decoder は使う時に読み込む(最初に読む JS を小さく保つ) */
const D = () => import('../decodersOrg');

export class OrganizationsApi extends PlanSearchApi {
  async getOrganizations(): Promise<Organization[]> {
    const r = await this.client.get('/organizations');
    return decodeResponse(r.data, arrayOf((await D()).organization), 'GET /organizations');
  }

  async createOrganization(data: { name: string; brand_color?: string | null }): Promise<Organization> {
    const r = await this.client.post('/organizations', data);
    return decodeResponse(r.data, (await D()).organization, 'POST /organizations');
  }

  async getOrganization(orgId: string): Promise<Organization> {
    const r = await this.client.get(`/organizations/${orgId}`);
    return decodeResponse(r.data, (await D()).organization, 'GET /organizations/{org_id}');
  }

  async updateOrganization(orgId: string, data: { name?: string; brand_color?: string | null }): Promise<Organization> {
    const r = await this.client.patch(`/organizations/${orgId}`, data);
    return decodeResponse(r.data, (await D()).organization, 'PATCH /organizations/{org_id}');
  }

  async getOrgMembers(orgId: string): Promise<OrgMember[]> {
    const r = await this.client.get(`/organizations/${orgId}/members`);
    return decodeResponse(r.data, arrayOf((await D()).orgMember), 'GET /organizations/{org_id}/members');
  }

  async addOrgMember(orgId: string, data: { email: string; role: Exclude<OrgRole, 'owner'> }): Promise<OrgMember> {
    const r = await this.client.post(`/organizations/${orgId}/members`, data);
    return decodeResponse(r.data, (await D()).orgMember, 'POST /organizations/{org_id}/members');
  }

  async changeOrgMemberRole(orgId: string, memberId: string, role: OrgRole): Promise<OrgMember> {
    const r = await this.client.patch(`/organizations/${orgId}/members/${memberId}`, { role });
    return decodeResponse(r.data, (await D()).orgMember, 'PATCH /organizations/{org_id}/members/{member_id}');
  }

  async removeOrgMember(orgId: string, memberId: string): Promise<void> {
    await this.client.delete(`/organizations/${orgId}/members/${memberId}`);
  }

  async getDistributions(orgId: string, includeRevoked = false): Promise<OrgDistribution[]> {
    const r = await this.client.get(`/organizations/${orgId}/distributions`, { params: includeRevoked ? { include_revoked: true } : {} });
    return decodeResponse(r.data, arrayOf((await D()).orgDistribution), 'GET /organizations/{org_id}/distributions');
  }

  async publishDistribution(orgId: string, data: { plan_id: string; title?: string; change_note?: string }): Promise<OrgDistribution> {
    const r = await this.client.post(`/organizations/${orgId}/distributions`, data);
    return decodeResponse(r.data, (await D()).orgDistribution, 'POST /organizations/{org_id}/distributions');
  }

  async getDistribution(orgId: string, distId: string): Promise<OrgDistribution> {
    const r = await this.client.get(`/organizations/${orgId}/distributions/${distId}`);
    return decodeResponse(r.data, (await D()).orgDistribution, 'GET /organizations/{org_id}/distributions/{dist_id}');
  }

  async reviseDistribution(orgId: string, distId: string, data: { base_version: number; change_note?: string }): Promise<OrgDistribution> {
    const r = await this.client.post(`/organizations/${orgId}/distributions/${distId}/revise`, data);
    return decodeResponse(r.data, (await D()).orgDistribution, 'POST /organizations/{org_id}/distributions/{dist_id}/revise');
  }

  async revokeDistribution(orgId: string, distId: string): Promise<OrgDistribution> {
    const r = await this.client.post(`/organizations/${orgId}/distributions/${distId}/revoke`);
    return decodeResponse(r.data, (await D()).orgDistribution, 'POST /organizations/{org_id}/distributions/{dist_id}/revoke');
  }

  async acknowledgeDistribution(orgId: string, distId: string, version: number): Promise<OrgDistribution> {
    const r = await this.client.post(`/organizations/${orgId}/distributions/${distId}/acknowledge`, { version });
    return decodeResponse(r.data, (await D()).orgDistribution, 'POST /organizations/{org_id}/distributions/{dist_id}/acknowledge');
  }

  async getDistributionAcks(orgId: string, distId: string): Promise<DistributionAckList> {
    const r = await this.client.get(`/organizations/${orgId}/distributions/${distId}/acknowledgements`);
    return decodeResponse(r.data, (await D()).distributionAckList, 'GET /organizations/{org_id}/distributions/{dist_id}/acknowledgements');
  }

  async forkDistribution(orgId: string, distId: string): Promise<ForkResult> {
    const r = await this.client.post(`/organizations/${orgId}/distributions/${distId}/fork`);
    return decodeResponse(r.data, (await D()).forkResult, 'POST /organizations/{org_id}/distributions/{dist_id}/fork');
  }

  async getOrgApiClients(orgId: string): Promise<OrgApiClientList> {
    const r = await this.client.get(`/organizations/${orgId}/api-clients`);
    return decodeResponse(r.data, (await D()).orgApiClientList, 'GET /organizations/{org_id}/api-clients');
  }

  async createOrgApiClient(orgId: string, data: { name: string; scopes: OrgApiScope[] }): Promise<OrgApiClient> {
    const r = await this.client.post(`/organizations/${orgId}/api-clients`, data);
    return decodeResponse(r.data, (await D()).orgApiClient, 'POST /organizations/{org_id}/api-clients');
  }

  async revokeOrgApiClient(orgId: string, clientUuid: string): Promise<OrgApiClient> {
    const r = await this.client.post(`/organizations/${orgId}/api-clients/${clientUuid}/revoke`);
    return decodeResponse(r.data, (await D()).orgApiClient, 'POST /organizations/{org_id}/api-clients/{client_uuid}/revoke');
  }

  /** [Gate G2] 秘密を作り直す(新しい秘密は1回だけ返る)。前の秘密は graceHours(0〜168、既定24)の間だけ通る */
  async rotateOrgApiClientSecret(orgId: string, clientUuid: string, graceHours?: number): Promise<OrgApiClient> {
    const r = await this.client.post(`/organizations/${orgId}/api-clients/${clientUuid}/rotate-secret`,
      graceHours === undefined ? {} : { grace_hours: graceHours });
    return decodeResponse(r.data, (await D()).orgApiClient, 'POST /organizations/{org_id}/api-clients/{client_uuid}/rotate-secret');
  }

  /** [Gate G2] 猶予を待たずに前の秘密を失効する(revokeTokens なら発行済みのトークンも失効) */
  async retireOrgApiClientPrevious(orgId: string, clientUuid: string, revokeTokens = false): Promise<OrgApiClient> {
    const r = await this.client.post(`/organizations/${orgId}/api-clients/${clientUuid}/retire-previous`,
      { revoke_tokens: revokeTokens });
    return decodeResponse(r.data, (await D()).orgApiClient, 'POST /organizations/{org_id}/api-clients/{client_uuid}/retire-previous');
  }

  async getOrgWebhooks(orgId: string): Promise<OrgWebhookList> {
    const r = await this.client.get(`/organizations/${orgId}/webhooks`);
    return decodeResponse(r.data, (await D()).orgWebhookList, 'GET /organizations/{org_id}/webhooks');
  }

  async createOrgWebhook(orgId: string, data: { url: string; events: OrgWebhookEvent[] }): Promise<OrgWebhook> {
    const r = await this.client.post(`/organizations/${orgId}/webhooks`, data);
    return decodeResponse(r.data, (await D()).orgWebhook, 'POST /organizations/{org_id}/webhooks');
  }

  async revokeOrgWebhook(orgId: string, hookId: string): Promise<OrgWebhook> {
    const r = await this.client.post(`/organizations/${orgId}/webhooks/${hookId}/revoke`);
    return decodeResponse(r.data, (await D()).orgWebhook, 'POST /organizations/{org_id}/webhooks/{hook_id}/revoke');
  }

  /** [Gate G2] 署名の鍵を作り直す(新しい鍵は1回だけ返る)。graceHours の間は新旧の両方で署名する */
  async rotateOrgWebhookSecret(orgId: string, hookId: string, graceHours?: number): Promise<OrgWebhook> {
    const r = await this.client.post(`/organizations/${orgId}/webhooks/${hookId}/rotate-secret`,
      graceHours === undefined ? {} : { grace_hours: graceHours });
    return decodeResponse(r.data, (await D()).orgWebhook, 'POST /organizations/{org_id}/webhooks/{hook_id}/rotate-secret');
  }

  /** [Gate G2] 猶予を待たずに前の鍵での署名をやめる */
  async retireOrgWebhookPrevious(orgId: string, hookId: string): Promise<OrgWebhook> {
    const r = await this.client.post(`/organizations/${orgId}/webhooks/${hookId}/retire-previous`);
    return decodeResponse(r.data, (await D()).orgWebhook, 'POST /organizations/{org_id}/webhooks/{hook_id}/retire-previous');
  }

  async pingOrgWebhook(orgId: string, hookId: string): Promise<OrgWebhookDelivery> {
    const r = await this.client.post(`/organizations/${orgId}/webhooks/${hookId}/ping`);
    return decodeResponse(r.data, (await D()).orgWebhookDelivery, 'POST /organizations/{org_id}/webhooks/{hook_id}/ping');
  }

  async getOrgWebhookDeliveries(orgId: string, hookId: string): Promise<OrgWebhookDelivery[]> {
    const r = await this.client.get(`/organizations/${orgId}/webhooks/${hookId}/deliveries`);
    return decodeResponse(r.data, arrayOf((await D()).orgWebhookDelivery), 'GET /organizations/{org_id}/webhooks/{hook_id}/deliveries');
  }

  async redeliverOrgWebhook(orgId: string, hookId: string, deliveryId: string): Promise<OrgWebhookDelivery> {
    const r = await this.client.post(`/organizations/${orgId}/webhooks/${hookId}/deliveries/${deliveryId}/redeliver`);
    return decodeResponse(r.data, (await D()).orgWebhookDelivery,
      'POST /organizations/{org_id}/webhooks/{hook_id}/deliveries/{delivery_id}/redeliver');
  }
}
