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

// ===== [Gate G4] MAP-03 検索のコマンド(backend/app/api/v1/commands.py)
export type CommandKind = 'mutate' | 'navigate' | 'run';

export interface CommandDef {
  name: string;
  label: string;
  kind: CommandKind;
  usage: string;
  undoable: boolean;
  allowed: boolean;
  aliases: string[];
}

export interface CommandList {
  commands: CommandDef[];
  plan_revision: number;
}

export interface CommandPreview {
  command: string;
  label: string;
  kind: CommandKind;
  args: Record<string, unknown>;
  undoable: boolean;
  allowed: boolean;
  reason: string | null;
  needs_confirmation: boolean;
  summary: string[];
  problem: { code: string; message: string } | null;
  link: string | null;
  plan_revision: number;
}

export interface CommandResult {
  run_id: string;
  status: 'executed' | 'undone';
  command: string;
  label: string;
  undoable: boolean;
  message: string;
  link: string | null;
  plan_revision: number;
}

export interface CommandUndoResult {
  run_id: string;
  status: 'undone';
  plan_revision: number;
  message: string;
}
