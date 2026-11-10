CREATE TABLE public.event_deliveries (
  event_id bigint NOT NULL REFERENCES public.event_outbox(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.event_subscriptions(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  delivered_at timestamptz,
  gave_up_at timestamptz,
  last_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, subscription_id)
);
CREATE INDEX event_deliveries_due ON public.event_deliveries (next_attempt_at) WHERE delivered_at IS NULL AND gave_up_at IS NULL;
CREATE INDEX event_deliveries_sub ON public.event_deliveries (subscription_id);
ALTER TABLE public.event_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_deliveries FROM anon, authenticated;
GRANT ALL ON public.event_deliveries TO service_role;

-- Claims due deliveries for one pass; a claimed row is skipped by any concurrent pass until its lock expires.
CREATE OR REPLACE FUNCTION public.claim_event_deliveries(p_limit integer, p_lock_seconds integer DEFAULT 60)
RETURNS SETOF public.event_deliveries
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE event_deliveries d
     SET locked_until = now() + make_interval(secs => p_lock_seconds)
   WHERE (d.event_id, d.subscription_id) IN (
     SELECT event_id, subscription_id FROM event_deliveries
      WHERE delivered_at IS NULL AND gave_up_at IS NULL
        AND next_attempt_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY event_id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED)
  RETURNING d.*;
$$;
REVOKE ALL ON FUNCTION public.claim_event_deliveries(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_event_deliveries(integer, integer) TO service_role;