with source_events as (
  select
    ep.app_version,
    ep.platform,
    ep.name,
    ep.created_at,
    ep.payload
  from (
    select * from tds_db.raw.ludios_telemetry_events_production where app_id in (3001, 3003, 3004, 3005, 3006, 3008, 3011, 3012, 3013)
    union all
    select * from tds_db.raw.telemetry_events_production where app_id in (18, 22, 117, 122)
  ) ep
  where ep.app_id = 122 -- modifiable parameter
    and ep.platform = 'android' -- modifiable parameter
    and ep.name in (
      'Telemetry_FPS_Average',
      'Telemetry_FPS_Stability',
      'Telemetry_First_Load_Time',
      'Telemetry_Runtime_Memory_Use',
      'Telemetry_Subsequent_Load_Time',
      'Telemetry_Battery_Consumption',
      'Telemetry_ThermalState'
    )
    and ep.created_at >= current_date() - 7 -- modifiable parameter
    and ep.created_at < dateadd(day, 1, current_date()) -- modifiable parameter
    and ep.app_version = '1.0.0' -- modifiable parameter
), telemetry_events as (
  select
    name,
    case
      when name = 'Telemetry_ThermalState' and payload:value_string = 'Nominal' then 1
      when name = 'Telemetry_ThermalState' and payload:value_string = 'Fair' then 2
      when name = 'Telemetry_ThermalState' and payload:value_string = 'Serious' then 3
      when name = 'Telemetry_ThermalState' and payload:value_string = 'Critical' then 4
      else payload:value_float::float
    end as value
  from source_events ep
), valid_events as (
  select name, value
  from telemetry_events
  where value > 0 and value is not null
), benchmarks as (
  select name, metric_title, benchmark from (values
    ('Telemetry_First_Load_Time', 'First Load Time', 12000),
    ('Telemetry_Subsequent_Load_Time', 'Subsequent Load Time', 8000),
    ('Telemetry_FPS_Average', 'FPS Average', 50),
    ('Telemetry_FPS_Stability', 'FPS Instability (%)', 15),
    ('Telemetry_Runtime_Memory_Use', 'Runtime Memory', 800),
    ('Telemetry_ThermalState', 'Thermal State', 2)
  ) as t(name, metric_title, benchmark)
), metric_stats as (
  select
    e.name,
    b.metric_title,
    case
      when e.name = 'Telemetry_FPS_Average' then avg(case when e.value >= b.benchmark then 1.0 else 0.0 end)
      else avg(case when e.value <= b.benchmark then 1.0 else 0.0 end)
    end as pct_of_sample,
    case
      when e.name = 'Telemetry_FPS_Average' then avg(case when e.value >= b.benchmark * 0.9 then 1.0 else 0.0 end)
      else avg(case when e.value <= b.benchmark * 1.15 then 1.0 else 0.0 end)
    end as pct_of_sample_w_tolerance,
    median(e.value) as p50_value,
    percentile_cont(0.8) within group (order by e.value) as p80_value,
    b.benchmark,
    count(*) as num_sample
  from valid_events e
  join benchmarks b using (name)
  group by e.name, b.metric_title, b.benchmark
)
select
  name,
  metric_title,
  pct_of_sample,
  pct_of_sample_w_tolerance,
  p50_value,
  p80_value,
  benchmark,
  num_sample,
  case
    when num_sample < 100 then 'insufficient data'
    when pct_of_sample_w_tolerance >= 0.8 then 'green'
    when pct_of_sample_w_tolerance between 0.5 and 0.8 then 'yellow'
    else 'red'
  end as verdict
from metric_stats
