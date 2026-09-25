/**
 * [Gate M9-FE-C2b] backendが生JSONを返すエンドポイントを、既存呼び出し元が期待する
 * ApiResponse形状へ包むためのヘルパー。
 *
 * 以前は各メソッドで `{ success: true, data } as ApiResponse<T>` と型アサーションで
 * 包んでおり、必須フィールド`message`が欠落していても型エラーにならなかった
 * (型と実体の乖離)。アサーションを使わず、全フィールドを持つ値を返す。
 */
import type { ApiResponse } from './types';

export function apiOk<T>(data: T, message: string = ''): ApiResponse<T> {
  return { success: true, message, data };
}

export function apiOkVoid(message: string = ''): ApiResponse<void> {
  return { success: true, message, data: undefined };
}
