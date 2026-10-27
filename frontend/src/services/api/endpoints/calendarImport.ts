/**
 * カレンダー(ICS)の取込(FR-036)
 *
 * [Gate P8] backend/app/api/v1/calendar_import.py。/plans/{planId}/calendar-import/*。
 * プレビューはファイルをmultipartで送る(DBは変えない)。適用は本案のrevision(If-Match)。
 */
import { BranchesApi } from './branches';
import type { CalendarImportApplyItem, CalendarImportPreview, CalendarImportResult } from '../types';
import { decodeResponse } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

export class CalendarImportApi extends BranchesApi {
  async previewCalendarImport(planId: string, file: Blob, createMissingDays = false): Promise<CalendarImportPreview> {
    const form = new FormData();
    form.append('file', file, 'calendar.ics');
    form.append('create_missing_days', createMissingDays ? 'true' : 'false');
    // 文書のアップロード(documents.ts)と同じく、Content-Typeはaxiosにboundary付きで付けさせる
    const response = await this.client.post(
      `/plans/${planId}/calendar-import/preview`, form, { headers: { 'Content-Type': undefined } }
    );
    return decodeResponse(response.data, (await DL()).calendarImportPreview, 'POST /plans/{plan_id}/calendar-import/preview');
  }

  async applyCalendarImport(
    planId: string, items: CalendarImportApplyItem[], createMissingDays: boolean, revision: number
  ): Promise<CalendarImportResult> {
    const response = await this.client.post(
      `/plans/${planId}/calendar-import/apply`, { items, create_missing_days: createMissingDays },
      { headers: { 'If-Match': String(revision) } }
    );
    return decodeResponse(response.data, (await DL()).calendarImportResult, 'POST /plans/{plan_id}/calendar-import/apply');
  }
}
