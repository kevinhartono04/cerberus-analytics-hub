with recursive hours(event_hour) as (
  select to_timestamp_ntz('2026-07-29 12:00:00') -- modifiable parameter
  union all
  select dateadd(hour, 1, event_hour)
  from hours
  where event_hour < to_timestamp_ntz('2026-07-30 00:00:00') -- modifiable parameter
), hourly_events as (
  select
    date_trunc('hour', ep.created_at) as event_hour,
    case
      when try_to_number(ep.cohort_day) = 0 then 'D0'
      when try_to_number(ep.cohort_day) between 1 and 7 then 'D1-D7'
      when try_to_number(ep.cohort_day) between 8 and 29 then 'D8-D29'
      when try_to_number(ep.cohort_day) >= 30 then 'D30+'
    end as cohort_group,
    count_if(lower(ep.name::string) = 'ad_impression_interstitial') as interstitial_impressions,
    count_if(lower(ep.name::string) = 'ad_impression_rewarded') as rewarded_impressions,
    count_if(lower(ep.name::string) = 'game_end') as completed_games
  from public.events_production_ludios_union ep
  where ep.app_id = 122 -- modifiable parameter
    and ep.platform in ('android') -- modifiable parameter
    and ep.app_version in ('1.0.0') -- modifiable parameter
    and ep.created_at >= to_timestamp_ntz('2026-07-29 12:00:00') -- modifiable parameter
    and ep.created_at < to_timestamp_ntz('2026-07-30 01:00:00') -- modifiable parameter
    and try_to_number(ep.cohort_day) >= 0
    and lower(ep.name::string) in ('ad_impression_interstitial', 'ad_impression_rewarded', 'game_end')
  group by 1, 2
), cohort_groups as (
  select column1::string as cohort_group
  from values ('D0'), ('D1-D7'), ('D8-D29'), ('D30+')
)
select
  to_varchar(h.event_hour, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_hour,
  c.cohort_group,
  coalesce(e.interstitial_impressions, 0) as interstitial_impressions,
  coalesce(e.rewarded_impressions, 0) as rewarded_impressions,
  coalesce(e.completed_games, 0) as completed_games,
  coalesce(e.interstitial_impressions, 0) / nullif(coalesce(e.completed_games, 0), 0)::float as fipg,
  coalesce(e.rewarded_impressions, 0) / nullif(coalesce(e.completed_games, 0), 0)::float as ripg
from hours h
cross join cohort_groups c
left join hourly_events e on e.event_hour = h.event_hour and e.cohort_group = c.cohort_group
order by h.event_hour asc, c.cohort_group asc
