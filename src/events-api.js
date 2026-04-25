async function getPendingNotifications(runReadOnlySql) {
  const rows = await runReadOnlySql(`
    select *
    from (
      select
        e.id,
        e.event_name,
        e.location_group_id,
        e.event_date,
        e.start_time,
        e.end_time,
        e.attendee_count,
        e.notes,
        lg.group_code,
        lg.group_name,
        emp.id as employee_id,
        emp.display_name as employee_name,
        mu.id as msg_user_id,
        dga.coverage_start,
        dga.coverage_end,
        'day_before'::text as notification_kind,
        ((e.event_date::timestamp - interval '1 day') + time '${DAY_BEFORE_NOTIFICATION_TIME}') as scheduled_for_local,
        public.msg_get_memphis_user_id() as memphis_user_id
      from public.events_app_events e
      join public.location_groups lg on lg.id = e.location_group_id
      join public.daily_group_assignments dga
        on dga.location_group_id = e.location_group_id
       and dga.assignment_date = e.event_date
       and dga.active = true
       and dga.assigned_employee_id is not null
      join public.employees emp on emp.id = dga.assigned_employee_id and emp.active = true
      join public.msg_users mu on mu.employee_id = emp.id and mu.is_active = true
      where (now() at time zone '${EVENTS_TIME_ZONE}')::date = (e.event_date - interval '1 day')::date
        and (now() at time zone '${EVENTS_TIME_ZONE}') >= ((e.event_date::timestamp - interval '1 day') + time '${DAY_BEFORE_NOTIFICATION_TIME}')
        and not exists (
          select 1
          from public.events_app_notification_log log
          where log.event_id = e.id
            and log.employee_id = emp.id
            and log.notification_kind = 'day_before'
        )

      union all

      select
        e.id,
        e.event_name,
        e.location_group_id,
        e.event_date,
        e.start_time,
        e.end_time,
        e.attendee_count,
        e.notes,
        lg.group_code,
        lg.group_name,
        emp.id as employee_id,
        emp.display_name as employee_name,
        mu.id as msg_user_id,
        dga.coverage_start,
        dga.coverage_end,
        'shift_plus_fifteen'::text as notification_kind,
        (e.event_date::timestamp + dga.coverage_start + interval '15 minutes') as scheduled_for_local,
        public.msg_get_memphis_user_id() as memphis_user_id
      from public.events_app_events e
      join public.location_groups lg on lg.id = e.location_group_id
      join public.daily_group_assignments dga
        on dga.location_group_id = e.location_group_id
       and dga.assignment_date = e.event_date
       and dga.active = true
       and dga.assigned_employee_id is not null
       and dga.coverage_start is not null
      join public.employees emp on emp.id = dga.assigned_employee_id and emp.active = true
      join public.msg_users mu on mu.employee_id = emp.id and mu.is_active = true
      where (now() at time zone '${EVENTS_TIME_ZONE}')::date = e.event_date
        and (now() at time zone '${EVENTS_TIME_ZONE}') >= (e.event_date::timestamp + dga.coverage_start + interval '15 minutes')
        and not exists (
          select 1
          from public.events_app_notification_log log
          where log.event_id = e.id
            and log.employee_id = emp.id
            and log.notification_kind = 'shift_plus_fifteen'
        )
    ) pending
    order by pending.scheduled_for_local asc, pending.event_date asc, pending.event_name asc
    limit ${MAX_NOTIFICATIONS_PER_RUN}
  `);
  return Array.isArray(rows) ? rows : [];
}
