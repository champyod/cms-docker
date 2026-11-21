#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2026 Champ <noreply@example.invalid>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""The security block ledger, written by the web servers and read by the panel.

The table is created by a Prisma migration
(`admin-panel/prisma/migrations/20261009120000_security_blocks`), so it is
mapped here only to append rows: the panel's `/security/blocks` page is the
operator's single lockout list, and it reads this table. A lockout the web
servers count is worthless to an operator if it never becomes a row.
"""

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.schema import Column
from sqlalchemy.types import BigInteger, Boolean, DateTime, Integer, Unicode

from .base import Base


class SecurityBlock(Base):
    """One ban or lockout, active until it ends or its expiry passes.

    The identity the panel keys a row on is ``(kind, ip, subject)``: a repeated
    block with the same identity closes the still-active one first, so the
    ledger never holds two active rows for one banned account and address.
    """

    __tablename__ = "security_blocks"

    id: int = Column(BigInteger, primary_key=True)
    kind: str = Column(Unicode, nullable=False)
    source: str = Column(Unicode, nullable=False)
    ip: str | None = Column(Unicode, nullable=True)
    subject: str | None = Column(Unicode, nullable=True)
    detail = Column(JSONB, nullable=True)
    started_at = Column(DateTime, nullable=False, server_default="now()")
    expires_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    ended_by: int | None = Column(Integer, nullable=True)
    active: bool = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, server_default="now()")
