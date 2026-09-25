/**
 * API共通の型(レスポンス包装・テスト用HTTPクライアント)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import type { AxiosRequestConfig } from 'axios';

// [Gate #20] このファイル独自のUser型定義(name/avatar_url等、実バックエンドの
// Userモデルに存在しないフィールドを含む古い定義)がtypes/index.tsの正規のUser型と
// 重複していた。正規の型に統一する。
export type { User } from '@/types';

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

// [Gate M9-FE-A2] CompleteTravelAPIが実際に呼び出すHTTPクライアントの
// 最小限のインターフェース。単体テスト(api.test.ts)が private client を
// `(api as any).client = {...}` で丸ごと差し替えていたのを、型付きの
// テスト専用シーム(setHttpClientForTesting、後述)経由に置き換えるために
// 導入する。メソッドシグネチャ形式(プロパティ形式ではない)で宣言する
// ことで、テスト側のモック関数がより狭い引数型を持っていても双変性に
// より代入可能になる(実際のAxiosInstanceの複雑なオーバーロード型と
// 完全一致するモックを書く必要がない)。
// [Gate M9-FE-A2] 各メソッドを非ジェネリックにしているのは意図的。ジェネリック
// (`get<T>(...): Promise<{data: T}>`)にすると、あらゆるTに対応できる関数
// でなければ代入不能になり、固定の戻り値を返すテスト用モック関数を
// setHttpClientForTesting()へ渡せなくなる(呼び出し側のthis.client.get<T>(...)
// 自体は引き続きAxiosInstanceの本来のジェネリックシグネチャを使うため、
// 本番コードの型安全性はここでは失われない)。
export interface MinimalHttpClient {
  get(url: string, config?: AxiosRequestConfig): Promise<{ data: unknown }>;
  post(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<{ data: unknown }>;
  put(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<{ data: unknown }>;
  patch(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<{ data: unknown }>;
  delete(url: string, config?: AxiosRequestConfig): Promise<{ data: unknown }>;
  request(config: AxiosRequestConfig): Promise<{ data: unknown }>;
}
