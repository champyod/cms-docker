ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_username_key UNIQUE (username);

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_task_id_filename_key UNIQUE (task_id, filename);

ALTER TABLE ONLY public.contest_tasks
    ADD CONSTRAINT contest_tasks_contest_id_num_key UNIQUE (contest_id, num);

ALTER TABLE ONLY public.contest_tasks
    ADD CONSTRAINT contest_tasks_pkey PRIMARY KEY (contest_id, task_id);

ALTER TABLE ONLY public.contests
    ADD CONSTRAINT contests_name_key UNIQUE (name);

ALTER TABLE ONLY public.contests
    ADD CONSTRAINT contests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_id_task_id_key UNIQUE (id, task_id);

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_task_id_description_key UNIQUE (task_id, description);

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT evaluations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT evaluations_submission_id_dataset_id_testcase_id_key UNIQUE (submission_id, dataset_id, testcase_id);

ALTER TABLE ONLY public.executables
    ADD CONSTRAINT executables_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.executables
    ADD CONSTRAINT executables_submission_id_dataset_id_filename_key UNIQUE (submission_id, dataset_id, filename);

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_submission_id_filename_key UNIQUE (submission_id, filename);

ALTER TABLE ONLY public.fsobjects
    ADD CONSTRAINT fsobjects_pkey PRIMARY KEY (digest);

ALTER TABLE ONLY public.managers
    ADD CONSTRAINT managers_dataset_id_filename_key UNIQUE (dataset_id, filename);

ALTER TABLE ONLY public.managers
    ADD CONSTRAINT managers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT participation_opaque_unique UNIQUE (participation_id, opaque_id);

ALTER TABLE ONLY public.participations
    ADD CONSTRAINT participations_contest_id_user_id_key UNIQUE (contest_id, user_id);

ALTER TABLE ONLY public.participations
    ADD CONSTRAINT participations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.statements
    ADD CONSTRAINT statements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.statements
    ADD CONSTRAINT statements_task_id_language_key UNIQUE (task_id, language);

ALTER TABLE ONLY public.submission_results
    ADD CONSTRAINT submission_results_pkey PRIMARY KEY (submission_id, dataset_id);

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_name_key UNIQUE (name);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_code_key UNIQUE (code);

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.testcases
    ADD CONSTRAINT testcases_dataset_id_codename_key UNIQUE (dataset_id, codename);

ALTER TABLE ONLY public.testcases
    ADD CONSTRAINT testcases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_submission_id_key UNIQUE (submission_id);

ALTER TABLE ONLY public.user_test_executables
    ADD CONSTRAINT user_test_executables_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_test_executables
    ADD CONSTRAINT user_test_executables_user_test_id_dataset_id_filename_key UNIQUE (user_test_id, dataset_id, filename);

ALTER TABLE ONLY public.user_test_files
    ADD CONSTRAINT user_test_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_test_files
    ADD CONSTRAINT user_test_files_user_test_id_filename_key UNIQUE (user_test_id, filename);

ALTER TABLE ONLY public.user_test_managers
    ADD CONSTRAINT user_test_managers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_test_managers
    ADD CONSTRAINT user_test_managers_user_test_id_filename_key UNIQUE (user_test_id, filename);

ALTER TABLE ONLY public.user_test_results
    ADD CONSTRAINT user_test_results_pkey PRIMARY KEY (user_test_id, dataset_id);

ALTER TABLE ONLY public.user_tests
    ADD CONSTRAINT user_tests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);
