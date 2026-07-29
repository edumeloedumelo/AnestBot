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
  assert.deepEqual(d, { store: false, nowOpen: false });
});
t('gate: mídia fora de bloco NÃO é capturada', () => {
  assert.equal(gateDecision(false, 'image', '').store, false);
});
t('gate: xxxx abre e é capturado (inclusive colado ao card)', () => {
  assert.deepEqual(gateDecision(false, 'chat', 'xxxx'), { store: true, nowOpen: true });
  assert.deepEqual(gateDecision(false, 'chat', 'Xxxx\n\n🩺 Olá!\n🔹 Procedimento: Rino'), { store: true, nowOpen: true });
});
t('gate: conteúdo e mídia DENTRO do bloco são capturados', () => {
  assert.equal(gateDecision(true, 'chat', '🔹 Paciente: Ana').store, true);
  assert.equal(gateDecision(true, 'document', 'exames.pdf').store, true);
});
t('gate: ❌❌❌❌ fecha o bloco (inclusive colado ao conteúdo)', () => {
  assert.deepEqual(gateDecision(true, 'chat', '❌❌❌❌'), { store: true, nowOpen: false });
  assert.deepEqual(gateDecision(true, 'chat', 'última info\n❌❌❌❌'), { store: true, nowOpen: false });
});
t('gate: depois de fechar, conversa volta a ser ignorada', () => {
  const c1 = gateDecision(true, 'chat', '❌❌❌❌');
  assert.equal(gateDecision(c1.nowOpen, 'chat', 'obrigado!').store, false);
  assert.equal(gateDecision(c1.nowOpen, 'image', '').store, false);
});
t('gate: caso completo numa mensagem só abre e fecha', () => {
  assert.deepEqual(gateDecision(false, 'chat', 'xxxx\n🔹 Procedimento: Lipo\n❌❌❌❌'), { store: true, nowOpen: false });
});

console.log(`\n${fail === 0 ? '🎉' : '⚠️'} ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
