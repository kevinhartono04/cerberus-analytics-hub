with source_events as (
  select
    case
      when ep.app_id = 18 then 'hexago'
      when ep.app_id = 22 then 'marble'
      when ep.app_id = 9 then 'tripletile'
      when ep.app_id = 28 then 'wooblast'
      when ep.app_id = 4 then 'woodoku'
      when ep.app_id = 117 then 'blockkingdom'
      when ep.app_id = 23 then 'bubblego'
      when ep.app_id = 119 then 'mahjongbloom'
      when ep.app_id = 122 then 'wordblast'
      when ep.app_id = 125 then 'jelly'
      when ep.app_id = 3003 then 'bloomsort'
      when ep.app_id = 3001 then 'wordrush'
      when ep.app_id = 3004 then 'sizzle'
      when ep.app_id = 3011 then 'stacksmash'
      when ep.app_id = 3005 then 'dotpaint'
      when ep.app_id = 3006 then 'bubblewordchain'
      else null
    end as app_name,
    ep.app_version,
    ep.platform,
    ep.name,
    ep.created_at,
    ep.user_id,
    ep.argument_value,
    ep.payload
  from PUBLIC.EVENTS_PRODUCTION_LUDIOS_UNION ep
), gameplay_events as (
  select
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
  from source_events ep
  where app_name = 'wordblast' -- modifiable parameter
    and ep.platform in ('android') -- modifiable parameter
    and ep.app_version in ('1.0.0') -- modifiable parameter
    and ep.created_at::date between current_date() - 7 and current_date() -- modifiable parameter
    and ep.name in ('Game_Start', 'Game_End')
    and user_id is not null
), end_round_hashes as (
  select
    e.user_id,
    e.level,
    e.game_round_id,
    max_by(e.layout_hash, e.created_at) as layout_hash
  from gameplay_events e
  where e.name = 'Game_End'
    and e.level is not null
    and e.level >= 0
    and e.game_round_id is not null
    and e.layout_hash is not null
  group by 1, 2, 3
), latest_layout_hashes as (
  select level, layout_bank_id, layout_hash
  from (
    select
      e.level,
      e.layout_bank_id,
      e.layout_hash,
      row_number() over (partition by e.level, e.layout_bank_id order by max(e.created_at) desc, e.layout_hash) as layout_hash_rank
    from gameplay_events e
    where e.name = 'Game_End'
      and e.level is not null
      and e.level >= 0
      and e.layout_bank_id is not null
      and e.layout_hash is not null
    group by 1, 2, 3
  )
  where layout_hash_rank = 1
), starts as (
  select
    s.user_id,
    s.name,
    s.created_at,
    s.level,
    s.level_id,
    s.layout_bank_id,
    coalesce(s.layout_hash, r.layout_hash, b.layout_hash) as layout_hash,
    s.game_round_id,
    s.raw_difficulty,
    s.outcome,
    coalesce(s.layout_hash, r.layout_hash, b.layout_hash, concat('__bank_fallback__:', s.layout_bank_id)) as revision_key
  from gameplay_events s
  left join end_round_hashes r
    on r.user_id = s.user_id
    and r.level = s.level
    and r.game_round_id = s.game_round_id
  left join latest_layout_hashes b
    on b.level = s.level
    and b.layout_bank_id = s.layout_bank_id
  where s.name = 'Game_Start' and s.level is not null and s.level >= 0 and s.layout_bank_id is not null
), latest_event as (
  select max(created_at) as last_event_at from starts
), recent_start_totals as (
  select
    s.level,
    count(distinct s.user_id) as total_recent_players,
    count(distinct s.user_id) as layout_covered_recent_players
  from starts s
  cross join latest_event l
  where s.created_at >= dateadd(hour, -24, l.last_event_at)
  group by 1
), revision_history as (
  select
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
  group by 1, 2
), recent_revision_metrics as (
  select
    s.level,
    s.revision_key,
    count(distinct s.user_id) as recent_players,
    max(s.created_at) as revision_last_seen_at
  from starts s
  cross join latest_event l
  where s.created_at >= dateadd(hour, -24, l.last_event_at)
  group by 1, 2
), revision_banks as (
  select
    s.level,
    s.revision_key,
    s.layout_bank_id,
    max(s.level_id) as level_id,
    min(s.created_at) as bank_first_seen_at,
    max(s.created_at) as bank_last_seen_at,
    row_number() over (
      partition by s.level, s.revision_key
      order by min(s.created_at) desc, max(s.created_at) desc, s.layout_bank_id desc
    ) as canonical_bank_rank
  from starts s
  group by 1, 2, 3
), recent_revisions as (
  select
    m.level,
    m.revision_key,
    b.layout_bank_id,
    b.level_id,
    m.recent_players,
    row_number() over (partition by m.level order by m.recent_players desc, m.revision_last_seen_at desc, m.revision_key) as revision_rank
  from recent_revision_metrics m
  join revision_banks b
    on b.level = m.level
    and b.revision_key = m.revision_key
    and b.canonical_bank_rank = 1
), active_layouts as (
  select
    r.level,
    r.revision_key,
    r.layout_bank_id,
    r.level_id,
    h.layout_hash,
    r.recent_players,
    t.total_recent_players,
    t.layout_covered_recent_players,
    r.recent_players / nullif(t.total_recent_players, 0)::float as layout_share,
    t.layout_covered_recent_players / nullif(t.total_recent_players, 0)::float as layout_coverage
  from recent_revisions r
  join recent_start_totals t using (level)
  join revision_history h on h.level = r.level and h.revision_key = r.revision_key
  where r.revision_rank = 1
), pending_revision_candidates as (
  select
    r.level,
    r.revision_key as pending_revision_key,
    r.layout_bank_id as pending_layout_bank_id,
    h.layout_hash as pending_layout_hash,
    r.recent_players as pending_layout_recent_players,
    r.recent_players / nullif(t.total_recent_players, 0)::float as pending_layout_share,
    h.revision_first_seen_at as pending_revision_first_seen_at,
    datediff(hour, h.revision_first_seen_at, l.last_event_at) as pending_layout_age_hours,
    row_number() over (partition by r.level order by r.recent_players desc, h.revision_first_seen_at desc, r.revision_key) as pending_revision_rank
  from recent_revisions r
  join recent_start_totals t using (level)
  join revision_history h on h.level = r.level and h.revision_key = r.revision_key
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
    row_number() over (partition by p.level order by count(distinct s.user_id) desc, max(s.created_at) desc, s.revision_key) as previous_layout_rank
  from pending_layouts p
  join starts s
    on s.level = p.level
    and s.revision_key <> p.pending_revision_key
    and s.created_at >= dateadd(hour, -24, p.pending_revision_first_seen_at)
    and s.created_at < p.pending_revision_first_seen_at
  group by 1, 2, 3
), prior_active_layouts as (
  select *
  from prior_layouts
  where previous_layout_rank = 1
), ended_games as (
  select
    e.user_id,
    e.level,
    e.created_at,
    coalesce(e.layout_bank_id, s.layout_bank_id) as layout_bank_id,
    coalesce(e.layout_hash, s.layout_hash) as layout_hash,
    coalesce(e.layout_hash, s.layout_hash, concat('__bank_fallback__:', coalesce(e.layout_bank_id, s.layout_bank_id))) as revision_key,
    e.outcome
  from gameplay_events e
  left join starts s
    on s.user_id = e.user_id
    and s.level = e.level
    and s.game_round_id is not null
    and s.game_round_id = e.game_round_id
  where e.name = 'Game_End' and e.level is not null and e.level >= 0
), failures as (
  select
    a.level,
    a.revision_key,
    count(distinct e.user_id) as failed_players
  from active_layouts a
  left join ended_games e
    on e.level = a.level
    and e.revision_key = a.revision_key
    and e.outcome in ('lose', 'loss', 'fail', 'failed')
  group by 1, 2
), prior_failures as (
  select
    p.level,
    p.previous_revision_key,
    count(distinct e.user_id) as previous_layout_failed_players
  from prior_active_layouts p
  left join ended_games e
    on e.level = p.level
    and e.revision_key = p.previous_revision_key
    and e.created_at >= dateadd(hour, -24, p.pending_revision_first_seen_at)
    and e.created_at < p.pending_revision_first_seen_at
    and e.outcome in ('lose', 'loss', 'fail', 'failed')
  group by 1, 2
)
select
  h.level,
  a.level_id,
  a.layout_bank_id,
  a.layout_hash,
  h.difficulty_tier,
  h.used_difficulty_fallback,
  h.reached_players,
  coalesce(f.failed_players, 0) as failed_players,
  coalesce(f.failed_players, 0) / nullif(h.reached_players, 0)::float as fail_rate,
  a.layout_share,
  a.layout_coverage,
  datediff(hour, h.revision_first_seen_at, l.last_event_at) as layout_age_hours,
  coalesce(p.pending_revision_key is not null, false) as layout_update_pending,
  p.pending_layout_bank_id,
  p.pending_layout_hash,
  p.pending_layout_share,
  p.pending_layout_recent_players,
  p.pending_layout_age_hours,
  pa.previous_layout_bank_id,
  pa.previous_layout_hash,
  pa.previous_layout_difficulty_tier,
  pa.previous_layout_reached_players,
  coalesce(pf.previous_layout_failed_players, 0) as previous_layout_failed_players,
  coalesce(pf.previous_layout_failed_players, 0) / nullif(pa.previous_layout_reached_players, 0)::float as previous_layout_fail_rate,
  a.layout_share >= 0.7
    and a.layout_coverage >= 0.95
    and datediff(hour, h.revision_first_seen_at, l.last_event_at) >= 24 as layout_is_stable
from revision_history h
join active_layouts a on a.level = h.level and a.revision_key = h.revision_key
join failures f on f.level = h.level and f.revision_key = h.revision_key
cross join latest_event l
left join pending_layouts p on p.level = h.level
left join prior_active_layouts pa on pa.level = h.level
left join prior_failures pf on pf.level = pa.level and pf.previous_revision_key = pa.previous_revision_key
order by h.level asc
