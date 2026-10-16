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
 */
import { describe, it, expect } from 'vitest';
import * as apiModule from './api';

const EXPECTED_EXPORTS = [
  'ApiDecodeError', 'AuthApiError', 'acceptExtractionCandidate', 'acceptInvitation', 'addRouteLeg',
  'adoptBranch', 'adoptRouteOption', 'aiAPI', 'api', 'applyCalendarImport', 'applyOptimizationCandidate',
  'applyReplan', 'authAPI', 'confirmImportJob', 'createAlert', 'createBookletExport', 'createBranch',
  'createBudget', 'createComment', 'createConstraint', 'createExpense', 'createExtractionCandidate',
  'createImportJob', 'createPackingItem', 'createPoll', 'createPreparationTask', 'createReplan',
  'createReservation', 'createReservationEventLink', 'createReservationParticipant', 'createRouteOption',
  'createSegment', 'createSettlement', 'createShareLink', 'createSpot', 'createTicket', 'declineInvitation',
  'default', 'deleteAccount', 'deleteBranch', 'deleteBudget', 'deleteComment', 'deleteConstraint',
  'deleteDocument', 'deleteExpense', 'deletePackingItem', 'deletePoll', 'deletePreparationTask',
  'deleteReservation', 'deleteReservationEventLink', 'deleteReservationParticipant', 'deleteRouteLeg',
  'deleteRouteOption', 'deleteSegment', 'deleteSettlement', 'deleteShareLink', 'deleteTicket',
  'downloadAccountDataExport', 'downloadItineraryExport', 'downloadPlanDataExport',
  'extractApiErrorDetailMessage', 'getAccountDeletionPreview', 'getAlerts', 'getBookletExport',
  'getBookletExports', 'getBranch', 'getBranches', 'getBudgets', 'getCollaborators', 'getComments',
  'getConsents', 'getConstraints', 'getDeletedPlans', 'getDocument', 'getDocumentDownloadUrl',
  'getDocumentLinks', 'getDocuments', 'getExpenses', 'getFinanceSettings', 'getFinanceSummary',
  'getImportJob', 'getImportJobs', 'getOptimizationCandidates', 'getPackingItems', 'getPackingSuggestions',
  'getPlanMembers', 'getPolls', 'getPreparationTasks', 'getReadiness', 'getReplan', 'getReservation',
  'getReservationEventLinks', 'getReservationParticipants', 'getReservations', 'getRetentionInfo',
  'getRouteOption', 'getRouteOptions', 'getSegment', 'getSegments', 'getSettlements', 'getShareSettings',
  'getSpotCategories', 'getSpots', 'getTickets', 'getToday', 'getValidationRun', 'getValidationRuns',
  'inviteCollaborator', 'listMyInvitations', 'notificationsAPI', 'previewBooklet', 'previewCalendarImport',
  'purgePlan', 'putVotes', 'rejectExtractionCandidate', 'rejectImportJob', 'rejectReplan',
  'removeCollaborator', 'resolveDownloadUrl', 'resolvePublicShare', 'resolveVote', 'restorePlan',
  'revealReservation', 'revealTicket', 'revokeBookletExport', 'revokeShareLink', 'runValidation',
  'searchByImage', 'searchByVoice', 'searchSpots', 'shareAPI', 'testConnection', 'travelAPI', 'updateAlert',
  'updateBranch', 'updateBranchContent', 'updateBudget', 'updateComment', 'updateConsents',
  'updateConstraint', 'updateExpense', 'updateFinanceSettings', 'updatePackingItem', 'updatePoll',
  'updatePreparationTask', 'updateReservation', 'updateReservationEventLink', 'updateRouteLeg',
  'updateRouteOption', 'updateSegment', 'updateShareSettings', 'uploadDocument',
];

const EXPECTED_METHODS = [
  'acceptExtractionCandidate', 'acceptInvitation', 'addRouteLeg', 'adoptBranch', 'adoptCandidate',
  'adoptRouteOption', 'applyCalendarImport', 'applyOptimizationCandidate', 'applyOptimizationProposal',
  'applyReplan', 'changePassword', 'clearAccessToken', 'clearTokens', 'clonePlan', 'confirmImportJob',
  'createAlert', 'createBookletExport', 'createBranch', 'createBudget', 'createComment', 'createConstraint',
  'createDay', 'createEvent', 'createExpense', 'createExtractionCandidate', 'createImportJob',
  'createPackingItem', 'createPlan', 'createPoll', 'createPreparationTask', 'createReplan',
  'createReservation', 'createReservationEventLink', 'createReservationParticipant', 'createRouteOption',
  'createSegment', 'createSettlement', 'createShareLink', 'createSpot', 'createTicket', 'declineInvitation',
  'delete', 'deleteAccount', 'deleteBranch', 'deleteBudget', 'deleteComment', 'deleteConstraint', 'deleteDay',
  'deleteDocument', 'deleteEvent', 'deleteExpense', 'deletePackingItem', 'deletePlan', 'deletePoll',
  'deletePreparationTask', 'deleteReservation', 'deleteReservationEventLink', 'deleteReservationParticipant',
  'deleteRouteLeg', 'deleteRouteOption', 'deleteSegment', 'deleteSettlement', 'deleteShareLink',
  'deleteTicket', 'downloadAccountDataExport', 'downloadItineraryExport', 'downloadPlanDataExport', 'get',
  'getAccountDeletionPreview', 'getAlerts', 'getBookletExport', 'getBookletExports', 'getBranch',
  'getBranches', 'getBudgets', 'getCollaborators', 'getComments', 'getConsents', 'getConstraints',
  'getCurrentUser', 'getDeletedPlans', 'getDocument', 'getDocumentDownloadUrl', 'getDocumentLinks',
  'getDocuments', 'getExpenses', 'getFinanceSettings', 'getFinanceSummary', 'getImportJob', 'getImportJobs',
  'getInsertionPreview', 'getNotifications', 'getOptimizationCandidates', 'getOptimizationProposal',
  'getPackingItems', 'getPackingSuggestions', 'getPlace', 'getPlan', 'getPlanDetail', 'getPlanMembers',
  'getPlans', 'getPolls', 'getPreparationTasks', 'getReadiness', 'getReplan', 'getReservation',
  'getReservationEventLinks', 'getReservationParticipants', 'getReservations', 'getRetentionInfo',
  'getRouteOption', 'getRouteOptions', 'getRoutePreview', 'getSegment', 'getSegments', 'getSettlements',
  'getShareSettings', 'getSpotCategories', 'getSpots', 'getTickets', 'getToday', 'getUnreadNotificationCount',
  'getValidationRun', 'getValidationRuns', 'handleApiError', 'healthCheck', 'initializeTokens',
  'inviteCollaborator', 'listMyInvitations', 'login', 'logout', 'markAllNotificationsAsRead',
  'markNotificationAsRead', 'moveEvent', 'planFromApi', 'planToApi', 'post', 'previewBooklet',
  'previewCalendarImport', 'promoteQuickDraft', 'purgePlan', 'put', 'putVotes', 'register',
  'rejectExtractionCandidate', 'rejectImportJob', 'rejectReplan', 'removeCollaborator', 'resolvePublicShare',
  'resolveVote', 'restorePlan', 'revealReservation', 'revealTicket', 'revokeBookletExport', 'revokeShareLink',
  'runValidation', 'searchByImage', 'searchByVoice', 'searchSpots', 'setAccessToken', 'setGuestMode',
  'setHttpClientForTesting', 'setTokens', 'setupInterceptors', 'startGuestSession', 'testConnection',
  'undoLastPlanChange', 'updateAlert', 'updateBranch', 'updateBranchContent', 'updateBudget', 'updateComment',
  'updateConsents', 'updateConstraint', 'updateDay', 'updateEvent', 'updateExpense', 'updateFinanceSettings',
  'updatePackingItem', 'updatePlan', 'updatePoll', 'updatePreparationTask', 'updateProfile',
  'updateReservation', 'updateReservationEventLink', 'updateRouteLeg', 'updateRouteOption', 'updateSegment',
  'updateShareSettings', 'upgradeGuest', 'uploadDocument',
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
