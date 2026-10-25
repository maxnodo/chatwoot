CREATE INDEX IF NOT EXISTS nodo_coc_recurring_news_assistant
  ON public.nodo_coc_recurring_news_schedules (assistant_id);
CREATE INDEX IF NOT EXISTS nodo_coc_recurring_news_inbox
  ON public.nodo_coc_recurring_news_schedules (inbox_id);
CREATE INDEX IF NOT EXISTS nodo_coc_recurring_news_contact_id
  ON public.nodo_coc_recurring_news_schedules (contact_id);
CREATE INDEX IF NOT EXISTS nodo_coc_recurring_news_contact_inbox
  ON public.nodo_coc_recurring_news_schedules (contact_inbox_id);
CREATE INDEX IF NOT EXISTS nodo_coc_recurring_news_events_run
  ON public.nodo_coc_recurring_news_events (run_id);
