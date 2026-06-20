import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let deleted = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Triage.list('-created_date', 100);
      if (!batch.length) break;
      await Promise.all(batch.map((t) => base44.asServiceRole.entities.Triage.delete(t.id)));
      deleted += batch.length;
      if (batch.length < 100) break;
    }

    return Response.json({ success: true, deleted });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});