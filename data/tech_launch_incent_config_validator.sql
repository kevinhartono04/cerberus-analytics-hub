-- Incent Config Validator. Parameters are replaced by lib/incent-config-validator.ts.
with recursive hours(event_hour) as (
  select to_timestamp_ntz('2026-08-17 00:00:00') -- density start parameter
  union all
  select dateadd(hour, 1, event_hour)
  from hours
  where event_hour < to_timestamp_ntz('2026-08-19 00:00:00') -- evaluation hour parameter
), report_hours(event_hour) as (
  select to_timestamp_ntz('2026-08-10 00:00:00') -- report hours start parameter
  union all
  select dateadd(hour, 1, event_hour)
  from report_hours
  where dateadd(hour, 1, event_hour) < to_timestamp_ntz('2026-08-20 00:00:00') -- report hours end parameter
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
    and ep.created_at >= to_timestamp_ntz('2026-08-10 00:00:00') -- source start parameter
    and ep.created_at < to_timestamp_ntz('2026-08-20 00:00:00') -- source end parameter
    and lower(ep.name::varchar) in ('game_start', 'game_end', 'ad_impression_interstitial', 'ad_impression_rewarded', 'store_product_purchase_success')
), date_range_events as (
  select *
  from scoped_events
  where created_at >= to_timestamp_ntz('2026-08-10 00:00:00') -- report start parameter
    and created_at < to_timestamp_ntz('2026-08-20 00:00:00') -- report end parameter
), d0_date_range_events as (
  select *
  from date_range_events
  where cohort_day = 0
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
  from d0_date_range_events
  where event_name in ('game_start', 'game_end', 'ad_impression_interstitial')
), first_ads as (
  select user_id, current_level as level, date_trunc('hour', created_at) as first_ad_hour
  from level_context
  where event_name = 'ad_impression_interstitial'
    and current_level is not null
  qualify row_number() over (partition by user_id order by created_at) = 1
), eligible_users as (
  select count(distinct user_id) as eligible_user_count
  from d0_date_range_events
  where event_name = 'game_end'
), first_ad_summary as (
  select
    coalesce(median(level), null)::float as median_level,
    count(*) as observed_first_ads
  from first_ads
), first_ad_hourly as (
  select first_ad_hour, median(level)::float as median_level, count(distinct user_id) as users
  from first_ads
  group by 1
  having count(distinct user_id) > 100 -- hourly first-ad sample floor
), hourly_density as (
  select
    date_trunc('hour', created_at) as event_hour,
    count_if(event_name = 'ad_impression_interstitial') as interstitial_impressions,
    count_if(event_name = 'ad_impression_rewarded') as rewarded_impressions,
    count_if(event_name = 'game_end') as completed_games,
    count(distinct iff(event_name = 'game_end', user_id, null)) as eligible_users
  from scoped_events
  where created_at >= to_timestamp_ntz('2026-08-17 00:00:00') -- density start parameter
    and created_at < to_timestamp_ntz('2026-08-19 01:00:00') -- density end parameter
  group by 1
), no_ads_hourly as (
  select
    date_trunc('hour', created_at) as event_hour,
    count(*) as purchase_events,
    count(distinct user_id) as purchasers
  from date_range_events
  where event_name = 'store_product_purchase_success'
    and item_type = 'no_ads'
  group by 1
), no_ads_summary as (
  select count(*) as purchase_events, count(distinct user_id) as purchasers
  from date_range_events
  where event_name = 'store_product_purchase_success'
    and item_type = 'no_ads'
)
select
  'first_ad_summary' as row_type,
  'first_ad' as row_key,
  null::varchar as event_hour,
  null::int as level,
  fas.median_level as metric_value,
  fas.observed_first_ads::int as event_count,
  eu.eligible_user_count::int as user_count
from first_ad_summary fas cross join eligible_users eu
union all
select
  'first_ad_hourly' as row_type,
  'first_ad' as row_key,
  to_varchar(first_ad_hour, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_hour,
  null::int as level,
  median_level as metric_value,
  users::int as event_count,
  users::int as user_count
from first_ad_hourly
union all
select
  'density' as row_type,
  'fipg' as row_key,
  to_varchar(h.event_hour, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_hour,
  null::int as level,
  coalesce(d.interstitial_impressions, 0) / nullif(coalesce(d.completed_games, 0), 0)::float as metric_value,
  coalesce(d.completed_games, 0)::int as event_count,
  coalesce(d.eligible_users, 0)::int as user_count
from hours h left join hourly_density d on d.event_hour = h.event_hour
union all
select
  'density' as row_type,
  'ripg' as row_key,
  to_varchar(h.event_hour, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_hour,
  null::int as level,
  coalesce(d.rewarded_impressions, 0) / nullif(coalesce(d.completed_games, 0), 0)::float as metric_value,
  coalesce(d.completed_games, 0)::int as event_count,
  coalesce(d.eligible_users, 0)::int as user_count
from hours h left join hourly_density d on d.event_hour = h.event_hour
union all
select
  'no_ads_summary' as row_type,
  'no_ads' as row_key,
  null::varchar as event_hour,
  null::int as level,
  nas.purchase_events::float as metric_value,
  nas.purchase_events::int as event_count,
  nas.purchasers::int as user_count
from no_ads_summary nas
union all
select
  'no_ads_hourly' as row_type,
  'no_ads' as row_key,
  to_varchar(h.event_hour, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_hour,
  null::int as level,
  coalesce(n.purchase_events, 0)::float as metric_value,
  coalesce(n.purchase_events, 0)::int as event_count,
  coalesce(n.purchasers, 0)::int as user_count
from report_hours h left join no_ads_hourly n on n.event_hour = h.event_hour
order by row_type, row_key, event_hour, level;
