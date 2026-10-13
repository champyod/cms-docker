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

"""Whether a login attempt is exempt from the lockout and the adaptive captcha.

Mirrors the panel's `security_blocks` exemption rows: a `login_exemption` row
blank on one dimension is a wildcard for it, and a row blank on both is not an
exemption (it would cover everyone). The read is best-effort: a ledger that
cannot be reached reads as "not exempt", so an unreadable ledger can never lift
a lockout.
"""

import logging

from sqlalchemy import and_, not_, or_

from cms.db import SessionGen
from cms.db.security_block import SecurityBlock


logger = logging.getLogger(__name__)

EXEMPTION_KIND = "login_exemption"


def is_login_exempt(username: str, ip: str) -> bool:
    """Return whether *username* from *ip* is permanently exempt."""
    try:
        with SessionGen() as session:
            row = session.query(SecurityBlock).filter(
                SecurityBlock.kind == EXEMPTION_KIND,
                SecurityBlock.active.is_(True),
                or_(SecurityBlock.subject == username,
                    SecurityBlock.subject.is_(None)),
                or_(SecurityBlock.ip == ip, SecurityBlock.ip.is_(None)),
                not_(and_(SecurityBlock.subject.is_(None),
                          SecurityBlock.ip.is_(None))),
            ).first()
            return row is not None
    except Exception:
        logger.exception("Could not read login exemptions; treating %r from %s "
                         "as not exempt", username, ip)
        return False


__all__ = ["is_login_exempt", "EXEMPTION_KIND"]
