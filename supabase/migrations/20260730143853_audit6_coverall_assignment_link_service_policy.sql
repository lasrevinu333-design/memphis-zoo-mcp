begin;

drop policy if exists coverall_assignment_links_service_all on public.coverall_assignment_links;
create policy coverall_assignment_links_service_all
  on public.coverall_assignment_links
  for all
  to service_role
  using (true)
  with check (true);

commit;
