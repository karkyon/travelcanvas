# ADR: オフライン編集・同期(FR-033)の最小実装

- 状態: 採用(Gate P11)
- 前提: Gate L4(説明可能な最適化)適用後
- 関連: DOC-02 FR-033、DOC-06 §13・§30(Offline Sync契約)、DOC-07 RB-008、DOC-13 §5(Operation ID / Base Revision / Conflict)、DOC-04 §6(Offline・Conflict)
- トレーサビリティ: `docs/trace/gate-p11-trace.md`

## 1. 背景

FR-033(一時ID、操作キュー、再送、冪等性、競合解決)は全く無かった。端末保存(Offline Pack、FR-032)は閲覧だけで、
通信できない間の変更は失われていた(画面で操作しても失敗表示で元に戻った)。

## 2. 決定

### 2.1 データ(migration `a8c4e2f6d9b3`、1テーブル新設のみ)

- `sync_operations`: 端末の operation_id(利用者ごとに一意)、操作(create/update/delete)、対象の予定・仮のID(temp_id)、
  編集を始めた版(base_revision)、送られた項目、結果(applied/conflicted/rejected/resolved_mine/resolved_server)、競合の内容。
  予定への外部キーは張らない(B-013の個別削除を妨げないため)。plan_id は ON DELETE CASCADE。

### 2.2 同期API(`app/api/v1/sync.py`、`app/services/sync.py`)

- `POST /plans/{id}/sync`: 送られた順に操作ごとの結果を返す(一部成功をまとめて200で隠さない)。client_at は順序の根拠にしない。
  - 同じ operation_id の再送は記録した結果(already_applied)を返し、二重に適用しない。
  - 端末で作った予定の仮のID(temp_id)は、作成の適用後に同じ利用者の後続の操作から本当のIDへ対応付ける。
  - 競合は項目単位: 「編集を始めた版での値」(base_revision より後の最初の変更記録の変更前の値)から、サーバーでも同じ項目が
    別の値に変わっていれば競合。同じ値・別の項目なら適用する。サーバーで削除済みの予定の変更は競合、削除は適用済み扱い。
    編集を始めた後に変わった予定の削除は競合。
  - 確定(ロック)した予定、予約・移動・文書と紐付く予定の削除はオフラインでは行わない(rejected。オンラインで扱いを確認する)。
  - 適用は操作ごとに変更セット(source=sync)として記録し、本案の「元に戻す」で取り消せる。
- `GET /plans/{id}/sync/conflicts`: 自分の未解決の競合と、サーバーの今の値。
- `POST /plans/{id}/sync/conflicts/{operation_id}/resolve`: keep_server(サーバーの内容を残す)/ use_mine(自分の変更を使う、If-Match)。

### 2.3 端末側

- 操作キュー(`utils/syncQueue.ts`): localStorage に予定の操作を operation_id 付きで保存。機密値(予約番号・チケット等)は対象外。
  ストレージが使えなければ溜めずに従来どおり失敗表示にする(画面は止めない)。
- planStore: 予定の追加・変更・削除で「通信できなかった(応答が無い)」場合だけ、画面の変更を残して端末に溜める。
  サーバーが答えた失敗(権限・競合など)は従来どおり元に戻す。通信が戻る(online)と自動で送り、プランを読み直す。
- 画面: プラン画面の「同期の状態」(未同期の件数・今すぐ同期・競合の件数)、競合の画面(項目ごとの比較と選択)。

## 3. 今回の範囲外

- 予定以外(予約・持ち物・費用など)のオフライン編集、日程の追加・削除、並べ替え・日の移動。
- 複数端末の同時編集のリアルタイム反映(WebSocket)、Service Workerのバックグラウンド同期、端末の失効(SC-29)。
- 機密値の変更にオンライン再認証を求める設定(DOC-02 FR-033)。現状、機密値はオフライン編集の対象にしていない。
