//! The one `UNION` the digest walk runs, with a branch only for the parts it was asked for.
//!
//! `UNION` rather than `UNION ALL` because the reference collects into a set, so a
//! digest reached through two tables is reported once.

/// The contest→task scope every branch starts from; the branch adds its own joins.
const TASK_SCOPE: &str = " FROM contests AS c \
    JOIN contest_tasks AS ct ON ct.contest_id = c.id \
    JOIN tasks AS t ON t.id = ct.task_id";

/// The parts of the graph a digest walk may leave out.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FileSkips {
    /// Leave out every digest a submission brought in.
    pub submissions: bool,
    /// Leave out every digest a user test brought in.
    pub user_tests: bool,
    /// Leave out both, which the reference spells as its own flag.
    pub users: bool,
    /// Leave out every digest an evaluation or a compilation produced.
    pub generated: bool,
}

/// The one statement the walk runs.
pub(super) fn statement(contest: bool, skips: FileSkips) -> String {
    let mut branches = vec![
        branch(
            contest,
            "",
            "st.digest",
            " JOIN statements AS st ON st.task_id = t.id",
        ),
        branch(
            contest,
            "",
            "a.digest",
            " JOIN attachments AS a ON a.task_id = t.id",
        ),
        branch(
            contest,
            "",
            "m.digest",
            " JOIN datasets AS d ON d.task_id = t.id \
             JOIN managers AS m ON m.dataset_id = d.id",
        ),
        branch(
            contest,
            "",
            "tc.input",
            " JOIN datasets AS d ON d.task_id = t.id \
             JOIN testcases AS tc ON tc.dataset_id = d.id",
        ),
        branch(
            contest,
            "",
            "tc.output",
            " JOIN datasets AS d ON d.task_id = t.id \
             JOIN testcases AS tc ON tc.dataset_id = d.id",
        ),
    ];

    if !skips.submissions && !skips.users {
        branches.push(branch(
            contest,
            "",
            "f.digest",
            " JOIN submissions AS s ON s.task_id = t.id \
             JOIN files AS f ON f.submission_id = s.id",
        ));
        if !skips.generated {
            branches.push(branch(
                contest,
                "",
                "e.digest",
                " JOIN submissions AS s ON s.task_id = t.id \
                 JOIN submission_results AS r ON r.submission_id = s.id \
                 JOIN executables AS e ON e.submission_id = r.submission_id \
                     AND e.dataset_id = r.dataset_id",
            ));
        }
    }

    if !skips.user_tests && !skips.users {
        branches.push(branch(
            contest,
            "",
            "ut.input",
            " JOIN user_tests AS ut ON ut.task_id = t.id",
        ));
        branches.push(branch(
            contest,
            "",
            "utf.digest",
            " JOIN user_tests AS ut ON ut.task_id = t.id \
             JOIN user_test_files AS utf ON utf.user_test_id = ut.id",
        ));
        branches.push(branch(
            contest,
            "",
            "utm.digest",
            " JOIN user_tests AS ut ON ut.task_id = t.id \
             JOIN user_test_managers AS utm ON utm.user_test_id = ut.id",
        ));
        if !skips.generated {
            branches.push(branch(
                contest,
                "",
                "ute.digest",
                " JOIN user_tests AS ut ON ut.task_id = t.id \
                 JOIN user_test_results AS utr ON utr.user_test_id = ut.id \
                 JOIN user_test_executables AS ute ON ute.user_test_id = utr.user_test_id \
                     AND ute.dataset_id = utr.dataset_id",
            ));
            branches.push(branch(
                contest,
                "utr.output IS NOT NULL",
                "utr.output",
                " JOIN user_tests AS ut ON ut.task_id = t.id \
                 JOIN user_test_results AS utr ON utr.user_test_id = ut.id",
            ));
        }
    }

    branches.join(" UNION ")
}

/// One `SELECT`, its joins, and the predicates that narrow it.
fn branch(contest: bool, predicate: &str, select: &str, joins: &str) -> String {
    let mut sql = format!("SELECT {select}{TASK_SCOPE}{joins}");
    let mut predicates = Vec::new();
    if contest {
        predicates.push("c.id = $1");
    }
    if !predicate.is_empty() {
        predicates.push(predicate);
    }
    if !predicates.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&predicates.join(" AND "));
    }
    sql
}

#[cfg(test)]
mod tests {
    use super::*;

    /// How many `UNION` branches a walk asks for.
    fn branches(contest: bool, skips: FileSkips) -> usize {
        statement(contest, skips).matches("SELECT ").count()
    }

    #[test]
    fn a_full_walk_reads_every_digest_bearing_table() {
        assert_eq!(branches(false, FileSkips::default()), 12);
    }

    #[test]
    fn skipping_users_drops_both_the_submission_and_the_user_test_half() {
        let skips = FileSkips {
            users: true,
            ..FileSkips::default()
        };

        assert_eq!(branches(false, skips), 5);
    }

    #[test]
    fn each_half_is_skipped_on_its_own() {
        let submissions = FileSkips {
            submissions: true,
            ..FileSkips::default()
        };
        let user_tests = FileSkips {
            user_tests: true,
            ..FileSkips::default()
        };

        assert_eq!(branches(false, submissions), 10);
        assert_eq!(branches(false, user_tests), 7);
    }

    #[test]
    fn generated_digests_are_three_branches_of_their_own() {
        let skips = FileSkips {
            generated: true,
            ..FileSkips::default()
        };
        let both_halves = FileSkips {
            submissions: true,
            user_tests: true,
            generated: true,
            ..FileSkips::default()
        };

        assert_eq!(branches(false, skips), 9);
        assert_eq!(branches(false, both_halves), 5);
    }

    #[test]
    fn a_contest_scope_narrows_every_branch_by_its_id() {
        let sql = statement(true, FileSkips::default());

        assert_eq!(sql.matches("c.id = $1").count(), 12);
    }

    #[test]
    fn the_user_test_output_branch_keeps_only_the_rows_that_wrote_one() {
        let sql = statement(false, FileSkips::default());

        assert_eq!(sql.matches("utr.output IS NOT NULL").count(), 1);
    }
}
