// Suíte de testes da ANESTBOT 2.0 — cobre os cenários que falhavam na 1.0.
// Roda offline (sem rede): exercita store → webhook → parser → extração.
import assert from 'assert';
import { getBody } from '../src/webhook.js';
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

console.log(`\n${fail === 0 ? '🎉' : '⚠️'} ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
