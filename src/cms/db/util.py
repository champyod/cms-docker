#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2010-2012 Giovanni Mascellani <mascellani@poisson.phc.unipi.it>
# Copyright © 2010-2012 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2010-2012 Matteo Boscariol <boscarim@hotmail.com>
# Copyright © 2013-2018 Luca Wehrstedt <luca.wehrstedt@gmail.com>
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

"""Utilities relying on the database.

"""

import sys
import os
import logging

from sqlalchemy import union
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Query

from cms import ConfigError
from . import (
    SessionGen,
    Digest,
    Contest,
    Participation,
    Statement,
    Attachment,
    Task,
    Manager,
    Dataset,
    Testcase,
    Submission,
    File,
    SubmissionResult,
    Executable,
    UserTest,
    UserTestFile,
    UserTestManager,
    UserTestResult,
    UserTestExecutable,
    Session,
)


logger = logging.getLogger(__name__)


def test_db_connection():
    """Perform an operation that raises if the DB is not reachable.

    raise (sqlalchemy.exc.OperationalError): if the DB cannot be
        accessed (usually for permission problems).

    """
    try:
        # We do not care of the specific query executed here, we just
        # use it to ensure that the DB is accessible.
        with SessionGen() as session:
            session.execute("select 0;")
    except OperationalError as e:
        logger.error(e)
        raise ConfigError("Operational error while talking to the DB. "
                          "Is the connection string in cms.toml correct?")


def get_contest_list(session: "Session | None" = None) -> list[Contest]:
    """Return all the contest objects available on the database.

    session: if specified, use such session for
        connecting to the database; otherwise, create a temporary one
        and discard it after the operation (this means that no further
        expansion of lazy properties of the returned Contest objects
        will be possible).

    return: the list of contests in the DB.

    """
    if session is None:
        with SessionGen() as session:
            return get_contest_list(session)

    return session.query(Contest).all()


def is_contest_id(contest_id: int) -> bool:
    """Return if there is a contest with the given id in the database.

    contest_id: the id to query.
    return: True if there is such a contest.

    """
    with SessionGen() as session:
        return Contest.get_from_id(contest_id, session) is not None


def ask_for_contest(skip: int | None = None) -> int:
    """Print a greeter that ask the user for a contest, if there is
    not an indication of which contest to use in the command line.

    skip: how many commandline arguments are already taken
        by other usages (None for no arguments already consumed).

    return: a contest_id.

    """
    if isinstance(skip, int) and len(sys.argv) > skip + 1:
        contest_id = int(sys.argv[skip + 1])

    else:

        with SessionGen() as session:
            contests = get_contest_list(session)
            # The ids of the contests are cached, so the session can
            # be closed as soon as possible
            matches = {}
            n_contests = len(contests)
            if n_contests == 0:
                print("No contests in the database.")
                print("You may want to use some of the facilities in "
                      "cmscontrib to import a contest.")
                sys.exit(0)
            print("Contests available:")
            for i, row in enumerate(contests):
                print("%3d  -  ID: %d  -  Name: %s  -  Description: %s" %
                      (i + 1, row.id, row.name, row.description), end='')
                matches[i + 1] = row.id
                if i == n_contests - 1:
                    print(" (default)")
                else:
                    print()

        contest_number = input("Insert the row number next to the contest "
                               "you want to load (not the id): ")
        if len(contest_number) == 0:
            contest_number = n_contests
        try:
            contest_id = matches[int(contest_number)]
        except (ValueError, KeyError):
            print("Insert a correct number.")
            sys.exit(1)

    return contest_id


class ContestsTableMissingError(RuntimeError):
    """The contests table does not exist yet (a fresh install, before cmsInitDB).

    WHY a distinct error and not a None return: a caller may bootstrap only while there
    is nothing to read. A table that exists but holds no active row is a different,
    non-bootstrappable state and must not be answered the same way.
    """


def active_contest_id() -> int | None:
    """Return the id of the contest flagged active in the database.

    WHY the database: contests.is_active is the single source of truth for the active
    contest; config.toml [contest] CONTEST_ID and the generated .env are derived from it,
    so reading either here would reintroduce the copy this change removes.

    return: the active contest id, or None when the contests table exists but no row is
        flagged active.

    raises ContestsTableMissingError: the contests table does not exist yet. A database
        that cannot be reached is not caught here: its error propagates so a running stack
        fails loud instead of serving a contest the database does not name.

    """
    from sqlalchemy import inspect
    with SessionGen() as session:
        # Inspector.has_table was removed from the SQLAlchemy 2.0 inspector; listing the
        # table catalog is the call that exists across supported versions.
        if "contests" not in inspect(session.get_bind()).get_table_names():
            raise ContestsTableMissingError("the contests table does not exist yet")
        # Lowest id wins — the same order the admin panel and config sync use — so a database
        # that ever holds two active rows still hands every caller one contest.
        contest = (
            session.query(Contest)
            .filter(Contest.is_active.is_(True))
            .order_by(Contest.id)
            .first()
        )
        return None if contest is None else contest.id


def _bootstrap_contest_id() -> int:
    """Return the bootstrap contest id from the environment.

    Used only while the contests table does not exist (a fresh install). WHY the
    environment and not config.toml: compose still exports CONTEST_ID, and a service may
    not read the file the generator derives from the database.

    """
    bootstrap = os.environ.get("CONTEST_ID")
    if not bootstrap:
        logger.critical(
            "contests table does not exist yet and CONTEST_ID is unset — cannot "
            "decide which contest to serve.")
        sys.exit(1)
    try:
        return int(bootstrap)
    except ValueError:
        logger.critical("bootstrap CONTEST_ID '%s' is not a contest id", bootstrap)
        sys.exit(1)


def ask_for_active_contest() -> int:
    """Return the contest a service should serve, read from the database.

    The database is the single source. The only fallback is the bootstrap one — before
    cmsInitDB has created the contests table there is nothing to read — and every other
    state is fatal, so a running stack never serves a contest the database does not name.

    return: the active contest id.

    """
    try:
        active = active_contest_id()
    except ContestsTableMissingError:
        return _bootstrap_contest_id()
    if active is None:
        logger.critical(
            "No active contest: contests.is_active holds no active row. Set one with "
            "'./cms contest set-active <id>'.")
        sys.exit(1)
    return active


def get_submissions(
    session: Session,
    contest_id: int | None = None,
    participation_id: int | None = None,
    task_id: int | None = None,
    submission_id: int | None = None,
) -> Query:
    """Search for submissions that match the given criteria

    The submissions will be returned as a list, and the last four
    parameters determine the filters used to decide which submissions
    to include. Some of them are incompatible, that is they cannot be
    non-None at the same time. When this happens it means that one of
    the parameters "implies" the other (for example, giving the
    participation already gives the contest it belongs to). Trying to
    give them both is useless and could only lead to inconsistencies
    and errors.

    session: the database session to use.
    contest_id: id of the contest to filter with, or None.
    participation_id: id of the participation to filter
        with, or None.
    task_id: id of the task to filter with, or None.
    submission_id: id of the submission to filter with, or
        None.

    return: a query for the list of submission that match the
        given criteria

    """
    if task_id is not None and contest_id is not None:
        raise ValueError("contest_id is superfluous if task_id is given")
    if participation_id is not None and contest_id is not None:
        raise ValueError(
            "contest_id is superfluous if participation_id is given")
    if submission_id is not None and contest_id is not None:
        raise ValueError("contest_id is superfluous if submission_id is given")
    if submission_id is not None and task_id is not None:
        raise ValueError("task_id is superfluous if submission_id is given")
    if submission_id is not None and participation_id is not None:
        raise ValueError(
            "participation_id is superfluous if submission_id is given")

    query = session.query(Submission)
    if submission_id is not None:
        query = query.filter(Submission.id == submission_id)
    if participation_id is not None:
        query = query.join(Participation) \
            .filter(Participation.id == participation_id)
    if task_id is not None:
        query = query.filter(Submission.task_id == task_id)
    if contest_id is not None:
        query = query.join(Participation) \
            .filter(Participation.contest_id == contest_id) \
            .join(Task).filter(Task.contest_id == contest_id)
    return query


def get_submission_results(
    session: Session,
    contest_id: int | None = None,
    participation_id: int | None = None,
    task_id: int | None = None,
    submission_id: int | None = None,
    dataset_id: int | None = None,
) -> Query:
    """Search for submission results that match the given criteria

    The submission results will be returned as a list, and the last
    five parameters determine the filters used to decide which
    submission results to include. Some of them are incompatible, that
    is they cannot be non-None at the same time. When this happens it
    means that one of the parameters "implies" the other (for example,
    giving the participation already gives the contest it belongs
    to). Trying to give them both is useless and could only lead to
    inconsistencies and errors.

    session: the database session to use.
    contest_id: id of the contest to filter with, or None.
    participation_id: id of the participation to filter with,
        or None.
    task_id: id of the task to filter with, or None.
    submission_id: id of the submission to filter with, or
        None.
    dataset_id: id of the dataset to filter with, or None.

    return: a query for the list of submission results that
        match the given criteria

    """
    if task_id is not None and contest_id is not None:
        raise ValueError("contest_id is superfluous if task_id is given")
    if participation_id is not None and contest_id is not None:
        raise ValueError(
            "contest_id is superfluous if participation_id is given")
    if submission_id is not None and contest_id is not None:
        raise ValueError("contest_id is superfluous if submission_id is given")
    if submission_id is not None and task_id is not None:
        raise ValueError("task_id is superfluous if submission_id is given")
    if submission_id is not None and participation_id is not None:
        raise ValueError(
            "participation_id is superfluous if submission_id is given")
    if dataset_id is not None and task_id is not None:
        raise ValueError("task_id is superfluous if dataset_id is given")
    if dataset_id is not None and contest_id is not None:
        raise ValueError("contest_id is superfluous if dataset_id is given")

    query = session.query(SubmissionResult).join(Submission)
    if submission_id is not None:
        query = query.filter(SubmissionResult.submission_id == submission_id)
    if dataset_id is not None:
        query = query.filter(SubmissionResult.dataset_id == dataset_id)
    if participation_id is not None:
        query = query.join(Participation) \
            .filter(Participation.id == participation_id)
    if task_id is not None:
        query = query.filter(Submission.task_id == task_id)
    if contest_id is not None:
        query = query.join(Participation) \
            .filter(Participation.contest_id == contest_id)\
            .join(Task).filter(Task.contest_id == contest_id)
    return query


def get_datasets_to_judge(task: Task) -> list[Dataset]:
    """Determine the datasets that ES and SS have to judge.

    Return a list of all Dataset objects that are either the
    active_dataset of their Task or have the autojudge flag set.
    These are the ones on which submissions are automatically judged by
    by ES and SS, whereas the results on any other dataset has to be
    explicitly requested by the contest admin (by invalidating it).

    task: the task to query.

    return: list of datasets to judge.

    """
    judge = []

    for dataset in task.datasets:
        if dataset.active or dataset.autojudge:
            judge.append(dataset)

    return judge


def enumerate_files(
    session: Session,
    contest: Contest | None = None,
    skip_submissions=False,
    skip_user_tests=False,
    skip_users=False,
    skip_generated=False,
) -> set[str]:
    """Enumerate all the files (by digest) referenced by the
    contest.

    return: the digests of the file referenced in the contest.

    """
    contest_q = session.query(Contest)
    if contest is not None:
        contest_q = contest_q.filter(Contest.id == contest.id)

    queries = list()

    task_q = contest_q.join(Contest.tasks)
    queries.append(task_q.join(Task.statements).with_entities(Statement.digest))
    queries.append(task_q.join(Task.attachments)
                   .with_entities(Attachment.digest))

    dataset_q = task_q.join(Task.datasets)
    queries.append(dataset_q.join(Dataset.managers)
                   .with_entities(Manager.digest))
    queries.append(dataset_q.join(Dataset.testcases)
                   .with_entities(Testcase.input))
    queries.append(dataset_q.join(Dataset.testcases)
                   .with_entities(Testcase.output))

    if not skip_submissions and not skip_users:
        submission_q = task_q.join(Task.submissions)
        queries.append(submission_q.join(Submission.files)
                       .with_entities(File.digest))

        if not skip_generated:
            queries.append(submission_q.join(Submission.results)
                           .join(SubmissionResult.executables)
                           .with_entities(Executable.digest))

    if not skip_user_tests and not skip_users:
        user_test_q = task_q.join(Task.user_tests)
        queries.append(user_test_q.with_entities(UserTest.input))
        queries.append(user_test_q.join(UserTest.files)
                       .with_entities(UserTestFile.digest))
        queries.append(user_test_q.join(UserTest.managers)
                       .with_entities(UserTestManager.digest))

        if not skip_generated:
            user_test_result_q = user_test_q.join(UserTest.results)
            queries.append(user_test_result_q.join(UserTestResult.executables)
                           .with_entities(UserTestExecutable.digest))
            queries.append(user_test_result_q
                           .filter(UserTestResult.output != None)
                           .with_entities(UserTestResult.output))

    # union(...).execute() would be executed outside of the session.
    digests = set(r[0] for r in session.execute(union(*queries)))
    digests.discard(Digest.TOMBSTONE)
    return digests
