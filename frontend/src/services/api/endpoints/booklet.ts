/**
 * しおり・印刷・PDF出力(FR-034/035/046)
 *
 * [Gate P4] backend/app/api/v1/booklet.py。/plans/{planId}配下。
 * プレビューは保存しない。版は作成時点の内容で固定され、失効・有効期限切れは410。
 * PDFはブラウザの印刷機能で、同じしおり投影から作る(サーバーにPDFは保存しない)。
 */
import { DiscussionApi } from './discussion';
import type { Booklet, BookletExport, BookletExportCreateData, BookletExportResult, BookletOptions } from '../types';
import { arrayOf, decodeResponse, object } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

const exportResult = async () => object<BookletExportResult>({ export: (await DL()).bookletExport, booklet: (await DL()).booklet });

export class BookletApi extends DiscussionApi {
  async previewBooklet(planId: string, options: BookletOptions): Promise<Booklet> {
    const response = await this.client.post(`/plans/${planId}/booklet/preview`, options);
    return decodeResponse(response.data, (await DL()).booklet, 'POST /plans/{plan_id}/booklet/preview');
  }

  async getBookletExports(planId: string): Promise<BookletExport[]> {
    const response = await this.client.get(`/plans/${planId}/booklet-exports`);
    return decodeResponse(response.data, arrayOf((await DL()).bookletExport), 'GET /plans/{plan_id}/booklet-exports');
  }

  async createBookletExport(planId: string, data: BookletExportCreateData): Promise<BookletExportResult> {
    const response = await this.client.post(`/plans/${planId}/booklet-exports`, data);
    return decodeResponse(response.data, (await exportResult()), 'POST /plans/{plan_id}/booklet-exports');
  }

  async getBookletExport(planId: string, exportId: string): Promise<BookletExportResult> {
    const response = await this.client.get(`/plans/${planId}/booklet-exports/${exportId}`);
    return decodeResponse(response.data, (await exportResult()), 'GET /plans/{plan_id}/booklet-exports/{export_id}');
  }

  async revokeBookletExport(planId: string, exportId: string): Promise<BookletExport> {
    const response = await this.client.delete(`/plans/${planId}/booklet-exports/${exportId}`);
    return decodeResponse(response.data, object({ export: (await DL()).bookletExport }), 'DELETE /plans/{plan_id}/booklet-exports/{export_id}').export;
  }
}
