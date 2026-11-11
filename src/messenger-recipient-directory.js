// New-conversation presentation only. Existing inboxes, messages, identities,
// thread membership and authorization remain unchanged.
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export const messengerDisplayName=value=>String(value||'').replace(/\s*\(shared PIN(?:; self-asserted)?\)\s*$/i,'').trim();
export function recipientDirectory(rows,links,currentUserId){
  const byId=new Map(links.map(link=>[String(link.id),link]));
  const account=link=>uuid(link?.custodial_claimed_account_id)&&uuid(link?.custodial_cohort_manager_id)
    ?link.custodial_claimed_account_id:uuid(link?.ops_manager_id)?link.ops_manager_id:null;
  const self=account(byId.get(currentUserId)),groups=new Map();
  for(const row of rows){const link=byId.get(String(row.id)),key=account(link);if(!key)continue;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({row,link});}
  const preferred=new Map(),names=new Map();
  for(const [key,members]of groups){
    const cohort=members.filter(({link})=>uuid(link.custodial_cohort_manager_id));
    // Only the single currently eligible cohort inbox for this exact manager
    // account replaces its legacy entry. Ambiguous accounts are never merged.
    if(cohort.length===1)preferred.set(key,String(cohort[0].row.id));
    const named=members.filter(({link})=>link.ops_manager_id===key);
    if(named.length===1)names.set(key,messengerDisplayName(named[0].row.display_name));
  }
  return rows.filter(row=>{const key=account(byId.get(String(row.id)));
    return String(row.id)!==currentUserId&&(!key||key!==self)&&(!preferred.has(key)||preferred.get(key)===String(row.id));
  }).map(row=>({...row,display_name:names.get(account(byId.get(String(row.id))))||messengerDisplayName(row.display_name)}));
}
