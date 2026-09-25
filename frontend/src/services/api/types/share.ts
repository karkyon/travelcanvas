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
  expires_at?: string;
  revoked_at?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Collaborator {
  id: string;
  user_id: string;
  plan_id: string;
  role: 'viewer' | 'editor' | 'owner';
  email: string;
  name?: string;
  status: 'pending' | 'accepted' | 'declined';
  decided_at?: string | null;
  plan_title?: string | null;
}

export interface PublicSharedEvent {
  title: string;
  event_type: string;
  local_start_time?: string | null;
  is_all_day: boolean;
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
}
