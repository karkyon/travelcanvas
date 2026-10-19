/**
 * [Gate A2] FR-040 管理・監査の型(backend/app/api/v1/admin.py の応答)。
 */
export interface AdminSystemStats {
  users: {
    total_users: number;
    active_users: number;
    verified_users: number;
    new_users_30d: number;
    user_types: { guest: number; registered: number; premium: number; admin: number };
  };
  travel_plans: {
    total_plans: number;
    active_plans: number;
    completed_plans: number;
    draft_plans: number;
    average_duration_days: number;
    popular_destinations: { destination: string; count: number }[];
  };
  timestamp: string;
}

export interface AdminPagination {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface AdminUserRow {
  id: string;
  username: string | null;
  email: string | null;
  user_type: string;
  is_active: boolean;
  is_verified: boolean;
  /** [Gate A2] 管理者(画面からは操作できない) */
  is_admin: boolean;
  is_self: boolean;
  created_at: string | null;
  travel_plans_count: number;
}

export interface AdminUsersPage {
  users: AdminUserRow[];
  pagination: AdminPagination;
}

export interface AdminUserDetail extends Omit<AdminUserRow, 'travel_plans_count'> {
  mfa_enabled: boolean;
  statistics: { account_age_days: number; total_plans: number; completed_plans: number; optimization_usage: number };
}

export type AdminUserAction = 'suspend' | 'unsuspend' | 'verify' | 'unverify';

export interface AdminManageResult {
  success: boolean;
  updated_count: number;
  sessions_revoked: number;
}

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  /** 末尾を伏せた接続元(例: 203.0.113.x) */
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, unknown> | null;
  created_at: string | null;
}

export interface AuditLogPage {
  actions: string[];
  audit_logs: AuditLogEntry[];
  pagination: AdminPagination;
}

export interface AuditLogQuery {
  page?: number;
  page_size?: number;
  action?: string;
  resource_type?: string;
  user_id?: string;
  resource_id?: string;
  since?: string;
  until?: string;
}

export interface AdminUsersQuery {
  page?: number;
  page_size?: number;
  search?: string;
  user_type?: string;
  status?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}
