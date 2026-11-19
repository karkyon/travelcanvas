"""FC-001〜100 の意味に沿った「根拠の候補」の検索(語の一致)。

DOC-02 v6.0 §9.1〜9.9 の各 FC の意味から検索語を決め、backend/app・backend/tests・frontend/src・frontend の試験と e2e を検索する。
結果は**根拠の候補**であり、「検証済み」「実装済み」の判定ではない(語の一致は意味の一致を保証しない)。
使い方: python3 scripts/audit/scan_fc_semantic.py > docs/audit/2026-11-19_fc001-100_semantic_map.md
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PATTERNS = {
 'FC-001': 'recovery_code|回復コード|guest.*recover|ゲスト.*回復',
 'FC-002': 'email/verify|verify_email|メール確認|email_verif',
 'FC-003': 'change-password|change_password',
 'FC-004': 'locked_until|lockout|failed_login|account_lock|ロックアウト',
 'FC-005': 'ownership-transfer|OwnershipTransfer|ownership_transfer',
 'FC-006': 'clone_travel_plan|/clone|clonePlan|旅行を複製',
 'FC-007': 'is_template|テンプレート化|saveAsTemplate|fork_distribution',
 'FC-008': 'list_deleted_travel_plans|travel-plans/deleted|restore_travel_plan|purge_travel_plan|ゴミ箱',
 'FC-009': 'time_of_day|unscheduled|時刻未定|時間帯だけ|未定の予定|time_undecided',
 'FC-010': 'multi_day|複数日|spans_days|end_local_date',
 'FC-011': 'recurr|repeat_rule|繰り返し|繰返し|毎朝',
 'FC-012': 'bulk_edit|一括編集|commands/execute|execute_command|bulkMove',
 'FC-013': 'undo_last_change|/undo|undo_command|Undo|元に戻す',
 'FC-014': 'autosave|自動保存|memoQueue|draft.*persist',
 'FC-015': 'DateNavigation|日付ジャンプ|jumpToDay|jump_to_day',
 'FC-016': 'timezone_id|zone_for|ambiguous_time|nonexistent_time|DST|夏時間',
 'FC-017': 'depends_on|prerequisite|先行条件|after_checkin|チェックイン後',
 'FC-018': 'buffer_minutes|prep_minutes|バッファ|security_buffer|余裕時間',
 'FC-019': 'read_place_url|readPlaceUrl|canonical_url|url_import|safe_fetch|ssrf',
 'FC-020': 'ocr_|exif|image_search|photo.*gps|写真.*位置情報',
 'FC-021': 'SpeechRecognition|transcript|音声|voice_search|文字起こし',
 'FC-022': 'placesFromText|aiPlacesFromText|自然文|natural_language|extract_intent',
 'FC-023': 'merge_candidate|duplicate_candidate|重複候補|dedup|find_duplicates',
 'FC-024': 'list_wish|WishSpot|wish_spots|お気に入り|add_favorite',
 'FC-025': 'reason_for|rationale|提案理由|recommend_reason|why_suggested',
 'FC-026': 'share_report|report_candidate|不適切|閉業|誤住所|abuse_report',
 'FC-027': 'geocode_distance|far_from_address|離れて|confirm_pin|geocodeAddress',
 'FC-028': 'put_entrances|entrances|入口',
 'FC-029': 'meeting_point|rendezvous|集合地点|split_off|別行動',
 'FC-030': 'opening_hours|special_hours|last_order|ラストオーダー|last_entry|最終入場',
 'FC-031': 'admission|入場料|price_note|fare_by_age|price_range',
 'FC-032': 'accessib|wheelchair|stroller|車いす|ベビーカー|elevator|エレベーター',
 'FC-033': 'MapLayer|地図レイヤー|layer_toggle|visible_layers|map_layers',
 'FC-034': 'external-map|mymaps|redact.*location|map_share|共有.*実位置',
 'FC-035': 'check_in|checkin|宿泊予約|lodging|deposit',
 'FC-036': 'flight|PNR|terminal|航空|boarding',
 'FC-037': 'car_number|号車|train_seat|rail_|鉄道予約',
 'FC-038': 'allerg|アレルギー|dining_reservation|course_name',
 'FC-039': 'voucher|バウチャー|waiver|免責|experience_reserv',
 'FC-040': 'rental_car|rent_a_car|レンタカー|return_branch',
 'FC-041': 'reservation.*version|cancel.*mail|取消メール|update_mail|reservation_history',
 'FC-042': 'duplicate.*reservation|reservation.*duplicate|find_duplicate_reserv|予約の重複',
 'FC-043': 'barcode|aztec|qr_payload|ticket.*display|reveal_ticket|brightness',
 'FC-044': 'wallet|passkit|pkpass|Google Wallet|Apple Wallet',
 'FC-045': 'document_version|replace_document|文書差替|supersede|extracted_from_version',
 'FC-046': 'passport|旅券|visa|ビザ',
 'FC-047': 'insurance|保険|emergency_contact|緊急連絡',
 'FC-048': 'receipt|領収書|receipt_ocr',
 'FC-049': 'route_options|add_route_leg|legs|leg_id',
 'FC-050': 'transfer_margin|乗換余裕|transfer_buffer|min_transfer',
 'FC-051': 'last_train|終電|last_transport|curfew|門限',
 'FC-052': 'parking|駐車|fuel|給油|charging|充電',
 'FC-053': 'locker|コインロッカー|luggage|荷物',
 'FC-054': 'max_continuous|休憩|meal_interval|食事間隔|fatigue|rest_break',
 'FC-055': 'budget_limit|max_budget|予算上限|private_budget|budgets',
 'FC-056': 'hours_check|get_hours_check|営業時間外|closed_on',
 'FC-057': 'arrival_buffer|受付終了|late_tolerance|reservation_time_violation|遅刻',
 'FC-058': 'solver_seed|seed|reproduc|coefficients|optimization_run',
 'FC-059': 'partial-preview|optimization_partial_preview|unlocked_only|選択した日',
 'FC-060': 'fairness|min_satisfaction|公平|satisfaction',
 'FC-061': 'accept_invitation|decline_invitation|invitation_mismatch|招待.*別のアカウント',
 'FC-062': 'max_views|field_policy|share.*expire|access_log|share_access',
 'FC-063': 'revision_conflict|If-Match|conflict_fields|changed_fields|競合',
 'FC-064': 'acknowledge_distribution|acknowledgement|既読確認|read_receipt',
 'FC-065': 'deadline|abstain|棄権|poll.*close|締切',
 'FC-066': 'resolve_vote|resolution|懸念|concern',
 'FC-067': 'k_anonym|min_group|閾値|aggregate_only|集約.*推測',
 'FC-068': 'assignee|assigned_to|担当',
 'FC-069': 'packing-suggestions|get_packing_suggestions|packing_suggest',
 'FC-070': 'medication|medicine|薬|健康用品',
 'FC-071': 'budget-versions|budget_version|予算版',
 'FC-072': 'fx-rates|fx_rate|exchange_rate|換算',
 'FC-073': 'share_ratio|split_mode|不均等|shares|exclude_from_split',
 'FC-074': 'refund|cancellation_fee|取消料|返金',
 'FC-075': 'depart_messages|leave_by|出発通知|depart_notify',
 'FC-076': 'gate_change|ゲート変更|gate_changed',
 'FC-077': 'weather_fit|weather_forecast|天候|rain_messages',
 'FC-078': 'closure|休業|closed_alert|alerts/external|external_alert',
 'FC-079': 'emergency_info|緊急情報|emergency_card',
 'FC-080': 'location-settings|share_location|位置共有|sharing_until',
 'FC-081': 'offline-packs|offlinePack|pack_scope|include_documents|パック.*選',
 'FC-082': 'revoke_offline_device|pack.*expir|offline.*revoke|端末.*失効',
 'FC-083': 'operation_id|already_applied|sync_operations',
 'FC-084': 'clock_skew|server_time|時計.*ずれ|time_offset|clockDrift',
 'FC-085': 'low_power|battery|低電力|prefers-reduced-motion|reduce_motion',
 'FC-086': 'lock.?screen|ロック画面|push.*redact|notification.*redact|push_body',
 'FC-087': 'publish_export|noindex|public/booklets|公開版',
 'FC-088': 'watermark|透かし|confidential.*print|機密.*印刷',
 'FC-089': 'monochrome|白黒|grayscale|bw_theme',
 'FC-090': 'imposition|面付|saddle|中綴じ',
 'FC-091': 'export_ics|calendar\\.ics|SEQUENCE|VTIMEZONE',
 'FC-092': 'export_kml|export_gpx|places\\.kml|places\\.gpx',
 'FC-093': 'exif|photo.*taken_at|memory.*event_link|撮影時刻',
 'FC-094': 'create_publication|preview_publication|face_check|公開前.*検査',
 'FC-095': 'memory-replan|get_memory_replan|学習|learning_consent',
 'FC-096': 'support-grants|support_grant|support_session',
 'FC-097': 'abuse|phishing|threat_guard|scraping|spam',
 'FC-098': 'data-export|export_account|data_export|manifest',
 'FC-099': 'purge|account-deletion|cryptographic|delete_account|delete_all_data',
 'FC-100': 'status_page|statuspage|incident|障害告知|maintenance_notice',
}
AREAS = {
 'app': ('backend/app', lambda p: p.endswith('.py')),
 'btest': ('backend/tests', lambda p: p.endswith('.py')),
 'fsrc': ('frontend/src', lambda p: p.endswith(('.ts', '.tsx')) and '.test.' not in p and '__fixtures__' not in p),
 'ftest': ('frontend', lambda p: ('.test.' in p or '/e2e/' in p) and p.endswith(('.ts', '.tsx')) and 'node_modules' not in p),
}


def walk(base, ok):
    out = []
    for d, ds, fs in os.walk(os.path.join(ROOT, base)):
        ds[:] = [x for x in ds if x not in ('node_modules', '__pycache__', '.git', 'dist')]
        for f in fs:
            p = os.path.join(d, f)
            rel = os.path.relpath(p, ROOT)
            if ok(rel):
                out.append(rel)
    return out


def main():
    files = {}
    for a, (b, ok) in AREAS.items():
        for rel in walk(b, ok):
            if a == 'fsrc' and rel in files.get('ftest', {}):
                continue
            try:
                files.setdefault(a, {})[rel] = open(os.path.join(ROOT, rel), encoding='utf-8', errors='ignore').read()
            except OSError:
                pass
    spec = open(os.path.join(ROOT, 'docs/spec/DOC-02_要件定義書_v6.0.md'), encoding='utf-8').read()
    names = {m.group(1): (m.group(2).strip(), m.group(3).strip())
             for m in re.finditer(r'^\| (FC-\d{3}) \| ([^|]+) \| ([^|]+) \|', spec, re.M) if int(m.group(1)[3:]) <= 100}
    assert sorted(names) == sorted(PATTERNS), (set(names) ^ set(PATTERNS))
    rows = []
    for fc in sorted(PATTERNS):
        rx = re.compile(PATTERNS[fc], re.I)
        cnt, top = {}, {}
        for a in AREAS:
            hits = sorted(((len(rx.findall(t)), p) for p, t in files.get(a, {}).items() if rx.search(t)), reverse=True)
            cnt[a] = len(hits)
            top[a] = [p for _, p in hits[:2]]
        app, tst = cnt['app'] + cnt['fsrc'], cnt['btest'] + cnt['ftest']
        cls = ('候補:実装と試験の手がかりあり' if app and tst else '候補:実装の手がかりのみ(試験の手がかり薄)' if app
               else '候補:試験の手がかりのみ' if tst else '手がかりなし')
        rows.append((fc, names[fc][0], names[fc][1], cnt, top, cls))
    print('# FC-001〜100 の意味に沿った根拠の候補の検索(2026-11-19)\n')
    print('生成: `scripts/audit/scan_fc_semantic.py`(再生成できる)。DOC-02 v6.0 §9.1〜9.9 の各 FC の意味から検索語を決め、コード・試験を検索した。')
    print('**これは「根拠の候補」であり、検証済み・実装済みの判定ではない。** 語の一致は意味の一致を保証しない。親 FR の状態を FC の状態として転記していない。'
          '「手がかりなし」も未実装の断定ではなく、検索語が合っていない可能性がある(人の確認が必要)。\n')
    from collections import Counter
    c = Counter(r[5] for r in rows)
    print('## 集計\n\n| 分類 | 件数 |\n|---|---:|')
    for k, v in c.most_common():
        print(f'| {k} | {v} |')
    print('\n## 一覧\n\n| FC | 子機能 | 分類 | 実装(app/fsrc) | 試験(backend/frontend) | 主な手がかり |\n|---|---|---|---|---|---|')
    for fc, n, req, cnt, top, cls in rows:
        ev = '、'.join((top['app'][:1] + top['fsrc'][:1] + top['btest'][:1] + top['ftest'][:1]))
        print(f"| {fc} | {n} | {cls} | {cnt['app']}/{cnt['fsrc']} | {cnt['btest']}/{cnt['ftest']} | {ev or '—'} |")


if __name__ == '__main__':
    sys.exit(main())
