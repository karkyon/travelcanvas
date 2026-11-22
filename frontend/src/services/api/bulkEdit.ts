/**
 * [Gate② FC-012] 複数の予定をまとめて変える(backend/app/api/v1/plans.py の events/bulk)。1 つの変更の組で、元に戻すで一度に戻る。
 */
import { api } from './index';

export async function bulkUpdateEvents(planId: string, eventIds: string[], change: { event_type?: string; day_id?: string },
  revision: number): Promise<{ updated: number; revision: number }> {
  const r = await api.post(`/plans/${planId}/events/bulk`, { event_ids: eventIds, ...change },
    { headers: { 'If-Match': String(revision) } });
  const raw = r.data as { updated?: number; revision?: number };
  return { updated: Number(raw.updated ?? 0), revision: Number(raw.revision ?? revision) };
}
