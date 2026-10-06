-- ===========================================================================
-- 0002_seed_simulations.sql — the catalogue rows the suite ships with
-- ===========================================================================
--
-- Three rows: two courtroom cases that the trial engine already has files for,
-- and one language room.
--
-- All three leave companion_id NULL on purpose. A null companion_id means
-- "the default for this subject", and getSimulationForCompanion() falls back to
-- it — so a student who creates their own law companion gets the courtroom
-- without anyone having to wire the two together by hand. Point companion_id at
-- a specific companion only when you want that lesson to open a different case.
--
--
-- WHAT IS AND IS NOT IN `configuration`
--
-- `characters` names roles from apps/courtroom/src/config/characterRegistry.js.
-- Those seven keys are the load list: the frontend downloads a GLB for each one
-- named here and no others.
--
-- There is deliberately no `animations` key. The registry already holds the
-- exact clip list each GLB actually contains, measured from the export. A clip
-- list typed into a database is a clip list that can name something the file
-- does not have — and a missing clip is a character frozen in a T-pose with no
-- error. Omitting it means "every clip the registry lists for that role", which
-- is the only answer that cannot be wrong. Add the key only to *narrow* it, and
-- only to names copied from the registry.
--
-- No GLB, no texture, no audio, no video is stored here or anywhere in these
-- tables. Assets are files, served by the app that renders them.
--
-- Run after 0001. Idempotent: re-running updates the rows rather than
-- duplicating them.
-- ===========================================================================

insert into public.simulations
  (slug, kind, title, description, subject, case_id, difficulty, configuration)
values
  (
    'state-v-rane',
    'courtroom',
    'State versus Kabir Rane',
    'A murder and theft trial at Thorne''s Timepieces. Seven exhibits, four witnesses, and a hidden truth the transcript does not state. Sit as judge, prosecutor or defence.',
    'law',
    'state-v-rane',
    'hard',
    jsonb_build_object(
      'characters', jsonb_build_array(
        'judge', 'clerk', 'prosecutor', 'defense', 'witness', 'defendant', 'police'
      ),
      -- Which body each role wears, where the registry offers a choice.
      'variants', jsonb_build_object('witness', 'male', 'defendant', 'male'),
      'exhibits', jsonb_build_array(
        'EXHIBIT_A', 'EXHIBIT_B', 'EXHIBIT_C', 'EXHIBIT_D',
        'EXHIBIT_E', 'EXHIBIT_F', 'EXHIBIT_G'
      ),
      'speed', 1
    )
  ),
  (
    'state-v-malhotra',
    'courtroom',
    'State versus Dev Malhotra',
    'Online payment fraud: cheating, identity theft and personation by computer resource. Ten exhibits and three civilian witnesses. A documents case rather than a forensics one.',
    'law',
    'state-v-malhotra',
    'medium',
    jsonb_build_object(
      'characters', jsonb_build_array(
        'judge', 'clerk', 'prosecutor', 'defense', 'witness', 'defendant', 'police'
      ),
      'variants', jsonb_build_object('witness', 'female', 'defendant', 'male'),
      'exhibits', jsonb_build_array(
        'EXHIBIT_A', 'EXHIBIT_B', 'EXHIBIT_C', 'EXHIBIT_D', 'EXHIBIT_E',
        'EXHIBIT_F', 'EXHIBIT_G', 'EXHIBIT_H', 'EXHIBIT_I', 'EXHIBIT_J'
      ),
      'speed', 1
    )
  ),
  (
    'language-room',
    'classroom',
    'Language room',
    'A teacher who writes on the board and reads the answer aloud, in Japanese, Hindi, Spanish, French, German or Korean. The model runs on this machine; nothing you type leaves it.',
    'language',
    null,
    'easy',
    jsonb_build_object(
      -- The six the classroom's own lib/languages.mjs defines. The room lets a
      -- student switch between them mid-session, so this is a list rather than
      -- one value; classroom_sessions records which one they actually used.
      'languages', jsonb_build_array('ja', 'hi', 'es', 'fr', 'de', 'ko'),
      'language', 'ja',
      'register', 'formal'
    )
  )
on conflict (slug) do update set
  kind          = excluded.kind,
  title         = excluded.title,
  description   = excluded.description,
  subject       = excluded.subject,
  case_id       = excluded.case_id,
  difficulty    = excluded.difficulty,
  configuration = excluded.configuration,
  updated_at    = now();
