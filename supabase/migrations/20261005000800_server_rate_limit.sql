-- =============================================================================
-- Migration 0800: rate limiting callable by trusted server code (service_role)
-- for public endpoints that run before submit_requisition (e.g. issuing signed
-- receipt-upload URLs on the external form).
-- =============================================================================
create or replace function public.consume_rate_limit(p_bucket text, p_max int, p_window_seconds int)
returns boolean language sql security definer set search_path = public, pg_temp as $$
  select private.check_rate_limit(left(p_bucket, 200), greatest(p_max, 1), make_interval(secs => greatest(p_window_seconds, 1)))
$$;

-- Resolve an external form token to its id (trusted server code only).
create or replace function public.resolve_form_token_id(p_token text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select (private.resolve_form_token(p_token)).id
$$;

revoke all on function public.consume_rate_limit(text, int, int) from public, anon, authenticated;
revoke all on function public.resolve_form_token_id(text) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, int, int) to service_role;
grant execute on function public.resolve_form_token_id(text) to service_role;
