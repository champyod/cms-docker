CREATE TABLE public.executables (
    id integer NOT NULL,
    submission_id integer NOT NULL,
    dataset_id integer NOT NULL,
    filename public.filename NOT NULL,
    digest public.digest NOT NULL
);

CREATE TABLE public.files (
    id integer NOT NULL,
    submission_id integer NOT NULL,
    filename public.filename_schema NOT NULL,
    digest public.digest NOT NULL
);

CREATE TABLE public.fsobjects (
    digest character varying NOT NULL,
    loid oid NOT NULL,
    description character varying
);

CREATE TABLE public.managers (
    id integer NOT NULL,
    dataset_id integer NOT NULL,
    filename public.filename NOT NULL,
    digest public.digest NOT NULL
);

CREATE TABLE public.messages (
    id integer NOT NULL,
    "timestamp" timestamp without time zone NOT NULL,
    subject character varying NOT NULL,
    text character varying NOT NULL,
    participation_id integer NOT NULL,
    admin_id integer
);

CREATE TABLE public.participations (
    id integer NOT NULL,
    ip cidr[],
    starting_time timestamp without time zone,
    delay_time interval NOT NULL,
    extra_time interval NOT NULL,
    password character varying,
    hidden boolean NOT NULL,
    unrestricted boolean NOT NULL,
    contest_id integer NOT NULL,
    user_id integer NOT NULL,
    team_id integer,
    CONSTRAINT participations_delay_time_check CHECK ((delay_time >= '00:00:00'::interval)),
    CONSTRAINT participations_extra_time_check CHECK ((extra_time >= '00:00:00'::interval))
);

CREATE TABLE public.questions (
    id integer NOT NULL,
    question_timestamp timestamp without time zone NOT NULL,
    subject character varying NOT NULL,
    text character varying NOT NULL,
    reply_timestamp timestamp without time zone,
    ignored boolean NOT NULL,
    reply_subject character varying,
    reply_text character varying,
    resolution_kind public.question_resolution_kind,
    participation_id integer NOT NULL,
    admin_id integer
);
