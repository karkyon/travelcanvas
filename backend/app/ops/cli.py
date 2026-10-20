"""[Gate O1] TravelCanvas の運用コマンドの本体(入口は scripts/ops/tcops.py)(B-010: バックアップ・復元演習・監視・rollback 計画・定期実行)。

ホスト(omega-dev2)のリポジトリ直下で実行する。docker compose のコンテナを使うので、ホスト側に
pg_dump や Python の追加パッケージは要らない(標準ライブラリだけ)。

    python3 scripts/ops/tcops.py backup --prune      # DB+保存ファイルのバックアップ→検証→古い世代の整理
    python3 scripts/ops/tcops.py list                # バックアップの一覧
    python3 scripts/ops/tcops.py verify --latest     # 目録(manifest)とファイルのハッシュ照合
    python3 scripts/ops/tcops.py drill               # バックアップ→別DBへ復元→件数・復号・migration往復→記録
    python3 scripts/ops/tcops.py restore --backup tc-…Z --target-db travelcanvas_restore_20261016
    python3 scripts/ops/tcops.py rollback-plan --to <commit>
    python3 scripts/ops/tcops.py monitor             # /health・/ready・/metrics・コンテナ・バックアップの鮮度
    python3 scripts/ops/tcops.py purge               # 猶予を過ぎた削除済みデータの完全削除
    python3 scripts/ops/tcops.py schedule print|install|remove

安全の決まり:
- 運用中の DB へは読むだけ(pg_dump)。復元は必ず別名の DB(名前に restore を含む)へ行う。
- 秘密(DBパスワード・鍵)を画面・ログ・記録に出さない。接続文字列はコンテナの中で組み立てる。
- バックアップは個人データを含むので、保存先は 0700、ファイルは 0600 で作る。

詳しい手順は docs/ops/RUNBOOK.md。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

# このファイルは backend/app/ops/cli.py。リポジトリ直下は3つ上(ホストで実行する前提)。
REPO = Path(os.environ.get("OPS_REPO_DIR") or Path(__file__).resolve().parents[3])

from app.core import log_safety  # noqa: E402  (標準ライブラリだけのモジュール)
from app.ops import opslib  # noqa: E402  (標準ライブラリだけのモジュール)

DEFAULT_DRILL_DB = "travelcanvas_restore_drill"
EXIT_OK, EXIT_WARN, EXIT_CRIT, EXIT_ERROR = 0, 1, 2, 3


class OpsError(RuntimeError):
    """運用コマンドの失敗(文面は秘密を伏せてから出す)。"""


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def log(msg: str) -> None:
    stamp = now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")
    print("[tcops %s] %s" % (stamp, opslib.mask_url(msg)), flush=True)


def read_dotenv_value(name: str) -> Optional[str]:
    """リポジトリの .env から1つの値だけ読む(全体は読み込まない・表示しない)。"""
    if os.environ.get(name):
        return os.environ[name]
    path = REPO / ".env"
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == name:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                value = value[1:-1]
            return value or None
    return None


# ---------------------------------------------------------------------------
# 実行の仕組み(docker compose / ローカル)
# ---------------------------------------------------------------------------


class Executor:
    """コマンドの実行先。``compose``(omega-dev2 の docker compose)と ``local``(検証用)。"""

    mode = "base"

    def run(
        self,
        argv: Sequence[str],
        *,
        stdin_path: Optional[str] = None,
        stdout_path: Optional[str] = None,
        env: Optional[Mapping[str, str]] = None,
        cwd: Optional[str] = None,
        timeout: int = 3600,
        check: bool = True,
    ) -> subprocess.CompletedProcess:
        full_env = dict(os.environ)
        full_env.update(env or {})
        stdin = open(stdin_path, "rb") if stdin_path else subprocess.DEVNULL
        stdout = open(stdout_path, "wb") if stdout_path else subprocess.PIPE
        try:
            proc = subprocess.run(
                list(argv),
                stdin=stdin,
                stdout=stdout,
                stderr=subprocess.PIPE,
                env=full_env,
                cwd=cwd or str(REPO),
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            raise OpsError("時間切れ: %s" % argv[0])
        finally:
            if stdin_path:
                stdin.close()  # type: ignore[union-attr]
            if stdout_path:
                stdout.close()  # type: ignore[union-attr]
        if check and proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()[-8:]
            raise OpsError("コマンドが失敗しました(%s, 終了コード %d): %s" % (self.describe(argv), proc.returncode, " / ".join(err)))
        return proc

    @staticmethod
    def describe(argv: Sequence[str]) -> str:
        words = [a for a in argv if not a.startswith("-")]
        return " ".join(words[:6])

    # 以下を各実行先で実装する
    def backend_python(
        self,
        module_args: Sequence[str],
        *,
        extra_env: Optional[Mapping[str, str]] = None,
        target_db: Optional[str] = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess:
        raise NotImplementedError

    def backend_alembic(self, args: Sequence[str], target_db: str) -> subprocess.CompletedProcess:
        raise NotImplementedError

    def pg_dump(self, database: str, out_path: str) -> None:
        raise NotImplementedError

    def pg_list(self, dump_path: str) -> int:
        raise NotImplementedError

    def recreate_database(self, name: str) -> None:
        raise NotImplementedError

    def drop_database(self, name: str) -> None:
        raise NotImplementedError

    def pg_restore(self, name: str, dump_path: str) -> None:
        raise NotImplementedError

    def uploads_archive(self, uploads_root: str, out_path: str) -> None:
        raise NotImplementedError

    def containers(self) -> Optional[Dict[str, str]]:
        return None

    def json_from(self, proc: subprocess.CompletedProcess) -> Dict[str, object]:
        lines = [
            ln for ln in (proc.stdout or b"").decode("utf-8", "replace").splitlines() if ln.strip().startswith("{")
        ]
        if not lines:
            raise OpsError("点検コマンドの出力が読めません")
        return json.loads(lines[-1])


_URL_SNIPPET = (
    "import os; from app.ops.opslib import replace_database; "
    "print(replace_database(os.environ['DATABASE_URL'], os.environ['OPS_TARGET_DB']))"
)


class ComposeExecutor(Executor):
    mode = "compose"

    def __init__(self) -> None:
        self.compose = ["docker", "compose"]

    def exec_args(self, service: str, env: Optional[Mapping[str, str]] = None) -> List[str]:
        args = self.compose + ["exec", "-T"]
        for k, v in (env or {}).items():
            args += ["-e", "%s=%s" % (k, v)]
        return args + [service]

    def backend_python(self, module_args, *, extra_env=None, target_db=None, check=True):
        env = dict(extra_env or {})
        # pycache をバインドマウント先(./backend)へ書かない(コンテナは非rootで書けないことがある)
        env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
        if target_db:
            env["OPS_TARGET_DB"] = target_db
            inner = 'DATABASE_URL="$(python -c %s)" exec python %s' % (
                shlex.quote(_URL_SNIPPET),
                " ".join(shlex.quote(a) for a in module_args),
            )
            return self.run(self.exec_args("backend", env) + ["sh", "-c", inner], check=check)
        return self.run(self.exec_args("backend", env) + ["python"] + list(module_args), check=check)

    def backend_alembic(self, args, target_db):
        inner = 'DATABASE_URL="$(python -c %s)" exec alembic %s' % (
            shlex.quote(_URL_SNIPPET),
            " ".join(shlex.quote(a) for a in args),
        )
        env = {"OPS_TARGET_DB": target_db, "PYTHONDONTWRITEBYTECODE": "1"}
        return self.run(self.exec_args("backend", env) + ["sh", "-c", inner])

    def _pg(self, script: str, **kw) -> subprocess.CompletedProcess:
        return self.run(self.exec_args("postgres") + ["sh", "-c", script], **kw)

    def pg_dump(self, database, out_path):
        self._pg(
            'exec pg_dump -U "$POSTGRES_USER" -d %s -Fc -Z 6 --no-owner --no-privileges' % shlex.quote(database),
            stdout_path=out_path,
            timeout=7200,
        )

    def pg_list(self, dump_path):
        proc = self._pg('exec pg_restore -l', stdin_path=dump_path)
        return sum(
            1 for ln in (proc.stdout or b"").decode("utf-8", "replace").splitlines() if ln and not ln.startswith(";")
        )

    def recreate_database(self, name):
        q = shlex.quote(name)
        self._pg(
            'dropdb --if-exists -U "$POSTGRES_USER" %s && createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" %s'
            % (q, q)
        )

    def drop_database(self, name):
        self._pg('dropdb --if-exists -U "$POSTGRES_USER" %s' % shlex.quote(name))

    def pg_restore(self, name, dump_path):
        self._pg(
            'exec pg_restore -U "$POSTGRES_USER" -d %s --no-owner --no-privileges --exit-on-error'
            % shlex.quote(name),
            stdin_path=dump_path,
            timeout=7200,
        )

    def uploads_archive(self, uploads_root, out_path):
        if not uploads_root.startswith("/"):
            raise OpsError("保存先の根が絶対パスではありません")
        self.run(
            self.exec_args("backend")
            + [
                "sh",
                "-c",
                'if [ -d %s ]; then exec tar -C %s -czf - .; '
                'else exec tar -czf - -T /dev/null; fi' % (shlex.quote(uploads_root), shlex.quote(uploads_root)),
            ],
            stdout_path=out_path,
            timeout=7200,
        )

    def containers(self):
        proc = self.run(self.compose + ["ps", "--all", "--format", "json"], check=False)
        if proc.returncode != 0:
            return {"docker compose": "unavailable"}
        text = (proc.stdout or b"").decode("utf-8", "replace").strip()
        items: List[Dict[str, object]] = []
        if text.startswith("["):
            items = json.loads(text)
        else:
            items = [json.loads(ln) for ln in text.splitlines() if ln.strip().startswith("{")]
        out: Dict[str, str] = {}
        for it in items:
            name = str(it.get("Service") or it.get("Name") or "?")
            state = str(it.get("State") or "").lower()
            health = str(it.get("Health") or "").lower()
            if state != "running":
                out[name] = state or "unknown"
            elif health and health != "healthy":
                out[name] = health
            else:
                out[name] = "healthy" if health == "healthy" else "running"
        return out


class LocalExecutor(Executor):
    """検証用(サンドボックス・CI)。backend の Python と PostgreSQL のコマンドを直接使う。

    環境変数: DATABASE_URL(運用中の扱いのDB)、OPS_BACKEND_PYTHON(既定はこの Python)。
    """

    mode = "local"

    def __init__(self) -> None:
        self.python = os.environ.get("OPS_BACKEND_PYTHON") or sys.executable
        self.url = os.environ.get("DATABASE_URL", "")
        if not self.url:
            raise OpsError("local モードでは DATABASE_URL が必要です")
        self.backend_dir = str(REPO / "backend")

    def _url(self, name: str) -> str:
        return opslib.replace_database(self.url, name)

    def backend_python(self, module_args, *, extra_env=None, target_db=None, check=True):
        env = dict(extra_env or {})
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        if target_db:
            env["DATABASE_URL"] = self._url(target_db)
        return self.run([self.python] + list(module_args), env=env, cwd=self.backend_dir, check=check)

    def backend_alembic(self, args, target_db):
        alembic = str(Path(self.python).with_name("alembic"))
        return self.run([alembic] + list(args), env={"DATABASE_URL": self._url(target_db)}, cwd=self.backend_dir)

    def pg_dump(self, database, out_path):
        self.run(
            ["pg_dump", "-d", self._url(database), "-Fc", "-Z", "6", "--no-owner", "--no-privileges"],
            stdout_path=out_path,
            timeout=7200,
        )

    def pg_list(self, dump_path):
        proc = self.run(["pg_restore", "-l", dump_path])
        return sum(1 for ln in (proc.stdout or b"").decode().splitlines() if ln and not ln.startswith(";"))

    def _admin(self, sql: str) -> None:
        self.run(["psql", "-d", self._url("postgres"), "-v", "ON_ERROR_STOP=1", "-q", "-c", sql])

    def recreate_database(self, name):
        self._admin('DROP DATABASE IF EXISTS "%s"' % name)
        self._admin('CREATE DATABASE "%s"' % name)

    def drop_database(self, name):
        self._admin('DROP DATABASE IF EXISTS "%s"' % name)

    def pg_restore(self, name, dump_path):
        self.run(
            ["pg_restore", "-d", self._url(name), "--no-owner", "--no-privileges", "--exit-on-error", dump_path],
            timeout=7200,
        )

    def uploads_archive(self, uploads_root, out_path):
        with tarfile.open(out_path, "w:gz") as tar:
            root = Path(uploads_root)
            if root.is_dir():
                for path in sorted(root.rglob("*")):
                    if path.is_file() and not path.is_symlink():
                        tar.add(str(path), arcname="./" + path.relative_to(root).as_posix(), recursive=False)


def make_executor(mode: str) -> Executor:
    if mode == "local":
        return LocalExecutor()
    if mode == "compose":
        if not shutil.which("docker"):
            raise OpsError("docker が見つかりません(local モードは --mode local)")
        return ComposeExecutor()
    raise OpsError("不明なモード: %s" % mode)


# ---------------------------------------------------------------------------
# 置き場所
# ---------------------------------------------------------------------------


def backup_dir(arg: Optional[str]) -> Path:
    raw = arg or os.environ.get("OPS_BACKUP_DIR") or read_dotenv_value("OPS_BACKUP_DIR") or str(REPO / "backups")
    path = Path(raw).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(str(path), 0o700)
    return path


def state_dir() -> Path:
    raw = os.environ.get("OPS_STATE_DIR") or str(REPO / "ops-state")
    path = Path(raw).expanduser().resolve()
    (path / "logs").mkdir(parents=True, exist_ok=True)
    (path / "drills").mkdir(parents=True, exist_ok=True)
    os.chmod(str(path), 0o700)
    return path


def write_json_atomic(path: Path, obj: object, mode: int = 0o600) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix="." + path.name + ".")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(opslib.dumps_json(obj))
            fh.write("\n")
        os.chmod(tmp, mode)
        os.replace(tmp, str(path))
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def git_commit() -> Optional[str]:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=str(REPO), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30
        )
        value = out.stdout.decode().strip()
        return value or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 点検(コンテナ内のモジュール)
# ---------------------------------------------------------------------------


def facts(ex: Executor, with_files: bool = True) -> Dict[str, object]:
    args = ["-m", "app.ops.storage_facts"] + ([] if with_files else ["--no-files"])
    return ex.json_from(ex.backend_python(args))


def live_database(ex: Executor) -> str:
    proc = ex.backend_python(
        [
            "-c",
            "import os; from app.ops.opslib import database_name; "
            "print(database_name(os.environ['DATABASE_URL']))",
        ]
    )
    name = (proc.stdout or b"").decode().strip().splitlines()[-1]
    if not name:
        raise OpsError("運用中の DB 名を取得できません")
    return name


def inventory(ex: Executor, database: str, storage_keys: bool = False) -> Dict[str, object]:
    args = ["-m", "app.ops.db_inventory", "--database", database] + (["--storage-keys"] if storage_keys else [])
    return ex.json_from(ex.backend_python(args))


def archive_listing(path: str, extract_to: Optional[str] = None) -> Dict[str, Dict[str, object]]:
    """tar.gz の中のファイル一覧(相対パス → size/sha256)。extract_to があれば安全なものだけ展開する。"""
    import hashlib

    out: Dict[str, Dict[str, object]] = {}
    with tarfile.open(path, "r:gz") as tar:
        for member in tar:
            if not member.isfile():
                continue
            if not opslib.safe_archive_member(member.name):
                raise OpsError("アーカイブに展開先の外を指すパスがあります(改ざんの可能性)")
            fh = tar.extractfile(member)
            if fh is None:
                continue
            rel = opslib.normalize_archive_path(member.name)
            digest = hashlib.sha256()
            dest = None
            if extract_to:
                target = Path(extract_to) / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                dest = open(str(target), "wb")
            try:
                while True:
                    block = fh.read(1024 * 1024)
                    if not block:
                        break
                    digest.update(block)
                    if dest:
                        dest.write(block)
            finally:
                if dest:
                    dest.close()
            out[rel] = {"size": member.size, "sha256": digest.hexdigest()}
    return out


# ---------------------------------------------------------------------------
# バックアップ
# ---------------------------------------------------------------------------


def file_info(path: Path) -> Dict[str, object]:
    return {"name": path.name, "size": path.stat().st_size, "sha256": opslib.sha256_file(str(path))}


def cmd_backup(ex: Executor, dest: Path, prune: bool = False) -> Dict[str, object]:
    started = time.time()
    bid = opslib.new_backup_id(now_utc())
    live = live_database(ex)
    log("バックアップを開始します: %s(DB %s)" % (bid, live))
    before = inventory(ex, live)
    source_facts = facts(ex, with_files=True)
    db_path = dest / opslib.backup_file_name(bid, "database")
    up_path = dest / opslib.backup_file_name(bid, "uploads")
    man_path = dest / opslib.backup_file_name(bid, "manifest")
    partial = [dest / ("." + db_path.name + ".partial"), dest / ("." + up_path.name + ".partial")]
    old_umask = os.umask(0o077)
    try:
        ex.pg_dump(live, str(partial[0]))
        entries = ex.pg_list(str(partial[0]))
        if entries < 1:
            raise OpsError("ダンプの目次が空です")
        ex.uploads_archive(str(source_facts["uploads_root"]), str(partial[1]))
        archived = archive_listing(str(partial[1]))
        after = inventory(ex, live)
        files_cmp = opslib.compare_file_listings(source_facts.get("files") or {}, archived)  # type: ignore[arg-type]
        if not files_cmp["ok"]:
            raise OpsError(
                "保存ファイルのアーカイブが元と一致しません(欠落 %d、内容違い %d)" % (len(files_cmp["missing"]), len(files_cmp["changed"]))
            )  # type: ignore[arg-type]
        os.replace(str(partial[0]), str(db_path))
        os.replace(str(partial[1]), str(up_path))
        for p in (db_path, up_path):
            os.chmod(str(p), 0o600)
        manifest = opslib.build_manifest(
            backup_id=bid,
            created_at=now_utc(),
            git_commit=git_commit(),
            alembic_revision=before.get("alembic_revision"),  # type: ignore[arg-type]
            source_database=live,
            files={"database": file_info(db_path), "uploads": file_info(up_path)},
            table_counts=before.get("tables") or {},  # type: ignore[arg-type]
            upload_files=archived,
            key_fingerprints=source_facts.get("key_fingerprints") or {},  # type: ignore[arg-type]
        )
        manifest["table_counts_after"] = dict(sorted((after.get("tables") or {}).items()))  # type: ignore[union-attr]
        manifest["documents_prefix"] = source_facts.get("documents_prefix")
        manifest["verification"] = {
            "dump_entries": entries,
            "uploads_match": True,
            "duration_seconds": round(time.time() - started, 1),
        }
        write_json_atomic(man_path, manifest)
    except BaseException:
        for p in partial + [db_path, up_path, man_path]:
            if p.exists():
                p.unlink()
        raise
    finally:
        os.umask(old_umask)
    problems = cmd_verify_one(dest, bid)
    if problems:
        raise OpsError("作成直後の検証に失敗しました: " + " / ".join(problems))
    result = {
        "backup_id": bid,
        "source_database": live,
        "alembic_revision": manifest["alembic_revision"],
        "database_size": manifest["files"]["database"]["size"],  # type: ignore[index]
        "database_sha256": manifest["files"]["database"]["sha256"],  # type: ignore[index]
        "uploads_size": manifest["files"]["uploads"]["size"],  # type: ignore[index]
        "upload_count": len(archived),
        "tables": len(before.get("tables") or {}),  # type: ignore[arg-type]
        "verified": True,
        "duration_seconds": round(time.time() - started, 1),
    }
    write_json_atomic(state_dir() / "last_backup.json", {"at": now_utc().isoformat(), **result})
    log(
        "バックアップが完了しました: %s(DB %d バイト、保存ファイル %d 件、%s 秒)"
        % (bid, result["database_size"], result["upload_count"], result["duration_seconds"])
    )
    if prune:
        cmd_prune(dest, dry_run=False)
    return result


def load_manifest(dest: Path, bid: str) -> Dict[str, object]:
    path = dest / opslib.backup_file_name(bid, "manifest")
    if not path.is_file():
        raise OpsError("バックアップ %s の目録がありません" % bid)
    return json.loads(path.read_text(encoding="utf-8"))


def cmd_verify_one(dest: Path, bid: str) -> List[str]:
    manifest = load_manifest(dest, bid)
    actual: Dict[str, Dict[str, object]] = {}
    for role in ("database", "uploads"):
        path = dest / opslib.backup_file_name(bid, role)
        if path.is_file():
            actual[role] = file_info(path)
    return opslib.manifest_problems(manifest, actual)


def latest_backup(dest: Path) -> str:
    ids = opslib.backup_ids_in(os.listdir(str(dest)))
    if not ids:
        raise OpsError("バックアップがありません(%s)" % dest)
    return ids[0]


def cmd_prune(dest: Path, dry_run: bool) -> List[str]:
    ids = opslib.backup_ids_in(os.listdir(str(dest)))
    victims = opslib.select_backups_to_prune(
        ids,
        now_utc(),
        keep_daily=int(os.environ.get("OPS_KEEP_DAILY", "7")),
        keep_weekly=int(os.environ.get("OPS_KEEP_WEEKLY", "4")),
        keep_min=int(os.environ.get("OPS_KEEP_MIN", "3")),
    )
    for bid in victims:
        for role in ("database", "uploads", "manifest"):
            p = dest / opslib.backup_file_name(bid, role)
            if p.exists() and not dry_run:
                p.unlink()
        log("%s古い世代を整理: %s" % ("(試行)" if dry_run else "", bid))
    if not victims:
        log("整理するバックアップはありません(%d 世代を保持)" % len(ids))
    return victims


# ---------------------------------------------------------------------------
# 復元
# ---------------------------------------------------------------------------


def cmd_restore(
    ex: Executor, dest: Path, bid: str, target: str, *, files_to: Optional[str] = None
) -> Dict[str, object]:
    live = live_database(ex)
    opslib.check_drill_database_name(target, live)
    problems = cmd_verify_one(dest, bid)
    if problems:
        raise OpsError("バックアップの検証に失敗したため復元しません: " + " / ".join(problems))
    manifest = load_manifest(dest, bid)
    log("復元を開始します: %s → %s(運用中の %s には触れません)" % (bid, target, live))
    started = time.time()
    ex.recreate_database(target)
    ex.pg_restore(target, str(dest / opslib.backup_file_name(bid, "database")))
    restored = inventory(ex, target, storage_keys=True)
    counts = opslib.compare_table_counts(
        manifest.get("table_counts") or {},
        manifest.get("table_counts_after") or manifest.get("table_counts") or {},  # type: ignore[arg-type]
        restored.get("tables") or {},
    )  # type: ignore[arg-type]
    tmp_ctx = tempfile.TemporaryDirectory(prefix="tc-restore-files-")
    try:
        extract_dir = files_to or tmp_ctx.name
        if files_to:
            Path(files_to).mkdir(parents=True, exist_ok=True)
            os.chmod(files_to, 0o700)
        listing = archive_listing(str(dest / opslib.backup_file_name(bid, "uploads")), extract_to=extract_dir)
    finally:
        tmp_ctx.cleanup()
    files_cmp = opslib.compare_file_listings(manifest.get("upload_files") or {}, listing)  # type: ignore[arg-type]
    orphans = opslib.documents_without_files(
        restored.get("storage_keys") or [],
        listing.keys(),  # type: ignore[arg-type]
        str(manifest.get("documents_prefix") or ""),
    )
    files_cmp["documents_without_files"] = len(orphans)
    decrypt = ex.json_from(
        ex.backend_python(["-m", "app.ops.decrypt_check", "--database", target, "--sample", "5"], check=False)
    )
    current_fp = facts(ex, with_files=False).get("key_fingerprints") or {}
    backup_fp = manifest.get("key_fingerprints") or {}
    mismatches = opslib.fingerprint_mismatches(backup_fp, current_fp)  # type: ignore[arg-type]
    alembic_match = restored.get("alembic_revision") == manifest.get("alembic_revision")
    ok = bool(counts["ok"] and files_cmp["ok"] and decrypt.get("ok") and alembic_match and not mismatches)
    result = {
        "ok": ok,
        "backup_id": bid,
        "target_database": target,
        "restored": True,
        "alembic_revision": restored.get("alembic_revision"),
        "alembic_match": alembic_match,
        "counts": counts,
        "files": files_cmp,
        "decrypt": decrypt,
        "fingerprint_mismatches": mismatches,
        "duration_seconds": round(time.time() - started, 1),
    }
    log(
        "復元の確認: 件数 %s / 保存ファイル %s / 復号 %s / 版 %s / 鍵の指紋 %s"
        % (
            "OK" if counts["ok"] else "NG",
            "OK" if files_cmp["ok"] else "NG",
            "OK" if decrypt.get("ok") else "NG",
            "OK" if alembic_match else "NG",
            "OK" if not mismatches else "NG(" + ",".join(mismatches) + ")",
        )
    )
    if orphans:
        log("注意: DB が参照しているのに保存ファイルが無い記録が %d 件あります(バックアップ前からの不整合)" % len(orphans))
    return result


def migration_graph_from_tree() -> Dict[str, Tuple[str, ...]]:
    graph: Dict[str, Tuple[str, ...]] = {}
    for path in sorted((REPO / "backend" / "alembic" / "versions").glob("*.py")):
        rev, downs = opslib.parse_migration_source(path.read_text(encoding="utf-8"))
        graph[rev] = downs
    return graph


def migration_graph_at(rev: str) -> Dict[str, Tuple[str, ...]]:
    if not rev or rev.startswith("-") or any(c.isspace() for c in rev):
        raise OpsError("commit の指定が不正です")
    ls = subprocess.run(
        ["git", "ls-tree", "--name-only", rev, "backend/alembic/versions/"],
        cwd=str(REPO),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
    )
    if ls.returncode != 0:
        raise OpsError("commit %s が見つかりません" % rev)
    graph: Dict[str, Tuple[str, ...]] = {}
    for name in ls.stdout.decode().splitlines():
        if not name.endswith(".py"):
            continue
        src = subprocess.run(
            ["git", "show", "%s:%s" % (rev, name)],
            cwd=str(REPO),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=60,
        )
        r, downs = opslib.parse_migration_source(src.stdout.decode("utf-8", "replace"))
        graph[r] = downs
    return graph


def cmd_rollback_plan(target_rev: str) -> Dict[str, object]:
    plan = opslib.rollback_plan(migration_graph_from_tree(), migration_graph_at(target_rev))
    plan["target"] = target_rev
    return plan


def migration_roundtrip(ex: Executor, target: str) -> Dict[str, object]:
    """復元先 DB で、最新の migration を1つ戻して再適用する(実データ上で downgrade が通ることの確認)。"""
    before = inventory(ex, target)
    start_rev = before.get("alembic_revision")
    ex.backend_alembic(["downgrade", "-1"], target)
    mid = inventory(ex, target).get("alembic_revision")
    ex.backend_alembic(["upgrade", "head"], target)
    after = inventory(ex, target)
    ok = (
        bool(start_rev)
        and mid != start_rev
        and after.get("alembic_revision") == start_rev
        and len(after.get("tables") or {}) == len(before.get("tables") or {})
    )  # type: ignore[arg-type]
    return {
        "ok": ok,
        "from": start_rev,
        "downgraded_to": mid,
        "upgraded_to": after.get("alembic_revision"),
        "tables_before": len(before.get("tables") or {}),
        "tables_after": len(after.get("tables") or {}),
    }  # type: ignore[arg-type]


def cmd_drill(
    ex: Executor,
    dest: Path,
    *,
    from_latest: bool,
    backup_id: Optional[str],
    target: str,
    report: Optional[str],
    keep_db: bool,
) -> Dict[str, object]:
    started_at = now_utc()
    t0 = time.time()
    result: Dict[str, object] = {
        "drill_id": opslib.new_backup_id(started_at).replace("tc-", "drill-"),
        "started_at": started_at.isoformat().replace("+00:00", "Z"),
        "environment": "%s(%s)" % (socket.gethostname(), ex.mode),
        "git_commit": git_commit(),
        "errors": [],
    }
    errors: List[str] = result["errors"]  # type: ignore[assignment]
    try:
        if backup_id:
            bid = backup_id
        elif from_latest:
            bid = latest_backup(dest)
        else:
            bid = str(cmd_backup(ex, dest)["backup_id"])
        m = load_manifest(dest, bid)
        files = m.get("files") or {}
        result["backup"] = {
            "backup_id": bid,
            "source_database": m.get("source_database"),
            "alembic_revision": m.get("alembic_revision"),
            "database_size": files.get("database", {}).get("size"),
            "database_sha256": files.get("database", {}).get("sha256"),  # type: ignore[union-attr]
            "uploads_size": files.get("uploads", {}).get("size"),
            "upload_count": len(m.get("upload_files") or {}),  # type: ignore[union-attr,arg-type]
            "verified": not cmd_verify_one(dest, bid),
        }
        restore = cmd_restore(ex, dest, bid, target)
        result["restore"] = restore
        if not restore["ok"]:
            errors.append("復元の確認に失敗しました")
        try:
            result["migration_roundtrip"] = migration_roundtrip(ex, target)
            if not result["migration_roundtrip"]["ok"]:  # type: ignore[index]
                errors.append("migration の往復(downgrade→upgrade)に失敗しました")
        except OpsError as exc:
            result["migration_roundtrip"] = {"ok": False}
            errors.append("migration の往復: %s" % exc)
        commit = result.get("git_commit")
        if commit:
            try:
                parent = (
                    subprocess.run(
                        ["git", "rev-parse", "--short", "HEAD~1"],
                        cwd=str(REPO),
                        stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL,
                        timeout=30,
                    )
                    .stdout.decode()
                    .strip()
                )
                if parent:
                    result["rollback_plan"] = cmd_rollback_plan(parent)
            except OpsError as exc:
                result["rollback_plan"] = {"ok": False, "reason": str(exc)}
        mon = cmd_monitor(ex, dest, quiet=True, record=False)
        result["monitor"] = {
            "ok": not [
                f
                for f in mon["findings"]
                if f["code"] in ("backend_down", "backend_not_ready", "metrics_unavailable")  # type: ignore[index]
            ],
            "findings": mon["findings"],
        }
        if not result["monitor"]["ok"]:  # type: ignore[index]
            errors.append("監視(/health・/ready・/metrics)の確認に失敗しました")
    except OpsError as exc:
        errors.append(str(exc))
    finally:
        if not keep_db:
            try:
                ex.drop_database(target)
            except OpsError as exc:
                errors.append("演習用DBの削除: %s" % exc)
    result["ok"] = not errors
    result["duration_seconds"] = round(time.time() - t0, 1)
    text = opslib.render_drill_report(result)
    out = Path(report) if report else state_dir() / "drills" / ("%s.md" % result["drill_id"])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    os.chmod(str(out), 0o644)
    if result["ok"]:
        write_json_atomic(
            state_dir() / "last_drill.json",
            {"at": now_utc().isoformat(), "ok": True, "drill_id": result["drill_id"], "report": str(out)},
        )
    log("復元演習: %s(記録 %s)" % ("合格" if result["ok"] else "不合格", out))
    return result


# ---------------------------------------------------------------------------
# 監視
# ---------------------------------------------------------------------------


def http_get(url: str, token: Optional[str] = None, timeout: float = 5.0) -> Tuple[int, str]:
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token} if token else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (自分の backend)
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except Exception:
        return 0, ""


def cmd_monitor(ex: Executor, dest: Path, *, quiet: bool, record: bool = True) -> Dict[str, object]:
    base = (
        os.environ.get("OPS_BACKEND_URL") or read_dotenv_value("OPS_BACKEND_URL") or "http://127.0.0.1:8001"
    ).rstrip("/")
    token = read_dotenv_value("METRICS_TOKEN")
    snap: Dict[str, object] = {"at": now_utc().isoformat()}
    code, _ = http_get(base + "/health")
    snap["health_ok"] = code == 200
    code, body = http_get(base + "/ready")
    try:
        snap["ready"] = json.loads(body).get("checks") if code in (200, 503) else None
    except ValueError:
        snap["ready"] = None
    code, body = http_get(base + "/metrics", token)
    extra: List[Dict[str, str]] = []
    if code == 200:
        metrics = opslib.parse_prometheus(body)
        snap["http_requests_total"] = opslib.metric_sum(metrics, "travelcanvas_http_requests_total")
        snap["http_5xx_total"] = opslib.metric_sum(metrics, "travelcanvas_http_requests_total", status="5xx")
        # [Gate S6] SEC-18 攻撃の兆候
        snap["security_events_total"] = opslib.metric_sum(metrics, "travelcanvas_security_events_total")
        snap["guard_blocks_total"] = opslib.metric_sum(
            metrics, "travelcanvas_security_events_total", kind="guard_block")
        snap["audit_write_failed_total"] = opslib.metric_sum(
            metrics, "travelcanvas_security_events_total", kind="audit_write_failed")
        snap["csp_violations_total"] = opslib.metric_sum(  # [Gate S10]
            metrics, "travelcanvas_security_events_total", kind="csp_violation")
        snap["latency_buckets"] = {
            ("+Inf" if k == float("inf") else repr(k)): v
            for k, v in opslib.histogram_buckets(metrics, "travelcanvas_http_request_duration_seconds").items()
        }
    elif snap["health_ok"]:
        extra.append({"level": "warning", "code": "metrics_unavailable", "message": "/metrics を取得できません(%d)" % code})
    snap["containers"] = ex.containers()
    if snap["containers"] is None:
        del snap["containers"]
    usage = shutil.disk_usage(str(dest))
    snap["disk_free_bytes"], snap["disk_total_bytes"] = usage.free, usage.total
    ids = opslib.backup_ids_in(os.listdir(str(dest)))
    snap["last_backup_age_hours"] = None
    for bid in ids:
        try:
            if not cmd_verify_one(dest, bid):
                snap["last_backup_age_hours"] = round(
                    (now_utc() - opslib.parse_backup_id(bid)).total_seconds() / 3600, 1
                )
                break
        except (OpsError, ValueError):
            continue
    scan_state = state_dir() / "log_scan.json"
    if scan_state.is_file():
        try:
            snap["log_leaks"] = int(json.loads(scan_state.read_text()).get("findings", 0))
        except (ValueError, TypeError):
            pass
    last_drill = state_dir() / "last_drill.json"
    snap["last_drill_age_days"] = None
    if last_drill.is_file():
        try:
            at = datetime.fromisoformat(json.loads(last_drill.read_text())["at"])
            snap["last_drill_age_days"] = round((now_utc() - at).total_seconds() / 86400, 1)
        except (ValueError, KeyError):
            pass
    state_path = state_dir() / "monitor-state.json"
    prev_state: Dict[str, object] = {}
    if state_path.is_file():
        try:
            prev_state = json.loads(state_path.read_text())
        except ValueError:
            prev_state = {}
    findings = opslib.evaluate_monitor(snap, prev_state.get("snapshot"))  # type: ignore[arg-type]
    findings += extra
    trans = opslib.alert_transitions(prev_state.get("active") or [], findings)  # type: ignore[arg-type]
    if record:
        write_json_atomic(state_path, {"snapshot": snap, "active": trans["active"]})
        notify(trans, findings)
    if not quiet or trans["raised"] or trans["resolved"]:
        if findings:
            for f in findings:
                log("[%s] %s: %s" % (f["level"], f["code"], f["message"]))
        else:
            log("監視: 異常なし")
        for code_ in trans["resolved"]:
            log("[resolved] %s" % code_)
    return {"findings": findings, "transitions": trans, "snapshot": snap}


def notify(trans: Mapping[str, List[str]], findings: Sequence[Mapping[str, str]]) -> None:
    """状態が変わった時だけ、OPS_ALERT_WEBHOOK_URL(Slack 互換の incoming webhook)へ送る。"""
    url = read_dotenv_value("OPS_ALERT_WEBHOOK_URL")
    if not url or not (trans["raised"] or trans["resolved"]):
        return
    by_code = {f["code"]: f for f in findings}
    lines = ["[TravelCanvas %s] 監視の状態が変わりました" % socket.gethostname()]
    lines += ["🔴 %s: %s" % (c, by_code[c]["message"]) for c in trans["raised"] if c in by_code]
    lines += ["🟢 回復: %s" % c for c in trans["resolved"]]
    data = json.dumps({"text": "\n".join(lines)}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10).close()  # noqa: S310
    except Exception as exc:
        log("通知の送信に失敗しました: %s" % type(exc).__name__)


# ---------------------------------------------------------------------------
# その他
# ---------------------------------------------------------------------------

def read_secret_lines(path: Optional[str]) -> List[str]:
    """照合する秘密の値の一覧(1行1値)。値は表示しない。"""
    if not path:
        return []
    return [ln.strip() for ln in Path(path).read_text(encoding="utf-8").splitlines() if ln.strip()]


def cmd_log_scan(ex: Executor, *, since: str, services: Sequence[str], secrets_file: Optional[str] = None,
                 log_file: Optional[str] = None, record: bool = True) -> Dict[str, object]:
    """[Gate O2] backend などのコンテナのログに、個人情報・秘密が出ていないかを検査する(B-009)。

    見つけた値そのものは表示・保存しない(種類・行番号・伏せた抜粋だけ)。"""
    if not re.match(r"^\d+[smhd]$|^\d{4}-\d{2}-\d{2}T[\d:]+Z?$", since or ""):
        raise OpsError("--since は 25h・30m のような長さか、UTC の日時(2026-10-17T03:00:00Z)にしてください")
    if log_file:
        text = Path(log_file).read_text(encoding="utf-8", errors="replace")
        source = "file"
    elif isinstance(ex, ComposeExecutor):
        for s in services:
            if not re.match(r"^[a-z][a-z0-9_\-]*$", s):
                raise OpsError("サービス名が不正です")
        proc = ex.run(ex.compose + ["logs", "--no-color", "--no-log-prefix", "--since", since] + list(services),
                      timeout=600)
        text = (proc.stdout or b"").decode("utf-8", "replace") + (proc.stderr or b"").decode("utf-8", "replace")
        source = "docker compose logs " + " ".join(services)
    else:
        raise OpsError("local モードでは --log-file が必要です")
    allow = [e for e in (read_dotenv_value("OPS_LOG_ALLOWED_EMAILS") or "").split(",") if e.strip()]
    findings = log_safety.find_leaks(text, read_secret_lines(secrets_file), max_findings=500, allow_emails=allow)
    lines = text.count("\n")
    result = {"at": now_utc().isoformat(), "since": since, "source": source, "lines": lines,
              "findings": len(findings), "by_kind": log_safety.summarize(findings),
              "samples": [{"kind": f["kind"], "line": f["line"], "excerpt": f["excerpt"]} for f in findings[:20]]}
    if record:
        write_json_atomic(state_dir() / "log_scan.json", result)
    if findings:
        kinds = ", ".join("%s=%d" % kv for kv in log_safety.summarize(findings).items())
        log("ログ検査: %d 行中 %d 件の個人情報・秘密らしき値(%s)" % (lines, len(findings), kinds))
        for f in findings[:20]:
            log("  [%s] %s 行目: %s" % (f["kind"], f["line"], f["excerpt"]))
    else:
        log("ログ検査: %d 行を検査し、個人情報・秘密は見つかりませんでした(%s、%s)" % (lines, source, since))
    return result


PURGE_SCRIPTS = ("scripts/run_plan_purge.py", "scripts/run_document_purge.py", "scripts/run_quickdraft_purge.py")


def cmd_purge(ex: Executor) -> int:
    failed = 0
    for script in PURGE_SCRIPTS:
        proc = ex.backend_python([script], check=False)
        out = (proc.stdout or b"").decode("utf-8", "replace").strip().splitlines()
        log(
            "%s: %s %s" % (script, "OK" if proc.returncode == 0 else "失敗(%d)" % proc.returncode, " / ".join(out[-6:]))
        )
        failed += proc.returncode != 0
    return EXIT_ERROR if failed else EXIT_OK


SECURITY_SCRIPT = "scripts/security_incident.py"


def cmd_security(ex: Executor, security_args: Sequence[str]) -> int:
    """[Gate S8] backend のコンテナの中で封じ込めの操作をする(結果は1行の JSON)。"""
    proc = ex.backend_python([SECURITY_SCRIPT] + list(security_args), check=False)
    out = (proc.stdout or b"").decode("utf-8", "replace").strip()
    err = (proc.stderr or b"").decode("utf-8", "replace").strip()
    if out:
        print(out)
    if err and proc.returncode != 0:
        log(err.splitlines()[-1])
    return int(proc.returncode)


def cmd_keys(ex: Executor, action: str, extra: Sequence[str]) -> int:
    """[Gate G1] SEC-F1/F2 鍵の点検・鍵ごとの件数・掛け直し(backend のコンテナの中。結果は1行の JSON、値は出さない)。"""
    if action == "check":
        module = ["-m", "app.ops.keys", "check"]
    elif action == "status":
        module = ["-m", "app.ops.rekey", "status"] + list(extra)
    else:
        module = ["-m", "app.ops.rekey", "run"] + list(extra)
    proc = ex.backend_python(module, check=False)
    out = (proc.stdout or b"").decode("utf-8", "replace").strip()
    err = (proc.stderr or b"").decode("utf-8", "replace").strip()
    if out:
        print(out)
    if err and proc.returncode != 0:
        log(err.splitlines()[-1])
    return int(proc.returncode)


def cmd_schedule(action: str, python: str) -> int:
    block = opslib.render_cron_block(str(REPO), python=python)
    if action == "print":
        sys.stdout.write(block)
        return EXIT_OK
    if not shutil.which("crontab"):
        raise OpsError("crontab コマンドがありません")
    cur = subprocess.run(["crontab", "-l"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    existing = cur.stdout.decode() if cur.returncode == 0 else ""
    merged = opslib.merge_cron(existing, block if action == "install" else None)
    state_dir()
    proc = subprocess.run(["crontab", "-"], input=merged.encode(), stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise OpsError("crontab の更新に失敗しました: " + proc.stderr.decode().strip())
    log("定期実行を%sしました" % ("登録" if action == "install" else "解除"))
    return EXIT_OK


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="TravelCanvas の運用コマンド(docs/ops/RUNBOOK.md)")
    parser.add_argument("--mode", choices=("compose", "local"), default=os.environ.get("OPS_MODE", "compose"))
    parser.add_argument("--backup-dir", help="バックアップの置き場所(既定 OPS_BACKUP_DIR か <repo>/backups)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("backup")
    p.add_argument("--prune", action="store_true")
    sub.add_parser("list")
    p = sub.add_parser("verify")
    p.add_argument("backup_id", nargs="?")
    p.add_argument("--latest", action="store_true")
    p = sub.add_parser("prune")
    p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("restore")
    p.add_argument("--backup", required=True, help="バックアップID または latest")
    p.add_argument("--target-db", required=True, help="復元先の DB 名(restore を含む別名。運用中の DB は不可)")
    p.add_argument("--files-to", help="保存ファイルを展開するホスト上のディレクトリ(省略時は照合だけ)")
    p = sub.add_parser("drill")
    p.add_argument("--from-latest", action="store_true", help="新しく取らず、最新のバックアップで演習する")
    p.add_argument("--backup", help="演習に使うバックアップID")
    p.add_argument("--target-db", default=DEFAULT_DRILL_DB)
    p.add_argument("--report", help="記録(Markdown)の出力先")
    p.add_argument("--keep-db", action="store_true", help="演習用DBを消さずに残す")
    p = sub.add_parser("rollback-plan")
    p.add_argument("--to", required=True, help="戻し先の commit")
    p = sub.add_parser("monitor")
    p.add_argument("--quiet", action="store_true", help="状態が変わった時だけ表示する")
    sub.add_parser("purge")
    p = sub.add_parser("log-scan", help="コンテナのログに個人情報・秘密が出ていないかの検査(B-009)")
    p.add_argument("--since", default="25h", help="25h・30m のような長さ、または UTC の日時")
    p.add_argument("--service", action="append", dest="services", help="既定は backend")
    p.add_argument("--secrets-file", help="照合する秘密の値の一覧(1行1値、0600 推奨)")
    p.add_argument("--log-file", help="docker の代わりにこのファイルを検査する")
    # [Gate S8] 侵害が疑われる時の封じ込め(Runbook §8)。backend のコンテナの中の scripts/security_incident.py に渡す
    p = sub.add_parser("security", help="警戒モード・セッションの一斉失効・遮断の解除(Runbook §8)")
    p.add_argument("security_args", nargs=argparse.REMAINDER)
    # [Gate G1] 暗号化の鍵の版の切り替え(docs/ops/KEY-INVENTORY.md・Runbook §8.2)
    p = sub.add_parser("keys", help="鍵の点検(check)・鍵ごとの件数(status)・前の鍵の暗号文の掛け直し(rekey)")
    p.add_argument("action", choices=("check", "status", "rekey"))
    p.add_argument("keys_args", nargs=argparse.REMAINDER)
    p = sub.add_parser("schedule")
    p.add_argument("action", choices=("print", "install", "remove"))
    p.add_argument("--python", default=sys.executable if sys.executable.startswith("/") else "/usr/bin/python3")
    args = parser.parse_args(argv)

    try:
        if args.cmd == "schedule":
            return cmd_schedule(args.action, args.python)
        if args.cmd == "rollback-plan":
            plan = cmd_rollback_plan(args.to)
            print(opslib.dumps_json(plan))
            return EXIT_OK if plan["ok"] else EXIT_WARN
        if args.cmd == "security":
            return cmd_security(make_executor(args.mode), args.security_args)
        if args.cmd == "keys":
            return cmd_keys(make_executor(args.mode), args.action, args.keys_args)
        if args.cmd == "log-scan" and args.log_file:
            # ファイルを検査するだけなので、docker・DB への接続もバックアップの置き場所も要らない
            res = cmd_log_scan(Executor(), since=args.since, services=args.services or ["backend"],
                               secrets_file=args.secrets_file, log_file=args.log_file)
            return EXIT_OK if not res["findings"] else EXIT_WARN
        dest = backup_dir(args.backup_dir)
        if args.cmd == "list":
            for bid in opslib.backup_ids_in(os.listdir(str(dest))):
                problems = cmd_verify_one(dest, bid)
                m = load_manifest(dest, bid)
                print(
                    "%s  %s  alembic=%s  files=%d  %s"
                    % (
                        bid,
                        "OK" if not problems else "NG",
                        m.get("alembic_revision"),
                        len(m.get("upload_files") or {}),  # type: ignore[arg-type]
                        "" if not problems else " / ".join(problems),
                    )
                )
            return EXIT_OK
        if args.cmd == "verify":
            bid = latest_backup(dest) if (args.latest or not args.backup_id) else args.backup_id
            problems = cmd_verify_one(dest, bid)
            log("%s: %s" % (bid, "検証OK" if not problems else " / ".join(problems)))
            return EXIT_OK if not problems else EXIT_ERROR
        if args.cmd == "prune":
            cmd_prune(dest, args.dry_run)
            return EXIT_OK
        ex = make_executor(args.mode)
        if args.cmd == "backup":
            cmd_backup(ex, dest, prune=args.prune)
            return EXIT_OK
        if args.cmd == "restore":
            bid = latest_backup(dest) if args.backup == "latest" else args.backup
            res = cmd_restore(ex, dest, bid, args.target_db, files_to=args.files_to)
            summary = {k: v for k, v in res.items() if k != "counts"}
            summary["counts_ok"] = res["counts"]["ok"]  # type: ignore[index]
            print(opslib.dumps_json(summary))
            return EXIT_OK if res["ok"] else EXIT_ERROR
        if args.cmd == "drill":
            res = cmd_drill(
                ex,
                dest,
                from_latest=args.from_latest,
                backup_id=args.backup,
                target=args.target_db,
                report=args.report,
                keep_db=args.keep_db,
            )
            return EXIT_OK if res["ok"] else EXIT_ERROR
        if args.cmd == "monitor":
            mon = cmd_monitor(ex, dest, quiet=args.quiet)
            levels = set(f["level"] for f in mon["findings"])  # type: ignore[index]
            return EXIT_CRIT if "critical" in levels else EXIT_WARN if levels else EXIT_OK
        if args.cmd == "purge":
            return cmd_purge(ex)
        if args.cmd == "log-scan":
            res = cmd_log_scan(ex, since=args.since, services=args.services or ["backend"],
                               secrets_file=args.secrets_file, log_file=args.log_file)
            return EXIT_OK if not res["findings"] else EXIT_WARN
    except (OpsError, ValueError) as exc:
        log("失敗: %s" % exc)
        return EXIT_ERROR
    except KeyboardInterrupt:
        log("中断しました")
        return EXIT_ERROR
    return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
