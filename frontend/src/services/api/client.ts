/**
 * APIクライアントの完成形(全エンドポイント群を継承チェーンで合成した最終クラス)。
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
// [Gate L2] 継承チェーンの末尾に制約(FR-016)を追加: ... → Share → Constraints → CompleteTravelAPI
// [Gate L3] 実行可能性検証(FR-017)を追加: ... → Constraints → Validation → CompleteTravelAPI
// [Gate B-012] 削除済みプラン(復元・完全削除)を追加: ... → Validation → PlanTrash → CompleteTravelAPI
// [Gate P1] 持ち物(FR-025)・準備タスク/レディネス(FR-026)を追加: ... → PlanTrash → Preparation → CompleteTravelAPI
// [Gate P2] 予算・費用(FR-027)・立替・精算(FR-028)を追加: ... → Preparation → Finance → CompleteTravelAPI
// [Gate P3] 合意形成(FR-022)・コメント(FR-024)を追加: ... → Finance → Discussion → CompleteTravelAPI
// [Gate P4] しおり・印刷・PDF出力(FR-034/035/046)を追加: ... → Discussion → Booklet → CompleteTravelAPI
// [Gate P5] カレンダー・地図の書き出し(FR-036)を追加: ... → Booklet → ItineraryExport → CompleteTravelAPI
// [Gate P6] データポータビリティ(FR-039)を追加: ... → ItineraryExport → DataExport → CompleteTravelAPI
// [Gate P7] What-if・旅程ブランチ(FR-019)を追加: ... → DataExport → Branches → CompleteTravelAPI
// [Gate P8] カレンダー(ICS)の取込(FR-036)を追加: ... → Branches → CalendarImport → CompleteTravelAPI
// [Gate P9] アカウントの削除・同意の撤回(FR-039)を追加: ... → CalendarImport → Privacy → CompleteTravelAPI
// [Gate P10] 外部状況(アラート、FR-030)・安全な再計画(FR-031)を追加: ... → Privacy → Replans → CompleteTravelAPI
// [Gate L4] 説明可能な最適化(FR-018)を追加: ... → Replans → Optimization → CompleteTravelAPI
// [Gate P11] オフライン編集・同期(FR-033)を追加: ... → Optimization → Sync → CompleteTravelAPI
// [Gate P12] 写真・メモ・旅行記(FR-037)を追加: ... → Sync → Memories → CompleteTravelAPI
// [Gate P13] 任意の位置軌跡(FR-038)を追加: ... → Memories → Location → CompleteTravelAPI
// [Gate P14] 旅の振り返り(FR-054・FR-053)を追加: ... → Location → Journey → CompleteTravelAPI
// [Gate P15] Personal Travel Atlas(FR-052)を追加: ... → Journey → Atlas → CompleteTravelAPI
// [Gate P17] Memory Replan(FR-057)を追加: ... → Atlas → MemoryReplan → CompleteTravelAPI
import { MemoryReplanApi } from './endpoints/memoryReplan';

export class CompleteTravelAPI extends MemoryReplanApi {
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
