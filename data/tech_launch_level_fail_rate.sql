with source_events as (
  select
    ep.app_version,
    ep.platform,
    ep.name,
    ep.created_at,
    ep.user_id,
    ep.argument_value,
    ep.payload
  from PUBLIC.EVENTS_PRODUCTION_LUDIOS_UNION ep
  where ep.app_id = 122 -- modifiable parameter
    and ep.platform in ('android') -- modifiable parameter
    and ep.app_version in ('1.0.0') -- modifiable parameter
    and ep.created_at >= current_date() - 7 -- modifiable parameter
    and ep.created_at < dateadd(day, 1, current_date()) -- modifiable parameter
    and ep.name in ('Game_Start', 'Game_End')
    and ep.user_id is not null
), gameplay_events as (
  select
    app_version,
    user_id::string as user_id,
    name,
    created_at,
    try_to_number(coalesce(payload:level::string, payload:level_id::string))::integer as level,
    nullif(trim(coalesce(payload:level_id::string, '')), '') as level_id,
    nullif(trim(coalesce(payload:layout_bank_id::string, payload:level_bank_id::string, '')), '') as layout_bank_id,
    nullif(trim(coalesce(payload:layout_hash::string, '')), '') as layout_hash,
    nullif(trim(coalesce(payload:game_round_id::string, '')), '') as game_round_id,
    nullif(trim(coalesce(payload:difficulty::string, '')), '') as raw_difficulty,
    lower(trim(coalesce(argument_value::string, payload:game_end_reason::string, payload:reason::string, ''))) as outcome
  from source_events
), end_round_hashes as (
  select
    app_version,
    user_id,
    level,
    game_round_id,
    max_by(layout_hash, created_at) as layout_hash
  from gameplay_events
  where name = 'Game_End'
    and level is not null
    and level >= 0
    and game_round_id is not null
    and layout_hash is not null
  group by 1, 2, 3, 4
), latest_layout_hashes as (
  select app_version, level, layout_bank_id, layout_hash
  from (
    select
      app_version,
      level,
      layout_bank_id,
      layout_hash,
      row_number() over (partition by app_version, level, layout_bank_id order by max(created_at) desc, layout_hash) as layout_hash_rank
    from gameplay_events
    where name = 'Game_End'
      and level is not null
      and level >= 0
      and layout_bank_id is not null
      and layout_hash is not null
    group by 1, 2, 3, 4
  )
  where layout_hash_rank = 1
), starts as (
  select
    s.app_version,
    s.user_id,
    s.created_at,
    s.level,
    s.level_id,
    s.layout_bank_id,
    coalesce(s.layout_hash, r.layout_hash, b.layout_hash) as layout_hash,
    s.game_round_id,
    s.raw_difficulty,
    coalesce(s.layout_hash, r.layout_hash, b.layout_hash, concat('__bank_fallback__:', s.layout_bank_id)) as revision_key
  from gameplay_events s
  left join end_round_hashes r
    on r.app_version = s.app_version
    and r.user_id = s.user_id
    and r.level = s.level
    and r.game_round_id = s.game_round_id
  left join latest_layout_hashes b
    on b.app_version = s.app_version
    and b.level = s.level
    and b.layout_bank_id = s.layout_bank_id
  where s.name = 'Game_Start'
    and s.level is not null
    and s.level >= 0
    and s.layout_bank_id is not null
), latest_event as (
  select max(created_at) as last_event_at from starts
), recent_start_totals as (
  select
    s.app_version,
    s.level,
    count(distinct case when s.created_at >= dateadd(hour, -24, l.last_event_at) then s.user_id end) as total_recent_players,
    count(distinct case when s.created_at >= dateadd(hour, -24, l.last_event_at) then s.user_id end) as layout_covered_recent_players
  from starts s
  cross join latest_event l
  group by 1, 2
), revision_history as (
  select
    s.app_version,
    s.level,
    s.revision_key,
    max_by(s.layout_hash, s.created_at) as layout_hash,
    min(s.created_at) as revision_first_seen_at,
    count(distinct s.user_id) as reached_players,
    case
      when regexp_replace(lower(coalesce(max_by(s.raw_difficulty, s.created_at), '')), '[[:space:]_-]', '') in ('hard', 'superhard', 'veryhard') then 'hard'
      else 'normal'
    end as difficulty_tier,
    regexp_replace(lower(coalesce(max_by(s.raw_difficulty, s.created_at), '')), '[[:space:]_-]', '') not in ('normal', 'hard', 'superhard', 'veryhard') as used_difficulty_fallback
  from starts s
  group by 1, 2, 3
), revision_metrics as (
  select
    s.app_version,
    s.level,
    s.revision_key,
    count(distinct case when s.created_at >= dateadd(hour, -24, l.last_event_at) then s.user_id end) as recent_players,
    max(s.created_at) as revision_last_seen_at
  from starts s
  cross join latest_event l
  group by 1, 2, 3
), revision_banks as (
  select
    s.app_version,
    s.level,
    s.revision_key,
    s.layout_bank_id,
    max(s.level_id) as level_id,
    min(s.created_at) as bank_first_seen_at,
    max(s.created_at) as bank_last_seen_at,
    row_number() over (
      partition by s.app_version, s.level, s.revision_key
      order by min(s.created_at) desc, max(s.created_at) desc, s.layout_bank_id desc
    ) as canonical_bank_rank
  from starts s
  group by 1, 2, 3, 4
),
-- Select the currently active revision independently for each app version.
active_revision_candidates as (
  select
    m.app_version,
    m.level,
    m.revision_key,
    b.layout_bank_id,
    b.level_id,
    m.recent_players,
    m.revision_last_seen_at,
    row_number() over (
      partition by m.app_version, m.level
      order by case when m.recent_players > 0 then 1 else 0 end desc, m.recent_players desc, m.revision_last_seen_at desc, m.revision_key
    ) as revision_rank
  from revision_metrics m
  join revision_banks b
    on b.app_version = m.app_version
    and b.level = m.level
    and b.revision_key = m.revision_key
    and b.canonical_bank_rank = 1
), active_layout_cohorts as (
  select
    r.app_version,
    r.level,
    r.revision_key,
    r.layout_bank_id,
    r.level_id,
    h.layout_hash,
    h.difficulty_tier,
    h.used_difficulty_fallback,
    h.revision_first_seen_at,
    r.revision_last_seen_at,
    r.recent_players,
    t.total_recent_players,
    t.layout_covered_recent_players,
    r.recent_players / nullif(t.total_recent_players, 0)::float as layout_share,
    t.layout_covered_recent_players / nullif(t.total_recent_players, 0)::float as layout_coverage,
    r.recent_players > 0
      and r.recent_players / nullif(t.total_recent_players, 0)::float >= 0.7
      and t.layout_covered_recent_players / nullif(t.total_recent_players, 0)::float >= 0.95
      and datediff(hour, h.revision_first_seen_at, l.last_event_at) >= 24 as layout_is_stable
  from active_revision_candidates r
  join revision_history h
    on h.app_version = r.app_version
    and h.level = r.level
    and h.revision_key = r.revision_key
  join recent_start_totals t
    on t.app_version = r.app_version
    and t.level = r.level
  cross join latest_event l
  where r.revision_rank = 1
), pending_revision_candidates as (
  select
    r.app_version,
    r.level,
    r.revision_key as pending_revision_key,
    r.layout_bank_id as pending_layout_bank_id,
    h.layout_hash as pending_layout_hash,
    r.recent_players as pending_layout_recent_players,
    r.recent_players / nullif(t.total_recent_players, 0)::float as pending_layout_share,
    h.revision_first_seen_at as pending_revision_first_seen_at,
    datediff(hour, h.revision_first_seen_at, l.last_event_at) as pending_layout_age_hours,
    row_number() over (partition by r.app_version, r.level order by r.recent_players desc, h.revision_first_seen_at desc, r.revision_key) as pending_revision_rank
  from active_revision_candidates r
  join recent_start_totals t
    on t.app_version = r.app_version
    and t.level = r.level
  join revision_history h
    on h.app_version = r.app_version
    and h.level = r.level
    and h.revision_key = r.revision_key
  cross join latest_event l
  where datediff(hour, h.revision_first_seen_at, l.last_event_at) < 24
    and r.recent_players >= 5
    and r.recent_players / nullif(t.total_recent_players, 0)::float >= 0.01
), pending_layouts as (
  select *
  from pending_revision_candidates
  where pending_revision_rank = 1
), prior_layouts as (
  select
    p.app_version,
    p.level,
    p.pending_revision_first_seen_at,
    s.revision_key as previous_revision_key,
    max_by(s.layout_bank_id, s.created_at) as previous_layout_bank_id,
    max_by(s.layout_hash, s.created_at) as previous_layout_hash,
    count(distinct s.user_id) as previous_layout_reached_players,
    case
      when regexp_replace(lower(coalesce(max_by(s.raw_difficulty, s.created_at), '')), '[[:space:]_-]', '') in ('hard', 'superhard', 'veryhard') then 'hard'
      else 'normal'
    end as previous_layout_difficulty_tier,
    row_number() over (partition by p.app_version, p.level order by count(distinct s.user_id) desc, max(s.created_at) desc, s.revision_key) as previous_layout_rank
  from pending_layouts p
  join starts s
    on s.app_version = p.app_version
    and s.level = p.level
    and s.revision_key <> p.pending_revision_key
    and s.created_at >= dateadd(hour, -24, p.pending_revision_first_seen_at)
    and s.created_at < p.pending_revision_first_seen_at
  group by 1, 2, 3, 4
), prior_active_layouts as (
  select *
  from prior_layouts
  where previous_layout_rank = 1
), ended_games as (
  select
    e.app_version,
    e.user_id,
    e.level,
    e.created_at,
    coalesce(e.layout_bank_id, s.layout_bank_id) as layout_bank_id,
    coalesce(e.layout_hash, s.layout_hash) as layout_hash,
    coalesce(e.layout_hash, s.layout_hash, concat('__bank_fallback__:', coalesce(e.layout_bank_id, s.layout_bank_id))) as revision_key,
    e.outcome
  from gameplay_events e
  left join starts s
    on s.app_version = e.app_version
    and s.user_id = e.user_id
    and s.level = e.level
    and s.game_round_id is not null
    and s.game_round_id = e.game_round_id
  where e.name = 'Game_End'
    and e.level is not null
    and e.level >= 0
),
-- Merge active version cohorts only when their content revision matches. A hash
-- therefore produces one assessment across patch versions; different hashes
-- remain independently eligible on the same level.
layout_rollups as (
  select
    a.level,
    a.revision_key,
    max_by(a.level_id, a.revision_last_seen_at) as level_id,
    max_by(a.layout_bank_id, a.revision_last_seen_at) as layout_bank_id,
    max_by(a.layout_hash, a.revision_last_seen_at) as layout_hash,
    max_by(a.difficulty_tier, a.revision_last_seen_at) as difficulty_tier,
    boolor_agg(a.used_difficulty_fallback) as used_difficulty_fallback,
    max(a.layout_share) as layout_share,
    max(a.layout_coverage) as layout_coverage,
    boolor_agg(a.recent_players > 0) as has_recent_activity,
    max(datediff(hour, a.revision_first_seen_at, l.last_event_at)) as layout_age_hours,
    boolor_agg(p.pending_revision_key is not null) as layout_update_pending,
    max_by(p.pending_layout_bank_id, p.pending_revision_first_seen_at) as pending_layout_bank_id,
    max_by(p.pending_layout_hash, p.pending_revision_first_seen_at) as pending_layout_hash,
    max_by(p.pending_layout_share, p.pending_revision_first_seen_at) as pending_layout_share,
    max_by(p.pending_layout_recent_players, p.pending_revision_first_seen_at) as pending_layout_recent_players,
    max_by(p.pending_layout_age_hours, p.pending_revision_first_seen_at) as pending_layout_age_hours,
    max_by(pa.previous_layout_bank_id, p.pending_revision_first_seen_at) as previous_layout_bank_id,
    max_by(pa.previous_layout_hash, p.pending_revision_first_seen_at) as previous_layout_hash,
    max_by(pa.previous_layout_difficulty_tier, p.pending_revision_first_seen_at) as previous_layout_difficulty_tier,
    max_by(pa.previous_layout_reached_players, p.pending_revision_first_seen_at) as previous_layout_reached_players,
    boolor_agg(a.layout_is_stable) as layout_is_stable
  from active_layout_cohorts a
  cross join latest_event l
  left join pending_layouts p
    on p.app_version = a.app_version
    and p.level = a.level
  left join prior_active_layouts pa
    on pa.app_version = a.app_version
    and pa.level = a.level
  group by 1, 2
), start_metrics as (
  select
    a.level,
    a.revision_key,
    count(distinct s.user_id) as reached_players
  from active_layout_cohorts a
  join starts s
    on s.app_version = a.app_version
    and s.level = a.level
    and s.revision_key = a.revision_key
  group by 1, 2
), failure_metrics as (
  select
    a.level,
    a.revision_key,
    count(distinct e.user_id) as failed_players
  from active_layout_cohorts a
  left join ended_games e
    on e.app_version = a.app_version
    and e.level = a.level
    and e.revision_key = a.revision_key
    and e.outcome in ('lose', 'loss', 'fail', 'failed')
  group by 1, 2
), prior_failures as (
  select
    p.app_version,
    p.level,
    p.previous_revision_key,
    count(distinct e.user_id) as previous_layout_failed_players
  from prior_active_layouts p
  left join ended_games e
    on e.app_version = p.app_version
    and e.level = p.level
    and e.revision_key = p.previous_revision_key
    and e.created_at >= dateadd(hour, -24, p.pending_revision_first_seen_at)
    and e.created_at < p.pending_revision_first_seen_at
    and e.outcome in ('lose', 'loss', 'fail', 'failed')
  group by 1, 2, 3
), prior_failure_rollups as (
  select
    a.level,
    a.revision_key,
    max_by(coalesce(pf.previous_layout_failed_players, 0), p.pending_revision_first_seen_at) as previous_layout_failed_players
  from active_layout_cohorts a
  left join pending_layouts p
    on p.app_version = a.app_version
    and p.level = a.level
  left join prior_active_layouts pa
    on pa.app_version = a.app_version
    and pa.level = a.level
  left join prior_failures pf
    on pf.app_version = pa.app_version
    and pf.level = pa.level
    and pf.previous_revision_key = pa.previous_revision_key
  group by 1, 2
)
select
  a.level,
  a.level_id,
  a.layout_bank_id,
  a.layout_hash,
  a.difficulty_tier,
  a.used_difficulty_fallback,
  m.reached_players,
  coalesce(f.failed_players, 0) as failed_players,
  coalesce(f.failed_players, 0) / nullif(m.reached_players, 0)::float as fail_rate,
  a.layout_share,
  a.layout_coverage,
  a.has_recent_activity,
  a.layout_age_hours,
  a.layout_update_pending,
  a.pending_layout_bank_id,
  a.pending_layout_hash,
  a.pending_layout_share,
  a.pending_layout_recent_players,
  a.pending_layout_age_hours,
  a.previous_layout_bank_id,
  a.previous_layout_hash,
  a.previous_layout_difficulty_tier,
  a.previous_layout_reached_players,
  coalesce(pf.previous_layout_failed_players, 0) as previous_layout_failed_players,
  coalesce(pf.previous_layout_failed_players, 0) / nullif(a.previous_layout_reached_players, 0)::float as previous_layout_fail_rate,
  a.layout_is_stable
from layout_rollups a
join start_metrics m
  on m.level = a.level
  and m.revision_key = a.revision_key
join failure_metrics f
  on f.level = a.level
  and f.revision_key = a.revision_key
left join prior_failure_rollups pf
  on pf.level = a.level
  and pf.revision_key = a.revision_key
order by a.level asc, a.revision_key
