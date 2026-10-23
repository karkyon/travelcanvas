/**
 * 合意形成(FR-022)・コメント(FR-024)APIの型
 *
 * [Gate P3] backend/app/api/v1/discussion.py に対応する。DOC-05 §8.4。
 * 匿名の投票では、回答者が3人未満の間は counts/score が null(件数から個人が推測できるため)。
 */
export type VoteValue = 'love' | 'ok' | 'concern' | 'veto' | 'abstain';
export type VetoPolicy = 'block' | 'block_with_alternative' | 'advisory';
export type OptionState = 'pending' | 'blocked' | 'has_concerns' | 'agreed';
export type PollState = 'voting' | 'agreed' | 'decided' | 'blocked' | 'needs_discussion';

export interface PollVote {
  id: string;
  is_mine: boolean;
  /** 匿名の投票では本人以外 null */
  user_id: string | null;
  name: string | null;
  value: VoteValue;
  reason: string | null;
  alternative: string | null;
  is_resolved: boolean;
  resolution_note: string | null;
  resolved_by_name: string | null;
  can_resolve: boolean;
}

export interface PollOption {
  id: string;
  label: string;
  event_id: string | null;
  event_label: string | null;
  event_missing: boolean;
  state: OptionState;
  score: number | null;
  counts: Record<VoteValue, number> | null;
  responders: number;
  unresolved_concerns: number;
  unresolved_vetoes: number;
  is_leading: boolean;
  is_decided: boolean;
  my_vote: VoteValue | null;
  votes: PollVote[];
}

export interface Poll {
  id: string;
  plan_id: string;
  algorithm_version: string;
  title: string;
  description: string | null;
  deadline_at: string | null;
  status: 'open' | 'closed';
  is_closed: boolean;
  veto_policy: VetoPolicy;
  is_anonymous: boolean;
  counts_hidden: boolean;
  state: PollState;
  decided_option_id: string | null;
  created_by_name: string | null;
  can_manage: boolean;
  unanswered: Array<{ user_id: string; name: string }>;
  options: PollOption[];
  revision: number;
  created_at: string | null;
}

export interface PollCreateData {
  title: string;
  description?: string;
  deadline_at?: string;
  veto_policy?: VetoPolicy;
  is_anonymous?: boolean;
  quorum?: number;
  options: Array<{ label?: string; event_id?: string; candidate_id?: string }>;
}

export interface PollUpdateData {
  title?: string;
  description?: string | null;
  deadline_at?: string | null;
  status?: 'open' | 'closed';
  decided_option_id?: string | null;
}

export interface VoteInput {
  option_id: string;
  /** null は回答の取り消し */
  value: VoteValue | null;
  reason?: string;
  alternative?: string;
}

export type CommentTargetType = 'plan' | 'event' | 'reservation' | 'poll' | 'expense';

export interface PlanComment {
  id: string;
  plan_id: string;
  target_type: CommentTargetType;
  target_id: string | null;
  parent_id: string | null;
  author_user_id: string;
  author_name: string;
  is_mine: boolean;
  is_deleted: boolean;
  body: string | null;
  mentions: Array<{ user_id: string; name: string }>;
  status: 'open' | 'resolved';
  /** 予約番号・PIN・旅券番号らしき文字列を含む(EX-011) */
  sensitive_warning: boolean;
  sensitive_reasons: string[];
  can_edit: boolean;
  can_moderate: boolean;
  edited_at: string | null;
  revision: number;
  created_at: string | null;
}

export interface CommentCreateData {
  target_type?: CommentTargetType;
  target_id?: string;
  parent_id?: string;
  body: string;
  mentions?: string[];
}
