// Disposable explicit namespaces: nine real fixture people, eight stable
// nonemployee capacities, and distinct area-group/physical-place UUIDs.
// The small qualification-specific morning case intentionally exercises
// admission/identity, not the unrelated full nine-person staffing benchmark.
const uuid=(namespace,index)=>`${namespace}0000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`;
export function nonemployeeCoverAllSource(week = '2026-10-05') {
  const employees = Array.from({ length: 9 }, (_, i) => ({ id: uuid(1,i), slot: uuid(2,i), name: `Synthetic employee ${i + 1}` }));
  const capacities = Array.from({ length: 8 }, (_, i) => ({ slot: uuid(3,i), name: `CoverAll0${i + 1}` }));
  const areas = Array.from({ length: 2 }, (_, i) => ({ group: uuid(4,i), physical: uuid(5,i), code: `CAPACITY_AREA_${i + 1}`, name: `Synthetic area ${i + 1}` }));
  const availability = (slot, index, contractor = false) => ({ slotId: slot, dayOfWeek: 1, status: 'working',
    shift: { start: '07:00', end: contractor ? '15:00' : '17:00' },
    lunch: { start: `${String(11 + index % 3).padStart(2, '0')}:00`, end: `${String(12 + index % 3).padStart(2, '0')}:00` },
    productiveCapacityProvenance: 'explicit synthetic shift', maxServiceEffortMinutes: 300,
    maxServiceEffortProvenance: 'explicit synthetic effort', qualifications: contractor || index === 0 ? ['general'] : ['specialty_no_fixture_work'], qualificationProvenance: 'explicit synthetic eligibility',
    restrictions: [], restrictionProvenance: 'explicit synthetic restriction fact', acceptedRouteAnchorLocationId: areas[contractor ? 0 : index % areas.length].physical,
    acceptedRouteProvenance: 'explicit synthetic staging' });
  const source = { serviceDate: week, timezone: 'America/Chicago', exceptions: [],
    slots: [...employees.map(p => ({ id: p.slot, label: p.name, incumbencies: [{ personId: p.id, displayName: p.name, effectiveStart: '2020-01-01', effectiveEnd: null }] })),
      ...capacities.map(p => ({ id: p.slot, label: p.name, capacityId: p.slot, kind: 'CONTRACTOR_CAPACITY', contractorCapacity: true, incumbencies: [],
        contractorAvailability: [{ ...availability(p.slot, 0, true), slotId: undefined }] }))],
    proximity: areas.flatMap(from => areas.filter(to => to.physical !== from.physical).map(to => ({ from: from.physical, to: to.physical, minutes: 1, verified: true, provenance: 'synthetic explicit route metric' }))),
    versions: [{ id: uuid(6,0), publicationId: uuid(7,0), status: 'published', effectiveStart: week, effectiveEnd: null,
      objective: { requireVerifiedProximity: true },
      slotAvailability: [...employees.map((p, i) => availability(p.slot, i)), ...capacities.map(p => ({ slotId: p.slot, dayOfWeek: 1, status: 'unavailable' }))],
      assignments: areas.flatMap((area, i) => Array.from({length:3},(_,round)=>{
        const minute=7*60+(i*3+round)*15;
        const time=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
        return {suffix:String(round),start:time(minute),end:time(minute+10)};
      }).map(span => ({ workId: `${area.code}-${span.suffix}`, dayOfWeek: 1, ownerSlotId: employees[0].slot,
        locationId: area.physical, locationCodeSnapshot: area.code, locationNameSnapshot: area.name,
        includedLocations: [{ locationId: area.physical, locationNameSnapshot: area.name }], window: { start: span.start, end: span.end },
        serviceEffortMinutes: 5, serviceEffortProvenance: 'explicit synthetic effort',
        priority: 2, priorityProvenance: 'explicit synthetic priority', requiredQualifications: ['general'], qualificationProvenance: 'explicit synthetic work eligibility',
        restrictions: [], restrictionProvenance: 'explicit synthetic work restriction' }))) }] };
  return { source: JSON.parse(JSON.stringify(source)), employees, capacities, areas };
}
