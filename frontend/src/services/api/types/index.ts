/**
 * services/api の公開型の集約(barrel)。
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
export * from './common';
export * from './auth';
export * from './search';
export * from './spots';
export * from './plans';
export * from './today';
export * from './insights';
export * from './notifications';
export * from './share';
export * from './reservations';
export * from './segments';
export * from './routeOptions';
export * from './imports';
export * from './documents';
export * from './tickets';
