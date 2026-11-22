#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2026
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

"""Seed the parity database with one contest, task, participant and submission.

Runs inside a stack container, so it writes through the tree's own models and
fails the same way the tree would. Every datetime is a fixed calendar instant:
a seed computed from the clock would give the two captures different contests
and the harness would report a diff that no code change caused.
"""

from datetime import datetime

from cms.db import (Admin, Contest, ContestTask, Dataset, Participation,
                    SessionGen, Submission, SubmissionResult, Task, User)
from cmscommon.crypto import hash_password

ADMIN_USER = "parity_admin"
ADMIN_PW = "parity-admin-pw"
USER_NAME = "parity_user"
USER_PW = "parity-user-pw"
CONTEST_NAME = "parity"
TASK_NAME = "parity_task"
TASK_TITLE = "Parity Task"

# WHY a contest that is open for the rest of the century: the participant
# surfaces the harness compares (task list API, statement, submissions) are only
# served while the contest is running, and a window computed from the clock would
# move between runs.
START = datetime(2020, 1, 1, 9, 0, 0)
STOP = datetime(2099, 1, 1, 0, 0, 0)
ANALYSIS = datetime(2099, 1, 2, 0, 0, 0)


def main():
    with SessionGen() as session:
        # WHY no groups: an admin with no granted permission is how the harness
        # reaches a real 403 instead of inventing one.
        session.add(Admin(name="Parity Admin", username=ADMIN_USER,
                          authentication=hash_password(ADMIN_PW), enabled=True))
        user = User(username=USER_NAME, password=hash_password(USER_PW),
                    first_name="Parity", last_name="User")
        session.add(user)

        contest = Contest(
            name=CONTEST_NAME,
            description="Parity harness contest",
            start=START, stop=STOP,
            analysis_enabled=False,
            analysis_start=ANALYSIS, analysis_stop=ANALYSIS,
            # WHY: an ip-restricted contest refuses every login that has no
            # allowed range, which would reduce the participant surface to a
            # login-refused redirect.
            ip_restriction=False,
            is_active=True,
        )
        session.add(contest)

        # WHY one language and one submission file: the statement page renders
        # every allowed language's compilation command, and a language asked to
        # compile a submission format it has no source for raises inside CMS, so the
        # format carries the %l placeholder every language substitutes.
        task = Task(name=TASK_NAME, title=TASK_TITLE,
                    submission_format=["solution.%l"],
                    allowed_languages=["C++20 / g++"])
        session.add(task)
        session.flush()

        session.add(ContestTask(contest=contest, task=task, num=0))

        dataset = Dataset(
            task=task,
            description="Parity dataset",
            task_type="Batch",
            task_type_parameters=["alone", ["", ""], "diff"],
            score_type="Sum",
            score_type_parameters={"max_score": 100.0},
        )
        session.add(dataset)
        session.flush()
        task.active_dataset = dataset

        participation = Participation(contest=contest, user=user)
        session.add(participation)
        session.flush()

        # WHY a submission with results: the submission list renders a status
        # column, and a submission still waiting for a worker would let the
        # evaluation state change between the two captures.
        submission = Submission(
            participation=participation,
            task=task,
            timestamp=datetime(2020, 1, 1, 9, 30, 0),
            language="C++20 / g++",
            comment="",
            official=True,
            opaque_id=1,
        )
        session.add(submission)
        session.flush()

        session.add(SubmissionResult(
            submission=submission,
            dataset=dataset,
            compilation_outcome="ok",
            compilation_text=[],
            compilation_tries=1,
            evaluation_outcome="ok",
            evaluation_tries=1,
            score=100.0,
            score_details={"max_score": 100.0, "score": 100.0, "testcases": []},
            # WHY an explicit instant: ScoringService stamps a NULL scored_at
            # with the clock on its first scan, and the submission table renders
            # scored_at - timestamp as a latency.
            scored_at=datetime(2020, 1, 1, 9, 31, 0),
        ))

        session.commit()

    print("parity: seeded contest=%s task=%s" % (CONTEST_NAME, TASK_NAME))


if __name__ == "__main__":
    main()
