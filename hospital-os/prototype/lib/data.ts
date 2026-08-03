// Dados 100% sintéticos. Nenhum dado real de paciente. (Princípio: proibido
// dado real em desenvolvimento — ver docs/GOVERNANCE.md §7.)

export type Paciente = {
  id: string;
  nome: string;
  nascimento: string; // dd/mm/aaaa
  idade: number;
  sexo: "F" | "M";
  prontuario: string;
  convenio: string;
  alergias: string[];
};

export const pacientes: Paciente[] = [
  { id: "p1", nome: "Maria Aparecida Souza (fictício)", nascimento: "12/03/1958", idade: 68, sexo: "F", prontuario: "000124", convenio: "Unimed Teste", alergias: ["Dipirona", "Látex"] },
  { id: "p2", nome: "João Carlos Ferreira (fictício)", nascimento: "04/07/1979", idade: 47, sexo: "M", prontuario: "000387", convenio: "Bradesco Teste", alergias: [] },
  { id: "p3", nome: "Ana Beatriz Lima (fictício)", nascimento: "22/11/1991", idade: 34, sexo: "F", prontuario: "000502", convenio: "SulAmérica Teste", alergias: ["Penicilina"] },
  { id: "p4", nome: "Carlos Eduardo Ramos (fictício)", nascimento: "30/01/1950", idade: 76, sexo: "M", prontuario: "000615", convenio: "Particular", alergias: [] },
  { id: "p5", nome: "Fernanda Oliveira Castro (fictício)", nascimento: "15/09/1985", idade: 40, sexo: "F", prontuario: "000733", convenio: "Amil Teste", alergias: ["Iodo"] },
  { id: "p6", nome: "Maria Aparecida de Souza (fictício)", nascimento: "12/03/1958", idade: 68, sexo: "F", prontuario: "000891", convenio: "Particular", alergias: [] },
];

export type StatusCirurgia =
  | "solicitada"
  | "autorizada"
  | "confirmada"
  | "em_preparo"
  | "em_sala"
  | "em_rpa"
  | "concluida"
  | "cancelada";

export const statusInfo: Record<StatusCirurgia, { label: string; chip: string; bar: string }> = {
  solicitada: { label: "Solicitada", chip: "bg-slate-100 text-slate-700 border-slate-300", bar: "bg-slate-400" },
  autorizada: { label: "Autorizada", chip: "bg-sky-50 text-sky-800 border-sky-300", bar: "bg-sky-500" },
  confirmada: { label: "Confirmada", chip: "bg-blue-50 text-blue-800 border-blue-300", bar: "bg-blue-600" },
  em_preparo: { label: "Em preparo", chip: "bg-indigo-50 text-indigo-800 border-indigo-300", bar: "bg-indigo-500" },
  em_sala: { label: "Em sala", chip: "bg-emerald-50 text-emerald-800 border-emerald-300", bar: "bg-emerald-600" },
  em_rpa: { label: "Em RPA", chip: "bg-violet-50 text-violet-800 border-violet-300", bar: "bg-violet-500" },
  concluida: { label: "Concluída", chip: "bg-slate-100 text-slate-500 border-slate-200", bar: "bg-slate-300" },
  cancelada: { label: "Cancelada", chip: "bg-rose-50 text-rose-800 border-rose-300", bar: "bg-rose-500" },
};

export type Cirurgia = {
  id: string;
  pacienteId: string;
  procedimento: string;
  tuss: string;
  lateralidade: "Direita" | "Esquerda" | "Bilateral" | "N/A";
  cirurgiao: string;
  anestesista: string;
  sala: string;
  inicio: number; // minutos desde 00:00
  duracao: number; // minutos
  status: StatusCirurgia;
  asa: "I" | "II" | "III" | "IV";
  pendencias: string[];
};

export const salas = ["Sala 1", "Sala 2", "Sala 3", "Sala 4"];

export const cirurgias: Cirurgia[] = [
  { id: "c1", pacienteId: "p1", procedimento: "Colecistectomia videolaparoscópica", tuss: "31005497", lateralidade: "N/A", cirurgiao: "Dr. Teste Andrade", anestesista: "Dr. Teste Melo", sala: "Sala 1", inicio: 7 * 60 + 30, duracao: 120, status: "em_sala", asa: "II", pendencias: [] },
  { id: "c2", pacienteId: "p2", procedimento: "Artroscopia de joelho", tuss: "30731063", lateralidade: "Direita", cirurgiao: "Dra. Teste Nunes", anestesista: "Dr. Teste Melo", sala: "Sala 1", inicio: 10 * 60, duracao: 90, status: "confirmada", asa: "I", pendencias: [] },
  { id: "c3", pacienteId: "p3", procedimento: "Mamoplastia redutora", tuss: "30602084", lateralidade: "Bilateral", cirurgiao: "Dr. Teste Prado", anestesista: "Dra. Teste Rocha", sala: "Sala 2", inicio: 8 * 60, duracao: 180, status: "em_sala", asa: "I", pendencias: [] },
  { id: "c4", pacienteId: "p4", procedimento: "RTU de próstata", tuss: "31201075", lateralidade: "N/A", cirurgiao: "Dr. Teste Cunha", anestesista: "Dra. Teste Rocha", sala: "Sala 2", inicio: 12 * 60, duracao: 90, status: "autorizada", asa: "III", pendencias: ["Avaliação pré-anestésica pendente", "Reserva de leito não confirmada"] },
  { id: "c5", pacienteId: "p5", procedimento: "Tireoidectomia total", tuss: "30403044", lateralidade: "N/A", cirurgiao: "Dra. Teste Braga", anestesista: "Dr. Teste Viana", sala: "Sala 3", inicio: 7 * 60 + 30, duracao: 150, status: "em_rpa", asa: "II", pendencias: [] },
  { id: "c6", pacienteId: "p2", procedimento: "Herniorrafia inguinal", tuss: "31003079", lateralidade: "Esquerda", cirurgiao: "Dr. Teste Andrade", anestesista: "Dr. Teste Viana", sala: "Sala 3", inicio: 11 * 60, duracao: 75, status: "confirmada", asa: "I", pendencias: ["OPME sem confirmação do fornecedor"] },
  { id: "c7", pacienteId: "p3", procedimento: "Septoplastia", tuss: "30502041", lateralidade: "N/A", cirurgiao: "Dr. Teste Sales", anestesista: "Dra. Teste Lopes", sala: "Sala 4", inicio: 9 * 60, duracao: 60, status: "concluida", asa: "I", pendencias: [] },
  { id: "c8", pacienteId: "p1", procedimento: "Facectomia + LIO", tuss: "30306027", lateralidade: "Direita", cirurgiao: "Dra. Teste Melo Jr.", anestesista: "Dra. Teste Lopes", sala: "Sala 4", inicio: 13 * 60, duracao: 45, status: "autorizada", asa: "II", pendencias: ["Autorização do convênio em análise"] },
  { id: "c9", pacienteId: "p4", procedimento: "Colonoscopia com polipectomia", tuss: "40202461", lateralidade: "N/A", cirurgiao: "Dr. Teste Cunha", anestesista: "Dr. Teste Melo", sala: "Sala 4", inicio: 15 * 60, duracao: 45, status: "solicitada", asa: "III", pendencias: ["Jejum não confirmado", "Termo de consentimento pendente"] },
  { id: "c10", pacienteId: "p5", procedimento: "Safenectomia", tuss: "30907056", lateralidade: "Bilateral", cirurgiao: "Dra. Teste Nunes", anestesista: "Dr. Teste Viana", sala: "Sala 2", inicio: 15 * 60 + 30, duracao: 120, status: "confirmada", asa: "II", pendencias: [] },
];

export function pacienteDe(c: Cirurgia): Paciente {
  return pacientes.find((p) => p.id === c.pacienteId)!;
}

export function hora(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---- Dicionário de indicadores (todo indicador exibido tem entrada aqui) ----
export type Indicador = {
  id: string;
  nome: string;
  valor: string;
  variacao?: string;
  definicao: string;
  formula: string;
  fonte: string;
  periodo: string;
  limitacoes: string;
};

export const indicadores: Indicador[] = [
  {
    id: "volume", nome: "Cirurgias realizadas", valor: "184", variacao: "+6% vs mês anterior",
    definicao: "Total de cirurgias com status Concluída no período.",
    formula: "Contagem de casos com Sign Out registrado no mês.",
    fonte: "Jornada perioperatória (eventos de status).",
    periodo: "Mês corrente (dados sintéticos).",
    limitacoes: "Não inclui procedimentos ambulatoriais fora do centro cirúrgico.",
  },
  {
    id: "ocupacao", nome: "Ocupação de salas", valor: "72%",
    definicao: "Tempo de sala utilizado sobre o tempo de sala disponível.",
    formula: "Σ duração real dos casos ÷ (salas × horas disponíveis) × 100.",
    fonte: "Mapa cirúrgico (horários reais registrados).",
    periodo: "Mês corrente, 7h–19h, dias úteis.",
    limitacoes: "Turnover entre casos conta como tempo não utilizado.",
  },
  {
    id: "atraso", nome: "Atraso médio de início", valor: "18 min",
    definicao: "Diferença média entre horário agendado e entrada em sala do 1º caso do dia.",
    formula: "Média (hora real de entrada − hora agendada) dos primeiros casos.",
    fonte: "Mapa cirúrgico + eventos de jornada.",
    periodo: "Mês corrente.",
    limitacoes: "Casos de urgência encaixados são excluídos.",
  },
  {
    id: "cancelamento", nome: "Taxa de cancelamento", valor: "4,3%",
    definicao: "Cirurgias canceladas após confirmação sobre o total agendado.",
    formula: "Cancelamentos pós-confirmação ÷ total agendado × 100.",
    fonte: "Eventos de status com causa registrada.",
    periodo: "Mês corrente.",
    limitacoes: "Cancelamentos antes da confirmação não entram no numerador.",
  },
  {
    id: "rpa", nome: "Tempo médio em RPA", valor: "62 min",
    definicao: "Permanência média entre admissão na RPA e alta da RPA.",
    formula: "Média (alta RPA − admissão RPA) dos casos concluídos.",
    fonte: "Módulo de recuperação pós-anestésica.",
    periodo: "Mês corrente.",
    limitacoes: "Pacientes com destino UTI são excluídos.",
  },
  {
    id: "checklist", nome: "Adesão ao checklist", valor: "96%",
    definicao: "Cirurgias com as 3 fases do checklist completas.",
    formula: "Casos com Sign In + Time Out + Sign Out ÷ casos concluídos × 100.",
    fonte: "Módulo de checklist de cirurgia segura.",
    periodo: "Mês corrente.",
    limitacoes: "Checklist parcial conta como não adesão.",
  },
];

export const causasCancelamento: { causa: string; qtd: number }[] = [
  { causa: "Condição clínica do paciente", qtd: 3 },
  { causa: "Autorização não liberada", qtd: 2 },
  { causa: "Jejum inadequado", qtd: 1 },
  { causa: "OPME não entregue", qtd: 1 },
  { causa: "Indisponibilidade de sala", qtd: 1 },
];
