/**
 * [Gate M9-FE-C2b-2] 実backend応答の契約テスト。
 *
 * __fixtures__/backendContractResponses.json は、sandboxの実backend(FastAPI +
 * PostgreSQL 16)へTestClientで予約・チケット・移動区間・経路・取込・文書・当日モードの
 * 各APIを実際に呼び出して採取した応答である([Gate M9-FE-C2b-3] 正規化プラン・地図プレビュー・
 * 最適化・共有・招待・公開共有・通知・認証・Place・QuickDraft promote・旧travel-plansを追加)。
 * runtime decoderがこれらを受理すること
 * (=backendとfrontendの型契約が一致していること)を固定する。
 */
import { describe, it, expect } from 'vitest';
import fx from './__fixtures__/backendContractResponses.json';
import { arrayOf, decodeResponse, int, object, str, ApiDecodeError, type Decoder } from './decode';
import {
  adoptRouteOptionResponse, documentLink, downloadUrlResult, extractionCandidate, importJob, importJobDetail,
  reservation, reservationEventLink, reservationParticipant, reservationRevealResult, routeLeg, routeOption,
  ticket, ticketRevealResult, todayResponse, travelDocument, travelSegment,
  collaborator, insertionPreview, legacyTravelPlan, normalizedDay, normalizedEvent, normalizedPlanDetail,
  notification, optimizationProposal, placeDetail, promoteQuickDraftResult, publicSharedPlan, routePreview,
  shareLink, unreadCount, user, authResponse, guestSessionResponse, planConstraint, revisionResult,
  validationRunDetail, validationRunSummary, deletedPlanSummary, planDeleteResult, planPurgeResult,
  collaboratorRemoveResult, itemDeleteResult, lockedRelationError, routeOptionDeleteResult, undoConflictError,
  packingItem, packingSuggestions, planMember, preparationTask, readiness,
  budget, expense, financeSettings, financeSummary, settlement,
  planComment, poll,
  booklet, bookletExport,
  retentionInfo,
  branch, branchDetail,
  calendarImportPreview, calendarImportResult, consentState, accountDeletionPreview, accountDeletionResult,
  alertList, planAlert, replan, replanApplyResult, replanError,
  optimizationApplyResult, optimizationCandidates,
  syncConflictList, syncResolveResult, syncResponse,
  journalDraft, memoryList, travelMemory,
  locationTrack, locationTrackDetail, locationTrackList, trackPointsDeleteResult, trackPointsUploadResult,
  actualPutResult, carryOverResult, journeyReview,
} from './decoders';
import { api } from './index';
import type { MinimalHttpClient } from './types';

const CASES: Array<[keyof typeof fx, Decoder<unknown>]> = [
  ['reservation', reservation],
  ['reservation_minimal', reservation],
  ['reservation_updated', reservation],
  ['reservation_list', arrayOf(reservation)],
  ['reservation_reveal', reservationRevealResult],
  ['participant', reservationParticipant],
  ['participant_list', arrayOf(reservationParticipant)],
  ['event_link', reservationEventLink],
  ['event_link_list', arrayOf(reservationEventLink)],
  ['ticket', ticket],
  ['ticket_minimal', ticket],
  ['ticket_list', arrayOf(ticket)],
  ['ticket_reveal', ticketRevealResult],
  ['segment', travelSegment],
  ['segment_updated', travelSegment],
  ['segment_list', arrayOf(travelSegment)],
  ['route_option', routeOption],
  ['route_option_minimal', routeOption],
  ['route_option_list', arrayOf(routeOption)],
  ['route_leg', routeLeg],
  ['route_adopt', adoptRouteOptionResponse],
  ['import_job', importJob],
  ['import_job_confirmed', importJob],
  ['import_job_list', arrayOf(importJob)],
  ['import_job_detail', importJobDetail],
  ['import_candidate', extractionCandidate],
  ['import_candidate_accepted', extractionCandidate],
  ['document', travelDocument],
  ['document_list', arrayOf(travelDocument)],
  ['document_link', documentLink],
  ['document_link_list', arrayOf(documentLink)],
  ['document_download_url', downloadUrlResult],
  ['today', todayResponse],
  ['today_with_transport', todayResponse],
  // ----- [Gate M9-FE-C2b-3]
  ['auth_me', user],
  ['auth_me_updated', user],
  ['travel_plan_created', legacyTravelPlan],
  ['travel_plan_get', legacyTravelPlan],
  ['travel_plan_list', (v, p) => arrayOf(legacyTravelPlan)((v as { plans: unknown }).plans, `${p}.plans`)],
  ['day_created', normalizedDay],
  ['day_created_minimal', normalizedDay],
  ['day_updated', normalizedDay],
  ['event_created', normalizedEvent],
  ['event_created_coords', normalizedEvent],
  ['event_updated', normalizedEvent],
  ['event_moved', normalizedEvent],
  ['plan_detail', normalizedPlanDetail],
  ['route_preview', routePreview],
  ['route_preview_empty', routePreview],
  ['insertion_preview', insertionPreview],
  ['optimization_proposal', optimizationProposal],
  ['optimization_apply', normalizedDay],
  ['place', placeDetail],
  ['place_minimal', placeDetail],
  ['share_created', shareLink],
  ['share_created_full', shareLink],
  ['share_list', arrayOf(shareLink)],
  ['share_updated', shareLink],
  ['share_revoked', shareLink],
  ['public_share', publicSharedPlan],
  ['collaborator_invited', collaborator],
  ['collaborator_invited_unknown_user', collaborator],
  ['collaborator_list', arrayOf(collaborator)],
  ['invitation_list', arrayOf(collaborator)],
  ['invitation_accepted', collaborator],
  ['notification_list', arrayOf(notification)],
  ['notification_list_unread', arrayOf(notification)],
  ['notification_unread_count', unreadCount],
  ['quickdraft_promoted', promoteQuickDraftResult],
  // ----- [Gate A1] 認証(login/register/guest/guest-upgrade)。authStoreの独自fetchを廃止しdecoder経由にした
  ['auth_register', authResponse],
  ['auth_login', authResponse],
  ['auth_guest', guestSessionResponse],
  ['auth_guest_upgrade', authResponse],
  // ----- [Gate L2] 制約(FR-016)。constraint_maskedは他のメンバーから見た秘匿制約
  ['constraint_shared', planConstraint],
  ['constraint_soft_between', planConstraint],
  ['constraint_event_scope', planConstraint],
  ['constraint_private_mine', planConstraint],
  ['constraint_updated', planConstraint],
  ['constraint_shared_other', planConstraint],
  ['constraint_masked', planConstraint],
  ['constraint_list_other', arrayOf(planConstraint)],
  ['constraint_deleted', revisionResult],
  // ----- [Gate L3] 実行可能性検証(FR-017)。detail_owner_privateは秘匿制約の作成者本人から見た結果
  ['validation_run_created', validationRunDetail],
  ['validation_run_list', arrayOf(validationRunSummary)],
  ['validation_run_detail_owner_private', validationRunDetail],
  ['validation_run_stale', validationRunDetail],
  ['validation_run_clean', validationRunDetail],
  // ----- [Gate B-012] 削除済みプラン(論理削除・一覧・復元・完全削除)
  ['plan_soft_deleted', planDeleteResult],
  ['deleted_plan_list', arrayOf(deletedPlanSummary)],
  ['deleted_plan_list_empty', arrayOf(deletedPlanSummary)],
  ['plan_restored', legacyTravelPlan],
  ['plan_purged', planPurgeResult],
  // ----- [Gate B-013] 個別削除(紐付け解除して削除)・確定ロック409・Undo競合409
  ['event_deleted_detached', itemDeleteResult],
  ['day_deleted', itemDeleteResult],
  ['route_option_deleted_adopted', routeOptionDeleteResult],
  ['collaborator_removed', collaboratorRemoveResult],
  ['event_delete_locked_409', lockedRelationError],
  ['undo_conflict_409', undoConflictError],
  // ----- [Gate P1] 持ち物(FR-025)・準備タスク/レディネス(FR-026)。*_otherは他のメンバー、*_assigneeは担当者から見た応答
  ['plan_members', arrayOf(planMember)],
  ['packing_item_shared', packingItem],
  ['packing_item_suggested', packingItem],
  ['packing_item_personal', packingItem],
  ['packing_item_updated', packingItem],
  ['packing_item_list', arrayOf(packingItem)],
  ['packing_item_list_other', arrayOf(packingItem)],
  ['packing_item_deleted', revisionResult],
  ['packing_suggestions', packingSuggestions],
  ['preparation_task_created', preparationTask],
  ['preparation_task_from_readiness', preparationTask],
  ['preparation_task_done', preparationTask],
  ['preparation_task_list', arrayOf(preparationTask)],
  ['preparation_task_list_assignee', arrayOf(preparationTask)],
  ['preparation_task_deleted', revisionResult],
  ['readiness_attention', readiness],
  ['readiness_ready', readiness],
  // ----- [Gate P2] 予算・費用(FR-027)・立替・精算(FR-028)。*_otherは閲覧者(個人の予算が見えない)から見た応答
  ['finance_settings_default', financeSettings],
  ['finance_settings_updated', financeSettings],
  ['budget_total', budget],
  ['budget_category', budget],
  ['budget_member', budget],
  ['budget_updated', budget],
  ['budget_list', arrayOf(budget)],
  ['budget_list_other', arrayOf(budget)],
  ['expense_equal', expense],
  ['expense_foreign', expense],
  ['expense_unconverted', expense],
  ['expense_refund', expense],
  ['expense_updated', expense],
  ['expense_deleted', revisionResult],
  ['expense_list', arrayOf(expense)],
  ['finance_summary', financeSummary],
  ['finance_summary_other', financeSummary],
  ['finance_summary_empty', financeSummary],
  ['settlement_created', settlement],
  ['settlement_list', arrayOf(settlement)],
  ['settlement_deleted', revisionResult],
  // ----- [Gate P3] 合意形成(FR-022)・コメント(FR-024)。*_viewerは閲覧者から見た応答、anonymous_hiddenは件数を伏せた匿名投票
  ['poll_created', poll],
  ['poll_voted', poll],
  ['poll_resolved', poll],
  ['poll_decided', poll],
  ['poll_anonymous_hidden', poll],
  ['poll_deleted', revisionResult],
  ['poll_list', arrayOf(poll)],
  ['poll_list_viewer', arrayOf(poll)],
  ['comment_created', planComment],
  ['comment_reply', planComment],
  ['comment_updated', planComment],
  ['comment_deleted', revisionResult],
  ['comment_list', arrayOf(planComment)],
  ['comment_list_poll', arrayOf(planComment)],
  // ----- [Gate P4] しおり・印刷(FR-034/035/046)。*_sensitive は所有者が機密項目を含めた応答、*_editor は編集者から見た一覧
  ['booklet_preview', booklet],
  ['booklet_preview_sensitive', booklet],
  ['booklet_preview_cover_only', booklet],
  ['booklet_export_created', object({ export: bookletExport, booklet })],
  ['booklet_export_sensitive', object({ export: bookletExport, booklet })],
  ['booklet_export_stale', object({ export: bookletExport, booklet })],
  ['booklet_export_revoked', object({ export: bookletExport })],
  ['booklet_export_list', arrayOf(bookletExport)],
  ['booklet_export_list_editor', arrayOf(bookletExport)],
  // ----- [Gate P6] データポータビリティ(FR-039)。保持期間の説明(エクスポート本体はファイルのため対象外)
  ['retention_info', retentionInfo],
  // ----- [Gate P7] What-if・旅程ブランチ(FR-019)。*_viewer は閲覧者から見た一覧
  ['branch_created_delay', branchDetail],
  ['branch_content_saved', branchDetail],
  ['branch_conflicted', branchDetail],
  ['branch_adopted', object({ branch: branchDetail, plan_revision: int })],
  ['branch_discarded', branchDetail],
  ['branch_deleted', revisionResult],
  ['branch_list', arrayOf(branch)],
  ['branch_list_viewer', arrayOf(branch)],
  // ----- [Gate P8] カレンダー(ICS)の取込(FR-036)。*_days は日程が無い日を作る指定のプレビュー
  ['calendar_import_preview', calendarImportPreview],
  ['calendar_import_preview_days', calendarImportPreview],
  ['calendar_import_applied', calendarImportResult],
  ['privacy_consents_default', consentState],
  ['privacy_consents_updated', consentState],
  ['account_deletion_preview', accountDeletionPreview],
  ['account_deletion_done', accountDeletionResult],
  // ----- [Gate P10] 外部状況(アラート)・安全な再計画(FR-030/031)。*_editor は編集者から見た一覧、*_stale は作成後に本案が変わった案
  ['alert_created', planAlert],
  ['alert_dismissed', planAlert],
  ['alert_list', alertList],
  ['alert_list_editor', alertList],
  ['replan_created', replan],
  ['replan_closure', replan],
  ['replan_rejected', replan],
  ['replan_weather_last_day', replan],
  ['replan_applied', replanApplyResult],
  ['replan_stale', replan],
  ['replan_stale_error', replanError],
  // ----- [Gate L4] 説明可能な最適化(FR-018)。*_none は今より良い候補が無い日、*_stale_error は入力の版が変わった適用
  ['optimization_candidates', optimizationCandidates],
  ['optimization_candidates_none', optimizationCandidates],
  ['optimization_applied', optimizationApplyResult],
  ['optimization_stale_error', object({ detail: object({ code: str, message: str }) })],
  // ----- [Gate P11] オフライン編集・同期(FR-033)。*_replayed は同じ操作の再送、*_mixed は競合・拒否を含む送信
  ['sync_applied', syncResponse],
  ['sync_replayed', syncResponse],
  ['sync_mixed', syncResponse],
  ['sync_conflicts', syncConflictList],
  ['sync_conflicts_empty', syncConflictList],
  ['sync_resolved_mine', syncResolveResult],
  ['sync_resolved_server', syncResolveResult],
  // [Gate P12] 写真・メモ・旅行記(FR-037)
  ['memory_note', travelMemory],
  ['memory_photo', travelMemory],
  ['memory_video', travelMemory],
  ['memory_updated', travelMemory],
  ['memory_list', memoryList],
  ['memory_list_member', memoryList],
  ['memory_list_empty', memoryList],
  ['journal_draft', journalDraft],
  ['journal_draft_all', journalDraft],
  ['journal_draft_empty', journalDraft],
  ['memory_error_event_not_found', object({ detail: object({ code: str, message: str }) })],
  // [Gate P13] 任意の位置軌跡(FR-038)
  ['location_tracks_no_consent', locationTrackList],
  ['location_tracks_empty', locationTrackList],
  ['location_tracks_active', locationTrackList],
  ['location_track_started', locationTrack],
  ['location_track_paused', locationTrack],
  ['location_track_stopped', locationTrack],
  ['location_track_detail', locationTrackDetail],
  ['location_points_uploaded', trackPointsUploadResult],
  ['location_points_deleted', trackPointsDeleteResult],
  ['location_track_error_consent', object({ detail: object({ code: str, message: str }) })],
  // [Gate P14] 旅の振り返り(FR-054・FR-053)
  ['journey_empty', journeyReview],
  ['journey_with_suggestions', journeyReview],
  ['journey_recorded', journeyReview],
  ['event_actual_visited', actualPutResult],
  ['event_actual_skipped', actualPutResult],
  ['event_carry_over', carryOverResult],
  ['event_carry_over_error_visited', object({ detail: object({ code: str, message: str }) })],
];

describe('実backend応答の契約 (Gate M9-FE-C2b-2)', () => {
  it('採取した全応答を対応するdecoderが受理する', () => {
    const fixtureKeys = Object.keys(fx).filter((k) => k !== '_meta').sort();
    expect(CASES.map(([k]) => k).sort()).toEqual(fixtureKeys);
    for (const [key, decoder] of CASES) {
      expect(() => decodeResponse(fx[key], decoder, key)).not.toThrow();
    }
  });

  it('decoderは値を変えず、decoder未宣言の項目(例: segment.route_option_id)も保持する', () => {
    expect(decodeResponse(fx.segment, travelSegment, 'segment')).toEqual(fx.segment);
    expect('route_option_id' in decodeResponse(fx.segment, travelSegment, 'segment')).toBe(true);
    expect(decodeResponse(fx.route_option, routeOption, 'route_option')).toEqual(fx.route_option);
  });

  it('列挙値がbackendの許容集合外なら拒否する', () => {
    expect(() => decodeResponse({ ...fx.segment, mode: 'teleport' }, travelSegment, 'x')).toThrow(/\$\.mode/);
    expect(() => decodeResponse({ ...fx.document, classification: 'secret' }, travelDocument, 'x')).toThrow(
      ApiDecodeError
    );
    expect(() => decodeResponse({ ...fx.ticket, share_policy: 'everyone' }, ticket, 'x')).toThrow(
      /\$\.share_policy/
    );
    const badLeg = { ...fx.route_option, legs: [{ ...fx.route_leg, realtime_status: 'late' }] };
    expect(() => decodeResponse(badLeg, routeOption, 'x')).toThrow(/\$\.legs\[0\]\.realtime_status/);
  });

  it('取込詳細の候補一覧も要素ごとに検証する', () => {
    const bad = { ...fx.import_job_detail, candidates: [{ ...fx.import_candidate, confidence: 'high' }] };
    expect(() => decodeResponse(bad, importJobDetail, 'x')).toThrow(/\$\.candidates\[0\]\.confidence/);
  });
});

function respondWith(data: unknown): void {
  const reply = async () => ({ data });
  const client: Partial<MinimalHttpClient> = {
    get: reply, post: reply, put: reply, patch: reply, delete: reply, request: reply,
  };
  api.setHttpClientForTesting(client);
}

describe('APIクライアント経由の検証 (Gate M9-FE-C2b-2)', () => {
  it('実応答はそのまま返り、形式不正は例外になる', async () => {
    respondWith(fx.reservation_list);
    await expect(api.getReservations('p')).resolves.toEqual(fx.reservation_list);
    respondWith(fx.reservation_updated);
    await expect(api.updateReservation('p', 'r', { notes: 'x' }, 1)).resolves.toEqual(fx.reservation_updated);
    respondWith([{ ...fx.reservation, has_pin: 'yes' }]);
    await expect(api.getReservations('p')).rejects.toThrow(/\$\[0\]\.has_pin/);

    respondWith(fx.ticket_list);
    await expect(api.getTickets('p', 'r')).resolves.toEqual(fx.ticket_list);
    respondWith(fx.segment_list);
    await expect(api.getSegments('p')).resolves.toEqual(fx.segment_list);
    respondWith(fx.route_adopt);
    await expect(api.adoptRouteOption('p', 'o', 1)).resolves.toEqual(fx.route_adopt);
    respondWith(fx.import_job_detail);
    await expect(api.getImportJob('p', 'j')).resolves.toEqual(fx.import_job_detail);
    respondWith(fx.document_list);
    await expect(api.getDocuments('p')).resolves.toEqual(fx.document_list);
    respondWith(fx.document_link_list);
    await expect(api.getDocumentLinks('p', 'd')).resolves.toEqual(fx.document_link_list);

    respondWith({ detail: 'not a list' });
    await expect(api.getDocuments('p')).rejects.toBeInstanceOf(ApiDecodeError);
  });
});
