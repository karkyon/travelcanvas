/**
 * 管理・監査(FR-040)
 *
 * [Gate A2] backend/app/api/v1/admin.py。/admin 配下(管理者・多要素認証の確認済みのセッションだけ)。
 * 画面が理由を表示するため、共通エラー処理(トースト)を通さない。
 * [Gate G2] FR-040 サポート閲覧(本人の許可があるものだけ・読み取り専用・見るたびに監査と本人への知らせ)と
 * 運用の要約(共有リンク・Webhook・容量・削除待ち)・不正が疑われる共有リンクの停止(backend admin_support.py)。
 */
import type { AxiosRequestConfig } from 'axios';
import { CollabApi } from './collab';
import type {
  AdminManageResult, AdminOperations, AdminShareLink, AdminSupportGrant, AdminSystemStats, AdminUserAction,
  AdminUserDetail, AdminUsersPage, AdminUsersQuery, AuditLogPage, AuditLogQuery, SupportView,
} from '../types';
import { decodeResponse } from '../decode';
import { adminManageResult, adminSystemStats, adminUserDetail, adminUsersPage, auditLogPage } from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

function params<T extends object>(q: T): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v as string | number;
  }
  return out;
}

export class AdminApi extends CollabApi {
  async getAdminStats(): Promise<AdminSystemStats> {
    const response = await this.client.get('/admin/stats/system', SILENT);
    return decodeResponse(response.data, adminSystemStats, 'GET /admin/stats/system');
  }

  async getAdminUsers(query: AdminUsersQuery = {}): Promise<AdminUsersPage> {
    const config: AxiosRequestConfig<unknown> = { ...SILENT, params: params(query) };
    const response = await this.client.get('/admin/users', config);
    return decodeResponse(response.data, adminUsersPage, 'GET /admin/users');
  }

  async getAdminUser(userId: string): Promise<AdminUserDetail> {
    const response = await this.client.get(`/admin/users/${userId}`, SILENT);
    return decodeResponse(response.data, adminUserDetail, 'GET /admin/users/{user_id}');
  }

  async manageAdminUsers(action: AdminUserAction, userIds: string[]): Promise<AdminManageResult> {
    const response = await this.client.post('/admin/users/manage', { action, user_ids: userIds }, SILENT);
    return decodeResponse(response.data, adminManageResult, 'POST /admin/users/manage');
  }

  async getAuditLogs(query: AuditLogQuery = {}): Promise<AuditLogPage> {
    const config: AxiosRequestConfig<unknown> = { ...SILENT, params: params(query) };
    const response = await this.client.get('/admin/audit-logs', config);
    return decodeResponse(response.data, auditLogPage, 'GET /admin/audit-logs');
  }

  async getAdminSupportGrants(includeInactive = false): Promise<AdminSupportGrant[]> {
    return (await this.g2(this.client.get('/admin/support-grants', {
      ...SILENT, params: includeInactive ? { include_inactive: true } : {},
    }), 'adminSupportGrants')).grants;
  }

  viewAdminSupportGrant(grantId: string): Promise<SupportView> {
    return this.g2(this.client.get(`/admin/support-grants/${grantId}/view`, SILENT), 'supportView');
  }

  getAdminOperations(): Promise<AdminOperations> {
    return this.g2(this.client.get('/admin/operations', SILENT), 'adminOperations');
  }

  async getAdminShareLinks(): Promise<AdminShareLink[]> {
    return (await this.g2(this.client.get('/admin/operations/share-links', SILENT), 'adminShareLinks')).share_links;
  }

  async revokeAdminShareLink(linkId: string, reason: string): Promise<{ id: string; revoked_at: string }> {
    const response = await this.client.post(`/admin/operations/share-links/${linkId}/revoke`, { reason }, SILENT);
    return response.data as { id: string; revoked_at: string };
  }
}
