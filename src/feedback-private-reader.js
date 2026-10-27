// Exact-item manager read; auth middleware is mandatory at the route mount.
// No token, public Storage URL, message mutation or capture/upload capability.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function makeFeedbackPrivateReader({getItem,attachDelivery}) {
  return async(req,res)=>{
    const id=String(req.params.feedbackId||'');
    res.setHeader('Cache-Control','no-store');
    if(!uuid.test(id))return res.status(422).json({ok:false,error:'A valid feedback item identity is required.'});
    try {
      const item=await getItem(id);
      if(!item||String(item.id).toLowerCase()!==id.toLowerCase())return res.status(404).json({ok:false,error:'Feedback item not found.'});
      const [data]=await attachDelivery([item]);
      if(!data||String(data.id).toLowerCase()!==id.toLowerCase())throw new Error('Feedback identity mismatch');
      return res.status(200).json({ok:true,data});
    } catch(error) {
      // Never disclose DB/storage errors to the browser. Missing or unavailable
      // exact read must not fall back to the first page of the inbox.
      return res.status(error?.status===404?404:503).json({ok:false,error:'Exact feedback item is unavailable. Saved feedback remains retained.'});
    }
  };
}

export function feedbackManagerPageRedirect(req,res){
  res.setHeader('Cache-Control','no-store');
  const id=String(req.query.feedback||'');
  if(!uuid.test(id))return res.status(422).send('A valid feedback item identity is required.');
  // Existing source-controlled Engine publication origin, not caller input.
  // Retains the immutable historical backend-origin links in captured mail.
  const target=new URL('https://lasrevinu333-design.github.io/Engine/system-feedback.html');
  target.searchParams.set('hub','manager');target.searchParams.set('feedback',id);
  return res.redirect(302,target.toString());
}
