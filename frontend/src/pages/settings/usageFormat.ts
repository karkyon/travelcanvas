/** [Gate G5] BILL-02 使用量の表示(量は KB・MB・GB、回数は件)。 */
import type { UsageRow } from '@/services/api/types/g5';

export function formatUsage(row: Pick<UsageRow, 'metric'>, value: number): string {
  if (row.metric === 'upload_bytes') {
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)}MB`;
    return `${Math.ceil(value / 1024)}KB`;
  }
  return `${value.toLocaleString('ja-JP')}件`;
}
