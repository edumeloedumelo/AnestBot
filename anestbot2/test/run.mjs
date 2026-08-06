// Suíte de testes da ANESTBOT 2.0 — cobre os cenários que falhavam na 1.0.
// Roda offline (sem rede): exercita store → webhook → parser → extração.
import assert from 'assert';
import { getBody, resolveChatId, gateDecision } from '../src/webhook.js';
import { appendMessage, getMessages, selfHealChat, resetChat } from '../src/store.js';
import { splitIntoCases, extractName, extractSurgery, isCaseOpener, isSeparator } from '../src/parser.js';
import { formatReply } from '../src/format.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`✅ ${name}`); pass++; }
  catch (e) { console.log(`❌ ${name}\n   ${e.message}`); fail++; }
}

// helper: cria uma mensagem de store
let seq = 0;
const M = (type, body, extra = {}) => ({ id: 'm' + (seq++), chatId: 'g@g.us', type, body, mediaUrl: '', caption: '', timestamp: 1000 + seq, fromMe: false, _seq: seq, ...extra });

// ── getBody: campos variados ──────────────────────────────────────────────
t('getBody usa m.text quando body vazio', () => assert.equal(getBody({ body: '', text: 'Procedimento: Lipo' }), 'Procedimento: Lipo'));
t('getBody usa m.message.conversation (Baileys aninhado)', () => assert.equal(getBody({ message: { conversation: 'Procedimento: Rino' } }), 'Procedimento: Rino'));
t('getBody usa m.message.extendedTextMessage.text', () => assert.equal(getBody({ message: { extendedTextMessage: { text: 'X' } } }), 'X'));
t('getBody escolhe o MAIS LONGO (body é preview curto)', () => assert.ok(getBody({ body: '🩺 Olá', text: '🩺 Olá!\nProcedimento: Masto com prótese' }).includes('Masto')));

// ── marcadores ──────────────────────────────────────────────────────────────
t('isCaseOpener xxxx', () => assert.ok(isCaseOpener('xxxx') && isCaseOpener('XXXX') && !isCaseOpener('xxx')));
t('isSeparator ❌❌❌❌', () => assert.ok(isSeparator('❌❌❌❌') && !isSeparator('oi')));

// ── extração ─────────────────────────────────────────────────────────────────
t('extractSurgery Procedimento multilinha', () => assert.equal(extractSurgery(['🔷 Procedimento: Mastopexia com\npróteses + lipo de axilas\n🔷 Data: 23/07']), 'Mastopexia com próteses + lipo de axilas'));
t('extractSurgery emoji pequeno 🔹', () => assert.equal(extractSurgery(['🔹 Procedimento: Rinoplastia\n🔹 Data da cirurgia: 28/07/2026']), 'Rinoplastia'));
t('extractName Paciente sem espaço', () => assert.equal(extractName(['Paciente:Gabrielle da Silva Barbosa']), 'Gabrielle da Silva Barbosa'));

// ── CASO 1: fluxo clássico (marcadores em mensagens separadas) ───────────────
t('caso clássico: xxxx / card / exame / ❌❌❌❌', () => {
  const msgs = [
    M('chat', 'xxxx'),
    M('chat', '🔹 Paciente: Ana\n🔹 Procedimento: Rinoplastia\n🔹 Data: 28/07'),
    M('document', 'exames.pdf', { mediaUrl: 'http://x/e.pdf', caption: 'exames.pdf' }),
    M('chat', '❌❌❌❌'),
  ];
  const cases = splitIntoCases(msgs, new Set());
  assert.equal(cases.length, 1);
  assert.equal(extractSurgery(cases[0].texts), 'Rinoplastia');
  assert.equal(extractName(cases[0].texts), 'Ana');
  assert.equal(cases[0].media.length, 1);
});

// ── CASO 2: xxxx COLADO ao card na MESMA mensagem (bug real da 1.0) ──────────
t('xxxx colado ao card na mesma mensagem', () => {
  const msgs = [
    M('chat', 'Xxxx\n\n🩺 Olá!\n🔹 Paciente: Drielly Leal Rodrigues\n🔹 Procedimento: Rinoplastia\n🔹 Data: 28/07'),
    M('document', 'exames.pdf', { mediaUrl: 'http://x/e.pdf', caption: 'exames.pdf' }),
    M('chat', '❌❌❌❌'),
  ];
  const cases = splitIntoCases(msgs, new Set());
  assert.equal(cases.length, 1);
  assert.equal(extractSurgery(cases[0].texts), 'Rinoplastia');
  assert.equal(extractName(cases[0].texts), 'Drielly Leal Rodrigues');
});

// ── CASO 3: tudo numa mensagem só (xxxx + card + ❌❌❌❌) ────────────────────
t('xxxx + card + ❌❌❌❌ numa mensagem só', () => {
  const cases = splitIntoCases([M('chat', 'xxxx\n🔹 Procedimento: Lipo\n🔹 Data: 1/1\n❌❌❌❌')], new Set());
  assert.equal(cases.length, 1);
  assert.equal(extractSurgery(cases[0].texts), 'Lipo');
});

// ── CASO 4: conteúdo sem xxxx é ignorado (regra absoluta) ────────────────────
t('conteúdo sem xxxx é ignorado', () => {
  const cases = splitIntoCases([M('chat', 'Procedimento: Solto'), M('chat', '❌❌❌❌')], new Set());
  assert.equal(cases.length, 0);
});

// ── CASO 5: dois casos, sem contaminação ─────────────────────────────────────
t('dois casos isolados (sem contaminação Amanda/Zildene)', () => {
  const msgs = [
    M('chat', 'xxxx'), M('chat', 'Paciente: Amanda\nProcedimento: Lipo'), M('chat', '❌❌❌❌'),
    M('chat', 'xxxx'), M('chat', 'Paciente: Zildene\nProcedimento: Rino'), M('chat', '❌❌❌❌'),
  ];
  const cases = splitIntoCases(msgs, new Set());
  assert.equal(cases.length, 2);
  assert.equal(extractName(cases[0].texts), 'Amanda');
  assert.equal(extractName(cases[1].texts), 'Zildene');
});

// ── CASO 6: dedup durável — caso já processado não reaparece ─────────────────
t('dedup por id: caso já processado é filtrado', () => {
  const msgs = [M('chat', 'xxxx', { id: 'A' }), M('chat', 'Paciente: X\nProcedimento: Y', { id: 'B' }), M('chat', '❌❌❌❌', { id: 'C' })];
  const cases = splitIntoCases(msgs, new Set(['A', 'B', 'C']));
  assert.equal(cases.length, 0);
});

// ── CASO 7: mídia sem URL é rastreada por nome ───────────────────────────────
t('mídia sem URL rastreada em missingMedia', () => {
  const msgs = [M('chat', 'xxxx'), M('document', 'EXAME VALIM.pdf', { caption: 'EXAME VALIM.pdf' }), M('chat', '❌❌❌❌')];
  const cases = splitIntoCases(msgs, new Set());
  assert.equal(cases.length, 1);
  assert.ok(cases[0].missingMedia.includes('EXAME VALIM.pdf'));
});

// ── CASO 8: laudo do bot marca o caso como analisado ─────────────────────────
t('laudo do bot impede reanálise', () => {
  const msgs = [
    M('chat', 'xxxx'), M('chat', 'Paciente: A\nProcedimento: Lipo'), M('chat', '❌❌❌❌'),
    M('chat', '🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA*\n━━━\nSTATUS FINAL: ok'),
  ];
  const cases = splitIntoCases(msgs, new Set());
  assert.equal(cases.length, 0);
});

// ── format: remove preâmbulo antes do card ───────────────────────────────────
t('formatReply remove preâmbulo antes do card', () => {
  const raw = 'Vou analisar os documentos...\n\n🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA*\n━━━━━━━━━━━━━━\n👩‍⚕️ *Cirurgia:* Rino';
  const out = formatReply(raw);
  assert.ok(out.startsWith('🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA*'));
  assert.ok(!out.includes('Vou analisar'));
});
t('formatReply não corta se marcador citado em prosa antes', () => {
  const raw = 'Começo com 🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA* como pediu.\n\n🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA*\n━━━━━━━━━━━━━━\nOK';
  const out = formatReply(raw);
  assert.ok(out.startsWith('🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA*\n━━━'));
  assert.ok(!out.includes('como pediu'));
});

// ── CASO 9: ficha com separadores ━━━ e título em CAIXA ALTA não é confundida ─
t('ficha com ━━━ e título AVALIAÇÃO PRÉ-ANESTÉSICA (caixa alta) não é descartada', () => {
  const ficha = 'xxxx\n\n📋 AVALIAÇÃO PRÉ-ANESTÉSICA\n🔹 Paciente: Ana\n🔹 Procedimento: Rinoplastia\n━━━━━━━━━━━━━━\n1️⃣ Pressão? Não\n━━━━━━━━━━━━━━\n2️⃣ Diabetes? Não';
  const cases = splitIntoCases([M('chat', ficha), M('chat', '❌❌❌❌')], new Set());
  assert.equal(cases.length, 1);
  assert.equal(extractSurgery(cases[0].texts), 'Rinoplastia'); // ━ não entra no valor
});

// ── CASO 10: laudo REAL do bot (com asteriscos) marca como analisado ─────────
t('laudo real do bot (*AVALIAÇÃO PRÉ-ANESTÉSICA*) marca caso como analisado', () => {
  const msgs = [M('chat', 'xxxx'), M('chat', 'Paciente: X\nProcedimento: Lipo'), M('chat', '❌❌❌❌'),
    M('chat', '🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA*\n━━━\n📌 *STATUS FINAL:* ✅')];
  assert.equal(splitIntoCases(msgs, new Set()).length, 0);
});

// ── CASO 11: mensagens do PRÓPRIO número (fromMe) vão para o chat certo ──────
t('resolveChatId: fromMe usa "to" (grupo), recebida usa "from"', () => {
  assert.equal(resolveChatId({ fromMe: true, from: '5599@c.us', to: 'grupo@g.us' }), 'grupo@g.us');
  assert.equal(resolveChatId({ fromMe: false, from: 'grupo@g.us', to: '5599@c.us' }), 'grupo@g.us');
  assert.equal(resolveChatId({ fromMe: true, from: 'grupo@g.us' }), 'grupo@g.us'); // sem "to": cai no from
});

// ── CASO 12: laudo com o NOVO visual (📌 *STATUS:* no topo) segue reconhecido ─
t('laudo novo visual marca caso como analisado', () => {
  const msgs = [M('chat', 'xxxx'), M('chat', 'Paciente: X\nProcedimento: Lipo'), M('chat', '❌❌❌❌'),
    M('chat', '🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA*\n━━━\n🧍 *Paciente:* X\n📌 *STATUS:* ✅\n━━━\n⚠️ _Apoio à decisão. Não substitui avaliação médica presencial._')];
  assert.equal(splitIntoCases(msgs, new Set()).length, 0);
});

// ── CASO 13: relatório da verificação automática não vira conteúdo clínico ───
t('relatório 🔧 VERIFICAÇÃO AUTOMÁTICA é ignorado pelo parser', () => {
  const msgs = [M('chat', 'xxxx'), M('chat', '🔧 *VERIFICAÇÃO AUTOMÁTICA*\n✅ Nenhum erro encontrado.\n_5 checagem(ns) OK._'), M('chat', 'Procedimento: Lipo'), M('chat', '❌❌❌❌')];
  const cases = splitIntoCases(msgs, new Set());
  assert.equal(cases.length, 1);
  assert.ok(!cases[0].texts.join('\n').includes('VERIFICAÇÃO'));
});

// ── CASO 14: selfHealChat corrige estado corrompido sem tocar no válido ──────
t('selfHealChat: remove sem-id, mescla duplicadas, corrige timestamp', () => {
  const chatId = 'selfheal-test@g.us';
  resetChat(chatId);
  appendMessage(chatId, { id: 'ok1', chatId, type: 'chat', body: 'xxxx', timestamp: 100 });
  appendMessage(chatId, { id: 'ok2', chatId, type: 'chat', body: 'Procedimento: Lipo', timestamp: NaN }); // ts inválido
  const fixes = selfHealChat(chatId);
  assert.ok(fixes.some((f) => f.includes('timestamp')), 'deveria corrigir timestamp: ' + JSON.stringify(fixes));
  const msgs = getMessages(chatId);
  assert.equal(msgs.length, 2); // nada válido foi perdido
  assert.equal(splitIntoCases([...msgs, { id: 'ok3', type: 'chat', body: '❌❌❌❌' }], new Set()).length, 1);
  resetChat(chatId);
});

t('selfHealChat: sem problemas → nenhuma correção', () => {
  const chatId = 'selfheal-clean@g.us';
  resetChat(chatId);
  appendMessage(chatId, { id: 'a', chatId, type: 'chat', body: 'oi', timestamp: 1 });
  assert.deepEqual(selfHealChat(chatId), []);
  resetChat(chatId);
});

// ── CASO 15: PORTÃO — webhook só captura entre xxxx e ❌❌❌❌ ────────────────
t('gate: conversa fora de bloco NÃO é capturada', () => {
  const d = gateDecision(false, 'chat', 'bom dia pessoal, alguém viu a escala?');
  assert.equal(d.store, false); assert.equal(d.nowOpen, false);
});
t('gate: mídia fora de bloco NÃO é capturada', () => {
  assert.equal(gateDecision(false, 'image', '').store, false);
});
t('gate: xxxx abre e é capturado (inclusive colado ao card)', () => {
  { const g = gateDecision(false, 'chat', 'xxxx'); assert.ok(g.store && g.nowOpen && g.opens); }
  { const g = gateDecision(false, 'chat', 'Xxxx\n\n🩺 Olá!\n🔹 Procedimento: Rino'); assert.ok(g.store && g.nowOpen && g.opens); }
});
t('gate: conteúdo e mídia DENTRO do bloco são capturados', () => {
  assert.equal(gateDecision(true, 'chat', '🔹 Paciente: Ana').store, true);
  assert.equal(gateDecision(true, 'document', 'exames.pdf').store, true);
});
t('gate: ❌❌❌❌ fecha o bloco (inclusive colado ao conteúdo)', () => {
  { const g = gateDecision(true, 'chat', '❌❌❌❌'); assert.ok(g.store && !g.nowOpen && g.closes); }
  { const g = gateDecision(true, 'chat', 'última info\n❌❌❌❌'); assert.ok(g.store && !g.nowOpen && g.closes); }
});
t('gate: depois de fechar, conversa volta a ser ignorada', () => {
  const c1 = gateDecision(true, 'chat', '❌❌❌❌');
  assert.equal(gateDecision(c1.nowOpen, 'chat', 'obrigado!').store, false);
  assert.equal(gateDecision(c1.nowOpen, 'image', '').store, false);
});
t('gate: caso completo numa mensagem só abre e fecha', () => {
  { const g = gateDecision(false, 'chat', 'xxxx\n🔹 Procedimento: Lipo\n❌❌❌❌'); assert.ok(g.store && !g.nowOpen && g.opens && g.closes); }
});

// ── CASO 16: erro de mídia da API sem índice (produção 29/07) aciona o retry ─
const { isMediaApiError } = await import('../src/triage.js');
t('isMediaApiError reconhece "Could not process image" (sem content.N)', () => {
  assert.ok(isMediaApiError('Claude API 400: {"type":"error","error":{"type":"invalid_request_error","message":"Could not process image"},"request_id":"req_x"}'));
  assert.ok(isMediaApiError('messages.0.content.3.image.source: invalid base64'));
  assert.ok(!isMediaApiError('Claude API 429: rate limited'));
  assert.ok(!isMediaApiError('Timeout: Claude não respondeu em 2 minutos.'));
});
t('isMediaApiError: classe geral de erro de mídia, sem falso positivo', () => {
  assert.ok(isMediaApiError('Claude API 400: {"error":{"type":"invalid_request_error","message":"image exceeds 5 MB maximum"}}'));
  assert.ok(isMediaApiError('Invalid image data'));
  assert.ok(isMediaApiError('unsupported image format'));
  assert.ok(isMediaApiError('messages.0.content.2.document: invalid base64'));
  assert.ok(!isMediaApiError('Claude API 400: prompt is too long: 205000 tokens > 200000 maximum'));
  assert.ok(!isMediaApiError('Claude API 529: {"type":"error","error":{"type":"overloaded_error"}}'));
  assert.ok(!isMediaApiError('Claude API 400: max_tokens: invalid value'));
});

// ── CASO 17: validação de imagem antes de enviar à API ───────────────────────
const { jpegDims, pngDims, assertImageWithinLimits } = await import('../src/media.js');
t('pngDims lê IHDR e bloqueia imagem gigante', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  png[16] = 0; png[17] = 0; png[18] = 0x23; png[19] = 0x28; // width 9000
  png[20] = 0; png[21] = 0; png[22] = 0x0B; png[23] = 0xB8; // height 3000
  assert.deepEqual(pngDims(png), { width: 9000, height: 3000 });
  assert.throws(() => assertImageWithinLimits('image/png', png), /8000px/);
});
t('jpegDims lê SOF0 e aceita imagem normal', () => {
  // JPEG mínimo: SOI + SOF0 (alt 3000, larg 4000)
  const j = new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x0B, 0xB8, 0x0F, 0xA0, 0x03]);
  assert.deepEqual(jpegDims(j), { height: 3000, width: 4000 });
  assertImageWithinLimits('image/jpeg', j); // não lança
});
t('pngDims: IHDR malformado (bit alto) NÃO passa batido (sem overflow de sinal)', () => {
  const png = new Uint8Array(24);
  png[16] = 0xFF; png[17] = 0xFF; png[18] = 0xFF; png[19] = 0xFF; // width "0xFFFFFFFF"
  png[23] = 100;
  const d = pngDims(png);
  assert.ok(d.width > 7900, 'width deve ser positivo e enorme: ' + d.width);
  assert.throws(() => assertImageWithinLimits('image/png', png), /8000px/);
});
t('jpegDims: marcador standalone (TEM/RST) não engole o SOF real', () => {
  // SOI + TEM (FF01, sem length) + 2 bytes de dado + SOF0 12000x100
  const j = new Uint8Array([0xFF, 0xD8, 0xFF, 0x01, 0x00, 0x38, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x2E, 0xE0, 0x03]);
  assert.deepEqual(jpegDims(j), { height: 100, width: 12000 });
  assert.throws(() => assertImageWithinLimits('image/jpeg', j), /8000px/);
});
const { gifDims, webpDims } = await import('../src/media.js');
t('gifDims lê LSD little-endian e bloqueia gigante', () => {
  const g = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x27, 0x64, 0x00]); // 10000x100
  assert.deepEqual(gifDims(g), { width: 10000, height: 100 });
  assert.throws(() => assertImageWithinLimits('image/gif', g), /8000px/);
});
t('webpDims lê VP8X e bloqueia gigante', () => {
  const w = new Uint8Array(30);
  w.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]); // RIFF....WEBPVP8X
  w[24] = 0x0F; w[25] = 0x27; w[26] = 0; // width-1 = 9999
  w[27] = 0x63; w[28] = 0; w[29] = 0;    // height-1 = 99
  assert.deepEqual(webpDims(w), { width: 10000, height: 100 });
  assert.throws(() => assertImageWithinLimits('image/webp', w), /8000px/);
});
t('imagem acima de 5MB é bloqueada com mensagem clara', () => {
  const big = new Uint8Array(5 * 1024 * 1024); big[0] = 0xFF; big[1] = 0xD8;
  assert.throws(() => assertImageWithinLimits('image/jpeg', big), /limite 5 MB/);
});

// ── CASO 18: mídia órfã adotada (chegou antes do xxxx) ───────────────────────
const { pushPendingMedia, adoptPendingMedia, recordBotText, isBotText } = await import('../src/store.js');
t('mídia pendente é adotada quando o caso abre (fluxo separado)', () => {
  const chatId = 'pend@g.us';
  resetChat(chatId);
  pushPendingMedia(chatId, { id: 'pm1', chatId, type: 'document', body: 'ex.pdf', mediaUrl: 'http://x/e.pdf', caption: 'ex.pdf', timestamp: 2000 });
  appendMessage(chatId, { id: 'op1', chatId, type: 'chat', body: 'xxxx\n🔹 Procedimento: Lipo', timestamp: 2010 });
  assert.equal(adoptPendingMedia(chatId, 2010), 1);
  appendMessage(chatId, { id: 'cl1', chatId, type: 'chat', body: '❌❌❌❌', timestamp: 2020 });
  const cases = splitIntoCases(getMessages(chatId), new Set());
  assert.equal(cases.length, 1);
  assert.equal(cases[0].media.length, 1);
  resetChat(chatId);
});
t('mídia pendente ANTIGA (>120s) é descartada, não contamina', () => {
  const chatId = 'pend2@g.us';
  resetChat(chatId);
  pushPendingMedia(chatId, { id: 'pm2', chatId, type: 'image', body: 'velha.jpg', mediaUrl: 'http://x/v.jpg', timestamp: 1000 });
  assert.equal(adoptPendingMedia(chatId, 5000), 0);
  resetChat(chatId);
});
t('mídia adotada com caso aberto-e-fechado numa mensagem só (parser anexa ao último caso)', () => {
  const chatId = 'pend3@g.us';
  resetChat(chatId);
  appendMessage(chatId, { id: 'g1', chatId, type: 'chat', body: 'xxxx\n🔹 Procedimento: Rino\n❌❌❌❌', timestamp: 3000 });
  appendMessage(chatId, { id: 'g2', chatId, type: 'document', body: 'ex.pdf', mediaUrl: 'http://x/e.pdf', caption: 'ex.pdf', timestamp: 3000 });
  const cases = splitIntoCases(getMessages(chatId), new Set());
  assert.equal(cases.length, 1);
  assert.equal(cases[0].media.length, 1);
  resetChat(chatId);
});
t('mídia atrasada NÃO contamina caso fechado há tempo', () => {
  const chatId = 'pend4@g.us';
  resetChat(chatId);
  appendMessage(chatId, { id: 'h1', chatId, type: 'chat', body: 'xxxx\nProcedimento: Lipo\n❌❌❌❌', timestamp: 4000 });
  appendMessage(chatId, { id: 'h2', chatId, type: 'image', body: 'depois.jpg', mediaUrl: 'http://x/d.jpg', timestamp: 4100 }); // 100s depois
  const cases = splitIntoCases(getMessages(chatId), new Set());
  assert.equal(cases[0].media.length, 0);
  resetChat(chatId);
});

// ── CASO 18b: contaminação PARA FRENTE (reprovação do coordenador) ───────────
const { handleOrphanMedia } = await import('../src/webhook.js');
const { recordCaseClosed } = await import('../src/store.js');
t('mídia logo após ❌❌❌❌ vai para o caso FECHADO, nunca para o próximo (Alice/Bruna)', () => {
  const chatId = 'fwd@g.us';
  resetChat(chatId);
  appendMessage(chatId, { id: 'a1', chatId, type: 'chat', body: 'xxxx\nPaciente: Alice\nProcedimento: Lipo', timestamp: 1000 });
  appendMessage(chatId, { id: 'a2', chatId, type: 'chat', body: '❌❌❌❌', timestamp: 1030 });
  recordCaseClosed(chatId, 1030);
  // exame atrasado da Alice, 20s depois do fechamento
  const fate = handleOrphanMedia(chatId, { id: 'a3', chatId, type: 'image', body: 'hemograma-alice.jpg', mediaUrl: 'http://x/h.jpg', caption: 'hemograma-alice.jpg', timestamp: 1050 });
  assert.equal(fate, 'late');
  // caso da Bruna abre 40s depois — adoção NÃO pode puxar o exame da Alice
  appendMessage(chatId, { id: 'b1', chatId, type: 'chat', body: 'xxxx\nPaciente: Bruna\nProcedimento: Rino', timestamp: 1090 });
  assert.equal(adoptPendingMedia(chatId, 1090), 0);
  appendMessage(chatId, { id: 'b2', chatId, type: 'chat', body: '❌❌❌❌', timestamp: 1100 });
  const cases = splitIntoCases(getMessages(chatId), new Set());
  assert.equal(cases.length, 2);
  const alice = cases.find((c) => extractName(c.texts) === 'Alice');
  const bruna = cases.find((c) => extractName(c.texts) === 'Bruna');
  assert.equal(alice.media.length, 1, 'exame deve estar com Alice');
  assert.equal(bruna.media.length, 0, 'Bruna NÃO pode ter o exame da Alice');
  resetChat(chatId);
});
t('mídia já analisada não é re-adotada (reentrega do webhook)', () => {
  const chatId = 'redeliv@g.us';
  resetChat(chatId);
  appendMessage(chatId, { id: 'x1', chatId, type: 'document', body: 'e.pdf', mediaUrl: 'http://x/e.pdf', timestamp: 500 });
  pushPendingMedia(chatId, { id: 'x1', chatId, type: 'document', body: 'e.pdf', mediaUrl: 'http://x/e.pdf', timestamp: 500 });
  assert.equal(adoptPendingMedia(chatId, 510), 0); // id já conhecido — nada adotado
  resetChat(chatId);
});

// ── CASO 18c: ❌❌❌❌ redundante não desloca o marco de fechamento ────────────
const { lastClosedTime } = await import('../src/store.js');
async function ta(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); pass++; }
  catch (e) { console.log(`❌ ${name}\n   ${e.message}`); fail++; }
}
await ta('❌❌❌❌ redundante (sem caso aberto) não atualiza lastClosedTs', async () => {
  const chatId = 'dup-close@g.us';
  resetChat(chatId);
  const { handleWebhook } = await import('../src/webhook.js');
  const ev = (id, body, ts) => handleWebhook({ event_type: 'message_received', data: { id, from: chatId, type: 'chat', body, timestamp: ts } });
  await ev('d1', 'xxxx\nPaciente: Diana\nProcedimento: Lipo', 5000);
  await ev('d2', '❌❌❌❌', 5010);
  await ev('d3', '❌❌❌❌', 5060); // redundante
  assert.equal(lastClosedTime(chatId), 5010, 'marco deve permanecer no fechamento real');
  resetChat(chatId);
});

// ── CASO 19: eco do bot reconhecido e descartável ────────────────────────────
t('recordBotText/isBotText: resposta enviada pelo bot é reconhecida no eco', () => {
  const chatId = 'eco@g.us';
  resetChat(chatId);
  recordBotText(chatId, '✅ Cirurgia "Teste" salva.');
  assert.ok(isBotText(chatId, '✅ Cirurgia "Teste" salva.'));
  assert.ok(!isBotText(chatId, '🔹 Paciente: Ana'));
  resetChat(chatId);
});

// ── CASO 20: normalização de imagem (aprovada pelo CEO) ──────────────────────
const { processImage } = await import('../src/media.js');
const { buildTriageContext } = await import('../src/triage.js');
await ta('processImage sem ImageMagick: fallback null, sem lançar, buffer intacto', async () => {
  const original = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
  const copy = Uint8Array.from(original);
  const r = await processImage(original.buffer); // ENOENT real neste ambiente
  assert.equal(r, null);
  assert.deepEqual(Array.from(new Uint8Array(original.buffer)), Array.from(copy), 'buffer não pode ser mutado');
});
t('buildTriageContext: lista SÓ arquivos realmente anexados', () => {
  const ctx = buildTriageContext({
    patientName: 'Karolliny', surgeryType: 'Abdominoplastia', anamnesis: 'ficha',
    attachedFiles: ['ECG.jpg', 'hemograma.pdf'],
  });
  assert.ok(ctx.includes('ARQUIVOS ENVIADOS (2 arquivo(s) ANEXADOS'));
  assert.ok(ctx.includes('1. ECG.jpg') && ctx.includes('2. hemograma.pdf'));
  assert.ok(!ctx.includes('FALHA NO RECEBIMENTO'));
});
t('buildTriageContext: downloads que falharam viram seção própria (nunca "ilegível")', () => {
  const ctx = buildTriageContext({
    patientName: 'X', surgeryType: 'Lipo', anamnesis: 'a',
    attachedFiles: ['ok.pdf'], failedFiles: ['urina.pdf'],
  });
  assert.ok(ctx.includes('ARQUIVOS COM FALHA NO RECEBIMENTO'));
  assert.ok(ctx.includes('falha no recebimento — reenviar'));
  assert.ok(ctx.includes('NUNCA os classifique como ilegíveis'));
});
t('buildTriageContext sem mídia omite as seções de arquivos', () => {
  const ctx = buildTriageContext({ patientName: 'X', surgeryType: 'Lipo', anamnesis: 'a' });
  assert.ok(!ctx.includes('ARQUIVOS ENVIADOS') && !ctx.includes('FALHA NO RECEBIMENTO'));
});

// ── CASO 21: REPRODUÇÃO DA PRODUÇÃO 29/07 18h — webhook de mídia atrasado ────
const { shouldNotifyLate } = await import('../src/webhook.js');
t('PRODUÇÃO: exames enviados DENTRO do caso chegam DEPOIS do ❌❌❌❌ → entram no caso, em silêncio', () => {
  const chatId = 'prod2907@g.us';
  resetChat(chatId);
  // textos chegam primeiro (webhook rápido)
  appendMessage(chatId, { id: 'p1', chatId, type: 'chat', body: 'xxxx\nPaciente: Veronica\nProcedimento: Abdominoplastia', timestamp: 9000 });
  appendMessage(chatId, { id: 'p2', chatId, type: 'chat', body: '❌❌❌❌', timestamp: 9060 });
  recordCaseClosed(chatId, 9060);
  // 8 exames ENVIADOS às 9010-9050 (antes do fechamento), webhooks chegam depois
  const fates = [];
  for (let i = 0; i < 8; i++) {
    fates.push(handleOrphanMedia(chatId, { id: 'pm' + i, chatId, type: 'image', body: `exame${i}.jpg`, mediaUrl: `http://x/${i}.jpg`, caption: `exame${i}.jpg`, timestamp: 9010 + i * 5 }));
  }
  assert.ok(fates.every((f) => f === 'inside'), 'todas devem entrar DENTRO do caso: ' + fates.join(','));
  const cases = splitIntoCases(getMessages(chatId), new Set());
  assert.equal(cases.length, 1);
  assert.equal(cases[0].media.length, 8, 'os 8 exames devem estar no caso');
  assert.equal(extractName(cases[0].texts), 'Veronica');
  resetChat(chatId);
});
// ── CASO 22: TRAVAMENTO — nenhum await pode prender o lock do grupo p/ sempre ─
const { withWatchdog, caseWatchdogMs } = await import('../src/commands.js');
t('caseWatchdogMs: escala com nº de exames e nunca é menor que os timeouts internos', () => {
  assert.equal(caseWatchdogMs(0), 130_000);
  assert.equal(caseWatchdogMs(1), 260_000);
  assert.ok(caseWatchdogMs(1) > 60_000 + 60_000 + 120_000, 'deve cobrir download+compressão+Claude de 1 exame com margem');
  assert.equal(caseWatchdogMs(3), 130_000 + 130_000 * 3);
});
t('caseWatchdogMs: tem teto de 15min mesmo com muitos exames', () => {
  assert.equal(caseWatchdogMs(50), 900_000);
  assert.ok(caseWatchdogMs(15) >= Math.ceil(15 / 3) * 120_000 + 120_000,
    'teto deve cobrir o pior caso legítimo de 15 exames em pool de 3 + Claude');
});
await ta('withWatchdog: promessa que nunca resolve é abortada com erro claro', async () => {
  const neverResolves = new Promise(() => {}); // simula fetch/gs travado
  await assert.rejects(() => withWatchdog(neverResolves, 30), /travou/);
});
await ta('withWatchdog: promessa rápida resolve normalmente (sem overhead)', async () => {
  const r = await withWatchdog(Promise.resolve('ok'), 5000);
  assert.equal(r, 'ok');
});
await ta('withWatchdog: erro real da promessa passa direto (não vira "travou")', async () => {
  await assert.rejects(() => withWatchdog(Promise.reject(new Error('erro real')), 5000), /erro real/);
});

// ── CASO 23: ORÇAMENTO DE PAYLOAD — 413 request_too_large (produção 01/08) ───
const { enforceMediaBudget } = await import('../src/triage.js');
const fakeBlock = (n) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'x'.repeat(n) } });
t('isMediaApiError reconhece 413 request_too_large', () => {
  assert.ok(isMediaApiError('Claude API 413: {"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}'));
});
t('"413" dentro de request_id NÃO dispara falso positivo (auditoria B4)', () => {
  assert.ok(!isMediaApiError('Claude API 403: {"type":"error","error":{"type":"permission_error","message":"denied"},"request_id":"req_c413fAbCdEf"}'));
  assert.ok(!isMediaApiError('Claude API 500: {"type":"error","error":{"type":"api_error","message":"internal"},"request_id":"req_x413y"}'));
});
const { capAnamnesis, ANAMNESIS_CAP_BYTES } = await import('../src/triage.js');
t('anamnese gigante é truncada com aviso (auditoria B9)', () => {
  const errs = [];
  const out = capAnamnesis('a'.repeat(ANAMNESIS_CAP_BYTES + 1000), errs);
  assert.equal(out.length, ANAMNESIS_CAP_BYTES);
  assert.ok(errs[0].includes('truncado'));
  const errs2 = [];
  assert.equal(capAnamnesis('pequena', errs2), 'pequena');
  assert.equal(errs2.length, 0);
});
t('buildTriageContext: seções de excesso de tamanho e qualidade reduzida', () => {
  const ctx = buildTriageContext({
    patientName: 'X', surgeryType: 'Lipo', anamnesis: 'a',
    attachedFiles: ['ok.jpg'], oversizedFiles: ['grande.pdf'], degradedFiles: ['ok.jpg'],
  });
  assert.ok(ctx.includes('EXCESSO DE TAMANHO') && ctx.includes('grande.pdf'));
  assert.ok(ctx.includes('reenviar este exame SOZINHO'));
  assert.ok(ctx.includes('QUALIDADE REDUZIDA') && ctx.includes('desistir é mais seguro que insistir'));
});
await ta('orçamento: recomprime os MAIORES primeiro e cabe no limite', async () => {
  const st = { blocks: [fakeBlock(10), fakeBlock(30), fakeBlock(20)], labels: ['a', 'b', 'c'], urls: ['u1', 'u2', 'u3'], oversizeFiles: [], degradedFiles: [], errors: [] };
  const rebuilt = [];
  const total = await enforceMediaBudget(st, { budget: 40, rebuild: async (u) => { rebuilt.push(u); return fakeBlock(5); } });
  assert.ok(total <= 40, 'total deve caber: ' + total);
  assert.equal(rebuilt[0], 'u2', 'o MAIOR (30) recomprime primeiro');
  assert.equal(st.blocks.length, 3, 'nenhum arquivo descartado quando a recompressão basta');
  assert.deepEqual(st.oversizeFiles, []);
  assert.ok(st.degradedFiles.length >= 1, 'arquivo recomprimido deve ser marcado como degradado');
});
await ta('orçamento: se recompressão não basta, descarta o maior com erro nomeado (arrays alinhados)', async () => {
  const st = { blocks: [fakeBlock(25), fakeBlock(30)], labels: ['peq', 'grande'], urls: ['u1', 'u2'], oversizeFiles: [], degradedFiles: [], errors: [] };
  const total = await enforceMediaBudget(st, { budget: 26, rebuild: async () => { throw new Error('sem imagemagick'); } });
  assert.ok(total <= 26);
  assert.equal(st.blocks.length, 1);
  assert.equal(st.labels[0], 'peq', 'labels alinhados após descarte');
  assert.ok(st.oversizeFiles.includes('grande'), 'descartado vai para oversizeFiles (laudo diz excesso de tamanho)');
  assert.ok(st.errors[0].includes('passou do limite'));
});
await ta('orçamento: recomprimido-e-DEPOIS-descartado nunca fica em duas listas (reprovação do CEO)', async () => {
  // rebuild reduz 30→28, mas ainda acima do budget de 26 → arquivo é descartado
  const st = { blocks: [fakeBlock(10), fakeBlock(30)], labels: ['peq', 'grande'], urls: ['u1', 'u2'], oversizeFiles: [], degradedFiles: [], errors: [] };
  const total = await enforceMediaBudget(st, { budget: 26, rebuild: async () => fakeBlock(28) });
  assert.ok(total <= 26);
  assert.ok(st.oversizeFiles.includes('grande'));
  assert.ok(!st.degradedFiles.includes('grande'), 'descartado NÃO pode constar como "anexado com qualidade reduzida"');
  assert.equal(st.blocks.length, 1);
  assert.equal(st.labels[0], 'peq');
});
await ta('orçamento: caso dentro do limite passa intocado', async () => {
  const st = { blocks: [fakeBlock(10)], labels: ['a'], urls: ['u1'], oversizeFiles: [], degradedFiles: [], errors: [] };
  let called = false;
  await enforceMediaBudget(st, { budget: 100, rebuild: async () => { called = true; } });
  assert.ok(!called && st.blocks.length === 1 && st.errors.length === 0);
});

t('aviso 📎 tem throttle: no máximo 1 a cada 120s por grupo', () => {
  const chatId = 'throttle@g.us';
  assert.equal(shouldNotifyLate(chatId, 1000_000), true);
  assert.equal(shouldNotifyLate(chatId, 1000_000 + 30_000), false);
  assert.equal(shouldNotifyLate(chatId, 1000_000 + 121_000), true);
});


// ── CASO 23: revisão em loop de 04/08 — regressões dos achados dos auditores ──
const _w = await import('../src/webhook.js');
t('getBody: NUNCA usa o texto de mensagem citada (reply não injeta card antigo)', () => {
  const card = 'xxxx\nPaciente: Alice\n' + 'linha\n'.repeat(50) + '❌❌❌❌';
  assert.equal(_w.getBody({ body: 'ok', quotedMsgBody: card }), 'ok');
  assert.equal(_w.getBody({ body: 'ok', contextInfo: { quotedMessage: { conversation: card } } }), 'ok');
  assert.equal(_w.getBody({ body: 'ok', message: { extendedTextMessage: { contextInfo: { quotedMessage: { conversation: card } } } } }), 'ok');
});

const _t3 = await import('../src/triage.js');
t('dedupeLabels: legendas repetidas viram únicas (indexOf nunca tira o aviso do arquivo errado)', () => {
  assert.deepEqual(_t3.dedupeLabels(['Hemograma', 'Hemograma', 'ECG', 'Hemograma']),
    ['Hemograma', 'Hemograma (2)', 'ECG', 'Hemograma (3)']);
});

t('extractName: abreviações Pcte/Pac/Paciente(a) de cards reais', () => {
  assert.equal(extractName(['Pcte: Maria José']), 'Maria José');
  assert.equal(extractName(['Pac: Joana Silva']), 'Joana Silva');
  assert.equal(extractName(['Paciente(a): Carla Souza']), 'Carla Souza');
});

t('extractSurgery: para no rótulo seguinte (Anestesista/Convênio/Hospital…)', () => {
  assert.equal(extractSurgery(['Cirurgia: Rinoplastia\nAnestesista: Dr. Fulano']), 'Rinoplastia');
  assert.equal(extractSurgery(['Procedimento: Mamoplastia\nConvênio: Particular']), 'Mamoplastia');
});

t('BOT_MARKERS: "reenviar os exames" em texto clínico humano NÃO é descartado como eco', () => {
  const msgs = [
    { id: 'bm1', type: 'chat', body: 'xxxx\nPaciente: Bia\nProcedimento: Lipo', timestamp: 100 },
    { id: 'bm2', type: 'chat', body: 'Paciente orientada a reenviar os exames atualizados', timestamp: 101 },
    { id: 'bm3', type: 'chat', body: '❌❌❌❌', timestamp: 102 },
  ];
  const cases = splitIntoCases(msgs, new Set());
  assert.equal(cases.length, 1);
  assert.ok(cases[0].texts.some((x) => x.includes('reenviar os exames atualizados')),
    'orientação clínica humana deve permanecer no caso');
});

const _s3 = await import('../src/store.js');
t('store: caso ABERTO nunca perde o início por cap de mensagens', () => {
  const cid = 'cap-open@g.us';
  _s3.resetChat(cid);
  _s3.setCaseOpen(cid, true);
  _s3.appendMessage(cid, { id: 'first', type: 'chat', body: 'xxxx\nPaciente: Zoe', timestamp: 1 });
  for (let i = 0; i < 850; i++) _s3.appendMessage(cid, { id: 'm' + i, type: 'chat', body: 'linha ' + i, timestamp: 2 + i });
  const msgs = _s3.getMessages(cid);
  assert.ok(msgs.some((m) => m.id === 'first'), 'card inicial deve sobreviver com caso aberto');
  _s3.resetChat(cid);
});


// ── CASO 24: admin por número — tolerância de formato (incidente 04/08) ──────
const _c4 = await import('../src/commands.js');
t('numbersMatch: casa com/sem DDI e nunca por sufixo curto', () => {
  assert.ok(_c4.numbersMatch('5583999999999', '5583999999999'), 'igual exato');
  assert.ok(_c4.numbersMatch('5583999999999', '83999999999'), 'sem DDI casa');
  assert.ok(_c4.numbersMatch('83999999999', '5583999999999'), 'simétrico');
  assert.ok(!_c4.numbersMatch('5583999999999', '5511888888888'), 'número diferente nunca casa');
  assert.ok(!_c4.numbersMatch('9999', '5583999999999'), 'sufixo curto (<8) nunca casa');
  assert.ok(!_c4.numbersMatch('', '5583999999999'), 'vazio nunca casa');
});

// ── CASO 25: rodada 2 de auditoria 04/08 — regressões dos 13 achados ─────────
t('numbersMatch: mínimo 11 dígitos — fixo Campinas não vira admin pelo sufixo do celular RJ', () => {
  assert.ok(!_c4.numbersMatch('5521987654321', '1987654321'), 'falso positivo DDD21/DDD19 eliminado');
  assert.ok(_c4.numbersMatch('5583999999999', '83999999999'), 'tolerância de DDI preservada (11 dígitos)');
});

t('dedupeLabels: legenda literal "X (2)" não colide com sufixo gerado', () => {
  const out = _t3.dedupeLabels(['Raio-X', 'Raio-X', 'Raio-X (2)']);
  assert.equal(new Set(out).size, 3, 'todos os labels devem ser únicos: ' + out.join(' | '));
});

t('gateDecision: ❌❌ solto com caso FECHADO não é gravado (regra absoluta)', () => {
  const g = _w.gateDecision(false, 'chat', 'que situação hein ❌❌❌❌');
  assert.equal(g.store, false, 'reação solta com ❌ não pode poluir o store');
  assert.equal(g.nowOpen, false);
});

t('extractSurgery: texto corrido iniciando linha com "ASA" não corta a cirurgia', () => {
  const s = extractSurgery(['Cirurgia: Lipoaspiração\nASA alta risco cardiovascular, atenção']);
  assert.ok(s.includes('ASA alta'), 'descrição livre deve permanecer: ' + s);
  assert.equal(extractSurgery(['Cirurgia: Rinoplastia\nAnestesista: Dr. Fulano']), 'Rinoplastia', 'rótulo com ":" ainda para');
});

t('BOT_MARKERS: mensagem humana com 🔄 dentro de caso NÃO é descartada', () => {
  const msgs = [
    { id: 'r1', type: 'chat', body: 'xxxx\nPaciente: Duda\nProcedimento: Masto', timestamp: 100 },
    { id: 'r2', type: 'chat', body: '🔄 Vou reagendar para semana que vem, aguarde', timestamp: 101 },
    { id: 'r3', type: 'chat', body: '❌❌❌❌', timestamp: 102 },
  ];
  const cases = splitIntoCases(msgs, new Set());
  assert.equal(cases.length, 1);
  assert.ok(cases[0].texts.some((x) => x.includes('reagendar')), 'coordenação humana deve permanecer no caso');
});

await ta('webhook: fechar caso NÃO corta o início do caso recém-fechado (cap aberto no append do ❌❌❌❌)', async () => {
  const cid = 'cap-close@g.us';
  _s3.resetChat(cid);
  const wh = (id, body, ts) => _w.handleWebhook({ event_type: 'message_received', data: { id, from: cid, type: 'chat', body, timestamp: ts } });
  await wh('cc-first', 'xxxx\nPaciente: Zilda\nProcedimento: Lipo', 10);
  for (let i = 0; i < 850; i++) await wh('cc-' + i, 'linha ' + i, 11 + i);
  await wh('cc-close', '❌❌❌❌', 999);
  const msgs = _s3.getMessages(cid);
  assert.ok(msgs.some((m) => m.id === 'cc-first'), 'card de abertura deve sobreviver ao fechamento');
  assert.equal(_s3.isCaseOpen(cid), false, 'caso deve constar fechado');
  _s3.resetChat(cid);
});

// ── CASO 26: /tamanhos — estatística de tamanhos de mídia ────────────────────
t('mediaSizeStats: média/mediana/faixas e contagem >20MB corretas', () => {
  const MB = 1024 * 1024;
  const st = _c4.mediaSizeStats([0.5 * MB, 2 * MB, 7 * MB, 15 * MB, 25 * MB, 3 * MB]);
  assert.equal(st.count, 6);
  assert.equal(st.max, 25 * MB);
  assert.equal(st.over20, 1, 'só um arquivo acima de 20MB');
  assert.equal(st.buckets.reduce((s, b) => s + b.count, 0), 6, 'faixas cobrem todos');
  assert.equal(st.median, 5 * MB, 'mediana de [0.5,2,3,7,15,25] = (3+7)/2 = 5MB');
});
t('mediaSizeStats: lista vazia não explode', () => {
  const st = _c4.mediaSizeStats([]);
  assert.equal(st.count, 0); assert.equal(st.avg, 0); assert.equal(st.over20, 0);
});

console.log(`\n${fail === 0 ? '🎉' : '⚠️'} ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
