CREATE TABLE public.user_test_executables (
    id integer NOT NULL,
    user_test_id integer NOT NULL,
    dataset_id integer NOT NULL,
    filename public.filename NOT NULL,
    digest public.digest NOT NULL
);

CREATE TABLE public.user_test_files (
    id integer NOT NULL,
    user_test_id integer NOT NULL,
    filename public.filename_schema NOT NULL,
    digest public.digest NOT NULL
);

CREATE TABLE public.user_test_managers (
    id integer NOT NULL,
    user_test_id integer NOT NULL,
    filename public.filename NOT NULL,
    digest public.digest NOT NULL
);

CREATE TABLE public.user_test_results (
    user_test_id integer NOT NULL,
    dataset_id integer NOT NULL,
    output public.digest,
    compilation_outcome character varying,
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
    evaluation_outcome character varying,
    evaluation_text character varying[] NOT NULL,
    evaluation_tries integer NOT NULL,
    execution_time double precision,
    execution_wall_clock_time double precision,
    execution_memory bigint,
    evaluation_shard integer,
    evaluation_sandbox_paths character varying[],
    evaluation_sandbox_digests character varying[]
);

CREATE TABLE public.user_tests (
    id integer NOT NULL,
    participation_id integer NOT NULL,
    task_id integer NOT NULL,
    "timestamp" timestamp without time zone NOT NULL,
    language character varying,
    input public.digest NOT NULL
);

CREATE TABLE public.users (
    id integer NOT NULL,
    first_name character varying NOT NULL,
    last_name character varying NOT NULL,
    username public.codename NOT NULL,
    password character varying NOT NULL,
    email character varying,
    timezone character varying,
    preferred_languages character varying[] NOT NULL,
    last_login_at timestamp without time zone
);
