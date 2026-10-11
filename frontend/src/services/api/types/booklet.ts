/**
 * しおり・印刷・PDF出力(FR-034/035/046)APIの型
 *
 * [Gate P4] backend/app/api/v1/booklet.py・app/services/booklet.py(booklet-v1)に対応する。
 * しおり投影はホワイトリスト。既定では予約番号は伏字、住所・電話・参加者名は null。
 * QR・チケットの中身・PIN・名義・個人の持ち物・個人予算はどの設定でも含まれない。
 */
export type BookletTheme = 'cute' | 'simple' | 'family' | 'school' | 'business' | 'accessible' | 'mono';
export type BookletDensity = 'normal' | 'compact';
export type BookletFormat = 'web' | 'print';
export type BookletSection =
  | 'cover' | 'toc' | 'schedule' | 'map' | 'reservations' | 'packing' | 'contacts' | 'costs' | 'notes';
export type BookletWarning = 'stale_revision' | 'contains_sensitive' | 'qr_not_included' | 'unconverted_expenses';

export interface BookletIncludes {
  confirmation_numbers: boolean;
  addresses: boolean;
  phones: boolean;
  participants: boolean;
}

export interface BookletOptions {
  theme: BookletTheme;
  density: BookletDensity;
  format: BookletFormat;
  sections: BookletSection[];
  includes: BookletIncludes;
}

export interface BookletExportCreateData extends BookletOptions {
  /** 機密項目を含む版では必須(タイムゾーン付きISO 8601、90日以内) */
  valid_until?: string;
}

export interface BookletEvent {
  title: string;
  event_type: string;
  local_start_time: string | null;
  is_all_day: boolean;
  end: string | null;
  place_name: string | null;
  address: string | null;
  locked: boolean;
  reservations: Array<{ type: string; provider_name: string | null; status: string }>;
}

export interface BookletDay {
  date: string;
  title: string | null;
  timezone_id: string;
  events: BookletEvent[];
}

export interface BookletTransport {
  mode: string;
  from_label: string | null;
  to_label: string | null;
  departure: string | null;
  arrival: string | null;
  duration_minutes: number | null;
  transport_number: string | null;
  platform: string | null;
  status: string;
  is_estimate: boolean;
}

export interface BookletReservation {
  type: string;
  provider_name: string | null;
  status: string;
  start: string | null;
  end: string | null;
  timezone_id: string | null;
  guest_count: number | null;
  /** 既定は伏字。confirmation_is_full のときだけ全桁 */
  confirmation: string | null;
  confirmation_is_full: boolean;
  contact_phone: string | null;
  cancellation_deadline: string | null;
  payment_status: string | null;
}

export interface BookletCostRow {
  category: string;
  budget: string | null;
  actual: string;
  over: boolean;
}

export interface Booklet {
  policy_version: string;
  plan_id: string;
  theme: BookletTheme;
  density: BookletDensity;
  format: BookletFormat;
  sections: BookletSection[];
  includes: BookletIncludes;
  contains_sensitive: boolean;
  generated_at: string;
  input_revision: number;
  current_revision: number;
  is_stale: boolean;
  data_as_of: string;
  warnings: BookletWarning[];
  cover: {
    title: string; destination: string | null; start_date: string | null; end_date: string | null;
    day_count: number; member_count: number;
  } | null;
  schedule: { days: BookletDay[]; transport: BookletTransport[] } | null;
  map: { places: Array<{ label: string; date: string | null; address: string | null; latitude: number | null; longitude: number | null }> } | null;
  reservations: BookletReservation[] | null;
  packing: Array<{ name: string; category: string; quantity: number; is_required: boolean; status: string }> | null;
  contacts: {
    member_count: number;
    members: string[] | null;
    reservation_contacts: Array<{ provider_name: string | null; type: string; phone: string | null; url: string | null }> | null;
    hidden: Array<'participants' | 'phones'>;
  } | null;
  costs: {
    base_currency: string; budget_total: string | null; actual_total: string; over: boolean;
    by_category: BookletCostRow[]; unconverted_expenses: number;
  } | null;
  notes: string[] | null;
}

export interface BookletExport {
  id: string;
  plan_id: string;
  version_no: number;
  format: BookletFormat;
  theme: BookletTheme;
  density: BookletDensity;
  sections: BookletSection[];
  includes: BookletIncludes;
  contains_sensitive: boolean;
  watermark_text: string | null;
  valid_until: string | null;
  input_revision: number;
  is_stale: boolean;
  policy_version: string;
  state: 'active' | 'revoked' | 'expired';
  created_at: string | null;
  created_by_name: string;
  is_mine: boolean;
  can_view: boolean;
  can_revoke: boolean;
}

export interface BookletExportResult {
  export: BookletExport;
  booklet: Booklet;
}
