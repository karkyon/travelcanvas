/**
 * [Gate M9-FE-C2a] services/api の公開面(export名・`api`インスタンスのメソッド集合・
 * 互換用グループオブジェクトのキー)が、単一ファイルapi.tsを分割する前と完全に同一で
 * あることを固定する契約テスト。期待値は分割前(HEAD 188dd19)の実測値。
 * APIを意図的に追加・削除した場合は、このリストも同じcommitで更新すること。
 * [Gate M9-FE-C2b] ApiDecodeError(応答形式の検証失敗)を公開exportへ追加。
 * [Gate A1] 認証の一本化でAuthApiError、startGuestSession/upgradeGuest(メソッド・authAPI)を追加。
 * [Gate L2] 制約(FR-016)のget/create/update/deleteConstraint(export・メソッド)を追加。
 * [Gate L3] 実行可能性検証(FR-017)のrunValidation/getValidationRuns/getValidationRun(export・メソッド)を追加。
 * [Gate B-012] 削除済みプランのgetDeletedPlans/restorePlan/purgePlan(export・メソッド)を追加。
 * [Gate P1] 持ち物・準備タスク・レディネス・メンバー一覧の12関数(export・メソッド)を追加。
 * [Gate P2] 予算・費用・精算の14関数(export・メソッド)を追加。
 * [Gate P3] 投票・回答・懸念の解決・コメントの10関数(export・メソッド)を追加。
 * [Gate P4] しおりのプレビュー・版の作成/一覧/表示/失効の5関数(export・メソッド)を追加。
 * [Gate P5] カレンダー・地図・CSVの書き出し1関数(export・メソッド)を追加。
 * [Gate P6] 保持期間の説明・旅行/アカウントのエクスポートの3関数(export・メソッド)を追加。
 * [Gate P7] 分岐案の一覧・作成・詳細・編集・変更・採用・削除の7関数(export・メソッド)を追加。
 * [Gate P8] カレンダー取込のプレビュー・適用の2関数(export・メソッド)を追加。
 * [Gate P9] 同意の取得・更新、アカウント削除の説明・実行の4関数(export・メソッド)を追加。
 * [Gate P10] アラートの一覧・登録・変更、再計画案の作成・取得・適用・却下の7関数(export・メソッド)を追加。
 * [Gate L4] 説明可能な最適化の候補の計算・適用の2関数(export・メソッド)を追加。
 * [Gate P11] オフライン同期の送信・競合の一覧・解決の3関数(export・メソッド)を追加。
 * [Gate P12] 写真・メモ・旅行記(FR-037)
 * [Gate P13] 任意の位置軌跡(FR-038)
 * [Gate P14] 旅の振り返り(FR-054・FR-053)
 * [Gate P15] Personal Travel Atlas(FR-052)
 * [Gate P17] Memory Replan(FR-057)
 * [Gate K1] オフラインパックの鍵(B-008): getOfflinePackKey/rotateOfflinePackKey(export・メソッド)
 * [Gate L5] 位置の扱い・訪問地域・記録の観測値の4関数(export・メソッド)
 * [Gate S11] 多要素認証(SEC-06)の7メソッド(getMfaStatus/setupMfa/enableMfa/disableMfa/regenerateRecoveryCodes/
 *   stepUpMfa/verifyMfaLogin)
 * [Gate C1] 共同編集・秘匿プロフィール(FR-020・FR-023)の6メソッド(postPresence/leavePresence/getPrivateProfile/
 *   putPrivateProfile/getPlanPrivateProfile/putPlanPrivateProfile。export・メソッド)
 * [Gate A2] 管理・監査(FR-040)の5メソッド(getAdminStats/getAdminUsers/getAdminUser/manageAdminUsers/getAuditLogs)
 * [Gate V2] 訪問の地図の層・判定・訂正(FR-049〜051)の4メソッド(getVisits/assessVisits/postDeviceVisitResults/
 *   correctVisit。export・メソッド)
 * [Gate C2] 候補箱・場所(FR-007・FR-008)の11メソッド(getCandidates/createCandidate/createCandidateFromSearch/
 *   updateCandidate/deleteCandidate/scheduleCandidate/mergeCandidate/getPlaceInfo/updatePlace/putOpeningHours/getPlanPlaces)
 * [Gate C3] 情報内検索(FR-009)の2メソッド(searchPlan/searchEverything)
 * [Gate B1] 組織・B2B・外部連携の管理(FR-041・FR-042)の25メソッド(api のメソッドだけ。個別の export は足さない)
 * [Gate F45] 項目単位の共有の規則(FR-045)の共有前プレビュー2メソッド(previewSharePolicy/previewShareLink。shareAPI にも追加)
 * [Gate G2] 即時の通知・同行者向けの項目の規則・サポート閲覧・運用の要約の12関数(export・メソッド)、
 *   外部連携の秘密・鍵の切り替えの4メソッド(api のメソッドだけ)、即時の通知が使う bearerHeader・応答の検証の g2(内部)
 */
import { describe, it, expect } from 'vitest';
import * as apiModule from './api';

const EXPECTED_EXPORTS = [
  'ApiDecodeError', 'AuthApiError', 'acceptExtractionCandidate', 'acceptInvitation', 'addRouteLeg', 'adoptBranch',
  'adoptRouteOption', 'aiAPI', 'api', 'applyCalendarImport', 'applyMemoryReplan', 'applyOptimizationCandidate',
  'applyReplan', 'assessVisits', 'authAPI', 'carryOverEvent', 'changeLocationTrack', 'confirmImportJob',
  'correctVisit', 'createAlert', 'createBookletExport', 'createBranch', 'createBudget', 'createCandidate',
  'createCandidateFromSearch', 'createComment', 'createConstraint', 'createExpense', 'createExtractionCandidate',
  'createImportJob', 'createJournalDraft', 'createMemory', 'createPackingItem', 'createPoll', 'createPreparationTask',
  'createReplan', 'createReservation', 'createReservationEventLink', 'createReservationParticipant',
  'createRouteOption', 'createSegment', 'createSettlement', 'createShareLink', 'createSpot', 'createSupportGrant',
  'createTicket', 'declineInvitation', 'default', 'deleteAccount', 'deleteBranch', 'deleteBudget', 'deleteCandidate',
  'deleteComment', 'deleteConstraint', 'deleteDocument', 'deleteEventActual', 'deleteExpense', 'deleteLocationTrack',
  'deleteMemory', 'deletePackingItem', 'deletePoll', 'deletePreparationTask', 'deleteReservation',
  'deleteReservationEventLink', 'deleteReservationParticipant', 'deleteRouteLeg', 'deleteRouteOption', 'deleteSegment',
  'deleteSettlement', 'deleteShareLink', 'deleteTicket', 'deleteTrackPoints', 'downloadAccountDataExport',
  'downloadItineraryExport', 'downloadPlanDataExport', 'extractApiErrorDetailMessage', 'getAccountDeletionPreview',
  'getAdminOperations', 'getAdminShareLinks', 'getAdminStats', 'getAdminSupportGrants', 'getAdminUser',
  'getAdminUsers', 'getAlerts', 'getAtlas', 'getAuditLogs', 'getBookletExport', 'getBookletExports', 'getBranch',
  'getBranches', 'getBudgets', 'getCandidates', 'getCollaborators', 'getComments', 'getConsents', 'getConstraints',
  'getDeletedPlans', 'getDocument', 'getDocumentDownloadUrl', 'getDocumentLinks', 'getDocuments', 'getExpenses',
  'getFinanceSettings', 'getFinanceSummary', 'getImportJob', 'getImportJobs', 'getJourney', 'getLocationSettings',
  'getLocationTrack', 'getLocationTracks', 'getMemberPolicy', 'getMemories', 'getMemoryMedia', 'getMemoryReplan',
  'getOfflinePackKey', 'getOptimizationCandidates', 'getPackingItems', 'getPackingSuggestions', 'getPlaceInfo',
  'getPlanMembers', 'getPlanPlaces', 'getPlanPrivateProfile', 'getPolls', 'getPreparationTasks', 'getPrivateProfile',
  'getReadiness', 'getReplan', 'getReservation', 'getReservationEventLinks', 'getReservationParticipants',
  'getReservations', 'getRetentionInfo', 'getRouteOption', 'getRouteOptions', 'getSegment', 'getSegments',
  'getSettlements', 'getShareSettings', 'getSpotCategories', 'getSpots', 'getSupportGrants', 'getSyncConflicts',
  'getTickets', 'getToday', 'getValidationRun', 'getValidationRuns', 'getVisits', 'inviteCollaborator',
  'leavePresence', 'listMyInvitations', 'manageAdminUsers', 'mergeCandidate', 'notificationsAPI',
  'postDeviceVisitResults', 'postPresence', 'previewBooklet', 'previewCalendarImport', 'previewShareLink',
  'previewSharePolicy', 'purgePlan', 'putEventActual', 'putLocationSettings', 'putMemberOverride', 'putMemberPolicy',
  'putOpeningHours', 'putPlanPrivateProfile', 'putPrivateProfile', 'putTrackSampling', 'putVotes',
  'rejectExtractionCandidate', 'rejectImportJob', 'rejectReplan', 'removeCollaborator', 'resolveDownloadUrl',
  'resolvePublicShare', 'resolveSyncConflict', 'resolveVote', 'restorePlan', 'revealReservation', 'revealTicket',
  'revokeAdminShareLink', 'revokeBookletExport', 'revokeShareLink', 'revokeSupportGrant', 'rotateOfflinePackKey',
  'runValidation', 'scheduleCandidate', 'searchByImage', 'searchByVoice', 'searchEverything', 'searchPlan',
  'searchSpots', 'shareAPI', 'startLocationTrack', 'streamPlanEvents', 'syncOperations', 'testConnection', 'travelAPI',
  'updateAlert', 'updateAtlasSettings', 'updateBranch', 'updateBranchContent', 'updateBudget', 'updateCandidate',
  'updateComment', 'updateConsents', 'updateConstraint', 'updateExpense', 'updateFinanceSettings', 'updateMemory',
  'updatePackingItem', 'updatePlace', 'updatePoll', 'updatePreparationTask', 'updateReservation',
  'updateReservationEventLink', 'updateRouteLeg', 'updateRouteOption', 'updateSegment', 'updateShareSettings',
  'uploadAreaCells', 'uploadDocument', 'uploadMemory', 'uploadTrackPoints', 'viewAdminSupportGrant',
];

const EXPECTED_METHODS = [
  'acceptExtractionCandidate', 'acceptInvitation', 'acknowledgeDistribution', 'addOrgMember', 'addRouteLeg',
  'adoptBranch', 'adoptCandidate', 'adoptRouteOption', 'applyCalendarImport', 'applyMemoryReplan',
  'applyOptimizationCandidate', 'applyOptimizationProposal', 'applyReplan', 'assessVisits', 'bearerHeader',
  'carryOverEvent', 'changeLocationTrack', 'changeOrgMemberRole', 'changePassword', 'clearAccessToken', 'clearTokens',
  'clonePlan', 'confirmImportJob', 'correctVisit', 'createAlert', 'createBookletExport', 'createBranch',
  'createBudget', 'createCandidate', 'createCandidateFromSearch', 'createComment', 'createConstraint', 'createDay',
  'createEvent', 'createExpense', 'createExtractionCandidate', 'createImportJob', 'createJournalDraft', 'createMemory',
  'createOrgApiClient', 'createOrgWebhook', 'createOrganization', 'createPackingItem', 'createPlan', 'createPoll',
  'createPreparationTask', 'createReplan', 'createReservation', 'createReservationEventLink',
  'createReservationParticipant', 'createRouteOption', 'createSegment', 'createSettlement', 'createShareLink',
  'createSpot', 'createSupportGrant', 'createTicket', 'declineInvitation', 'delete', 'deleteAccount', 'deleteBranch',
  'deleteBudget', 'deleteCandidate', 'deleteComment', 'deleteConstraint', 'deleteDay', 'deleteDocument', 'deleteEvent',
  'deleteEventActual', 'deleteExpense', 'deleteLocationTrack', 'deleteMemory', 'deletePackingItem', 'deletePlan',
  'deletePoll', 'deletePreparationTask', 'deleteReservation', 'deleteReservationEventLink',
  'deleteReservationParticipant', 'deleteRouteLeg', 'deleteRouteOption', 'deleteSegment', 'deleteSettlement',
  'deleteShareLink', 'deleteTicket', 'deleteTrackPoints', 'disableMfa', 'downloadAccountDataExport',
  'downloadItineraryExport', 'downloadPlanDataExport', 'enableMfa', 'forkDistribution', 'g2', 'get',
  'getAccountDeletionPreview', 'getAdminOperations', 'getAdminShareLinks', 'getAdminStats', 'getAdminSupportGrants',
  'getAdminUser', 'getAdminUsers', 'getAlerts', 'getAtlas', 'getAuditLogs', 'getBookletExport', 'getBookletExports',
  'getBranch', 'getBranches', 'getBudgets', 'getCandidates', 'getCollaborators', 'getComments', 'getConsents',
  'getConstraints', 'getCurrentUser', 'getDeletedPlans', 'getDistribution', 'getDistributionAcks', 'getDistributions',
  'getDocument', 'getDocumentDownloadUrl', 'getDocumentLinks', 'getDocuments', 'getExpenses', 'getFinanceSettings',
  'getFinanceSummary', 'getImportJob', 'getImportJobs', 'getInsertionPreview', 'getJourney', 'getLocationSettings',
  'getLocationTrack', 'getLocationTracks', 'getMemberPolicy', 'getMemories', 'getMemoryMedia', 'getMemoryReplan',
  'getMfaStatus', 'getNotifications', 'getOfflinePackKey', 'getOptimizationCandidates', 'getOptimizationProposal',
  'getOrgApiClients', 'getOrgMembers', 'getOrgWebhookDeliveries', 'getOrgWebhooks', 'getOrganization',
  'getOrganizations', 'getPackingItems', 'getPackingSuggestions', 'getPlace', 'getPlaceInfo', 'getPlan',
  'getPlanDetail', 'getPlanMembers', 'getPlanPlaces', 'getPlanPrivateProfile', 'getPlans', 'getPolls',
  'getPreparationTasks', 'getPrivateProfile', 'getReadiness', 'getReplan', 'getReservation',
  'getReservationEventLinks', 'getReservationParticipants', 'getReservations', 'getRetentionInfo', 'getRouteOption',
  'getRouteOptions', 'getRoutePreview', 'getSegment', 'getSegments', 'getSessions', 'getSettlements',
  'getShareSettings', 'getSpotCategories', 'getSpots', 'getSupportGrants', 'getSyncConflicts', 'getTickets',
  'getToday', 'getUnreadNotificationCount', 'getValidationRun', 'getValidationRuns', 'getVisits', 'handleApiError',
  'hasAccessToken', 'healthCheck', 'initializeTokens', 'inviteCollaborator', 'leavePresence', 'listMyInvitations',
  'login', 'logout', 'manageAdminUsers', 'markAllNotificationsAsRead', 'markNotificationAsRead', 'mergeCandidate',
  'moveEvent', 'pingOrgWebhook', 'planFromApi', 'planToApi', 'post', 'postDeviceVisitResults', 'postPresence',
  'previewBooklet', 'previewCalendarImport', 'previewShareLink', 'previewSharePolicy', 'promoteQuickDraft',
  'publishDistribution', 'purgePlan', 'put', 'putEventActual', 'putLocationSettings', 'putMemberOverride',
  'putMemberPolicy', 'putOpeningHours', 'putPlanPrivateProfile', 'putPrivateProfile', 'putTrackSampling', 'putVotes',
  'redeliverOrgWebhook', 'refreshSession', 'regenerateRecoveryCodes', 'register', 'rejectExtractionCandidate',
  'rejectImportJob', 'rejectReplan', 'removeCollaborator', 'removeOrgMember', 'resolvePublicShare',
  'resolveSyncConflict', 'resolveVote', 'restorePlan', 'retireOrgApiClientPrevious', 'retireOrgWebhookPrevious',
  'revealReservation', 'revealTicket', 'reviseDistribution', 'revokeAdminShareLink', 'revokeBookletExport',
  'revokeDistribution', 'revokeOrgApiClient', 'revokeOrgWebhook', 'revokeSession', 'revokeShareLink',
  'revokeSupportGrant', 'rotateOfflinePackKey', 'rotateOrgApiClientSecret', 'rotateOrgWebhookSecret', 'runValidation',
  'scheduleCandidate', 'searchByImage', 'searchByVoice', 'searchEverything', 'searchPlan', 'searchSpots',
  'setAccessToken', 'setGuestMode', 'setHttpClientForTesting', 'setMemberSession', 'setTokens', 'setupInterceptors',
  'setupMfa', 'startGuestSession', 'startLocationTrack', 'stepUpMfa',
  'streamPlanEvents', 'suppressAuthRedirect', 'syncOperations',
  'testConnection', 'undoLastPlanChange', 'updateAlert', 'updateAtlasSettings', 'updateBranch', 'updateBranchContent',
  'updateBudget', 'updateCandidate', 'updateComment', 'updateConsents', 'updateConstraint', 'updateDay', 'updateEvent',
  'updateExpense', 'updateFinanceSettings', 'updateMemory', 'updateOrganization', 'updatePackingItem', 'updatePlace',
  'updatePlan', 'updatePoll', 'updatePreparationTask', 'updateProfile', 'updateReservation',
  'updateReservationEventLink', 'updateRouteLeg', 'updateRouteOption', 'updateSegment', 'updateShareSettings',
  'upgradeGuest', 'uploadAreaCells', 'uploadDocument', 'uploadMemory', 'uploadTrackPoints', 'verifyMfaLogin',
  'viewAdminSupportGrant',
];

const EXPECTED_GROUP_KEYS: Record<string, string[]> = {
  authAPI: [
    'changePassword', 'getCurrentUser', 'login', 'logout', 'register', 'startGuestSession',
    'updateProfile', 'upgradeGuest',
  ],
  travelAPI: [
    'clonePlan', 'createPlan', 'createSpot', 'deletePlan', 'getPlan', 'getPlans',
    'getSpotCategories', 'getSpots', 'promoteQuickDraft', 'searchSpots', 'testConnection',
    'updatePlan',
  ],
  aiAPI: [
    'searchByImage', 'searchByVoice', 'searchSpots',
  ],
  notificationsAPI: [
    'getNotifications', 'getUnreadCount', 'markAllAsRead', 'markAsRead',
  ],
  shareAPI: [
    'acceptInvitation', 'createShareLink', 'declineInvitation', 'deleteShareLink',
    'getCollaborators', 'getShareSettings', 'inviteCollaborator', 'listMyInvitations',
    'previewShareLink', 'previewSharePolicy',
    'removeCollaborator', 'resolvePublicShare', 'revokeShareLink', 'updateShareSettings',
  ],
};

function collectMethods(instance: object): string[] {
  const names = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor') names.add(key);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names].sort();
}

describe('services/api 公開面 (Gate M9-FE-C2a)', () => {
  it('export名の集合が分割前と同一', () => {
    expect(Object.keys(apiModule).sort()).toEqual(EXPECTED_EXPORTS);
  });

  it('apiインスタンスのメソッド集合が分割前と同一', () => {
    expect(collectMethods(apiModule.api)).toEqual(EXPECTED_METHODS);
  });

  it('default exportはapiインスタンスそのもの', () => {
    expect(apiModule.default).toBe(apiModule.api);
  });

  it('互換用グループオブジェクトのキーが分割前と同一', () => {
    const modRecord = apiModule as unknown as Record<string, Record<string, unknown>>;
    for (const [group, keys] of Object.entries(EXPECTED_GROUP_KEYS)) {
      expect(Object.keys(modRecord[group]!).sort()).toEqual(keys);
    }
  });
});
