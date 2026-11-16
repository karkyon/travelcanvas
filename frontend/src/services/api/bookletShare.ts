/**
 * [Gate BookletShare] しおりの版を同行者へ送る。backend/app/api/v1/booklet_share.py。
 *
 * - GET  /plans/{plan_id}/booklet-exports/{export_id}/share : 共有の画面の材料(公開の URL・送り先の候補・送れるか)
 * - POST /plans/{plan_id}/booklet-exports/{export_id}/email : アプリからメールで送る(PDF の添付・リンク)
 *
 * 送り先はメンバーだけ(アドレスは画面に返らない)。最初に読む JS を小さく保つため、使う画面が直接 import する。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, int, nullable, object, oneOf, str } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export interface BookletShareRecipient { user_id: string; name: string; role: 'owner' | 'editor' | 'viewer'; has_email: boolean }

export interface BookletShareInfo {
  export_id: string;
  version_no: number;
  is_public: boolean;
  /** 公開の URL のパス(/b/…)。作成者・所有者で、作り直さずに出せる時だけ */
  public_path: string | null;
  public_url_recoverable: boolean;
  can_publish: boolean;
  contains_sensitive: boolean;
  can_attach_pdf: boolean;
  /** 編集できる同行者がログインして開くパス */
  app_path: string;
  email_available: boolean;
  /** 確認用の受信箱(外へ届かない)へ送る環境か */
  email_sandbox: boolean;
  recipients: BookletShareRecipient[];
  max_recipients: number;
}

const shareInfo = object<BookletShareInfo>({
  export_id: str, version_no: int, is_public: bool, public_path: nullable(str), public_url_recoverable: bool,
  can_publish: bool, contains_sensitive: bool, can_attach_pdf: bool, app_path: str, email_available: bool,
  email_sandbox: bool,
  recipients: arrayOf(object<BookletShareRecipient>({
    user_id: str, name: str, role: oneOf('owner', 'editor', 'viewer'), has_email: bool,
  })),
  max_recipients: int,
});

export async function getBookletShare(planId: string, exportId: string): Promise<BookletShareInfo> {
  const r = await api.get(`/plans/${planId}/booklet-exports/${exportId}/share`, SILENT);
  return decodeResponse(r.data, shareInfo, 'GET /plans/{plan_id}/booklet-exports/{export_id}/share');
}

export interface BookletEmailRequest {
  user_ids: string[];
  message: string;
  attach_pdf: boolean;
  include_web_link: boolean;
  include_app_link: boolean;
  app_origin: string;
}

export interface BookletEmailResult { sent: number; failed: number; skipped_no_address: number; sandbox: boolean }

export async function sendBookletEmail(planId: string, exportId: string, body: BookletEmailRequest): Promise<BookletEmailResult> {
  const r = await api.post(`/plans/${planId}/booklet-exports/${exportId}/email`, body, SILENT);
  return decodeResponse(r.data, object<BookletEmailResult>({ sent: int, failed: int, skipped_no_address: int, sandbox: bool }),
    'POST /plans/{plan_id}/booklet-exports/{export_id}/email');
}
