/**
 * [Gate G9] UX-3 今開いている旅行(id・題名)だけを持つ小さな入れ物。
 * 全体の見出し(最初に読む JS)が旅行の入れ物(planStore。旅行の画面と一緒に後から読む)を直に読み込むと、最初に読む JS が
 * 約30kB 増えるため、planStore が変わった時にここへ写す(planStore.ts の末尾)。
 */
import { create } from 'zustand';

export interface CurrentTrip { id: string; title: string; start_date?: string | null; end_date?: string | null }

export const useCurrentTripStore = create<{ trip: CurrentTrip | null }>(() => ({ trip: null }));

export function publishCurrentTrip(
  plan: { id?: string | null; title?: string | null; start_date?: string | null; end_date?: string | null } | null | undefined,
): void {
  // [Gate AppShell] 上の帯の旅行の切り替えに日付も出す
  const next = plan?.id
    ? { id: String(plan.id), title: plan.title || '', start_date: plan.start_date ?? null, end_date: plan.end_date ?? null }
    : null;
  const prev = useCurrentTripStore.getState().trip;
  if (prev?.id === next?.id && prev?.title === next?.title && (prev?.start_date ?? null) === (next?.start_date ?? null)
    && (prev?.end_date ?? null) === (next?.end_date ?? null)) return;
  useCurrentTripStore.setState({ trip: next });
}
