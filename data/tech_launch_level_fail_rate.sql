-- Current-layout level fail-rate check. App version is deliberately excluded
-- from the layout grain so identical hashes merge across releases.
with game_end_events as (
  select
    ep.app_version::varchar as app_version,
    ep.created_at,
    ep.user_id::varchar as user_id,
    nullif(trim(ep.payload:level_id::varchar), '') as level_id,
    nullif(trim(ep.payload:layout_hash::varchar), '') as layout_hash,
    try_to_number(ep.payload:level_bank_id::varchar)::int as level_bank_id,
    try_to_number(ep.payload:chapter_set_id::varchar)::int as chapter_set_id,
    try_to_number(ep.payload:level::varchar)::int as level,
    nullif(trim(ep.payload:difficulty::varchar), '') as raw_difficulty,
    lower(trim(ep.argument_value::varchar)) as outcome
  from public.events_production_ludios ep
  where ep.app_id = 122 -- modifiable parameter
    and ep.platform in ('android') -- modifiable parameter
    and ep.app_version in ('1.0.0') -- modifiable parameter
    and ep.created_at >= current_date() - 7 -- modifiable parameter
    and ep.created_at < dateadd(day, 1, current_date()) -- modifiable parameter
    and ep.name = 'Game_End'
    and ep.argument_value in ('win', 'lose')
    and ep.user_id is not null
),
level_hash_coverage as (
  select
    level_id,
    count(*) as outcome_events,
    count_if(layout_hash is not null) as hashed_outcome_events,
    count_if(layout_hash is null) as unhashed_outcome_events,
    hashed_outcome_events / nullif(outcome_events, 0)::float as hash_coverage
  from game_end_events
  where level_id is not null
  group by 1
),
layout_rollups as (
  select
    level_id,
    layout_hash,
    max_by(chapter_set_id, level_bank_id) as chapter_set_id,
    max(distinct level_bank_id) as level_bank_id,
    max_by(level, level_bank_id) as level,
    max_by(raw_difficulty, case when raw_difficulty is not null then created_at end) as raw_difficulty,
    listagg(distinct app_version, ', ') within group (order by app_version) as contributing_app_versions,
    count(distinct user_id) as users,
    count(distinct iff(outcome = 'lose', user_id, null)) as fails,
    min(created_at) as layout_first_seen_at,
    max(created_at) as layout_last_seen_at
  from game_end_events
  where level_id is not null
    and layout_hash is not null
  group by 1, 2
  having users >= 10
),
current_layouts as (
  select *
  from layout_rollups
  qualify row_number() over (
    partition by level_id
    order by layout_first_seen_at desc, layout_last_seen_at desc, layout_hash desc
  ) = 1
),
assessed_layouts as (
  select
    l.*,
    case
      when regexp_replace(lower(coalesce(l.raw_difficulty, '')), '[[:space:]_-]', '') in ('hard', 'superhard', 'veryhard') then 'hard'
      else 'normal'
    end as difficulty_tier,
    l.fails / nullif(l.users, 0)::float as fail_rate,
    case
      when regexp_replace(lower(coalesce(l.raw_difficulty, '')), '[[:space:]_-]', '') in ('hard', 'superhard', 'veryhard') then 0.70::float
      else 0.40::float
    end as alert_threshold,
    c.unhashed_outcome_events,
    c.hash_coverage,
    case
      when l.users <= 100 then 'warming_up'
      when regexp_replace(lower(coalesce(l.raw_difficulty, '')), '[[:space:]_-]', '') in ('hard', 'superhard', 'veryhard')
        and l.fails / nullif(l.users, 0)::float > 0.70 then 'alert'
      when regexp_replace(lower(coalesce(l.raw_difficulty, '')), '[[:space:]_-]', '') not in ('hard', 'superhard', 'veryhard')
        and l.fails / nullif(l.users, 0)::float > 0.40 then 'alert'
      else 'pass'
    end as status
  from current_layouts l
  join level_hash_coverage c on c.level_id = l.level_id
)
select
  chapter_set_id,
  level_bank_id,
  level,
  level_id,
  layout_hash,
  difficulty_tier,
  contributing_app_versions,
  users,
  fails,
  fail_rate,
  alert_threshold,
  layout_first_seen_at,
  layout_last_seen_at,
  unhashed_outcome_events,
  hash_coverage,
  status
from assessed_layouts
-- Count returns a bounded preview to the dashboard. Keep that preview aligned
-- to the chart's primary navigation, so it contains the earliest levels
-- instead of a severity-ranked subset of the level catalog.
order by
  level asc,
  level_id asc,
  layout_hash asc;
