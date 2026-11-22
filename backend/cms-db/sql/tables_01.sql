CREATE TABLE public.admins (
    id integer NOT NULL,
    name character varying NOT NULL,
    username public.codename NOT NULL,
    authentication character varying NOT NULL,
    enabled boolean NOT NULL
);

CREATE TABLE public.announcements (
    id integer NOT NULL,
    "timestamp" timestamp without time zone NOT NULL,
    subject character varying NOT NULL,
    text character varying NOT NULL,
    contest_id integer NOT NULL,
    admin_id integer
);

CREATE TABLE public.attachments (
    id integer NOT NULL,
    task_id integer NOT NULL,
    filename public.filename NOT NULL,
    digest public.digest NOT NULL
);

CREATE TABLE public.contest_tasks (
    contest_id integer NOT NULL,
    task_id integer NOT NULL,
    num integer
);

CREATE TABLE public.contests (
    id integer NOT NULL,
    name public.codename NOT NULL,
    description character varying NOT NULL,
    allowed_localizations character varying[] NOT NULL,
    languages character varying[] NOT NULL,
    submissions_download_allowed boolean NOT NULL,
    allow_questions boolean NOT NULL,
    allow_user_tests boolean NOT NULL,
    allow_unofficial_submission_before_analysis_mode boolean NOT NULL,
    block_hidden_participations boolean NOT NULL,
    allow_password_authentication boolean NOT NULL,
    allow_registration boolean NOT NULL,
    ip_restriction boolean NOT NULL,
    ip_autologin boolean NOT NULL,
    token_mode public.token_mode NOT NULL,
    token_max_number integer,
    token_min_interval interval NOT NULL,
    token_gen_initial integer NOT NULL,
    token_gen_number integer NOT NULL,
    token_gen_interval interval NOT NULL,
    token_gen_max integer,
    start timestamp without time zone NOT NULL,
    stop timestamp without time zone NOT NULL,
    analysis_enabled boolean NOT NULL,
    analysis_start timestamp without time zone NOT NULL,
    analysis_stop timestamp without time zone NOT NULL,
    timezone character varying,
    per_user_time interval,
    max_submission_number integer,
    max_user_test_number integer,
    min_submission_interval interval,
    min_submission_interval_grace_period interval,
    min_user_test_interval interval,
    evaluation_throttle_delay_s integer NOT NULL,
    evaluation_throttle_window_s integer NOT NULL,
    evaluation_throttle_max integer NOT NULL,
    evaluation_final_open boolean NOT NULL,
    evaluation_final_open_at timestamp without time zone,
    queue_fairness_penalty_seconds integer NOT NULL,
    score_precision integer NOT NULL,
    is_active boolean NOT NULL,
    CONSTRAINT contests_check CHECK ((start <= stop)),
    CONSTRAINT contests_check1 CHECK ((stop <= analysis_start)),
    CONSTRAINT contests_check2 CHECK ((analysis_start <= analysis_stop)),
    CONSTRAINT contests_check3 CHECK ((token_gen_initial <= token_gen_max)),
    CONSTRAINT contests_evaluation_throttle_delay_s_check CHECK ((evaluation_throttle_delay_s >= 0)),
    CONSTRAINT contests_evaluation_throttle_max_check CHECK ((evaluation_throttle_max >= 0)),
    CONSTRAINT contests_evaluation_throttle_window_s_check CHECK ((evaluation_throttle_window_s >= 0)),
    CONSTRAINT contests_max_submission_number_check CHECK ((max_submission_number > 0)),
    CONSTRAINT contests_max_user_test_number_check CHECK ((max_user_test_number > 0)),
    CONSTRAINT contests_min_submission_interval_check CHECK ((min_submission_interval > '00:00:00'::interval)),
    CONSTRAINT contests_min_submission_interval_grace_period_check CHECK ((min_submission_interval_grace_period > '00:00:00'::interval)),
    CONSTRAINT contests_min_user_test_interval_check CHECK ((min_user_test_interval > '00:00:00'::interval)),
    CONSTRAINT contests_per_user_time_check CHECK ((per_user_time >= '00:00:00'::interval)),
    CONSTRAINT contests_queue_fairness_penalty_seconds_check CHECK ((queue_fairness_penalty_seconds >= 0)),
    CONSTRAINT contests_score_precision_check CHECK ((score_precision >= 0)),
    CONSTRAINT contests_token_gen_initial_check CHECK ((token_gen_initial >= 0)),
    CONSTRAINT contests_token_gen_interval_check CHECK ((token_gen_interval > '00:00:00'::interval)),
    CONSTRAINT contests_token_gen_max_check CHECK ((token_gen_max > 0)),
    CONSTRAINT contests_token_gen_number_check CHECK ((token_gen_number >= 0)),
    CONSTRAINT contests_token_max_number_check CHECK ((token_max_number > 0)),
    CONSTRAINT contests_token_min_interval_check CHECK ((token_min_interval >= '00:00:00'::interval))
);

CREATE TABLE public.datasets (
    id integer NOT NULL,
    task_id integer NOT NULL,
    description character varying NOT NULL,
    autojudge boolean NOT NULL,
    time_limit double precision,
    memory_limit bigint,
    task_type character varying NOT NULL,
    task_type_parameters jsonb NOT NULL,
    score_type character varying NOT NULL,
    score_type_parameters jsonb NOT NULL,
    CONSTRAINT datasets_memory_limit_check CHECK ((memory_limit > 0)),
    CONSTRAINT datasets_memory_limit_check1 CHECK ((mod(memory_limit, (1048576)::bigint) = 0)),
    CONSTRAINT datasets_time_limit_check CHECK ((time_limit > (0)::double precision))
);

CREATE TABLE public.evaluations (
    id integer NOT NULL,
    submission_id integer NOT NULL,
    dataset_id integer NOT NULL,
    testcase_id integer NOT NULL,
    outcome character varying,
    text character varying[] NOT NULL,
    admin_text character varying,
    execution_time double precision,
    execution_wall_clock_time double precision,
    execution_memory bigint,
    evaluation_shard integer,
    evaluation_sandbox_paths character varying[],
    evaluation_sandbox_digests character varying[]
);
