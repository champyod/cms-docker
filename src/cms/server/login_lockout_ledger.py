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

"""Mirror login lockouts into the panel's `security_blocks` ledger.

The failure counters are the enforcement: they live in the shared store and a
login is refused from them. This module writes the operator-facing record, so
the panel's block list shows the lockouts these servers actually produce.

The write is best-effort by design. A lost audit row is never worth failing a
login for, so every error is logged and swallowed: a ledger that is unreachable,
or a deployment that has not yet run the migration, leaves the login decision
exactly as the counters made it.
"""

import logging
from datetime import datetime, timedelta, timezone

from cms.db import SessionGen
from cms.db.security_block import SecurityBlock


logger = logging.getLogger(__name__)

LOCKOUT_KIND = "login_lockout"
LOCKOUT_SOURCE = "app"


def _utc_naive() -> datetime:
    """Return the current UTC time as the naive value the column stores."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def record_login_lockout(username: str, ip: str, window_seconds: float) -> None:
    """Append one lockout, closing any still-active row for the same identity.

    The window is the counter's own lifespan, so the row's expiry is the moment
    the refusal would lapse on its own even if nobody lifts it by hand.
    """
    try:
        now = _utc_naive()
        expires_at = now + timedelta(seconds=window_seconds)
        with SessionGen() as session:
            session.query(SecurityBlock).filter(
                SecurityBlock.kind == LOCKOUT_KIND,
                SecurityBlock.ip == ip,
                SecurityBlock.subject == username,
                SecurityBlock.active.is_(True),
            ).update({"active": False, "ended_at": now},
                     synchronize_session=False)
            session.add(SecurityBlock(
                kind=LOCKOUT_KIND,
                source=LOCKOUT_SOURCE,
                ip=ip,
                subject=username,
                detail={"expiresAt": expires_at.isoformat()},
                started_at=now,
                created_at=now,
                expires_at=expires_at,
            ))
            session.commit()
    except Exception:
        # WHY caught here and not by the caller: the lockout sink runs inside a
        # login request, and an audit record that cannot be written must not
        # change the answer the counters already gave.
        logger.exception("Could not record the login lockout for %r from %s",
                         username, ip)


__all__ = ["record_login_lockout", "LOCKOUT_KIND", "LOCKOUT_SOURCE"]
