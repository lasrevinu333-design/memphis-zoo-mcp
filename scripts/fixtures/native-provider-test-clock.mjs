import assert from 'node:assert/strict';

// Synthetic fixture clock only. Real registration uses clock_timestamp(); the
// later nominated test instant must not precede its actual activation. Every
// production wrapper still chooses its own clock and rejects nominated times.
export function nativeProviderTestClock(sql) {
  const row=JSON.parse(sql(`with d as(select (clock_timestamp() at time zone 'America/Chicago')::date+1 as service_date)
    select jsonb_build_object('serviceDate',service_date,'dayOfWeek',extract(dow from service_date)::integer,
      'at',to_char(((service_date+time '10:00:00.123456') at time zone 'America/Chicago') at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) from d;`));
  assert.match(row.serviceDate,/^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isInteger(row.dayOfWeek)&&row.dayOfWeek>=0&&row.dayOfWeek<=6);
  assert.match(row.at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  const micros=BigInt(Date.parse(row.at))*1000n+BigInt(row.at.slice(-4,-1));
  const offsetMicros=value=>{
    assert.ok(Number.isSafeInteger(value));
    const result=micros+BigInt(value);assert.ok(result>0n);
    return new Date(Number(result/1000n)).toISOString().slice(0,-1)+(result%1000n).toString().padStart(3,'0')+'Z';
  };
  assert.equal(offsetMicros(0),row.at);
  return Object.freeze({...row,offsetMicros});
}
