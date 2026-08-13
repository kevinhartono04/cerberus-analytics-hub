with source_events as (
  select
    ep.name,
    ep.created_at,
    ep.user_id,
    ep.argument_value,
    ep.payload
  from PUBLIC.EVENTS_PRODUCTION_LUDIOS_UNION ep
  where ep.app_id = 122 -- modifiable parameter
    and ep.platform in ('android') -- modifiable parameter
    and ep.app_version in ('1.0.0') -- modifiable parameter
    and ep.created_at >= dateadd(hour, -48, current_timestamp()) -- modifiable parameter
    and ep.created_at < current_timestamp() -- modifiable parameter
    and ep.name in ('Game_Start', 'Game_End')
    and ep.user_id is not null
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
  from source_events
), end_round_hashes as (
  select
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
  group by 1, 2, 3
), starts as (
  select
    s.user_id,
    s.created_at,
    s.level,
    s.level_id,
    s.layout_bank_id,
    coalesce(s.layout_hash, r.layout_hash) as layout_hash,
    s.game_round_id,
    s.raw_difficulty,
    coalesce(s.layout_hash, r.layout_hash, concat('__bank_fallback__:', s.layout_bank_id)) as revision_key
  from gameplay_events s
  left join end_round_hashes r
    on r.user_id = s.user_id
    and r.level = s.level
    and r.game_round_id = s.game_round_id
  where s.name = 'Game_Start'
    and s.level is not null
    and s.level >= 0
    and s.layout_bank_id is not null
), active_revision_candidates as (
  select
    level,
    revision_key,
    max_by(level_id, created_at) as level_id,
    max_by(layout_bank_id, created_at) as layout_bank_id,
    max_by(layout_hash, created_at) as layout_hash,
    case
      when regexp_replace(lower(coalesce(max_by(raw_difficulty, created_at), '')), '[[:space:]_-]', '') in ('hard', 'superhard', 'veryhard') then 'hard'
      else 'normal'
    end as difficulty_tier,
    max(created_at) as last_seen_at,
    row_number() over (partition by level order by max(created_at) desc, revision_key) as revision_rank
  from starts
  group by 1, 2
), active_revisions as (
  select *
  from active_revision_candidates
  where revision_rank = 1
), ended_games as (
  select
    e.user_id,
    e.level,
    coalesce(e.layout_hash, s.layout_hash) as layout_hash,
    coalesce(e.layout_bank_id, s.layout_bank_id) as layout_bank_id,
    coalesce(e.layout_hash, s.layout_hash, concat('__bank_fallback__:', coalesce(e.layout_bank_id, s.layout_bank_id))) as revision_key,
    e.outcome
  from gameplay_events e
  left join starts s
    on s.user_id = e.user_id
    and s.level = e.level
    and s.game_round_id is not null
    and s.game_round_id = e.game_round_id
  where e.name = 'Game_End'
    and e.level is not null
    and e.level >= 0
), revision_metrics as (
  select
    a.level,
    a.revision_key,
    count(distinct s.user_id) as reached_players,
    count(distinct case when e.outcome in ('lose', 'loss', 'fail', 'failed') then e.user_id end) as failed_players
  from active_revisions a
  join starts s
    on s.level = a.level
    and s.revision_key = a.revision_key
  left join ended_games e
    on e.level = a.level
    and e.revision_key = a.revision_key
  group by 1, 2
)
select
  a.level,
  a.level_id,
  a.layout_bank_id,
  a.layout_hash,
  a.difficulty_tier,
  m.reached_players,
  m.failed_players,
  m.failed_players / nullif(m.reached_players, 0)::float as fail_rate
from active_revisions a
join revision_metrics m
  on m.level = a.level
  and m.revision_key = a.revision_key
order by a.level asc
