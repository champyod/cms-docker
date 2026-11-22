CREATE INDEX ix_announcements_admin_id ON public.announcements USING btree (admin_id);

CREATE INDEX ix_announcements_contest_id ON public.announcements USING btree (contest_id);

CREATE INDEX ix_attachments_task_id ON public.attachments USING btree (task_id);

CREATE INDEX ix_contest_tasks_task_id ON public.contest_tasks USING btree (task_id);

CREATE INDEX ix_evaluations_dataset_id ON public.evaluations USING btree (dataset_id);

CREATE INDEX ix_evaluations_submission_id ON public.evaluations USING btree (submission_id);

CREATE INDEX ix_evaluations_testcase_id ON public.evaluations USING btree (testcase_id);

CREATE INDEX ix_executables_dataset_id ON public.executables USING btree (dataset_id);

CREATE INDEX ix_executables_submission_id ON public.executables USING btree (submission_id);

CREATE INDEX ix_files_submission_id ON public.files USING btree (submission_id);

CREATE INDEX ix_managers_dataset_id ON public.managers USING btree (dataset_id);

CREATE INDEX ix_messages_admin_id ON public.messages USING btree (admin_id);

CREATE INDEX ix_messages_participation_id ON public.messages USING btree (participation_id);

CREATE INDEX ix_participations_contest_id ON public.participations USING btree (contest_id);

CREATE INDEX ix_participations_user_id ON public.participations USING btree (user_id);

CREATE INDEX ix_questions_admin_id ON public.questions USING btree (admin_id);

CREATE INDEX ix_questions_participation_id ON public.questions USING btree (participation_id);

CREATE INDEX ix_statements_task_id ON public.statements USING btree (task_id);

CREATE INDEX ix_submissions_participation_id ON public.submissions USING btree (participation_id);

CREATE INDEX ix_submissions_task_id ON public.submissions USING btree (task_id);

CREATE INDEX ix_testcases_dataset_id ON public.testcases USING btree (dataset_id);

CREATE INDEX ix_tokens_submission_id ON public.tokens USING btree (submission_id);

CREATE INDEX ix_user_test_executables_dataset_id ON public.user_test_executables USING btree (dataset_id);

CREATE INDEX ix_user_test_executables_user_test_id ON public.user_test_executables USING btree (user_test_id);

CREATE INDEX ix_user_test_files_user_test_id ON public.user_test_files USING btree (user_test_id);

CREATE INDEX ix_user_test_managers_user_test_id ON public.user_test_managers USING btree (user_test_id);

CREATE INDEX ix_user_tests_participation_id ON public.user_tests USING btree (participation_id);

CREATE INDEX ix_user_tests_task_id ON public.user_tests USING btree (task_id);
