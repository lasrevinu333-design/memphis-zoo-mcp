begin;

-- The historical production rollout split this foundation across schema,
-- data, and finalize ledger entries. The canonical repository keeps the
-- idempotent combined implementation in the immediately preceding schema
-- migration; this marker preserves the authoritative Supabase version chain
-- for fresh databases and normal CLI migration comparison.

commit;
