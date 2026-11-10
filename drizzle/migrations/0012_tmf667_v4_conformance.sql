ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS external_identifier jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.integration_clients ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.integration_clients ADD COLUMN IF NOT EXISTS last_rate_limited_at timestamptz;
UPDATE public.integration_clients SET expires_at = created_at + interval '12 months' WHERE expires_at IS NULL;

CREATE TABLE public.api_rate (
  client_id uuid NOT NULL REFERENCES public.integration_clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('read','write')),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, kind, window_start)
);
GRANT ALL ON public.api_rate TO service_role;
ALTER TABLE public.api_rate ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.integration_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.integration_clients(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.integration_tokens TO service_role;
ALTER TABLE public.integration_tokens ENABLE ROW LEVEL SECURITY;

-- Counts one request in the current minute and returns the new count (atomic).
CREATE OR REPLACE FUNCTION public.api_hit(p_client uuid, p_kind text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO api_rate(client_id, kind, window_start, hits)
  VALUES (p_client, p_kind, date_trunc('minute', now()), 1)
  ON CONFLICT (client_id, kind, window_start) DO UPDATE SET hits = api_rate.hits + 1
  RETURNING hits INTO n;
  DELETE FROM api_rate WHERE window_start < now() - interval '10 minutes';
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.api_hit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_hit(uuid, text) TO service_role;