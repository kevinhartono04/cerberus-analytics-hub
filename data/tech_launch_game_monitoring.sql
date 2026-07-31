with recursive calendar(event_date) as (
  select to_date('2026-07-24') -- modifiable parameter
  union all
  select dateadd(day, 1, event_date)
  from calendar
  where event_date < to_date('2026-07-31') -- modifiable parameter
), hours as (
  select seq4()::integer as event_hour from table(generator(rowcount => 24))
), platforms as (
  select column1::string as platform from values ('android') -- modifiable parameter
), cohorts as (
  select 'd0' as cohort_segment union all select 'd1_plus' as cohort_segment
), source_events as (
  select
    ep.created_at::date as event_date,
    date_part(hour, ep.created_at)::integer as event_hour,
    ep.created_at,
    ep.platform::string as platform,
    ep.name::string as event_name,
    ep.user_id::string as user_id,
    try_to_number(ep.cohort_day) as cohort_day
  from public.events_production_ludios_union ep
  join platforms p on p.platform = ep.platform
  where ep.app_id = 122 -- modifiable parameter
    and ep.app_version in ('1.0.0') -- modifiable parameter
    and ep.created_at >= current_date() - 7 -- modifiable parameter
    and ep.created_at < dateadd(day, 1, current_date()) -- modifiable parameter
    and ep.created_at <= current_timestamp()
    and ep.user_id is not null
    and try_to_number(ep.cohort_day) >= 0
    and lower(coalesce(ep.name::string, '')) not like '%test%'
    and lower(coalesce(ep.name::string, '')) not like '%debug%'
    and lower(coalesce(ep.name::string, '')) not like '%qa%'
), segmented_events as (
  select *, iff(cohort_day = 0, 'd0', 'd1_plus') as cohort_segment
  from source_events
), d0_first_seen as (
  select event_date, platform, user_id, min(created_at) as first_event_at
  from segmented_events
  where cohort_segment = 'd0'
  group by 1, 2, 3
), hourly_installs as (
  select
    event_date,
    platform,
    date_part(hour, first_event_at)::integer as event_hour,
    count(*) as install_users
  from d0_first_seen
  group by 1, 2, 3
), hourly_metrics as (
  select
    event_date,
    platform,
    event_hour,
    cohort_segment,
    count(distinct user_id) as hourly_active_users,
    count_if(event_name = 'Store_Product_Purchase_Success') as purchase_success_events,
    count(distinct iff(event_name = 'Store_Product_Purchase_Success', user_id, null)) as purchasers,
    count_if(event_name = 'Session_Start') as session_start_events,
    count_if(event_name = 'Game_Start') as game_start_events,
    count(distinct iff(event_name = 'Session_Start', user_id, null)) as session_start_users,
    count(distinct iff(event_name = 'Game_Start', user_id, null)) as game_start_users,
    count_if(event_name = 'Ad_Impression_Interstitial') as interstitial_impressions,
    count_if(event_name = 'Ad_Impression_Rewarded') as rewarded_impressions,
    count_if(event_name = 'Ad_Impression_Banner') as banner_impressions
  from segmented_events
  group by 1, 2, 3, 4
), hourly_grid as (
  select
    c.event_date,
    p.platform,
    h.event_hour,
    s.cohort_segment,
    coalesce(m.hourly_active_users, 0) as hourly_active_users,
    iff(s.cohort_segment = 'd0', coalesce(i.install_users, 0), 0) as install_users,
    coalesce(m.purchase_success_events, 0) as purchase_success_events,
    coalesce(m.purchasers, 0) as purchasers,
    coalesce(m.session_start_events, 0) as session_start_events,
    coalesce(m.game_start_events, 0) as game_start_events,
    coalesce(m.session_start_users, 0) as session_start_users,
    coalesce(m.game_start_users, 0) as game_start_users,
    coalesce(m.interstitial_impressions, 0) as interstitial_impressions,
    coalesce(m.rewarded_impressions, 0) as rewarded_impressions,
    coalesce(m.banner_impressions, 0) as banner_impressions
  from calendar c cross join platforms p cross join hours h cross join cohorts s
  left join hourly_metrics m on m.event_date = c.event_date and m.platform = p.platform and m.event_hour = h.event_hour and m.cohort_segment = s.cohort_segment
  left join hourly_installs i on i.event_date = c.event_date and i.platform = p.platform and i.event_hour = h.event_hour and s.cohort_segment = 'd0'
), freshness as (
  select max(created_at) as last_event_at from source_events
)
select
  event_date::varchar as event_date,
  platform,
  event_hour,
  cohort_segment,
  hourly_active_users,
  install_users,
  sum(install_users) over (partition by event_date, platform order by event_hour rows between unbounded preceding and current row) as cumulative_installs,
  purchase_success_events,
  purchasers,
  purchasers / nullif(hourly_active_users, 0)::float as payer_rate,
  session_start_events,
  game_start_events,
  session_start_users,
  game_start_users,
  game_start_users / nullif(session_start_users, 0)::float as game_start_rate,
  game_start_users / nullif(hourly_active_users, 0)::float as game_start_active_rate,
  interstitial_impressions,
  rewarded_impressions,
  banner_impressions,
  interstitial_impressions / nullif(hourly_active_users, 0)::float as fipu,
  rewarded_impressions / nullif(hourly_active_users, 0)::float as ripu,
  banner_impressions / nullif(hourly_active_users, 0)::float as bipu,
  f.last_event_at::varchar as last_event_at
from hourly_grid g cross join freshness f
where g.event_date < current_date()
   or (g.event_date = current_date() and g.event_hour <= date_part(hour, current_timestamp()))
order by event_date asc, platform asc, cohort_segment asc, event_hour asc
