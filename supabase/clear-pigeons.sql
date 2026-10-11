-- Administrator only: run in this project's Supabase SQL Editor.
-- Permanently deletes all shared pigeons, including faces and speech.
-- Keep request tombstones so old creation retries cannot resurrect deleted birds.
begin;
select pg_advisory_xact_lock(999940);
with removed as (
  delete from public.pigeons returning id
)
select count(*) as deleted_pigeons from removed;
commit;
