#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2010-2013 Giovanni Mascellani <mascellani@poisson.phc.unipi.it>
# Copyright © 2010-2015 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2010-2012 Matteo Boscariol <boscarim@hotmail.com>
# Copyright © 2012-2014 Luca Wehrstedt <luca.wehrstedt@gmail.com>
# Copyright © 2014 Artem Iglikov <artem.iglikov@gmail.com>
# Copyright © 2014 Fabian Gundlach <320pointsguy@gmail.com>
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

"""Task-related handlers for AWS for a specific contest.

"""

from cms.db import Contest, ContestTask, Task
from cmscommon.datetime import make_datetime

from .base import BaseHandler, require_permission


class ContestTasksHandler(BaseHandler):
    REMOVE_FROM_CONTEST = "Remove from contest"
    MOVE_UP = "up by 1"
    MOVE_DOWN = "down by 1"
    MOVE_TOP = "to the top"
    MOVE_BOTTOM = "to the bottom"

    def _get_contest_task(self, task_id) -> ContestTask | None:
        return self.sql_session.query(ContestTask)\
            .filter(ContestTask.contest == self.contest)\
            .filter(ContestTask.task_id == task_id)\
            .one_or_none()

    def _contest_tasks(self, criteria) -> list[ContestTask]:
        return self.sql_session.query(ContestTask)\
            .filter(ContestTask.contest == self.contest)\
            .filter(criteria)\
            .all()

    @require_permission(BaseHandler.AUTHENTICATED)
    def get(self, contest_id):
        self.contest = self.safe_get_item(Contest, contest_id)

        self.r_params = self.render_params()
        self.r_params["contest"] = self.contest
        # A task is a candidate when it has no membership row for this contest;
        # it may already belong to other contests.
        self.r_params["unassigned_tasks"] = \
            self.sql_session.query(Task)\
                .filter(~Task.contest_tasks.any(
                    ContestTask.contest_id == self.contest.id))\
                .all()
        self.render("contest_tasks.html", **self.r_params)

    @require_permission("task:update")
    def post(self, contest_id):
        fallback_page = self.url("contest", contest_id, "tasks")

        self.contest = self.safe_get_item(Contest, contest_id)

        try:
            task_id: str = self.get_argument("task_id")
            operation: str = self.get_argument("operation")
            assert operation in (
                self.REMOVE_FROM_CONTEST,
                self.MOVE_UP,
                self.MOVE_DOWN,
                self.MOVE_TOP,
                self.MOVE_BOTTOM
            ), "Please select a valid operation"
        except Exception as error:
            self.service.add_notification(
                make_datetime(), "Invalid field(s)", repr(error))
            self.redirect(fallback_page)
            return

        task = self.safe_get_item(Task, task_id)
        contest_task = self._get_contest_task(task.id)
        if contest_task is None:
            self.service.add_notification(
                make_datetime(), "Invalid field(s)",
                "Task is not part of this contest")
            self.redirect(fallback_page)
            return
        contest_task2 = None

        # Save the current position in the contest.
        task_num = contest_task.num

        if operation == self.REMOVE_FROM_CONTEST:
            # Drop the membership row; the task survives for other contests.
            self.sql_session.delete(contest_task)
            self.sql_session.flush()

            # Decrease by 1 the num of every subsequent membership.
            for ct in self._contest_tasks(ContestTask.num > task_num):
                if ct.num is not None:
                    ct.num -= 1
                    self.sql_session.flush()

        elif operation == self.MOVE_UP:
            contest_task2 = self.sql_session.query(ContestTask)\
                .filter(ContestTask.contest == self.contest)\
                .filter(ContestTask.num == contest_task.num - 1)\
                .first()

        elif operation == self.MOVE_DOWN:
            contest_task2 = self.sql_session.query(ContestTask)\
                .filter(ContestTask.contest == self.contest)\
                .filter(ContestTask.num == contest_task.num + 1)\
                .first()

        elif operation == self.MOVE_TOP:
            contest_task.num = None
            self.sql_session.flush()

            # Increase by 1 the num of every previous membership.
            for ct in self.sql_session.query(ContestTask)\
                    .filter(ContestTask.contest == self.contest)\
                    .filter(ContestTask.num < task_num)\
                    .order_by(ContestTask.num.desc())\
                    .all():
                ct.num += 1
                self.sql_session.flush()

            contest_task.num = 0

        elif operation == self.MOVE_BOTTOM:
            contest_task.num = None
            self.sql_session.flush()

            # Decrease by 1 the num of every subsequent membership.
            for ct in self._contest_tasks(ContestTask.num > task_num):
                if ct.num is not None:
                    ct.num -= 1
                    self.sql_session.flush()

            self.sql_session.flush()
            member_count = self.sql_session.query(ContestTask)\
                .filter(ContestTask.contest == self.contest)\
                .count()
            contest_task.num = member_count - 1

        # Swap the two nums, if needed.
        if contest_task2 is not None:
            tmp_a, tmp_b = contest_task.num, contest_task2.num
            contest_task.num, contest_task2.num = None, None
            self.sql_session.flush()
            contest_task.num, contest_task2.num = tmp_b, tmp_a

        if self.try_commit():
            # Update the ranking.
            self.service.proxy_service.reinitialize()

        # Maybe they'll want to do this again (for another task)
        self.redirect(fallback_page)


class AddContestTaskHandler(BaseHandler):
    @require_permission("task:update")
    def post(self, contest_id):
        fallback_page = self.url("contest", contest_id, "tasks")

        self.contest = self.safe_get_item(Contest, contest_id)

        try:
            task_id: str = self.get_argument("task_id")
            # Check that the admin selected some task.
            assert task_id != "null", "Please select a valid task"
        except Exception as error:
            self.service.add_notification(
                make_datetime(), "Invalid field(s)", repr(error))
            self.redirect(fallback_page)
            return

        task = self.safe_get_item(Task, task_id)

        # Add the membership row unless the task is already in this contest.
        already_member = self.sql_session.query(ContestTask)\
            .filter(ContestTask.contest == self.contest)\
            .filter(ContestTask.task_id == task.id)\
            .first() is not None
        if not already_member:
            next_num = self.sql_session.query(ContestTask)\
                .filter(ContestTask.contest == self.contest)\
                .count()
            self.sql_session.add(ContestTask(
                contest=self.contest, task=task, num=next_num))

        if self.try_commit():
            # Update the ranking.
            self.service.proxy_service.reinitialize()

        # Maybe they'll want to do this again (for another task)
        self.redirect(fallback_page)
