/**
 * [Gate M9-FE-C2a] services/api の公開面(export名・`api`インスタンスのメソッド集合・
 * 互換用グループオブジェクトのキー)が、単一ファイルapi.tsを分割する前と完全に同一で
 * あることを固定する契約テスト。期待値は分割前(HEAD 188dd19)の実測値。
 * APIを意図的に追加・削除した場合は、このリストも同じcommitで更新すること。
 * [Gate M9-FE-C2b] ApiDecodeError(応答形式の検証失敗)を公開exportへ追加。
 * [Gate A1] 認証の一本化でAuthApiError、startGuestSession/upgradeGuest(メソッド・authAPI)を追加。
 * [Gate L2] 制約(FR-016)のget/create/update/deleteConstraint(export・メソッド)を追加。
 * [Gate L3] 実行可能性検証(FR-017)のrunValidation/getValidationRuns/getValidationRun(export・メソッド)を追加。
 */
import { describe, it, expect } from 'vitest';
import * as apiModule from './api';

const EXPECTED_EXPORTS = [
  'ApiDecodeError', 'AuthApiError', 'acceptExtractionCandidate', 'acceptInvitation', 'addRouteLeg',
  'adoptRouteOption', 'aiAPI', 'api', 'authAPI', 'confirmImportJob', 'createConstraint', 'createExtractionCandidate',
  'createImportJob', 'createReservation', 'createReservationEventLink',
  'createReservationParticipant', 'createRouteOption', 'createSegment', 'createShareLink',
  'createSpot', 'createTicket', 'declineInvitation', 'default', 'deleteConstraint', 'deleteDocument',
  'deleteReservation', 'deleteReservationEventLink', 'deleteReservationParticipant',
  'deleteRouteLeg', 'deleteRouteOption', 'deleteSegment', 'deleteShareLink', 'deleteTicket',
  'extractApiErrorDetailMessage', 'getCollaborators', 'getConstraints', 'getDocument', 'getDocumentDownloadUrl',
  'getDocumentLinks', 'getDocuments', 'getImportJob', 'getImportJobs', 'getReservation',
  'getReservationEventLinks', 'getReservationParticipants', 'getReservations', 'getRouteOption',
  'getRouteOptions', 'getSegment', 'getSegments', 'getShareSettings', 'getSpotCategories',
  'getSpots', 'getTickets', 'getToday', 'getValidationRun', 'getValidationRuns', 'inviteCollaborator', 'listMyInvitations',
  'notificationsAPI', 'rejectExtractionCandidate', 'rejectImportJob', 'removeCollaborator',
  'resolveDownloadUrl', 'resolvePublicShare', 'revealReservation', 'revealTicket',
  'revokeShareLink', 'runValidation', 'searchByImage', 'searchByVoice', 'searchSpots', 'shareAPI', 'testConnection',
  'travelAPI', 'updateConstraint', 'updateReservation', 'updateReservationEventLink', 'updateRouteLeg',
  'updateRouteOption', 'updateSegment', 'updateShareSettings', 'uploadDocument',
];

const EXPECTED_METHODS = [
  'acceptExtractionCandidate', 'acceptInvitation', 'addRouteLeg', 'adoptCandidate',
  'adoptRouteOption', 'applyOptimizationProposal', 'changePassword', 'clearAccessToken',
  'clearTokens', 'clonePlan', 'confirmImportJob', 'createConstraint', 'createDay', 'createEvent',
  'createExtractionCandidate', 'createImportJob', 'createPlan', 'createReservation',
  'createReservationEventLink', 'createReservationParticipant', 'createRouteOption',
  'createSegment', 'createShareLink', 'createSpot', 'createTicket', 'declineInvitation', 'delete',
  'deleteConstraint', 'deleteDay', 'deleteDocument', 'deleteEvent', 'deletePlan', 'deleteReservation',
  'deleteReservationEventLink', 'deleteReservationParticipant', 'deleteRouteLeg',
  'deleteRouteOption', 'deleteSegment', 'deleteShareLink', 'deleteTicket', 'get',
  'getCollaborators', 'getConstraints', 'getCurrentUser', 'getDocument', 'getDocumentDownloadUrl',
  'getDocumentLinks', 'getDocuments', 'getImportJob', 'getImportJobs', 'getInsertionPreview',
  'getNotifications', 'getOptimizationProposal', 'getPlace', 'getPlan', 'getPlanDetail',
  'getPlans', 'getReservation', 'getReservationEventLinks', 'getReservationParticipants',
  'getReservations', 'getRouteOption', 'getRouteOptions', 'getRoutePreview', 'getSegment',
  'getSegments', 'getShareSettings', 'getSpotCategories', 'getSpots', 'getTickets', 'getToday',
  'getUnreadNotificationCount', 'getValidationRun', 'getValidationRuns', 'handleApiError', 'healthCheck', 'initializeTokens',
  'inviteCollaborator', 'listMyInvitations', 'login', 'logout', 'markAllNotificationsAsRead',
  'markNotificationAsRead', 'moveEvent', 'planFromApi', 'planToApi', 'post', 'promoteQuickDraft',
  'put', 'register', 'rejectExtractionCandidate', 'rejectImportJob', 'removeCollaborator',
  'resolvePublicShare', 'revealReservation', 'revealTicket', 'revokeShareLink', 'runValidation', 'searchByImage',
  'searchByVoice', 'searchSpots', 'setAccessToken', 'setGuestMode', 'setHttpClientForTesting',
  'setTokens', 'setupInterceptors', 'startGuestSession', 'testConnection', 'undoLastPlanChange', 'updateConstraint',
  'updateDay',
  'updateEvent', 'updatePlan', 'updateProfile', 'updateReservation', 'updateReservationEventLink',
  'updateRouteLeg', 'updateRouteOption', 'updateSegment', 'updateShareSettings', 'upgradeGuest',
  'uploadDocument',
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
