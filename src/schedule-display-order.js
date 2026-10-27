// Presentation only. Never feeds scheduling, workload or accepted source digests.
const label=row=>String(row?.name||row?.group_name||row?.location_name||row?.workSnapshot?.locationNameSnapshot||row?.work_snapshot?.locationNameSnapshot||'').trim();
export function isScheduleRestroom(item){
 return item?.is_public_restroom===true||/restroom|bathroom|toilet|comfort station|family room/i.test(label(item));
}
export function compareScheduleDisplayItems(left,right){
 const category=Number(isScheduleRestroom(right))-Number(isScheduleRestroom(left));
 return category||label(left).localeCompare(label(right),'en',{sensitivity:'base',numeric:true})
  ||String(left?.coverage_start||left?.window?.start||'').localeCompare(String(right?.coverage_start||right?.window?.start||''))
  ||String(left?.coverage_end||left?.window?.end||'').localeCompare(String(right?.coverage_end||right?.window?.end||''));
}
