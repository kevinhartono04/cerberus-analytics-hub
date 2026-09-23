-- Adapted from the supplied Users Events Trace.sql. All timestamps are UTC.
-- EXISTS avoids multiplying events when a device appears in both mapping tables.
-- {{IDFV}}, {{FROM}}, {{THROUGH}} are validated by buildTraceSql, never Slack text.
WITH device_ids AS (
  SELECT external_id FROM RAW.LDS_GS_DEVICES WHERE LOWER(REPLACE(idfv, '-', '')) = '{{IDFV}}'
  UNION
  SELECT external_id FROM RAW.GS_DEVICES WHERE LOWER(REPLACE(idfv, '-', '')) = '{{IDFV}}'
), base AS (
  SELECT ep.created_at::timestamp_ntz AS event_at, ep.user_id::varchar AS user_id,
    ep.session_id::varchar AS session_id, ep.name,
    ep.argument_value::varchar AS argument, ep.argument_type::varchar AS argument_type,
    TRY_TO_DOUBLE(ep.argument_value::varchar) AS amount,
    IFF(ep.name = 'Currency_Transaction', COALESCE(ep.payload:currency::varchar, 'unknown currency'),
      COALESCE(ep.payload:itemtype::varchar, ep.payload:item::varchar, 'unknown item')) AS item,
    COALESCE(ep.payload:source::varchar, ep.payload:type::varchar, 'unknown') AS source,
    ep.payload:transaction_id::varchar AS transaction_id,
    TRY_TO_DOUBLE(ep.payload:dollar_value::varchar) AS dollar_value,
    COALESCE(TRY_TO_BOOLEAN(ep.offline::varchar), FALSE) AS offline
  FROM PUBLIC.EVENTS_PRODUCTION_LUDIOS_UNION ep
  WHERE ep.app_id = 3011
    AND ep.created_at >= '{{FROM}}'::timestamp_ntz AND ep.created_at <= '{{THROUGH}}'::timestamp_ntz
    AND ep.name IN ('Store_Product_Purchase_Success', 'Ad_Impression_Interstitial', 'Ad_Impression_Rewarded', 'Item_Transaction', 'Currency_Transaction')
    AND (ep.name <> 'Store_Product_Purchase_Success' OR ep.argument_value IS NOT NULL)
    AND EXISTS (SELECT 1 FROM device_ids dv WHERE dv.external_id = ep.external_id)
), purchases AS (
  SELECT *, 'purchase-' || LOWER(SUBSTR(SHA2(TO_CHAR(event_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') || ':' || argument || ':' || COALESCE(transaction_id, ''), 256), 1, 16)) AS id
  FROM base WHERE name = 'Store_Product_Purchase_Success'
), bounds AS (
  SELECT p.id, MAX(IFF(b.name = 'Ad_Impression_Interstitial' AND b.event_at < p.event_at, b.event_at, NULL)) AS last_before,
    MIN(IFF(b.name = 'Ad_Impression_Interstitial' AND b.event_at >= p.event_at, b.event_at, NULL)) AS first_after,
    COUNT_IF(b.name = 'Ad_Impression_Interstitial' AND b.event_at >= p.event_at) AS interstitial_after
  FROM purchases p LEFT JOIN base b ON TRUE GROUP BY p.id
), gaps AS (
  SELECT p.id, MAX(b.event_at) AS last_activity,
    COUNT(DISTINCT IFF(b.name <> 'Store_Product_Purchase_Success', b.event_at::date, NULL)) AS active_days,
    COUNT_IF(b.name <> 'Store_Product_Purchase_Success') AS activity,
    COUNT_IF(b.name = 'Ad_Impression_Rewarded') AS rewarded
  FROM purchases p JOIN bounds x ON x.id = p.id
  LEFT JOIN base b ON b.event_at >= p.event_at AND (x.first_after IS NULL OR b.event_at < x.first_after)
  GROUP BY p.id
), facts AS (
  SELECT 0 AS sort_order, OBJECT_CONSTRUCT_KEEP_NULL('kind', 'meta', 'from', '{{FROM}}', 'through', '{{THROUGH}}',
    'firstAt', TO_CHAR(MIN(event_at), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'),
    'lastAt', TO_CHAR(MAX(event_at), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'), 'eventCount', COUNT(*), 'users', COUNT(DISTINCT user_id),
    'invalidRows', COALESCE(COUNT_IF(
      (name IN ('Currency_Transaction', 'Item_Transaction') AND amount IS NULL)
      OR (name = 'Store_Product_Purchase_Success' AND
        (argument_type IS DISTINCT FROM 'product_id' OR NOT COALESCE(REGEXP_LIKE(argument, '^[0-9]+$'), FALSE)))
    ), 0)) AS fact
  FROM base
  UNION ALL
  SELECT 1, OBJECT_CONSTRUCT_KEEP_NULL('kind', 'purchase', 'id', p.id,
    'at', TO_CHAR(p.event_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'), 'productId', p.argument,
    'transactionId', p.transaction_id, 'dollarValue', p.dollar_value, 'session', p.session_id, 'offline', p.offline,
    'lastInterstitialBefore', TO_CHAR(x.last_before, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'),
    'firstInterstitialAfter', TO_CHAR(x.first_after, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'),
    'lastActivityBeforeReturn', TO_CHAR(g.last_activity, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'),
    'activeDaysBeforeReturn', g.active_days, 'activityBeforeReturn', COALESCE(g.activity, 0),
    'rewardedBeforeReturn', COALESCE(g.rewarded, 0), 'interstitialAfter', COALESCE(x.interstitial_after, 0))
  FROM purchases p JOIN bounds x ON x.id = p.id JOIN gaps g ON g.id = p.id
  UNION ALL
  SELECT 2, OBJECT_CONSTRUCT_KEEP_NULL('kind', 'daily', 'day', TO_CHAR(event_at::date, 'YYYY-MM-DD'), 'events', COUNT(*),
    'interstitials', COALESCE(COUNT_IF(name = 'Ad_Impression_Interstitial'), 0),
    'rewarded', COALESCE(COUNT_IF(name = 'Ad_Impression_Rewarded'), 0)) FROM base GROUP BY event_at::date
  UNION ALL
  SELECT 3, OBJECT_CONSTRUCT_KEEP_NULL('kind', 'resource', 'purchaseId', p.id, 'item', b.item, 'source', b.source,
    'direction', IFF(b.amount > 0, 'received', 'spent'), 'amount', SUM(ABS(b.amount)), 'count', COUNT(*),
    'firstAt', TO_CHAR(MIN(b.event_at), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'), 'lastAt', TO_CHAR(MAX(b.event_at), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'))
  FROM purchases p JOIN base b ON b.session_id = p.session_id AND ABS(DATEDIFF('millisecond', p.event_at, b.event_at)) <= 120000
    AND b.name IN ('Currency_Transaction', 'Item_Transaction') AND b.amount <> 0
  GROUP BY p.id, b.item, b.source, IFF(b.amount > 0, 'received', 'spent')
)
SELECT TO_JSON(fact) AS FACT, COUNT(*) OVER () AS TOTAL_FACTS FROM facts ORDER BY sort_order, FACT
