begin;

create index if not exists idx_msg_thread_deletion_operations_user
  on public.msg_thread_deletion_operations(user_id,deleted_at desc);

comment on index public.idx_msg_thread_deletion_operations_user is
  'Covers deletion-ledger user cleanup and audit lookups, including the msg_users foreign key.';

commit;
