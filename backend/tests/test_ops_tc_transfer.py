"""[Gate DataTransfer] omega-dev2 の試験データを GCP の VM へ丸ごと移す道具(scripts/ops/tc_transfer.py)。

外の docker・tcops へは触らない(代わりの小さなコマンドで動かす)。確かめること:
- 写す鍵は鍵の一覧(key_inventory)のうちデータ・署名の鍵だけ。環境ごとの鍵(監視の合言葉・SMTP)は写さない
- GCP の .env は鍵の行だけを替え、DB のパスワード・サイトの名前は変えない。omega-dev2 で未設定の鍵は消す
- 束は合言葉で暗号化し、合言葉が違えば開けない。鍵・合言葉を画面に出さない。復号した束は残さない
- import は GCP のバックアップ → .env の控え → 鍵 → 別名の DB への復元と確認 → 保存ファイル → DB の名前の入れ替え の順。
  確認が合わなければ切り替えない。rollback で元の DB・.env・保存ファイルに戻る
"""
import importlib.util
import io
import json
import os
import shutil
import stat
import sys
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ops" / "tc_transfer.py"

pytestmark = pytest.mark.skipif(shutil.which("openssl") is None, reason="openssl が無い")

OMEGA_KEYS = {
    "ENCRYPTION_KEY": "omega-enc-" + "a" * 40,
    "LOOKUP_INDEX_KEY": "omega-lookup-" + "b" * 40,
    "JWT_SECRET_KEY": "omega-jwt-" + "c" * 40,
    "DOCUMENT_DOWNLOAD_SIGNING_KEY": "omega-doc-" + "d" * 40,
    "OFFLINE_PACK_KEY_SECRET": "omega-off-" + "e" * 40,
}
PASS = "transfer-pass-phrase-1"
REV = "a3c7e9f1b5d2"
BID = "tc-20261117T010203Z"


def _load(monkeypatch, root: Path, art: Path):
    spec = importlib.util.spec_from_file_location("tc_transfer_under_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "ROOT", root)
    monkeypatch.setattr(mod, "ART", art)
    return mod


def _omega_env() -> str:
    lines = ["APP_ENV=development",
             "DATABASE_URL=postgresql" + "://travelcanvas_app:omegapw@postgres:5432/travelcanvas",
             "METRICS_TOKEN=omega-metrics-" + "f" * 30]
    lines += [f"{k}={v}" for k, v in OMEGA_KEYS.items()]
    return "\n".join(lines) + "\n"


def _gcp_env() -> str:
    return "\n".join([
        "COMPOSE_FILE=docker-compose.yml:docker-compose.gcp.yml",
        "TC_SITE_HOST=travelcanvas.tail-test.ts.net",
        "DATABASE_URL=postgresql" + "://travelcanvas_app:gcppw@postgres:5432/travelcanvas",
        "APP_DATABASE_URL=postgresql" + "://tc_app:gcpapppw@postgres:5432/travelcanvas",
        "ENCRYPTION_KEY=gcp-enc-" + "1" * 40,
        "LOOKUP_INDEX_KEY=gcp-lookup-" + "2" * 40,
        "JWT_SECRET_KEY=gcp-jwt-" + "3" * 40,
        "MFA_KEY=gcp-mfa-" + "4" * 40,
        "METRICS_TOKEN=gcp-metrics-" + "5" * 30,
    ]) + "\n"


def test_keys_cover_the_inventory_without_env_local_ones():
    sys.path.insert(0, str(ROOT / "backend"))
    from app.core.key_inventory import KEY_NAMES

    spec = importlib.util.spec_from_file_location("tc_transfer_keys", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert set(mod.DATA_KEYS) | set(mod.ENV_LOCAL_KEYS) == set(KEY_NAMES)
    assert not set(mod.DATA_KEYS) & set(mod.ENV_LOCAL_KEYS)
    assert "METRICS_TOKEN" not in mod.DATA_KEYS and "SMTP_PASSWORD" not in mod.DATA_KEYS


def test_merge_keys_replaces_only_key_lines_and_drops_unset(monkeypatch, tmp_path):
    mod = _load(monkeypatch, tmp_path, tmp_path / "art")
    keys = mod.extract_key_lines(_omega_env().splitlines())
    assert keys["MFA_KEY"] is None and keys["ENCRYPTION_KEY"] == "ENCRYPTION_KEY=" + OMEGA_KEYS["ENCRYPTION_KEY"]
    merged = mod.merge_keys(_gcp_env().splitlines(), keys, "T")
    text = "\n".join(merged)
    for k, v in OMEGA_KEYS.items():
        assert f"{k}={v}" in merged
    assert "gcp-enc-" not in text and "gcp-jwt-" not in text
    assert "MFA_KEY=" not in text  # omega-dev2 で未設定 → GCP でも消す(ENCRYPTION_KEY から導出)
    assert "gcppw" in text and "gcpapppw" in text and "gcp-metrics-" in text  # DB・監視の値は GCP のまま
    assert "TC_SITE_HOST=travelcanvas.tail-test.ts.net" in merged
    with pytest.raises(mod.TransferError):
        mod.extract_key_lines(["APP_ENV=development"])


def test_bundle_roundtrip_is_encrypted_and_wrong_pass_fails(monkeypatch, tmp_path):
    mod = _load(monkeypatch, tmp_path, tmp_path / "art")
    work = tmp_path / "w"
    work.mkdir()
    for n in mod.bundle_names(BID):
        (work / n).write_bytes(b"x" * 10 if not n.endswith("manifest.json") else b"{}")
    keys = mod.extract_key_lines(_omega_env().splitlines())
    out = mod.pack(work, BID, keys, {"alembic_revision": REV}, tmp_path / "b.tar.enc", PASS)
    raw = out.read_bytes()
    assert raw.startswith(b"Salted__") and OMEGA_KEYS["ENCRYPTION_KEY"].encode() not in raw
    assert stat.S_IMODE(out.stat().st_mode) == 0o600
    assert (tmp_path / "b.tar.enc.sha256").read_text().split()[0] == mod.sha256_file(out)
    assert not (work / "bundle.tar").exists()
    dest = tmp_path / "in"
    dest.mkdir()
    meta, got = mod.unpack(out, dest, PASS)
    assert meta["backup_id"] == BID and meta["alembic_revision"] == REV and got == keys
    bad = tmp_path / "in2"
    bad.mkdir()
    with pytest.raises(mod.TransferError, match="復号できません"):
        mod.unpack(out, bad, "wrong-pass-phrase-1")


def test_unpack_garbage_after_padding_collision_is_transfer_error(monkeypatch, tmp_path):
    """誤った合言葉が約 1/256 で padding 検査を通り tar でない中身になっても、TransferError で断る(CI #786 の不安定の再現)。"""
    mod = _load(monkeypatch, tmp_path, tmp_path / "art")

    def fake_decrypt(src, dst, passphrase):
        Path(dst).write_bytes(b"garbage-not-a-tar" * 40)

    monkeypatch.setattr(mod, "decrypt", fake_decrypt)
    dest = tmp_path / "in3"
    dest.mkdir()
    with pytest.raises(mod.TransferError, match="復号できません"):
        mod.unpack(tmp_path / "x.enc", dest, "whatever")
    assert not (dest / "bundle.tar").exists()


def test_unpack_rejects_paths_outside(monkeypatch, tmp_path):
    mod = _load(monkeypatch, tmp_path, tmp_path / "art")
    plain = tmp_path / "evil.tar"
    with tarfile.open(plain, "w") as tar:
        info = tarfile.TarInfo("../escape")
        info.size = 1
        tar.addfile(info, io.BytesIO(b"x"))
    enc = tmp_path / "evil.enc"
    mod.encrypt(plain, enc, PASS)
    dest = tmp_path / "d"
    dest.mkdir()
    with pytest.raises(mod.TransferError, match="想定外"):
        mod.unpack(enc, dest, PASS)
    assert not (tmp_path / "escape").exists()


def test_restore_acceptance_and_db_names(monkeypatch, tmp_path):
    mod = _load(monkeypatch, tmp_path, tmp_path / "art")
    good = {"counts_ok": True, "files": {"ok": True}, "decrypt": {"ok": True}, "alembic_match": True,
            "fingerprint_mismatches": ["METRICS_TOKEN"]}
    assert mod.restore_acceptable(good) == (True, [])
    bad = {**good, "fingerprint_mismatches": ["ENCRYPTION_KEY"], "decrypt": {"ok": False}}
    ok, problems = mod.restore_acceptable(bad)
    assert not ok and any("ENCRYPTION_KEY" in p for p in problems) and "復号" in problems
    assert 'RENAME TO "b_x"' in mod.rename_db_sql("a", "b_x")
    with pytest.raises(mod.TransferError):
        mod.rename_db_sql("a; drop", "b")


# ---------------------------------------------------------------------------
# 通し: omega-dev2 の export → GCP の import → rollback(docker・tcops は代わりのコマンド)
# ---------------------------------------------------------------------------

FAKE_TCOPS = r'''
import json, os, sys
from pathlib import Path
log = Path(os.environ["FAKE_LOG"])
args = sys.argv[1:]
bdir = Path(args[args.index("--backup-dir") + 1]) if "--backup-dir" in args else Path(os.environ["FAKE_BACKUPS"])
args = [a for i, a in enumerate(args) if a != "--backup-dir" and (i == 0 or args[i - 1] != "--backup-dir")]
with log.open("a") as f:
    f.write("tcops " + " ".join(args) + "\n")
if args[0] == "backup":
    bid = os.environ.get("FAKE_BID", "tc-20261117T010203Z")
    bdir.mkdir(parents=True, exist_ok=True)
    (bdir / f"{bid}.db.dump").write_bytes(b"dump-" + os.environ["FAKE_SIDE"].encode())
    import io, tarfile
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        data = ("file-of-" + os.environ["FAKE_SIDE"]).encode()
        info = tarfile.TarInfo("documents/a.bin"); info.size = len(data); t.addfile(info, io.BytesIO(data))
    (bdir / f"{bid}.uploads.tar.gz").write_bytes(buf.getvalue())
    (bdir / f"{bid}.keys.jsonl").write_text("{}\n")
    (bdir / f"{bid}.manifest.json").write_text(json.dumps({"alembic_revision": "a3c7e9f1b5d2", "commit": "abc"}))
    print("バックアップが完了しました: " + bid, file=sys.stderr)
elif args[0] == "restore":
    fail = os.environ.get("FAKE_RESTORE_FAIL") == "1"
    print("[ops] 復元")
    print(json.dumps({"ok": not fail, "counts_ok": True, "files": {"ok": True}, "decrypt": {"ok": not fail},
                      "alembic_match": True, "fingerprint_mismatches": ["METRICS_TOKEN"]}))
    sys.exit(2 if fail else 0)
'''

FAKE_DOCKER = r'''#!/usr/bin/env python3
import os, sys
from pathlib import Path
log = Path(os.environ["FAKE_LOG"])
a = sys.argv[1:]
data = b""
if "tar" in a or "postgres" in a:
    data = sys.stdin.buffer.read()
with log.open("a") as f:
    line = "docker " + " ".join(a)
    if "postgres" in a:
        line += " <<SQL " + data.decode().replace("\n", " ")
    if "tar" in a:
        line += " <<%d bytes" % len(data)
    f.write(line + "\n")
if a[:1] == ["info"]:
    sys.exit(0)
if "alembic" in a:
    print(os.environ.get("FAKE_REV", "a3c7e9f1b5d2") + " (head)")
'''


@pytest.fixture()
def world(monkeypatch, tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "fake_tcops.py").write_text(FAKE_TCOPS)
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER)
    docker.chmod(0o755)
    log = tmp_path / "log.txt"
    monkeypatch.setenv("FAKE_LOG", str(log))
    monkeypatch.setenv("TC_TRANSFER_PASS", PASS)

    def side(name: str, env_text: str):
        root = tmp_path / name
        (root / "scripts" / "ops").mkdir(parents=True)
        (root / ".env").write_text(env_text)
        os.chmod(root / ".env", 0o600)
        art = tmp_path / f"art-{name}"
        mod = _load(monkeypatch, root, art)
        monkeypatch.setattr(mod, "TCOPS", str(bin_dir / "fake_tcops.py"))
        monkeypatch.setattr(mod, "DOCKER", str(docker))
        monkeypatch.setattr(mod, "wait_http", lambda url, tries=60: True)
        monkeypatch.setenv("FAKE_BACKUPS", str(root / "backups"))
        monkeypatch.setenv("FAKE_SIDE", name)
        return root, art, mod
    return side, log


def test_export_import_rollback_end_to_end(world, monkeypatch, capsys):
    side, log = world
    o_root, o_art, omega = side("omega", _omega_env())
    assert omega.main(["export"]) == 0
    enc = o_art / f"tc-transfer-{BID}.tar.enc"
    assert enc.is_file() and (o_art / f"{enc.name}.sha256").is_file()
    assert [p.name for p in o_art.iterdir() if p.is_dir()] == []  # 平文の作業場所は残さない
    printed = capsys.readouterr()
    for v in list(OMEGA_KEYS.values()) + [PASS]:
        assert v not in printed.out + printed.err
    # 束を GCP の VM へ運ぶ
    g_root, g_art, gcp = side("gcp", _gcp_env())
    monkeypatch.setenv("FAKE_BID", "tc-20261117T020000Z")  # GCP 側の事前のバックアップ
    shutil.copy(enc, g_root / enc.name)
    shutil.copy(o_art / f"{enc.name}.sha256", g_root / f"{enc.name}.sha256")
    log.write_text("")
    assert gcp.main(["import", str(g_root / enc.name), "--yes", "--skip-check"]) == 0
    out = capsys.readouterr()
    for v in list(OMEGA_KEYS.values()) + [PASS, "gcp-enc-"]:
        assert v not in out.out + out.err
    env_after = (g_root / ".env").read_text()
    assert "ENCRYPTION_KEY=" + OMEGA_KEYS["ENCRYPTION_KEY"] in env_after and "gcp-enc-" not in env_after
    assert "gcppw" in env_after and "MFA_KEY=" not in env_after
    assert stat.S_IMODE((g_root / ".env").stat().st_mode) == 0o600
    steps = log.read_text().splitlines()
    order = [next(i for i, ln in enumerate(steps) if pat in ln) for pat in (
        "tcops backup", "docker compose stop frontend gateway", "up -d --no-deps --force-recreate backend",
        "tcops restore --backup " + BID, "find /app/uploads -mindepth 1 -delete", "tar -C /app/uploads -xzf -",
        "docker compose stop backend frontend gateway",
        'ALTER DATABASE "travelcanvas" RENAME TO "travelcanvas_gcp_before_',
        "docker compose up -d --remove-orphans")]
    assert order == sorted(order), steps
    assert "travelcanvas_restore_omega_" in log.read_text() and "DROP" not in log.read_text().upper()
    state = sorted(g_art.glob("transfer-import-*.state.json"))[-1]
    st = json.loads(state.read_text())
    assert st["step"] == "done" and st["gcp_backup"] == "tc-20261117T020000Z"
    assert "gcp-enc-" in Path(st["env_copy"]).read_text()  # 元の .env の控え
    assert not list(g_art.glob("transfer-in-*"))  # 復号した束は消す

    # 戻す: DB の名前・.env・保存ファイル
    log.write_text("")
    assert gcp.main(["rollback", str(state), "--yes"]) == 0
    back = log.read_text()
    assert 'RENAME TO "travelcanvas_omega_' in back
    assert f'"{st["before_db"]}" RENAME TO "travelcanvas"' in back
    assert "tar -C /app/uploads -xzf -" in back
    assert (g_root / ".env").read_text() == _gcp_env()


def test_import_stops_before_switching_when_restore_check_fails(world, monkeypatch):
    side, log = world
    _, o_art, omega = side("omega", _omega_env())
    assert omega.main(["export"]) == 0
    enc = o_art / f"tc-transfer-{BID}.tar.enc"
    g_root, g_art, gcp = side("gcp", _gcp_env())
    monkeypatch.setenv("FAKE_RESTORE_FAIL", "1")
    log.write_text("")
    assert gcp.main(["import", str(enc), "--yes", "--skip-check"]) == 1
    text = log.read_text()
    assert "RENAME" not in text and "/app/uploads" not in text  # 切り替えない・保存ファイルに触らない
    state = sorted(g_art.glob("transfer-import-*.state.json"))[-1]
    assert json.loads(state.read_text())["step"] == "keys"
    assert gcp.main(["rollback", str(state), "--yes"]) == 0
    assert (g_root / ".env").read_text() == _gcp_env()


def test_import_refuses_on_omega_or_version_mismatch(world, monkeypatch):
    side, log = world
    _, o_art, omega = side("omega", _omega_env())
    assert omega.main(["export"]) == 0
    enc = o_art / f"tc-transfer-{BID}.tar.enc"
    assert omega.main(["import", str(enc), "--yes"]) == 1  # omega-dev2 では import しない
    g_root, _, gcp = side("gcp", _gcp_env())
    assert gcp.main(["export"]) == 1  # GCP では export しない
    monkeypatch.setenv("FAKE_REV", "ffffffffffff")
    log.write_text("")
    assert gcp.main(["import", str(enc), "--yes", "--skip-check"]) == 1
    assert "tcops backup" not in log.read_text() and (g_root / ".env").read_text() == _gcp_env()


# ---------------------------------------------------------------------------
# [Gate Hardening-A・監査 G-10] 同じ鍵を写す例外は開発の環境の間だけ
# ---------------------------------------------------------------------------


def test_strict_environments_match_backend_config(monkeypatch, tmp_path):
    mod = _load(monkeypatch, tmp_path, tmp_path / "art")
    text = (ROOT / "backend" / "app" / "core" / "config.py").read_text(encoding="utf-8")
    line = next(ln for ln in text.splitlines() if ln.startswith("STRICT_ENVIRONMENTS ="))
    assert mod.STRICT_ENVIRONMENTS == eval(line.split("=", 1)[1].strip())  # noqa: S307 (固定の tuple の literal)


@pytest.mark.parametrize("app_env", ["production", "PROD", "staging"])
def test_refuses_strict_environment_values(monkeypatch, tmp_path, app_env):
    mod = _load(monkeypatch, tmp_path, tmp_path / "art")
    with pytest.raises(mod.TransferError):
        mod.refuse_strict_environment(app_env, "移す先")
    for ok in ("development", "dev", "local", "", None):
        mod.refuse_strict_environment(ok, "移す先")
    assert mod.app_env_of([]) == "development"
    assert mod.app_env_of(["APP_ENV=Staging"]) == "staging"


def test_export_refuses_on_production_source(world):
    side, log = world
    _, o_art, omega = side("omega", _omega_env().replace("APP_ENV=development", "APP_ENV=production"))
    assert omega.main(["export"]) == 1
    assert not list(o_art.glob("tc-transfer-*.tar.enc"))  # 束を作らない(鍵を外へ出さない)
    assert not log.exists() or "tcops backup" not in log.read_text()  # バックアップも取らない(何も動かさない)


def test_import_refuses_on_staging_target_or_production_bundle(world, monkeypatch):
    side, log = world
    _, o_art, omega = side("omega", _omega_env())
    assert omega.main(["export"]) == 0
    enc = o_art / f"tc-transfer-{BID}.tar.enc"
    g_root, _, gcp = side("gcp", _gcp_env() + "APP_ENV=staging\n")
    log.write_text("")
    before = (g_root / ".env").read_text()
    assert gcp.main(["import", str(enc), "--yes", "--skip-check"]) == 1
    assert "tcops backup" not in log.read_text() and (g_root / ".env").read_text() == before
    # 束の元が本番と記録されている(古い道具・手で作った束)なら、開発の移す先でも開かない
    g2_root, _, gcp2 = side("gcp2", _gcp_env())
    monkeypatch.setattr(gcp2, "unpack", lambda *a, **k: ({"backup_id": BID, "source_app_env": "production"}, {}))
    log.write_text("")
    assert gcp2.main(["import", str(enc), "--yes", "--skip-check"]) == 1
    assert "tcops backup" not in log.read_text() and (g2_root / ".env").read_text() == _gcp_env()
