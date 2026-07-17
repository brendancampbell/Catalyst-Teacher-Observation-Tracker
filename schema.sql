--
-- PostgreSQL database dump
--

\restrict Bgdqwrecd0LE20sunDeVOAncPfX0CEtsC6EfvmlyjMLKpD4jG2BykfzHLYobQsF

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: department_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.department_enum AS ENUM (
    'English',
    'Math',
    'Science',
    'History',
    'Spanish',
    'Physical Education',
    'Comp Sci/Engineering',
    'Visual Arts',
    'College',
    'Other'
);


ALTER TYPE public.department_enum OWNER TO postgres;

--
-- Name: evaluation_target; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.evaluation_target AS ENUM (
    'TEACHER',
    'SCHOOL'
);


ALTER TYPE public.evaluation_target OWNER TO postgres;

--
-- Name: person_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.person_role AS ENUM (
    'COACH',
    'SCHOOL_LEADER',
    'NETWORK_LEADER',
    'NETWORK_ADMIN',
    'NO_ACCESS'
);


ALTER TYPE public.person_role OWNER TO postgres;

--
-- Name: subject_audience; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.subject_audience AS ENUM (
    'STEM',
    'HUMANITIES',
    'ALL'
);


ALTER TYPE public.subject_audience OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: action_steps; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.action_steps (
    id integer NOT NULL,
    teacher_employee_id text NOT NULL,
    assigned_by_employee_id text,
    assigned_during_observation_id integer,
    text text NOT NULL,
    due_date date NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    mastered_at timestamp with time zone,
    mastered_by_employee_id text,
    mastered_during_observation_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.action_steps OWNER TO postgres;

--
-- Name: action_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.action_steps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.action_steps_id_seq OWNER TO postgres;

--
-- Name: action_steps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.action_steps_id_seq OWNED BY public.action_steps.id;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    session_id integer NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rubric_set_slug text,
    instant_analysis_structured jsonb
);


ALTER TABLE public.chat_messages OWNER TO postgres;

--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_messages_id_seq OWNER TO postgres;

--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_sessions (
    id integer NOT NULL,
    employee_id text NOT NULL,
    title text DEFAULT 'New Chat'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.chat_sessions OWNER TO postgres;

--
-- Name: chat_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_sessions_id_seq OWNER TO postgres;

--
-- Name: chat_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_sessions_id_seq OWNED BY public.chat_sessions.id;


--
-- Name: observation_scores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.observation_scores (
    id integer NOT NULL,
    observation_id integer NOT NULL,
    domain_slug text NOT NULL,
    score real NOT NULL
);


ALTER TABLE public.observation_scores OWNER TO postgres;

--
-- Name: observation_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.observation_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.observation_scores_id_seq OWNER TO postgres;

--
-- Name: observation_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.observation_scores_id_seq OWNED BY public.observation_scores.id;


--
-- Name: observations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.observations (
    id integer NOT NULL,
    rubric_set_id integer NOT NULL,
    date date NOT NULL,
    strengths text,
    growth_areas text,
    observer text DEFAULT 'Principal Rivera'::text NOT NULL,
    is_walkthrough boolean DEFAULT false NOT NULL,
    edited_at timestamp with time zone,
    "time" text,
    course text,
    status text DEFAULT 'published'::text NOT NULL,
    school_id integer,
    target public.evaluation_target DEFAULT 'TEACHER'::public.evaluation_target NOT NULL,
    observed_employee_id text,
    observer_employee_id text,
    edited_by_employee_id text,
    observer_email text
);


ALTER TABLE public.observations OWNER TO postgres;

--
-- Name: observations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.observations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.observations_id_seq OWNER TO postgres;

--
-- Name: observations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.observations_id_seq OWNED BY public.observations.id;


--
-- Name: people; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.people (
    employee_id text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    google_id text,
    role public.person_role DEFAULT 'NO_ACCESS'::public.person_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    include_in_feedback_tracker boolean DEFAULT false NOT NULL,
    school_id integer,
    department public.department_enum,
    grade_level text[],
    needs_rescore boolean DEFAULT false NOT NULL,
    rescore_due_date date
);


ALTER TABLE public.people OWNER TO postgres;

--
-- Name: qualitative_themes_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qualitative_themes_cache (
    id integer NOT NULL,
    school_id integer NOT NULL,
    rubric_slug text NOT NULL,
    result jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    obs_count_at_generation integer NOT NULL
);


ALTER TABLE public.qualitative_themes_cache OWNER TO postgres;

--
-- Name: qualitative_themes_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.qualitative_themes_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.qualitative_themes_cache_id_seq OWNER TO postgres;

--
-- Name: qualitative_themes_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.qualitative_themes_cache_id_seq OWNED BY public.qualitative_themes_cache.id;


--
-- Name: rubric_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rubric_categories (
    id integer NOT NULL,
    rubric_set_id integer NOT NULL,
    name text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.rubric_categories OWNER TO postgres;

--
-- Name: rubric_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rubric_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rubric_categories_id_seq OWNER TO postgres;

--
-- Name: rubric_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rubric_categories_id_seq OWNED BY public.rubric_categories.id;


--
-- Name: rubric_domains; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rubric_domains (
    id integer NOT NULL,
    category_id integer NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    description text,
    rubric_set_id integer NOT NULL
);


ALTER TABLE public.rubric_domains OWNER TO postgres;

--
-- Name: rubric_domains_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rubric_domains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rubric_domains_id_seq OWNER TO postgres;

--
-- Name: rubric_domains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rubric_domains_id_seq OWNED BY public.rubric_domains.id;


--
-- Name: rubric_sets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rubric_sets (
    id integer NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    grade_span text,
    description text,
    display_order integer DEFAULT 0 NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    target public.evaluation_target DEFAULT 'TEACHER'::public.evaluation_target NOT NULL,
    subject_audience public.subject_audience DEFAULT 'ALL'::public.subject_audience NOT NULL
);


ALTER TABLE public.rubric_sets OWNER TO postgres;

--
-- Name: rubric_quarters_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rubric_quarters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rubric_quarters_id_seq OWNER TO postgres;

--
-- Name: rubric_quarters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rubric_quarters_id_seq OWNED BY public.rubric_sets.id;


--
-- Name: schools; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schools (
    id integer NOT NULL,
    display_name text NOT NULL,
    region text NOT NULL,
    grade_span text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    full_name text NOT NULL,
    abbreviation text NOT NULL,
    is_home_office boolean DEFAULT false NOT NULL
);


ALTER TABLE public.schools OWNER TO postgres;

--
-- Name: schools_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.schools_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.schools_id_seq OWNER TO postgres;

--
-- Name: schools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.schools_id_seq OWNED BY public.schools.id;


--
-- Name: session; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


ALTER TABLE public.session OWNER TO postgres;

--
-- Name: action_steps id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.action_steps ALTER COLUMN id SET DEFAULT nextval('public.action_steps_id_seq'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: chat_sessions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_sessions ALTER COLUMN id SET DEFAULT nextval('public.chat_sessions_id_seq'::regclass);


--
-- Name: observation_scores id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.observation_scores ALTER COLUMN id SET DEFAULT nextval('public.observation_scores_id_seq'::regclass);


--
-- Name: observations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.observations ALTER COLUMN id SET DEFAULT nextval('public.observations_id_seq'::regclass);


--
-- Name: qualitative_themes_cache id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qualitative_themes_cache ALTER COLUMN id SET DEFAULT nextval('public.qualitative_themes_cache_id_seq'::regclass);


--
-- Name: rubric_categories id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_categories ALTER COLUMN id SET DEFAULT nextval('public.rubric_categories_id_seq'::regclass);


--
-- Name: rubric_domains id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_domains ALTER COLUMN id SET DEFAULT nextval('public.rubric_domains_id_seq'::regclass);


--
-- Name: rubric_sets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_sets ALTER COLUMN id SET DEFAULT nextval('public.rubric_quarters_id_seq'::regclass);


--
-- Name: schools id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schools ALTER COLUMN id SET DEFAULT nextval('public.schools_id_seq'::regclass);


--
-- Name: action_steps action_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.action_steps
    ADD CONSTRAINT action_steps_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: observation_scores observation_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.observation_scores
    ADD CONSTRAINT observation_scores_pkey PRIMARY KEY (id);


--
-- Name: observations observations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_pkey PRIMARY KEY (id);


--
-- Name: people people_email_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_email_unique UNIQUE (email);


--
-- Name: people people_google_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_google_id_unique UNIQUE (google_id);


--
-- Name: people people_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_pkey PRIMARY KEY (employee_id);


--
-- Name: qualitative_themes_cache qualitative_themes_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qualitative_themes_cache
    ADD CONSTRAINT qualitative_themes_cache_pkey PRIMARY KEY (id);


--
-- Name: rubric_categories rubric_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_categories
    ADD CONSTRAINT rubric_categories_pkey PRIMARY KEY (id);


--
-- Name: rubric_domains rubric_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_domains
    ADD CONSTRAINT rubric_domains_pkey PRIMARY KEY (id);


--
-- Name: rubric_sets rubric_quarters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_sets
    ADD CONSTRAINT rubric_quarters_pkey PRIMARY KEY (id);


--
-- Name: rubric_sets rubric_sets_slug_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_sets
    ADD CONSTRAINT rubric_sets_slug_unique UNIQUE (slug);


--
-- Name: schools schools_abbreviation_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_abbreviation_unique UNIQUE (abbreviation);


--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire);


--
-- Name: chat_messages_session_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX chat_messages_session_id_idx ON public.chat_messages USING btree (session_id);


--
-- Name: chat_sessions_employee_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX chat_sessions_employee_id_idx ON public.chat_sessions USING btree (employee_id);


--
-- Name: chat_sessions_updated_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX chat_sessions_updated_at_idx ON public.chat_sessions USING btree (updated_at DESC);


--
-- Name: qt_cache_school_rubric_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX qt_cache_school_rubric_idx ON public.qualitative_themes_cache USING btree (school_id, rubric_slug);


--
-- Name: rubric_domains_set_slug_uniq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX rubric_domains_set_slug_uniq ON public.rubric_domains USING btree (rubric_set_id, slug);


--
-- Name: action_steps action_steps_assigned_by_employee_id_people_employee_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.action_steps
    ADD CONSTRAINT action_steps_assigned_by_employee_id_people_employee_id_fk FOREIGN KEY (assigned_by_employee_id) REFERENCES public.people(employee_id) ON DELETE SET NULL;


--
-- Name: action_steps action_steps_assigned_during_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.action_steps
    ADD CONSTRAINT action_steps_assigned_during_observation_id_observations_id_fk FOREIGN KEY (assigned_during_observation_id) REFERENCES public.observations(id) ON DELETE SET NULL;


--
-- Name: action_steps action_steps_mastered_by_employee_id_people_employee_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.action_steps
    ADD CONSTRAINT action_steps_mastered_by_employee_id_people_employee_id_fk FOREIGN KEY (mastered_by_employee_id) REFERENCES public.people(employee_id) ON DELETE SET NULL;


--
-- Name: action_steps action_steps_mastered_during_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.action_steps
    ADD CONSTRAINT action_steps_mastered_during_observation_id_observations_id_fk FOREIGN KEY (mastered_during_observation_id) REFERENCES public.observations(id) ON DELETE SET NULL;


--
-- Name: action_steps action_steps_teacher_employee_id_people_employee_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.action_steps
    ADD CONSTRAINT action_steps_teacher_employee_id_people_employee_id_fk FOREIGN KEY (teacher_employee_id) REFERENCES public.people(employee_id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_session_id_chat_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_session_id_chat_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: chat_sessions chat_sessions_employee_id_people_employee_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_employee_id_people_employee_id_fk FOREIGN KEY (employee_id) REFERENCES public.people(employee_id) ON DELETE CASCADE;


--
-- Name: observation_scores observation_scores_observation_id_observations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.observation_scores
    ADD CONSTRAINT observation_scores_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE CASCADE;


--
-- Name: observations observations_edited_by_employee_id_people_employee_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_edited_by_employee_id_people_employee_id_fk FOREIGN KEY (edited_by_employee_id) REFERENCES public.people(employee_id) ON DELETE SET NULL;


--
-- Name: observations observations_observed_employee_id_people_employee_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_observed_employee_id_people_employee_id_fk FOREIGN KEY (observed_employee_id) REFERENCES public.people(employee_id) ON DELETE SET NULL;


--
-- Name: observations observations_observer_employee_id_people_employee_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_observer_employee_id_people_employee_id_fk FOREIGN KEY (observer_employee_id) REFERENCES public.people(employee_id) ON DELETE SET NULL;


--
-- Name: observations observations_rubric_set_id_rubric_sets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_rubric_set_id_rubric_sets_id_fk FOREIGN KEY (rubric_set_id) REFERENCES public.rubric_sets(id) ON DELETE CASCADE;


--
-- Name: observations observations_school_id_schools_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: people people_school_id_schools_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE SET NULL;


--
-- Name: qualitative_themes_cache qualitative_themes_cache_school_id_schools_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qualitative_themes_cache
    ADD CONSTRAINT qualitative_themes_cache_school_id_schools_id_fk FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: rubric_categories rubric_categories_rubric_set_id_rubric_sets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_categories
    ADD CONSTRAINT rubric_categories_rubric_set_id_rubric_sets_id_fk FOREIGN KEY (rubric_set_id) REFERENCES public.rubric_sets(id) ON DELETE CASCADE;


--
-- Name: rubric_domains rubric_domains_category_id_rubric_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_domains
    ADD CONSTRAINT rubric_domains_category_id_rubric_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.rubric_categories(id) ON DELETE CASCADE;


--
-- Name: rubric_domains rubric_domains_rubric_set_id_rubric_sets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_domains
    ADD CONSTRAINT rubric_domains_rubric_set_id_rubric_sets_id_fk FOREIGN KEY (rubric_set_id) REFERENCES public.rubric_sets(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict Bgdqwrecd0LE20sunDeVOAncPfX0CEtsC6EfvmlyjMLKpD4jG2BykfzHLYobQsF

