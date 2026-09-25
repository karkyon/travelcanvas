/**
 * 文書ウォレット(FR-013)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { TodayApi } from './today';
import type { DocumentClassification, DocumentLink, TravelDocument } from '../types';
import { arrayOf, decodeResponse } from '../decode';
import { documentLink, downloadUrlResult, travelDocument } from '../decoders';

export class DocumentsApi extends TodayApi {
  async getDocuments(planId: string): Promise<TravelDocument[]> {
    const response = await this.client.get(`/plans/${planId}/documents`);
    return decodeResponse(response.data, arrayOf(travelDocument), 'GET /plans/{plan_id}/documents');
  }

  async getDocument(planId: string, documentId: string): Promise<TravelDocument> {
    const response = await this.client.get(`/plans/${planId}/documents/${documentId}`);
    return decodeResponse(response.data, travelDocument, 'GET /plans/{plan_id}/documents/{document_id}');
  }

  // [Gate M6] FR-013 Object Storage実連携(Gate M5)への接続。実ファイルを
  // multipart/form-dataでアップロードする。storage_key/mime_type/size/
  // sha256はすべてサーバー側が実ファイル内容から算出するため、クライアント
  // からは送らない(createDocumentのメタデータのみ登録とは別の経路)。
  async uploadDocument(
    planId: string, file: File, classification: DocumentClassification, documentType?: string
  ): Promise<TravelDocument> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('classification', classification);
    if (documentType) formData.append('document_type', documentType);
    // [Gate M10 バグA修正] 'multipart/form-data' を明示指定するとboundary
    // パラメータが付与されないため、backend側でmultipartとして正しく
    // パースできない(FastAPI/Starlette側はboundary無しのContent-Typeを
    // multipart/form-dataと認識できず、リクエストパース自体に失敗する)。
    // `Content-Type: undefined` を指定することで、axiosがFormDataを
    // 検出しboundary付きのContent-Typeを自動生成する経路に委ねる。
    const response = await this.client.post(
      `/plans/${planId}/documents/upload`, formData,
      { headers: { 'Content-Type': undefined } }
    );
    return decodeResponse(response.data, travelDocument, 'POST /plans/{plan_id}/documents/upload');
  }

  async getDocumentDownloadUrl(planId: string, documentId: string): Promise<{ url: string; expires_at: number }> {
    const response = await this.client.get(
      `/plans/${planId}/documents/${documentId}/download-url`
    );
    return decodeResponse(response.data, downloadUrlResult, 'GET /plans/{plan_id}/documents/{document_id}/download-url');
  }

  async deleteDocument(planId: string, documentId: string, ifMatch: number): Promise<void> {
    await this.client.delete(`/plans/${planId}/documents/${documentId}`, {
      headers: { 'If-Match': String(ifMatch) },
    });
  }

  async getDocumentLinks(planId: string, documentId: string): Promise<DocumentLink[]> {
    const response = await this.client.get(`/plans/${planId}/documents/${documentId}/links`);
    return decodeResponse(response.data, arrayOf(documentLink), 'GET /plans/{plan_id}/documents/{document_id}/links');
  }
}
