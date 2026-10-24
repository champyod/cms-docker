#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2016 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2017-2018 Luca Wehrstedt <luca.wehrstedt@gmail.com>
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

"""This script creates a new user in the database.

"""

# We enable monkey patching to make many libraries gevent-friendly
# (for instance, urllib3, used by requests)
import gevent.monkey
gevent.monkey.patch_all()  # noqa

import argparse
import logging
import sys

from sqlalchemy.exc import IntegrityError

from cms import utf8_decoder
from cms.db import SessionGen, User
from cmscommon.crypto import generate_random_password, build_password, \
    hash_password


logger = logging.getLogger(__name__)


def add_user(
    first_name: str,
    last_name: str,
    username: str,
    password: str | None,
    method: str,
    is_hashed: bool,
    email: str | None,
    timezone: str | None,
    preferred_languages: str | None,
):
    logger.info("Creating the user in the database.")
    pwd_generated = False
    if password is None:
        assert not is_hashed
        password = generate_random_password()
        pwd_generated = True
    if is_hashed:
        # Already a bcrypt hash: only tag it with its method. build_password()
        # refuses a payload that is not a hash and any non-bcrypt method.
        stored_password = build_password(password, method)
    else:
        # A raw password: hash_password() is the single entry that stores one.
        stored_password = hash_password(password, method)

    if preferred_languages is None:
        preferred_languages_l = []
    else:
        preferred_languages_l = list(
            lang.strip() for lang in preferred_languages.split(",") if lang.strip()
        )
    user = User(
        first_name=first_name,
        last_name=last_name,
        username=username,
        password=stored_password,
        email=email,
        timezone=timezone,
        preferred_languages=preferred_languages_l,
    )
    try:
        with SessionGen() as session:
            session.add(user)
            session.commit()
    except IntegrityError:
        logger.error("A user with the given username already exists.")
        return False

    logger.info("User added%s. "
                "Use AddParticipation to add this user to a contest."
                % (" with password %s" % password if pwd_generated else ""))
    return True


def main():
    """Parse arguments and launch process.

    """
    parser = argparse.ArgumentParser(description="Add a user to CMS.")
    parser.add_argument("first_name", action="store", type=utf8_decoder,
                        help="given name of the user")
    parser.add_argument("last_name", action="store", type=utf8_decoder,
                        help="family name of the user")
    parser.add_argument("username", action="store", type=utf8_decoder,
                        help="username used to log in")
    parser.add_argument("-e", "--email", action="store", type=utf8_decoder,
                        help="email of the user")
    parser.add_argument("-t", "--timezone", action="store", type=utf8_decoder,
                        help="timezone of the user, e.g. Europe/London")
    parser.add_argument("-l", "--languages", action="store", type=utf8_decoder,
                        help="comma-separated list of preferred languages")
    password_group = parser.add_mutually_exclusive_group()
    password_group.add_argument(
        "-p", "--plaintext-password", action="store", type=utf8_decoder,
        help="password of the user in plain text")
    password_group.add_argument(
        "-H", "--hashed-password", action="store", type=utf8_decoder,
        help="password of the user, already bcrypt-hashed")
    method_group = parser.add_mutually_exclusive_group()
    method_group.add_argument(
        "--method", dest="method", action="store", default="bcrypt",
        help="how to store the password; bcrypt is the only accepted method "
             "(and the default). Storing a password in plain text is refused: "
             "it would put the user's secret in the database and the row could "
             "not log in")
    method_group.add_argument(
        "--bcrypt", dest="method", action="store_const", const="bcrypt",
        default=argparse.SUPPRESS,
        help="deprecated alias for --method bcrypt")

    args = parser.parse_args()

    if args.method != "bcrypt":
        parser.error(
            "method %r is not allowed: it would store the password in a form "
            "that is not a bcrypt hash, leaving the user's secret readable in "
            "the database. Use the default, --method bcrypt." % args.method)

    try:
        success = add_user(args.first_name, args.last_name, args.username,
                           args.plaintext_password or args.hashed_password,
                           args.method, args.hashed_password is not None,
                           args.email, args.timezone, args.languages)
    except ValueError as error:
        parser.error(str(error))
    return 0 if success is True else 1


if __name__ == "__main__":
    sys.exit(main())
