import { create } from 'zustand';

/**
 * [Gate L5] FR-056 位置の記録中であることを、アプリのどの画面でも示すための状態(DOC-15 CA-014「アプリ内で常時明示」)。
 *
 * 位置の取得はブラウザの制約で「位置の記録」の画面を開いている間だけ行う(capturing)。ほかの画面へ移っても、
 * サーバー側の軌跡は記録中のまま残るため、その間も「記録中の軌跡があり、位置は取っていない」ことを示す。
 * 座標は持たない(旅行・軌跡の ID と状態だけ)。同じタブの再読込に備えて sessionStorage にも置く。
 */
export interface ActiveRecording {
  planId: string;
  trackId: string;
  status: 'recording' | 'paused';
  /** この画面で今、位置を取っているか */
  capturing: boolean;
  tierLabel: string | null;
}

interface TrackingState {
  active: ActiveRecording | null;
  setActive: (active: ActiveRecording | null) => void;
  setCapturing: (capturing: boolean, tierLabel?: string | null) => void;
}

const KEY = 'tc_active_recording';

function load(): ActiveRecording | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ActiveRecording>;
    if (typeof v.planId !== 'string' || typeof v.trackId !== 'string') return null;
    return { planId: v.planId, trackId: v.trackId, status: v.status === 'paused' ? 'paused' : 'recording',
      capturing: false, tierLabel: null };
  } catch {
    return null;
  }
}

function save(active: ActiveRecording | null): void {
  try {
    if (active) sessionStorage.setItem(KEY, JSON.stringify({ planId: active.planId, trackId: active.trackId,
      status: active.status }));
    else sessionStorage.removeItem(KEY);
  } catch {
    // 保存できなくても表示は続ける
  }
}

export const useTrackingStore = create<TrackingState>((set, get) => ({
  active: load(),
  setActive: (active) => {
    save(active);
    set({ active });
  },
  setCapturing: (capturing, tierLabel = null) => {
    const cur = get().active;
    if (!cur) return;
    set({ active: { ...cur, capturing, tierLabel: capturing ? tierLabel : null } });
  },
}));
