begin;

-- The production ledger recorded manager notification schema and runtime
-- separately. The preceding canonical migration is an idempotent combined
-- implementation; this marker keeps repository and Supabase versions aligned.

commit;
