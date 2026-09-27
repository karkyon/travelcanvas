/**
 * [Gate B-013] 予定・日程・経路候補・共同編集者の個別削除に関する利用者向けの文言。
 *
 * 削除対象に紐付いた予約・文書は本体を残して紐付けだけを外し、経路候補・移動区間は
 * 一緒に削除する(backend/app/services/plan_item_deletion.py)。何が起きたかを利用者へ
 * 正確に伝え、「元に戻す」で戻せることを案内する。
 */
import type { CollaboratorRemoveResult, DeletionImpact } from '@/services/api';

export const LOCKED_RELATION_MESSAGE =
  '確定ロックされた予約との紐付けがあるため削除できません。予約画面で紐付けのロックを解除してから削除してください。';

export const UNDO_CONFLICT_MESSAGE =
  '削除後に関連する予約・文書などが変更または削除されたため、取り消せませんでした(何も変更していません)。最新の内容を再読み込みします。';

const TARGET_LABEL = { event: '予定', day: '日程' } as const;

/** 予定・日程の削除で外した紐付け・一緒に削除したデータの説明。何も無ければnull。 */
export function describeItemDeletion(
  target: keyof typeof TARGET_LABEL,
  impact: DeletionImpact | null | undefined
): string | null {
  if (!impact) return null;
  const unlinked = [
    impact.reservations_unlinked > 0 ? `予約${impact.reservations_unlinked}件` : null,
    impact.document_links_removed > 0 ? `文書${impact.document_links_removed}件` : null,
  ].filter((x): x is string => x !== null);
  const removed = [
    impact.segments_removed > 0 ? `移動区間${impact.segments_removed}件` : null,
    impact.route_options_removed > 0 ? `経路候補${impact.route_options_removed}件` : null,
  ].filter((x): x is string => x !== null);
  const kept = impact.segments_unlinked > 0 ? `移動区間${impact.segments_unlinked}件は残し、経路候補との紐付けだけを外しました` : null;
  if (unlinked.length === 0 && removed.length === 0 && !kept) return null;

  const sentences: string[] = [`${TARGET_LABEL[target]}を削除しました。`];
  if (unlinked.length > 0) {
    const keptKinds = [
      impact.reservations_unlinked > 0 ? '予約' : null,
      impact.document_links_removed > 0 ? '文書' : null,
    ].filter((x): x is string => x !== null);
    sentences.push(`${unlinked.join('・')}との紐付けを外しました(${keptKinds.join('・')}の内容は残っています)。`);
  }
  if (removed.length > 0) sentences.push(`${removed.join('・')}も削除しました。`);
  if (kept) sentences.push(`${kept}。`);
  sentences.push('「元に戻す」でまとめて復元できます。');
  return sentences.join('');
}

/** 経路候補の削除で、採用した移動区間を残して紐付けだけを外した場合の説明。 */
export function describeRouteOptionDeletion(segmentsUnlinked: number | undefined): string {
  return segmentsUnlinked && segmentsUnlinked > 0
    ? `経路候補を削除しました。この候補から採用した移動区間${segmentsUnlinked}件は残っています。`
    : '経路候補を削除しました。';
}

/** 共同編集者の削除(アクセス取消し)の結果の説明。 */
export function describeCollaboratorRemoval(result: CollaboratorRemoveResult | null | undefined): string {
  const holders = result?.detached?.ticket_holders ?? 0;
  const participants = result?.detached?.participants ?? 0;
  const parts = [
    holders > 0 ? `チケット担当${holders}件` : null,
    participants > 0 ? `参加者${participants}件` : null,
  ].filter((x): x is string => x !== null);
  if (parts.length === 0) return 'コラボレーターを削除しました';
  return `コラボレーターを削除しました。${parts.join('・')}の割当を外しました(チケット・参加者の情報は残っています)`;
}

/** 409応答のdetailが構造化されていればそのcodeを返す(文字列detailの競合はnull)。 */
export function conflictCode(error: unknown): string | null {
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } } | null | undefined)
    ?.response;
  if (response?.status !== 409) return null;
  const detail = response.data?.detail;
  if (typeof detail === 'object' && detail !== null && typeof (detail as { code?: unknown }).code === 'string') {
    return (detail as { code: string }).code;
  }
  return null;
}
