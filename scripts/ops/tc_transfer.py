#!/usr/bin/env python3
"""[Gate DataTransfer] omega-dev2 の試験データ(DB・保存ファイル・データ鍵)を、GCP の開発の共有環境(travelcanvas-dev)へ丸ごと移す。

利用者の判断(2026-11-17): omega-dev2 の DB を丸ごと移す。暗号化したデータを読むために、GCP の .env の暗号の鍵を
omega-dev2 と同じ値にする(「環境ごとに別の鍵」の方針の、この 2 つの開発環境の間だけの例外)。

使い方(リポジトリの直下で。標準ライブラリだけで動く):

  omega-dev2:  python3 scripts/ops/tc_transfer.py export
      → ~/tc-artifacts/tc-transfer-<ID>.tar.enc(合言葉で暗号化。DB・保存ファイル・データ鍵・暗号の鍵が入る)
  GCP の VM:   python3 scripts/ops/tc_transfer.py import <file.tar.enc>
      → GCP の今の DB・保存ファイル・.env を控えてから、omega-dev2 の内容に切り替える
  戻す:        python3 scripts/ops/tc_transfer.py rollback <import の記録(.state.json)>

守ること:
- 暗号の鍵・合言葉を画面・ログ・コマンドの引数に出さない(openssl へは環境変数で渡す)
- GCP の今の DB は消さない(別名 travelcanvas_gcp_before_<時刻> に残す)。保存ファイルと .env は控えを取る
- 移す前に GCP のバックアップを取り、検証できなければ何も変えない
- 復元の確認(件数・保存ファイル・復号・alembic の版・鍵の指紋)が合わなければ切り替えない
"""
from __future__ import annotations

import argparse
import datetime as _dt
import getpass
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
ART = Path(os.environ.get("TC_ARTIFACTS") or (Path.home() / "tc-artifacts")).expanduser()
TCOPS = os.environ.get("TC_TCOPS") or str(ROOT / "scripts" / "ops" / "tcops.py")
DOCKER = os.environ.get("TC_DOCKER") or "docker"
OPENSSL = os.environ.get("TC_OPENSSL") or "openssl"

# 暗号化したデータ・ログイン・共有の署名に使う鍵(docs/ops/KEY-INVENTORY.md)。omega-dev2 の値をそのまま写す。
# omega-dev2 で未設定の鍵は GCP でも消す(未設定の時は別の鍵から導出するので、片方だけ値があると読めない)
DATA_KEYS = (
    "ENCRYPTION_KEY",
    "ENCRYPTION_KEYS_PREVIOUS",
    "MFA_KEY",
    "MFA_KEYS_PREVIOUS",
    "LOOKUP_INDEX_KEY",
    "DOCUMENT_DOWNLOAD_SIGNING_KEY",
    "JWT_SECRET_KEY",
    "OFFLINE_PACK_KEY_SECRET",
    "CHALLENGE_SECRET_KEY",
    "SHARE_VIEW_SIGNING_KEY",
    "VAPID_PRIVATE_KEY",
)
# 環境ごとの値のままにする鍵(データを読むのには使わない)。復元の確認で指紋が違っても良い
ENV_LOCAL_KEYS = ("METRICS_TOKEN", "SMTP_PASSWORD", "INBOUND_MAIL_SECRET")
BUNDLE_KIND = "travelcanvas-transfer/1"
GCP_COMPOSE_FILE = "docker-compose.yml:docker-compose.gcp.yml"
GATEWAY = os.environ.get("TC_GATEWAY") or "http://127.0.0.1:8080"
MIN_PASS = 12
_ID_RE = re.compile(r"tc-\d{8}T\d{6}Z")
_DB_RE = re.compile(r"[a-z][a-z0-9_]{0,62}")


class TransferError(Exception):
    pass


def say(msg: str) -> None:
    print(msg, flush=True)


def now_tag() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def private_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(path, 0o700)
    return path


def write_private(path: Path, text: str) -> None:
    tmp = path.with_name("." + path.name + ".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# .env(値は読んでも出さない)
# ---------------------------------------------------------------------------


def env_lines(path: Path) -> List[str]:
    return path.read_text(encoding="utf-8").splitlines() if path.is_file() else []


def env_get(lines: Iterable[str], name: str) -> Optional[str]:
    """最後の `NAME=` の行の値(引用符は外す)。無ければ None"""
    value = None
    for line in lines:
        if line.startswith(name + "="):
            value = line.split("=", 1)[1].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
    return value


def extract_key_lines(lines: Iterable[str]) -> Dict[str, Optional[str]]:
    """omega-dev2 の .env から写す鍵の行(`NAME=値` のまま)。未設定・空は None"""
    found: Dict[str, Optional[str]] = {name: None for name in DATA_KEYS}
    for line in lines:
        name = line.split("=", 1)[0]
        if name in found and "=" in line:
            found[name] = line if line.split("=", 1)[1].strip() not in ("", '""', "''") else None
    if not found["ENCRYPTION_KEY"] or not found["LOOKUP_INDEX_KEY"] or not found["JWT_SECRET_KEY"]:
        raise TransferError(".env に ENCRYPTION_KEY・LOOKUP_INDEX_KEY・JWT_SECRET_KEY がありません(移す元が違う?)")
    return found


def merge_keys(lines: List[str], keys: Dict[str, Optional[str]], stamp: str) -> List[str]:
    """GCP の .env の鍵の行を omega-dev2 の値に替える。値の無い鍵は消す。ほかの行(DB のパスワード・サイトの名前)は変えない"""
    out = [ln for ln in lines if ln.split("=", 1)[0] not in keys]
    out.append("# [Gate DataTransfer] %s: 下の鍵は omega-dev2 と同じ値(試験データを丸ごと移したため。利用者の判断 2026-11-17)" % stamp)
    out.extend(v for k, v in keys.items() if v)
    return out


def database_name(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    m = re.search(r"/([A-Za-z0-9_]+)(?:\?.*)?$", url)
    return m.group(1) if m else None


# ---------------------------------------------------------------------------
# 外のコマンド
# ---------------------------------------------------------------------------


def run(argv: List[str], *, check: bool = True, capture: bool = False, env: Optional[Dict[str, str]] = None,
        stdin=None, cwd: Optional[Path] = None, timeout: int = 7200) -> subprocess.CompletedProcess:
    proc = subprocess.run(argv, cwd=str(cwd or ROOT), env={**os.environ, **(env or {})}, stdin=stdin,
                          stdout=subprocess.PIPE if capture else None, stderr=subprocess.PIPE if capture else None,
                          timeout=timeout)
    if check and proc.returncode != 0:
        tail = ""
        if capture:
            tail = ((proc.stderr or b"") + (proc.stdout or b"")).decode("utf-8", "replace").strip()[-800:]
        raise TransferError("失敗: %s(終了 %d)%s" % (" ".join(argv[:4]), proc.returncode, ("\n" + tail) if tail else ""))
    return proc


def compose(*args: str, **kw) -> subprocess.CompletedProcess:
    return run([DOCKER, "compose", *args], **kw)


def tcops(*args: str, backup_dir: Optional[Path] = None, **kw) -> subprocess.CompletedProcess:
    pre = ["--backup-dir", str(backup_dir)] if backup_dir else []
    return run([sys.executable, TCOPS, *pre, *args], **kw)


def take_backup(backup_dir: Optional[Path] = None) -> str:
    proc = tcops("backup", backup_dir=backup_dir, capture=True)
    text = ((proc.stdout or b"") + (proc.stderr or b"")).decode("utf-8", "replace")
    ids = _ID_RE.findall(text)
    if not ids:
        raise TransferError("バックアップの ID を読めません")
    bid = ids[-1]
    tcops("verify", bid, backup_dir=backup_dir, capture=True)
    return bid


def alembic(cmd: str) -> Optional[str]:
    proc = compose("exec", "-T", "backend", "alembic", cmd, check=False, capture=True)
    words = [ln.split()[0] for ln in (proc.stdout or b"").decode().splitlines() if ln.strip()]
    return words[-1] if words else None


def wait_http(url: str, tries: int = 60) -> bool:
    for _ in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=5) as r:  # noqa: S310 (127.0.0.1 の確認だけ)
                if r.status == 200:
                    return True
        except Exception:  # noqa: BLE001
            pass
        time.sleep(3)
    return False


def pg(sql: str) -> None:
    """postgres のコンテナの中で、所有者として SQL を流す(DB 名の変更。パスワードは使わない)"""
    proc = subprocess.run([DOCKER, "compose", "exec", "-T", "postgres", "sh", "-c",
                           'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -q'],
                          cwd=str(ROOT), input=sql.encode(), capture_output=True, timeout=600)
    if proc.returncode != 0:
        raise TransferError("DB の操作に失敗: " + (proc.stderr or b"").decode("utf-8", "replace").strip()[-500:])


def rename_db_sql(old: str, new: str) -> str:
    for n in (old, new):
        if not _DB_RE.fullmatch(n):
            raise TransferError("DB 名が不正: %s" % n)
    return ("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid();\n"
            'ALTER DATABASE "%s" RENAME TO "%s";\n' % (old, old, new))


def uploads_replace(archive: Path) -> None:
    """保存ファイル(backend の /app/uploads)を、アーカイブの中身に入れ替える(元はバックアップに入っている)"""
    compose("exec", "-T", "backend", "sh", "-c", "find /app/uploads -mindepth 1 -delete")
    with open(archive, "rb") as f:
        compose("exec", "-T", "backend", "tar", "-C", "/app/uploads", "-xzf", "-", stdin=f)


# ---------------------------------------------------------------------------
# 暗号化した束
# ---------------------------------------------------------------------------


def ask_pass(confirm: bool) -> str:
    env_pass = os.environ.get("TC_TRANSFER_PASS")
    if env_pass:
        return env_pass
    p = getpass.getpass("合言葉(%d 文字以上。GCP で同じものを入れます): " % MIN_PASS)
    if len(p) < MIN_PASS:
        raise TransferError("合言葉が短すぎます")
    if confirm and getpass.getpass("もう一度: ") != p:
        raise TransferError("合言葉が一致しません")
    return p


def encrypt(src: Path, dest: Path, passphrase: str) -> None:
    run([OPENSSL, "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "600000", "-salt", "-in", str(src), "-out", str(dest),
         "-pass", "env:TC_TRANSFER_PASS_INNER"], env={"TC_TRANSFER_PASS_INNER": passphrase}, capture=True)
    os.chmod(dest, 0o600)


def decrypt(src: Path, dest: Path, passphrase: str) -> None:
    proc = run([OPENSSL, "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "600000", "-in", str(src), "-out", str(dest),
                "-pass", "env:TC_TRANSFER_PASS_INNER"], env={"TC_TRANSFER_PASS_INNER": passphrase}, capture=True,
               check=False)
    if proc.returncode != 0:
        raise TransferError("復号できません(合言葉が違う・ファイルが壊れている)")
    os.chmod(dest, 0o600)


def bundle_names(bid: str) -> List[str]:
    return [f"{bid}.db.dump", f"{bid}.uploads.tar.gz", f"{bid}.manifest.json", f"{bid}.keys.jsonl"]


def pack(work: Path, bid: str, key_lines: Dict[str, Optional[str]], meta: Dict[str, object], out: Path,
         passphrase: str) -> Path:
    write_private(work / "keys.env", "\n".join(v for v in key_lines.values() if v) + "\n")
    write_private(work / "transfer.json", json.dumps({**meta, "kind": BUNDLE_KIND, "backup_id": bid,
                                                      "keys": [k for k, v in key_lines.items() if v]},
                                                     ensure_ascii=False, indent=1))
    names = [n for n in bundle_names(bid) if (work / n).is_file()] + ["keys.env", "transfer.json"]
    plain = work / "bundle.tar"
    with tarfile.open(plain, "w") as tar:
        for n in names:
            tar.add(str(work / n), arcname=n)
    os.chmod(plain, 0o600)
    encrypt(plain, out, passphrase)
    plain.unlink()
    write_private(out.with_name(out.name + ".sha256"), "%s  %s\n" % (sha256_file(out), out.name))
    return out


def unpack(enc: Path, work: Path, passphrase: str) -> Tuple[Dict[str, object], Dict[str, Optional[str]]]:
    plain = work / "bundle.tar"
    decrypt(enc, plain, passphrase)
    with tarfile.open(plain, "r") as tar:
        members = tar.getmembers()
        for m in members:
            if not m.isfile() or "/" in m.name or m.name.startswith(".") or m.name in ("", ".."):
                raise TransferError("束に想定外のものがあります: %s" % m.name)
        if hasattr(tarfile, "data_filter"):  # Python 3.12 以降: 権限・リンクも安全な形に限る
            tar.extractall(str(work), members=members, filter="data")
        else:  # pragma: no cover
            tar.extractall(str(work), members=members)  # noqa: S202 (名前は上で確かめた)
    plain.unlink()
    for p in work.iterdir():
        os.chmod(p, 0o600)
    meta = json.loads((work / "transfer.json").read_text(encoding="utf-8"))
    if meta.get("kind") != BUNDLE_KIND:
        raise TransferError("移すための束ではありません")
    bid = str(meta.get("backup_id") or "")
    if not _ID_RE.fullmatch(bid):
        raise TransferError("束のバックアップ ID が不正です")
    for n in bundle_names(bid)[:3]:
        if not (work / n).is_file():
            raise TransferError("束に %s がありません" % n)
    keys = extract_key_lines(env_lines(work / "keys.env"))
    return meta, keys


# ---------------------------------------------------------------------------
# 復元の確認の判定
# ---------------------------------------------------------------------------


def restore_acceptable(result: Dict[str, object]) -> Tuple[bool, List[str]]:
    """tcops restore の結果。鍵の指紋の違いが環境ごとの鍵(監視の合言葉・SMTP 等)だけなら良いとする"""
    problems = []
    if not result.get("counts_ok"):
        problems.append("表の件数")
    files = result.get("files") or {}
    if not (isinstance(files, dict) and files.get("ok")):
        problems.append("保存ファイル")
    decrypt_res = result.get("decrypt") or {}
    if not (isinstance(decrypt_res, dict) and decrypt_res.get("ok")):
        cols = decrypt_res.get("failed_columns") if isinstance(decrypt_res, dict) else None
        problems.append("復号" + ("(" + ",".join(map(str, cols[:5])) + ")" if cols else ""))
    if not result.get("alembic_match"):
        problems.append("alembic の版")
    bad = [k for k in (result.get("fingerprint_mismatches") or []) if k not in ENV_LOCAL_KEYS]
    if bad:
        problems.append("鍵の指紋(" + ",".join(map(str, bad)) + ")")
    return not problems, problems


# ---------------------------------------------------------------------------
# export(omega-dev2)
# ---------------------------------------------------------------------------


def cmd_export(args: argparse.Namespace) -> int:
    env = env_lines(ROOT / ".env")
    if env_get(env, "COMPOSE_FILE") == GCP_COMPOSE_FILE:
        raise TransferError("ここは GCP の VM です。export は omega-dev2 で行います")
    keys = extract_key_lines(env)
    passphrase = ask_pass(confirm=True)
    private_dir(ART)
    tag = now_tag()
    work = private_dir(Path(tempfile.mkdtemp(prefix="tc-transfer-out-", dir=str(ART))))
    try:
        say("1: omega-dev2 のバックアップを取って検証します")
        bid = take_backup(work)
        manifest = json.loads((work / f"{bid}.manifest.json").read_text(encoding="utf-8"))
        meta = {"created_at": tag, "source": "omega-dev2", "alembic_revision": manifest.get("alembic_revision"),
                "commit": manifest.get("commit")}
        say("1: バックアップ %s(DB の版 %s)" % (bid, manifest.get("alembic_revision")))
        out = ART / f"tc-transfer-{bid}.tar.enc"
        pack(work, bid, keys, meta, out, passphrase)
        say("2: 暗号化した束: %s(%.1f MB)" % (out, out.stat().st_size / 1e6))
        say("   SHA-256: %s(%s.sha256)" % (sha256_file(out), out.name))
        say("   入っている鍵: %s" % ", ".join(k for k, v in keys.items() if v))
        say("OK: この 2 つのファイルを GCP の VM へ運び、import してください(合言葉は別の経路で)")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return 0


# ---------------------------------------------------------------------------
# import(GCP の VM)
# ---------------------------------------------------------------------------


def gcp_preflight() -> List[str]:
    env = env_lines(ROOT / ".env")
    if not env:
        raise TransferError(".env がありません(GCP の VM のリポジトリで実行する)")
    if env_get(env, "COMPOSE_FILE") != GCP_COMPOSE_FILE:
        raise TransferError(".env の COMPOSE_FILE が GCP の設定ではありません(import は GCP の VM だけで行う)")
    if run([DOCKER, "info"], check=False, capture=True).returncode != 0:
        raise TransferError("docker を使えません")
    return env


def cmd_import(args: argparse.Namespace) -> int:
    enc = Path(args.file).expanduser().resolve()
    if not enc.is_file():
        raise TransferError("束がありません: %s" % enc)
    sha_file = enc.with_name(enc.name + ".sha256")
    if sha_file.is_file():
        want = sha_file.read_text().split()[0]
        if sha256_file(enc) != want:
            raise TransferError("SHA-256 が合いません(運ぶ途中で壊れた)")
        say("0: SHA-256 OK")
    env = gcp_preflight()
    live = database_name(env_get(env, "DATABASE_URL"))
    app_db = database_name(env_get(env, "APP_DATABASE_URL"))
    if not live or live != app_db:
        raise TransferError(".env の DATABASE_URL と APP_DATABASE_URL の DB 名が読めない・違う")
    passphrase = ask_pass(confirm=False)
    private_dir(ART)
    tag = now_tag()
    work = private_dir(ART / f"transfer-in-{tag}")
    state_path = ART / f"transfer-import-{tag}.state.json"
    state: Dict[str, object] = {"started_at": tag, "live_db": live, "step": "start"}
    try:
        meta, keys = unpack(enc, work, passphrase)
        bid = str(meta["backup_id"])
        want_rev = str(meta.get("alembic_revision") or "")
        cur, heads = alembic("current"), alembic("heads")
        say("0: 束 %s(omega-dev2 の DB の版 %s)・GCP の DB の版 %s(head %s)" % (bid, want_rev, cur, heads))
        if not want_rev or cur != want_rev or heads != want_rev:
            raise TransferError("DB の版が違います。先に omega-dev2 と同じ main の commit を GCP に反映してください"
                                "(bash scripts/ops/gcp_vm.sh deploy <SHA>)")
        restore_db = f"{live}_restore_omega_{tag[:8]}{tag[9:15]}".lower()
        before_db = f"{live}_gcp_before_{tag[:8]}{tag[9:15]}".lower()
        say("   GCP の今の DB %s は消さずに %s へ名前を変えて残します" % (live, before_db))
        say("   GCP の今の保存ファイルと .env は控えを取ります(戻す: rollback)")
        if not args.yes and input("続けるなら IMPORT と入力: ").strip() != "IMPORT":
            raise TransferError("取りやめました(何も変えていません)")

        say("1: GCP の今の状態のバックアップ")
        gcp_bid = take_backup()
        env_copy = ART / f"env.gcp-before-transfer-{tag}"
        shutil.copy2(ROOT / ".env", env_copy)
        os.chmod(env_copy, 0o600)
        state.update({"gcp_backup": gcp_bid, "env_copy": str(env_copy), "restore_db": restore_db,
                      "before_db": before_db, "source_backup": bid, "step": "backed_up"})
        write_private(state_path, json.dumps(state, ensure_ascii=False, indent=1))
        say("1: バックアップ %s・.env の控え %s(記録 %s)" % (gcp_bid, env_copy, state_path))

        say("2: 画面を止め、.env の鍵を omega-dev2 の値にして backend を作り直します")
        compose("stop", "frontend", "gateway", check=False)
        write_private(ROOT / ".env", "\n".join(merge_keys(env_lines(ROOT / ".env"), keys, tag)) + "\n")
        state["step"] = "keys"
        write_private(state_path, json.dumps(state, ensure_ascii=False, indent=1))
        compose("up", "-d", "--no-deps", "--force-recreate", "backend")
        if not wait_http("http://127.0.0.1:8001/health"):
            raise TransferError("backend が起動しません")

        say("3: omega-dev2 のバックアップを別名の DB %s へ復元して確かめます" % restore_db)
        proc = tcops("restore", "--backup", bid, "--target-db", restore_db, backup_dir=work, check=False, capture=True)
        out = (proc.stdout or b"").decode("utf-8", "replace")
        start = out.find("{")
        result = json.loads(out[start:]) if start >= 0 else {}
        ok, problems = restore_acceptable(result)
        if not ok:
            raise TransferError("復元の確認が合いません: " + "・".join(problems) + "(切り替えていません)")
        say("3: 件数・保存ファイル・復号・DB の版・鍵 OK")
        state["step"] = "restored"
        write_private(state_path, json.dumps(state, ensure_ascii=False, indent=1))

        say("4: 保存ファイルを omega-dev2 のものに入れ替えます")
        uploads_replace(work / f"{bid}.uploads.tar.gz")
        state["step"] = "uploads"
        write_private(state_path, json.dumps(state, ensure_ascii=False, indent=1))

        say("5: DB を切り替えます(%s → %s、%s → %s)" % (live, before_db, restore_db, live))
        compose("stop", "backend", "frontend", "gateway", check=False)
        pg(rename_db_sql(live, before_db) + rename_db_sql(restore_db, live))
        state["step"] = "switched"
        write_private(state_path, json.dumps(state, ensure_ascii=False, indent=1))

        say("6: 起動(migrate が tc_app の権限を付け直す)と確認")
        compose("up", "-d", "--remove-orphans")
        if not wait_http(GATEWAY + "/ready"):
            raise TransferError("起動の確認(/ready)が 200 になりません")
        if alembic("current") != want_rev:
            raise TransferError("切り替え後の DB の版が違います")
        if not args.skip_check:
            run(["bash", str(ROOT / "scripts" / "ops" / "gcp_vm.sh"), "check"])
        state["step"] = "done"
        write_private(state_path, json.dumps(state, ensure_ascii=False, indent=1))
        say("OK: omega-dev2 の試験データ(%s)を GCP に入れました。ログインは omega-dev2 と同じアカウント・パスワードです" % bid)
        say("    GCP の元の DB: %s(戻す: python3 scripts/ops/tc_transfer.py rollback %s)" % (before_db, state_path))
        say("    運んだ束 %s は、確かめた後に消してください(鍵が入っています)" % enc)
        return 0
    except BaseException:
        if state.get("step") not in ("start", "done"):
            say("!! 途中で止まりました(段階 %s)。元に戻すには:" % state.get("step"))
            say("   python3 scripts/ops/tc_transfer.py rollback %s" % state_path)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)  # 復号した束(鍵が入っている)は残さない


def cmd_rollback(args: argparse.Namespace) -> int:
    state_path = Path(args.state).expanduser().resolve()
    state = json.loads(state_path.read_text(encoding="utf-8"))
    gcp_preflight()
    step = str(state.get("step"))
    live, before, restore = str(state["live_db"]), str(state["before_db"]), str(state["restore_db"])
    if step in ("start", "backed_up"):
        say("何も変わっていません(段階 %s)" % step)
        return 0
    if not args.yes and input("GCP を移す前の状態に戻します。続けるなら ROLLBACK と入力: ").strip() != "ROLLBACK":
        raise TransferError("取りやめました")
    tag = now_tag()
    compose("stop", "backend", "frontend", "gateway", check=False)
    if step in ("switched", "done"):
        say("1: DB を元に戻します(%s → %s_omega_%s、%s → %s)" % (live, live, tag[:8], before, live))
        pg(rename_db_sql(live, f"{live}_omega_{tag[:8]}{tag[9:15]}".lower()) + rename_db_sql(before, live))
    else:
        say("1: DB は切り替える前でした(%s のまま)。作りかけの %s は残します" % (live, restore))
    say("2: .env を控え(%s)に戻します" % state["env_copy"])
    shutil.copy2(str(state["env_copy"]), ROOT / ".env")
    os.chmod(ROOT / ".env", 0o600)
    compose("up", "-d", "--no-deps", "--force-recreate", "backend")
    if not wait_http("http://127.0.0.1:8001/health"):
        raise TransferError("backend が起動しません")
    if step in ("uploads", "switched", "done"):
        say("3: 保存ファイルを GCP のバックアップ %s から戻します" % state["gcp_backup"])
        bdir = Path(os.environ.get("OPS_BACKUP_DIR") or env_get(env_lines(ROOT / ".env"), "OPS_BACKUP_DIR")
                    or (ROOT / "backups")).expanduser()
        uploads_replace(bdir / f"{state['gcp_backup']}.uploads.tar.gz")
    compose("up", "-d", "--remove-orphans")
    if not wait_http(GATEWAY + "/ready"):
        raise TransferError("起動の確認(/ready)が 200 になりません")
    state["step"] = "rolled_back"
    write_private(state_path, json.dumps(state, ensure_ascii=False, indent=1))
    say("OK: 移す前の GCP に戻しました")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("export", help="omega-dev2: バックアップと鍵を暗号化した束にする")
    p = sub.add_parser("import", help="GCP の VM: 束を入れて切り替える")
    p.add_argument("file")
    p.add_argument("--yes", action="store_true", help="確認の入力を省く")
    p.add_argument("--skip-check", action="store_true", help="最後の gcp_vm.sh check を省く(試験用)")
    p = sub.add_parser("rollback", help="GCP の VM: import の前に戻す")
    p.add_argument("state")
    p.add_argument("--yes", action="store_true")
    args = parser.parse_args(argv)
    os.chdir(ROOT)
    try:
        return {"export": cmd_export, "import": cmd_import, "rollback": cmd_rollback}[args.cmd](args)
    except TransferError as e:
        print("NG: %s" % e, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("NG: 中断しました", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
