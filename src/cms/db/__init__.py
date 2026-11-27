#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2010-2012 Giovanni Mascellani <mascellani@poisson.phc.unipi.it>
# Copyright © 2010-2018 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2010-2012 Matteo Boscariol <boscarim@hotmail.com>
# Copyright © 2013 Bernard Blackham <bernard@largestprime.net>
# Copyright © 2013-2018 Luca Wehrstedt <luca.wehrstedt@gmail.com>
# Copyright © 2016 Myungwoo Chun <mc.tamaki@gmail.com>
# Copyright © 2016 Masaki Hara <ackie.h.gmai@gmail.com>
# Copyright © 2016 Amir Keivan Mohtashami <akmohtashami97@gmail.com>
# Copyright © 2018 William Di Luigi <williamdiluigi@gmail.com>
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

"""Utilities functions that interacts with the database.

"""

import logging

from sqlalchemy import create_engine, MetaData
from sqlalchemy.engine import Engine
from sqlalchemy.orm import configure_mappers, joinedload, subqueryload

from cms import config


logger = logging.getLogger(__name__)


# Define what this package will provide.

__all__ = [
    "version", "engine", "admin_security_engine",
    # session
    "Session", "ScopedSession", "SessionGen",
    "AdminSecuritySession", "AdminSecuritySessionGen",
    "AdminSecurityDatabaseNotConfigured", "custom_psycopg2_connection",
    # actor
    "db_actor", "CORE_ACTOR", "KNOWN_SYSTEM_ACTORS", "ACTOR_ENV",
    "InvalidActorError", "default_actor", "validate_actor",
    # types
    "CastingArray", "Codename", "Filename", "FilenameSchema",
    "FilenameSchemaArray", "Digest",
    # base
    "metadata", "Base",
    # fsobject
    "FSObject", "LargeObject",
    # contest
    "Contest", "Announcement", "ContestTeam", "ContestTask",
    # user
    "User", "Team", "Participation", "Message", "Question",
    "registerable_teams_query",
    # username config
    "ContestantGroup", "ContestantGroupMembership",
    "UsernamePolicy", "ContestUsername", "ContestUsernameHistory",
    # admin
    "Admin",
    # permissions
    "Permission", "Group", "GroupPermission", "AdminGroup",
    "AdminPermissionOverride", "AuditLog",
    # security
    "SecurityBlock",
    # task
    "Task", "Statement", "Attachment", "Dataset", "Manager", "Testcase",
    # submission
    "Submission", "File", "Token", "SubmissionResult", "Executable",
    "Evaluation",
    # usertest
    "UserTest", "UserTestFile", "UserTestManager", "UserTestResult",
    "UserTestExecutable",
    # init
    "init_db",
    # drop
    "drop_db",
    # util
    "test_db_connection", "get_contest_list", "is_contest_id",
    "ask_for_contest", "ask_for_active_contest", "active_contest_id",
    "ContestsTableMissingError", "contest_binding", "service_binding",
    "ServiceBinding", "NoOverride", "NO_OVERRIDE",
    "get_submissions", "get_submission_results",
    "get_datasets_to_judge", "enumerate_files"
]


# Instantiate or import these objects.

version = 50


def _create_engine(url: str) -> Engine:
    """Build an engine with the pool settings every CMS engine shares."""
    return create_engine(url, echo=config.database.debug,
                         pool_timeout=60, pool_recycle=120)


engine = _create_engine(config.database.url)

# WHY a second engine with no fallback: admin writes use cms_admin_account_security, and an absent URL raises.
_admin_security_url = (config.database.admin_security_url or "").strip()
admin_security_engine = (
    _create_engine(_admin_security_url) if _admin_security_url else None)

metadata = MetaData(engine)

from .session import Session, ScopedSession, SessionGen, \
    AdminSecuritySession, AdminSecuritySessionGen, \
    AdminSecurityDatabaseNotConfigured, custom_psycopg2_connection
from . import actor as db_actor
from .actor import CORE_ACTOR, KNOWN_SYSTEM_ACTORS, ACTOR_ENV, \
    InvalidActorError, default_actor, validate_actor

from .types import CastingArray, Codename, Filename, FilenameSchema, \
    FilenameSchemaArray, Digest
from .base import Base
from .fsobject import FSObject, LargeObject
from .admin import Admin
from .contest import Contest, Announcement, ContestTeam, ContestTask
from .user import User, Team, Participation, Message, Question, \
    registerable_teams_query
from .username import ContestantGroup, ContestantGroupMembership, \
    UsernamePolicy, ContestUsername, ContestUsernameHistory
from .task import Task, Statement, Attachment, Dataset, Manager, Testcase
from .submission import Submission, File, Token, SubmissionResult, \
    Executable, Evaluation
from .usertest import UserTest, UserTestFile, UserTestManager, \
    UserTestResult, UserTestExecutable
# WHY: imported before configure_mappers(), or the Admin.admin_groups reference cannot resolve and every cms.db import fails.
from .permissions import Permission, Group, GroupPermission, AdminGroup, \
    AdminPermissionOverride, AuditLog
# WHY imported like the RBAC models: Prisma owns table creation, and the servers only append lockouts.
from .security_block import SecurityBlock

from .init import init_db
from .drop import drop_db

from .util import test_db_connection, get_contest_list, is_contest_id, \
    ask_for_contest, ask_for_active_contest, active_contest_id, \
    ContestsTableMissingError, contest_binding, service_binding, \
    ServiceBinding, NoOverride, NO_OVERRIDE, get_submissions, \
    get_submission_results, get_datasets_to_judge, enumerate_files


configure_mappers()


# The following is a method of Dataset that cannot be put in the right file because of circular dependencies.

def get_submission_results_for_dataset(self, dataset) -> list[SubmissionResult]:
    """Return a list of all submission results against the specified
    dataset.

    Also preloads the executable and evaluation objects relative to
    the submission results.

    returns: list of submission results.

    """
    # We issue this query manually to optimize it
    return self.sa_session\
        .query(SubmissionResult)\
        .filter(SubmissionResult.dataset == dataset)\
        .options(joinedload(SubmissionResult.submission))\
        .options(subqueryload(SubmissionResult.executables))\
        .options(subqueryload(SubmissionResult.evaluations))\
        .all()


Dataset.get_submission_results = get_submission_results_for_dataset
