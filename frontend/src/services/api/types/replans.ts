/**
 * 外部状況(アラート、FR-030)・安全な再計画(FR-031)APIの型
 *
 * [Gate P10] backend/app/api/v1/replans.py・app/services/replan.py(replan-v1)に対応する。
 * アラートは情報源(source)・取得時刻(observed_at)・確度(confidence)を持ち、取得から3時間を過ぎた情報は is_stale。
 * 再計画案A/Bは本案を変えない。承認(apply)すると選んだ案を1つの変更セットとして適用する(本案の「元に戻す」で取り消せる)。
 */
export type AlertKind = 'delay' | 'cancellation' | 'closure' | 'weather';
export type AlertSource = 'user_report' | 'route_status';
export type AlertConfidence = 'confirmed' | 'reported';
export type AlertStatus = 'active' | 'resolved' | 'dismissed';
export type ReplanStatus = 'proposed' | 'applied' | 'rejected';
export type ReplanState = ReplanStatus | 'applied_undone';
export type ReplanStrategy = 'shift_later' | 'keep_times' | 'remove' | 'move_next_day';

export interface PlanAlert {
  id: string;
  plan_id: string;
  kind: AlertKind;
  kind_label: string;
  source: AlertSource;
  source_label: string | null;
  confidence: AlertConfidence;
  observed_at: string | null;
  is_stale: boolean;
  event_id: string | null;
  event_title: string | null;
  event_local_start_time: string | null;
  /** 影響を受ける予定が削除された */
  event_missing: boolean;
  day_id: string | null;
  local_date: string | null;
  delay_minutes: number | null;
  note: string | null;
  status: AlertStatus;
  resolved_at: string | null;
  created_by_name: string;
  latest_replan_id: string | null;
  latest_replan_status: ReplanStatus | null;
  revision: number;
  created_at: string | null;
  updated_at: string | null;
}

/** 登録済み経路(採用した経路候補)の運行状態から検出した遅延・運休(まだアラートにしていないもの) */
export interface DetectedRouteIssue {
  event_id: string;
  event_title: string;
  event_local_start_time: string | null;
  day_id: string;
  local_date: string | null;
  transport_status: 'delayed' | 'cancelled';
  suggested_kind: 'delay' | 'cancellation';
  observed_at: string | null;
  is_stale: boolean;
}

export interface AlertList {
  plan_id: string;
  server_time: string;
  can_edit: boolean;
  alerts: PlanAlert[];
  detected: DetectedRouteIssue[];
}

export interface AlertCreateData {
  kind: AlertKind;
  event_id?: string | null;
  day_id?: string | null;
  delay_minutes?: number | null;
  source?: AlertSource;
  source_label?: string | null;
  confidence?: AlertConfidence;
  observed_at?: string | null;
  note?: string | null;
}

export interface AlertUpdateData {
  confidence?: AlertConfidence;
  note?: string | null;
  status?: AlertStatus;
}

export interface ReplanChange {
  event_id: string;
  title: string;
  before_time: string | null;
  after_time: string | null;
  before_date: string;
  after_date: string;
}

export interface ReplanCandidate {
  id: 'A' | 'B';
  strategy: ReplanStrategy;
  label: string;
  description: string;
  available: boolean;
  unavailable_reason: string | null;
  warnings: string[];
  changes: ReplanChange[];
  /** この案で外す(失う)予定 */
  lost: Array<{ event_id: string; title: string }>;
  /** 守る予定(確定・予約付き)。どの案でも動かさない */
  protected: Array<{ event_id: string; title: string; local_start_time: string | null; has_reservation: boolean }>;
  metrics: {
    changed_count: number;
    lost_count: number;
    protected_count: number;
    max_delay_minutes: number;
    day_end_shift_minutes: number | null;
  };
  /** 外す予定に紐付く支払い済みの費用(返金されない可能性がある額)。使えない案はnull */
  cost_impact: {
    currency: string;
    lost_paid_amount: string;
    lost_paid_count: number;
    unconverted_count: number;
  } | null;
  /** 適用した時に通知されるメンバー(操作した人を除く) */
  notify_member_names: string[];
}

export interface Replan {
  id: string;
  plan_id: string;
  alert_id: string;
  algorithm_version: string;
  base_revision: number;
  plan_revision: number;
  /** 案を作った後に本案が変わった(適用できない) */
  is_stale: boolean;
  status: ReplanStatus;
  state: ReplanState;
  applied_candidate: 'A' | 'B' | null;
  applied_at: string | null;
  applied_by_name: string | null;
  created_by_name: string;
  can_apply: boolean;
  candidates: ReplanCandidate[];
  revision: number;
  created_at: string | null;
}

export interface ReplanApplyResult {
  replan: Replan;
  plan_revision: number;
}

export type ReplanErrorCode =
  | 'replan_stale' | 'replan_conflict' | 'replan_closed' | 'candidate_unavailable' | 'no_changes' | 'alert_target_changed';

/** 適用・作成の409の detail(構造化)。replan_conflict は食い違った予定の一覧を持つ */
export interface ReplanErrorDetail {
  code: ReplanErrorCode;
  message: string;
  current_revision?: number;
  conflicts?: Array<{ op: string; event_id?: string; title?: string; reason: string }>;
}
