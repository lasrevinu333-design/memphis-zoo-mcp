// Diagnostics for the disposable authenticated HTTP-to-SQL fixture only.
// Never return SQL values, arguments, credential data or error text.
export function recurringHttpSqlBoundary(sql) {
 if(sql==='begin'||sql==='commit'||sql==='rollback')return sql;
 if(sql==='set local role static_weekly_control_plane')return 'set_local_role';
 if(sql==='select public.custodial_begin_application_mutation()')return 'restore_generation_fence';
 if(/^select pg_catalog\.pg_advisory_xact_lock\(/.test(sql))return 'authority_lock';
 const rpc=/^select public\.(static_weekly_[a-z0-9_]+)\(/.exec(sql);
 return rpc?.[1]??null;
}
