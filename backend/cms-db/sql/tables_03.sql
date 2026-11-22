CREATE TABLE public.statements (
    id integer NOT NULL,
    task_id integer NOT NULL,
    language character varying NOT NULL,
    digest public.digest NOT NULL
);

CREATE TABLE public.submission_results (
    submission_id integer NOT NULL,
    dataset_id integer NOT NULL,
    compilation_outcome public.compilation_outcome,
    compilation_text character varying[] NOT NULL,
    compilation_tries integer NOT NULL,
    compilation_stdout character varying,
    compilation_stderr character varying,
    compilation_time double precision,
    compilation_wall_clock_time double precision,
    compilation_memory bigint,
    compilation_shard integer,
    compilation_sandbox_paths character varying[],
    compilation_sandbox_digests character varying[],
    evaluation_outcome public.evaluation_outcome,
    evaluation_tries integer NOT NULL,
    score double precision,
    score_details jsonb,
    scored_at timestamp without time zone,
    public_score double precision,
    public_score_details jsonb,
    ranking_score_details character varying[]
);

CREATE TABLE public.submissions (
    opaque_id bigint NOT NULL,
    id integer NOT NULL,
    participation_id integer NOT NULL,
    task_id integer NOT NULL,
    "timestamp" timestamp without time zone NOT NULL,
    language character varying,
    comment character varying NOT NULL,
    official boolean NOT NULL
);

CREATE TABLE public.tasks (
    id integer NOT NULL,
    name public.codename NOT NULL,
    title character varying NOT NULL,
    submission_format public.filename_schema_array NOT NULL,
    primary_statements character varying[] NOT NULL,
    allowed_languages character varying[],
    token_mode public.token_mode NOT NULL,
    token_max_number integer,
    token_min_interval interval NOT NULL,
    token_gen_initial integer NOT NULL,
    token_gen_number integer NOT NULL,
    token_gen_interval interval NOT NULL,
    token_gen_max integer,
    max_submission_number integer,
    max_user_test_number integer,
    min_submission_interval interval,
    min_user_test_interval interval,
    evaluation_throttle_delay_s integer,
    feedback_level public.feedback_level NOT NULL,
    score_precision integer NOT NULL,
    score_mode public.score_mode NOT NULL,
    active_dataset_id integer,
    CONSTRAINT tasks_check CHECK ((token_gen_initial <= token_gen_max)),
    CONSTRAINT tasks_evaluation_throttle_delay_s_check CHECK ((evaluation_throttle_delay_s >= 0)),
    CONSTRAINT tasks_max_submission_number_check CHECK ((max_submission_number > 0)),
    CONSTRAINT tasks_max_user_test_number_check CHECK ((max_user_test_number > 0)),
    CONSTRAINT tasks_min_submission_interval_check CHECK ((min_submission_interval > '00:00:00'::interval)),
    CONSTRAINT tasks_min_user_test_interval_check CHECK ((min_user_test_interval > '00:00:00'::interval)),
    CONSTRAINT tasks_score_precision_check CHECK ((score_precision >= 0)),
    CONSTRAINT tasks_token_gen_initial_check CHECK ((token_gen_initial >= 0)),
    CONSTRAINT tasks_token_gen_interval_check CHECK ((token_gen_interval > '00:00:00'::interval)),
    CONSTRAINT tasks_token_gen_max_check CHECK ((token_gen_max > 0)),
    CONSTRAINT tasks_token_gen_number_check CHECK ((token_gen_number >= 0)),
    CONSTRAINT tasks_token_max_number_check CHECK ((token_max_number > 0)),
    CONSTRAINT tasks_token_min_interval_check CHECK ((token_min_interval >= '00:00:00'::interval))
);

CREATE TABLE public.teams (
    id integer NOT NULL,
    code public.codename NOT NULL,
    name character varying NOT NULL,
    registerable boolean NOT NULL
);

CREATE TABLE public.testcases (
    id integer NOT NULL,
    dataset_id integer NOT NULL,
    codename public.codename NOT NULL,
    public boolean NOT NULL,
    input public.digest NOT NULL,
    output public.digest NOT NULL
);

CREATE TABLE public.tokens (
    id integer NOT NULL,
    submission_id integer NOT NULL,
    "timestamp" timestamp without time zone NOT NULL
);
