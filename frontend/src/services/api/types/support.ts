/**
 * [Gate G2] FR-040 サポート閲覧(本人の許可・目的・時間制限・読み取り専用・監査)と運用の要約、
 * FR-045 同行者(参加者)向けの項目の規則、FR-020 即時の通知(Server-Sent Events)の型。
 * backend: app/api/v1/privacy.py(support-grants)・admin_support.py・member_policy.py・presence.py(events/stream)。
 */

export type SupportGrantState = 'active' | 'expired' | 'revoked';

export interface SupportGrant {
  id: string;
  plan_id: string | null;
  plan_title: string | null;
  /** plan: 1つの旅行の中身(機密・個人の値は伏せる)/ account: アカウントの概要と旅行の一覧 */
  scope: 'plan' | 'account';
  purpose: string;
  ticket_ref: string | null;
  created_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  state: SupportGrantState;
  access_count: number;
  last_accessed_at: string | null;
}

export interface SupportGrantList {
  grants: SupportGrant[];
  limits: { min_hours: number; max_hours: number; default_hours: number; max_active: number; purpose_max: number };
  requires_password: boolean;
}

export interface SupportGrantInput {
  purpose: string;
  hours: number;
  plan_id?: string | null;
  ticket_ref?: string | null;
  password?: string;
}

export interface AdminSupportGrant extends Omit<SupportGrant, 'plan_id'> {
  user_label: string;
  user_id: string;
  /** 管理者自身が作った許可(見られない) */
  own?: boolean;
}

export interface SupportViewEvent {
  id: string;
  title: string;
  event_type: string;
  local_start_time: string | null;
  is_all_day: boolean;
  locked: boolean;
  has_address: boolean;
  has_notes: boolean;
  has_location: boolean;
}

export interface SupportViewPlan {
  id: string;
  title: string;
  destination: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  revision: number;
  deleted: boolean;
  days: { id: string; local_date: string | null; title: string | null; timezone_id: string; events: SupportViewEvent[] }[];
  reservations: {
    id: string; type: string; status: string; provider_name: string | null; start_at: string | null; end_at: string | null;
    confirmation_number: string | null;
  }[];
  documents_by_classification: Record<string, number>;
  collaborators: number;
}

export interface SupportViewAccount {
  username: string | null;
  user_type: string;
  is_active: boolean;
  created_at: string | null;
  plans: { id: string; title: string; status: string | null; start_date: string | null; end_date: string | null;
    deleted: boolean; days: number; events: number }[];
}

export interface SupportView {
  grant: AdminSupportGrant;
  read_only: true;
  plan?: SupportViewPlan;
  account?: SupportViewAccount;
}

export interface AdminOperations {
  share_links: { active: number; active_edit: number; without_expiry: number };
  webhooks: { pending: number; failed: number; dead: number; delivered: number };
  storage: { database_bytes: number | null; documents: number; document_bytes: number };
  purge: { plans_pending: number; plans_due: number; documents_pending: number };
  support_grants: { active: number };
  timestamp: string;
}

export interface AdminShareLink {
  id: string;
  plan_id: string;
  token_prefix: string;
  permission: string;
  has_passcode: boolean;
  use_count: number;
  max_uses: number | null;
  expires_at: string | null;
  created_at: string | null;
}

// ===== FR-045 同行者向けの項目の規則 =====

export type MemberFieldKey =
  | 'event_notes' | 'event_address' | 'reservations' | 'reservation_secrets' | 'tickets' | 'documents' | 'costs';

export interface MemberFieldCategory {
  key: MemberFieldKey;
  label: string;
  description: string;
  implies: MemberFieldKey[];
}

export interface MemberPolicyCatalog {
  version: number;
  categories: MemberFieldCategory[];
  presets: Record<string, MemberFieldKey[]>;
}

export interface MemberPolicyMember {
  id: string;
  email: string;
  role: string;
  status: string;
  /** この人だけの上書き(null は役割の既定に従う) */
  hidden: MemberFieldKey[] | null;
  effective_hidden: MemberFieldKey[];
}

export interface MemberPolicy {
  plan_id: string;
  role: 'owner' | 'editor' | 'viewer';
  catalog: MemberPolicyCatalog;
  /** 自分に隠されている項目(所有者は空) */
  my_hidden: MemberFieldKey[];
  /** 所有者だけ */
  roles?: { editor: MemberFieldKey[]; viewer: MemberFieldKey[] };
  configured?: boolean;
  members?: MemberPolicyMember[];
}

// ===== FR-020 即時の通知 =====

export type PlanStreamEventType = 'ready' | 'revision' | 'presence' | 'reconnect' | 'access_lost';

export interface PlanStreamEvent {
  type: PlanStreamEventType;
  id: string | null;
  data: Record<string, unknown>;
}

/** 接続の終わり方。closed: サーバーが閉じた(つなぎ直す)/ refused: 断られた(ポーリングだけで続ける) */
export type PlanStreamEnd = 'closed' | 'refused' | 'unauthorized' | 'unsupported' | 'aborted' | 'failed';
