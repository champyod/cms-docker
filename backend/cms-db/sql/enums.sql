CREATE TYPE public.compilation_outcome AS ENUM (
    'ok',
    'fail'
);

CREATE TYPE public.evaluation_outcome AS ENUM (
    'ok'
);

CREATE TYPE public.feedback_level AS ENUM (
    'full',
    'restricted',
    'oi_restricted'
);

CREATE TYPE public.question_resolution_kind AS ENUM (
    'clarification_needed',
    'settled_by_statement'
);

CREATE TYPE public.score_mode AS ENUM (
    'max_tokened_last',
    'max',
    'max_subtask'
);

CREATE TYPE public.token_mode AS ENUM (
    'disabled',
    'finite',
    'infinite'
);

CREATE TYPE public.username_policy AS ENUM (
    'allow',
    'deny'
);

CREATE TYPE public.username_policy_scope AS ENUM (
    'contest',
    'user',
    'group'
);
