# エラーの一覧(Gate G3・UX-04)

> このファイルは `scripts/ci/render_error_catalog.py` が backend のコードから作る(手で直さない)。
> 応答の決まりは `backend/app/core/error_catalog.py`。

## 応答の形

```json
{"detail": "利用者向けの文、または {\"code\", \"message\", ...}、または入力の検証の一覧",
 "request_id": "問い合わせ番号(応答の X-Request-ID と同じ)",
 "retry": "later | after_reload | no",
 "code": "detail.code(5xx は internal_error)"}
```

- `retry`: `later` = 時間をおいてもう一度(429・5xx)、`after_reload` = 読み直してからもう一度(版の競合の 409・412・428)、`no` = 入力・権限を直さない限り同じ結果
- 画面は `detail.message`(文字列の `detail`)を出す。5xx は決まった文と問い合わせ番号だけ(例外の文・SQL・秘密の値は出さない)
- 入力の検証(422)の `detail` は FastAPI の一覧(`loc`・`msg`・`type`)。送った値(`input`)は返さない

## code の一覧

| code | HTTP | 再試行 | 利用者向けの文(例) | 場所 |
|---|---|---|---|---|
| `acknowledgement_required` | 422 | no | 公開の前に確認の項目を全て確かめてください | api/v1/memory_publish.py |
| `admin_account` | 403 | no | 管理者のアカウントはこの画面から削除できません。管理者の権限を外してから削除してください | api/v1/privacy.py |
| `admin_target` | — | — | ほかの管理者はこの画面から操作できません(運用の手順で権限を外してから) | api/v1/admin.py |
| `alert_target_changed` | 409 | after_reload | — | api/v1/replans.py |
| `already_adopted` | — | — | この投票はもう採用しています | api/v1/decisions.py |
| `already_committed` | 409 | no | この下書きはもう旅程にしました。並びは旅程の画面で変えてください | api/v1/trip_intents.py |
| `already_delivered` | 409 | no | 届いた送信は送り直せません | api/v1/organizations.py |
| `already_member` | 409 | no | すでにメンバーです | api/v1/organizations.py |
| `already_resolved` | 409 | no | 既に対応を記録しています | api/v1/corrections.py |
| `already_restored` | 409 | no | この記録はすでに戻っています | api/v1/memory_publish.py |
| `already_reverted` | 409 | no | 既に取り消しています | api/v1/corrections.py |
| `already_scheduled` | 409 | no | この候補はもう予定に配置しています | api/v1/candidates.py, api/v1/decisions.py |
| `already_undone` | 409 | no | もう元に戻しています | api/v1/commands.py |
| `already_visited` | 409 | no | 行った予定は次の旅行へ戻せません(行かなかった・未記録の予定だけ) | api/v1/journey.py |
| `api_client_not_found` | 404 | no | 連携が見つかりません | api/v1/organizations.py |
| `api_client_revoked` | 409 | no | 止めた連携の秘密は作り直せません | api/v1/organizations.py |
| `areas_only` | 409 | no | この軌跡は「訪問地域だけ同期」の設定のため、座標はサーバーへ送れません | api/v1/location_tracks.py |
| `blocked_host` | — | — | 内部のアドレス・localhost へは送れません | api/v1/organizations.py |
| `branch_conflict` | 409 | after_reload | 本案と食い違う変更があるため採用できません。分岐案を直してから採用してください | api/v1/branches.py |
| `branch_dependency_missing` | 422 | no | 選んだ変更が頼る変更(足した予定など)も選んでください | api/v1/branches.py |
| `budget_empty` | 422 | no | 予算(旅行全体かカテゴリ別)を入れてから版を残してください | api/v1/finance_ledger.py |
| `budget_initial_exists` | 409 | no | 当初の予算の版は1つだけです(変えた後は「更新」で残してください) | api/v1/finance_ledger.py |
| `candidate_missing` | — | — | 決定した候補が候補箱から消えています | api/v1/decisions.py |
| `candidate_not_found` | 409 | after_reload | 捨てる候補はありません | api/v1/admin_ops.py, api/v1/optimization.py |
| `candidate_unavailable` | 409 | no | この案は使えません | api/v1/replans.py |
| `changed_on_server` | 409 | no | 日程の予定が変わっているため、この並びは使えません(画面で並べ直してください) | api/v1/sync.py |
| `changed_since` | 409 | no | 訂正の後に値が変わっているため取り消せません(新しく訂正してください) | api/v1/corrections.py |
| `client_policy_ignored` | — | — | 上限・クラス・提供元は指定できません(サーバーが決めます) | api/v1/planning_usage.py |
| `clone_not_allowed` | — | — | この共有では複製が許されていません | api/v1/public_share.py |
| `command_forbidden` | 403 | no | この旅行では閲覧だけの権限のため、実行できません | api/v1/commands.py |
| `command_not_executable` | — | — | 画面を開くコマンドは実行しません(画面で開いてください) | api/v1/commands.py |
| `confirmation_mismatch` | 422 | no | 確認のため「…」と入力してください | api/v1/privacy.py |
| `consent_required` | 403 | no | 位置情報の利用に同意していないため記録できません。「データとプライバシー」で同意を変更できます | api/v1/location_tracks.py |
| `cover_not_found` | 404 | no | 表紙の写真がありません | api/v1/plan_cover.py |
| `day_missing` | 404 | no | 移す先の日程が見つかりません | api/v1/movement.py |
| `day_not_empty` | 409 | no | — | api/v1/sync.py |
| `day_not_found` | 409 | no | 追加する日が見つかりません | api/v1/candidates.py, api/v1/decisions.py, api/v1/journey.py, api/v1/memories.py |
| `day_required` | — | — | 候補を置く日を選んでください | api/v1/decisions.py |
| `deleted_on_server` | 409 | after_reload | サーバーで削除された予定のため、自分の変更は使えません | api/v1/sync.py |
| `delivery_not_found` | 404 | no | 送信の記録が見つかりません | api/v1/organizations.py |
| `device_only` | 409 | no | この軌跡は「この端末だけ」に保存する設定のため、サーバーへは送れません | api/v1/location_tracks.py |
| `distribution_not_found` | 404 | no | 配布が見つかりません | api/v1/organizations.py |
| `domain_exists` | 409 | no | このドメインは登録済みです | api/v1/organizations.py |
| `domain_not_found` | 404 | no | ドメインが見つかりません | api/v1/organizations.py |
| `domain_revoked` | 409 | no | 取り消したドメインは確認できません。もう一度登録してください | api/v1/organizations.py |
| `domain_taken` | 409 | no | このドメインは別の組織で確認済みです | api/v1/organizations.py |
| `duplicate_event` | — | — | 同じ予定が2回含まれています | api/v1/visits.py |
| `duplicate_item` | — | — | 同じ項目が2回あります | services/private_profile.py |
| `email_taken` | 409 | no | このメールアドレスは既に使われています | api/v1/corrections.py |
| `email_unavailable` | 409 | no | この環境ではメールを送れません(管理者の設定が必要です) | api/v1/notifications.py |
| `encryption_not_configured` | 503 | later | 暗号化が設定されていないため記録できません(サーバー側の設定) | api/v1/corrections.py, api/v1/location_tracks.py, api/v1/memories.py, api/v1/privacy_zones.py |
| `encryption_unavailable` | 503 | later | 暗号化が設定されていないため保存できません | services/private_profile.py |
| `entitlement_not_found` | 404 | no | 付与が見つかりません | api/v1/planning_usage.py |
| `entitlement_not_pending` | 409 | no | 承認を待っている付与ではありません | api/v1/planning_usage.py |
| `entitlement_reason_required` | — | — | 理由を200文字までで入力してください | api/v1/planning_usage.py |
| `entitlement_subject_not_found` | 404 | no | 対象の利用者が見つかりません | api/v1/planning_usage.py |
| `event_locked` | — | — | 予定「%s」はロックされているため外せません | api/v1/decisions.py |
| `event_missing` | — | — | 決定した予定が旅程から消えています | api/v1/decisions.py |
| `event_not_found` | 404 | no | 指定した予定が見つかりません | api/v1/memories.py, api/v1/paid_actions.py |
| `event_without_location` | 404 | no | 場所(座標)の無い予定の経路は調べられません(送っていません) | api/v1/paid_actions.py |
| `expense_has_refunds` | 409 | no | 返金が登録されている支出は取り消せません(先に返金を取り消してください) | api/v1/finance_ledger.py |
| `expense_voided` | 409 | no | 取り消した支出は変更できません | api/v1/finance.py, api/v1/finance_ledger.py |
| `expired` | 410 | no | この版は有効期限が切れています | api/v1/booklet.py |
| `fake_test_disabled` | 403 | no | 本番・staging の環境では Fake の試験を実行しません | api/v1/admin_ops.py |
| `file_too_large` | 413 | no | ファイルが大きすぎます(上限 …MB) | api/v1/memories.py |
| `finance_locked` | 409 | no | 精算を締めているため変更できません。所有者が締めを解除してから変更してください | api/v1/finance.py, api/v1/finance_ledger.py |
| `finance_not_locked` | 409 | no | 精算は締めていません | api/v1/finance_ledger.py |
| `finance_unlock_owner_only` | 403 | no | 締めを解除できるのは旅行の所有者だけです | api/v1/finance_ledger.py |
| `forbidden` | 403 | no | この場所を使う全ての旅行の編集の権限が無いため、直せません | api/v1/places.py |
| `forbidden_role` | 403 | no | この操作は組織の管理者だけができます | api/v1/organizations.py, services/organizations.py |
| `grant_inactive` | 404 | no | 許可が見つかりません | api/v1/admin_support.py |
| `has_days` | 409 | no | この旅行にはもう日程があります。旅程の画面で予定を足してください | api/v1/trip_intents.py |
| `has_relations` | 409 | no | — | api/v1/sync.py |
| `idempotency_key_required` | 400 | no | Idempotency-Key(100文字まで)が必要です | api/v1/commands.py, api/v1/paid_actions.py |
| `idempotency_key_reused` | 409 | no | この Idempotency-Key は別の操作に使われています | api/v1/commands.py, api/v1/finance.py |
| `if_match_required` | 428 | after_reload | If-Match(移動の既定の版。まだ無ければ 0)が必要です | api/v1/movement.py, api/v1/private_profile.py |
| `input_too_long` | — | — | … は … 文字までです | api/v1/paid_actions.py |
| `invalid_branch_resources` | 422 | no | — | api/v1/branches.py |
| `invalid_branch_selection` | 422 | no | 比べる分岐案を1〜…つ選んでください | api/v1/branches.py |
| `invalid_color` | — | — | ブランドの色は #RRGGBB の形で指定してください | services/organizations.py |
| `invalid_email` | — | — | メールアドレスを入力してください | api/v1/organizations.py |
| `invalid_entitlement` | 409 | no | subject_type は user か plan です | api/v1/planning_usage.py |
| `invalid_events` | — | — | 送るできごとを選んでください | api/v1/organizations.py |
| `invalid_field` | 409, 422 | no | precision は region か area です | api/v1/atlas.py, api/v1/candidates.py, api/v1/hours_check.py, api/v1/journey.py, api/v1/location_tracks.py, api/v1/media |
| `invalid_grace` | — | — | 前の秘密を使える時間は0〜…時間の整数で指定してください | api/v1/organizations.py |
| `invalid_hardness` | — | — | 必ず守る/できれば を選んでください | services/private_profile.py |
| `invalid_if_match` | 400 | no | If-Match の形式が不正です | api/v1/private_profile.py |
| `invalid_input` | — | — | … を入力してください | api/v1/paid_actions.py |
| `invalid_item` | 422 | no | 項目の形式が不正です | services/private_profile.py |
| `invalid_items` | — | — | items は一覧で指定してください | services/private_profile.py |
| `invalid_kind` | 422 | no | 記録の種類が不正です | api/v1/memories.py, services/private_profile.py |
| `invalid_label` | — | — | 名前は1〜…文字で入力してください | services/private_profile.py |
| `invalid_location_level` | — | — | 場所の出し方は「出さない」か「地名だけ」です | api/v1/memory_publish.py |
| `invalid_metrics` | — | — | 端末の判定の数値が不正です(座標は送れません) | api/v1/visits.py |
| `invalid_name` | — | — | 連携の名前を100文字までで入力してください | api/v1/organizations.py, services/organizations.py |
| `invalid_note` | — | — | 改訂の説明は…文字までです | services/organizations.py |
| `invalid_plan` | — | — | 配布する旅行を選んでください | api/v1/organizations.py |
| `invalid_planning_units` | — | — | 操作の量はオブジェクトで指定してください | api/v1/planning_usage.py |
| `invalid_reason` | 422 | no | 止める理由を200文字までで入力してください | api/v1/admin_support.py |
| `invalid_request` | — | — | 本文の形が正しくありません | api/v1/organizations.py |
| `invalid_role` | — | — | 役割は member か admin です(owner へは役割の変更で) | api/v1/organizations.py |
| `invalid_scope` | — | — | スコープは | api/v1/organizations.py |
| `invalid_seat_limit` | — | — | 席の上限(1以上の整数、上限なしは null)を指定してください | api/v1/organizations.py |
| `invalid_selection` | 422 | no | この案で変わる予定の中から、動かす予定を選んでください | api/v1/optimization.py |
| `invalid_slots` | — | — | …日目 | api/v1/trip_intents.py |
| `invalid_state` | 409 | no | 記録中の軌跡だけ一時停止できます | api/v1/location_tracks.py |
| `invalid_tier` | 403 | no | tier は free・trip・journey・explorer のどれかです | api/v1/admin_ops.py |
| `invalid_title` | — | — | 配布の題名は200文字までです | api/v1/organizations.py |
| `invalid_unit` | — | — | 単位を選んでください | services/private_profile.py |
| `invalid_url` | — | — | https:// で始まる URL を入力してください(ユーザー名・パスワードは含めない) | api/v1/organizations.py |
| `invalid_usage_key` | 422 | no | subject_type・metric の値が正しくありません | api/v1/admin.py |
| `invalid_usage_limit` | 422 | no | 上限は0以上の整数か、既定に戻す null です | api/v1/admin.py |
| `invalid_user` | — | — | user_id が正しくありません | api/v1/admin_ops.py |
| `invalid_value` | — | — | 時刻は HH:MM で入力してください | services/private_profile.py |
| `last_owner` | 409 | no | 組織には owner が1人以上必要です | api/v1/organizations.py |
| `location_off` | 409 | no | この旅行は「位置を記録しない」設定です。記録するには設定を変えてください | api/v1/location_tracks.py |
| `locked` | 409 | no | — | api/v1/sync.py |
| `locked_relation` | — | — | 確定ロックされた予約との紐付けがあるため削除できません。予約の紐付けのロックを解除してから削除してください。 | services/plan_item_deletion.py |
| `logo_not_found` | 404 | no | ロゴはまだありません | api/v1/organizations.py |
| `malware_found` | 422 | no | ファイルから有害なプログラムが見つかったため、受け付けませんでした | api/v1/memories.py |
| `member_field_hidden` | 403 | no | 旅行の所有者が「…」をあなたに見せない設定にしています | services/member_policy.py |
| `member_not_found` | 404 | no | メンバーが見つかりません | api/v1/organizations.py |
| `members_only` | 403 | no | 旅行記の公開は会員だけができます(会員登録すると公開できます) | api/v1/memory_publish.py |
| `mention_target_hidden` | 422 | no | その人はこの対象を見られないため、メンションできません | api/v1/discussion.py |
| `metadata_unremovable` | 422 | no | 写真の撮影情報(撮影位置など)を取り除けないため、受け付けられません | api/v1/memories.py |
| `mfa_enrollment_required` | — | — | 管理者の画面を使うには、設定 → セキュリティで多要素認証(認証アプリ)を有効にしてください | api/v1/admin.py |
| `mfa_step_up_required` | — | — | 管理者の画面を使うには、認証アプリの確認コードを入力してください | api/v1/admin.py |
| `mode_mismatch` | 409 | after_reload | この旅行の位置の設定と違う保存先です。先に設定を変えてください | api/v1/location_tracks.py |
| `no_assessment` | 404 | no | この予定にはまだ判定がありません | api/v1/visits.py |
| `no_change` | 422 | no | 今の値と同じです | api/v1/corrections.py |
| `no_changes` | 403, 409, 422 | no | 本案からの変更がありません | api/v1/branches.py, api/v1/memories.py, api/v1/memory_replan.py, api/v1/optimization.py, api/v1/plan_cover.py, api/v1/re |
| `no_email` | 409 | no | メールアドレスが登録されていません | api/v1/notifications.py |
| `no_ops_selected` | 422 | no | 採用する変更を選んでください | api/v1/branches.py |
| `no_previous` | 409 | no | 元の値が無いため取り消せません | api/v1/corrections.py |
| `no_trip_period` | 409 | no | 旅行の日程が無いため記録できません。先に日程を登録してください | api/v1/location_tracks.py |
| `not_adopted` | — | — | この投票はまだ採用していません | api/v1/decisions.py |
| `not_areas_only` | 409 | no | 訪問地域を送れるのは「訪問地域だけ同期」の軌跡だけです | api/v1/location_tracks.py |
| `not_conflicted` | 409 | no | この操作は競合していません | api/v1/sync.py |
| `not_eligible` | 422 | no | 移譲できるのは、参加済みの会員の共同編集者だけです(招待中・ゲスト・削除の申し込み中の人は選べません) | api/v1/ownership.py |
| `not_intent_draft` | 404 | no | この旅行は旅行相談から作った下書きではありません | api/v1/trip_intents.py |
| `not_scheduled` | 409 | no | 削除の申し込みはありません | api/v1/privacy.py |
| `not_undoable` | 409 | no | このコマンドは元に戻せません | api/v1/commands.py |
| `nothing_to_publish` | — | — | 公開できる自分の記録がありません(旅行記に含める記録を書いてください) | api/v1/memory_publish.py |
| `ops_reason_required` | — | — | 理由を200文字までで入力してください | api/v1/admin_ops.py |
| `optimization_stale` | 409 | after_reload | 候補を計算した後に旅程・制約・予約が変わりました。もう一度候補を計算してください | api/v1/optimization.py |
| `organization_not_found` | 404 | no | 組織が見つかりません | services/organizations.py |
| `outside_trip_period` | 409 | no | 位置の記録は旅行の期間中(前日から最終日まで)だけ始められます | api/v1/location_tracks.py |
| `owner_can_edit` | 422 | no | 所有者は旅行の画面で直接直せます | api/v1/corrections.py |
| `owner_only` | 403 | no | 旅行全体のエクスポートは所有者だけが行えます。自分のデータはアカウントのエクスポートで取得できます。 | api/v1/data_export.py |
| `ownership_transfer_pending` | 409 | no | 所有者の移譲の手続き中です。移譲を取り下げるか、相手が受け入れる・断るまでお待ちください | api/v1/ownership.py |
| `poll_adopted` | 409 | no | 予定に採用した投票は変えられません(先に採用を元に戻してください) | api/v1/discussion.py |
| `poll_not_decided` | — | — | まだ決定していません(先に選択肢を決定してください) | api/v1/decisions.py |
| `privacy_zone_not_found` | 404 | no | 守る範囲が見つかりません | api/v1/privacy_zones.py |
| `profile_empty` | 409 | no | 非公開の条件がまだありません。設定 → 非公開の条件 で登録してください | api/v1/private_profile.py |
| `profile_unreadable` | 409 | no | 保存済みの内容を復号できないため変更できません | api/v1/private_profile.py |
| `proposal_not_found` | 409 | after_reload | この提案は今は使えません。提案を読み込み直してください | api/v1/memory_replan.py |
| `provider_disabled` | 404 | no | この画像の提供元は使えません(止めてあります) | api/v1/media_providers.py |
| `provider_not_ready` | 503 | later | 提供元が要求を受け付けませんでした(鍵・権限・課金)。枠は使っていません。手で続けられます | api/v1/paid_actions.py |
| `provider_rejected` | 503 | later | 提供元が要求を受け付けませんでした(鍵・権限・課金)。枠は使っていません。手で続けられます | api/v1/paid_actions.py |
| `publication_not_found` | 404 | no | 公開が見つかりません | api/v1/memory_publish.py |
| `quorum_not_met` | 409 | no | 回答者が定足数(%d人)に届いていないため、決定できません(今 %d人) | api/v1/discussion.py |
| `quota_exceeded` | 429 | later | …の…の上限に達しました。 | services/usage.py |
| `quota_override_requires_pro` | — | — | 上限の例外は Pro/B2B の契約(クラス pro の付与)がある利用者だけに付けられます | api/v1/planning_usage.py |
| `rate_limited` | 429 | later | 閲覧が多すぎます。しばらく待ってください | api/v1/admin_support.py, api/v1/corrections.py, api/v1/organizations.py, api/v1/ownership.py, api/v1/privacy.py |
| `reauth_failed` | 403 | no | パスワードが正しくありません | api/v1/corrections.py, api/v1/ownership.py, api/v1/privacy.py |
| `registered_only` | 403 | no | 訂正の記録は会員登録したアカウントだけが使えます | api/v1/corrections.py, api/v1/ownership.py |
| `replan_closed` | 409 | no | 適用・却下した再計画案は適用できません | api/v1/replans.py |
| `replan_conflict` | 409 | after_reload | 旅程と食い違う変更があるため適用できません。もう一度再計画案を作ってください | api/v1/replans.py |
| `replan_stale` | 409 | after_reload | 提案を作った後に旅程か過去の記録が変わりました。提案を読み込み直してください | api/v1/memory_replan.py, api/v1/replans.py |
| `revision_conflict` | 409 | after_reload | 候補が他の人の変更で更新されています(現在のrevision: …) | api/v1/candidates.py, api/v1/journey.py, api/v1/location_tracks.py, api/v1/memories.py, api/v1/places.py, api/v1/visits. |
| `revision_mismatch` | 409 | after_reload | ほかの画面で変更されました。読み込み直してください | services/private_profile.py |
| `revoked` | 410 | no | この版は失効しています | api/v1/booklet.py |
| `same_candidate` | — | — | 同じ候補へはまとめられません | api/v1/candidates.py |
| `same_plan` | 409 | no | 同じ旅行へは戻せません。別の旅行を選んでください | api/v1/journey.py |
| `scan_unavailable` | 503 | later | ファイルの安全確認ができないため、今は受け付けられません | api/v1/memories.py |
| `schedule_not_available` | 422 | no | ゲストのアカウントは猶予つきの削除を使えません(今すぐ削除するか、会員登録してください) | api/v1/privacy.py |
| `scheduled` | 409 | no | 予定に配置済みの候補は、予定を消すと候補に戻ります | api/v1/candidates.py |
| `seat_limit_below_members` | 409 | no | 今のメンバー(…人)より少なくはできません。先にメンバーを外してください | api/v1/organizations.py |
| `seat_limit_reached` | 409 | no | 席の上限(…人)に達しています。上限を見直すか、メンバーを外してください | api/v1/organizations.py |
| `secret_not_registered` | 409 | no | この画面で登録した有効な鍵はありません | api/v1/admin_ops.py |
| `self_target` | — | — | 自分自身のアカウントはこの画面から操作できません | api/v1/admin.py |
| `sensitive_creator_only` | 403 | no | 機密情報を含む版は作成者だけが表示できます | api/v1/booklet.py |
| `sensitive_requires_owner` | — | — | 予約番号・住所・電話・参加者名を含めた出力は旅行の所有者だけが作成できます | api/v1/booklet.py |
| `share_view_expired` | — | — | 閲覧の時間が過ぎました。もう一度リンクを開いてください | api/v1/public_share.py |
| `source_plan_gone` | 409 | no | 元の旅行が削除されているため改訂できません | api/v1/organizations.py |
| `stale_version` | 409 | after_reload | 配布が別の操作で改訂されています。読み直してください | api/v1/organizations.py |
| `storage_failed` | 503 | later | ファイルの保存に失敗しました。しばらくしてから再試行してください | api/v1/memories.py |
| `sync_operation_missing` | 404 | no | 同期の記録が見つかりません | api/v1/sync.py |
| `target_merged` | — | — | まとめ先の候補は、すでに別の候補へまとめられています | api/v1/candidates.py |
| `test_tier_disabled` | 403 | no | 本番・staging の環境ではクラスの試験の切り替えをしません | api/v1/admin_ops.py |
| `too_many` | 409 | no | 1つの旅行の候補は…件までです | api/v1/candidates.py |
| `too_many_budget_versions` | 409 | no | 予算の版は…件までです | api/v1/finance_ledger.py |
| `too_many_clients` | 409 | no | 使える連携は…件までです | api/v1/organizations.py |
| `too_many_domains` | 409 | no | 登録できるドメインは…件までです | api/v1/organizations.py |
| `too_many_fx_rates` | 409 | no | 為替の記録は…件までです | api/v1/finance_ledger.py |
| `too_many_items` | — | — | 条件は…件までです | services/private_profile.py |
| `too_many_memories` | — | — | 1つの旅行の記録は…件までです | api/v1/memories.py |
| `too_many_organizations` | 409 | no | 作れる組織は…までです | api/v1/organizations.py |
| `too_many_privacy_zones` | 409 | no | 守る範囲は…件までです | api/v1/privacy_zones.py |
| `too_many_publications` | 409 | no | 公開中の旅行記は…件までです | api/v1/memory_publish.py |
| `too_many_streams` | 429 | later | 同時に開いている画面が多すぎます。使っていない画面を閉じてください | api/v1/presence.py |
| `too_many_webhooks` | 409 | no | Webhook は…件までです | api/v1/organizations.py |
| `track_active` | 409 | no | この旅行では記録中(または一時停止中)の軌跡があります。止めてから始めてください | api/v1/location_tracks.py |
| `track_full` | 409 | no | 1つの軌跡の点は…件までです。新しく記録を始めてください | api/v1/location_tracks.py |
| `transfer_closed` | 409 | no | この申し出は既に閉じています | api/v1/ownership.py |
| `transfer_expired` | 410 | no | 申し出の期限が過ぎています。所有者にもう一度申し出てもらってください | api/v1/ownership.py |
| `transfer_invalidated` | 409 | no | 旅行の所有者・参加の状態が変わったため、この申し出は無効になりました | api/v1/ownership.py |
| `trash_not_found` | 404 | no | 元に戻せる記録が見つかりません(期限は削除から7日です) | api/v1/memory_publish.py |
| `trash_unreadable` | 409 | no | この記録は読めないため戻せません | api/v1/memory_publish.py |
| `trip_pass_already_assigned` | 409 | no | この旅行には既に Trip Pass が割り当てられています | api/v1/planning_usage.py |
| `two_person_required` | 409 | no | 申請した管理者とは別の管理者が承認してください | api/v1/planning_usage.py |
| `undo_conflict` | 409 | after_reload | この候補は後で使われた(予定に置いた・まとめた)ため、元に戻せません | api/v1/commands.py, services/plan_item_deletion.py |
| `undo_not_latest` | 409 | no | この後に別の変更があるため、元に戻せません(変更の履歴から戻してください) | api/v1/commands.py |
| `unknown_branch_ops` | 422 | no | この案に無い変更が選ばれています | api/v1/branches.py |
| `unknown_event` | — | — | この旅行の位置のある予定ではありません | api/v1/visits.py |
| `unknown_plan` | 422 | no | 参加していない旅行は指定できません | api/v1/atlas.py |
| `unknown_planning_operation` | — | — | 知らない操作です | api/v1/planning_usage.py |
| `unknown_provider` | 404 | no | 知らない提供元です | api/v1/admin_ops.py |
| `unknown_secret_slot` | 404 | no | 知らない鍵の種類です | api/v1/admin_ops.py |
| `unlock_reason_required` | 422 | no | 締めを解除する理由を200文字までで入力してください | api/v1/finance_ledger.py |
| `unsupported_platform` | — | — | 対応していない SNS の URL です | api/v1/candidates.py |
| `unsupported_type` | — | — | 対応していない形式の画像です | api/v1/media_providers.py |
| `usage_reason_required` | 422 | no | 上書きの理由を200文字までで入力してください | api/v1/admin.py |
| `user_not_found` | 404 | no | 利用者が見つかりません | api/v1/admin_ops.py, api/v1/organizations.py |
| `username_taken` | 409 | no | この表示名は既に使われています | api/v1/corrections.py |
| `valid_until_required` | 422 | no | 機密情報を含む版には有効期限が必要です | api/v1/booklet.py |
| `void_reason_required` | 422 | no | 取り消す理由を200文字までで入力してください | api/v1/finance_ledger.py |
| `webhook_not_found` | 404 | no | Webhook が見つかりません | api/v1/organizations.py |
| `webhook_revoked` | 409 | no | 止めた Webhook の鍵は作り直せません | api/v1/organizations.py |
