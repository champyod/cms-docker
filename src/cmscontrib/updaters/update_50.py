#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2026 Pasit Sangprachathanarak <ouipingpasit@gmail.com>
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

"""A class to update a dump created by CMS.

Used by DumpImporter and DumpUpdater.

Turns the single-contest-per-task link (tasks.contest_id and tasks.num) into
ContestTask association rows, so a task may belong to several contests.

"""


class Updater:

    def __init__(self, data):
        assert data["_version"] == 49
        self.objs = data

    def run(self):
        objs = self.objs

        next_key = 0
        for key in objs:
            if key.isdigit():
                next_key = max(next_key, int(key) + 1)

        # Rebuild the memberships from the legacy Contest.tasks ordering, which
        # was kept sorted by num.
        for key, obj in list(objs.items()):
            if not key.isdigit() or obj.get("_class") != "Contest":
                continue
            task_keys = obj.pop("tasks", None) or []
            association_keys = []
            for num, task_key in enumerate(task_keys):
                task = objs.get(task_key)
                if task is None or task.get("_class") != "Task":
                    continue
                association_key = str(next_key)
                next_key += 1
                objs[association_key] = {
                    "_class": "ContestTask",
                    "contest_id": obj.get("id"),
                    "task_id": task.get("id"),
                    "num": num,
                    "contest": key,
                    "task": task_key,
                }
                association_keys.append(association_key)
                task.setdefault("contest_tasks", []).append(association_key)
            obj["task_contests"] = association_keys

        # Drop the retired scalar link from every task.
        for key, obj in list(objs.items()):
            if not key.isdigit() or obj.get("_class") != "Task":
                continue
            obj.pop("contest", None)
            obj.pop("num", None)
            obj.setdefault("contest_tasks", [])

        return objs
