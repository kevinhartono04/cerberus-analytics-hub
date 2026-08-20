-- Incent Config hourly alert query. Parameters are replaced by lib/incent-config-alerts.ts.
with recursive hours(event_hour) as (
  select to_timestamp_ntz('2026-08-19 00:00:00') -- density start parameter
  union all
  select dateadd(hour, 1, event_hour)
  from hours
  where event_hour < to_timestamp_ntz('2026-08-21 00:00:00') -- evaluation hour parameter
), incentivized_users as (
  select distinct app_user_id::varchar as user_id
  from tds_db.raw.lds_gs_devices
  where lower(media_source::varchar) in ('freecash_int') -- media sources parameter
), scoped_events as (
  select
    ep.user_id::varchar as user_id,
    ep.session_id::varchar as session_id,
    lower(ep.name::varchar) as event_name,
    ep.created_at,
    try_to_number(ep.cohort_day::varchar)::int as cohort_day,
    try_to_number(ep.payload:"level"::varchar)::int as level,
    lower(coalesce(ep.payload:item_type::varchar, ep.payload:itemtype::varchar)) as item_type
  from public.events_production_ludios_union ep
  join incentivized_users iu on iu.user_id = ep.user_id::varchar
  where ep.app_id = 3011 -- app id parameter
    and ep.created_at < to_timestamp_ntz('2026-08-21 01:00:00') -- evaluation end parameter
    and lower(ep.name::varchar) in ('game_start', 'game_end', 'ad_impression_interstitial', 'ad_impression_rewarded', 'store_product_purchase_success')
), level_context as (
  select
    user_id,
    session_id,
    event_name,
    created_at,
    last_value(iff(event_name in ('game_start', 'game_end'), level, null) ignore nulls) over (
      partition by user_id, session_id
      order by created_at
      rows between unbounded preceding and current row
    ) as current_level
  from scoped_events
  where cohort_day = 0
    and event_name in ('game_start', 'game_end', 'ad_impression_interstitial')
), first_ads as (
  select user_id, current_level as level, date_trunc('hour', created_at) as event_hour
  from level_context
  where event_name = 'ad_impression_interstitial'
    and current_level is not null
  qualify row_number() over (partition by user_id order by created_at) = 1
), hourly_density as (
  select
    date_trunc('hour', created_at) as event_hour,
    count_if(event_name = 'ad_impression_interstitial') as interstitial_impressions,
    count_if(event_name = 'ad_impression_rewarded') as rewarded_impressions,
    count_if(event_name = 'game_end') as completed_games,
    count(distinct iff(event_name = 'game_end', user_id, null)) as eligible_users
  from scoped_events
  where created_at >= to_timestamp_ntz('2026-08-19 00:00:00') -- density start parameter
    and created_at < to_timestamp_ntz('2026-08-21 01:00:00') -- evaluation end parameter
  group by 1
), current_no_ads as (
  select
    count_if(event_name = 'store_product_purchase_success' and item_type = 'no_ads') as purchase_events,
    count(distinct iff(event_name = 'game_end', user_id, null)) as eligible_users
  from scoped_events
  where created_at >= to_timestamp_ntz('2026-08-21 00:00:00') -- evaluation hour parameter
    and created_at < to_timestamp_ntz('2026-08-21 01:00:00') -- evaluation end parameter
)
select
  'first_interstitial' as row_type,
  'median_level' as row_key,
  to_varchar(to_timestamp_ntz('2026-08-21 00:00:00'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_hour,
  median(level)::float as metric_value,
  count(distinct user_id)::int as event_count,
  count(distinct user_id)::int as user_count
from first_ads
where event_hour = to_timestamp_ntz('2026-08-21 00:00:00') -- evaluation hour parameter
union all
select
  'density' as row_type,
  'fipg' as row_key,
  to_varchar(h.event_hour, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_hour,
  coalesce(d.interstitial_impressions, 0) / nullif(coalesce(d.completed_games, 0), 0)::float as metric_value,
  coalesce(d.completed_games, 0)::int as event_count,
  coalesce(d.eligible_users, 0)::int as user_count
from hours h left join hourly_density d on d.event_hour = h.event_hour
union all
select
  'density' as row_type,
  'ripg' as row_key,
  to_varchar(h.event_hour, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_hour,
  coalesce(d.rewarded_impressions, 0) / nullif(coalesce(d.completed_games, 0), 0)::float as metric_value,
  coalesce(d.completed_games, 0)::int as event_count,
  coalesce(d.eligible_users, 0)::int as user_count
from hours h left join hourly_density d on d.event_hour = h.event_hour
union all
select
  'no_ads' as row_type,
  'purchase_events' as row_key,
  to_varchar(to_timestamp_ntz('2026-08-21 00:00:00'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_hour,
  purchase_events::float as metric_value,
  purchase_events::int as event_count,
  eligible_users::int as user_count
from current_no_ads
order by row_type, row_key, event_hour;
