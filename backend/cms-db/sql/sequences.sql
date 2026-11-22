CREATE SEQUENCE public.admins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.announcements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.contests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.datasets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.evaluations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.executables_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.managers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.participations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.questions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.statements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.testcases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.user_test_executables_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.user_test_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.user_test_managers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.user_tests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.admins_id_seq OWNED BY public.admins.id;

ALTER SEQUENCE public.announcements_id_seq OWNED BY public.announcements.id;

ALTER SEQUENCE public.attachments_id_seq OWNED BY public.attachments.id;

ALTER SEQUENCE public.contests_id_seq OWNED BY public.contests.id;

ALTER SEQUENCE public.datasets_id_seq OWNED BY public.datasets.id;

ALTER SEQUENCE public.evaluations_id_seq OWNED BY public.evaluations.id;

ALTER SEQUENCE public.executables_id_seq OWNED BY public.executables.id;

ALTER SEQUENCE public.files_id_seq OWNED BY public.files.id;

ALTER SEQUENCE public.managers_id_seq OWNED BY public.managers.id;

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;

ALTER SEQUENCE public.participations_id_seq OWNED BY public.participations.id;

ALTER SEQUENCE public.questions_id_seq OWNED BY public.questions.id;

ALTER SEQUENCE public.statements_id_seq OWNED BY public.statements.id;

ALTER SEQUENCE public.submissions_id_seq OWNED BY public.submissions.id;

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;

ALTER SEQUENCE public.testcases_id_seq OWNED BY public.testcases.id;

ALTER SEQUENCE public.tokens_id_seq OWNED BY public.tokens.id;

ALTER SEQUENCE public.user_test_executables_id_seq OWNED BY public.user_test_executables.id;

ALTER SEQUENCE public.user_test_files_id_seq OWNED BY public.user_test_files.id;

ALTER SEQUENCE public.user_test_managers_id_seq OWNED BY public.user_test_managers.id;

ALTER SEQUENCE public.user_tests_id_seq OWNED BY public.user_tests.id;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;
