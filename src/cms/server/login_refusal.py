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

"""What a refused login attempt is: its reason, its message and its wait.

Every surface that refuses a login reads the refusal from here, so the reason a
client branches on is one string rather than one per handler.
"""

import dataclasses
import typing

from cms.server.captcha import CaptchaOutcome
from cms.server.login_counters import FAILURE_WINDOW

# The status for a refusal that happens before the credential is read. A client
# has to be able to tell "stop trying" from "wrong password".
LOCKED_STATUS = 429

LOCKED_REASON = "locked_out"
CREDENTIALS_REASON = "credentials"
CHALLENGE_REASON = "captcha_failed"
UNAVAILABLE_REASON = "captcha_unavailable"

LOCKED_MESSAGE = ("Account or IP address locked out after too many failed "
                  "attempts. Retry later.")
CREDENTIALS_MESSAGE = "Login failed"
CHALLENGE_MESSAGE = "The login challenge could not be verified. Retry."
UNAVAILABLE_MESSAGE = ("The login challenge service is unreachable. Retry "
                       "later.")


@dataclasses.dataclass(frozen=True)
class LoginRefusal:
    """One refusal as a client reads it."""

    reason: str
    message: str
    status: int
    retry_after: typing.Optional[int] = None

    def body(self) -> dict:
        """Return the JSON body every API surface answers this refusal with."""
        payload = {"error": self.message, "reason": self.reason}
        if self.retry_after is not None:
            payload["retry_after_seconds"] = self.retry_after
        return payload


CREDENTIALS = LoginRefusal(CREDENTIALS_REASON, CREDENTIALS_MESSAGE, 403)

CHALLENGE_FAILED = LoginRefusal(CHALLENGE_REASON, CHALLENGE_MESSAGE, 403)

UNAVAILABLE = LoginRefusal(UNAVAILABLE_REASON, UNAVAILABLE_MESSAGE, 503)

# An outcome this table does not know refuses like an unreachable provider: a
# member added to CaptchaOutcome must never fall through to the password check.
OUTCOME_REFUSALS = {
    CaptchaOutcome.CHALLENGE_FAILED: CHALLENGE_FAILED,
    CaptchaOutcome.PROVIDER_UNREACHABLE: UNAVAILABLE,
}


def refusal_for_outcome(outcome: CaptchaOutcome
                        ) -> typing.Optional[LoginRefusal]:
    """Return the refusal this outcome answers with, None when it is ALLOWED."""
    if outcome is CaptchaOutcome.ALLOWED:
        return None
    return OUTCOME_REFUSALS.get(outcome, UNAVAILABLE)


def registration_refusal(outcome: CaptchaOutcome
                         ) -> typing.Optional[LoginRefusal]:
    """Return the refusal the registration form answers this outcome with.

    That form spends 403 on "the password is not correct" and its script tells
    the two apart by the status alone, so a refused challenge carries the
    pre-credential status there instead.

    """
    refusal = refusal_for_outcome(outcome)
    if refusal is None or refusal.status == UNAVAILABLE.status:
        return refusal
    return dataclasses.replace(refusal, status=LOCKED_STATUS)


def locked_refusal(retry_after: float = 0.0) -> LoginRefusal:
    """Return the lockout refusal, stating the wait the counters measured.

    A wait the counters could not measure reports the whole window: zero would
    tell a locked-out client to retry at once.

    """
    seconds = int(retry_after) if retry_after > 0 else FAILURE_WINDOW
    return LoginRefusal(LOCKED_REASON, LOCKED_MESSAGE, LOCKED_STATUS, seconds)


__all__ = ["LoginRefusal", "CREDENTIALS", "CHALLENGE_FAILED", "UNAVAILABLE",
           "OUTCOME_REFUSALS", "LOCKED_STATUS", "LOCKED_REASON",
           "refusal_for_outcome", "registration_refusal", "locked_refusal"]