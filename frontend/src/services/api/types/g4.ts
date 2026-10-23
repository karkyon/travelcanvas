/**
 * [Gate G4] 合意の採用(COL-02)・通知の設定とまとめ(COL-03)・ゲストの閲覧(COL-05)・濫用の対応(FC-097)の型。
 */
import type { Poll } from './discussion';
import type { PublicSharedPlan } from './share';

/** [Gate G4] COL-02 決定の状態(回答中 → 締切 → 決定 → 旅程に反映) */
export type PollPhase = 'voting' | 'closed' | 'no_quorum' | 'decided' | 'adopted';

/** [Gate G4] COL-02 投票の応答に足した項目(decoder は既存の項目だけを検査し、これらはそのまま残す) */
export interface PollG4 {
  phase?: PollPhase;
  quorum?: number | null;
  responders?: number;
  quorum_met?: boolean;
  tied_option_ids?: string[];
  closed_reason?: 'manual' | 'deadline' | 'decided' | null;
  adopted_at?: string | null;
  adopted_by_name?: string | null;
  can_adopt?: boolean;
}

export interface PollOptionG4 {
  candidate_id?: string | null;
  candidate_label?: string | null;
  candidate_missing?: boolean;
  is_tied?: boolean;
}

export interface AdoptInput {
  day_id?: string | null;
  local_start_time?: string | null;
  remove_others?: boolean;
}

export interface AdoptionPreview {
  poll_id: string;
  option_id: string;
  option_label: string;
  kind: 'schedule_candidate' | 'keep_event' | 'record_only';
  effects: string[];
  problems: Array<{ code: string; message: string }>;
  can_adopt: boolean;
  undoable: boolean;
  plan_revision: number;
}

export interface AdoptResult {
  poll: Poll;
  plan_revision: number;
  message: string;
}

export type NotificationLevel = 'all' | 'mentions' | 'none';

export interface NotificationPrefs {
  level: NotificationLevel;
  email_digest: 'off' | 'daily';
  email_available: boolean;
  has_email: boolean;
  plans: Array<{ plan_id: string; plan_title: string | null; level: NotificationLevel }>;
}

export interface NotificationDigest {
  total: number;
  groups: Array<{
    plan_id: string | null;
    plan_title: string | null;
    total: number;
    latest_at: string | null;
    types: Array<{ type: string; count: number }>;
  }>;
}

export interface SharePolicyExplained {
  always: string[];
  shown: Array<{ key: string; label: string }>;
  hidden: Array<{ key: string; label: string }>;
  never: string[];
}

export interface ShareInfo {
  needs_passcode: boolean;
  expires_at: string | null;
  remaining_uses: number | null;
  allow_clone: boolean;
  policy_explained: SharePolicyExplained;
}

/** [Gate G4] COL-05 公開の閲覧の応答に足した項目(resolve は view_token も返す。decoder は残りの項目をそのまま残す) */
export type GuestShareView = PublicSharedPlan & {
  view_token?: string;
  view_expires_in?: number;
  allow_clone?: boolean;
  policy_explained?: SharePolicyExplained;
};

export interface ShareCloneResult {
  plan_id: string;
  link: string;
  message: string;
}

export type AbuseReason = 'phishing' | 'malware' | 'spam' | 'scraping' | 'privacy' | 'other';

export interface AbuseReportItem {
  id: string;
  source: 'report' | 'auto';
  reason: AbuseReason;
  reason_label: string;
  note: string | null;
  status: 'open' | 'dismissed' | 'actioned';
  resolution: string | null;
  created_at: string | null;
  handled_at: string | null;
  plan: { id: string; title: string; owner_user_id: string } | null;
  share: {
    id: string; token_prefix: string; plan_id: string; revoked_at: string | null; revoked_reason: string | null;
    is_active: boolean; use_count: number; has_passcode: boolean; accesses_24h: number;
  } | null;
}

export interface AbuseReportList {
  counts: Record<'open' | 'dismissed' | 'actioned', number>;
  reports: AbuseReportItem[];
}
