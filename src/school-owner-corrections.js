// Owner-confirmed operational correction, 2026-11-10, chat
// 01a1a298-70b9-77f1-b854-f50b8c5882c9, response to
// call_5dd1c957442f4c52b67fae163de78551: "Correct it to 9:30 AM".
// Original Cstm_GroupOrders!F35:F36 encode 21:30. Keep the attachment,
// parser and immutable mail ledger unchanged. Only this exact active source
// projection receives the correction; a newer attachment supersedes it.
const ALCY = Object.freeze({
  id:'owner-alcy-353904-20261113-arrival-0930',
  attachment_sha256:'0312cf2375b6e41c89363617ae7871640e10adf2d21bca88bba475f1cd7c7857',
  content_sha256:'4b08e76eeb1abfac80cee30580f4c278c48ea2c4e3f09e42a3e7e8c0f49e24b9',
  source_at:'2026-11-04T18:36:58.000Z',
  order_id:'353904',date:'2026-11-13',name:'Alcy Elementary',
  original_arrival_at:'2026-11-14T03:30:00.000Z',
  corrected_arrival_at:'2026-11-13T15:30:00.000Z',
});

export function schoolOwnerCorrection(row) {
  const p=row?.provenance;
  return row?.status==='SCHEDULED' && row.order_id===ALCY.order_id
    && row.date===ALCY.date && row.name===ALCY.name
    && row.arrival_at===ALCY.original_arrival_at
    && p?.attachment_sha256===ALCY.attachment_sha256
    && p.content_sha256===ALCY.content_sha256
    && Date.parse(p.source_at)===Date.parse(ALCY.source_at) ? ALCY : null;
}
