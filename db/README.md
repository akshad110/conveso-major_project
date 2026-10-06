# The database

Converso talks to Supabase through `@supabase/supabase-js`. There is no ORM, no
migration runner and no `prisma/` directory — the existing tables (`companions`,
`session_history`, `bookmarks`) were created by hand in the SQL editor, and these
follow the same path.

## Applying a migration

Open the Supabase dashboard for the project, go to **SQL Editor**, paste the file
and run it. In order:

    0001_simulations.sql        the four tables, the triggers, the expiry sweep
    0002_seed_simulations.sql   two courtroom cases and the language room

Both are idempotent. `0001` is `create table if not exists` throughout; `0002`
upserts on `slug`. Running either twice changes nothing the second time, so
re-running after an edit is safe.

If you prefer the CLI and have it installed:

    psql "$SUPABASE_DB_URL" -f db/migrations/0001_simulations.sql
    psql "$SUPABASE_DB_URL" -f db/migrations/0002_seed_simulations.sql

## Rolling one back

There is no `down` file, because there is no migration runner to run it. Rolling
back is SQL you paste in the same editor, and it comes in two sizes.

**Undo the seed only.** Leaves the tables and anything a student has already
done, and removes the three catalogue rows. `simulation_sessions.simulation_id`
is `on delete cascade`, so this also removes sessions and results for those
hearings — which is what you want if you are re-seeding, and is not what you want
on a database with real attempts in it. Check the count first:

    select slug, count(ss.id) as attempts
      from public.simulations s
      left join public.simulation_sessions ss on ss.simulation_id = s.id
     where s.slug in ('state-v-rane', 'state-v-malhotra', 'language-room')
     group by slug;

    delete from public.simulations
     where slug in ('state-v-rane', 'state-v-malhotra', 'language-room');

Usually you do not need this at all: `0002` upserts on `slug`, so editing a title
or a character list and re-running it is the ordinary way to change the
catalogue.

**Undo the whole feature.** Drops everything `0001` added, children first:

    drop table if exists public.simulation_results;
    drop table if exists public.classroom_sessions;
    drop table if exists public.simulation_sessions;
    drop table if exists public.simulations;
    drop function if exists public.expire_stale_simulation_sessions();

Two things that are easy to get wrong here.

`public.touch_updated_at()` is **not** in that list on purpose. `0001` creates it
with `create or replace` and the name is generic, so on a project that already
had a function by that name, 0001 replaced it and a `drop` would take a trigger
on `companions` or `bookmarks` down with it. Dropping the four tables removes the
three triggers that reference it and leaves the function harmlessly unused. Drop
it only after confirming nothing else does:

    select c.relname as table_name, t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal
       and t.tgfoid = 'public.touch_updated_at'::regproc;

And nothing in a rollback should touch `session_history`. Finishing a simulation
appends a row to it, exactly as finishing a voice session does, and those rows
are indistinguishable from each other by design — see the progress deviation in
`ARCHITECTURE.md`. Deleting a student's simulation history means deleting part of
their companion history, so a rollback leaves it alone.

After either size, be clear about what you have done to the running app. The
data layer treats a query error as fatal — every read in
`apps/lms/lib/actions/simulation.actions.ts` does `if (error) throw new
Error(error.message)` — and a dropped table is a query error, not an empty
result. So a full rollback does not make the simulation pages quietly disappear;
it makes them throw until the code that reads them is removed or the migration is
re-applied. Nothing outside those pages is affected: no other feature reads these
four tables. Undoing the seed only is the safe one — those reads get zero rows,
which is a legitimate answer, and the catalogue simply shows nothing.

## Why the plan's Prisma models became SQL files

`CONVERSO_COURTROOM_INTEGRATION_PLAN.md` describes `Simulation`,
`SimulationSession` and `SimulationResult` as Prisma models. Converso has no
Prisma. Adding it would mean a second schema, a second connection pool and a
second source of truth for rows the rest of the app reads through Supabase —
which is the thing the plan's own security rules forbid: *"Never duplicate
authentication or databases."*

So the models are these tables, and the data layer is
`apps/lms/lib/actions/simulation.actions.ts`, written in the same style as the
`companion.actions.ts` that was already there.

The shapes are still typed, and still in one place:
`packages/contracts/index.d.ts` describes exactly the columns these files create.

## Row level security

RLS is **enabled on all four tables with no policies attached.**

That reads like a mistake and is not. `apps/lms/lib/supabase.ts` says why:

> Since we're using Clerk auth, not Supabase auth, RLS doesn't work properly

There is no Supabase JWT for a policy to judge, because identity comes from
Clerk. A policy would therefore either be wrong or be `using (true)`, which is
the same as no protection while looking like protection.

Enabling RLS without policies is the half that does work:

- the **anon key** — the one in `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which ships to
  every browser — can read and write **nothing** in these tables;
- the **service-role key** bypasses RLS by design, so `createSupabaseAdminClient()`
  keeps working on the server.

Authorisation happens one layer up, in the server actions: the Clerk user id
comes from `auth()` and every query is filtered by it. A caller who guesses a
session UUID still gets `null`, because the row also has to match their user id.

## user_id is text, not uuid

Clerk issues ids like `user_2abc123XYZ`. `companions.user_id` is already `text`
(the seeded law companion uses the literal string `system`), so these tables
match it. A `uuid` column here would make it impossible to join the two.

## What never goes in the database

No GLB files, no textures, no animation data, no video, no audio. The
`configuration` column holds names and numbers — which characters a case needs,
which exhibits exist, which language a room opens in — and the heavy apps read it
to decide what to download from their own `public/` directories.

`simulation_results.transcript` is the one large text column, capped at 200,000
characters by `normalizeCourtroomResult()` before it reaches Postgres.

## Expiry

`expire_stale_simulation_sessions()` flips `pending` and `active` rows whose
`expires_at` has passed to `expired`. `getSimulationHistory()` calls it before
reading, so there is no cron job to install. It is cheap when nothing is stale
and non-fatal if it is missing — a failed sweep logs a warning rather than
blanking a history page.
