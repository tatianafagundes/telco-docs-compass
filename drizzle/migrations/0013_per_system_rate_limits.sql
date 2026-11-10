ALTER TABLE public.integration_clients
  ADD COLUMN IF NOT EXISTS read_limit_per_minute integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS write_limit_per_minute integer NOT NULL DEFAULT 30;
ALTER TABLE public.integration_clients
  ADD CONSTRAINT integration_clients_read_limit_range CHECK (read_limit_per_minute BETWEEN 1 AND 6000),
  ADD CONSTRAINT integration_clients_write_limit_range CHECK (write_limit_per_minute BETWEEN 1 AND 1000);