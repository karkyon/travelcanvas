/**
 * 予定・日程・経路候補・共同編集者の個別削除の応答型
 *
 * [Gate B-013] backend/app/services/plan_item_deletion.py。削除対象に紐付いた予約・文書は
 * 本体を残して紐付けだけを外し、予定を端点に持つ経路候補・移動区間は一緒に削除する。
 * 予定・日程・経路候補の削除は、外した紐付けを含めて「元に戻す」(Undo)で戻せる。
 */

/** 予定・日程の削除で外した紐付け・一緒に削除したデータの件数 */
export interface DeletionImpact {
  /** 紐付けを外した予約の件数(予約本体は残る) */
  reservations_unlinked: number;
  /** 外した文書リンクの件数(文書本体は残る) */
  document_links_removed: number;
  /** 一緒に削除した移動区間の件数 */
  segments_removed: number;
  /** 一緒に削除した経路候補の件数 */
  route_options_removed: number;
  /** 採用元の経路候補への参照を外した移動区間の件数(区間は残る) */
  segments_unlinked: number;
}

/** DELETE /plans/{id}/events/{eid}・/days/{did} の応答 */
export interface ItemDeleteResult {
  revision: number;
  /** 旧backendは返さない。無い場合は何も外していない扱い */
  detached?: DeletionImpact;
}

/** DELETE /plans/{id}/route-options/{oid} の応答 */
export interface RouteOptionDeleteResult {
  revision: number;
  detached?: { segments_unlinked: number };
}

/** DELETE /travel-plans/{id}/collaborators/{cid} の応答(アクセス取消し) */
export interface CollaboratorRemoveResult {
  success: boolean;
  /** 割当を外したチケット担当者・参加者の件数(チケット・参加者の本体は残る) */
  detached?: { ticket_holders: number; participants: number };
}

/** 確定ロックされた紐付けがあり削除できない場合の409応答(detail) */
export interface LockedRelationDetail {
  code: 'locked_relation';
  message: string;
  blocking: Array<{ type: string; id: string; event_id: string; reservation_id: string; reason: string }>;
}

/** Undoで戻す先が変わっていて取り消せない場合の409応答(detail) */
export interface UndoConflictDetail {
  code: 'undo_conflict';
  message: string;
  conflicts: Array<{ type: string; id: string | null; reason: string }>;
}
