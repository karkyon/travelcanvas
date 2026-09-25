/**
 * 予約・参加者・イベント紐付け(FR-010)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { PlansApi } from './plans';
import type { Reservation, ReservationCreateData, ReservationEventLink, ReservationEventLinkCreateData, ReservationEventLinkUpdateData, ReservationParticipant, ReservationRevealResult, ReservationUpdateData } from '../types';
import { decodeResponse } from '../decode';
import { reservationRevealResult } from '../decoders';

export class ReservationsApi extends PlansApi {
  // backend/app/api/v1/reservations.py (Gate R3-0/R3-1)。/plans/{planId}/...
  // 配下のdays/eventsと同じ「response.data直返し」パターンに揃える。

  async getReservations(planId: string): Promise<Reservation[]> {
    const response = await this.client.get<Reservation[]>(`/plans/${planId}/reservations`);
    return response.data;
  }

  async getReservation(planId: string, reservationId: string): Promise<Reservation> {
    const response = await this.client.get<Reservation>(`/plans/${planId}/reservations/${reservationId}`);
    return response.data;
  }

  async createReservation(planId: string, data: ReservationCreateData): Promise<Reservation> {
    const response = await this.client.post<Reservation>(`/plans/${planId}/reservations`, data);
    return response.data;
  }

  async updateReservation(
    planId: string, reservationId: string, data: ReservationUpdateData, ifMatch: number
  ): Promise<Reservation> {
    const response = await this.client.request<Reservation>({
      method: 'PATCH',
      url: `/plans/${planId}/reservations/${reservationId}`,
      data,
      headers: { 'If-Match': String(ifMatch) },
    });
    return response.data;
  }

  async deleteReservation(planId: string, reservationId: string, ifMatch: number): Promise<void> {
    await this.client.delete(`/plans/${planId}/reservations/${reservationId}`, {
      headers: { 'If-Match': String(ifMatch) },
    });
  }

  async revealReservation(planId: string, reservationId: string): Promise<ReservationRevealResult> {
    const response = await this.client.post(
      `/plans/${planId}/reservations/${reservationId}/reveal`, {}
    );
    return decodeResponse(response.data, reservationRevealResult, 'POST /plans/{plan_id}/reservations/{reservation_id}/reveal');
  }

  async getReservationParticipants(planId: string, reservationId: string): Promise<ReservationParticipant[]> {
    const response = await this.client.get<ReservationParticipant[]>(
      `/plans/${planId}/reservations/${reservationId}/participants`
    );
    return response.data;
  }

  async createReservationParticipant(
    planId: string, reservationId: string,
    data: { name: string; seat?: string; special_request?: string; plan_member_id?: string }
  ): Promise<ReservationParticipant> {
    const response = await this.client.post<ReservationParticipant>(
      `/plans/${planId}/reservations/${reservationId}/participants`, data
    );
    return response.data;
  }

  async deleteReservationParticipant(
    planId: string, reservationId: string, participantId: string
  ): Promise<void> {
    await this.client.delete(
      `/plans/${planId}/reservations/${reservationId}/participants/${participantId}`
    );
  }

  // [Gate R3-3] event_reservations中間表(複数イベント紐付け)
  async getReservationEventLinks(planId: string, reservationId: string): Promise<ReservationEventLink[]> {
    const response = await this.client.get<ReservationEventLink[]>(
      `/plans/${planId}/reservations/${reservationId}/events`
    );
    return response.data;
  }

  async createReservationEventLink(
    planId: string, reservationId: string, data: ReservationEventLinkCreateData
  ): Promise<ReservationEventLink> {
    const response = await this.client.post<ReservationEventLink>(
      `/plans/${planId}/reservations/${reservationId}/events`, data
    );
    return response.data;
  }

  async updateReservationEventLink(
    planId: string, reservationId: string, linkId: string, data: ReservationEventLinkUpdateData
  ): Promise<ReservationEventLink> {
    const response = await this.client.patch<ReservationEventLink>(
      `/plans/${planId}/reservations/${reservationId}/events/${linkId}`, data
    );
    return response.data;
  }

  async deleteReservationEventLink(planId: string, reservationId: string, linkId: string): Promise<void> {
    await this.client.delete(`/plans/${planId}/reservations/${reservationId}/events/${linkId}`);
  }
}
