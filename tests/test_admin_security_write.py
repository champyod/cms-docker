#!/usr/bin/env python3

# tests/test_admin_security_write.py — add/update/delete write through the security session.

import inspect
import sys
import unittest
from unittest import mock

from _admin_security_config import SRC_DIR, install_config

install_config(True)
sys.path.insert(0, str(SRC_DIR))

try:
    from cms.db import Admin
    from cms.db.permissions import AdminGroup
    from cms.server.admin.handlers.admin import AddAdminHandler, AdminHandler
    from cms.server.admin.handlers.base import BaseHandler
except ModuleNotFoundError as missing:  # pragma: no cover - depends on the host
    print(
        f"SKIP: {missing.name} is not installed. This suite drives the classic "
        "admin's write path and needs the core's dependencies "
        "(pip install -r src/constraints.txt). Run it where they are present."
    )
    raise SystemExit(0)


class FakeQuery:
    def __init__(self, session: "FakeSecuritySession", model: object) -> None:
        self._session = session
        self._model = model

    def filter(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def delete(self, **_kwargs: object) -> int:
        self._session.bulk_deletes.append(self._model)
        return 0


class FakeSecuritySession:
    """Only the session surface the handlers use, with every write recorded."""

    def __init__(self) -> None:
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.bulk_deletes: list[object] = []
        self.commits = 0

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def delete(self, obj: object) -> None:
        self.deleted.append(obj)

    def query(self, model: object) -> FakeQuery:
        return FakeQuery(self, model)

    def commit(self) -> None:
        self.commits += 1


class HandlerProbe:
    """State a handler needs, without Tornado's request or a database."""

    def __init__(self, admin: Admin | None = None,
                 target: Admin | None = None) -> None:
        self.admin = admin
        self.target = target if target is not None else admin
        self.sql_session = mock.MagicMock(name="sql_session")
        self.security_session = FakeSecuritySession()
        self._service = mock.MagicMock(name="service")
        self.current_user = mock.MagicMock(name="current_user")
        self.current_user.id = 7
        self.current_user.has_permission.return_value = True
        self.redirects: list[str] = []
        self.written: list[str] = []
        self.opened = 0
        self.committed_with: list[FakeSecuritySession] = []

    @property
    def service(self) -> mock.MagicMock:
        return self._service

    def admin_security_session(self) -> "HandlerProbe":
        self.opened += 1
        return self

    def __enter__(self) -> FakeSecuritySession:
        return self.security_session

    def __exit__(self, *_exc: object) -> bool:
        return False

    def try_commit_admin_security(self, session: FakeSecuritySession) -> bool:
        self.committed_with.append(session)
        session.commit()
        return True

    def safe_get_item(self, _cls: object, _ident: object,
                      session: object = None) -> Admin:
        return self.target if session is self.security_session else self.admin

    def redirect(self, url: str) -> None:
        self.redirects.append(url)

    def write(self, text: str) -> None:
        self.written.append(text)

    def url(self, *parts: object) -> str:
        return "/" + "/".join(str(part) for part in parts)


class FakeAddAdminHandler(HandlerProbe, AddAdminHandler):
    pass


class FakeAdminHandler(HandlerProbe, AdminHandler):
    pass


def _admin(admin_id: int = 1, username: str = "target",
           name: str = "Target") -> Admin:
    admin = Admin(username=username, name=name,
                  authentication="bcrypt:hash", enabled=True)
    admin.id = admin_id
    return admin


class ProbeBaseHandler(BaseHandler):
    """A BaseHandler with no Tornado request behind it."""

    def __init__(self) -> None:
        self.sql_session = mock.MagicMock(name="sql_session")


class TestBaseHandlerHelpers(unittest.TestCase):
    def test_the_helper_opens_the_security_session_generator(self) -> None:
        with mock.patch(
            "cms.server.admin.handlers.base.AdminSecuritySessionGen"
        ) as generator:
            self.assertIs(BaseHandler.admin_security_session(ProbeBaseHandler()),
                          generator.return_value)

    def test_the_security_commit_never_commits_the_request_session(self) -> None:
        handler = mock.MagicMock(name="handler")
        security_session = mock.MagicMock(name="security_session")

        self.assertTrue(
            BaseHandler.try_commit_admin_security(handler, security_session))

        security_session.commit.assert_called_once_with()
        handler.sql_session.commit.assert_not_called()
        handler.service.add_notification.assert_called_once()


class TestTheHandlersWriteThroughIt(unittest.TestCase):
    def setUp(self) -> None:
        self.patches = [
            mock.patch("cms.server.admin.handlers.admin_security.get_effective_permissions",
                       return_value=frozenset({"all:all"})),
            mock.patch("cms.server.admin.handlers.admin_security.is_effective_superset",
                       return_value=True),
            mock.patch("cms.server.admin.handlers.admin.invalidate_permission_cache"),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_add_uses_the_security_session(self) -> None:
        handler = FakeAddAdminHandler()
        attrs = {
            "username": "new-admin",
            "name": "New Admin",
            "authentication": "bcrypt:hash",
            "enabled": True,
            "admin_groups": [2, 3],
        }
        with mock.patch("cms.server.admin.handlers.admin.admin_attrs",
                        return_value=attrs), \
                mock.patch("cms.server.admin.handlers.admin_security.admin_attrs",
                           return_value=attrs):
            inspect.unwrap(AddAdminHandler.post)(handler)

        self.assertEqual(handler.opened, 1)
        self.assertEqual(handler.committed_with, [handler.security_session])
        self.assertEqual(handler.security_session.commits, 1)
        handler.sql_session.add.assert_not_called()
        handler.sql_session.commit.assert_not_called()

        self.assertEqual(len(handler.security_session.added), 1)
        created = handler.security_session.added[0]
        self.assertIsInstance(created, Admin)
        self.assertEqual(created.username, "new-admin")
        self.assertEqual([ag.group_id for ag in created.admin_groups], [2, 3])
        self.assertEqual(handler.redirects, ["/admins"])

    def test_update_refetches_in_the_security_session(self) -> None:
        handler = FakeAdminHandler(admin=_admin(name="Before"),
                                   target=_admin(name="Before"))
        attrs = {
            "username": "target",
            "name": "After",
            "authentication": "bcrypt:new",
            "enabled": True,
            "admin_groups": [3],
        }
        handler.sql_session.query.return_value.filter.return_value \
            .scalar.return_value = None
        with mock.patch("cms.server.admin.handlers.admin_security.admin_attrs",
                        return_value=attrs):
            inspect.unwrap(AdminHandler.post)(handler, "1")

        self.assertEqual(handler.target.name, "After")
        self.assertEqual(handler.target.authentication, "bcrypt:new")
        self.assertEqual(handler.admin.name, "Before")
        self.assertEqual(handler.security_session.bulk_deletes, [AdminGroup])
        self.assertEqual(
            [(ag.admin_id, ag.group_id) for ag in handler.security_session.added
             if isinstance(ag, AdminGroup)],
            [(1, 3)],
        )
        self.assertEqual(handler.committed_with, [handler.security_session])
        handler.sql_session.delete.assert_not_called()
        handler.sql_session.commit.assert_not_called()
        self.assertEqual(handler.redirects, ["/admins"])

    def test_delete_uses_the_security_session(self) -> None:
        handler = FakeAdminHandler(admin=_admin(), target=_admin())
        inspect.unwrap(AdminHandler.delete)(handler, "1")

        self.assertEqual(handler.security_session.bulk_deletes, [AdminGroup])
        self.assertEqual(handler.security_session.deleted, [handler.target])
        self.assertEqual(handler.committed_with, [handler.security_session])
        handler.sql_session.delete.assert_not_called()
        handler.sql_session.commit.assert_not_called()
        self.assertEqual(handler.written, ["../admins"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
