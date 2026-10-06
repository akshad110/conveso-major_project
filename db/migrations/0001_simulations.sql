-- ===========================================================================
-- 0001_simulations.sql — the four tables the courtroom and the classroom need
-- ===========================================================================
--
-- WHY SUPABASE AND NOT PRISMA
--
-- The integration plan describes these as Prisma models. Converso has no Prisma:
-- it talks to Supabase through @supabase/supabase-js, and every existing table
-- (companions, session_history, bookmarks) was created by hand. Introducing
-- Prisma here would mean a second schema, a second connection pool and a second
-- source of truth for the same rows — which is exactly what the plan's own rule
-- forbids: "Never duplicate authentication or databases."
--
-- So the models are these tables, and the data layer is a server-actions file in
-- the same style as lib/actions/companion.actions.ts.
--
--
-- WHY user_id IS text
--
-- Because Clerk issues ids like user_2abc123XYZ, not UUIDs, and companions.user_id
-- is already text. A uuid column here would make it impossible to join the two.
--
--
-- WHY RLS IS ON WITH NO POLICIES
--
-- lib/supabase.ts says it plainly: "Since we're using Clerk auth, not Supabase
-- auth, RLS doesn't work properly." There is no Supabase JWT to write a policy
-- against, so a policy would either be wrong or be `using (true)`.
--
-- Enabling RLS and writing no policy is the useful half of that: the anon key —
-- the one the browser holds — can read and write nothing in these tables. The
-- service-role key used by createSupabaseAdminClient() bypasses RLS by design,
-- so server code keeps working. Authorisation happens in the server action,
-- where the Clerk user id comes from auth() and never from the request body.
--
-- Run this once in the Supabase SQL editor. It is idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- simulations — the catalogue
-- ---------------------------------------------------------------------------
-- One row per thing a student can enter: a courtroom case, a language room.
-- `configuration` is the asset manifest the heavy app reads on launch: which
-- characters to load, which animation clips each of them is allowed, which
-- exhibits exist. It lives here rather than in the client so a case can be
-- edited without shipping a build.
--
-- It does NOT hold assets. No GLB, no texture, no audio — those are files served
-- by the app that renders them. This column holds names and numbers only.
-- ---------------------------------------------------------------------------
create table if not exists public.simulations (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('courtroom', 'classroom')),
  slug          text not null unique,
  title         text not null,
  description   text,
  difficulty    text not null default 'medium'
                  check (difficulty in ('easy', 'medium', 'hard')),
  -- Which lesson in the LMS launches this. Nullable: a simulation can exist in
  -- the catalogue before any companion points at it.
  companion_id  uuid,
  subject       text,
  -- The case the trial engine should load — `new TrialEngine({ caseId })`. Its
  -- own column rather than a key inside configuration, because the launch route
  -- reads it on every start and jsonb extraction in a hot path is a waste.
  case_id       text,
  configuration jsonb not null default '{}'::jsonb,
  published     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists simulations_kind_idx on public.simulations (kind);
create index if not exists simulations_companion_idx on public.simulations (companion_id);

-- ---------------------------------------------------------------------------
-- simulation_sessions — one attempt
-- ---------------------------------------------------------------------------
-- The session is the unit of trust. A launch token is a two-minute doorway into
-- one of these rows; everything the heavy app is allowed to do, it does by
-- naming this id.
--
-- `launch_jti` is the id of the token that opened it, stored so the token can be
-- spent exactly once: the exchange endpoint sets it on first use and refuses a
-- second token with a different jti. A replayed URL therefore cannot open a
-- second window into the same session.
-- ---------------------------------------------------------------------------
create table if not exists public.simulation_sessions (
  id            uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.simulations (id) on delete cascade,
  user_id       text not null,
  companion_id  uuid,
  -- The seat the student is playing, for a courtroom. Null for a classroom, and
  -- null for a courtroom the student is only watching.
  role          text check (role in ('judge', 'prosecutor', 'defense')),
  status        text not null default 'pending'
                  check (status in ('pending', 'active', 'completed', 'abandoned', 'expired')),
  launch_jti    text,
  launched_at   timestamptz,
  started_at    timestamptz,
  completed_at  timestamptz,
  -- Three hours. A session left open overnight is abandoned, not active, and the
  -- sweep below is what says so.
  expires_at    timestamptz not null default now() + interval '3 hours',
  -- Room for the things a resume needs to know and nothing else does: the turn
  -- the student was on, the camera they left it at. Never authorisation data.
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists simulation_sessions_user_idx
  on public.simulation_sessions (user_id, created_at desc);
create index if not exists simulation_sessions_status_idx
  on public.simulation_sessions (status);
-- Finding the session a token refers to, and proving the token is fresh, is the
-- single hottest lookup in the flow.
create unique index if not exists simulation_sessions_launch_jti_idx
  on public.simulation_sessions (launch_jti) where launch_jti is not null;

-- ---------------------------------------------------------------------------
-- simulation_results — what the attempt was worth
-- ---------------------------------------------------------------------------
-- One row per finished session, hence the unique constraint: a browser that
-- posts its results twice updates the row rather than inflating the history.
--
-- `score` is computed on the server by scoreCourtroom()/scoreClassroom() in
-- @converso/contracts. The number the browser sent is discarded before it gets
-- here — see normalizeCourtroomResult().
-- ---------------------------------------------------------------------------
create table if not exists public.simulation_results (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null unique
                  references public.simulation_sessions (id) on delete cascade,
  user_id       text not null,
  simulation_id uuid not null references public.simulations (id) on delete cascade,
  kind          text not null check (kind in ('courtroom', 'classroom')),
  score         integer not null default 0 check (score between 0 and 100),
  completed     boolean not null default false,
  duration_ms   integer not null default 0 check (duration_ms >= 0),
  -- The per-axis marks and the counts behind them. Shape is versioned by `kind`,
  -- which is why it is one jsonb rather than fifteen columns that only ever
  -- apply to one kind of simulation.
  performance   jsonb not null default '{}'::jsonb,
  -- The transcript, capped at 200 000 characters by the normalizer. Kept because
  -- a student asking "why did I lose that objection" needs to read it back.
  transcript    text,
  created_at    timestamptz not null default now()
);

create index if not exists simulation_results_user_idx
  on public.simulation_results (user_id, created_at desc);
create index if not exists simulation_results_simulation_idx
  on public.simulation_results (simulation_id);

-- ---------------------------------------------------------------------------
-- classroom_sessions — the language room's own detail
-- ---------------------------------------------------------------------------
-- A classroom attempt is a simulation_session like any other; this table holds
-- the part that has no courtroom equivalent — which language, which register,
-- and how many exchanges actually happened.
--
-- Separate table rather than more nullable columns on simulation_sessions,
-- because a column that is null for every courtroom row is a column that will
-- eventually be read for a courtroom row.
-- ---------------------------------------------------------------------------
create table if not exists public.classroom_sessions (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null unique
                  references public.simulation_sessions (id) on delete cascade,
  user_id       text not null,
  language      text not null check (language in ('ja', 'hi', 'es', 'fr', 'de', 'ko')),
  register      text not null default 'formal' check (register in ('formal', 'casual')),
  exchanges     integer not null default 0 check (exchanges >= 0),
  -- Which local model answered. Null until the first answer comes back, because
  -- Ollama may not be running when the room opens.
  model         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists classroom_sessions_user_idx
  on public.classroom_sessions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at, kept honest by the database
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists simulations_touch on public.simulations;
create trigger simulations_touch before update on public.simulations
  for each row execute function public.touch_updated_at();

drop trigger if exists simulation_sessions_touch on public.simulation_sessions;
create trigger simulation_sessions_touch before update on public.simulation_sessions
  for each row execute function public.touch_updated_at();

drop trigger if exists classroom_sessions_touch on public.classroom_sessions;
create trigger classroom_sessions_touch before update on public.classroom_sessions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Expiry
-- ---------------------------------------------------------------------------
-- A tab closed mid-trial leaves a row that says 'active' forever. Rather than a
-- cron job the project does not have, this function is called by the list
-- endpoint before it reads — cheap, because the partial predicate means it
-- touches only rows that are actually stale.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_simulation_sessions()
returns integer
language sql
as $$
  with expired as (
    update public.simulation_sessions
       set status = 'expired'
     where status in ('pending', 'active')
       and expires_at < now()
    returning 1
  )
  select count(*)::integer from expired;
$$;

-- ---------------------------------------------------------------------------
-- Lock the front door. See the header for why there are no policies.
-- ---------------------------------------------------------------------------
alter table public.simulations          enable row level security;
alter table public.simulation_sessions  enable row level security;
alter table public.simulation_results   enable row level security;
alter table public.classroom_sessions   enable row level security;
