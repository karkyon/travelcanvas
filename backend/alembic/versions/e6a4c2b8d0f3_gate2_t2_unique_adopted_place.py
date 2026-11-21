"""[Gate② T2] 候補の採用(adopt)の一意制約: 同じ人が同じ候補から作る場所は 1 つだけ。

- 部分一意インデックス places(created_by, adopted_from_candidate_id) WHERE adopted_from_candidate_id IS NOT NULL
- これまでは候補の行を FOR UPDATE で押さえて並列の採用を直列にしていた(search.adopt_candidate)。その守りは残し、
  DB でも二重に守る(分離レベルを変えた時・ロックを通らない経路を将来足した時も重複を作らない)
- 作る前に重複を確かめる。開発環境 2 つは重複 0 件(利用者のログ 2026-11-21)。重複があればここで止まり、何も変えない
  (どの Place を残すかは参照の付け替えが要るため、自動では決めない)
- 候補から作っていない場所(adopted_from_candidate_id が NULL)・作った人が NULL の場所は対象外
- downgrade はインデックスを消すだけ(データは変えない)
"""
import sqlalchemy as sa
from alembic import op

revision = "e6a4c2b8d0f3"
down_revision = "d5e9f3a7b2c6"
branch_labels = None
depends_on = None

INDEX = "uq_places_adopted_candidate_owner"


def upgrade() -> None:
    bind = op.get_bind()
    dup = bind.execute(sa.text(
        "SELECT count(*) FROM (SELECT 1 FROM places WHERE adopted_from_candidate_id IS NOT NULL "
        "GROUP BY created_by, adopted_from_candidate_id HAVING count(*) > 1) d"
    )).scalar()
    if dup:
        raise RuntimeError(
            f"places に同じ人・同じ候補の重複が {dup} 組あります。一意制約を足せません"
            "(scripts/ops/gate2_env_record.sh の t2_duplicate_groups を確かめ、重複を統合してから流し直してください)"
        )
    op.create_index(INDEX, "places", ["created_by", "adopted_from_candidate_id"], unique=True,
                    postgresql_where=sa.text("adopted_from_candidate_id IS NOT NULL"))


def downgrade() -> None:
    op.drop_index(INDEX, table_name="places")
