with bs as (  
  SELECT
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
    app_version,
    ep.platform,
    ep.public_user_id as user_id,
    name,
    CASE
      WHEN name = 'Telemetry_ThermalState' and payload:value_string = 'Nominal' then 1
      WHEN name = 'Telemetry_ThermalState' and payload:value_string = 'Fair' then 2
      WHEN name = 'Telemetry_ThermalState' and payload:value_string = 'Serious' then 3
      WHEN name = 'Telemetry_ThermalState' and payload:value_string = 'Critical' then 4
      ELSE payload:value_float::float
    END as value,
    cume_dist() over (partition by name order by value) as cumulative_dist,
  from (
      select * from tds_db.raw.ludios_telemetry_events_production where app_id in (3001, 3003, 3004, 3005, 3006, 3011)
          union all
      select * from tds_db.raw.telemetry_events_production where app_id in (18,22,117,122)
  ) ep  
  WHERE
    app_name = 'wordblast' -- modifiable parameter
    and ep.platform = 'android' -- modifiable parameter
    and ep.name IN (
      'Telemetry_FPS_Average',
      'Telemetry_FPS_Stability',
      'Telemetry_First_Load_Time',
      'Telemetry_Runtime_Memory_Use',
      'Telemetry_Subsequent_Load_Time',
      'Telemetry_Battery_Consumption',
      'Telemetry_ThermalState'
    )
    and ep.created_at::date between current_date()-7 and current_date() -- modifiable parameter
    and app_version = '1.0.0' -- modifiable parameter
    and value > 0
    and value is not null
)

, raw as (
  select
    app_name,
    platform,
    app_version,
    user_id,
    name,
    CASE
      WHEN value IS NULL THEN NULL
      WHEN value = 0     THEN 0
      ELSE 
        ROUND(
          value,
          3 
          - FLOOR(LOG(10, ABS(value)))  -- base-10 order of magnitude
          - 1
        )
    END AS norm_value,
    avg(cumulative_dist) as cume_dist,
    lag(cume_dist) over (partition by name order by norm_value) as prev_cume_dist,
    cume_dist - prev_cume_dist as pct_dist
  from
    BS
  group by
    1,2,3,4,5,6
  order by
    name, norm_value
)

, bch as (
  select name, metric_title, benchmark from (values
    ('Telemetry_First_Load_Time', 'First Load Time', 12000),
    ('Telemetry_Subsequent_Load_Time', 'Subsequent Load Time', 8000),
    ('Telemetry_FPS_Average', 'FPS Average', 50),
    ('Telemetry_FPS_Stability', 'FPS Instability (%)', 15),
    ('Telemetry_Runtime_Memory_Use', 'Runtime Memory', 800),
    ('Telemetry_ThermalState', 'Thermal State', 2)
  ) as t(name, metric_title, benchmark)
)

SELECT name, metric_title
  , case
      when name = 'Telemetry_FPS_Average' then 1-min(case when norm_value >= benchmark then CUME_DIST end)
    else
      max(case when norm_value <= benchmark then CUME_DIST end) 
    end pct_of_sample
  , case
      when name = 'Telemetry_FPS_Average' then 1-min(case when norm_value >= benchmark * 0.9 then CUME_DIST end)
    else
      max(case when norm_value <= benchmark * 1.15 then CUME_DIST end) 
    end pct_of_sample_w_tolerance
  , median(norm_value) p50_value
  , percentile_cont(0.8) within group(order by norm_value) p80_value
  , min(benchmark) benchmark
  , count(1) num_sample
  , case when num_sample < 50 then 'insufficient data'
      else 
        case when pct_of_sample_w_tolerance >= 0.8 then 'green'
          when pct_of_sample_w_tolerance between 0.5 and 0.8 then 'yellow'
        else 'red'
        end
    end verdict
FROM raw
join bch using(name)
group by 1,2
