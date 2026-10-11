/**
 * アカウントの削除・同意の撤回(FR-039)APIの型
 *
 * [Gate P9] backend/app/api/v1/privacy.py・app/services/account_deletion.py・app/services/consents.py に対応する。
 */
import type { RetentionInfo } from './dataExport';

export type ConsentPurpose = 'ai_processing' | 'location' | 'analytics' | 'marketing_email';

export interface ConsentItem {
  purpose: ConsentPurpose;
  label: string;
  description: string;
  /** その目的の処理を行う機能が今あるか(現時点では全てfalse) */
  in_use: boolean;
  granted: boolean;
  updated_at: string | null;
}

export interface ConsentState {
  purposes: ConsentItem[];
}

export interface AccountDeletionPreview {
  account_type: 'registered' | 'guest';
  requires_password: boolean;
  confirmation_text: string;
  owned_plans: Array<{ id: string; title: string; member_count: number }>;
  member_plan_count: number;
  deleted_in_member_plans: {
    personal_packing_items: number; private_constraints: number; member_budgets: number; documents: number;
  };
  kept_in_member_plans: { comments: number; expenses: number; votes: number };
  plan_delete_grace_days: number;
  retention: RetentionInfo;
}

export interface AccountDeletionResult {
  deleted: boolean;
  summary: Record<string, number>;
  plan_delete_grace_days: number;
}
