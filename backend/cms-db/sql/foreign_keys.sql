ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES public.contests(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.contest_tasks
    ADD CONSTRAINT contest_tasks_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES public.contests(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.contest_tasks
    ADD CONSTRAINT contest_tasks_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT evaluations_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT evaluations_submission_id_dataset_id_fkey FOREIGN KEY (submission_id, dataset_id) REFERENCES public.submission_results(submission_id, dataset_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT evaluations_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT evaluations_testcase_id_fkey FOREIGN KEY (testcase_id) REFERENCES public.testcases(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.executables
    ADD CONSTRAINT executables_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.executables
    ADD CONSTRAINT executables_submission_id_dataset_id_fkey FOREIGN KEY (submission_id, dataset_id) REFERENCES public.submission_results(submission_id, dataset_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.executables
    ADD CONSTRAINT executables_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_active_dataset_id FOREIGN KEY (id, active_dataset_id) REFERENCES public.datasets(task_id, id) ON UPDATE SET NULL ON DELETE SET NULL;

ALTER TABLE ONLY public.managers
    ADD CONSTRAINT managers_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_participation_id_fkey FOREIGN KEY (participation_id) REFERENCES public.participations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.participations
    ADD CONSTRAINT participations_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES public.contests(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.participations
    ADD CONSTRAINT participations_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.participations
    ADD CONSTRAINT participations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_participation_id_fkey FOREIGN KEY (participation_id) REFERENCES public.participations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.statements
    ADD CONSTRAINT statements_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.submission_results
    ADD CONSTRAINT submission_results_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.submission_results
    ADD CONSTRAINT submission_results_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_participation_id_fkey FOREIGN KEY (participation_id) REFERENCES public.participations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.testcases
    ADD CONSTRAINT testcases_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_test_executables
    ADD CONSTRAINT user_test_executables_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_test_executables
    ADD CONSTRAINT user_test_executables_user_test_id_dataset_id_fkey FOREIGN KEY (user_test_id, dataset_id) REFERENCES public.user_test_results(user_test_id, dataset_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_test_executables
    ADD CONSTRAINT user_test_executables_user_test_id_fkey FOREIGN KEY (user_test_id) REFERENCES public.user_tests(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_test_files
    ADD CONSTRAINT user_test_files_user_test_id_fkey FOREIGN KEY (user_test_id) REFERENCES public.user_tests(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_test_managers
    ADD CONSTRAINT user_test_managers_user_test_id_fkey FOREIGN KEY (user_test_id) REFERENCES public.user_tests(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_test_results
    ADD CONSTRAINT user_test_results_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_test_results
    ADD CONSTRAINT user_test_results_user_test_id_fkey FOREIGN KEY (user_test_id) REFERENCES public.user_tests(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_tests
    ADD CONSTRAINT user_tests_participation_id_fkey FOREIGN KEY (participation_id) REFERENCES public.participations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_tests
    ADD CONSTRAINT user_tests_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;
