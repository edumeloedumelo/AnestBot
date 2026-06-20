import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { patientName, surgeryType, blocoResumo, createdDate } = body;

    if (!patientName || !blocoResumo) {
      return Response.json({ error: 'Dados incompletos' }, { status: 400 });
    }

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');

    const dateStr = createdDate
      ? new Date(createdDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const safeName = patientName.replace(/[^a-zA-Z0-9\u00C0-\u024F\s\-_]/g, '').trim();
    const fileName = `${safeName} - ${surgeryType || 'Triagem'} - ${dateStr}.txt`;

    const fileContent = [
      `TRIAGEM PRÉ-OPERATÓRIA`,
      `========================`,
      ``,
      `Paciente: ${patientName}`,
      `Cirurgia: ${surgeryType || 'Não especificada'}`,
      `Data: ${dateStr}`,
      ``,
      `RESUMO:`,
      `========================`,
      ``,
      blocoResumo,
      ``,
      `---`,
      `Gerado automaticamente pelo AnestGuide`,
    ].join('\n');

    // Upload file to Drive
    const boundary = 'anestguide_boundary_' + Date.now();
    const metadata = JSON.stringify({
      name: fileName,
      mimeType: 'text/plain',
    });

    const multipart = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      fileContent,
      `--${boundary}--`,
    ].join('\r\n');

    const driveRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipart,
      }
    );

    if (!driveRes.ok) {
      const errText = await driveRes.text();
      throw new Error(`Drive API error (${driveRes.status}): ${errText.substring(0, 300)}`);
    }

    const driveFile = await driveRes.json();

    return Response.json({
      success: true,
      fileName,
      fileId: driveFile.id,
      webViewLink: driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});