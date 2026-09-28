-- Local/dev seed data. Loaded by `supabase db reset` after migrations.
-- Reference data that production also needs (catalog, Lebanese areas, clusters) belongs in
-- migrations, not here (M1). This file is for fixtures only.

-- M7: let pg_cron reach the local notify-dispatch function (log mode: messages are printed)
select vault.create_secret('http://kong:8000/functions/v1/notify-dispatch', 'notify_dispatch_url');
select vault.create_secret('local-notify-dispatch-secret', 'notify_dispatch_secret');
