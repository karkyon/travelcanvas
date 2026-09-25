/**
 * [Gate M9-FE-C2b] APIレスポンスの実行時検証(runtime decoder)。
 *
 * これまでAPIクライアントは `this.client.get<T>(...)` のジェネリクスで応答を
 * 「型Tである」と宣言するだけで、実際の形状を一切確認していなかった
 * (TypeScriptの型はコンパイル時にしか効かないため、backendが想定外の形状を
 * 返すと、誤った値がそのまま画面・状態管理へ流れ込む)。
 *
 * 新規npm依存(zod等)を追加せず、必要最小限のコンビネータだけを用意する。
 * - 検証に失敗した場合は ApiDecodeError(どのAPIの・どの位置が・何を期待したか)を投げる
 * - object() は宣言したキーだけを検証し、宣言外のキーはそのまま残す
 *   (backendがフィールドを追加しても既存画面を壊さないため)
 */

export class ApiDecodeError extends Error {
  readonly endpoint: string;
  readonly path: string;
  readonly expected: string;

  constructor(endpoint: string, path: string, expected: string) {
    super(`APIレスポンスの形式が想定と異なります(${endpoint} の ${path}: ${expected}を期待)`);
    this.name = 'ApiDecodeError';
    this.endpoint = endpoint;
    this.path = path;
    this.expected = expected;
  }
}

/** decoder内部でのみ使う失敗通知(decodeResponseでApiDecodeErrorへ変換する)。 */
class DecodeFailure {
  constructor(readonly path: string, readonly expected: string) {}
}

export type Decoder<T> = (value: unknown, path: string) => T;

const fail = (path: string, expected: string): never => {
  throw new DecodeFailure(path, expected);
};

export const str: Decoder<string> = (v, path) => (typeof v === 'string' ? v : fail(path, '文字列'));

export const num: Decoder<number> = (v, path) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fail(path, '数値');

export const int: Decoder<number> = (v, path) =>
  typeof v === 'number' && Number.isInteger(v) ? v : fail(path, '整数');

export const bool: Decoder<boolean> = (v, path) => (typeof v === 'boolean' ? v : fail(path, '真偽値'));

/**
 * 列挙値(文字列リテラルの和型)。backendの許容値集合と一致させること
 * (backend側で値を追加した場合、ここへ追加するまでは形式不正として検出される)。
 */
export const oneOf =
  <T extends string>(...values: readonly T[]): Decoder<T> =>
  (v, path) =>
    typeof v === 'string' && (values as readonly string[]).includes(v)
      ? (v as T)
      : fail(path, `${values.join(' | ')} のいずれか`);

export const nullable =
  <T>(decoder: Decoder<T>): Decoder<T | null> =>
  (v, path) =>
    v === null ? null : decoder(v, path);

/** キー自体が無い(undefined)ことを許す。nullは許さない(nullable()と組み合わせる)。 */
export const optional =
  <T>(decoder: Decoder<T>): Decoder<T | undefined> =>
  (v, path) =>
    v === undefined ? undefined : decoder(v, path);

export const arrayOf =
  <T>(decoder: Decoder<T>): Decoder<T[]> =>
  (v, path) =>
    Array.isArray(v) ? v.map((item, i) => decoder(item, `${path}[${i}]`)) : fail(path, '配列');

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 中身を問わないJSONオブジェクト(利用者設定のpreferences等、自由形式の値)。 */
export const record: Decoder<Record<string, unknown>> = (v, path) =>
  isRecord(v) ? v : fail(path, 'オブジェクト');

/**
 * オブジェクトの各キーを検証する。shapeには型Tの全キーを列挙する必要がある
 * (キーの書き漏れはコンパイルエラーになる)。宣言外のキーは値を変えずに残す。
 */
export function object<T extends object>(shape: { [K in keyof T]-?: Decoder<T[K]> }): Decoder<T> {
  return (v, path) => {
    if (!isRecord(v)) return fail(path, 'オブジェクト');
    const out: Record<string, unknown> = { ...v };
    for (const key of Object.keys(shape) as Array<keyof T & string>) {
      out[key] = shape[key](v[key], `${path}.${key}`);
    }
    // 全キーをshapeのdecoderで検証済みのため、ここでの型付けは安全。
    return out as T;
  };
}

/** APIレスポンス本体を検証する。失敗時はApiDecodeErrorを投げる。 */
export function decodeResponse<T>(value: unknown, decoder: Decoder<T>, endpoint: string): T {
  try {
    return decoder(value, '$');
  } catch (error) {
    if (error instanceof DecodeFailure) {
      throw new ApiDecodeError(endpoint, error.path, error.expected);
    }
    throw error;
  }
}
