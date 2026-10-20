/**
 * 情報内検索・コマンドパレット(FR-009)APIの型
 *
 * [Gate C3] backend/app/api/v1/plan_search.py に対応する。権限の無い分類は返らない(件数も無い)。
 */
export type SearchCategory = 'day' | 'event' | 'place' | 'candidate' | 'reservation' | 'ticket' | 'document' | 'expense'
  | 'member' | 'memory';
export type SearchFilter = 'today' | 'reservation' | 'ticket' | 'hotel' | 'emergency';

export interface SearchHit {
  category: SearchCategory;
  id: string;
  title: string;
  subtitle: string | null;
  when: string | null;
  badge: string | null;
  plan_id: string;
  plan_title: string;
  link: string;
}

export interface SearchResults {
  plan_id?: string;
  query: string;
  filter: SearchFilter | null;
  filter_label: string | null;
  categories: Array<{ category: SearchCategory; label: string; count: number; results: SearchHit[] }>;
  total: number;
  /** /search/everything の時だけ */
  plans?: Array<{ plan_id: string; title: string; link: string }>;
  searched_plans?: number;
}
