#!/usr/bin/env python3
# tests/test_db_question_resolution_kind.py — a question's resolution marker round-trips.
#
# WHY this suite exists: `questions.resolution_kind` records whether the statement itself
# answered a question or the answer had to clarify it, and two ORMs write that one table — the
# core through its SQLAlchemy model, the panel through Prisma. Only a write and a read against
# a real database shows the two agreeing, and NULL is a legitimate value for every row written
# before the column existed, so both are covered here.
#
# It needs the runtime (sqlalchemy, psycopg2) and a database it may write to, so it skips
# unless CMS_CONFIG points at one: the postgres:15 service of src/docker/docker-compose.test.yml,
# reached from a venv that has the runtime installed, as the CMS suites do it.
#
# Usage: CMS_CONFIG=<cms config with [database]> python3 tests/test_db_question_resolution_kind.py
#
# `make test` runs this file without that environment and expects the skip.

import os
import sys
import types
import unittest

LIB_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(LIB_DIR)
SRC_ROOT = os.path.join(REPO_ROOT, "src")
sys.path.insert(0, SRC_ROOT)

SETTLED_BY_STATEMENT = "settled_by_statement"
CLARIFICATION_NEEDED = "clarification_needed"

# The fixture is keyed by name rather than by a generated id, so a rerun on the same database
# replaces its own rows instead of colliding with them.
FIXTURE_CONTEST = "resolution-kind-suite"
FIXTURE_USERNAME = "resolution-kind-suite"
QUESTION_SUBJECT = "Is the round rated?"


def load_surface():
    """Load the core modules the suite drives, or None when the environment cannot run it.

    A missing runtime reports as ImportError and becomes a skip; a broken configuration or an
    unreachable database raises, because those are failures a reader must see.
    """
    if not os.environ.get("CMS_CONFIG"):
        return None
    try:
        import cms.db as database
        from cms.server.admin.handlers import contestquestion
        from cmscommon.crypto import build_password
        from cmscommon.datetime import make_datetime
        from sqlalchemy import inspect
    except ImportError:
        return None
    return types.SimpleNamespace(
        database=database, reply_handler=contestquestion.QuestionReplyHandler,
        make_datetime=make_datetime, inspect=inspect, build_password=build_password)


SURFACE = load_surface()


@unittest.skipIf(
    SURFACE is None,
    "needs CMS_CONFIG and an interpreter with sqlalchemy/psycopg2 (see the suite header)")
class TestQuestionResolutionKind(unittest.TestCase):
    """The marker a grader's reply carries, written through the admin handler and read back.

    The suite drives the real QuestionReplyHandler.process_question instead of a copy of its
    logic, so the value the panel reads is the one the core writes for that reply.
    """

    @classmethod
    def setUpClass(cls):
        cls.db = SURFACE.database
        # Every table of the CMS schema is created at once; on a database that already holds
        # them, create_all re-emits the domains it cannot check for and the run aborts before
        # the first test, so the schema is only built when it is absent.
        if "questions" not in SURFACE.inspect(cls.db.engine).get_table_names():
            cls.db.init_db()

    def setUp(self):
        self.session = self.db.SessionGen().__enter__()
        self.addCleanup(self.session.close)
        self.participation = self.create_participation()

    def create_participation(self):
        """Return a fresh participation, replacing the fixture rows of a previous run.

        The database cascades a deleted user to its participations and their questions, so
        dropping the two named rows clears everything this suite writes.
        """
        db = self.db
        self.session.query(db.User).filter(
            db.User.username == FIXTURE_USERNAME).delete(synchronize_session=False)
        self.session.query(db.Contest).filter(
            db.Contest.name == FIXTURE_CONTEST).delete(synchronize_session=False)
        self.session.commit()

        contest = db.Contest(name=FIXTURE_CONTEST, description="")
        user = db.User(first_name="Ada", last_name="Lovelace",
                       username=FIXTURE_USERNAME,
                       password=SURFACE.build_password("resolution-kind"))
        self.session.add_all([contest, user])
        self.session.flush()
        participation = db.Participation(contest=contest, user=user, ip=[])
        self.session.add(participation)
        self.session.flush()
        return participation

    def ask(self, resolution_kind=None):
        """Store a question as the contestant would, optionally already carrying a marker."""
        question = self.db.Question(
            question_timestamp=SURFACE.make_datetime(),
            subject=QUESTION_SUBJECT,
            text="Please clarify.",
            ignored=False,
            participation=self.participation,
            resolution_kind=resolution_kind)
        self.session.add(question)
        self.session.commit()
        return question

    def reply(self, question, quick_answer):
        """Answer through the admin handler, whose only other dependencies are these stubs."""
        answer_request = types.SimpleNamespace(
            get_argument=lambda name, default=None: quick_answer
            if name == "reply_question_quick_answer" else default,
            try_commit=self.commit,
            current_user=None)
        SURFACE.reply_handler.process_question(answer_request, question)

    def commit(self):
        """Stand in for BaseHandler.try_commit, which commits and reports success."""
        self.session.commit()
        return True

    def read_back(self, question_id):
        """Read the row through a second session, so the assertion is the database's answer.

        The values are copied while the session is open: SessionGen rolls back on exit, which
        expires everything that session loaded.
        """
        with self.db.SessionGen() as session:
            stored = session.query(self.db.Question).filter(
                self.db.Question.id == question_id).one()
            return types.SimpleNamespace(
                resolution_kind=stored.resolution_kind, subject=stored.subject)

    def test_reply_pointing_at_the_statement_records_settled_by_statement(self):
        question = self.ask()

        self.reply(question, "nocomment")

        self.assertEqual(self.read_back(question.id).resolution_kind, SETTLED_BY_STATEMENT)

    def test_reply_that_clarifies_records_clarification_needed(self):
        question = self.ask()

        self.reply(question, "yes")

        self.assertEqual(self.read_back(question.id).resolution_kind, CLARIFICATION_NEEDED)

    def test_row_written_without_a_marker_stays_valid(self):
        question = self.ask()

        stored = self.read_back(question.id)
        self.assertIsNone(stored.resolution_kind)
        self.assertEqual(stored.subject, QUESTION_SUBJECT)


if __name__ == "__main__":
    unittest.main(verbosity=2)
