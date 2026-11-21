#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2018 Stefano Maggiolo <s.maggiolo@gmail.com>
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

"""Tests for the GroupThreshold score type."""

import unittest

from cms.grading.scoretypes.GroupThreshold import GroupThreshold
from cmstestsuite.unit_tests.grading.scoretypes.scoretypetestutils \
    import ScoreTypeTestMixin


class TestGroupThreshold(ScoreTypeTestMixin, unittest.TestCase):
    """Test the GroupThreshold score type."""

    def setUp(self):
        super().setUp()
        self._public_testcases = {
            "0_0": True,
            "1_0": True,
            "1_1": True,
            "2_0": True,
            "2_1": False,
            "3_0": False,
            "3_1": False,
        }

    def test_it_accepts_well_formed_parameters(self):
        """Test that correct parameters do not throw."""
        GroupThreshold([], self._public_testcases)
        GroupThreshold([[40, 2, 500], [60.0, 2, 1000]],
                       self._public_testcases)
        GroupThreshold([[40, "1_*", 500.5], [60.0, "2_*", 1000]],
                       self._public_testcases)

    def test_it_rejects_ill_typed_parameters(self):
        with self.assertRaises(ValueError):
            GroupThreshold([1], self._public_testcases)
        with self.assertRaises(ValueError):
            GroupThreshold(1, self._public_testcases)

    def test_it_rejects_a_group_with_a_wrong_item_count(self):
        with self.assertRaises(ValueError):
            GroupThreshold([[]], self._public_testcases)
        with self.assertRaises(ValueError):
            GroupThreshold([[1]], self._public_testcases)

    @unittest.skip("Not yet detected.")
    def test_it_rejects_a_group_with_extra_items(self):
        with self.assertRaises(ValueError):
            GroupThreshold([[1, 2]], self._public_testcases)

    def test_it_rejects_a_max_score_that_is_not_a_number(self):
        with self.assertRaises(ValueError):
            GroupThreshold([["a", 10, 1000]], self._public_testcases)

    def test_it_rejects_a_testcases_selector_of_the_wrong_type(self):
        with self.assertRaises(ValueError):
            GroupThreshold([[100, 1j, 1000]], self._public_testcases)

    def test_it_rejects_inconsistent_testcases_selector_types(self):
        with self.assertRaises(ValueError):
            GroupThreshold([[40, 10, 500], [40, "1_*", 1000]],
                           self._public_testcases)

    @unittest.skip("Not yet detected.")
    def test_it_rejects_a_group_covering_too_many_testcases(self):
        with self.assertRaises(ValueError):
            GroupThreshold([[100, 20, 1000]], self._public_testcases)

    def test_it_rejects_a_regex_that_matches_no_testcase(self):
        with self.assertRaises(ValueError):
            GroupThreshold([[100, "9_*", 1000]], self._public_testcases)

    @unittest.skip("Not yet detected.")
    def test_it_rejects_a_threshold_of_the_wrong_type(self):
        with self.assertRaises(ValueError):
            GroupThreshold([[100, 1, 1000j]], self._public_testcases)

    def test_it_computes_max_scores_for_regex_defined_groups(self):
        """Test max score is correct when groups are regexp-defined."""
        s1, s2, s3 = 10.5, 30.5, 59
        parameters = [[0, "0_*", 0], [s1, "1_*", 10], [s2, "2_*", 20], [s3, "3_*", 30]]
        header = ["Subtask 0 (0)",
                  "Subtask 1 (10.5)", "Subtask 2 (30.5)", "Subtask 3 (59)"]

        # Only group 1_* is public.
        public_testcases = dict(self._public_testcases)
        self.assertEqual(
            GroupThreshold(parameters, public_testcases).max_scores(),
            (s1 + s2 + s3, s1, header))

        # All groups are public
        for testcase in public_testcases.keys():
            public_testcases[testcase] = True
        self.assertEqual(
            GroupThreshold(parameters, public_testcases).max_scores(),
            (s1 + s2 + s3, s1 + s2 + s3, header))

        # No groups are public
        for testcase in public_testcases.keys():
            public_testcases[testcase] = False
        self.assertEqual(
            GroupThreshold(parameters, public_testcases).max_scores(),
            (s1 + s2 + s3, 0, header))

    def test_it_computes_max_scores_for_number_defined_groups(self):
        """Test max score is correct when groups are number-defined."""
        s1, s2, s3 = 10.5, 30.5, 59
        parameters = [[0, 1, 0], [s1, 2, 10], [s2, 2, 20], [s3, 2, 30]]
        header = ["Subtask 0 (0)",
                  "Subtask 1 (10.5)", "Subtask 2 (30.5)", "Subtask 3 (59)"]

        # Only group 1_* is public.
        public_testcases = dict(self._public_testcases)
        self.assertEqual(
            GroupThreshold(parameters, public_testcases).max_scores(),
            (s1 + s2 + s3, s1, header))

        # All groups are public
        for testcase in public_testcases.keys():
            public_testcases[testcase] = True
        self.assertEqual(
            GroupThreshold(parameters, public_testcases).max_scores(),
            (s1 + s2 + s3, s1 + s2 + s3, header))

        # No groups are public
        for testcase in public_testcases.keys():
            public_testcases[testcase] = False
        self.assertEqual(
            GroupThreshold(parameters, public_testcases).max_scores(),
            (s1 + s2 + s3, 0, header))

    def test_it_computes_the_score_of_a_submission(self):
        s1, s2, s3 = 10.5, 30.5, 59
        parameters = [[0, "0_*", 0],
                      [s1, "1_*", 10], [s2, "2_*", 20], [s3, "3_*", 30]]
        st = GroupThreshold(parameters, self._public_testcases)
        sr = self.get_submission_result(self._public_testcases)

        # All correct (below threshold).
        for evaluation in sr.evaluations:
            evaluation.outcome = 5.5
        self.assertComputeScore(
            st.compute_score(sr),
            s1 + s2 + s3, s1, [0, s1, s2, s3], [
                {"idx": 0},
                {"idx": 1},
                {"idx": 2},
                {"idx": 3}
            ])

        # Some non-public subtask is incorrect.
        self.set_outcome(sr, "3_1", 100.5)
        self.assertComputeScore(
            st.compute_score(sr),
            s1 + s2, s1, [0, s1, s2, 0], [
                {"idx": 0},
                {"idx": 1},
                {"idx": 2},
                {"idx": 3}
            ])

        # Also the public subtask is incorrect.
        self.set_outcome(sr, "1_0", 12.5)
        self.set_outcome(sr, "1_1", 12.5)
        self.assertComputeScore(
            st.compute_score(sr),
            s2, 0.0, [0, 0, s2, 0], [
                {"idx": 0},
                {"idx": 1},
                {"idx": 2},
                {"idx": 3}
            ])

        # Outcome equal to 0 is special and treated as error even if it is
        # below the threshold.
        self.set_outcome(sr, "1_0", 0.0)
        self.set_outcome(sr, "1_1", 0.0)
        self.assertComputeScore(
            st.compute_score(sr),
            s2, 0.0, [0, 0, s2, 0], [
                {"idx": 0},
                {"idx": 1},
                {"idx": 2},
                {"idx": 3}
            ])


if __name__ == "__main__":
    unittest.main()
