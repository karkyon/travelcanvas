/**
 * [Gate② 縦断] 1 回の作成の操作に 1 つの再送の印(Idempotency-Key)。
 * 同じ要求の送り直し(ログインの更新の後のやり直しなど)で、サーバーが同じ物を二重に作らない(backend の app/core/idempotent_create.py)。
 */
export function onceKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID() : `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
