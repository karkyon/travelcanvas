/**
 * 共有・コラボレーター・公開共有APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
export interface ShareLink {
  id: string;
  plan_id: string;
  // [Gate #30] 生トークンURLはDBに平文保存しなくなったため、作成直後の
  // レスポンスにのみ含まれる(以降の一覧取得ではnull)。
  url: string | null;
  token_prefix: string;
  permission: 'view' | 'edit';
  has_passcode: boolean;
  max_uses: number | null;
  use_count: number;
  // [Gate #41 / CA-002] 最終閲覧日時。ShareAccessLogから算出、未閲覧ならnull。
  last_accessed_at?: string | null;
  // [Gate M9-FE-C2b-3] backendは期限未設定時にnullを返す(実応答で確認)
  expires_at?: string | null;
  revoked_at?: string | null;
  is_active: boolean;
  created_at: string;
  // [Gate F45] FR-045 このリンクで見せる項目(既存のリンクは標準)
  fields: ShareFieldKey[];
}

/** [Gate F45] FR-045 共有リンクで選べる項目(backend app/services/share_policy.py FIELDS) */
export type ShareFieldKey =
  | 'plan_description' | 'day_titles' | 'event_times'
  | 'event_address' | 'event_notes' | 'reservation_summary';
export type ShareFieldClassification = 'internal' | 'confidential';
export type SharePreset = 'minimal' | 'standard' | 'all';

/** 発行・変更・プレビューで送る項目の指定。機密(confidential)を含む時は acknowledge_confidential=true が要る */
export interface SharePolicyInput {
  preset?: SharePreset;
  fields?: ShareFieldKey[];
  acknowledge_confidential?: boolean;
}

export interface ShareFieldInfo {
  key: ShareFieldKey;
  classification: ShareFieldClassification;
  label: string;
  description: string;
}

export interface SharePolicyCatalog {
  fields: ShareFieldInfo[];
  /** どの設定でも見せない項目(RESTRICTED) */
  restricted: Array<{ key: string; label: string }>;
  /** 常に見せる項目 */
  always: string[];
  presets: Record<SharePreset, ShareFieldKey[]>;
}

/** 閲覧者に見せない情報の件数(所有者のプレビューだけ。内容は返らない) */
export interface ShareWithheld {
  reservations: number;
  confirmation_numbers: number;
  tickets: number;
  documents: number;
  exact_locations: number;
  event_addresses: number;
  event_notes: number;
}

export interface SharePreview {
  fields: ShareFieldKey[];
  view: PublicSharedPlan;
  withheld: ShareWithheld;
  catalog: SharePolicyCatalog;
}

export interface Collaborator {
  id: string;
  user_id: string;
  plan_id: string;
  role: 'viewer' | 'editor' | 'owner';
  email: string;
  // [Gate M9-FE-C2b-3] backendは現状常にnullを返す(_collaborator_to_dict)
  name?: string | null;
  status: 'pending' | 'accepted' | 'declined';
  decided_at?: string | null;
  plan_title?: string | null;
}

export interface PublicSharedEvent {
  title: string;
  event_type: string;
  local_start_time?: string | null;
  is_all_day: boolean;
  // [Gate F45] 所有者が「予定の住所」「予定のメモ」を選んだ時だけ届く
  address?: string;
  notes?: string;
}

/** [Gate F45] 予約の概要(所有者が「予約の概要」を選んだ時だけ)。予約番号・予約者名・連絡先・金額は届かない */
export interface PublicSharedReservation {
  type: string;
  provider_name?: string | null;
  status: string;
  start?: string | null;
  end?: string | null;
}

export interface PublicSharedDay {
  date: string | null;
  title: string | null;
  events: PublicSharedEvent[];
}

export interface PublicSharedPlan {
  plan_id: string;
  title: string;
  description?: string | null;
  destination?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  // [Gate #41] Gate #34aでbackend(public_share.py)がitinerary({days})方式から
  // トップレベルdays方式(正規化テーブル直組み立て)へ切り替わったが、この型が
  // 追随しておらず、閲覧画面(PublicSharePage.tsx)が常に空表示になっていた
  // (実害バグ、本Gateで修正)。
  days: PublicSharedDay[];
  permission: 'view' | 'edit';
  can_edit: boolean;
  // [Gate F45] このリンクで見せている項目
  fields?: ShareFieldKey[];
  reservations?: PublicSharedReservation[];
}
