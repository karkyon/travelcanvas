/**
 * 予約・参加者・イベント紐付け(FR-010)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { PlansApi } from './plans';
import type { Reservation, ReservationCreateData, ReservationEventLink, ReservationEventLinkCreateData, ReservationEventLinkUpdateData, ReservationParticipant, ReservationRevealResult, ReservationUpdateData } from '../types';
import { arrayOf, decodeResponse } from '../decode';
import { reservation, reservationEventLink, reservationParticipant, reservationRevealResult } from '../decoders';

export class ReservationsApi extends PlansApi {
  // backend/app/api/v1/reservations.py (Gate R3-0/R3-1)。/plans/{planId}/...
  // 配下のdays/eventsと同じ「response.data直返し」パターンに揃える。

  async getReservations(planId: string): Promise<Reservation[]> {
    const response = await this.client.get(`/plans/${planId}/reservations`);
    return decodeResponse(response.data, arrayOf(reservation), 'GET /plans/{plan_id}/reservations');
  }

  async getReservation(planId: string, reservationId: string): Promise<Reservation> {
    const response = await this.client.get(`/plans/${planId}/reservations/${reservationId}`);
    return decodeResponse(response.data, reservation, 'GET /plans/{plan_id}/reservations/{reservation_id}');
  }

  async createReservation(planId: string, data: ReservationCreateData): Promise<Reservation> {
    const response = await this.client.post(`/plans/${planId}/reservations`, data);
    return decodeResponse(response.data, reservation, 'POST /plans/{plan_id}/reservations');
  }

  async updateReservation(
    planId: string, reservationId: string, data: ReservationUpdateData, ifMatch: number
  ): Promise<Reservation> {
    const response = await this.client.request({
      method: 'PATCH',
      url: `/plans/${planId}/reservations/${reservationId}`,
      data,
      headers: { 'If-Match': String(ifMatch) },
    });
    return decodeResponse(response.data, reservation, 'PATCH /plans/{plan_id}/reservations/{reservation_id}');
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
    const response = await this.client.get(
      `/plans/${planId}/reservations/${reservationId}/participants`
    );
    return decodeResponse(response.data, arrayOf(reservationParticipant), 'GET /plans/{plan_id}/reservations/{reservation_id}/participants');
  }

  async createReservationParticipant(
    planId: string, reservationId: string,
    data: { name: string; seat?: string; special_request?: string; plan_member_id?: string }
  ): Promise<ReservationParticipant> {
    const response = await this.client.post(
      `/plans/${planId}/reservations/${reservationId}/participants`, data
    );
    return decodeResponse(response.data, reservationParticipant, 'POST /plans/{plan_id}/reservations/{reservation_id}/participants');
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
    const response = await this.client.get(
      `/plans/${planId}/reservations/${reservationId}/events`
    );
    return decodeResponse(response.data, arrayOf(reservationEventLink), 'GET /plans/{plan_id}/reservations/{reservation_id}/events');
  }

  async createReservationEventLink(
    planId: string, reservationId: string, data: ReservationEventLinkCreateData
  ): Promise<ReservationEventLink> {
    const response = await this.client.post(
      `/plans/${planId}/reservations/${reservationId}/events`, data
    );
    return decodeResponse(response.data, reservationEventLink, 'POST /plans/{plan_id}/reservations/{reservation_id}/events');
  }

  async updateReservationEventLink(
    planId: string, reservationId: string, linkId: string, data: ReservationEventLinkUpdateData
  ): Promise<ReservationEventLink> {
    const response = await this.client.patch(
      `/plans/${planId}/reservations/${reservationId}/events/${linkId}`, data
    );
    return decodeResponse(response.data, reservationEventLink, 'PATCH /plans/{plan_id}/reservations/{reservation_id}/events/{link_id}');
  }

  async deleteReservationEventLink(planId: string, reservationId: string, linkId: string): Promise<void> {
    await this.client.delete(`/plans/${planId}/reservations/${reservationId}/events/${linkId}`);
  }
}
