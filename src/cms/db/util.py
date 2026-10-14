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
import time
import typing
import logging

from sqlalchemy import inspect, text, union
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Query

from cms import ConfigError
from . import (
    SessionGen,
    Digest,
    Contest,
    ContestTask,
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


# The registry can re-point the served contest at any time, so the resolver is cached for a
# few seconds: a request within the TTL is answered from memory, and a change is picked up
# within the TTL without restarting the service.
REGISTRY_CONTEST_TTL_SECONDS = 5.0
_active_contest_cache: "tuple[float, int | None] | None" = None


class NoOverride:
    """The absence of a -c override: the instance then resolves its own contest per call."""


NO_OVERRIDE = NoOverride()


class ServiceBinding(typing.NamedTuple):
    """What the registry says about one running service instance.

    named: a services row names this (role, shard), so its contest_id is the answer — a null
        one included, which means the instance serves every contest.
    contest_id: the contest that row names, or None.

    """

    named: bool
    contest_id: int | None


_service_binding_cache: "dict[tuple[str, int], tuple[float, ServiceBinding]]" = {}


def _read_service_binding(session, role: str, shard: int) -> ServiceBinding:
    """The registry's row for one (role, shard), or that no row names it.

    WHY (role, shard) and not the first ContestWebServer row: the registry authors one row
    per instance and each instance serves the contest its own row names. Reading the first
    one handed every server the same contest.
    """
    if "services" not in inspect(session.get_bind()).get_table_names():
        return ServiceBinding(named=False, contest_id=None)
    row = session.execute(
        text(
            "SELECT contest_id FROM services"
            " WHERE role = :role AND shard = :shard AND enabled"
            " ORDER BY id LIMIT 1"
        ),
        {"role": role, "shard": shard},
    ).first()
    if row is None:
        return ServiceBinding(named=False, contest_id=None)
    return ServiceBinding(named=True, contest_id=None if row[0] is None else int(row[0]))


def service_binding(role: str, shard: int) -> ServiceBinding:
    """The registry's binding for one service instance, cached for a few seconds.

    WHY per call rather than once at start-up: the registry is what an operator edits, so a
    running instance has to pick up a re-pointed row without being recreated.
    """
    now = time.monotonic()
    cached = _service_binding_cache.get((role, shard))
    if cached is not None and now - cached[0] < REGISTRY_CONTEST_TTL_SECONDS:
        return cached[1]
    with SessionGen() as session:
        binding = _read_service_binding(session, role, shard)
    _service_binding_cache[(role, shard)] = (now, binding)
    return binding


def active_contest_id() -> int | None:
    """Return the contest contests.is_active names, cached for a few seconds.

    This is the deployment default, not an instance's answer: a services row names one
    instance, and the registry layer is answered per instance by contest_binding(). What
    reaches here is a deployment with an empty registry, or an instance no row names.

    return: the active contest id, or None when the flag names no contest.

    raises ContestsTableMissingError: the contests table does not exist yet. A database
        that cannot be reached is not caught here: its error propagates so a running stack
        fails loud instead of serving a contest the database does not name.

    """
    global _active_contest_cache
    now = time.monotonic()
    if _active_contest_cache is not None and now - _active_contest_cache[0] < REGISTRY_CONTEST_TTL_SECONDS:
        return _active_contest_cache[1]
    with SessionGen() as session:
        # Inspector.has_table was removed from the SQLAlchemy 2.0 inspector; listing the
        # table catalog is the call that exists across supported versions.
        if "contests" not in inspect(session.get_bind()).get_table_names():
            raise ContestsTableMissingError("the contests table does not exist yet")
        # Lowest id wins — the same order the admin panel and config sync use — so a
        # database that ever holds two active rows still hands every caller one contest.
        contest = (
            session.query(Contest)
            .filter(Contest.is_active.is_(True))
            .order_by(Contest.id)
            .first()
        )
        contest_id = None if contest is None else contest.id
    _active_contest_cache = (now, contest_id)
    return contest_id


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


def contest_binding(
    role: str, shard: int, override: "int | None | NoOverride" = NO_OVERRIDE,
    serves_one_contest: bool = False,
) -> int | None:
    """The contest one service instance serves right now.

    One flat precedence: an explicit -c override, else the row the registry authors for this
    (role, shard), else the deployment default. A null row means every contest (None), which
    is the multicontest mode a contest server serves behind a /<name>/ prefix.

    role, shard: the instance asking, which is how the registry names it.
    override: the contest a -c argument fixed it to, NO_OVERRIDE to resolve per call.
    serves_one_contest: whether the caller can serve every contest at once. One that cannot
        is refused rather than handed None.

    return: the contest id, or None for every contest.

    """
    contest_id = _resolved_contest(role, shard, override)
    if contest_id is None and serves_one_contest:
        raise ConfigError(
            "the registry names no contest for %s shard %d, and this service serves one "
            "contest: bind that row to a contest in the service registry, or start the "
            "process with -c <contest_id>." % (role, shard))
    return contest_id


def _resolved_contest(role: str, shard: int, override: "int | None | NoOverride") -> int | None:
    """The contest the override, else the registry row, else the deployment default names."""
    if not isinstance(override, NoOverride):
        return override
    binding = service_binding(role, shard)
    if binding.named:
        return binding.contest_id
    return ask_for_active_contest()


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
            .join(Task).filter(
                Task.contest_tasks.any(
                    ContestTask.contest_id == contest_id))
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
            .join(Task).filter(
                Task.contest_tasks.any(
                    ContestTask.contest_id == contest_id))
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

    task_q = contest_q.join(Contest.task_contests).join(ContestTask.task)
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
