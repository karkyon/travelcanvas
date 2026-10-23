/** [Gate G5] 記録タブ(LedgerPanel)の表示名。 */
import type { BudgetVersionKind, RemainderTo, RoundingMode } from '@/services/api/types/g5';

export const ROUNDING_LABEL: Record<RoundingMode, string> = { half_up: '四捨五入', down: '切り捨て', up: '切り上げ' };
export const REMAINDER_LABEL: Record<RemainderTo, string> = {
  largest: '端数の大きい人から', payer: '支払った人', first: '一覧の順に',
};
export const VERSION_LABEL: Record<BudgetVersionKind, string> = {
  initial: '当初', revised: '更新', committed: '確定(予約)', actual: '実績',
};
