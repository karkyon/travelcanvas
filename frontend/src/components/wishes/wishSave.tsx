/** [FR-062] 残す(シート・場所の詳しい所・検索の結果の「♡ 今度行きたい」から共通で使う) */
import { toast } from 'react-hot-toast';
import { deleteWishSpot, patchWishSpot, quickSaveWish } from '@/services/api/spotIntake';
import type { QuickWishInput, QuickWishResult, WishKind, WishSource, WishWhen } from '@/services/api/spotIntake';
import { currentOfflineSession } from '@/utils/offlineSession';
import { flushWishQueue, keepForRetry, newClientId, queueWish } from '@/utils/wishQueue';

export const UNDO_MS = 6000;
export const POSITION_TIMEOUT_MS = 3000;
export const POSITION_ACCURACY_M = 100;

export interface SaveWishArgs {
  name: string; latitude?: number | null; longitude?: number | null; address?: string | null; genre?: string | null;
  kind: WishKind; note?: string | null; when?: WishWhen | null; sourceKind: WishSource; planId?: string | null;
}

function undoToast(message: string, onUndo: () => Promise<void>) {
  toast((t) => (
    <span className="flex items-center gap-3" data-testid="wish-saved-toast">
      <span>{message}</span>
      <button type="button" className="tc-focus-ring min-h-11 px-2 font-semibold underline"
        onClick={() => { toast.dismiss(t.id); void onUndo().then(() => toast.success('取り消しました'))
          .catch(() => toast.error('取り消せませんでした。行きたい場所の画面で直してください')); }}>
        取り消す
      </button>
    </span>
  ), { duration: UNDO_MS });
}

/** 残す(シート・場所の詳しい所・検索の結果の「♡ 今度行きたい」から共通で使う)。確認なしで保存する */
export async function saveWish(args: SaveWishArgs): Promise<QuickWishResult | 'queued' | null> {
  const input: QuickWishInput = {
    name: args.name.trim().slice(0, 200), latitude: args.latitude ?? null, longitude: args.longitude ?? null,
    address: args.address ?? null, genre: args.genre ?? null, wish_kind: args.kind,
    wish_note: (args.note ?? '').trim().slice(0, 200) || null, wish_when: args.when ?? null,
    source_kind: args.sourceKind, source_plan_id: args.planId ?? null, client_id: newClientId(),
  };
  if (!input.name) return null;
  try {
    const r = await quickSaveWish(input);
    if (r.created) {
      undoToast(`「${r.spot.name}」を${args.kind === 'again' ? 'また行きたい' : '今度行きたい'}に残しました`,
        () => deleteWishSpot(r.spot.id));
    } else {
      const n = r.spot.again_count ?? 0;
      const prev = r.previous;
      undoToast(`${r.spot.name}はもう残してあります${r.spot.wish_kind === 'again' && n > 0 ? `(また行きたい ${n + 1} 回目)` : ''}`,
        async () => {
          if (prev) await patchWishSpot(r.spot.id, { wish_kind: prev.wish_kind, again_count: prev.again_count,
            wish_note: prev.wish_note, wish_when: prev.wish_when });
        });
    }
    return r;
  } catch (e) {
    if (keepForRetry(e)) {
      const status = (e as { response?: { status?: number } } | null)?.response?.status;
      if (status === 429) { toast.error('続けて残しすぎました。1 分ほど待ってから残してください'); return null; }
      if (status === 401) { toast.error('ログインすると残せます'); return null; }
      if (await queueWish(currentOfflineSession(), input)) {
        toast('端末に残しました。つながった時に送ります', { icon: '📥' });
        return 'queued';
      }
      toast.error('端末に残せませんでした。つながってからもう一度残してください');
      return null;
    }
    toast.error('残せませんでした。名前を確かめてもう一度残してください');
    return null;
  }
}


export async function flushPendingWishes(): Promise<void> {
  const r = await flushWishQueue(currentOfflineSession()).catch(() => null);
  if (!r) return;
  if (r.sent > 0) toast.success(`端末に残していた ${r.sent} 件を行きたい場所へ送りました`);
  if (r.dropped > 0) toast.error(`${r.dropped} 件は送れませんでした(名前を確かめてもう一度残してください)`);
}

