import {createHash} from 'node:crypto';
import {canonicalJson} from './static-weekly-schedule-model.js';

const text=value=>typeof value==='string'?value.trim():'';
const compare=(a,b)=>a<b?-1:a>b?1:0;
const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');

// Display only: the solver's accepted areas/time windows are never rewritten.
// Group IDs are graph vertices; the physical rooms of a pair stay together.
export function suggestCoverAllAreaOrder({areas,proximity,anchorLocationId,anchorProvenance}){
 const untouched=areas.map(area=>({...area,locations:area.locations.map(location=>({...location}))}));
 const missing=reason=>({areas:untouched,advisoryOrder:{status:'ORDER_NOT_PROVEN',reason,mandatory:false}});
 if(!areas.length)return {areas:untouched,advisoryOrder:{status:'NO_ASSIGNED_AREAS',mandatory:false}};
 const anchor=text(anchorLocationId),provenance=text(anchorProvenance);
 if(!anchor||!provenance)return missing('ACCEPTED_ANCHOR_MISSING');
 if(!Array.isArray(proximity)||proximity.length>32768)return missing('BOUNDED_GRAPH_MISSING');
 const ids=[...new Set(areas.map(area=>text(area.areaId)))].sort(compare);
 if(ids.includes('')||ids.length>128)return missing('BOUNDED_GROUP_IDENTITIES_MISSING');
 const relevant=new Set([anchor,...ids]),edges=new Map();
 const insert=(from,to,entry)=>{
  if(!relevant.has(from)||!relevant.has(to))return;
  const key=canonicalJson([from,to]),old=edges.get(key);
  // Conflicting verified measurements do not silently select the smaller one.
  if(old&&old.minutes!==entry.minutes)throw new Error('CONFLICTING_VERIFIED_EDGE');
  if(!old||compare(entry.provenance,old.provenance)<0)edges.set(key,entry);
 };
 try{for(const row of proximity){
  const from=text(row?.fromLocationId||row?.from),to=text(row?.toLocationId||row?.to);
  const minutes=row?.minutes??row?.distance,source=text(row?.provenance||row?.source);
  if(!from||!to||from===to||row?.verified!==true||!source||!Number.isSafeInteger(minutes)||minutes<=0)continue;
  const entry={minutes,provenance:source};insert(from,to,entry);
  if(row.bidirectional===true||row.symmetric===true)insert(to,from,entry);
 }}catch(error){if(error.message==='CONFLICTING_VERIFIED_EDGE')return missing(error.message);throw error;}
 const edge=(from,to)=>from===to?{minutes:0,provenance:'same_location'}:edges.get(canonicalJson([from,to]));
 for(const from of relevant)for(const to of ids)if(!edge(from,to))return missing('DIRECTED_EDGE_MISSING');
 const pending=new Set(ids),ordered=[],usedEdges=[];let cursor=anchor;
 while(pending.size){
  const next=[...pending].sort((a,b)=>edge(cursor,a).minutes-edge(cursor,b).minutes||compare(a,b))[0];
  usedEdges.push({from:cursor,to:next,...edge(cursor,next)});ordered.push(next);pending.delete(next);cursor=next;
 }
 const graph=[...edges].sort((a,b)=>compare(a[0],b[0]));
 return {areas:ordered.flatMap(id=>untouched.filter(area=>area.areaId===id)),advisoryOrder:{
  status:'ADVISORY_VERIFIED_PROXIMITY',mandatory:false,algorithm:'directed_nearest_next.v1',
  anchorLocationId:anchor,anchorProvenance:provenance,
  // Neither an observed current position, measured walking duration, nor an
  // optimal itinerary. Each accepted time-window group starts at this anchor.
  sourceGraphDigest:digest(graph),orderedAreaIds:ordered,usedEdges,
 }};
}
