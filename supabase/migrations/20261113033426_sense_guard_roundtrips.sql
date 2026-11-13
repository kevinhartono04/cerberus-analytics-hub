-- Same atomic guard operations, executed next to the data in one round trip.
-- Invoker privileges only; these are private worker functions, not Data API RPCs.
CREATE FUNCTION cerebral.reserve_sense_transfer(p_key text,p_token text,p_job_limit bigint,p_day_limit bigint,p_reservation bigint,p_reserved_ms bigint,p_max_ms bigint)
RETURNS TABLE(reserved boolean,reason text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=cerebral,pg_catalog AS $$
DECLARE current_job record; bucket record; day_key text; job_scope text; budget_limit bigint; stop text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('sense:transfer-budget',0));
 SELECT read_bytes,paused,state->>'status' AS status INTO current_job FROM cerebral.sense_queue_jobs WHERE job_key=p_key AND expires_at>now();
 IF NOT FOUND OR current_job.paused OR current_job.status<>'running' THEN RETURN QUERY SELECT false,NULL::text; RETURN; END IF;
 day_key:='day:'||(now() AT TIME ZONE 'Asia/Jakarta')::date::text; job_scope:='job:'||p_key;
 INSERT INTO cerebral.sense_transfer_budgets(scope,charged_bytes,measured_bytes) VALUES(job_scope,current_job.read_bytes,current_job.read_bytes),(day_key,0,0) ON CONFLICT(scope) DO NOTHING;
 FOR bucket IN SELECT * FROM cerebral.sense_transfer_budgets WHERE scope IN (job_scope,day_key) ORDER BY scope FOR UPDATE LOOP
  budget_limit:=CASE WHEN bucket.scope=day_key THEN p_day_limit ELSE p_job_limit END;
  stop:=bucket.stop_reason;
  IF stop IS NULL AND bucket.charged_bytes+p_reservation>budget_limit THEN
   stop:='Sense transfer budget reached ('||CASE WHEN bucket.scope=day_key THEN 'all checks today, WIB' ELSE 'this check' END||'); paused for review.';
  END IF;
  IF stop IS NULL AND bucket.scope=job_scope AND (bucket.processing_ms>=p_max_ms OR bucket.stalled_steps>=3) THEN
   stop:='Sense safety stop: repeated steps without progress or excessive processing time.';
  END IF;
  IF stop IS NOT NULL THEN
   UPDATE cerebral.sense_transfer_budgets SET stop_reason=stop,updated_at=now() WHERE scope=bucket.scope;
   RETURN QUERY SELECT false,stop; RETURN;
  END IF;
 END LOOP;
 UPDATE cerebral.sense_transfer_budgets SET charged_bytes=charged_bytes+p_reservation,processing_ms=processing_ms+p_reserved_ms,updated_at=now() WHERE scope IN (job_scope,day_key);
 INSERT INTO cerebral.sense_transfer_reservations(token,job_key,day_scope,reserved_bytes) VALUES(p_token,p_key,day_key,p_reservation);
 RETURN QUERY SELECT true,NULL::text;
END $$;
CREATE FUNCTION cerebral.settle_sense_transfer(p_token text,p_bytes bigint,p_elapsed bigint,p_progressed boolean,p_reserved_ms bigint)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=cerebral,pg_catalog AS $$
DECLARE receipt record; measured bigint; charged bigint; elapsed bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('sense:transfer-budget',0));
 SELECT job_key,day_scope,reserved_bytes INTO receipt FROM cerebral.sense_transfer_reservations WHERE token=p_token AND settled_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 measured:=greatest(0,p_bytes);
 charged:=CASE WHEN p_progressed IS FALSE THEN greatest(measured,receipt.reserved_bytes) ELSE measured END;
 elapsed:=greatest(CASE WHEN p_progressed IS FALSE THEN p_reserved_ms ELSE 0 END,p_elapsed);
 UPDATE cerebral.sense_transfer_budgets SET charged_bytes=charged_bytes-receipt.reserved_bytes+charged,
  measured_bytes=measured_bytes+measured,processing_ms=processing_ms-p_reserved_ms+elapsed,
  stalled_steps=CASE WHEN scope='job:'||receipt.job_key AND p_progressed IS NOT NULL THEN CASE WHEN p_progressed THEN 0 ELSE stalled_steps+1 END ELSE stalled_steps END,updated_at=now()
  WHERE scope IN ('job:'||receipt.job_key,receipt.day_scope);
 UPDATE cerebral.sense_transfer_reservations SET measured_bytes=measured,elapsed_ms=elapsed,settled_at=now() WHERE token=p_token;
END $$;
ALTER FUNCTION cerebral.reserve_sense_transfer(text,text,bigint,bigint,bigint,bigint,bigint) OWNER TO cerebral_app;
ALTER FUNCTION cerebral.settle_sense_transfer(text,bigint,bigint,boolean,bigint) OWNER TO cerebral_app;
REVOKE ALL ON FUNCTION cerebral.reserve_sense_transfer(text,text,bigint,bigint,bigint,bigint,bigint),cerebral.settle_sense_transfer(text,bigint,bigint,boolean,bigint) FROM PUBLIC,anon,authenticated,service_role;
