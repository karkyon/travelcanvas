/**
 * 写真・メモ・旅行記(FR-037)
 *
 * [Gate P12] backend/app/api/v1/memories.py。/plans/{planId}/memories配下。
 * 画面内でエラーを案内するため、共通エラー処理のtoastは出さない(SILENT)。
 * 写真・音声はファイルの内容をBlobで受け取り、画面で一時的なURL(object URL)にして表示する
 * (ファイルのURLを共有・保存させない。サーバーはキャッシュさせない)。
 */
import type { AxiosRequestConfig } from 'axios';
import { SyncApi } from './sync';
import type {
  JournalDraft, JournalOptions, MemoryInput, MemoryList, MemoryUpdateInput, MemoryUploadInput, TravelMemory,
} from '../types';
import { decodeResponse } from '../decode';
import { journalDraft, memoryList, travelMemory } from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class MemoriesApi extends SyncApi {
  async getMemories(planId: string): Promise<MemoryList> {
    const response = await this.client.get(`/plans/${planId}/memories`, SILENT);
    return decodeResponse(response.data, memoryList, 'GET /plans/{plan_id}/memories');
  }

  async createMemory(planId: string, input: MemoryInput): Promise<TravelMemory> {
    const response = await this.client.post(`/plans/${planId}/memories`, input, SILENT);
    return decodeResponse(response.data, travelMemory, 'POST /plans/{plan_id}/memories');
  }

  async uploadMemory(planId: string, input: MemoryUploadInput): Promise<TravelMemory> {
    const form = new FormData();
    form.append('file', input.file);
    form.append('kind', input.kind);
    const optional: Array<[string, string | null | undefined]> = [
      ['body', input.body], ['event_id', input.event_id], ['day_id', input.day_id],
      ['occurred_at', input.occurred_at], ['place_name', input.place_name], ['visibility', input.visibility],
    ];
    for (const [key, value] of optional) {
      if (value) form.append(key, value);
    }
    if (input.include_in_journal !== undefined) form.append('include_in_journal', String(input.include_in_journal));
    // boundary付きのContent-Typeをaxiosに作らせる(documents.tsのGate M10と同じ理由)
    const response = await this.client.post(`/plans/${planId}/memories/upload`, form, {
      ...SILENT, headers: { 'Content-Type': undefined },
    });
    return decodeResponse(response.data, travelMemory, 'POST /plans/{plan_id}/memories/upload');
  }

  async updateMemory(planId: string, memoryId: string, input: MemoryUpdateInput, revision: number): Promise<TravelMemory> {
    const response = await this.client.patch(`/plans/${planId}/memories/${memoryId}`, input, {
      ...SILENT, headers: { 'If-Match': String(revision) },
    });
    return decodeResponse(response.data, travelMemory, 'PATCH /plans/{plan_id}/memories/{memory_id}');
  }

  async deleteMemory(planId: string, memoryId: string): Promise<void> {
    await this.client.delete(`/plans/${planId}/memories/${memoryId}`, SILENT);
  }

  async getMemoryMedia(planId: string, memoryId: string): Promise<Blob> {
    const response = await this.client.get(`/plans/${planId}/memories/${memoryId}/media`, {
      ...SILENT, responseType: 'blob',
    });
    return response.data as Blob;
  }

  async createJournalDraft(planId: string, options: JournalOptions): Promise<JournalDraft> {
    const response = await this.client.post(`/plans/${planId}/memories/journal-draft`, options, SILENT);
    return decodeResponse(response.data, journalDraft, 'POST /plans/{plan_id}/memories/journal-draft');
  }
}
