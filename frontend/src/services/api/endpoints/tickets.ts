/**
 * QR・チケット(FR-012)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { DocumentsApi } from './documents';
import type { Ticket, TicketCreateData, TicketRevealResult } from '../types';
import { decodeResponse } from '../decode';
import { ticketRevealResult } from '../decoders';

export class TicketsApi extends DocumentsApi {
  // [Gate R3-11] FR-012 QR・チケット(tickets)
  async getTickets(planId: string, reservationId: string): Promise<Ticket[]> {
    const response = await this.client.get<Ticket[]>(`/plans/${planId}/reservations/${reservationId}/tickets`);
    return response.data;
  }

  async createTicket(planId: string, reservationId: string, data: TicketCreateData): Promise<Ticket> {
    const response = await this.client.post<Ticket>(
      `/plans/${planId}/reservations/${reservationId}/tickets`, data
    );
    return response.data;
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
    return decodeResponse(response.data, ticketRevealResult, 'POST /plans/{plan_id}/reservations/{reservation_id}/tickets/{ticket_id}/reveal');
  }
}
