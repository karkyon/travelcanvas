/**
 * 組織・B2B(FR-041)・外部連携の管理(FR-042)APIの型
 *
 * [Gate B1] backend/app/api/v1/organizations.py に対応する。
 */
export type OrgRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  brand_color: string | null;
  role: OrgRole;
  member_count: number;
  created_at: string | null;
}

export interface OrgMember {
  id: string;
  user_id: string;
  username: string | null;
  email: string | null;
  role: OrgRole;
  created_at: string | null;
}

/** 配布版の写し(標準の共有項目だけ。予約・番号・住所・メモ・位置は含まない) */
export interface DistributionSnapshot {
  title: string;
  description: string | null;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  days: Array<{
    date: string;
    timezone_id: string;
    title: string | null;
    events: Array<{ title: string; event_type: string; local_start_time: string | null; is_all_day: boolean }>;
  }>;
}

export interface AckStatus {
  members: number;
  acknowledged_latest: number;
  pending: number;
}

export interface OrgDistribution {
  id: string;
  organization_id: string;
  title: string;
  version: number;
  change_note: string | null;
  published_at: string | null;
  revoked_at: string | null;
  my_ack_version: number | null;
  acknowledged: boolean;
  /** 管理者(admin 以上)だけ。メンバーには null */
  ack_status: AckStatus | null;
  snapshot?: DistributionSnapshot;
  /** 改訂の応答だけ: 変わった件数 */
  changes?: { events_added: number; events_removed: number; events_changed: number; days_before: number; days_after: number };
}

export interface DistributionAckList {
  version: number;
  members: Array<{ member_id: string; username: string | null; role: OrgRole; acked_version: number | null; acked_at: string | null }>;
  acknowledged_latest: number;
  pending: number;
}

export interface ForkResult {
  plan_id: string;
  title: string;
  version: number;
}

/** [Gate G2] distributions:write(題名・お知らせの変更・改訂・停止)を追加 */
export type OrgApiScope = 'distributions:read' | 'distributions:write' | 'acknowledgements:read';

export interface OrgApiClient {
  id: string;
  name: string;
  client_id: string;
  /** 作った時の応答だけ(以後は null) */
  client_secret: string | null;
  scopes: OrgApiScope[];
  created_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  /** [Gate G2] 秘密の版(切り替えるたびに1つ上がる) */
  secret_version: number;
  secret_rotated_at: string | null;
  /** [Gate G2] 前の秘密でもトークンを取れる期限(無ければ null) */
  previous_secret_valid_until: string | null;
  /** retire-previous の応答だけ: 失効させたトークンの数 */
  tokens_revoked?: number;
}

export interface OrgApiClientList {
  clients: OrgApiClient[];
  scopes: Record<string, string>;
}

export type OrgWebhookEvent = 'distribution.published' | 'distribution.revised' | 'distribution.revoked' | 'distribution.acknowledged';

export interface OrgWebhook {
  id: string;
  url: string;
  events: OrgWebhookEvent[];
  /** 作った時の応答だけ(以後は null) */
  secret: string | null;
  created_at: string | null;
  revoked_at: string | null;
  /** [Gate G2] 署名の鍵の版・前の鍵でも署名する期限・自動で止めた理由(receiver_gone: 受け手が 410 を返した) */
  secret_version: number;
  previous_secret_valid_until: string | null;
  disabled_reason: string | null;
}

export interface OrgWebhookList {
  webhooks: OrgWebhook[];
  events: Record<string, string>;
}

export interface OrgWebhookDelivery {
  id: string;
  event_id: string;
  event_type: string;
  /** [Gate G2] dead: 自動の再送の上限に達した(手で送り直せる) */
  status: 'pending' | 'delivered' | 'failed' | 'dead';
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string | null;
  delivered_at: string | null;
  /** [Gate G2] 次に自動で送る時刻(pending・failed の間だけ) */
  next_attempt_at: string | null;
  max_attempts: number;
}
