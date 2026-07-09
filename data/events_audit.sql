with
params as (
    select
        to_date('2026-07-01') as start_date, -- modifiable parameter
        to_date('2026-07-08') as end_date, -- modifiable parameter
        3003 as app_id, -- modifiable parameter
        '0.04.13' as app_version, -- modifiable parameter
        null::string as platform -- modifiable parameter
),

events as (
    select
        e.created_at,
        e.app_version,
        e.name::string as event_name,
        lower(regexp_replace(e.name::string, '[^a-zA-Z0-9]', '')) as event_name_norm,
        e.app_id,
        e.payload,
        e.platform,
        e.event_id
    from TDS_DB.PUBLIC.EVENTS_PRODUCTION_LUDIOS_UNION e
    join params p on 1=1
    where e.created_at::date >= p.start_date
      and e.created_at::date <= p.end_date
      and e.app_id = p.app_id
      and e.app_version = p.app_version
      and (p.platform is null or lower(e.platform) = lower(p.platform))
      and lower(e.name) not like '%test%'
      and lower(e.name) not like '%debug%'
      and lower(e.name) not like '%qa%'
      and upper(e.name) in (
        'AD_CALL_INTERSTITIAL','AD_CALL_REWARDED',
        'AD_CLICK_INTERSTITIAL','AD_CLICK_REWARDED',
        'AD_CLOSE_INTERSTITIAL','AD_CLOSE_REWARDED',
        'AD_IMPRESSION_INTERSTITIAL','AD_IMPRESSION_REWARDED',
        'CURRENCY_TRANSACTION','EVENT_COMPLETE','EVENT_DELIVERY','EVENT_END',
        'EVENT_PROGRESS','EVENT_START','GAME_END','GAME_START',
        'ITEM_TRANSACTION','OBJECTIVE_COMPLETE','OBJECTIVE_END',
        'OBJECTIVE_PROGRESS','OBJECTIVE_START','STAGE_END','STAGE_START','STORE_PRODUCT_PURCHASE_SUCCESS',
        'STORE_PRODUCT_PURCHASE_FAILURE','STORE_PRODUCT_PURCHASE_STARTED',
        'SCREEN_SHOWN','SCREEN_INTERACTION',
        'STORE_OPEN','SIGN_IN_CLICK','SIGN_IN_SUCCESS','SIGN_IN_FAILED','SIGN_OUT_SUCCESS','JOURNEY_LEVEL_WON'
      )
),

event_profile as (
    select
        'event' as row_type,
        event_name,
        event_name_norm,
        null::string as payload_name,
        null::string as payload_name_norm,
        null::string as observed_type,
        count(*) as event_count,
        null::number as payload_count,
        null::number as distinct_value_count,
        min(created_at)::varchar as first_seen,
        max(created_at)::varchar as last_seen,
        null::number as max_length,
        null::string as example_values,
        null::string as enum_value_counts,
        null::number as enum_value_rank_count
    from events
    group by event_name, event_name_norm
),

payload_values as (
    select
        e.event_name,
        e.event_name_norm,
        f.key::string as payload_name,
        lower(regexp_replace(f.key::string, '[^a-zA-Z0-9]', '')) as payload_name_norm,
        to_varchar(f.value) as payload_value,
        e.created_at
    from events e,
         lateral flatten(input => e.payload) f
    where f.key is not null
      and f.key not ilike '%/storage/emulated%'
      and to_varchar(f.value) is not null
      and to_varchar(f.value) != ''
      and to_varchar(f.value) != 'null'
),

payload_typed_values as (
    select
        event_name,
        event_name_norm,
        payload_name,
        payload_name_norm,
        payload_value,
        created_at,
        case
            when lower(payload_value) in ('yes','no','0','1','true','false') then 'boolean'
            when try_cast(payload_value as integer) is not null then 'integer'
            when try_cast(payload_value as float) is not null then 'float'
            when try_cast(payload_value as timestamp) is not null then 'timestamp'
            else 'string'
        end as observed_type
    from payload_values
),

payload_type_counts as (
    select
        event_name,
        event_name_norm,
        payload_name,
        payload_name_norm,
        observed_type,
        count(*) as type_count
    from payload_typed_values
    group by 1,2,3,4,5
),

payload_dominant_types as (
    select
        event_name,
        event_name_norm,
        payload_name,
        payload_name_norm,
        observed_type
    from payload_type_counts
    qualify row_number() over (
        partition by event_name, payload_name
        order by type_count desc, observed_type
    ) = 1
),

payload_examples as (
    select
        event_name,
        event_name_norm,
        payload_name,
        payload_name_norm,
        array_to_string(
            array_slice(array_agg(distinct payload_value) within group (order by payload_value), 0, 10),
            ' | '
        ) as example_values
    from payload_typed_values
    group by 1,2,3,4
),

enum_value_ranked as (
    select
        event_name,
        payload_name,
        payload_value as observed_value,
        count(*) as value_count,
        row_number() over (
            partition by event_name, payload_name
            order by count(*) desc, payload_value
        ) as value_rank
    from payload_typed_values
    where payload_name_norm in ('item', 'source', 'itemtype', 'placement') -- modifiable parameter
      and observed_type = 'string'
    group by 1,2,3
),

enum_value_agg as (
    select
        event_name,
        payload_name,
        array_to_string(
            array_agg(observed_value || ':::' || value_count)
                within group (order by value_count desc, observed_value),
            '|||'
        ) as enum_value_counts,
        count(*) as enum_value_rank_count
    from enum_value_ranked
    where value_rank <= 50
    group by 1,2
),

payload_profile as (
    select
        'payload' as row_type,
        v.event_name,
        v.event_name_norm,
        v.payload_name,
        v.payload_name_norm,
        max(t.observed_type) as observed_type,
        count(*) as event_count,
        count(*) as payload_count,
        count(distinct v.payload_value) as distinct_value_count,
        min(v.created_at)::varchar as first_seen,
        max(v.created_at)::varchar as last_seen,
        max(length(v.payload_value)) as max_length,
        max(e.example_values) as example_values,
        max(a.enum_value_counts) as enum_value_counts,
        max(a.enum_value_rank_count) as enum_value_rank_count
    from payload_typed_values v
    join payload_dominant_types t
      on v.event_name = t.event_name
     and v.payload_name = t.payload_name
    left join payload_examples e
      on v.event_name = e.event_name
     and v.payload_name = e.payload_name
    left join enum_value_agg a
      on v.event_name = a.event_name
     and v.payload_name = a.payload_name
    group by v.event_name, v.event_name_norm, v.payload_name, v.payload_name_norm
)

select
    row_type,
    event_name,
    event_name_norm,
    payload_name,
    payload_name_norm,
    observed_type,
    event_count,
    payload_count,
    distinct_value_count,
    first_seen,
    last_seen,
    max_length,
    example_values,
    enum_value_counts,
    enum_value_rank_count
from event_profile
union all
select
    row_type,
    event_name,
    event_name_norm,
    payload_name,
    payload_name_norm,
    observed_type,
    event_count,
    payload_count,
    distinct_value_count,
    first_seen,
    last_seen,
    max_length,
    example_values,
    enum_value_counts,
    enum_value_rank_count
from payload_profile
order by
    case row_type when 'event' then 0 else 1 end,
    case when event_name_norm in ('') then 0 else 1 end, -- modifiable parameter
    event_name,
    payload_name;
