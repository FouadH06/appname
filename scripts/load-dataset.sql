-- M14 load check: commits the launch-scale M12 dataset (≈ 105 businesses) into the LOCAL database.
--   docker cp supabase/tests/helpers <db-container>:/tmp/ && docker cp scripts/load-dataset.sql <db-container>:/tmp/
--   docker exec -w /tmp <db-container> psql -U postgres -f /tmp/load-dataset.sql
-- Remove it afterwards with `npx supabase db reset`.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\ir helpers/fixtures.psql
\ir helpers/search_dataset.psql
select tests.search_dataset(1) as businesses;
