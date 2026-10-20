"""[Gate G1] SEC-F1 暗号化の鍵の版の切り替え・SEC-F2 鍵の一覧と使い回しの検出。

- 今の鍵(ENCRYPTION_KEY)で暗号化し、前の鍵(ENCRYPTION_KEYS_PREVIOUS)でも復号できる
- 掛け直し(app/ops/rekey.py)は前の鍵の暗号文だけを今の鍵へ替え、何度実行しても同じ・途中で止めても続きから
- 同時に書き換えられた行は上書きしない、どの鍵でも読めない値は変えずに隔離する(件数と「表.列」だけ)
- 保存ファイルも一時ファイル経由で掛け直す(権限を保つ)
- 前の鍵を外すと、その鍵の暗号文は読めない(失効)
- 鍵の一覧(app/core/key_inventory.py)と docs/ops/KEY-INVENTORY.md が一致し、用途を越えた使い回しを見つける
"""
import json
import os
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from app.core import crypto
from app.core.config import Settings, production_problems, settings
from app.core.database import engine
from app.core.key_inventory import KEY_NAMES, report, reuse_problems
from app.ops import rekey

KEY_A = "g1-test-only-key-A-0123456789abcdefghijklmnop"
KEY_B = "g1-test-only-key-B-qrstuvwxyz9876543210ABCDEF"
KEY_C = "g1-test-only-key-C-ZYXWVUTSRQ0123456789kjihgf"
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def keys():
    """鍵を切り替える試験のあと、元の鍵へ確実に戻す(他の試験の暗号化に影響させない)。"""
    saved = (settings.ENCRYPTION_KEY, getattr(settings, "ENCRYPTION_KEYS_PREVIOUS", None))

    def use(active, previous=None):
        settings.ENCRYPTION_KEY = active
        settings.ENCRYPTION_KEYS_PREVIOUS = previous
        crypto.reset_cache_for_tests()

    try:
        yield use
    finally:
        settings.ENCRYPTION_KEY, settings.ENCRYPTION_KEYS_PREVIOUS = saved
        crypto.reset_cache_for_tests()


@pytest.fixture()
def probe_table():
    """掛け直しの試験だけが使う表(試験の DB に commit する。終わったら消す)。"""
    name = "tc_g1_rekey_probe_%s" % uuid.uuid4().hex[:8]
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE public."%s" (id integer PRIMARY KEY, note text, value_ciphertext bytea)'
                          % name))
    try:
        yield name
    finally:
        with engine.begin() as conn:
            conn.execute(text('DROP TABLE IF EXISTS public."%s"' % name))


def _insert(table, rows):
    with engine.begin() as conn:
        for ident, value in rows:
            conn.execute(text('INSERT INTO public."%s" (id, value_ciphertext) VALUES (:i, :v)' % table),
                         {"i": ident, "v": value})


def _values(table):
    with engine.connect() as conn:
        return {r[0]: bytes(r[1]) if r[1] is not None else None
                for r in conn.execute(text('SELECT id, value_ciphertext FROM public."%s" ORDER BY id' % table))}


# ---------------------------------------------------------------- 鍵の版(crypto)

def test_previous_key_decrypts_and_new_writes_use_active_key(keys):
    keys(KEY_A)
    old = crypto.encrypt_payload(b"reservation-123")
    assert crypto.key_id_of(old) == crypto.key_id(KEY_A)

    keys(KEY_B, KEY_A)
    assert crypto.keyring_ids() == [crypto.key_id(KEY_B), crypto.key_id(KEY_A)]
    assert crypto.decrypt_payload(old) == b"reservation-123"
    new = crypto.encrypt_payload(b"reservation-456")
    assert crypto.key_id_of(new) == crypto.key_id(KEY_B)

    rotated, was, changed = crypto.reencrypt(old)
    assert changed and was == crypto.key_id(KEY_A)
    assert crypto.key_id_of(rotated) == crypto.key_id(KEY_B)
    assert crypto.decrypt_payload(rotated) == b"reservation-123"
    again, _, changed_again = crypto.reencrypt(rotated)
    assert again == rotated and not changed_again


def test_removed_key_is_revoked(keys):
    keys(KEY_A)
    old = crypto.encrypt_payload(b"secret")
    keys(KEY_B)  # 前の鍵を外した(失効)
    assert crypto.key_id_of(old) is None
    with pytest.raises(ValueError):
        crypto.decrypt_payload(old)
    with pytest.raises(ValueError):
        crypto.reencrypt(old)


def test_previous_keys_parsing_ignores_blanks_duplicates_and_active(keys):
    assert crypto.parse_previous_keys(" a , ,b,a ") == ["a", "b"]
    keys(KEY_B, "%s, %s ,%s" % (KEY_B, KEY_A, KEY_A))
    assert crypto.keyring_ids() == [crypto.key_id(KEY_B), crypto.key_id(KEY_A)]


def test_key_id_matches_ops_fingerprint():
    from app.ops.opslib import key_fingerprint

    assert crypto.key_id(KEY_A) == key_fingerprint(KEY_A)
    assert crypto.key_id(None) is None and len(crypto.key_id(KEY_A)) == 12


# ---------------------------------------------------------------- 掛け直し(DB)

def test_rekey_database_rotates_only_previous_key_and_is_idempotent(keys, probe_table):
    keys(KEY_A)
    a_rows = [(i, crypto.encrypt_payload(b"value-%d" % i)) for i in range(1, 8)]
    keys(KEY_B, KEY_A)
    b_rows = [(i, crypto.encrypt_payload(b"value-%d" % i)) for i in range(8, 11)]
    _insert(probe_table, a_rows + b_rows)
    before = _values(probe_table)

    status = rekey.process_database(None, apply=False, tables=[probe_table])
    totals = status["totals"]
    assert totals["by_key"] == {crypto.key_id(KEY_B): 3, crypto.key_id(KEY_A): 7}
    assert _values(probe_table) == before  # status は何も変えない

    run = rekey.process_database(None, apply=True, batch=3, tables=[probe_table])
    assert run["totals"]["reencrypted"] == 7
    after = _values(probe_table)
    for i in range(1, 11):
        assert crypto.key_id_of(after[i]) == crypto.key_id(KEY_B)
        assert crypto.decrypt_payload(after[i]) == b"value-%d" % i
    for i in range(8, 11):
        assert after[i] == before[i]  # 今の鍵の暗号文は触らない

    second = rekey.process_database(None, apply=True, tables=[probe_table])
    assert second["totals"]["reencrypted"] == 0 and _values(probe_table) == after

    summary = rekey.summarize(second, None, crypto.keyring_ids())
    assert summary["remaining_on_previous_keys"] == 0 and summary["previous_keys_removable"] is True
    # 前の鍵を外しても全て読める
    keys(KEY_B)
    assert all(crypto.decrypt_payload(v) for v in _values(probe_table).values())


def test_rekey_can_stop_midway_and_resume(keys, probe_table):
    keys(KEY_A)
    _insert(probe_table, [(i, crypto.encrypt_payload(b"x%d" % i)) for i in range(1, 6)])
    keys(KEY_B, KEY_A)
    first = rekey.process_database(None, apply=True, batch=2, max_rows=2, tables=[probe_table])
    assert first["totals"]["reencrypted"] == 2
    summary = rekey.summarize(rekey.process_database(None, apply=False, tables=[probe_table]), None,
                              crypto.keyring_ids())
    assert summary["remaining_on_previous_keys"] == 3 and summary["previous_keys_removable"] is False
    rest = rekey.process_database(None, apply=True, tables=[probe_table])
    assert rest["totals"]["reencrypted"] == 3


def test_rekey_does_not_overwrite_concurrent_update(keys, probe_table):
    keys(KEY_A)
    _insert(probe_table, [(1, crypto.encrypt_payload(b"old"))])
    keys(KEY_B, KEY_A)
    newer = crypto.encrypt_payload(b"written-by-user")

    def user_writes(table, column):
        with engine.begin() as conn:
            conn.execute(text('UPDATE public."%s" SET value_ciphertext = :v WHERE id = 1' % table), {"v": newer})

    res = rekey.process_database(None, apply=True, tables=[probe_table], _before_update=user_writes)
    assert res["totals"]["reencrypted"] == 0 and res["totals"]["skipped_concurrent"] == 1
    assert crypto.decrypt_payload(_values(probe_table)[1]) == b"written-by-user"


def test_rekey_quarantines_undecryptable_values(keys, probe_table):
    keys(KEY_C)
    lost = crypto.encrypt_payload(b"under-revoked-key")
    keys(KEY_A)
    _insert(probe_table, [(1, lost), (2, crypto.encrypt_payload(b"fine")), (3, b"not-a-token")])
    keys(KEY_B, KEY_A)
    res = rekey.process_database(None, apply=True, tables=[probe_table])
    assert res["totals"]["undecryptable"] == 2 and res["totals"]["reencrypted"] == 1
    assert res["quarantined_columns"] == ["%s.value_ciphertext" % probe_table]
    values = _values(probe_table)
    assert values[1] == lost and values[3] == b"not-a-token"  # 隔離した値は変えない
    summary = rekey.summarize(res, None, crypto.keyring_ids())
    assert summary["ok"] is False and summary["previous_keys_removable"] is False
    dumped = json.dumps(summary)
    assert "under-revoked-key" not in dumped and "fine" not in dumped  # 中身は出さない


# ---------------------------------------------------------------- 掛け直し(保存ファイル)

def test_rekey_files_rotates_atomically_and_keeps_mode(keys, tmp_path):
    keys(KEY_A)
    (tmp_path / "plan").mkdir()
    a = tmp_path / "plan" / "a.bin"
    a.write_bytes(crypto.encrypt_payload(b"pdf-bytes"))
    os.chmod(a, 0o640)
    (tmp_path / "plain.txt").write_bytes(b"hello")
    keys(KEY_C)
    lost = tmp_path / "lost.bin"
    lost.write_bytes(crypto.encrypt_payload(b"gone"))
    keys(KEY_B, KEY_A)

    status = rekey.process_files(str(tmp_path), apply=False)
    assert status["by_key"][crypto.key_id(KEY_A)] == 1 and status["not_encrypted"] == 1
    assert status["undecryptable"] == 1

    run = rekey.process_files(str(tmp_path), apply=True)
    assert run["reencrypted"] == 1
    assert crypto.key_id_of(a.read_bytes()) == crypto.key_id(KEY_B)
    assert crypto.decrypt_payload(a.read_bytes()) == b"pdf-bytes"
    assert (a.stat().st_mode & 0o777) == 0o640
    assert not list(tmp_path.rglob("*" + rekey.TMP_SUFFIX))
    assert rekey.process_files(str(tmp_path), apply=True)["reencrypted"] == 0


def test_rekey_cli_outputs_counts_only(keys, probe_table, capsys, tmp_path):
    keys(KEY_A)
    _insert(probe_table, [(1, crypto.encrypt_payload(b"cli-secret-value"))])
    keys(KEY_B, KEY_A)
    assert rekey.main(["status", "--table", probe_table, "--files-root", str(tmp_path)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["remaining_on_previous_keys"] == 1 and out["active_key"] == crypto.key_id(KEY_B)
    assert rekey.main(["run", "--table", probe_table, "--files-root", str(tmp_path)]) == 0
    raw = capsys.readouterr().out
    assert json.loads(raw)["previous_keys_removable"] is True
    assert "cli-secret-value" not in raw and KEY_A not in raw and KEY_B not in raw
    keys(KEY_B)
    assert rekey.main(["run", "--table", probe_table]) == 0
    assert "前の鍵" in json.loads(capsys.readouterr().out)["note"]


# ---------------------------------------------------------------- 鍵の一覧・使い回し

def test_key_inventory_document_lists_every_key():
    doc = ROOT / "docs" / "ops" / "KEY-INVENTORY.md"
    if not doc.is_file():
        pytest.skip("リポジトリの根が無い(backend コンテナの中)")
    body = doc.read_text(encoding="utf-8")
    missing = [n for n in KEY_NAMES if "`%s`" % n not in body]
    assert not missing, "docs/ops/KEY-INVENTORY.md に書かれていない鍵: %s" % missing


def test_reuse_problems_detect_cross_purpose_reuse_without_values():
    class S:
        ENCRYPTION_KEY = KEY_A
        ENCRYPTION_KEYS_PREVIOUS = "%s,%s" % (KEY_A, KEY_C)  # 今の鍵と同じ前の鍵は無害
        LOOKUP_INDEX_KEY = KEY_B
        DOCUMENT_DOWNLOAD_SIGNING_KEY = KEY_C  # 前の暗号化の鍵を署名に流用
        JWT_SECRET_KEY = "jwt-" + KEY_B
        OFFLINE_PACK_KEY_SECRET = None
        CHALLENGE_SECRET_KEY = ""
        METRICS_TOKEN = "jwt-" + KEY_B
        DATABASE_URL = "postgresql://dummy-user:%s@db/x" % KEY_B  # 利用者名の dummy は秘密の検査のダミーの印

    problems = reuse_problems(S())
    joined = "\n".join(problems)
    assert "ENCRYPTION_KEYS_PREVIOUS と DOCUMENT_DOWNLOAD_SIGNING_KEY" in joined
    assert "JWT_SECRET_KEY と METRICS_TOKEN" in joined
    assert "LOOKUP_INDEX_KEY と DATABASE_URL のパスワード" in joined
    assert "ENCRYPTION_KEY と ENCRYPTION_KEYS_PREVIOUS" not in joined
    assert KEY_A not in joined and KEY_B not in joined and KEY_C not in joined
    rep = report(S())
    assert any(r["name"] == "OFFLINE_PACK_KEY_SECRET" and r.get("derived_from") == "ENCRYPTION_KEY"
               for r in rep["keys"])
    assert KEY_A not in json.dumps(rep, ensure_ascii=False)


def test_production_requires_separate_offline_pack_key():
    good = {
        "DATABASE_URL": "postgresql://u@db/x",
        "JWT_SECRET_KEY": "Jq7v2Lk9Rm4Tx8Wn3Bd6Hp1Sz5Cf0Gy-a",
        "ENCRYPTION_KEY": "Ek3Nw8Qs1Vb6Yr2Ju9Mx4Lc7Tg0Hd5Pa-b",
        "LOOKUP_INDEX_KEY": "Lk8Hq3Vx6Nb1Wt9Rm4Cs7Jy2Gd5Pf0Za-c",
        "DOCUMENT_DOWNLOAD_SIGNING_KEY": "Ds4Mk9Qw2Vr7Bn1Xj6Lt3Hc8Yg5Pf0Ea-d",
        "METRICS_TOKEN": "Mt5Kx8Rq2Wn7Vb3Lj9Hs4Cd1Gy6",
        "OFFLINE_PACK_KEY_SECRET": None,
        "ENCRYPTION_KEYS_PREVIOUS": "Pv2Xc7Nm4Bq9Wl1Kj6Hg3Fd8Sa5Zr0Ty-f",
        "CHALLENGE_SECRET_KEY": "",
        "DEBUG": False,
        "CORS_ORIGINS": "https://app.travelcanvas.jp",
        "TC_PUBLIC_HOSTS": "",
    }
    s = Settings(_env_file=None, **good)  # development: 起動はできる
    problems = production_problems(s)
    assert any("OFFLINE_PACK_KEY_SECRET" in p for p in problems)
    assert not any("ENCRYPTION_KEYS_PREVIOUS" in p for p in problems)


def test_tcops_keys_command_runs_inside_backend():
    from app.ops import cli

    calls = []

    class FakeProc:
        returncode = 0
        stdout = b'{"ok": true}'
        stderr = b""

    class Fake(cli.Executor):
        def backend_python(self, module_args, *, extra_env=None, target_db=None, check=True):
            calls.append(list(module_args))
            return FakeProc()

    ex = Fake()
    assert cli.cmd_keys(ex, "check", []) == 0
    assert cli.cmd_keys(ex, "status", ["--no-files"]) == 0
    assert cli.cmd_keys(ex, "rekey", ["--batch", "100"]) == 0
    assert calls == [["-m", "app.ops.keys", "check"], ["-m", "app.ops.rekey", "status", "--no-files"],
                     ["-m", "app.ops.rekey", "run", "--batch", "100"]]


def test_keys_check_reports_without_values(capsys):
    from app.ops import keys as keys_cli

    code = keys_cli.main(["check"])
    raw = capsys.readouterr().out
    out = json.loads(raw)
    assert code in (0, 1) and {"keys", "reuse_problems", "weak_or_missing"} <= set(out)
    if settings.ENCRYPTION_KEY:
        assert settings.ENCRYPTION_KEY not in raw


def test_lookup_index_rebuild_after_key_change(auth_client, db_session, monkeypatch):
    """LOOKUP_INDEX_KEY を替えた後は --all で全ての索引を今の鍵で作り直す(NULL の索引だけ埋める既定とは別)。"""
    from app.api.v1 import plan_search as psapi
    from app.models.models import Reservation
    from app.ops import backfill_lookup_index as bf

    client, _user = auth_client
    monkeypatch.setattr(psapi, "check_rate_limit", lambda *a: True)
    p = client.post("/api/v1/travel-plans/", json={"title": "索引の作り直し"}).json()["id"]
    r = client.post(f"/api/v1/plans/{p}/reservations", json={
        "type": "accommodation", "provider_name": "G1の宿", "confirmation_number": "G1-5566-7788"})
    assert r.status_code in (200, 201), r.text
    row = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(r.json()["id"])).one()
    old_hash = row.confirmation_number_lookup_hash
    saved = settings.LOOKUP_INDEX_KEY
    try:
        settings.LOOKUP_INDEX_KEY = "g1-test-only-new-lookup-index-key-0123456789"
        crypto.reset_cache_for_tests()
        assert bf.backfill(db_session)["reservations_filled"] == 0  # 既定は NULL だけ
        assert row.confirmation_number_lookup_hash == old_hash
        assert bf.backfill(db_session, recompute=True)["reservations_filled"] >= 1
        assert row.confirmation_number_lookup_hash == crypto.compute_lookup_hash("G1-5566-7788") != old_hash
        assert row.confirmation_number_suffix_lookup_hash == crypto.compute_suffix_lookup_hash("G1-5566-7788")
    finally:
        settings.LOOKUP_INDEX_KEY = saved
        crypto.reset_cache_for_tests()
