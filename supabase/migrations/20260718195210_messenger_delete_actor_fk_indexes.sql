-- Cover the Messenger deletion-actor foreign keys so revocation and user
-- lifecycle operations do not require full scans of retained content.

create index if not exists idx_msg_messages_deleted_by_user_id_fkey
  on public.msg_messages(deleted_by_user_id)
  where deleted_by_user_id is not null;

create index if not exists idx_msg_threads_deleted_by_user_id_fkey
  on public.msg_threads(deleted_by_user_id)
  where deleted_by_user_id is not null;
