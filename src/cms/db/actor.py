#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
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

"""The identity a database transaction acts as.

Row-level security in this database is keyed on one transaction-local GUC,
``cms.actor``. A policy reads it through ``cms_actor_is_staff()`` and friends
(see the generated policy migration); with nothing set, every predicate is
false and the transaction can read no row and write none. That is deliberate:
the previous state was a tautology, so "no actor" meant "everything".

Three rules, and they are the whole contract:

1. One implementation. Every SQLAlchemy session gets the actor from the
   ``after_begin`` hook installed in :mod:`cms.db.session`, so a transaction
   that begins after a ``commit()`` in the same session is stamped again and
   no call site has to remember anything. Raw psycopg2 connections (large
   objects, the drop verb) are stamped where they are opened.
2. Transaction scope, never session scope, on anything pooled. A pooled
   connection that kept a previous transaction's actor would leak one request's
   identity into the next one; ``set_config(..., is_local => true)`` is undone
   at COMMIT/ROLLBACK and cannot leak. The only exception is the dedicated,
   never-pooled connection in :func:`cms.db.session.custom_psycopg2_connection`,
   which is closed by its owner and is documented there.
3. No silent fallback. A malformed identity raises instead of degrading to a
   valid one, because a typo in a deployment variable must not quietly become
   "the core" and grant a script the core's access.

The core is one process family with one database role, so it announces itself
as ``system:core``; :func:`process_label` carries the program name alongside it
for the audit trail, and is deliberately NOT part of the authorization key.
"""

import logging
import os
import re
import sys
import typing

logger = logging.getLogger(__name__)

# The GUC the policies read. Changing it is a schema-level decision: the
# generator (scripts/__generate_rls_sql.sh) renders the same name into every
# predicate, so this constant and that script must move together.
ACTOR_SETTING = "cms.actor"

# The identity every core program acts as. It is in the generated policy
# allowlist; the process name below is not.
CORE_ACTOR = "system:core"

# The full set the generator knows about, restated here only so a mistaken
# value fails at start-up with a readable message instead of at the first
# query with an empty result set.
KNOWN_SYSTEM_ACTORS = frozenset([
    "system:auth",
    "system:cli",
    "system:core",
    "system:ingest",
    "system:migration",
])

# WHY this shape: it is exactly what public.cms_actor_admin_id() accepts
# ('^admin:[0-9]{1,9}$') plus the system namespace. Anything else — a name
# with a colon in it, an admin id with a sign, an empty string — is refused
# here rather than being passed to a policy that would treat it as nobody.
_ACTOR_RE = re.compile(r"\A(?:admin:[0-9]{1,9}|system:[a-z][a-z0-9:_-]{0,63})\Z")

# WHY the environment variable and not a CLI flag: every core entry point is a
# separate console script (cmsWorker, cmsContestWebServer, cmsRankingWebServer,
# cmsScoringService, ...) and a flag would have to be threaded through all of
# them; the environment is what the container already carries.
ACTOR_ENV = "CMS_DB_ACTOR"


class InvalidActorError(ValueError):
    """The configured identity is not one the policies could understand."""


def validate_actor(actor: str) -> str:
    """Return ``actor`` if the policies can read it, else raise.

    A system identity outside :data:`KNOWN_SYSTEM_ACTORS` is refused too: the
    generated predicates name their identities explicitly, so an unknown one
    would authenticate nothing and only produce an empty result set — a
    failure that reads like "the database is empty" rather than "you are
    nobody". Raising names the fault.
    """
    if not isinstance(actor, str) or _ACTOR_RE.match(actor) is None:
        raise InvalidActorError(
            "not a usable database actor: %r (expected 'admin:<id>' or "
            "'system:<name>')" % (actor,))
    if actor.startswith("system:") and actor not in KNOWN_SYSTEM_ACTORS:
        raise InvalidActorError(
            "unknown system identity %r — the RLS policies name their "
            "identities explicitly, so this one would match no policy; known: "
            "%s" % (actor, ", ".join(sorted(KNOWN_SYSTEM_ACTORS))))
    return actor


def default_actor() -> str:
    """The identity this process acts as.

    ``CMS_DB_ACTOR`` wins when set, so an operator can attribute a one-off job
    to a named identity without a code change; otherwise the core identity.
    """
    configured = os.environ.get(ACTOR_ENV, "").strip()
    if configured:
        return validate_actor(configured)
    return CORE_ACTOR


def process_label() -> str:
    """A human-readable name for this program, for logging and the audit trail.

    WHY it is not the actor: authorization must not depend on which console
    script is running — the core's programs share one database role and one
    set of permissions, so giving each its own allowlist entry would multiply
    the policy surface without adding a boundary. The label exists so an
    operator reading a log can tell cmsWorker from cmsContestWebServer.
    """
    argv0 = sys.argv[0] if sys.argv and sys.argv[0] else ""
    return os.path.basename(argv0) or "cms"


def actor_sql() -> str:
    """The statement that stamps the current transaction.

    ``is_local => true`` is the whole point: the setting is undone when the
    transaction ends, so a pooled connection cannot carry it into the next
    one. Callers pass the value as a bind parameter, never interpolated.
    """
    return "SELECT set_config('%s', %%s, true)" % (ACTOR_SETTING,)


def apply_actor(connection: typing.Any, actor: typing.Optional[str] = None) -> str:
    """Stamp ``connection``'s current transaction and return the actor used.

    Accepts a SQLAlchemy :class:`~sqlalchemy.engine.Connection` or a raw
    psycopg2 connection; both expose ``execute`` with ``%s`` placeholders once
    a cursor is in hand, which is why the two paths are separated here rather
    than duplicated at every call site.
    """
    actor = validate_actor(actor if actor is not None else default_actor())
    cursor = connection.cursor()
    try:
        cursor.execute(actor_sql(), (actor,))
    finally:
        cursor.close()
    return actor


def apply_actor_session(connection: typing.Any, actor: typing.Optional[str] = None) -> str:
    """Stamp a DEDICATED, never-pooled psycopg2 connection for its lifetime.

    WHY session scope here when everything else is transaction scope: this is
    the connection built by ``custom_psycopg2_connection``, which the docstring
    there promises is outside the pool and closed by its owner. A transaction
    scope would be lost at the first ``commit()`` mid-stream (large-object
    reads commit), leaving the rest of that stream unidentified.
    """
    actor = validate_actor(actor if actor is not None else default_actor())
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT set_config('%s', %%s, false)" % (ACTOR_SETTING,), (actor,))
    finally:
        cursor.close()
    connection.commit()
    return actor
