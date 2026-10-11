"""gate_p2_budget_expense_settlement

Revision ID: b8e3f1a6c2d9
Revises: a4d7e2c9b1f6
Create Date: 2026-10-02 20:00:00.000000

[Gate P2] FR-027 予算・費用 / FR-028 立替・精算(DOC-05 §8.6 budgets / expenses / expense_shares / settlements)。

新規テーブル5つを追加するだけの完全にadditiveな変更で、既存テーブル・既存データには一切触れない
(backfill不要。travel_plans.budget(Float)は既存画面のため残し、新しい予算は budgets に持つ)。

- plan_finance_settings: プランの基準通貨(行が無ければJPY)。
- budgets: 旅行全体・カテゴリ別・日別・個人の予算。個人の予算(FC-055)は金額を暗号文だけに保存する。
- expenses / expense_shares: 支出と返金(返金は元の支出を参照)、負担者ごとの負担額。金額はNumeric、
  通貨はISO 4217。換算レート未入力の外貨はbase_amount NULL(集計から除外し件数で示す)。
  分担の合計が支出額と一致することはAPIで保証し、丸め差は rounding_adjustment に明示する。
- settlements: メンバー間の精算記録。
- plan_id は全て ON DELETE CASCADE(プラン完全削除を妨げない。B-012の外部キー方針の試験が検査する)。
  関連する予約・予定・領収書は外部キーにしない(B-013の個別削除を妨げないため)。

downgrade はテーブルを削除する(予算・支出・精算のデータは失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b8e3f1a6c2d9'
down_revision: Union[str, Sequence[str], None] = 'a4d7e2c9b1f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _plan_fk():
    return sa.ForeignKey('travel_plans.id', ondelete='CASCADE')


def upgrade() -> None:
    op.create_table(
        'plan_finance_settings',
        sa.Column('plan_id', UUID, _plan_fk(), primary_key=True, nullable=False),
        sa.Column('base_currency', sa.String(length=3), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("base_currency ~ '^[A-Z]{3}$'", name='ck_plan_finance_settings_currency'),
    )

    op.create_table(
        'budgets',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, _plan_fk(), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('kind', sa.String(length=8), nullable=False),
        sa.Column('category', sa.String(length=20), nullable=True),
        sa.Column('local_date', sa.Date(), nullable=True),
        sa.Column('member_user_id', UUID, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('amount', sa.Numeric(18, 2), nullable=True),
        sa.Column('amount_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('note', sa.String(length=200), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('total','category','day','member')", name='ck_budgets_kind'),
        sa.CheckConstraint(
            "(kind = 'total' AND category IS NULL AND local_date IS NULL AND member_user_id IS NULL)"
            " OR (kind = 'category' AND category IS NOT NULL AND local_date IS NULL AND member_user_id IS NULL)"
            " OR (kind = 'day' AND category IS NULL AND local_date IS NOT NULL AND member_user_id IS NULL)"
            " OR (kind = 'member' AND category IS NULL AND local_date IS NULL AND member_user_id IS NOT NULL)",
            name='ck_budgets_kind_target',
        ),
        sa.CheckConstraint(
            "(kind = 'member' AND amount IS NULL AND amount_ciphertext IS NOT NULL)"
            " OR (kind <> 'member' AND amount IS NOT NULL AND amount >= 0 AND amount_ciphertext IS NULL)",
            name='ck_budgets_amount',
        ),
    )
    op.create_index('ix_budgets_id', 'budgets', ['id'])
    op.create_index('ix_budgets_plan_deleted', 'budgets', ['plan_id', 'deleted_at'])

    op.create_table(
        'expenses',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, _plan_fk(), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('kind', sa.String(length=7), nullable=False),
        sa.Column('refund_of_expense_id', UUID, sa.ForeignKey('expenses.id', ondelete='CASCADE'), nullable=True),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('category', sa.String(length=20), nullable=False),
        sa.Column('local_date', sa.Date(), nullable=True),
        sa.Column('amount', sa.Numeric(18, 2), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('tax_amount', sa.Numeric(18, 2), nullable=True),
        sa.Column('fee_amount', sa.Numeric(18, 2), nullable=True),
        sa.Column('fx_rate', sa.Numeric(18, 8), nullable=True),
        sa.Column('fx_source', sa.String(length=100), nullable=True),
        sa.Column('fx_date', sa.Date(), nullable=True),
        sa.Column('base_amount', sa.Numeric(18, 2), nullable=True),
        sa.Column('paid_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('split_method', sa.String(length=6), nullable=False),
        sa.Column('related_type', sa.String(length=20), nullable=True),
        sa.Column('related_id', UUID, nullable=True),
        sa.Column('receipt_document_id', UUID, nullable=True),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('expense','refund')", name='ck_expenses_kind'),
        sa.CheckConstraint("(kind = 'refund') = (refund_of_expense_id IS NOT NULL)", name='ck_expenses_refund_ref'),
        sa.CheckConstraint('amount >= 0', name='ck_expenses_amount'),
        sa.CheckConstraint('tax_amount IS NULL OR (tax_amount >= 0 AND tax_amount <= amount)', name='ck_expenses_tax'),
        sa.CheckConstraint('fee_amount IS NULL OR (fee_amount >= 0 AND fee_amount <= amount)', name='ck_expenses_fee'),
        sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name='ck_expenses_currency'),
        sa.CheckConstraint('fx_rate IS NULL OR fx_rate > 0', name='ck_expenses_fx_rate'),
        sa.CheckConstraint('(fx_rate IS NULL) = (base_amount IS NULL)', name='ck_expenses_base_amount'),
        sa.CheckConstraint(
            "category IN ('lodging','transport','food','activity','shopping','fee','cancellation','other')",
            name='ck_expenses_category',
        ),
        sa.CheckConstraint("split_method IN ('equal','ratio','amount','none')", name='ck_expenses_split_method'),
        sa.CheckConstraint(
            "related_type IS NULL OR related_type IN ('event','reservation','segment')", name='ck_expenses_related_type',
        ),
        sa.CheckConstraint('(related_type IS NULL) = (related_id IS NULL)', name='ck_expenses_related_pair'),
    )
    op.create_index('ix_expenses_id', 'expenses', ['id'])
    op.create_index('ix_expenses_plan_deleted', 'expenses', ['plan_id', 'deleted_at'])

    op.create_table(
        'expense_shares',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('expense_id', UUID, sa.ForeignKey('expenses.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('weight', sa.Numeric(12, 4), nullable=True),
        sa.Column('share_amount', sa.Numeric(18, 2), nullable=False),
        sa.Column('base_share_amount', sa.Numeric(18, 2), nullable=True),
        sa.Column('rounding_adjustment', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.UniqueConstraint('expense_id', 'user_id', name='uq_expense_shares_expense_user'),
        sa.CheckConstraint('share_amount >= 0', name='ck_expense_shares_amount'),
        sa.CheckConstraint('base_share_amount IS NULL OR base_share_amount >= 0', name='ck_expense_shares_base'),
        sa.CheckConstraint('weight IS NULL OR weight > 0', name='ck_expense_shares_weight'),
    )
    op.create_index('ix_expense_shares_id', 'expense_shares', ['id'])
    op.create_index('ix_expense_shares_expense', 'expense_shares', ['expense_id', 'sort_order'])

    op.create_table(
        'settlements',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, _plan_fk(), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('from_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('to_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('amount', sa.Numeric(18, 2), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('settled_on', sa.Date(), nullable=True),
        sa.Column('note', sa.String(length=200), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint('amount > 0', name='ck_settlements_amount'),
        sa.CheckConstraint('from_user_id <> to_user_id', name='ck_settlements_parties'),
        sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name='ck_settlements_currency'),
    )
    op.create_index('ix_settlements_id', 'settlements', ['id'])
    op.create_index('ix_settlements_plan_deleted', 'settlements', ['plan_id', 'deleted_at'])


def downgrade() -> None:
    op.drop_index('ix_settlements_plan_deleted', table_name='settlements')
    op.drop_index('ix_settlements_id', table_name='settlements')
    op.drop_table('settlements')
    op.drop_index('ix_expense_shares_expense', table_name='expense_shares')
    op.drop_index('ix_expense_shares_id', table_name='expense_shares')
    op.drop_table('expense_shares')
    op.drop_index('ix_expenses_plan_deleted', table_name='expenses')
    op.drop_index('ix_expenses_id', table_name='expenses')
    op.drop_table('expenses')
    op.drop_index('ix_budgets_plan_deleted', table_name='budgets')
    op.drop_index('ix_budgets_id', table_name='budgets')
    op.drop_table('budgets')
    op.drop_table('plan_finance_settings')
