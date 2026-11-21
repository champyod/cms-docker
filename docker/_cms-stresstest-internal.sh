#!/usr/bin/env bash

dropdb --host=testdb --username=postgres cmsdbfortesting
createdb --host=testdb --username=postgres cmsdbfortesting
cmsInitDB

git clone https://github.com/cms-dev/con_test.git
cd con_test

# These don't play well with the StressTest script
for i in communication communicationtwoways outputonly outputonlycomparator; do
    sed -i "/$i/d" contest.yaml
done

# Take the solution.c, solution.py, etc, files from each task, and rename them
# to taskname.c, taskname.py, etc. This is needed because the StressTest script
# needs the solution name to match the submission format (task name).
mkdir -p stress_sols
for i in batch batch_comparator batch_file batchgrader batchwithoutgen; do
    for j in $(ls -d $i/sol/*); do
        ext=${j##*.}
        cp $j stress_sols/${i%/}.$ext
    done
done

cmsImportUser --all
cmsImportContest --import-tasks .

cd ..

# Start ResourceService
cmsResourceService -a 1 &
sleep 5

# WHY this can fail loudly: passwords are stored bcrypt-hashed, so the harness
# cannot read them back. It needs the contest's plaintext passwords, which are
# not in the database by design. Without the file it exits non-zero instead of
# reporting a passing run that logged in as nobody — mount the fixture and point
# CMS_STRESSTEST_PASSWORDS at it (see StressTest.py --passwords-file).
PASSWORDS_ARG=""
if [ -n "${CMS_STRESSTEST_PASSWORDS:-}" ]; then
  PASSWORDS_ARG="--passwords-file ${CMS_STRESSTEST_PASSWORDS}"
else
  echo "warning: CMS_STRESSTEST_PASSWORDS is unset; the stress test cannot log in" >&2
fi

# shellcheck disable=SC2086 # PASSWORDS_ARG is a deliberately empty-or-one-flag word
python3 cmstestsuite/StressTest.py --contest-id 1 --submissions-path stress_sols/ ${PASSWORDS_ARG}
