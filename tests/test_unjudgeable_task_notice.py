#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2026 Champ <noreply@example.invalid>
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

"""A task with no active dataset tells the contestant it cannot be judged.

WHY this suite exists: the contest web refuses a submission to such a task
(accept_submission raises), but nothing said so before the contestant filled
the form in -- and the form stayed on the page offering the submit button.
The contest overview is rendered here too, because a task whose dataset
carries no task type to construct took the whole page down for every
contestant of the contest instead of showing one cell as N/A.

The contestant-facing pages are rendered here rather than grepped for,
because what matters is that the served page carries the notice and no
longer carries the control the server would refuse. The loader, the i18n
extension and StrictUndefined are the ones the server configures; the context
is the smallest set of names these pages read.

Usage: python3 tests/test_unjudgeable_task_notice.py
"""

import datetime
import os
import unittest

import jinja2


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEMPLATES = os.path.join(REPO_ROOT, "src", "cms", "server", "contest", "templates")

NOW = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)

# The page of a task, the page carrying its submit control, the contest
# overview every contestant of the contest is served, and the handlers that
# render each: a page shows the notice only if its handler hands it over.
TASK_PAGE = "task_description.html"
SUBMISSIONS_PAGE = "task_submissions.html"
OVERVIEW_PAGE = "overview.html"
HANDLER_SOURCES = (
    "src/cms/server/contest/handlers/task.py",
    "src/cms/server/contest/handlers/tasksubmission.py",
)
# The fact the handlers have to pass, spelled the way the handlers compute it.
HANDLER_FACT = "task_has_active_dataset=task.active_dataset is not None"
# The one message both pages carry: what the contestant has to read.
NOTICE = "This task cannot be judged yet, so you cannot submit a solution for it."
# How the submit control is recognised in the served page.
SUBMIT_CONTROL = "tasks/sum/submit"
# The task type a dataset that resolves hands back, as the overview lists it.
TASK_TYPE_NAME = "BatchAndOutput"


class Stub:
    """A bag of attributes for the names a template reads off an object."""

    def __init__(self, **attributes):
        self.__dict__.update(attributes)


def read(path: str) -> str:
    """Return a repository file's text."""
    with open(os.path.join(REPO_ROOT, path), encoding="utf-8") as source:
        return source.read()


def template_environment() -> jinja2.Environment:
    """Return the environment the two task pages are rendered in here.

    Every tool the pages call is either replicated from cms.server's own
    toolbox (all, any, the formatting filters) or stubbed, because the toolbox
    itself imports cms, whose dependencies are not installed in this checkout.
    """
    environment = jinja2.Environment(
        trim_blocks=True, lstrip_blocks=True, autoescape=True,
        undefined=jinja2.StrictUndefined,
        loader=jinja2.FileSystemLoader(TEMPLATES),
        extensions=["jinja2.ext.i18n"])
    environment.install_null_translations(newstyle=True)

    environment.tests["today"] = lambda _datetime: True
    environment.tests["endswith"] = lambda value, suffix: value.endswith(suffix)
    environment.filters["to_language"] = lambda code: Stub(
        name=code, source_extensions=[code], source_extension=code)
    environment.filters["all"] = _all
    environment.filters["any"] = lambda values, test=None, *args: any(values)
    environment.filters["dictselect"] = lambda value, *args, **kwargs: value
    environment.filters["make_timestamp"] = lambda value: 0
    environment.filters["format_datetime_smart"] = lambda value, with_zone=False: "T"
    environment.filters["format_datetime"] = lambda value: "T"
    environment.filters["format_time"] = lambda value: "T"
    environment.filters["format_duration"] = lambda value, length=None: "D"
    environment.filters["format_size"] = lambda value: "S"
    environment.filters["format_locale"] = lambda value: value

    environment.globals["get_task_type"] = _get_task_type
    environment.globals["get_score_type"] = _get_score_type
    environment.globals["get_mimetype_for_file_name"] = lambda name: "text/plain"
    environment.globals["get_icon_for_mimetype"] = lambda mimetype: "text-x-generic"
    environment.globals["get_score_class"] = lambda *args, **kwargs: "score_0"
    environment.globals["SubmissionResult"] = Stub(
        COMPILING=1, COMPILATION_FAILED=2, EVALUATING=3, SCORING=4, SCORED=5)
    environment.globals["UserTestResult"] = Stub(COMPILATION_FAILED=2, EVALUATED=5)
    environment.globals["TOKEN_MODE_DISABLED"] = 0
    environment.globals["TOKEN_MODE_INFINITE"] = -1
    environment.globals["MAX_INPUT_LENGTH"] = 100
    environment.globals["MIN_PASSWORD_LENGTH"] = 6
    return environment


@jinja2.pass_context
def _all(context, values, test=None, *args) -> bool:
    """cms.server's "all" filter: every element passing a named test."""
    test = bool if test is None else context.environment.tests[test]
    return all(context.call(test, value, *args) for value in values)


@jinja2.pass_environment
def _get_task_type(environment, dataset=None):
    """What the server's get_task_type answers.

    It dereferences dataset.task_type_object, which a dataset with no task
    type at all -- or one the grader does not implement -- fails to give, so
    the call answers an undefined value on the same terms as the server's,
    which is what the pages' "is defined" guards are written against.
    """
    try:
        return dataset.task_type_object
    except Exception:
        return environment.undefined("TaskType not found")


def resolvable_task_type() -> Stub:
    """Return the task type a dataset that resolves hands back."""
    return Stub(name=TASK_TYPE_NAME, ALLOW_PARTIAL_SUBMISSION=False,
                get_compilation_commands=lambda submission_format: {})


@jinja2.pass_environment
def _get_score_type(environment, dataset=None):
    """What the server's get_score_type answers, on the same terms."""
    if dataset is None:
        return environment.undefined("no dataset")
    return Stub(max_public_score=100.0, max_score=100.0,
                format_score=lambda *args, **kwargs: "100.0")


def fake_task(active_dataset):
    """Return a task of the contest, with or without the dataset at issue."""
    return Stub(name="sum", title="Sum", statements={}, attachments={},
                submission_format=["sum.c"], score_precision=0, token_mode=0,
                max_submission_number=None, active_dataset=active_dataset,
                get_allowed_languages=lambda: ["cpp"])


class UnresolvableTypeDataset:
    """A dataset whose task type the pages cannot be given.

    cms.grading.tasktypes.get_task_type does a bare dict lookup, so a task
    whose task_type names a type this deployment does not implement raises
    KeyError the moment the dataset's task_type_object is read -- and a task
    with no active dataset has no dataset to read it off at all. Both leave
    the pages with no task type to render, which is the state pinned here.
    """

    time_limit = None
    memory_limit = None

    @property
    def task_type_object(self):
        raise KeyError("task type not implemented by this deployment")


def fake_contest(tasks) -> Stub:
    """Return the contest the overview is served for, holding these tasks."""
    return Stub(description="A contest", name="contest", languages=[],
                tasks=tasks, allow_registration=False, per_user_time=None,
                allow_unofficial_submission_before_analysis_mode=True,
                start=NOW, stop=NOW, analysis_enabled=False,
                max_submission_number=None, max_user_test_number=None,
                token_mode=0, allow_questions=False, allow_user_tests=False)


def fake_facts(task) -> dict:
    """Return the render context ContestHandler.render_params fills, narrowed
    to the names these pages read, plus the task facts their handlers add.
    """
    user = Stub(username="contestant", name="Contestant")
    participation = Stub(user=user, unrestricted=True, preferred_languages=[],
                         starting_time=None, delay_time=None, extra_time=None,
                         contest=Stub())
    now = NOW
    return {
        "url": lambda *args, **kwargs: "/static/x",
        # The page's links are the served ones: a task's submit control is
        # recognised by the URL it posts to.
        "contest_url": lambda *parts: "/contest/" + "/".join(
            str(part) for part in parts),
        "handler": Stub(get_argument=lambda name, default="": default),
        "xsrf_form_html": "",
        "translation": Stub(identifier="en", gettext=lambda message: message),
        "contest": Stub(description="A contest", name="contest", languages=[],
                        tasks=[], allow_registration=False, per_user_time=None,
                        allow_unofficial_submission_before_analysis_mode=True),
        "phase": 0,
        "actual_phase": 0,
        "current_phase_begin": now,
        "current_phase_end": now,
        "now": now,
        "timezone": datetime.timezone.utc,
        "utc": datetime.timezone.utc,
        "available_translations": [],
        "cookie_translation": None,
        "automatic_translation": Stub(name="Automatic"),
        "credits": Stub(project=Stub(name="CMS", author="Champ"),
                        license=Stub(url="/license", name="AGPL")),
        "config": Stub(global_=Stub(source_url="/source", ranking_url="")),
        "teams": [],
        "participation": participation,
        "user": user,
        "display_name": "Contestant",
        "captcha_widget": "",
        "testing_enabled": False,
        "questions_enabled": False,
        "tokens_contest": 0,
        "tokens_tasks": 0,
        "tokens_task": 0,
        "tokens_info": [0, None, None],
        "submissions": [],
        "submissions_left": None,
        "submissions_download_allowed": False,
        "public_score": 0.0,
        "tokened_score": 0.0,
        "is_score_partial": False,
        "task": task,
        "task_has_active_dataset": task.active_dataset is not None,
    }


def render(template_name: str, task) -> str:
    """Render one task page for a task, as its handler would."""
    return template_environment().get_template(template_name).render(**fake_facts(task))


def render_overview(task) -> str:
    """Render the contest overview of a contest holding this one task.

    The overview's handler hands over the contest and nothing per task, so
    the context of a task page is narrowed to it here: no task, no task fact.
    """
    facts = fake_facts(task)
    facts["contest"] = fake_contest([task])
    del facts["task"]
    del facts["task_has_active_dataset"]
    facts["participation"] = Stub(
        user=facts["user"], unrestricted=True, preferred_languages=[],
        starting_time=None, delay_time=datetime.timedelta(0),
        extra_time=datetime.timedelta(0), contest=Stub())
    return template_environment().get_template(OVERVIEW_PAGE).render(**facts)


class UnjudgeableTaskNoticeTest(unittest.TestCase):
    """A task without an active dataset says so; a normal task is untouched."""

    def test_the_task_page_names_the_reason(self):
        self.assertIn(NOTICE, render(TASK_PAGE, fake_task(None)))

    def test_the_submissions_page_shows_the_notice_instead_of_the_form(self):
        page = render(SUBMISSIONS_PAGE, fake_task(None))

        self.assertIn(NOTICE, page)
        self.assertNotIn(SUBMIT_CONTROL, page)

    def test_a_task_with_a_dataset_is_unchanged(self):
        dataset = Stub(task_type_object=resolvable_task_type(),
                       time_limit=None, memory_limit=None,
                       score_type_object=Stub())
        task = fake_task(dataset)

        for template_name in (TASK_PAGE, SUBMISSIONS_PAGE):
            with self.subTest(template=template_name):
                self.assertNotIn(NOTICE, render(template_name, task))

        self.assertIn(SUBMIT_CONTROL, render(SUBMISSIONS_PAGE, task))

    def test_the_overview_shows_a_task_with_no_active_dataset_as_inert(self):
        self.assertIn("<td>N/A</td>", render_overview(fake_task(None)))

    def test_the_overview_lists_a_task_whose_type_does_not_resolve(self):
        page = render_overview(fake_task(UnresolvableTypeDataset()))

        self.assertIn("<td>N/A</td>", page)

    def test_the_overview_of_a_resolvable_contest_is_unchanged(self):
        dataset = Stub(task_type_object=resolvable_task_type(),
                       time_limit=None, memory_limit=None)

        self.assertIn("<td>%s</td>" % TASK_TYPE_NAME,
                      render_overview(fake_task(dataset)))

    def test_every_page_at_issue_is_handed_the_fact(self):
        # The pages only show the notice if their handler passes it, and
        # neither handler can be imported in this checkout.
        for path in HANDLER_SOURCES:
            with self.subTest(handler=path):
                source = " ".join(read(path).split())
                self.assertIn(HANDLER_FACT, source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
