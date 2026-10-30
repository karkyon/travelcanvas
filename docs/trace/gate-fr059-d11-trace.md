# Gate FR059-D11 トレース(無料の provider の使用の記録・公開の単価の再確認)

対象: 利用者の監査「TravelCanvas 最新ソース監査と Claude 作業継続指示」(2026-10-30)の Gate C。FR-059 正本 §2.3・§13 D11。
migration なし(既存の `provider_usage_events` の列だけで記録する)。実の有料の API へは送らない。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 無料の provider へ送った回数を 0円・価格の版 `free` で記録。言葉・URL・座標・結果は残さない | IMPLEMENTED | `backend/app/services/free_usage.py`、BE `test_gate_fr059_d11_free_usage.py` |
| 2 | 有料の provider の名前では記録できない(0円で有料の呼び出しを隠さない) | IMPLEMENTED | 同上 `test_record_is_zero_yen_and_keeps_no_content` |
| 3 | 記録の失敗で機能を止めない(savepoint の中で書く) | IMPLEMENTED | 同上 `test_record_failure_does_not_break_the_caller` |
| 4 | 近くの検索(`/search/spots`): 送った provider ごとに ok / empty / unavailable | IMPLEMENTED | `search.py`・`search_provider.ProviderResults.called` |
| 5 | 旅行相談の方面の比較(`/trip-intents/areas`): Nominatim へ実際に送った回数だけ(cache は数えない) | IMPLEMENTED | `trip_intent._network_calls`・`trip_intents.py` |
| 6 | 外部の写真(Wikimedia Commons)の検索・縮小・取込、SNS の oEmbed | IMPLEMENTED | `media_providers.py` |
| 7 | 運用コンソールの概要: 無料の送信の回数を、有料の見込みと分けて出す(0円・50円の枠の外) | IMPLEMENTED | `GET /admin/ops/overview` の `free_usage`、FE `AdminOpsPage.tsx` |
| 8 | 価格の版の単価が今の公開の単価以上か(2026-10-31) | IMPLEMENTED | FR-059 正本 §2.2.1。版は変えない(全て公開の単価以上) |
| 9 | Redis を使う試験が CI で飛ばされない | IMPLEMENTED(既存) | CI の「Redis を使う試験の実行の確認 (ブロッキング)」(main の run 41070234927 の backend ジョブの step 16 が success) |
| 10 | SNS の題名の地名の照合(social.py の中の Nominatim)を別に数える | NOT STARTED | oEmbed の1回に含める(正本 §13 D11) |
| 11 | 実の有料の API の1回の確認・請求の明細との照合 | NOT STARTED | 利用者の承認(契約・鍵・金額)と adapter の Gate の後 |
