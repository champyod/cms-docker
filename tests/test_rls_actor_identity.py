#!/usr/bin/env python3
# tests/test_rls_actor_identity.py — the core's database identity.
#
# WHY this suite exists: every table is row-level secured on `cms.actor`, so a core process that
# does not say who it is reads nothing and writes nothing. The actor is therefore load-bearing in a
# way that a silent bug would hide completely — an empty result set, not an error. This suite pins
# the three things that can go wrong without anybody noticing:
#
#   1. the identity is malformed or unknown, and a "helpful" fallback quietly grants the core's
#      access to whatever was misconfigured;
#   2. the statement is not transaction-scoped, so a pooled connection carries one transaction's
#      identity into the next;
#   3. the hook that applies it is not actually registered on the session class, so SessionGen
#      works in tests and does nothing in production.
#
# The DB-backed half runs only when CMS_RLS_TEST_DATABASE_URL is set (CI has no server): it opens a
# real SessionGen and reads the setting back from Postgres, which is the only way to prove the hook
# fires at BEGIN rather than being merely defined.
#
# RUN: CMS_RLS_TEST_DATABASE_URL=postgresql://cmsuser:cms@127.0.0.1:5432/cmsdb \
#        python3 tests/test_rls_actor_identity.py

import os
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "src"))

# WHY the import is guarded: `make test` runs on a bare python3 (the CI suites job installs jq and
# Bun, not the core's dependencies), and this module imports the core, which needs SQLAlchemy. The
# alternative — an unguarded import — turns "this machine lacks a library" into a red build, which is
# how a suite stops being run at all. The skip says what to install and where the half runs.
try:
    from sqlalchemy import event  # noqa: E402

    from cms.db import actor as db_actor  # noqa: E402
    from cms.db import session as db_session  # noqa: E402
except ModuleNotFoundError as missing:  # pragma: no cover - depends on the host
    print(
        f"SKIP: {missing.name} is not installed. This suite exercises the core's database identity "
        "and needs the core's dependencies (pip install -r src/constraints.txt). Run it where they "
        "are present; the panel's half of the same identity is pinned by tests/rls-actor.test.ts."
    )
    raise SystemExit(0)

TEST_URL = os.environ.get("CMS_RLS_TEST_DATABASE_URL", "").strip()


class RecordingConnection:
    """Stands in for a psycopg2 connection: records what would be sent."""

    def __init__(self):
        self.statements = []

    def execute(self, statement, params=None):
        """The SQLAlchemy Connection surface the session hook uses."""
        self.statements.append((str(statement), dict(params or {})))

    def cursor(self):
        outer = self

        class Cursor:
            def execute(self, sql, params=None):
                outer.statements.append((sql, params))

            def close(self):
                pass

        return Cursor()

    def commit(self):
        self.statements.append(("COMMIT", None))


class TestActorValue(unittest.TestCase):
    def test_the_core_names_itself(self):
        self.assertEqual(db_actor.default_actor(), db_actor.CORE_ACTOR)
        self.assertEqual(db_actor.CORE_ACTOR, "system:core")

    def test_an_admin_actor_is_accepted_verbatim(self):
        self.assertEqual(db_actor.validate_actor("admin:12"), "admin:12")

    def test_a_known_system_actor_is_accepted(self):
        for name in sorted(db_actor.KNOWN_SYSTEM_ACTORS):
            self.assertEqual(db_actor.validate_actor(name), name)

    def test_an_unknown_system_identity_is_refused(self):
        # WHY refused rather than passed through: the generated predicates name their identities
        # explicitly, so an unknown one would authenticate as nobody and the only symptom would be
        # an empty table. Naming the fault at start-up is the whole point.
        with self.assertRaises(db_actor.InvalidActorError):
            db_actor.validate_actor("system:not-in-the-allowlist")

    def test_a_malformed_value_is_refused(self):
        for bad in ["", "admin:", "admin:abc", "admin:12:13", "system:", " root", "admin:-1"]:
            with self.assertRaises(db_actor.InvalidActorError, msg=bad):
                db_actor.validate_actor(bad)

    def test_the_environment_variable_wins_and_is_validated(self):
        previous = os.environ.get(db_actor.ACTOR_ENV)
        try:
            os.environ[db_actor.ACTOR_ENV] = "admin:5"
            self.assertEqual(db_actor.default_actor(), "admin:5")
            os.environ[db_actor.ACTOR_ENV] = "system:bogus"
            with self.assertRaises(db_actor.InvalidActorError):
                db_actor.default_actor()
        finally:
            if previous is None:
                os.environ.pop(db_actor.ACTOR_ENV, None)
            else:
                os.environ[db_actor.ACTOR_ENV] = previous

    def test_a_blank_environment_variable_falls_back_to_the_core(self):
        previous = os.environ.get(db_actor.ACTOR_ENV)
        try:
            os.environ[db_actor.ACTOR_ENV] = "   "
            self.assertEqual(db_actor.default_actor(), db_actor.CORE_ACTOR)
        finally:
            if previous is None:
                os.environ.pop(db_actor.ACTOR_ENV, None)
            else:
                os.environ[db_actor.ACTOR_ENV] = previous


class TestTheStatement(unittest.TestCase):
    def test_the_transaction_scoped_statement_is_local(self):
        # `true` is is_local: the setting dies at COMMIT/ROLLBACK. A `false` here would be a
        # cross-request authorization bug on every pooled connection, one keyword away.
        self.assertIn(", true)", db_actor.actor_sql())
        self.assertNotIn(", false)", db_actor.actor_sql())
        self.assertEqual(db_actor.actor_sql().count("%s"), 1)

    def test_it_always_binds_the_value(self):
        conn = RecordingConnection()
        db_actor.apply_actor(conn, "admin:3")
        sql, params = conn.statements[0]
        self.assertIn("set_config", sql)
        self.assertEqual(params, ("admin:3",))
        self.assertNotIn("admin:3", sql)

    def test_the_dedicated_connection_is_stamped_at_session_scope(self):
        # The one documented exception: this connection is never pooled, and large-object traffic
        # commits mid-stream, so a transaction scope would be lost half-way through a stream.
        conn = RecordingConnection()
        db_actor.apply_actor_session(conn, "system:core")
        sql, params = conn.statements[0]
        self.assertIn(", false)", sql)
        self.assertEqual(params, ("system:core",))
        self.assertEqual(conn.statements[-1][0], "COMMIT")


class TestTheHook(unittest.TestCase):
    def test_the_hook_is_registered_on_the_session_class(self):
        # A hook that is defined but not registered leaves SessionGen looking correct in every unit
        # test and silently identity-less in production.
        self.assertTrue(
            event.contains(
                db_session.Session.class_, "after_begin", db_session._stamp_actor
            ),
            "the after_begin hook is not registered — SessionGen would set no actor",
        )

    def test_the_hook_sends_the_core_identity(self):
        conn = RecordingConnection()

        class FakeSession:
            pass

        db_session._stamp_actor(FakeSession(), object(), conn)

        self.assertEqual(len(conn.statements), 1)
        sql, params = conn.statements[0]
        self.assertIn("set_config", sql)
        self.assertEqual(params["setting"], db_actor.ACTOR_SETTING)
        self.assertEqual(params["actor"], db_actor.default_actor())


@unittest.skipUnless(TEST_URL, "set CMS_RLS_TEST_DATABASE_URL to run the live half")
class TestAgainstPostgres(unittest.TestCase):
    """Drives the REAL sessionmaker the application uses.

    WHY not a fresh `sessionmaker(engine)`: SQLAlchemy 1.3 builds a distinct Session subclass per
    factory, so a hook registered on the module's factory would not be installed on an unrelated
    one — a test that made its own factory would prove nothing about production. Re-binding the
    module's factory to the test engine is what keeps the assertion honest.
    """

    @classmethod
    def setUpClass(cls):
        from sqlalchemy import create_engine

        cls.engine = create_engine(TEST_URL)
        cls._original_bind = db_session._session.kw.get("bind")
        db_session._session.configure(bind=cls.engine)

    @classmethod
    def tearDownClass(cls):
        db_session._session.configure(bind=cls._original_bind)
        cls.engine.dispose()

    def setting(self, session):
        from sqlalchemy import text

        return session.execute(text("SELECT current_setting('cms.actor', true)")).scalar()

    def test_a_session_transaction_carries_the_core_identity(self):
        with db_session.SessionGen() as session:
            self.assertEqual(self.setting(session), db_actor.CORE_ACTOR)

    def test_the_identity_is_reapplied_after_a_commit(self):
        from sqlalchemy import text

        with db_session.SessionGen() as session:
            self.assertEqual(self.setting(session), db_actor.CORE_ACTOR)
            session.execute(text("SELECT 1"))
            session.commit()
            # A commit ends the transaction, and the setting is transaction-local: without the
            # after_begin hook firing again this reads back empty and every statement after the
            # first commit in a long-lived session would be unidentified.
            self.assertEqual(self.setting(session), db_actor.CORE_ACTOR)

    def test_a_caller_cannot_widen_its_own_identity_mid_transaction(self):
        from sqlalchemy import text

        with db_session.SessionGen() as session:
            session.execute(text("SELECT set_config('cms.actor', 'admin:99', true)"))
            self.assertEqual(self.setting(session), "admin:99")
            session.rollback()
            # The hook owns the identity: the next transaction starts from the process identity
            # again, so a query path cannot promote itself and carry that promotion forward.
            self.assertEqual(self.setting(session), db_actor.CORE_ACTOR)

    def test_the_setting_does_not_survive_a_committed_transaction(self):
        from sqlalchemy import text

        conn = self.engine.connect()
        try:
            with conn.begin():
                conn.execute(text("SELECT set_config('cms.actor', 'admin:99', true)"))
            # Back on the same physical connection, outside that transaction. Nothing stamps this
            # connection, so an empty value here is the proof the setting was transaction-local.
            self.assertIn(
                conn.execute(text("SELECT current_setting('cms.actor', true)")).scalar(),
                (None, ""),
                "the actor survived COMMIT — a pooled connection would leak it",
            )
        finally:
            conn.close()

    def test_a_dedicated_connection_is_stamped(self):
        connection = db_session.custom_psycopg2_connection()
        try:
            cursor = connection.cursor()
            cursor.execute("SELECT current_setting('cms.actor', true)")
            self.assertEqual(cursor.fetchone()[0], db_actor.default_actor())
            cursor.close()
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
