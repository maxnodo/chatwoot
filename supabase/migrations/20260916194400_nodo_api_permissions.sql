-- Chatwoot tables are accessed through Rails; anonymous Data API access is not needed.
REVOKE ALL ON TABLE public.automation_rule_pending_executions, public.conversation_outcomes,
  public.campaign_recipients FROM PUBLIC, anon, authenticated;
ALTER TABLE public.automation_rule_pending_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
-- New Rails migrations run as postgres: keep future tables private by default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.nodo_protect_installation_configs(), public.nodo_log_installation_config_changes()
  FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.accounts_after_insert_row_tr() SET search_path = public, pg_temp;
ALTER FUNCTION public.camp_dpid_before_insert() SET search_path = public, pg_temp;
ALTER FUNCTION public.campaigns_before_insert_row_tr() SET search_path = public, pg_temp;
ALTER FUNCTION public.conversations_before_insert_row_tr() SET search_path = public, pg_temp;
