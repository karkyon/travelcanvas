/**
 * 削除済みプラン(ゴミ箱)APIの型
 *
 * [Gate B-012] backend/app/api/v1/travel.py。DELETE /travel-plans/{id} は論理削除で、
 * purge_after(既定30日後)を過ぎると完全削除される。それまでは所有者が復元できる。
 */
export interface DeletedPlanSummary {
  id: string;
  title: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  deleted_at: string;
  /** この日時を過ぎると完全削除され、復元できなくなる */
  purge_after: string;
}

/** DELETE /travel-plans/{id} の応答(論理削除) */
export interface PlanDeleteResult {
  message: string;
  deleted_at: string;
  purge_after: string;
}

export interface PlanPurgeResult {
  message: string;
}
