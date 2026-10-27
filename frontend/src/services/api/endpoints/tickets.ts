/**
 * QR・チケット(FR-012)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { DocumentsApi } from './documents';
import type { Ticket, TicketCreateData, TicketRevealResult } from '../types';
import { arrayOf, decodeResponse } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

export class TicketsApi extends DocumentsApi {
  // [Gate R3-11] FR-012 QR・チケット(tickets)
  async getTickets(planId: string, reservationId: string): Promise<Ticket[]> {
    const response = await this.client.get(`/plans/${planId}/reservations/${reservationId}/tickets`);
    return decodeResponse(response.data, arrayOf((await DL()).ticket), 'GET /plans/{plan_id}/reservations/{reservation_id}/tickets');
  }

  async createTicket(planId: string, reservationId: string, data: TicketCreateData): Promise<Ticket> {
    const response = await this.client.post(
      `/plans/${planId}/reservations/${reservationId}/tickets`, data
    );
    return decodeResponse(response.data, (await DL()).ticket, 'POST /plans/{plan_id}/reservations/{reservation_id}/tickets');
  }

  async deleteTicket(planId: string, reservationId: string, ticketId: string, ifMatch: number): Promise<void> {
    await this.client.delete(`/plans/${planId}/reservations/${reservationId}/tickets/${ticketId}`, {
      headers: { 'If-Match': String(ifMatch) },
    });
  }

  async revealTicket(planId: string, reservationId: string, ticketId: string): Promise<TicketRevealResult> {
    const response = await this.client.post(
      `/plans/${planId}/reservations/${reservationId}/tickets/${ticketId}/reveal`, {}
    );
    return decodeResponse(response.data, (await DL()).ticketRevealResult, 'POST /plans/{plan_id}/reservations/{reservation_id}/tickets/{ticket_id}/reveal');
  }
}
