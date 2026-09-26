/**
 * services/api 公開ファサード。
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 * 既存の import パス(`@/services/api` / `../services/api`)・export名・`api`インスタンスの
 * メソッド集合は分割前と同一(services/api.surface.test.ts で固定)。
 */
import { CompleteTravelAPI } from './client';
import { API_BASE_URL } from './core';
import type { TravelPlan, User } from '@/types';
import type { ConstraintCreateData, ConstraintUpdateData, CreateSpotData, DocumentClassification, ExtractionCandidateCreateData, ImportJobCreateData, GuestUpgradeData, LoginCredentials, RegisterData, ReservationCreateData, ReservationEventLinkCreateData, ReservationEventLinkUpdateData, ReservationUpdateData, RouteLegCreateData, RouteLegUpdateData, RouteOptionCreateData, RouteOptionUpdateData, SearchRequest, SegmentCreateData, SegmentUpdateData, TicketCreateData, VoiceSearchRequestData } from './types';

export * from './types';
export { extractApiErrorDetailMessage } from './core';
// [Gate M9-FE-C2b] 応答形式の検証失敗を呼び出し元で判定できるよう公開する。
export { ApiDecodeError } from './decode';
// [Gate A1] 認証API(login/register/guest)の失敗。authStoreが画面表示用の文言として使う。
export { AuthApiError } from './endpoints/auth';

// ===== シングルトンインスタンス =====
export const api = new CompleteTravelAPI();

// ===== 個別APIオブジェクトのエクスポート =====
export const authAPI = {
  register: (data: RegisterData) => api.register(data),
  login: (credentials: LoginCredentials) => api.login(credentials),
  logout: () => api.logout(),
  // [Gate A1] ゲスト開始・昇格もAPIクライアント経由に一本化した(以前はauthStoreの独自fetch)
  startGuestSession: () => api.startGuestSession(),
  upgradeGuest: (data: GuestUpgradeData, guestToken: string) => api.upgradeGuest(data, guestToken),
  getCurrentUser: () => api.getCurrentUser(),
  updateProfile: (data: Partial<User>) => api.updateProfile(data),
  changePassword: (data: { current_password: string; new_password: string }) => api.changePassword(data),
  // [Gate #27 / A-009] deleteAccountは対応するbackend routeが存在しないため削除。
  // 実装はGate #28で行う。
};

export const travelAPI = {
  getPlans: () => api.getPlans(),
  createPlan: (data: Partial<TravelPlan>) => api.createPlan(data),
  getPlan: (id: string) => api.getPlan(id),
  updatePlan: (id: string, data: Partial<TravelPlan>) => api.updatePlan(id, data),
  deletePlan: (id: string) => api.deletePlan(id),
  clonePlan: (id: string, data?: { title?: string; start_date?: string }) => api.clonePlan(id, data),
  promoteQuickDraft: (
    draftId: string,
    deviceToken: string,
    idempotencyKey: string,
    opts?: { target_plan_id?: string; base_revision?: number },
  ) => api.promoteQuickDraft(draftId, deviceToken, idempotencyKey, opts),
  searchSpots: (request: SearchRequest) => api.searchSpots(request),
  getSpots: (category?: string, limit?: number) => api.getSpots(category, limit),
  createSpot: (data: CreateSpotData) => api.createSpot(data),
  getSpotCategories: () => api.getSpotCategories(),
  testConnection: () => api.testConnection()
};

export const aiAPI = {
  searchSpots: (request: SearchRequest) => api.searchSpots(request),
  searchByImage: (file: File, location?: { latitude: number; longitude: number }) => api.searchByImage(file, location),
  searchByVoice: (blob: Blob, data: VoiceSearchRequestData) => api.searchByVoice(blob, data)
};

export const notificationsAPI = {
  getNotifications: (unreadOnly?: boolean) => api.getNotifications(unreadOnly),
  getUnreadCount: () => api.getUnreadNotificationCount(),
  markAsRead: (id: string) => api.markNotificationAsRead(id),
  markAllAsRead: () => api.markAllNotificationsAsRead(),
};

// [Gate #27 / A-009] settingsAPI(通知設定/プライバシー設定/データエクスポート)は
// 対応するbackend routeが存在しないまま公開されていたため削除した。
// 実装はGate #28で行う。

export const shareAPI = {
  createShareLink: (planId: string, shareData: { permission: 'view' | 'edit'; expires_at?: string; passcode?: string; max_uses?: number }) =>
    api.createShareLink(planId, shareData),
  getShareSettings: (planId: string) => api.getShareSettings(planId),
  updateShareSettings: (planId: string, shareId: string, data: { permission?: 'view' | 'edit'; expires_at?: string; passcode?: string | null; max_uses?: number | null }) =>
    api.updateShareSettings(planId, shareId, data),
  revokeShareLink: (planId: string, shareId: string) => api.revokeShareLink(planId, shareId),
  deleteShareLink: (planId: string, shareId: string) => api.deleteShareLink(planId, shareId),
  listMyInvitations: () => api.listMyInvitations(),
  acceptInvitation: (collaboratorId: string) => api.acceptInvitation(collaboratorId),
  declineInvitation: (collaboratorId: string) => api.declineInvitation(collaboratorId),
  resolvePublicShare: (token: string, passcode?: string) => api.resolvePublicShare(token, passcode),
  inviteCollaborator: (planId: string, inviteData: { email: string; role: 'viewer' | 'editor'; message?: string }) => 
    api.inviteCollaborator(planId, inviteData),
  getCollaborators: (planId: string) => api.getCollaborators(planId),
  removeCollaborator: (planId: string, collaboratorId: string) => api.removeCollaborator(planId, collaboratorId)
};

// ===== 便利な関数のエクスポート =====
export const searchSpots = (request: SearchRequest) => api.searchSpots(request);
export const searchByImage = (file: File, location?: { latitude: number; longitude: number }) => api.searchByImage(file, location);
export const searchByVoice = (blob: Blob, data: VoiceSearchRequestData) => api.searchByVoice(blob, data);

export const getSpots = (category?: string, limit?: number) => api.getSpots(category, limit);
export const createSpot = (data: CreateSpotData) => api.createSpot(data);
export const getSpotCategories = () => api.getSpotCategories();
export const testConnection = () => api.testConnection();

export const createShareLink = (planId: string, shareData: { permission: 'view' | 'edit'; expires_at?: string; passcode?: string; max_uses?: number }) =>
  api.createShareLink(planId, shareData);
export const getShareSettings = (planId: string) => api.getShareSettings(planId);
export const updateShareSettings = (planId: string, shareId: string, data: { permission?: 'view' | 'edit'; expires_at?: string; passcode?: string | null; max_uses?: number | null }) =>
  api.updateShareSettings(planId, shareId, data);
export const revokeShareLink = (planId: string, shareId: string) => api.revokeShareLink(planId, shareId);
export const deleteShareLink = (planId: string, shareId: string) => api.deleteShareLink(planId, shareId);
export const listMyInvitations = () => api.listMyInvitations();
export const acceptInvitation = (collaboratorId: string) => api.acceptInvitation(collaboratorId);
export const declineInvitation = (collaboratorId: string) => api.declineInvitation(collaboratorId);
export const resolvePublicShare = (token: string, passcode?: string) => api.resolvePublicShare(token, passcode);
export const inviteCollaborator = (planId: string, inviteData: { email: string; role: 'viewer' | 'editor'; message?: string }) => 
  api.inviteCollaborator(planId, inviteData);
export const getCollaborators = (planId: string) => api.getCollaborators(planId);
export const removeCollaborator = (planId: string, collaboratorId: string) => api.removeCollaborator(planId, collaboratorId);

// ===== [Gate R3-2] 予約管理(FR-010) =====
export const getReservations = (planId: string) => api.getReservations(planId);
export const getReservation = (planId: string, reservationId: string) => api.getReservation(planId, reservationId);
export const createReservation = (planId: string, data: ReservationCreateData) => api.createReservation(planId, data);
export const updateReservation = (planId: string, reservationId: string, data: ReservationUpdateData, ifMatch: number) =>
  api.updateReservation(planId, reservationId, data, ifMatch);
export const deleteReservation = (planId: string, reservationId: string, ifMatch: number) =>
  api.deleteReservation(planId, reservationId, ifMatch);
export const revealReservation = (planId: string, reservationId: string) => api.revealReservation(planId, reservationId);
export const getReservationParticipants = (planId: string, reservationId: string) =>
  api.getReservationParticipants(planId, reservationId);
export const createReservationParticipant = (
  planId: string, reservationId: string,
  data: { name: string; seat?: string; special_request?: string; plan_member_id?: string }
) => api.createReservationParticipant(planId, reservationId, data);
export const deleteReservationParticipant = (planId: string, reservationId: string, participantId: string) =>
  api.deleteReservationParticipant(planId, reservationId, participantId);

// [Gate R3-3] event_reservations中間表(複数イベント紐付け)
export const getReservationEventLinks = (planId: string, reservationId: string) =>
  api.getReservationEventLinks(planId, reservationId);
export const createReservationEventLink = (planId: string, reservationId: string, data: ReservationEventLinkCreateData) =>
  api.createReservationEventLink(planId, reservationId, data);
export const updateReservationEventLink = (
  planId: string, reservationId: string, linkId: string, data: ReservationEventLinkUpdateData
) => api.updateReservationEventLink(planId, reservationId, linkId, data);
export const deleteReservationEventLink = (planId: string, reservationId: string, linkId: string) =>
  api.deleteReservationEventLink(planId, reservationId, linkId);

// [Gate M2] FR-014移動区間(TravelSegment)
export const getSegments = (planId: string) => api.getSegments(planId);
export const getSegment = (planId: string, segmentId: string) => api.getSegment(planId, segmentId);
export const createSegment = (planId: string, data: SegmentCreateData, idempotencyKey: string) =>
  api.createSegment(planId, data, idempotencyKey);
export const updateSegment = (planId: string, segmentId: string, data: SegmentUpdateData, ifMatch: number) =>
  api.updateSegment(planId, segmentId, data, ifMatch);
export const deleteSegment = (planId: string, segmentId: string, ifMatch: number) =>
  api.deleteSegment(planId, segmentId, ifMatch);

// [Gate M4] FR-015複数経路比較(RouteOption/RouteLeg)
export const getRouteOptions = (planId: string) => api.getRouteOptions(planId);
export const getRouteOption = (planId: string, optionId: string) => api.getRouteOption(planId, optionId);
export const createRouteOption = (planId: string, data: RouteOptionCreateData, idempotencyKey: string) =>
  api.createRouteOption(planId, data, idempotencyKey);
export const updateRouteOption = (
  planId: string, optionId: string, data: RouteOptionUpdateData, ifMatch: number
) => api.updateRouteOption(planId, optionId, data, ifMatch);
export const deleteRouteOption = (planId: string, optionId: string, ifMatch: number) =>
  api.deleteRouteOption(planId, optionId, ifMatch);
export const addRouteLeg = (planId: string, optionId: string, data: RouteLegCreateData, ifMatch: number) =>
  api.addRouteLeg(planId, optionId, data, ifMatch);
export const updateRouteLeg = (
  planId: string, optionId: string, legId: string, data: RouteLegUpdateData, ifMatch: number
) => api.updateRouteLeg(planId, optionId, legId, data, ifMatch);
export const deleteRouteLeg = (planId: string, optionId: string, legId: string, ifMatch: number) =>
  api.deleteRouteLeg(planId, optionId, legId, ifMatch);
export const adoptRouteOption = (planId: string, optionId: string, ifMatch: number) =>
  api.adoptRouteOption(planId, optionId, ifMatch);

// [Gate R3-9] FR-011予約取込(import_jobs/extraction_candidates)
export const getImportJobs = (planId: string) => api.getImportJobs(planId);
export const getImportJob = (planId: string, jobId: string) => api.getImportJob(planId, jobId);
export const createImportJob = (planId: string, data: ImportJobCreateData) => api.createImportJob(planId, data);
export const createExtractionCandidate = (planId: string, jobId: string, data: ExtractionCandidateCreateData) =>
  api.createExtractionCandidate(planId, jobId, data);
export const acceptExtractionCandidate = (planId: string, jobId: string, candidateId: string) =>
  api.acceptExtractionCandidate(planId, jobId, candidateId);
export const rejectExtractionCandidate = (planId: string, jobId: string, candidateId: string) =>
  api.rejectExtractionCandidate(planId, jobId, candidateId);
export const confirmImportJob = (planId: string, jobId: string) => api.confirmImportJob(planId, jobId);
export const rejectImportJob = (planId: string, jobId: string) => api.rejectImportJob(planId, jobId);

// [Gate R3-10] FR-013文書ウォレット(documents/document_links)
// [Gate L1] FR-029当日モード(NOW/NEXT)
export const getToday = (planId: string) => api.getToday(planId);

export const getDocuments = (planId: string) => api.getDocuments(planId);
export const getDocument = (planId: string, documentId: string) => api.getDocument(planId, documentId);
export const deleteDocument = (planId: string, documentId: string, ifMatch: number) =>
  api.deleteDocument(planId, documentId, ifMatch);
export const getDocumentLinks = (planId: string, documentId: string) => api.getDocumentLinks(planId, documentId);

// [Gate M6] FR-013 Object Storage実連携(Gate M5)接続
export const uploadDocument = (
  planId: string, file: File, classification: DocumentClassification, documentType?: string
) => api.uploadDocument(planId, file, classification, documentType);
export const getDocumentDownloadUrl = (planId: string, documentId: string) =>
  api.getDocumentDownloadUrl(planId, documentId);

// [Gate M6] download-urlが返す`url`はbackendのAPI root("/api/v1"含む)から
// の絶対パスであり、frontendのAPI_BASE_URL(常に"/api/v1"で終わる)とは
// オリジンのみ共有すればよい。オリジン部分を導出して結合する。
export function resolveDownloadUrl(relativeUrl: string): string {
  const origin = API_BASE_URL.replace(/\/api\/v1$/, '');
  return `${origin}${relativeUrl}`;
}

// [Gate R3-11] FR-012 QR・チケット(tickets)
export const getTickets = (planId: string, reservationId: string) => api.getTickets(planId, reservationId);
export const createTicket = (planId: string, reservationId: string, data: TicketCreateData) =>
  api.createTicket(planId, reservationId, data);
export const deleteTicket = (planId: string, reservationId: string, ticketId: string, ifMatch: number) =>
  api.deleteTicket(planId, reservationId, ticketId, ifMatch);
export const revealTicket = (planId: string, reservationId: string, ticketId: string) =>
  api.revealTicket(planId, reservationId, ticketId);

// ===== [Gate L2] 制約(FR-016) =====
export const getConstraints = (planId: string) => api.getConstraints(planId);
export const createConstraint = (planId: string, data: ConstraintCreateData) => api.createConstraint(planId, data);
export const updateConstraint = (planId: string, constraintId: string, data: ConstraintUpdateData, ifMatch: number) =>
  api.updateConstraint(planId, constraintId, data, ifMatch);
export const deleteConstraint = (planId: string, constraintId: string, ifMatch: number) =>
  api.deleteConstraint(planId, constraintId, ifMatch);

export default api;
