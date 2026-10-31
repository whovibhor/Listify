"""sidebar and workspace preferences

Revision ID: b41e7d2a9c55
Revises: 630c0a73320e
Create Date: 2026-10-31 18:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision: str = 'b41e7d2a9c55'
down_revision: Union[str, Sequence[str], None] = '630c0a73320e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'user_preferences',
        sa.Column('sidebar_collapsed', sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        'user_preferences',
        sa.Column('last_organization_id', mysql.BIGINT(unsigned=True), nullable=True),
    )
    op.create_foreign_key(
        op.f('fk_user_preferences_last_organization_id_organizations'),
        'user_preferences',
        'organizations',
        ['last_organization_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f('fk_user_preferences_last_organization_id_organizations'),
        'user_preferences',
        type_='foreignkey',
    )
    op.drop_column('user_preferences', 'last_organization_id')
    op.drop_column('user_preferences', 'sidebar_collapsed')
