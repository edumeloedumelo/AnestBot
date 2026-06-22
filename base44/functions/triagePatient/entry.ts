Deno.serve(async () => {
  return Response.json({ error: 'use fastAnalyze' }, { status: 410 });
});