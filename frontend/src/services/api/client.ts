/**
 * APIクライアントの完成形(全エンドポイント群を継承チェーンで合成した最終クラス)。
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
// [Gate L2] 継承チェーンの末尾に制約(FR-016)を追加: ... → Share → Constraints → CompleteTravelAPI
// [Gate L3] 実行可能性検証(FR-017)を追加: ... → Constraints → Validation → CompleteTravelAPI
// [Gate B-012] 削除済みプラン(復元・完全削除)を追加: ... → Validation → PlanTrash → CompleteTravelAPI
import { PlanTrashApi } from './endpoints/planTrash';

export class CompleteTravelAPI extends PlanTrashApi {
  // [Gate #34b] 旧ジョブ型最適化API(POST .../optimize でjob_idを発行し、
  // GET /optimization/{job_id} でポーリングする方式)を呼び出す4メソッドは、
  // Gate #34aでバックエンド側の対応エンドポイントが410 Goneへ廃止された
  // ことに伴い除去。Gate #33で新設された、plan/day単位の説明可能な
  // 経路最適化(提案->適用->Undo)は applyOptimizationProposal 等、
  // 別メソッド(このクラス内に存在)を通じて行う。

  // [Gate #27 / A-009] getPrivacySettings/updatePrivacySettings/deleteAccount/
  // exportDataは対応するbackend routeが存在せず(呼べば404)、どのUI
  // コンポーネントからも呼ばれていない死コードだったため削除した
  // (偽の導線をゼロにする)。実装はGate #28(アカウントライフサイクル)で行う。

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
