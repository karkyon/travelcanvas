/**
 * 合意形成(FR-022)・コメント(FR-024)
 *
 * [Gate P3] backend/app/api/v1/discussion.py。/plans/{planId}配下。
 * 投票・コメントの変更と削除はそれぞれのrevision(If-Match)。回答は自分の分をまとめてPUTする。
 */
import { FinanceApi } from './finance';
import type {
  CommentCreateData, CommentTargetType, PlanComment, Poll, PollCreateData, PollUpdateData, VoteInput,
} from '../types';
import { arrayOf, decodeResponse } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

export class DiscussionApi extends FinanceApi {
  async getPolls(planId: string): Promise<Poll[]> {
    const response = await this.client.get(`/plans/${planId}/polls`);
    return decodeResponse(response.data, arrayOf((await DL()).poll), 'GET /plans/{plan_id}/polls');
  }

  async createPoll(planId: string, data: PollCreateData): Promise<Poll> {
    const response = await this.client.post(`/plans/${planId}/polls`, data);
    return decodeResponse(response.data, (await DL()).poll, 'POST /plans/{plan_id}/polls');
  }

  async updatePoll(planId: string, pollId: string, data: PollUpdateData, ifMatch: number): Promise<Poll> {
    const response = await this.client.patch(
      `/plans/${planId}/polls/${pollId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, (await DL()).poll, 'PATCH /plans/{plan_id}/polls/{poll_id}');
  }

  async deletePoll(planId: string, pollId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/polls/${pollId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, (await DL()).revisionResult, 'DELETE /plans/{plan_id}/polls/{poll_id}');
  }

  async putVotes(planId: string, pollId: string, votes: VoteInput[]): Promise<Poll> {
    const response = await this.client.put(`/plans/${planId}/polls/${pollId}/votes`, { votes });
    return decodeResponse(response.data, (await DL()).poll, 'PUT /plans/{plan_id}/polls/{poll_id}/votes');
  }

  async resolveVote(planId: string, pollId: string, voteId: string, resolved: boolean, note?: string): Promise<Poll> {
    const response = await this.client.post(
      `/plans/${planId}/polls/${pollId}/votes/${voteId}/resolution`, { resolved, ...(note ? { note } : {}) }
    );
    return decodeResponse(response.data, (await DL()).poll, 'POST /plans/{plan_id}/polls/{poll_id}/votes/{vote_id}/resolution');
  }

  async getComments(planId: string, target?: { type: CommentTargetType; id?: string }): Promise<PlanComment[]> {
    const params = target ? { target_type: target.type, ...(target.id ? { target_id: target.id } : {}) } : undefined;
    const response = await this.client.get(`/plans/${planId}/comments`, { params });
    return decodeResponse(response.data, arrayOf((await DL()).planComment), 'GET /plans/{plan_id}/comments');
  }

  async createComment(planId: string, data: CommentCreateData): Promise<PlanComment> {
    const response = await this.client.post(`/plans/${planId}/comments`, data);
    return decodeResponse(response.data, (await DL()).planComment, 'POST /plans/{plan_id}/comments');
  }

  async updateComment(
    planId: string, commentId: string, data: { body?: string; status?: 'open' | 'resolved' }, ifMatch: number
  ): Promise<PlanComment> {
    const response = await this.client.patch(
      `/plans/${planId}/comments/${commentId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, (await DL()).planComment, 'PATCH /plans/{plan_id}/comments/{comment_id}');
  }

  async deleteComment(planId: string, commentId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/comments/${commentId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, (await DL()).revisionResult, 'DELETE /plans/{plan_id}/comments/{comment_id}');
  }
}
