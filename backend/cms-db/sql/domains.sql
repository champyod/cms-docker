CREATE DOMAIN public.codename AS character varying
	CONSTRAINT codename_check CHECK (((VALUE)::text ~ '^[A-Za-z0-9_-]+$'::text));

CREATE DOMAIN public.digest AS character varying
	CONSTRAINT digest_check CHECK (((VALUE)::text ~ '^([0-9a-f]{40}|x)$'::text));

CREATE DOMAIN public.filename AS character varying
	CONSTRAINT filename_check CHECK (((VALUE)::text ~ '^[A-Za-z0-9_.-]+$'::text))
	CONSTRAINT filename_check1 CHECK (((VALUE)::text <> '.'::text))
	CONSTRAINT filename_check2 CHECK (((VALUE)::text <> '..'::text));

CREATE DOMAIN public.filename_schema AS character varying
	CONSTRAINT filename_schema_check CHECK (((VALUE)::text ~ '^[A-Za-z0-9_.-]+(.%l)?$'::text))
	CONSTRAINT filename_schema_check1 CHECK (((VALUE)::text <> '.'::text))
	CONSTRAINT filename_schema_check2 CHECK (((VALUE)::text <> '..'::text));

CREATE DOMAIN public.filename_schema_array AS character varying[]
	CONSTRAINT filename_schema_array_check CHECK ((array_to_string(VALUE, ''::text) ~ '^[A-Za-z0-9_.%-]*$'::text))
	CONSTRAINT filename_schema_array_check1 CHECK ((array_to_string(VALUE, ','::text) ~ '^([A-Za-z0-9_.-]+(.%l)?(,|$))*$'::text))
	CONSTRAINT filename_schema_array_check2 CHECK (('.'::text <> ALL ((VALUE)::text[])))
	CONSTRAINT filename_schema_array_check3 CHECK (('..'::text <> ALL ((VALUE)::text[])));
