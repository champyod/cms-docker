#!/usr/bin/env python3

# tests/test_admin_security_session.py — the second engine/session and its actor stamp.

import os
import subprocess
import sys
import unittest

from _admin_security_config import REPO_ROOT, SRC_DIR, install_config

CONFIG_WITHOUT_SECURITY = install_config(False)
install_config(True)
sys.path.insert(0, str(SRC_DIR))

try:
    from sqlalchemy import create_engine, event
    from sqlalchemy.exc import OperationalError

    import cms.db as db
    from cms.conf import DatabaseConfig
    from cms.db import actor as db_actor
    from cms.db import session as db_session
except ModuleNotFoundError as missing:  # pragma: no cover - depends on the host
    print(
        f"SKIP: {missing.name} is not installed. This suite drives the classic "
        "admin's write path and needs the core's dependencies "
        "(pip install -r src/constraints.txt). Run it where they are present."
    )
    raise SystemExit(0)


class RecordingConnection:
    """Stands in for the SQLAlchemy connection the after_begin hook receives."""

    def __init__(self) -> None:
        self.statements: list[tuple[str, dict]] = []

    def execute(self, statement: object, params: dict | None = None) -> None:
        self.statements.append((str(statement), dict(params or {})))


class TestTheSecondSession(unittest.TestCase):
    def test_the_config_field_is_optional_and_defaults_to_none(self) -> None:
        self.assertIsNone(DatabaseConfig("postgresql+psycopg2://x").admin_security_url)

    def test_the_configured_url_reaches_its_own_engine(self) -> None:
        engine = db.admin_security_engine
        self.assertIsNotNone(engine)
        assert engine is not None
        self.assertEqual(engine.url.username, "cms_admin_account_security")
        self.assertNotEqual(engine.url.username, db.engine.url.username)

    def test_a_session_is_bound_to_the_security_engine(self) -> None:
        session = db.AdminSecuritySession()
        try:
            self.assertIs(session.bind, db.admin_security_engine)
        finally:
            session.close()

    def test_the_security_session_inherits_the_actor_hook(self) -> None:
        maker = db_session._admin_security_sessionmaker
        self.assertIsNotNone(maker)
        assert maker is not None
        self.assertTrue(issubclass(maker.class_, db_session.Session.class_))
        self.assertTrue(
            event.contains(db_session.Session.class_, "after_begin",
                           db_session._stamp_actor))

    def test_the_second_session_really_fires_the_hook(self) -> None:
        # WHY SQLite: set_config() is absent there, so reaching that error proves the hook ran.
        maker = db_session._admin_security_sessionmaker
        self.assertIsNotNone(maker)
        assert maker is not None
        sqlite_engine = create_engine("sqlite://")
        original_bind = maker.kw["bind"]
        maker.configure(bind=sqlite_engine)
        try:
            session = db.AdminSecuritySession()
            try:
                with self.assertRaises(OperationalError) as raised:
                    session.execute("SELECT 1")
                self.assertIn("set_config", str(raised.exception).lower())
            finally:
                session.close()
        finally:
            maker.configure(bind=original_bind)
            sqlite_engine.dispose()

    def test_the_hook_stamps_cms_actor_as_the_main_session_does(self) -> None:
        conn = RecordingConnection()
        db_session._stamp_actor(object(), object(), conn)
        self.assertEqual(len(conn.statements), 1)
        sql, params = conn.statements[0]
        self.assertIn("set_config", sql)
        self.assertEqual(params["setting"], db_actor.ACTOR_SETTING)
        self.assertEqual(params["actor"], db_actor.default_actor())

    def test_an_absent_url_raises_a_named_error_at_the_write(self) -> None:
        code = (
            "import cms.db as db\n"
            "try:\n"
            "    db.AdminSecuritySession()\n"
            "except db.AdminSecurityDatabaseNotConfigured as error:\n"
            "    print('NAMED:' + str(error))\n"
        )
        env = dict(os.environ)
        env["CMS_CONFIG"] = str(CONFIG_WITHOUT_SECURITY)
        env["PYTHONPATH"] = str(SRC_DIR)
        result = subprocess.run(
            [sys.executable, "-c", code], cwd=str(REPO_ROOT), env=env,
            capture_output=True, text=True, timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("NAMED:database.admin_security_url is not set", result.stdout)
        self.assertIn("no fallback to database.url", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
