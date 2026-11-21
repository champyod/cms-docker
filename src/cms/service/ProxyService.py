#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2010-2013 Giovanni Mascellani <mascellani@poisson.phc.unipi.it>
# Copyright © 2010-2015 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2010-2012 Matteo Boscariol <boscarim@hotmail.com>
# Copyright © 2013-2018 Luca Wehrstedt <luca.wehrstedt@gmail.com>
# Copyright © 2013 Bernard Blackham <bernard@largestprime.net>
# Copyright © 2015 Luca Versari <veluca93@gmail.com>
# Copyright © 2015 William Di Luigi <williamdiluigi@gmail.com>
# Copyright © 2016 Amir Keivan Mohtashami <akmohtashami97@gmail.com>
# Copyright © 2019 Edoardo Morassutto <edoardo.morassutto@gmail.com>
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

"""The service that forwards data to RankingWebServer.

"""

import logging
import string
from urllib.parse import urlsplit

import gevent
import gevent.queue
from sqlalchemy import not_, text
from sqlalchemy.exc import SQLAlchemyError

from cms import config
from cms.db import NO_OVERRIDE, NoOverride, contest_binding
from cms.service.ranking_projection import rows as projection_rows, \
    prune_statement, snapshot_prune, upsert_statement
from cms.db import SessionGen, Contest, Participation, Task, Submission, \
    get_submissions
from cms.db.username import get_display_usernames, resolve_username_config
from cms.io import Executor, QueueItem, TriggeredService, rpc_method
from cms.io.priorityqueue import QueueEntry
from cmscommon.datetime import make_timestamp


logger = logging.getLogger(__name__)


class CannotSendError(Exception):
    pass


def encode_id(entity_id: str) -> str:
    """Encode the id using only A-Za-z0-9_.

    entity_id: the entity id to encode.
    return: encoded entity id.

    """
    encoded_id = ""
    for char in entity_id:
        if char not in string.ascii_letters + string.digits:
            encoded_id += "_%x" % ord(char)
        else:
            encoded_id += char
    return encoded_id


def write_projection(batches, operation, scopes=None):
    """Write every (resource, payloads) batch into the ranking projection at once.

    One transaction for the whole push, so a reader never sees a projection that
    landed in some tables and not others. The executor re-sends the whole push
    after a failure, which is what makes all-or-nothing the cheaper option.

    A snapshot resource also reclaims the keys its push dropped: the mapping names
    which resources a full push replaces and how the delete is scoped to the owner it
    is about, so a renamed task leaves no stale key and another contest's rows survive.

    The failures are re-raised as CannotSendError because the retry loop keys on
    that type: a refused payload and an unreachable database must look to it
    exactly as a failed request did.

    batches: (resource, payloads) pairs; the resource names the projection table.
    operation: a human-readable description for the log.
    scopes: resource name to the owner a full push is about, for a push whose
        payloads carry no row to read the owner from.

    raise (CannotSendError): if the projection refuses the push.

    """
    scopes = scopes or {}
    try:
        with SessionGen() as session:
            for resource, payloads in batches:
                statement = text(upsert_statement(resource))
                for parameters in projection_rows(resource, payloads):
                    session.execute(statement, parameters)
                snapshot = snapshot_prune(resource, payloads, scopes.get(resource))
                if snapshot is not None:
                    session.execute(text(prune_statement(resource)), snapshot)
            session.commit()
    except SQLAlchemyError as error:
        msg = "%s while %s: %s." % (type(error).__name__, operation, error)
        logger.warning(msg)
        raise CannotSendError(msg)
    except ValueError as error:
        msg = "Invalid payload while %s: %s." % (operation, error)
        logger.warning(msg)
        raise CannotSendError(msg)


def safe_url(url: str) -> str:
    """Return a sanitized URL without sensitive information.

    url: the URL to sanitize.
    return: sanitized URL.

    """
    parts = urlsplit(url)
    netloc = parts.hostname if parts.hostname is not None else ""
    netloc += ":%d" % parts.port if parts.port is not None else ""
    return parts._replace(netloc=netloc).geturl()


class ProxyOperation(QueueItem):

    def __init__(self, type_: int, data: dict,
                 scope: "int | str | set | None" = None):
        self.type_ = type_
        self.data = data
        # The owner, or owners, a full push of a snapshot resource is about. It travels
        # with the operation rather than in the payloads, because those carry no row to
        # read it from once the push has emptied the owner, and a rename leaves more than
        # one owner's rows to reclaim.
        self.scope = scope

    def __str__(self):
        return "sending data of type %s to ranking" % (
            self.type_)

    def to_dict(self):
        return {"type": self.type_,
                "data": self.data}


class ProxyExecutor(Executor[ProxyOperation]):
    """A thread that sends data to one ranking.

    The object is used as a thread-local storage and its run method is
    the function that, started as a greenlet, uses it.

    It maintains a queue of data to send. At each "round" the queue is
    emptied (i.e. all jobs are fetched) and the data is then "combined"
    to minimize the number of actual HTTP requests: they'll be at most
    one per entity type.

    Each entity type is identified by a integral class-level constant.

    """

    # We use a single queue for all the data we have to send to the
    # ranking so we need to distingush the type of each item.
    CONTEST_TYPE = 0
    TASK_TYPE = 1
    TEAM_TYPE = 2
    USER_TYPE = 3
    SUBMISSION_TYPE = 4
    SUBCHANGE_TYPE = 5
    HIDDEN_TYPE = 6

    # The resource paths for the different entity types, relative to
    # the self.ranking URL.
    RESOURCE_PATHS = [
        "contests",
        "tasks",
        "teams",
        "users",
        "submissions",
        "subchanges",
        "hidden"]

    # How many different entity types we know about.
    TYPE_COUNT = len(RESOURCE_PATHS)

    # How long we wait after having failed to push data to a ranking
    # before trying again.
    FAILURE_WAIT = 60.0

    def __init__(self, ranking: str):
        """Create a proxy for the ranking at the given URL.

        ranking: a complete URL (containing protocol, username,
            password, hostname, port and prefix) where a ranking is
            supposed to listen.

        """
        super().__init__(batch_executions=True)

        self._ranking = ranking
        self._visible_ranking = safe_url(ranking)

    def execute(self, entries: list[QueueEntry[ProxyOperation]]):
        """Consume (i.e. send) the data put in the queue, forever.

        Pick all operations found in the queue (if there aren't any,
        block waiting until there are), combine them and send HTTP
        requests to the target ranking. Do it until something very bad
        happens (i.e. some exception is raised). If communication fails
        don't stop, just wait FAILURE_WAIT seconds before restarting
        the loop.

        Do all this cooperatively: yield at every blocking operation
        (queue fetch, request send, failure wait, etc.). Since the
        queue is joinable, also notify when the fetched jobs are done.

        entries: entries containing the operations to perform.

        """
        # The cumulative data that we will try to send to the ranking,
        # built by combining items in the queue.
        data = list(dict() for i in range(self.TYPE_COUNT))
        # The owner each resource's full push is about, for a resource whose
        # payloads no longer name it.
        scopes = dict()

        for entry in entries:
            data[entry.item.type_].update(entry.item.data)
            if entry.item.scope is not None:
                scopes[self.RESOURCE_PATHS[entry.item.type_]] = entry.item.scope

        # We abuse the resource path as the English (plural) name for the entity
        # type, so the batch names the tables it is about to write. A snapshot
        # resource travels even with no payload when the push names its owner: an
        # empty batch is how the prune reclaims the rows the push dropped.
        batches = [(self.RESOURCE_PATHS[index], data[index])
                   for index in range(self.TYPE_COUNT)
                   if len(data[index]) > 0
                   or self.RESOURCE_PATHS[index] in scopes]
        if len(batches) == 0:
            return

        operation = "sending %s to ranking %s" % (
            ", ".join(batch[0] for batch in batches), self._visible_ranking)

        try:
            logger.debug(operation.capitalize())
            write_projection(batches, operation, scopes)
            # Cleared only after the commit: nothing was written if it raised, and
            # the retry has to re-send all of it rather than the part that is left.
            for batch in batches:
                batch[1].clear()

        except CannotSendError:
            # A log message has already been produced.
            gevent.sleep(self.FAILURE_WAIT)
        except:
            # Whoa! That's unexpected!
            logger.error("Unexpected error.", exc_info=True)
            gevent.sleep(self.FAILURE_WAIT)


class ProxyService(TriggeredService[ProxyOperation, ProxyExecutor]):
    """Maintain the information held by rankings up-to-date.

    Discover (by receiving notifications and by periodically sweeping
    over the database) when relevant data changes happen and forward
    them to the rankings by putting them in the queues of the proxies.

    The "entry points" are submission_score, submission_tokened,
    dataset_updated (and search_operations_not_done, from triggered
    service, which is also periodically executed). These methods fetch
    objects from the database, check their validity (existence,
    non-hiddenness, etc.)  and status and, if needed, put call
    initialize, send_score and send_token that construct the data to
    send to rankings and put it in the queues of all proxies.

    """

    def __init__(self, shard: int, contest_id: "int | None | NoOverride" = NO_OVERRIDE):
        """Start the service with the given parameters.

        Create an instance of the ProxyService and make it listen on
        the address corresponding to the given shard. Tell it to
        manage data for the contest with the given ID.

        shard: the shard of the service, i.e. this instance
            corresponds to the shard-th entry in the list of addresses
            (hostname/port pairs) for this kind of service in the
            configuration file.
        contest_id: the ID of the contest to manage.

        """
        super().__init__(shard)

        self._contest_override = contest_id

        # Store what data we already sent to rankings, to avoid
        # sending it twice.
        self.scores_sent_to_rankings: set[int] = set()
        self.tokens_sent_to_rankings: set[int] = set()

        # The task payload the rankings were last told about, and the contest key it was
        # filed under. The sweeper re-announces a payload that no longer matches the
        # database's, so an edit that reached neither this service nor the admin handlers
        # (an import, the panel, a script) cannot leave the ranking holding a stale set.
        self.pushed_tasks: "tuple[str, dict] | None" = None

        # Create one executor for each ranking.
        self.rankings = list()
        for ranking in config.proxy_service.rankings:
            self.add_executor(ProxyExecutor(ranking))

        # Enqueue the dispatch of some initial data to rankings. Needs
        # to be done before the sweeper is started, as otherwise RWS
        # might receive submissions before the corresponding task, for
        # example.
        self.initialize()

        self.start_sweeper(347.0)

    @property
    def contest_id(self) -> int:
        """The contest this service relays, re-read from the registry for every pass.

        A registry that names no contest for this instance is fatal: this service serves one
        contest, so there is nothing to relay and nothing to guess.
        """
        return contest_binding(
            self.name, self.shard, self._contest_override, serves_one_contest=True)

    def _missing_operations(self):
        """Return a generator of data to be sent to the rankings..

        """
        counter = 0
        with SessionGen() as session:
            counter += self._reannounce_changed_tasks(session)

            submissions = get_submissions(session, contest_id=self.contest_id) \
                .filter(not_(Participation.hidden)) \
                .filter(Submission.official).all()

            for submission in submissions:
                # The submission result can be None if the dataset has
                # been just made live.
                sr = submission.get_result()
                if sr is None:
                    continue

                if sr.scored() and \
                        submission.id not in self.scores_sent_to_rankings:
                    for operation in self.operations_for_score(submission):
                        self.enqueue(operation)
                        counter += 1

                if submission.tokened() and \
                        submission.id not in self.tokens_sent_to_rankings:
                    for operation in self.operations_for_token(submission):
                        self.enqueue(operation)
                        counter += 1

        return counter

    def _reannounce_changed_tasks(self, session):
        """Re-announce the contest's tasks when the database holds a different set.

        WHY the sweep looks here: an admin edit announces the full task set, but an edit is
        not the only way the set changes. An import, the panel or a script can add a task to
        the contest, drop one, renumber one or rename one, and nothing announces it, so the
        ranking keeps the previous set — silently, and the board draws a column that is gone
        or misses one that exists. The payload is derived from the database, so deriving it
        again here is what turns a missed announcement into one the sweeper finds.

        session: the session the sweep is already reading the database through.

        return: 1 when the announcement was queued again, 0 when nothing changed.

        """
        contest = Contest.get_from_id(self.contest_id, session)
        if contest is None:
            return 0
        contest_key, tasks, unused_problems = self._task_snapshot(contest)
        if self.pushed_tasks == (contest_key, tasks):
            return 0
        # A warning rather than a debug line: the ranking held a set the database does not
        # agree with, which is exactly the failure that is otherwise invisible.
        logger.warning("The tasks of contest %s differ from the ones the rankings "
                       "were last told about: announcing them again.",
                       self.contest_id)
        self.initialize()
        return 1

    def initialize(self):
        """Send basic data to all the rankings.

        It's data that's supposed to be sent before the contest, that's
        needed to understand what we're talking about when we send
        submissions: contest, users, tasks.

        No support for teams, flags and faces.

        The sweeper announces this again whenever the database's task set no longer matches
        the announced one, so this stays the one path a contest edit reaches the rankings
        through, whether an admin handler ran or not.

        """
        logger.info("Initializing rankings.")

        with SessionGen() as session:
            contest: Contest = Contest.get_from_id(self.contest_id, session)

            if contest is None:
                logger.error("Received request for unexistent contest "
                             "id %s.", self.contest_id)
                raise KeyError("Contest not found.")

            contest_key = encode_id(contest.name)
            contest_data = {
                "name": contest.description,
                "begin": int(make_timestamp(contest.start)),
                "end": int(make_timestamp(contest.stop)),
                "score_precision": contest.score_precision,
                # The projected key is the encoded contest name, so the row also carries the
                # contest's own id: a rename changes the key, and without the id a ranking that
                # was configured with the contest's id could no longer tell which projected row
                # is its own — both to word its header and to filter the columns it draws.
                "contest_id": self.contest_id}

            users = dict()
            teams = dict()
            hidden = dict()
            # Read once: the property goes back to the service registry on every call.
            contest_scope = self.contest_id

            # WHY: the ranking shows the display username each
            # contestant chose for this contest when the policy
            # allows one; resolving every visible participant in
            # a handful of queries keeps the push from issuing
            # one query per user.
            visible = [participation for participation
                       in contest.participations
                       if not participation.hidden]
            username_allowed = resolve_username_config(
                session, self.contest_id,
                [participation.user_id
                 for participation in visible])
            display_usernames = get_display_usernames(
                session, self.contest_id,
                [participation.user_id
                 for participation in visible])

            for participation in contest.participations:
                user = participation.user
                team = participation.team
                if not participation.hidden:
                    display_name = display_usernames.get(user.id) \
                        if username_allowed.get(user.id) else None
                    users[encode_id(user.username)] = {
                        "f_name": display_name
                                  if display_name is not None
                                  else user.first_name,
                        "l_name": "" if display_name is not None
                                  else user.last_name,
                        "team": encode_id(team.code)
                                if team is not None else None,
                    }
                    if team is not None:
                        teams[encode_id(team.code)] = {
                            "name": team.name
                        }
                # WHY a tombstone rather than a skip: a participation hidden after its rows
                # reached the projection has to leave the board too, and the board row is
                # driven by the submissions, so the reader needs the key to filter out.
                else:
                    hidden[encode_id(user.username)] = {
                        "contest_id": contest_scope}

            contest_key, tasks, problems = self._task_snapshot(contest)
            for name, error in problems:
                if error is None:
                    logger.warning("Skipping task %s of contest %s: it has "
                                   "no active dataset.", name, contest.name)
                else:
                    logger.warning("Skipping task %s of contest %s: its score "
                                   "type could not be built: %s: %s.",
                                   name, contest.name,
                                   type(error).__name__, error)

        self.enqueue(ProxyOperation(ProxyExecutor.CONTEST_TYPE,
                                    {contest_key: contest_data}))
        self.enqueue(ProxyOperation(ProxyExecutor.TEAM_TYPE, teams))
        self.enqueue(ProxyOperation(ProxyExecutor.USER_TYPE, users))
        # The scope travels with the push: with no hidden participation left, the
        # empty payload holds no contest to read, and the prune still has to clear
        # the tombstone of the participation that was just unhidden.
        self.enqueue(ProxyOperation(ProxyExecutor.HIDDEN_TYPE, hidden,
                                    scope=contest_scope))
        # A contest's task rows are filed under its encoded name, so a rename files
        # every row under a new one and this push cannot reclaim the rows left under
        # the old. Carrying the key the last push used beside this one is what does.
        scopes = {contest_key}
        if self.pushed_tasks is not None:
            scopes.add(self.pushed_tasks[0])
        self.pushed_tasks = (contest_key, tasks)
        self.enqueue(ProxyOperation(ProxyExecutor.TASK_TYPE, tasks,
                                    scope=scopes))

    def _task_snapshot(self, contest):
        """The task payload a contest is announced with, and the tasks left out of it.

        WHY one builder for the announcement and the sweep: what a ranking holds is this
        payload, so the two have to agree exactly or the sweep would re-announce a contest
        that never changed. A task with no active dataset has no score type, and one whose
        score type cannot be built has no max score or headers, so both are left out and
        reported to the caller instead of being announced.

        contest: the contest whose membership is read.

        return: the contest's encoded key, its task payloads by encoded task key, and the
            (task name, exception) pairs of the tasks left out, the exception None for a
            task with no active dataset.

        """
        contest_key = encode_id(contest.name)
        tasks = dict()
        problems = list()
        for contest_task in contest.task_contests:
            task = contest_task.task
            # A task with no active dataset has no score type, and so
            # no max score or extra headers, to announce.
            if task.active_dataset is None:
                problems.append((task.name, None))
                continue

            # Building the score type can raise, if the type is unknown
            # or its parameters are malformed: such a task has no max
            # score or extra headers to announce, so skip it instead of
            # failing the whole initialization.
            try:
                score_type = task.active_dataset.score_type_object
            except Exception as error:
                problems.append((task.name, error))
                continue

            tasks[encode_id(task.name)] = {
                "short_name": task.name,
                "name": task.title,
                "contest": contest_key,
                # The contest's own id travels beside its encoded name: the reader scopes the
                # columns it draws by the stable handle the config names, and a rename moves
                # the encoded name while this stays put.
                "contest_id": contest.id,
                "order": contest_task.num,
                "max_score": score_type.max_score,
                "extra_headers": score_type.ranking_headers,
                "score_precision": task.score_precision,
                "score_mode": task.score_mode,
            }
        return contest_key, tasks, problems

    def operations_for_score(self, submission: Submission):
        """Send the score for the given submission to all rankings.

        Put the submission and its score subchange in all the proxy
        queues for them to be sent to rankings.

        """
        submission_result = submission.get_result()

        # Data to send to remote rankings.
        submission_id = "%d" % submission.id
        submission_data = {
            "user": encode_id(submission.participation.user.username),
            "task": encode_id(submission.task.name),
            "time": int(make_timestamp(submission.timestamp))}

        subchange_id = "%d%ss" % (make_timestamp(submission.timestamp),
                                  submission_id)
        subchange_data = {
            "submission": submission_id,
            "time": int(make_timestamp(submission.timestamp))}

        # This check is probably useless.
        if submission_result is not None and submission_result.scored():
            # We're sending the unrounded score to RWS
            subchange_data["score"] = submission_result.score
            subchange_data["extra"] = submission_result.ranking_score_details

        self.scores_sent_to_rankings.add(submission.id)

        return [
            ProxyOperation(ProxyExecutor.SUBMISSION_TYPE,
                           {submission_id: submission_data}),
            ProxyOperation(ProxyExecutor.SUBCHANGE_TYPE,
                           {subchange_id: subchange_data})]

    def operations_for_token(self, submission: Submission):
        """Send the token for the given submission to all rankings.

        Put the submission and its token subchange in all the proxy
        queues for them to be sent to rankings.

        """
        # Data to send to remote rankings.
        submission_id = "%d" % submission.id
        submission_data = {
            "user": encode_id(submission.participation.user.username),
            "task": encode_id(submission.task.name),
            "time": int(make_timestamp(submission.timestamp))}

        subchange_id = "%d%st" % (make_timestamp(submission.token.timestamp),
                                  submission_id)
        subchange_data = {
            "submission": submission_id,
            "time": int(make_timestamp(submission.token.timestamp)),
            "token": True}

        self.tokens_sent_to_rankings.add(submission.id)

        return [
            ProxyOperation(ProxyExecutor.SUBMISSION_TYPE,
                           {submission_id: submission_data}),
            ProxyOperation(ProxyExecutor.SUBCHANGE_TYPE,
                           {subchange_id: subchange_data})]

    @rpc_method
    def reinitialize(self):
        """Repeat the initialization procedure for all rankings.

        This method is usually called via RPC when someone knows that
        some basic data (i.e. contest, tasks or users) changed and
        rankings need to be updated.

        """
        logger.info("Reinitializing rankings.")
        self.initialize()

    @rpc_method
    def submission_scored(self, submission_id: int):
        """Notice that a submission has been scored.

        Usually called by ScoringService when it's done with scoring a
        submission result. Since we don't trust anyone we verify that,
        and then send data about the score to the rankings.

        submission_id: the id of the submission that changed.

        """
        with SessionGen() as session:
            submission = Submission.get_from_id(submission_id, session)

            if submission is None:
                logger.error("[submission_scored] Received score request for "
                             "unexistent submission id %s.", submission_id)
                raise KeyError("Submission not found.")

            # ScoringService sent us a submission of another contest, they
            # do not know about our contest_id in multicontest setup.
            if submission.participation.contest_id != self.contest_id:
                logger.debug("Ignoring submission %d of contest %d "
                             "(this ProxyService considers contest %d only).",
                             submission.id, submission.participation.contest_id,
                             self.contest_id)
                return

            if submission.participation.hidden:
                logger.info("[submission_scored] Score for submission %d "
                            "not sent because the participation is hidden.",
                            submission_id)
                return

            if not submission.official:
                logger.info("[submission_scored] Score for submission %d "
                            "not sent because the submission is not official.",
                            submission_id)
                return

            # Update RWS.
            for operation in self.operations_for_score(submission):
                self.enqueue(operation)

    @rpc_method
    def submission_tokened(self, submission_id: int):
        """Notice that a submission has been tokened.

        Usually called by ContestWebServer when it's processing a token
        request of an user. Since we don't trust anyone we verify that,
        and then send data about the token to the rankings.

        submission_id: the id of the submission that changed.

        """
        with SessionGen() as session:
            submission = Submission.get_from_id(submission_id, session)

            if submission is None:
                logger.error("[submission_tokened] Received token request for "
                             "unexistent submission id %s.", submission_id)
                raise KeyError("Submission not found.")

            # ScoringService sent us a submission of another contest, they
            # do not know about our contest_id in multicontest setup.
            if submission.participation.contest_id != self.contest_id:
                logger.debug("Ignoring submission %d of contest %d "
                             "(this ProxyService considers contest %d only).",
                             submission.id, submission.participation.contest_id,
                             self.contest_id)
                return

            if submission.participation.hidden:
                logger.info("[submission_tokened] Token for submission %d "
                            "not sent because participation is hidden.",
                            submission_id)
                return

            if not submission.official:
                logger.info("[submission_tokened] Token for submission %d "
                            "not sent because the submission is not official.",
                            submission_id)
                return

            # Update RWS.
            for operation in self.operations_for_token(submission):
                self.enqueue(operation)

    @rpc_method
    def dataset_updated(self, task_id: int):
        """Notice that the active dataset of a task has been changed.

        Usually called by AdminWebServer when the contest administrator
        changed the active dataset of a task. This means that we should
        update all the scores for the task using the submission results
        on the new active dataset. If some of them are not available
        yet we keep the old scores (we don't delete them!) and wait for
        ScoringService to notify us that the new ones are available.

        task_id: the ID of the task whose dataset has changed.

        """
        with SessionGen() as session:
            task: Task = Task.get_from_id(task_id, session)
            dataset = task.active_dataset

            # This ProxyService may focus on a different contest, and it should
            # ignore this update.
            if not any(ct.contest_id == self.contest_id
                       for ct in task.contest_tasks):
                logger.debug("Ignoring dataset change for task %d (this "
                             "ProxyService considers contest %d only).",
                             task_id, self.contest_id)
                return

            # Without an active dataset there is nothing to rescore: the
            # stored scores belong to a dataset that is no longer active.
            if dataset is None:
                logger.warning("Skipping dataset update for task %d: it has "
                               "no active dataset.", task.id)
                return

            logger.info("Dataset update for task %d (dataset now is %d).",
                        task.id, dataset.id)

            # max_score and/or extra_headers might have changed.
            self.reinitialize()

            for submission in task.submissions:
                # Update RWS.
                if not submission.participation.hidden and \
                        submission.official and \
                        submission.get_result() is not None and \
                        submission.get_result().scored():
                    for operation in self.operations_for_score(submission):
                        self.enqueue(operation)
