"""[Gate G3] SEC-F5 鍵の破棄による削除(旅行・利用者ごとのデータ鍵)・SEC-F6 TOTP の鍵の版と二者の確認。

- 旅行の予約番号などは旅行のデータ鍵で暗号化する(tc2:dek:)。鍵は ENCRYPTION_KEY で包んで data_keys に持つ
- 旅行の完全削除・アカウントの削除で鍵を破棄する。破棄した鍵の暗号文は読めず、点検では「消した」(erased)に数える
- ENCRYPTION_KEY を切り替えると、掛け直し(rekey run)は data_keys の行を包み直す(データの暗号文はそのまま読める)
- 以前の暗号文をデータ鍵へ移す・戻す(convert --to envelope / legacy)。何度実行しても同じ
- バックアップの鍵の写しから破棄した鍵を消す(purge_escrow_lines)。写し(export)と入れ直し(import)
- TOTP の秘密は MFA_KEY(版つき、データの鍵とは別)で包む。切り替えと、以前の暗号文の包み直し
- 多要素認証の解除は申請と承認(別の管理者)。本人は申請も承認もできない。期限切れ
"""
import base64
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.core import crypto
from app.core.config import settings
from app.core.database import engine
from app.models.models import Reservation, TravelPlan, User, UserMfa  # noqa: F401
from app.ops import key_escrow, opslib, rekey
from app.services import data_keys, mfa_reset, plan_deletion

KEY_A = "g3-test-only-key-A-0123456789abcdefghijklmnop"
KEY_B = "g3-test-only-key-B-qrstuvwxyz9876543210ABCDEF"
MFA_A = "g3-test-only-mfa-A-0123456789abcdefghijklmnop"
MFA_B = "g3-test-only-mfa-B-qrstuvwxyz9876543210ABCDEF"


@pytest.fixture()
def keys():
    saved = (settings.ENCRYPTION_KEY, getattr(settings, "ENCRYPTION_KEYS_PREVIOUS", None),
             getattr(settings, "MFA_KEY", None), getattr(settings, "MFA_KEYS_PREVIOUS", None))

    def use(active, previous=None, mfa=None, mfa_previous=None):
        settings.ENCRYPTION_KEY = active
        settings.ENCRYPTION_KEYS_PREVIOUS = previous
        settings.MFA_KEY = mfa
        settings.MFA_KEYS_PREVIOUS = mfa_previous
        crypto.reset_cache_for_tests()

    try:
        yield use
    finally:
        (settings.ENCRYPTION_KEY, settings.ENCRYPTION_KEYS_PREVIOUS,
         settings.MFA_KEY, settings.MFA_KEYS_PREVIOUS) = saved
        crypto.reset_cache_for_tests()


def _plan(client):
    return client.post("/api/v1/travel-plans/", json={"title": "G3鍵"}).json()["id"]


def _dek_rows(subject_type, subject_id):
    with engine.connect() as conn:
        return conn.execute(text("SELECT id, wrapped_key_ciphertext, destroyed_at FROM data_keys "
                                 "WHERE subject_type = :t AND subject_id = :s"),
                            {"t": subject_type, "s": uuid.UUID(str(subject_id))}).fetchall()


# ---------------------------------------------------------------- データ鍵

def test_plan_data_is_encrypted_with_the_plan_data_key(auth_client, db_session):
    client, _owner = auth_client
    p = _plan(client)
    res = client.post(f"/api/v1/plans/{p}/reservations",
                      json={"type": "restaurant", "provider_name": "店", "confirmation_number": "ABC-12345"})
    assert res.status_code == 201, res.text
    r = db_session.query(Reservation).filter(Reservation.plan_id == uuid.UUID(p)).one()
    raw = bytes(r.confirmation_number_ciphertext)
    env = crypto.parse_envelope(raw)
    assert env is not None and env[0] == "dek"
    rows = _dek_rows("plan", p)
    assert len(rows) == 1 and uuid.UUID(str(rows[0][0])).hex == env[1] and rows[0][2] is None
    assert b"ABC-12345" not in raw and b"ABC-12345" not in bytes(rows[0][1])  # 鍵も値も平文で残さない
    assert crypto.decrypt_payload(raw) == b"ABC-12345"
    # 画面には今までどおり(伏せて)出る
    listed = client.get(f"/api/v1/plans/{p}/reservations").json()
    assert "2345" in json.dumps(listed, ensure_ascii=False)
    # 2つ目の値も同じ旅行の鍵(旅行ごとに1つ)
    crypto.encrypt_payload(b"x", crypto.plan_subject(p))
    assert len(_dek_rows("plan", p)) == 1


def test_destroyed_key_makes_ciphertext_unreadable_and_is_counted_as_erased(keys):
    keys(KEY_A)
    subj = data_keys.subject("plan", uuid.uuid4())
    token = crypto.encrypt_payload(b"secret", subj)
    assert crypto.key_id_of(token) == crypto.key_id(KEY_A)
    with engine.begin() as conn:
        from sqlalchemy.orm import Session

        s = Session(bind=conn)
        assert data_keys.destroy(s, subj[0], subj[1], "test") == 1
        s.flush()
    with pytest.raises(data_keys.DataKeyDestroyed):
        crypto.decrypt_payload(token)
    assert crypto.key_id_of(token) is None
    assert rekey._erased(token) is True
    assert rekey._erased(crypto.ENVELOPE_PREFIX + b"dek:" + uuid.uuid4().hex.encode() + b":x") is False  # 記録が無い
    with pytest.raises(ValueError):
        crypto.reencrypt(token)
    rows = _dek_rows(*subj)
    assert rows[0][1] is None and rows[0][2] is not None  # 中身を消し、破棄した記録だけ


def test_plan_purge_destroys_the_plan_key(auth_client, db_session):
    client, owner = auth_client
    p = _plan(client)
    client.post(f"/api/v1/plans/{p}/reservations",
                json={"type": "restaurant", "provider_name": "店", "pin": "4321"})
    assert len(_dek_rows("plan", p)) == 1
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).one()
    plan_deletion.soft_delete_plan(db_session, plan, owner.id)
    db_session.commit()
    assert plan_deletion.purge_plan(db_session, plan, owner.id) is True
    row = db_session.execute(text("SELECT wrapped_key_ciphertext, destroyed_at, destroy_reason FROM data_keys "
                                  "WHERE subject_type = 'plan' AND subject_id = :s"), {"s": uuid.UUID(p)}).one()
    assert row[0] is None and row[1] is not None and row[2] == "plan_purge"


def test_account_deletion_destroys_the_user_key(auth_client, db_session):
    from app.services import account_deletion, private_profile

    client, owner = auth_client
    private_profile.save_items(db_session, owner.id, [{"kind": "allergy", "value": "そば"}]) \
        if hasattr(private_profile, "save_items") else None
    crypto.encrypt_payload(b"profile", crypto.user_subject(owner.id))
    assert len(_dek_rows("user", owner.id)) == 1
    summary = account_deletion.delete_account(db_session, db_session.query(User).filter(User.id == owner.id).one())
    assert summary["data_keys_destroyed"] == 1
    row = db_session.execute(text("SELECT destroyed_at, destroy_reason FROM data_keys WHERE subject_type = 'user' "
                                  "AND subject_id = :s"), {"s": owner.id}).one()
    assert row[0] is not None and row[1] == "account_deletion"


def test_kek_rotation_rewraps_data_keys_and_values_stay_readable(keys):
    keys(KEY_A)
    subj = data_keys.subject("plan", uuid.uuid4())
    token = crypto.encrypt_payload(b"value", subj)
    dek_id = crypto.parse_envelope(token)[1]
    keys(KEY_B, KEY_A)  # 鍵を切り替える(前の鍵で包んだ鍵は読める)
    assert crypto.decrypt_payload(token) == b"value"
    res = rekey.process_database(None, apply=True, tables=["data_keys"])
    assert res["totals"]["reencrypted"] >= 1
    keys(KEY_B)  # 前の鍵を外す(失効)。包み直した鍵で読める
    data_keys.reset_cache()
    assert crypto.decrypt_payload(token) == b"value"
    with engine.connect() as conn:
        wrapped = conn.execute(text("SELECT wrapped_key_ciphertext FROM data_keys WHERE id = :i"),
                               {"i": uuid.UUID(dek_id)}).scalar()
    assert crypto.key_id_of(bytes(wrapped)) == crypto.key_id(KEY_B)


@pytest.fixture()
def probe(monkeypatch):
    """変換・掛け直しの試験だけが使う表(試験の DB に commit する)。旅行のデータ鍵の対象・TOTP の列として登録する。"""
    name = "zz_g3_conv_" + uuid.uuid4().hex[:8]
    with engine.begin() as conn:
        conn.execute(text(f'CREATE TABLE "{name}" (id integer primary key, plan_id uuid, '
                          'value_ciphertext bytea, totp_ciphertext bytea)'))
    monkeypatch.setitem(rekey.SUBJECT_SQL, name, ("plan", "t.plan_id"))
    monkeypatch.setattr(rekey, "MFA_COLUMNS", {(name, "totp_ciphertext")})
    try:
        yield name
    finally:
        with engine.begin() as conn:
            conn.execute(text(f'DROP TABLE IF EXISTS "{name}"'))


def _probe_value(table, col="value_ciphertext"):
    with engine.connect() as conn:
        return bytes(conn.execute(text(f'SELECT {col} FROM "{table}" WHERE id = 1')).scalar())


def test_convert_to_envelope_and_back_is_idempotent(probe, keys):
    keys(KEY_A)
    plan_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(f'INSERT INTO "{probe}" VALUES (1, :p, :v, NULL)'),
                     {"p": plan_id, "v": crypto.encrypt_payload(b"LEGACY-1")})
    out = rekey.convert_database(None, "envelope")
    assert out["ok"] and out["converted"] >= 1
    moved = _probe_value(probe)
    env = crypto.parse_envelope(moved)
    assert env and env[0] == "dek" and crypto.decrypt_payload(moved) == b"LEGACY-1"
    assert len(_dek_rows("plan", plan_id)) == 1
    assert rekey.convert_database(None, "envelope")["converted"] == 0  # もう一度実行しても変わらない
    out = rekey.convert_database(None, "legacy")
    assert out["ok"] and out["converted"] >= 1
    legacy = _probe_value(probe)
    assert crypto.parse_envelope(legacy) is None and crypto.decrypt_payload(legacy) == b"LEGACY-1"
    assert rekey.convert_database(None, "legacy")["converted"] == 0


def test_status_counts_erased_separately_from_undecryptable(keys):
    keys(KEY_A)
    table = "zz_g3_probe_" + uuid.uuid4().hex[:8]
    subj = data_keys.subject("plan", uuid.uuid4())
    alive = crypto.encrypt_payload(b"a", data_keys.subject("plan", uuid.uuid4()))
    gone = crypto.encrypt_payload(b"b", subj)
    with engine.begin() as conn:
        conn.execute(text(f'CREATE TABLE "{table}" (id integer primary key, value_ciphertext bytea)'))
        conn.execute(text(f'INSERT INTO "{table}" VALUES (1, :a), (2, :b), (3, :c)'),
                     {"a": alive, "b": gone, "c": b"broken"})
        conn.execute(text("UPDATE data_keys SET wrapped_key_ciphertext = NULL, destroyed_at = now() "
                          "WHERE subject_type = :t AND subject_id = :s"), {"t": subj[0], "s": subj[1]})
    data_keys.reset_cache()
    try:
        res = rekey.process_database(None, apply=False, tables=[table])
        col = res["columns"][0]
        assert col["erased"] == 1 and col["undecryptable"] == 1
        from app.ops.decrypt_check import check

        dc = check(None, sample=10)
        assert dc["erased"] >= 1 and f"{table}.value_ciphertext" in dc["failed_columns"]
    finally:
        with engine.begin() as conn:
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}"'))


# ---------------------------------------------------------------- バックアップの鍵の写し

def test_escrow_export_import_and_purge(keys, tmp_path):
    keys(KEY_A)
    s1 = data_keys.subject("plan", uuid.uuid4())
    s2 = data_keys.subject("user", uuid.uuid4())
    t1 = crypto.encrypt_payload(b"one", s1)
    crypto.encrypt_payload(b"two", s2)
    with engine.connect() as conn:
        lines = [json.dumps(o, sort_keys=True) for o in key_escrow.export_rows(conn)]
    mine = [ln for ln in lines if s1[1] in ln or s2[1] in ln]
    assert len(mine) == 2 and all(json.loads(ln)["wrapped"] for ln in mine)
    assert all(base64.b64decode(json.loads(ln)["wrapped"]) for ln in mine)
    dek1 = str(uuid.UUID(crypto.parse_envelope(t1)[1]))
    purged, removed = opslib.purge_escrow_lines(mine, [dek1])
    assert removed == 1
    by_id = {json.loads(ln)["id"]: json.loads(ln) for ln in purged}
    assert by_id[dek1]["wrapped"] is None and by_id[dek1]["destroyed"] is True
    assert opslib.purge_escrow_lines(purged, [dek1])[1] == 0  # 何度実行しても同じ
    # 入れ直す(復元の時): 同じ ID は飛ばし、破棄した記録は中身なしで入る
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM data_keys WHERE id = :i"), {"i": uuid.UUID(dek1)})
        res = key_escrow.import_rows(conn, [key_escrow.parse_line(ln) for ln in purged])
    assert res == {"inserted": 1, "skipped": 1}
    data_keys.reset_cache()
    assert data_keys.key_state(uuid.UUID(dek1).hex) == "destroyed"
    with pytest.raises(data_keys.DataKeyDestroyed):
        crypto.decrypt_payload(t1)
    with pytest.raises(ValueError):
        key_escrow.parse_line(json.dumps({"id": dek1, "subject_type": "x", "subject_id": dek1, "wrapped": None,
                                          "destroyed": True}))


def test_backup_excludes_key_table_data_and_restore_imports_escrow():
    from app.ops import cli

    src = open(cli.__file__, encoding="utf-8").read()
    assert src.count("--exclude-table-data=public.data_keys") == 2  # compose・local の両方
    assert '"app.ops.key_escrow", "export"' in src and '"app.ops.key_escrow", "import"' in src
    assert opslib.BACKUP_FILE_SUFFIXES["keys"] == ".keys.jsonl"
    assert "keys purge-escrow" in opslib.render_cron_block("/home/x/tc")


def test_manifest_checks_keys_file_when_recorded():
    m = {"format": "travelcanvas-backup", "files": {
        "database": {"size": 1, "sha256": "a" * 64}, "uploads": {"size": 1, "sha256": "b" * 64},
        "keys": {"size": 2, "sha256": "c" * 64}}}
    ok = {"database": {"size": 1, "sha256": "a" * 64}, "uploads": {"size": 1, "sha256": "b" * 64}}
    assert any("keys" in p for p in opslib.manifest_problems(m, ok))
    ok["keys"] = {"size": 2, "sha256": "c" * 64}
    assert opslib.manifest_problems(m, ok) == []


# ---------------------------------------------------------------- SEC-F6 TOTP の鍵

def test_totp_secret_uses_mfa_key_with_versions(keys):
    from app.services import mfa

    keys(KEY_A)
    legacy = mfa.encrypt_secret("JBSWY3DPEHPK3PXP")
    assert crypto.parse_envelope(legacy) is None  # MFA_KEY が無ければ以前と同じ
    keys(KEY_A, mfa=MFA_A)
    wrapped = mfa.encrypt_secret("JBSWY3DPEHPK3PXP")
    env = crypto.parse_envelope(wrapped)
    assert env and env[0] == "mfa" and env[1] == crypto.key_id(MFA_A)
    assert mfa.decrypt_secret(wrapped) == "JBSWY3DPEHPK3PXP"
    assert mfa.decrypt_secret(legacy) == "JBSWY3DPEHPK3PXP"  # 以前の暗号文も読める
    assert crypto.key_id_of(wrapped) == "mfa:" + crypto.key_id(MFA_A)
    # 切り替え: 前の版でも読め、掛け直すと今の版になる
    keys(KEY_A, mfa=MFA_B, mfa_previous=MFA_A)
    assert mfa.decrypt_secret(wrapped) == "JBSWY3DPEHPK3PXP"
    new, kid, changed = crypto.reencrypt(wrapped)
    assert changed and kid == "mfa:" + crypto.key_id(MFA_A)
    assert crypto.parse_envelope(new)[1] == crypto.key_id(MFA_B)
    keys(KEY_A, mfa=MFA_B)  # 前の版を外すと、その版の暗号文は読めない
    with pytest.raises(ValueError):
        mfa.decrypt_secret(wrapped)
    assert mfa.decrypt_secret(new) == "JBSWY3DPEHPK3PXP"


def test_rekey_moves_legacy_totp_to_mfa_key(probe, keys):
    from app.services import mfa

    keys(KEY_A)
    with engine.begin() as conn:
        conn.execute(text(f'INSERT INTO "{probe}" VALUES (1, NULL, NULL, :t)'),
                     {"t": mfa.encrypt_secret("JBSWY3DPEHPK3PXP")})
    keys(KEY_A, mfa=MFA_A)
    status = rekey.summarize(rekey.process_database(None, apply=False, tables=[probe]), None, crypto.keyring_ids())
    assert status["remaining_on_previous_keys"] == 1  # MFA_KEY で包み直す必要がある
    res = rekey.process_database(None, apply=True, tables=[probe])
    assert res["totals"]["reencrypted"] == 1
    moved = _probe_value(probe, "totp_ciphertext")
    assert crypto.parse_envelope(moved)[0] == "mfa" and mfa.decrypt_secret(moved) == "JBSWY3DPEHPK3PXP"
    status = rekey.summarize(rekey.process_database(None, apply=False, tables=[probe]), None, crypto.keyring_ids())
    assert status["remaining_on_previous_keys"] == 0


def test_mfa_key_is_in_the_inventory_and_reuse_is_detected():
    from app.core.key_inventory import KEY_NAMES, reuse_problems

    assert "MFA_KEY" in KEY_NAMES and "MFA_KEYS_PREVIOUS" in KEY_NAMES

    class S:
        ENCRYPTION_KEY = "same-value-for-two-purposes-0001"
        MFA_KEY = "same-value-for-two-purposes-0001"

    assert any("MFA_KEY" in p for p in reuse_problems(S()))


# ---------------------------------------------------------------- SEC-F6 解除の二者の確認

def _admin(make_user, db_session):
    u, _ = make_user()
    u.user_type = "admin"
    db_session.flush()
    return u


def _with_mfa(db_session, user):
    db_session.add(UserMfa(user_id=user.id, method="totp", totp_secret_ciphertext=b"x", recovery_salt="s",
                           recovery_code_hashes=[], confirmed_at=datetime.now(timezone.utc)))
    db_session.flush()


def test_mfa_reset_needs_request_and_a_different_approver(make_user, db_session):
    from app.models.models import MfaResetRequest, Notification

    a = _admin(make_user, db_session)
    b = _admin(make_user, db_session)
    target, _ = make_user()
    _with_mfa(db_session, target)
    _with_mfa(db_session, a)
    with pytest.raises(mfa_reset.MfaResetError):  # 自分の解除は申請できない
        mfa_reset.request_reset(db_session, target_email=a.email, requested_by=a.email, reason="端末の紛失")
    with pytest.raises(mfa_reset.MfaResetError):  # 理由が要る
        mfa_reset.request_reset(db_session, target_email=target.email, requested_by=a.email, reason="")
    req = mfa_reset.request_reset(db_session, target_email=target.email, requested_by=a.email,
                                  reason="端末の紛失(電話で本人確認)")
    with pytest.raises(mfa_reset.MfaResetError):  # 申請した人は承認できない(管理者が2人以上)
        mfa_reset.approve_reset(db_session, request_id=req["request_id"], approved_by=a.email)
    with pytest.raises(mfa_reset.MfaResetError):  # 管理者でない人は承認できない
        mfa_reset.approve_reset(db_session, request_id=req["request_id"], approved_by=target.email)
    res = mfa_reset.approve_reset(db_session, request_id=req["request_id"], approved_by=b.email)
    assert res["removed"] and res["sessions_revoked"] and not res["single_operator"]
    assert db_session.query(UserMfa).filter(UserMfa.user_id == target.id).count() == 0
    row = db_session.query(MfaResetRequest).filter(MfaResetRequest.id == uuid.UUID(req["request_id"])).one()
    assert row.status == "approved" and row.approved_by_user_id == b.id and row.requested_by_user_id == a.id
    assert db_session.query(Notification).filter(Notification.user_id == target.id,
                                                 Notification.type == "security").count() == 1
    with pytest.raises(mfa_reset.MfaResetError):  # 同じ申請は2回使えない
        mfa_reset.approve_reset(db_session, request_id=req["request_id"], approved_by=b.email)


def test_mfa_reset_cannot_unlock_oneself_and_expires(make_user, db_session):
    a = _admin(make_user, db_session)
    b = _admin(make_user, db_session)
    _with_mfa(db_session, b)
    req = mfa_reset.request_reset(db_session, target_email=b.email, requested_by=a.email, reason="端末の紛失")
    with pytest.raises(mfa_reset.MfaResetError):  # 対象の本人は承認できない
        mfa_reset.approve_reset(db_session, request_id=req["request_id"], approved_by=b.email)
    later = datetime.now(timezone.utc) + timedelta(hours=mfa_reset.REQUEST_HOURS + 1)
    with pytest.raises(mfa_reset.MfaResetError) as exc:
        mfa_reset.approve_reset(db_session, request_id=req["request_id"], approved_by=a.email, now=later)
    assert "期限" in str(exc.value)


def test_security_cli_refuses_old_single_step_reset(capsys):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "scripts" / "security_incident.py"
    spec = importlib.util.spec_from_file_location("security_incident_g3", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.main(["mfa-reset", "--email", "x@example.com", "--yes"]) == module.EXIT_USAGE
    assert "mfa-reset-request" in capsys.readouterr().out
