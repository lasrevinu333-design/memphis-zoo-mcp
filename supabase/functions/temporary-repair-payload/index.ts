import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((_request: Request) => new Response(
  JSON.stringify({ ok: false, error: "Temporary repair surface retired." }),
  {
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  },
));
