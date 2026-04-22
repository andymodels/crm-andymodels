import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DynamicTextListField from './components/DynamicTextListField';
import OperacaoAgenda from './components/OperacaoAgenda';
import AgendaCentral from './components/AgendaCentral';
import WebsiteModelsPage from './components/WebsiteModelsPage';
import WebsiteHomeOrderPage from './components/WebsiteHomeOrderPage';
import WebsiteInstagramPage from './components/WebsiteInstagramPage';
import WebsiteRadioPage from './components/WebsiteRadioPage';
import WebsitePlaceholderPage from './components/WebsitePlaceholderPage';
import WebsiteInscricoesPage from './components/WebsiteInscricoesPage';
import WebsiteModeloEditorPage from './components/WebsiteModeloEditorPage';
import { fetchWithAuth } from './apiConfig';
import AtendimentoPage from './components/AtendimentoPage';
import { sanitizeAndValidateCliente, sanitizeAndValidateModelo, onlyDigits } from './utils/brValidators';
import { sanitizeAndValidateFormasPagamentoArray } from './utils/formasPagamento';
import { formatCpfDisplay, formatCnpjDisplay, formatCepDisplay, formatPhoneDisplay } from './utils/brMasks';
import { toDateInputValue, toTimeInputValue } from './utils/dateInput';

const rawApi = import.meta.env.VITE_API_URL;
const trimmed =
  rawApi !== undefined && rawApi !== null ? String(rawApi).trim() : '';
const DEV_PROXY_PORT = import.meta.env.VITE_DEV_PROXY_PORT || '3030';

/** Em dev, URLs locais passam pelo proxy do Vite (vite.config.js) — evita bloqueios entre portas. */
const useViteProxy =
  import.meta.env.DEV &&
  (trimmed === '' ||
    trimmed === `http://localhost:${DEV_PROXY_PORT}` ||
    trimmed === `http://127.0.0.1:${DEV_PROXY_PORT}` ||
    trimmed === 'http://localhost:3001' ||
    trimmed === 'http://127.0.0.1:3001' ||
    trimmed === 'http://localhost:3002' ||
    trimmed === 'http://127.0.0.1:3002');
const API_URL = useViteProxy
  ? ''
  : trimmed !== ''
    ? trimmed.replace(/\/$/, '')
    : '';

/** Rotas Express montadas em `/api` (ver backend/src/app.js). */
const API_BASE = API_URL ? `${API_URL}/api` : '/api';

const API_REQUEST_MS = 25_000;

/** Corta pedidos ao backend; sem isto o botão fica em "Salvando…" se a API não responder. */
function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), API_REQUEST_MS);
  return fetch(url, { credentials: 'include', ...options, signal: controller.signal }).finally(() => {
    clearTimeout(id);
  });
}

/** Express devolve HTML "Cannot POST /api/..." quando não há rota — outro servidor na mesma porta. */
function throwIfHtmlOrCannotPost(raw, httpStatus) {
  const t = String(raw || '');
  if (!t.includes('<') && !/cannot\s+post/i.test(t)) return;
  const m = t.match(/Cannot POST\s+([^\s<]+)/i);
  if (m) {
    throw new Error(
      `A porta do backend não é a deste CRM (pedido ${m[1]} foi recusado). Feche o outro programa nessa porta ou alinhe PORT no backend/.env com VITE_DEV_PROXY_PORT no frontend/.env e reinicie.`,
    );
  }
  throw new Error(
    `Resposta inválida (HTML) do servidor (HTTP ${httpStatus}). Confirme que corre "npm run dev" na pasta backend deste projeto.`,
  );
}

const formatBRL = (value) => {
  const n = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(n) ? n : 0);
};

const formatOrcamentoCriadoEm = (value) => {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const labelOrcamentoStatus = (s) => {
  if (s === 'rascunho') return 'Rascunho';
  if (s === 'aprovado') return 'Aprovado';
  if (s === 'cancelado') return 'Cancelado';
  return s ? String(s) : '—';
};

/** Status operacional da O.S. (legado: aberta → ativa, recebida → finalizada). */
const labelOsStatus = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'aberta') return 'ativa';
  if (v === 'recebida') return 'finalizada';
  if (v === 'ativa') return 'ativa';
  if (v === 'finalizada') return 'finalizada';
  if (v === 'cancelada') return 'cancelada';
  return s ? String(s) : '—';
};

const labelContratoStatus = (s) => {
  if (s === 'aguardando_assinatura') return 'Aguardando assinatura';
  if (s === 'assinado') return 'Assinado';
  if (s === 'recebido') return 'Recebido';
  if (s === 'cancelado') return 'Cancelado';
  return s ? String(s) : '—';
};

/** Com `emitir_contrato`, só libera pagamento a modelo com contrato assinado ou recebido (scan). */
function pagamentoModeloLiberadoContrato(row) {
  const emitir = row?.emitir_contrato === true || row?.emitir_contrato === 't' || row?.emitir_contrato === 1;
  if (!emitir) return true;
  const s = String(row?.contrato_status || '').toLowerCase();
  return s === 'assinado' || s === 'recebido';
}

const nPrev = (v) => Number(v || 0);

/** Cachê/QE sem linhas de modelo: mesmo critério do input (valor manual ou total estimado). */
function orcamentoValorBaseSemModelo(form) {
  const vs = String(form.valor_servico_sem_modelo ?? '').trim();
  const cb = String(form.cache_base_estimado_total ?? '').trim();
  if (vs !== '') return nPrev(vs);
  if (cb !== '') return nPrev(cb);
  return 0;
}
const medidaCamposFeminino = [
  'medida_altura',
  'medida_busto',
  'medida_cintura',
  'medida_quadril',
  'medida_torax',
  'medida_sapato',
  'medida_cabelo',
  'medida_olhos',
];
const medidaCamposMasculino = [
  'medida_altura',
  'medida_torax',
  'medida_busto',
  'medida_cintura',
  'medida_quadril',
  'medida_sapato',
  'medida_cabelo',
  'medida_olhos',
];

function sexoGrupo(valor) {
  const v = String(valor || '').trim().toLowerCase();
  if (!v) return '';
  if (v.startsWith('f')) return 'feminino';
  if (v.startsWith('m')) return 'masculino';
  return '';
}

/** Rótulos de medidas no CRM: PT principal + EN; padrão feminino vs masculino (campos BD iguais ao WebsiteModeloEditorPage). */
function labelMedidaModelo(field, sexo) {
  const g = sexoGrupo(sexo);
  const fem = {
    medida_altura: 'Altura (Height)',
    medida_busto: 'Busto (Bust)',
    medida_cintura: 'Cintura (Waist)',
    medida_quadril: 'Quadril (Hips)',
    medida_torax: 'Manequim (Size)',
    medida_sapato: 'Sapatos (Shoes)',
    medida_cabelo: 'Cabelos (Hair)',
    medida_olhos: 'Olhos (Eyes)',
  };
  const masc = {
    medida_altura: 'Altura (Height)',
    medida_torax: 'Tórax (Chest)',
    medida_busto: 'Terno (Suit)',
    medida_cintura: 'Camisa (Shirt)',
    medida_quadril: 'Manequim (Size)',
    medida_sapato: 'Sapatos (Shoes)',
    medida_cabelo: 'Cabelos (Hair)',
    medida_olhos: 'Olhos (Eyes)',
  };
  if (g === 'feminino') return fem[field] || null;
  if (g === 'masculino') return masc[field] || null;
  const indef = {
    medida_altura: 'Altura (Height)',
    medida_busto: 'Busto (Bust) ou Terno (Suit) — defina o sexo',
    medida_torax: 'Tórax (Chest) ou Manequim (Size) — defina o sexo',
    medida_cintura: 'Cintura (Waist) ou Camisa (Shirt) — defina o sexo',
    medida_quadril: 'Quadril (Hips) ou Manequim (Size) — defina o sexo',
    medida_sapato: 'Sapatos (Shoes)',
    medida_cabelo: 'Cabelos (Hair)',
    medida_olhos: 'Olhos (Eyes)',
  };
  return indef[field] || null;
}

function createEmptyOrcamentoForm() {
  return {
    cliente_id: '',
    tipo_proposta_os: 'com_modelo',
    tipo_trabalho: '',
    descricao: '',
    data_trabalho: '',
    horario_trabalho: '',
    local_trabalho: '',
    cache_base_estimado_total: '',
    valor_servico_sem_modelo: '',
    taxa_agencia_percent: '',
    extras_agencia_valor: '',
    imposto_percent: '10',
    condicoes_pagamento: '',
    data_vencimento: '',
    uso_imagem: '',
    prazo: '',
    territorio: '',
    parceiro_id: '',
    parceiro_percent: '',
    booker_id: '',
    booker_percent: '',
    job_sem_modelos: false,
    linhas: [],
  };
}

/**
 * Espelha `computeOsFinancials`: cachê somado é líquido ao modelo; taxa % sobre cachês; extras;
 * imposto % sobre subtotal; total = subtotal + imposto (sem desconto no cachê).
 */
function previewOrcamentoFinanceiro(form) {
  const impPct = nPrev(form.imposto_percent ?? 10);
  const feePct = nPrev(form.taxa_agencia_percent);
  const extrasAg = nPrev(form.extras_agencia_valor);
  const pp =
    form.parceiro_percent !== '' && form.parceiro_percent != null ? nPrev(form.parceiro_percent) / 100 : 0;
  const bp =
    form.booker_percent !== '' && form.booker_percent != null ? nPrev(form.booker_percent) / 100 : 0;
  const linhas = (form.job_sem_modelos ? [] : form.linhas || [])
    .filter((l) => {
      const mid = l.modelo_id !== '' && l.modelo_id != null ? Number(l.modelo_id) : NaN;
      return Number.isFinite(mid) && mid > 0;
    })
    .map((l) => ({
      cache_modelo: nPrev(l.cache_modelo),
      emite_nf_propria: Boolean(l.emite_nf_propria),
    }));
  const tipo = linhas.length > 0 ? 'com_modelo' : 'sem_modelo';

  if (tipo === 'sem_modelo') {
    const vs = orcamentoValorBaseSemModelo(form);
    const taxaAgenciaValor = vs * (feePct / 100);
    const subtotal = vs + taxaAgenciaValor + extrasAg;
    const impostoValor = subtotal * (impPct / 100);
    const totalCliente = subtotal + impostoValor;
    /** Com “JOB sem modelos”: comissão sobre tudo após imposto. Sem marcar: QE ainda é dos modelos → só taxa+extras. */
    const modeloLiquidoTotal = form.job_sem_modelos ? 0 : vs;
    const agenciaParcial = totalCliente - impostoValor - modeloLiquidoTotal;
    const parceiroValor = agenciaParcial * pp;
    const agenciaAposParceiro = agenciaParcial - parceiroValor;
    const bookerValor = agenciaAposParceiro * bp;
    const agenciaFinal = agenciaAposParceiro - bookerValor;
    return {
      totalCliente,
      subtotal,
      taxa_agencia_valor: taxaAgenciaValor,
      impostoValor,
      parceiroValor,
      bookerValor,
      agenciaFinal,
      resultadoAgencia: agenciaFinal,
    };
  }

  let cacheTotal;
  if (linhas.length > 0) {
    cacheTotal = linhas.reduce((s, l) => s + l.cache_modelo, 0);
  } else {
    cacheTotal = nPrev(form.cache_base_estimado_total);
  }
  const taxaAgenciaValor = cacheTotal * (feePct / 100);
  const subtotal = cacheTotal + taxaAgenciaValor + extrasAg;
  const impostoValor = subtotal * (impPct / 100);
  const totalCliente = subtotal + impostoValor;
  const modeloLiquidoTotal = cacheTotal;
  const agenciaParcial = totalCliente - impostoValor - modeloLiquidoTotal;
  const parceiroValor = agenciaParcial * pp;
  const agenciaAposParceiro = agenciaParcial - parceiroValor;
  const bookerValor = agenciaAposParceiro * bp;
  const agenciaFinal = agenciaAposParceiro - bookerValor;
  return {
    totalCliente,
    subtotal,
    taxa_agencia_valor: taxaAgenciaValor,
    impostoValor,
    parceiroValor,
    bookerValor,
    agenciaFinal,
    resultadoAgencia: agenciaFinal,
  };
}

/** Garante que o valor já escolhido no `<select>` continue nas opções após filtrar a lista. */
function clientesOrcamentoComSelecao(clienteId, filtrados, todos) {
  const id = clienteId !== '' && clienteId != null ? String(clienteId) : '';
  if (!id) return filtrados;
  if (filtrados.some((c) => String(c.id) === id)) return filtrados;
  const c = todos.find((x) => String(x.id) === id);
  return c ? [c, ...filtrados] : filtrados;
}

function modelosOrcamentoComSelecao(linha, filtrados, listaAtiva) {
  const sel = linha.modelo_id !== '' && linha.modelo_id != null ? Number(linha.modelo_id) : NaN;
  if (!Number.isFinite(sel) || sel <= 0) return filtrados;
  if (filtrados.some((m) => Number(m.id) === sel)) return filtrados;
  const escolhido = listaAtiva.find((m) => Number(m.id) === sel);
  return escolhido ? [escolhido, ...filtrados] : filtrados;
}

const CADASTROS_COM_MULTI_PAGAMENTO = ['modelos', 'bookers', 'parceiros'];
const BRAND_ORANGE = '#F59E0B';
/** Menu principal: ativo — laranja marca; inativo — neutro com bom contraste */
const navMainBtn = (active) =>
  active
    ? 'bg-[#F59E0B] text-white shadow-sm ring-1 ring-amber-500/40'
    : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800';
/** Submenu Cadastros: ativo em laranja mais claro (diferente do laranja sólido do grupo “Cadastros”) */
const navSubBtn = (active) =>
  active
    ? 'border border-orange-200 bg-orange-100 font-semibold text-amber-950 shadow-sm ring-1 ring-orange-300/40'
    : 'border border-transparent bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-800';
const LOAD_ERROR_MESSAGE = 'Erro ao carregar dados. Verifique conexão com servidor.';

const DESPESA_CATEGORIAS = [
  { id: 'impostos', label: 'Impostos' },
  { id: 'operacional', label: 'Operacional' },
  { id: 'outros', label: 'Outros' },
];

const labelDespesaCategoria = (id) => DESPESA_CATEGORIAS.find((c) => c.id === id)?.label || id;

const fieldLabels = {
  tipo_pessoa: 'Tipo de pessoa',
  documento: 'Documento',
  nome_empresa: 'Nome da empresa',
  nome_fantasia: 'Nome fantasia',
  inscricao_estadual: 'Inscrição estadual',
  contato_principal: 'Representante legal (nome completo)',
  documento_representante: 'CPF do representante legal',
  telefone: 'Telefone',
  telefones: 'Telefones',
  email: 'Email',
  emails: 'Emails',
  cep: 'CEP',
  logradouro: 'Logradouro',
  numero: 'Número',
  bairro: 'Bairro',
  cidade: 'Cidade',
  uf: 'UF',
  endereco_completo: 'Endereço',
  observacoes: 'Observações',
  nome: 'Nome',
  cpf: 'CPF',
  data_nascimento: 'Data de Nascimento',
  responsavel_nome: 'Nome do responsável',
  responsavel_cpf: 'CPF do responsável',
  responsavel_telefone: 'Telefone do responsável',
  emite_nf_propria: 'Emite NF própria',
  ativo: 'Ativo',
  origem_cadastro: 'Origem do cadastro',
  status_cadastro: 'Status do cadastro',
  passaporte: 'Passaporte',
  rg: 'RG',
  complemento: 'Complemento',
  sexo: 'Sexo',
  medida_altura: 'Altura (Height)',
  medida_busto: 'Busto (Bust) / Terno (Suit)',
  medida_torax: 'Tórax (Chest) / Manequim (Size)',
  medida_cintura: 'Cintura (Waist) / Camisa (Shirt)',
  medida_quadril: 'Quadril (Hips) / Manequim (Size)',
  medida_sapato: 'Sapatos (Shoes)',
  medida_cabelo: 'Cabelos (Hair)',
  medida_olhos: 'Olhos (Eyes)',
  foto_perfil_base64: 'Foto de perfil',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  formas_pagamento: 'Formas de pagamento',
  razao_social_ou_nome: 'Razão social ou nome',
  cnpj_ou_cpf: 'CNPJ ou CPF',
  tipo_servico: 'Tipo de serviço',
  contato: 'Contato',
  website: 'Website',
};

const labelForField = (field) => fieldLabels[field] || field;

const emptyFormaRecebimento = {
  tipo: 'PIX',
  tipo_chave_pix: 'CPF',
  chave_pix: '',
  banco: '',
  agencia: '',
  conta: '',
  tipo_conta: 'corrente',
};

const normalizeFormasRecebimento = (formas) => {
  if (!Array.isArray(formas) || formas.length === 0) return [{ ...emptyFormaRecebimento }];
  return formas.map((item) => {
    if (typeof item === 'string') {
      return { ...emptyFormaRecebimento, chave_pix: item };
    }
    const tipo = item?.tipo === 'Conta bancária' ? 'Conta bancária' : 'PIX';
    if (tipo === 'PIX') {
      const chave =
        item?.chave_pix != null && String(item.chave_pix).trim() !== ''
          ? String(item.chave_pix)
          : String(item?.valor || '');
      return {
        ...emptyFormaRecebimento,
        tipo: 'PIX',
        tipo_chave_pix: item?.tipo_chave_pix || 'CPF',
        chave_pix: chave,
      };
    }
    return {
      ...emptyFormaRecebimento,
      tipo: 'Conta bancária',
      banco: String(item?.banco || '').trim(),
      agencia: String(item?.agencia || '').trim(),
      conta:
        item?.conta != null && String(item.conta).trim() !== ''
          ? String(item.conta).trim()
          : String(item?.valor || '').trim(),
      tipo_conta: item?.tipo_conta === 'poupanca' ? 'poupanca' : 'corrente',
    };
  });
};

const formatFormaResumo = (f) => {
  if (!f || typeof f !== 'object') return '';
  if (f.tipo === 'Conta bancária') {
    const b = String(f.banco || '').trim();
    const tc = f.tipo_conta === 'poupanca' ? 'Poupança' : 'Corrente';
    return b ? `Conta (${tc}): ${b}` : 'Conta bancária';
  }
  const tk = f.tipo_chave_pix || 'CPF';
  return `PIX (${tk})`;
};

const normalizeDynamicTextList = (items) => {
  if (!Array.isArray(items) || items.length === 0) return [''];
  return items.map((item) => String(item || ''));
};

const calculateAge = (birthDate) => {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
};

const cadastroConfig = {
  clientes: {
    label: 'Clientes',
    endpoint: 'clientes',
    columns: ['nome_empresa', 'tipo_pessoa', 'documento', 'contato_principal', 'documento_representante', 'telefones', 'emails', 'website'],
    form: {
      tipo_pessoa: 'PJ',
      documento: '',
      nome_empresa: '',
      nome_fantasia: '',
      inscricao_estadual: '',
      contato_principal: '',
      documento_representante: '',
      telefones: [''],
      emails: [''],
      cep: '',
      logradouro: '',
      numero: '',
      bairro: '',
      cidade: '',
      uf: '',
      website: 'https://',
      instagram: 'https://www.instagram.com/',
      observacoes: '',
    },
  },
  modelos: {
    label: 'Modelos',
    endpoint: 'modelos',
    columns: [
      'nome',
      'cpf',
      'rg',
      'passaporte',
      'sexo',
      'data_nascimento',
      'origem_cadastro',
      'status_cadastro',
      'telefones',
      'emails',
      'formas_pagamento',
    ],
    form: {
      foto_perfil_base64: '',
      nome: '',
      cpf: '',
      rg: '',
      passaporte: '',
      sexo: '',
      data_nascimento: '',
      instagram: '',
      tiktok: '',
      telefones: [''],
      emails: [''],
      cep: '',
      logradouro: '',
      numero: '',
      complemento: '',
      bairro: '',
      cidade: '',
      uf: '',
      emite_nf_propria: false,
      formas_pagamento: [{ ...emptyFormaRecebimento }],
      responsavel_nome: '',
      responsavel_cpf: '',
      responsavel_telefone: '',
      medida_altura: '',
      medida_busto: '',
      medida_torax: '',
      medida_cintura: '',
      medida_quadril: '',
      medida_sapato: '',
      medida_cabelo: '',
      medida_olhos: '',
      observacoes: '',
      origem_cadastro: 'interno',
      status_cadastro: 'aprovado',
      ativo: true,
    },
  },
  bookers: {
    label: 'Bookers',
    endpoint: 'bookers',
    columns: ['nome', 'cpf', 'telefones', 'emails', 'formas_pagamento'],
    form: {
      nome: '',
      cpf: '',
      cep: '',
      logradouro: '',
      numero: '',
      complemento: '',
      bairro: '',
      cidade: '',
      uf: '',
      telefones: [''],
      emails: [''],
      formas_pagamento: [{ ...emptyFormaRecebimento }],
      observacoes: '',
      ativo: true,
    },
  },
  parceiros: {
    label: 'Parceiros/Fornecedores',
    endpoint: 'parceiros',
    columns: ['razao_social_ou_nome', 'tipo_servico', 'contato', 'telefones', 'formas_pagamento'],
    form: {
      razao_social_ou_nome: '',
      cnpj_ou_cpf: '',
      tipo_servico: '',
      contato: '',
      telefones: [''],
      emails: [''],
      formas_pagamento: [{ ...emptyFormaRecebimento }],
      observacoes: '',
      ativo: true,
    },
  },
};

const CADASTRO_PAINEL_BOTAO_NOVO = {
  clientes: 'Criar novo cliente',
  modelos: 'Criar novo modelo',
  bookers: 'Criar novo booker',
  parceiros: 'Criar novo parceiro/fornecedor',
};

const CADASTRO_PAINEL_BUSCA_DICA = {
  clientes:
    'Você pode buscar por razão social, nome fantasia, CNPJ, CPF, e-mail, telefone ou nome do representante.',
  modelos: 'Você pode buscar por nome, CPF, RG, passaporte, e-mail ou telefone.',
  bookers: 'Você pode buscar por nome, CPF, e-mail ou telefone.',
  parceiros: 'Você pode buscar por razão social ou nome, CNPJ/CPF, tipo de serviço ou contato.',
};

function itemMatchesCadastroBusca(tab, item, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  const qDigits = onlyDigits(rawQuery);
  const push = (arr, v) => {
    if (v == null || v === '') return;
    if (Array.isArray(v)) {
      v.forEach((x) => push(arr, x));
      return;
    }
    if (typeof v === 'object') {
      arr.push(JSON.stringify(v));
      return;
    }
    arr.push(String(v));
  };
  const pieces = [];
  if (tab === 'clientes') {
    push(pieces, item.nome_empresa);
    push(pieces, item.nome_fantasia);
    push(pieces, item.documento);
    push(pieces, item.cnpj);
    push(pieces, item.contato_principal);
    push(pieces, item.email);
    push(pieces, item.telefone);
    push(pieces, item.emails);
    push(pieces, item.telefones);
  } else if (tab === 'modelos') {
    push(pieces, item.nome);
    push(pieces, item.cpf);
    push(pieces, item.rg);
    push(pieces, item.passaporte);
    push(pieces, item.email);
    push(pieces, item.telefone);
    push(pieces, item.emails);
    push(pieces, item.telefones);
  } else if (tab === 'bookers') {
    push(pieces, item.nome);
    push(pieces, item.cpf);
    push(pieces, item.email);
    push(pieces, item.telefone);
    push(pieces, item.emails);
    push(pieces, item.telefones);
  } else if (tab === 'parceiros') {
    push(pieces, item.razao_social_ou_nome);
    push(pieces, item.cnpj_ou_cpf);
    push(pieces, item.tipo_servico);
    push(pieces, item.contato);
    push(pieces, item.email);
    push(pieces, item.telefone);
    push(pieces, item.emails);
    push(pieces, item.telefones);
  }
  const hay = pieces.join(' ').toLowerCase();
  const hayDigits = onlyDigits(pieces.join(''));
  if (!q && qDigits.length < 2) return true;
  if (q.length >= 1 && hay.includes(q)) return true;
  if (qDigits.length >= 2 && hayDigits.includes(qDigits)) return true;
  return false;
}

function App({ authUser, onLogout = () => {} }) {
  const [module, setModule] = useState('inicio');
  const [cadastrosMenuOpen, setCadastrosMenuOpen] = useState(false);
  const [websiteMenuOpen, setWebsiteMenuOpen] = useState(false);
  const [websiteSubView, setWebsiteSubView] = useState('modelos');
  /** Slug do modelo no site ao abrir edição a partir da lista (não é item do menu lateral). */
  const [websiteEditSlug, setWebsiteEditSlug] = useState(null);
  /** ID numérico no admin do site — permite carregar ficha quando o modelo está inativo (API pública 404). */
  const [websiteEditModelId, setWebsiteEditModelId] = useState(null);
  const [tab, setTab] = useState('clientes');
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(cadastroConfig.bookers.form);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  /** Erros do formulário (validação, salvar, apagar). */
  const [error, setError] = useState('');
  /** Erro ao carregar a lista (GET); separado para não apagar mensagens do formulário quando o GET termina depois. */
  const [cadastroListError, setCadastroListError] = useState('');
  const [importSiteBusy, setImportSiteBusy] = useState(false);
  const [importSiteMsg, setImportSiteMsg] = useState('');
  const [cadastroSaving, setCadastroSaving] = useState(false);
  /** Cadastros: `entrada` = painel busca + últimos 10; `formulario` = ficha + lista completa (comportamento anterior). */
  const [cadastrosSubView, setCadastrosSubView] = useState('entrada');
  const [cadastroBuscaInput, setCadastroBuscaInput] = useState('');
  const [apiOnline, setApiOnline] = useState(true);
  const [clients, setClients] = useState([]);
  const [orcamentos, setOrcamentos] = useState([]);
  /** gestao = lista + busca + novo; formulario = criar/editar; lista = paginação completa */
  const [orcamentosSubView, setOrcamentosSubView] = useState('gestao');
  const [orcamentoBuscaInput, setOrcamentoBuscaInput] = useState('');
  const [orcamentoBuscaDebounced, setOrcamentoBuscaDebounced] = useState('');
  const [orcamentosTotal, setOrcamentosTotal] = useState(0);
  const [orcamentosListaPage, setOrcamentosListaPage] = useState(1);
  const [orcamentosListaPageSize, setOrcamentosListaPageSize] = useState(20);
  const [orcamentosListaStatus, setOrcamentosListaStatus] = useState('');
  const [orcamentosListaClienteId, setOrcamentosListaClienteId] = useState('');
  const [orcamentosListaSort, setOrcamentosListaSort] = useState('created_at_desc');
  const [orcamentosRefreshTick, setOrcamentosRefreshTick] = useState(0);
  const [orcamentoForm, setOrcamentoForm] = useState(() => createEmptyOrcamentoForm());
  const [orcamentoEditingId, setOrcamentoEditingId] = useState(null);
  /** Sincronizado com o orçamento em edição (lista/API); usado para travar o formulário se não for rascunho. */
  const [orcamentoEditingStatus, setOrcamentoEditingStatus] = useState(null);
  const [orcamentoEditingOsId, setOrcamentoEditingOsId] = useState(null);
  const [orcamentoError, setOrcamentoError] = useState('');
  const [orcamentoLoading, setOrcamentoLoading] = useState(false);
  /** Filtros rápidos no formulário de orçamento (não vão para a API). */
  const [orcamentoClienteBusca, setOrcamentoClienteBusca] = useState('');
  /** Busca ao lado do select de modelo, uma string por índice de linha (mesmo comprimento que `linhas`). */
  const [orcamentoModeloBuscaPorLinha, setOrcamentoModeloBuscaPorLinha] = useState([]);
  const [contratosList, setContratosList] = useState([]);
  const [contratosLoading, setContratosLoading] = useState(false);
  const [contratosError, setContratosError] = useState('');

  const [osList, setOsList] = useState([]);
  const [osLoading, setOsLoading] = useState(false);
  const [osError, setOsError] = useState('');
  const [osDraft, setOsDraft] = useState(null);
  const [modelosList, setModelosList] = useState([]);
  /** Orçamento / extrato: todos os registros de GET /api/modelos (tabela `modelos`), sem filtrar por ativo/CPF/origem. */
  const modelosParaSelecao = useMemo(
    () => (Array.isArray(modelosList) ? modelosList : []),
    [modelosList],
  );
  const [bookersList, setBookersList] = useState([]);
  const [parceirosList, setParceirosList] = useState([]);
  /** Agregado em torno da O.S.: contratos, a receber, pagamentos modelo (GET /dashboard/alertas). */
  const [alertasOperacionais, setAlertasOperacionais] = useState(null);
  /** Resumo de caixa para o Dashboard (GET /financeiro/resumo). */
  const [dashboardResumo, setDashboardResumo] = useState(null);
  const [dashboardResumoLoading, setDashboardResumoLoading] = useState(false);
  const [contratoEmailDest, setContratoEmailDest] = useState('');
  const [contratoEmailMsg, setContratoEmailMsg] = useState('');
  const [contratoEmailLoading, setContratoEmailLoading] = useState(false);
  const [contratoEmailFallbackLink, setContratoEmailFallbackLink] = useState('');
  const [contratoHtmlFallbackUrl, setContratoHtmlFallbackUrl] = useState('');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova, setSenhaNova] = useState('');
  const [senhaMsg, setSenhaMsg] = useState('');
  const [senhaLoading, setSenhaLoading] = useState(false);

  const [linkCadastroUrl, setLinkCadastroUrl] = useState('');
  const [linkCadastroMsg, setLinkCadastroMsg] = useState('');
  const [linkCadastroLoading, setLinkCadastroLoading] = useState(false);
  const [linkCadastroClienteUrl, setLinkCadastroClienteUrl] = useState('');
  const [linkCadastroClienteMsg, setLinkCadastroClienteMsg] = useState('');
  const [linkCadastroClienteLoading, setLinkCadastroClienteLoading] = useState(false);

  const [finResumo, setFinResumo] = useState(null);
  const [finRecebimentos, setFinRecebimentos] = useState([]);
  const [finOsOptions, setFinOsOptions] = useState([]);
  const [finLoading, setFinLoading] = useState(false);
  const [finError, setFinError] = useState('');
  const [finDespesas, setFinDespesas] = useState([]);
  const [finDespesaFiltroDe, setFinDespesaFiltroDe] = useState('');
  const [finDespesaFiltroAte, setFinDespesaFiltroAte] = useState('');
  const [finDespesaFiltroCategoria, setFinDespesaFiltroCategoria] = useState('');
  const [finDespesaFiltroOsId, setFinDespesaFiltroOsId] = useState('');
  const [finDespesaForm, setFinDespesaForm] = useState({
    data_despesa: '',
    descricao: '',
    valor: '',
    categoria: 'operacional',
    os_id: '',
  });
  /** Modais de ação no Financeiro (sem alterar cálculos). */
  const [finModal, setFinModal] = useState(null);
  const [finReceberOsId, setFinReceberOsId] = useState(null);
  const [finReceberDraft, setFinReceberDraft] = useState({
    valor: '',
    data_recebimento: '',
    observacao: '',
  });
  const [finPagarLinha, setFinPagarLinha] = useState(null);
  const [finPagarDraft, setFinPagarDraft] = useState({
    valor: '',
    data_pagamento: '',
    observacao: '',
  });

  const [extratoRows, setExtratoRows] = useState([]);
  const [extratoLoading, setExtratoLoading] = useState(false);
  const [extratoError, setExtratoError] = useState('');
  const [extratoModeloFilter, setExtratoModeloFilter] = useState('');

  const current = useMemo(() => cadastroConfig[tab], [tab]);
  const tabEntries = useMemo(() => Object.entries(cadastroConfig), []);
  const isClienteTab = module === 'cadastros' && tab === 'clientes';
  const isModeloTab = module === 'cadastros' && tab === 'modelos';
  const isBookerTab = module === 'cadastros' && tab === 'bookers';
  const isParceiroTab = module === 'cadastros' && tab === 'parceiros';
  const hasDynamicContacts = isModeloTab || isClienteTab || isBookerTab || isParceiroTab;
  const idadeModelo = isModeloTab ? calculateAge(form.data_nascimento) : null;
  const isMinor = idadeModelo !== null && idadeModelo < 18;

  const contratosPendentes = alertasOperacionais?.contratos_pendentes ?? { count: 0, items: [] };

  const cadastrosPainelRows = useMemo(() => {
    if (module !== 'cadastros') return [];
    const filtered = items.filter((item) => itemMatchesCadastroBusca(tab, item, cadastroBuscaInput));
    return filtered.slice(0, 10);
  }, [module, items, tab, cadastroBuscaInput]);

  useEffect(() => {
    if (module !== 'cadastros') setCadastrosMenuOpen(false);
  }, [module]);

  useEffect(() => {
    if (module !== 'website') setWebsiteMenuOpen(false);
  }, [module]);

  useEffect(() => {
    if (module !== 'cadastros') return;
    setCadastrosSubView('entrada');
    setCadastroBuscaInput('');
  }, [module, tab]);
  /** O.S. com saldo a receber do cliente — bloqueia pagar modelo na mesma O.S. */
  const osIdsComSaldoCliente = useMemo(() => {
    const s = new Set();
    for (const row of alertasOperacionais?.contas_receber ?? []) {
      if (Number(row.saldo) > 0.005) s.add(Number(row.os_id));
    }
    return s;
  }, [alertasOperacionais]);

  /** Exibição apenas: recebido − pagamento modelos − comissões (mesmos totais do resumo da API). */
  const finResultadoOperacionalJob = useMemo(() => {
    if (!finResumo) return null;
    const rec = Number(finResumo.total_recebido_cliente ?? 0);
    const pag = Number(finResumo.total_pago_modelos ?? 0);
    const com = Number(finResumo.total_comissoes_os ?? 0);
    return rec - pag - com;
  }, [finResumo]);

  useEffect(() => {
    setForm(cadastroConfig[tab].form);
    setEditingId(null);
    setError('');
    setCadastroListError('');
  }, [tab]);

  const cadastroErrorRef = useRef(null);
  useEffect(() => {
    if (!error && !cadastroListError) return;
    cadastroErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error, cadastroListError]);

  const refreshAlertasOperacionais = async () => {
    try {
      const response = await fetch(`${API_BASE}/dashboard/alertas`);
      if (response.ok) setAlertasOperacionais(await response.json());
    } catch {
      /* ignore */
    }
  };

  const loadFinanceiroPage = useCallback(async (opts = {}) => {
    const quiet = opts.quiet === true;
    if (!quiet) setFinLoading(true);
    setFinError('');
    try {
      const despParams = new URLSearchParams();
      if (finDespesaFiltroDe) despParams.set('data_de', finDespesaFiltroDe);
      if (finDespesaFiltroAte) despParams.set('data_ate', finDespesaFiltroAte);
      if (finDespesaFiltroCategoria) despParams.set('categoria', finDespesaFiltroCategoria);
      if (finDespesaFiltroOsId) despParams.set('os_id', finDespesaFiltroOsId);
      const despQ = despParams.toString() ? `?${despParams.toString()}` : '';
      const [r1, r2, r3, r4] = await Promise.all([
        fetch(`${API_BASE}/financeiro/resumo`),
        fetch(`${API_BASE}/financeiro/recebimentos`),
        fetch(`${API_BASE}/ordens-servico`),
        fetch(`${API_BASE}/financeiro/despesas${despQ}`),
      ]);
      if (!r1.ok || !r2.ok || !r3.ok || !r4.ok) throw new Error();
      setFinResumo(await r1.json());
      setFinRecebimentos(await r2.json());
      setFinOsOptions(await r3.json());
      setFinDespesas(await r4.json());
      await refreshAlertasOperacionais();
    } catch {
      setFinError(LOAD_ERROR_MESSAGE);
    } finally {
      if (!quiet) setFinLoading(false);
    }
  }, [
    finDespesaFiltroDe,
    finDespesaFiltroAte,
    finDespesaFiltroCategoria,
    finDespesaFiltroOsId,
  ]);

  useEffect(() => {
    const checkApi = async () => {
      try {
        const response = await fetch(API_URL ? `${API_URL}/health` : '/health');
        if (!response.ok) {
          setApiOnline(false);
          return;
        }
        const data = await response.json();
        const ok =
          data?.ok === true &&
          data?.status === 'ok' &&
          (data?.service === undefined || data?.service === 'andy-models-crm');
        setApiOnline(!!ok);
      } catch {
        setApiOnline(false);
      }
    };
    checkApi();
  }, []);

  useEffect(() => {
    if (apiOnline) refreshAlertasOperacionais();
  }, [apiOnline]);

  useEffect(() => {
    if (module !== 'inicio') return;
    let cancelled = false;
    (async () => {
      setDashboardResumoLoading(true);
      try {
        const [aRes, fRes] = await Promise.all([
          fetch(`${API_BASE}/dashboard/alertas`),
          fetch(`${API_BASE}/financeiro/resumo`),
        ]);
        if (cancelled) return;
        if (aRes.ok) setAlertasOperacionais(await aRes.json());
        if (fRes.ok) setDashboardResumo(await fRes.json());
        else setDashboardResumo(null);
      } catch {
        if (!cancelled) setDashboardResumo(null);
      } finally {
        if (!cancelled) setDashboardResumoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [module]);

  useEffect(() => {
    if (!finReceberOsId || finModal !== 'receber') return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/financeiro/os/${finReceberOsId}/contexto`);
        if (!r.ok) {
          return;
        }
        const c = await r.json();
        if (cancelled) return;
        setFinReceberDraft((prev) => ({
          ...prev,
          valor:
            c.saldo_receber > 0.005 ? String(Number(c.saldo_receber).toFixed(2)) : prev.valor,
        }));
      } catch {
        /* ignore */
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [finReceberOsId, finModal]);

  useEffect(() => {
    if (module !== 'cadastros') return;
    const load = async () => {
      try {
        setLoading(true);
        const response = await fetchWithTimeout(`${API_BASE}/${current.endpoint}`);
        const raw = await response.text();
        throwIfHtmlOrCannotPost(raw, response.status);
        if (!response.ok) {
          let msg = LOAD_ERROR_MESSAGE;
          try {
            const err = raw ? JSON.parse(raw) : {};
            if (err && err.message) msg = String(err.message);
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        const data = raw ? JSON.parse(raw) : [];
        setItems(Array.isArray(data) ? data : []);
        setCadastroListError('');
      } catch (e) {
        setCadastroListError(
          e?.name === 'AbortError'
            ? 'Servidor não respondeu. Inicie o backend (pasta backend: npm run dev).'
            : e?.message && String(e.message).trim()
              ? e.message
              : LOAD_ERROR_MESSAGE,
        );
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [current.endpoint, module]);

  useEffect(() => {
    const t = setTimeout(() => setOrcamentoBuscaDebounced(orcamentoBuscaInput), 300);
    return () => clearTimeout(t);
  }, [orcamentoBuscaInput]);

  useEffect(() => {
    const loadClients = async () => {
      try {
        const response = await fetch(`${API_BASE}/clientes`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        setClients(data);
        setOrcamentoError('');
      } catch {
        if (module === 'orcamentos') setOrcamentoError(LOAD_ERROR_MESSAGE);
      }
    };
    loadClients();
  }, [module]);

  useEffect(() => {
    if (module !== 'orcamentos') return;
    (async () => {
      try {
        const opts = { credentials: 'include' };
        const [m, bookRes, parRes] = await Promise.all([
          fetch(`${API_BASE}/modelos`, opts),
          fetch(`${API_BASE}/bookers`, opts),
          fetch(`${API_BASE}/parceiros`, opts),
        ]);
        if (m.ok) {
          const arr = await m.json();
          setModelosList(Array.isArray(arr) ? arr : []);
        } else {
          setModelosList([]);
        }
        if (bookRes.ok) setBookersList(await bookRes.json());
        if (parRes.ok) setParceirosList(await parRes.json());
      } catch {
        /* ignore */
      }
    })();
  }, [module]);

  useEffect(() => {
    if (module !== 'orcamentos' || orcamentosSubView !== 'gestao') return;
    let cancelled = false;
    (async () => {
      try {
        setOrcamentoLoading(true);
        const params = new URLSearchParams();
        const q = orcamentoBuscaDebounced.trim();
        params.set('limit', q ? '25' : '20');
        params.set('offset', '0');
        params.set('sort', 'created_at_desc');
        if (q) params.set('q', q);
        const response = await fetch(`${API_BASE}/orcamentos?${params}`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (cancelled) return;
        setOrcamentos(Array.isArray(data.rows) ? data.rows : []);
        setOrcamentosTotal(typeof data.total === 'number' ? data.total : 0);
        setOrcamentoError('');
      } catch {
        if (!cancelled) setOrcamentoError(LOAD_ERROR_MESSAGE);
      } finally {
        if (!cancelled) setOrcamentoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [module, orcamentosSubView, orcamentoBuscaDebounced, orcamentosRefreshTick]);

  useEffect(() => {
    if (module !== 'orcamentos' || orcamentosSubView !== 'lista') return;
    let cancelled = false;
    (async () => {
      try {
        setOrcamentoLoading(true);
        const params = new URLSearchParams();
        params.set('limit', String(orcamentosListaPageSize));
        params.set(
          'offset',
          String(Math.max(0, (orcamentosListaPage - 1) * orcamentosListaPageSize)),
        );
        params.set('sort', orcamentosListaSort);
        if (orcamentosListaStatus) params.set('status', orcamentosListaStatus);
        if (orcamentosListaClienteId) params.set('cliente_id', orcamentosListaClienteId);
        const response = await fetch(`${API_BASE}/orcamentos?${params}`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (cancelled) return;
        const rows = Array.isArray(data.rows) ? data.rows : [];
        const total = typeof data.total === 'number' ? data.total : 0;
        setOrcamentos(rows);
        setOrcamentosTotal(total);
        const maxPage = Math.max(1, Math.ceil(total / orcamentosListaPageSize) || 1);
        if (orcamentosListaPage > maxPage && maxPage >= 1) {
          setOrcamentosListaPage(maxPage);
        }
        setOrcamentoError('');
      } catch {
        if (!cancelled) setOrcamentoError(LOAD_ERROR_MESSAGE);
      } finally {
        if (!cancelled) setOrcamentoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    module,
    orcamentosSubView,
    orcamentosListaPage,
    orcamentosListaPageSize,
    orcamentosListaStatus,
    orcamentosListaClienteId,
    orcamentosListaSort,
    orcamentosRefreshTick,
  ]);

  useEffect(() => {
    setOrcamentosListaPage(1);
  }, [orcamentosListaStatus, orcamentosListaClienteId, orcamentosListaPageSize, orcamentosListaSort]);

  useEffect(() => {
    if (module === 'jobs') refreshAlertasOperacionais();
  }, [module]);

  useEffect(() => {
    if (module !== 'contratos') return;
    const load = async () => {
      setContratosLoading(true);
      setContratosError('');
      try {
        const response = await fetchWithTimeout(`${API_BASE}/contratos`);
        const raw = await response.text();
        throwIfHtmlOrCannotPost(raw, response.status);
        if (!response.ok) {
          const data = raw ? JSON.parse(raw) : {};
          throw new Error(data.message || LOAD_ERROR_MESSAGE);
        }
        const data = raw ? JSON.parse(raw) : [];
        setContratosList(Array.isArray(data) ? data : []);
      } catch (e) {
        setContratosError(e?.message || LOAD_ERROR_MESSAGE);
      } finally {
        setContratosLoading(false);
      }
    };
    load();
  }, [module]);

  useEffect(() => {
    if (module !== 'financeiro') return;
    loadFinanceiroPage();
  }, [module, loadFinanceiroPage]);

  useEffect(() => {
    if (module !== 'extrato') return;
    const load = async () => {
      setExtratoLoading(true);
      setExtratoError('');
      try {
        const [mRes, exRes] = await Promise.all([
          fetch(`${API_BASE}/modelos`),
          fetch(
            extratoModeloFilter
              ? `${API_BASE}/extrato-modelo?modelo_id=${encodeURIComponent(extratoModeloFilter)}`
              : `${API_BASE}/extrato-modelo`,
          ),
        ]);
        if (!mRes.ok || !exRes.ok) throw new Error();
        setModelosList(await mRes.json());
        setExtratoRows(await exRes.json());
      } catch {
        setExtratoError(LOAD_ERROR_MESSAGE);
      } finally {
        setExtratoLoading(false);
      }
    };
    load();
  }, [module, extratoModeloFilter]);

  useEffect(() => {
    if (module !== 'jobs') return;
    const load = async () => {
      try {
        setOsLoading(true);
        const [osRes, modRes, bookRes, parRes] = await Promise.all([
          fetch(`${API_BASE}/ordens-servico`),
          fetch(`${API_BASE}/modelos`),
          fetch(`${API_BASE}/bookers`),
          fetch(`${API_BASE}/parceiros`),
        ]);
        if (!osRes.ok || !modRes.ok || !bookRes.ok || !parRes.ok) throw new Error();
        setOsList(await osRes.json());
        setModelosList(await modRes.json());
        setBookersList(await bookRes.json());
        setParceirosList(await parRes.json());
        setOsError('');
      } catch {
        setOsError(LOAD_ERROR_MESSAGE);
      } finally {
        setOsLoading(false);
      }
    };
    load();
  }, [module]);

  const loadOsDetail = async (id) => {
    setOsError('');
    try {
      const response = await fetch(`${API_BASE}/ordens-servico/${id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || LOAD_ERROR_MESSAGE);
      setOsDraft({
        ...data,
        linhas: Array.isArray(data.linhas)
          ? data.linhas.map((l) => ({
            id: l.id,
            modelo_id: l.modelo_id != null ? l.modelo_id : '',
            rotulo: l.rotulo ?? '',
            modelo_nome: l.modelo_nome,
            cache_modelo: l.cache_modelo,
            emite_nf_propria: Boolean(l.emite_nf_propria),
            data_prevista_pagamento: l.data_prevista_pagamento
              ? String(l.data_prevista_pagamento).slice(0, 10)
              : '',
          }))
          : [],
        documentos: Array.isArray(data.documentos) ? data.documentos : [],
        historico: Array.isArray(data.historico) ? data.historico : [],
      });
      setContratoEmailDest(data.cliente_email ? String(data.cliente_email) : '');
      setContratoEmailMsg('');
      setContratoEmailFallbackLink('');
      setContratoHtmlFallbackUrl('');
    } catch {
      setOsError(LOAD_ERROR_MESSAGE);
      setOsDraft(null);
    }
  };

  const cancelarOs = async (id) => {
    if (
      !window.confirm(
        'Cancelar esta O.S.? O fluxo de contrato será desativado. Só é permitido se não houver recebimentos do cliente nem pagamentos a modelos registrados.',
      )
    ) {
      return;
    }
    setOsError('');
    try {
      const r = await fetch(`${API_BASE}/ordens-servico/${id}/cancelar`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || 'Erro ao cancelar O.S.');
      alert(data.message || 'O.S. cancelada.');
      if (osDraft?.id === id) await loadOsDetail(id);
      const listRes = await fetch(`${API_BASE}/ordens-servico`);
      if (listRes.ok) setOsList(await listRes.json());
      await refreshAlertasOperacionais();
    } catch (e) {
      setOsError(e.message || LOAD_ERROR_MESSAGE);
    }
  };

  const uploadOsDocumento = async (file, tipo) => {
    if (!osDraft?.id) return;
    setOsError('');
    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      fd.append('tipo', tipo);
      const res = await fetch(`${API_BASE}/ordens-servico/${osDraft.id}/documentos`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro no upload.');
      await loadOsDetail(osDraft.id);
      await refreshAlertasOperacionais();
      const listRes = await fetch(`${API_BASE}/ordens-servico`);
      if (listRes.ok) setOsList(await listRes.json());
    } catch (e) {
      setOsError(e.message || LOAD_ERROR_MESSAGE);
    }
  };

  const enviarContratoPorEmail = async () => {
    if (!osDraft?.id) return;
    setContratoEmailLoading(true);
    setContratoEmailMsg('');
    setContratoEmailFallbackLink('');
    setContratoHtmlFallbackUrl('');
    try {
      const r = await fetch(`${API_BASE}/ordens-servico/${osDraft.id}/contrato-enviar-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinatario: contratoEmailDest.trim() || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Erro ao enviar.');
      if (data?.contrato_enviado) {
        const ref = data.smtp_message_id ? ` Ref.: ${String(data.smtp_message_id).slice(0, 120)}` : '';
        setContratoEmailMsg(
          `Enviado com sucesso.${ref} Se não chegar: pasta spam; na Brevo, Transacional → Logs para ver entrega.`,
        );
      } else {
        setContratoEmailMsg(
          data?.message || 'Erro ao enviar e-mail: verifique configuração SMTP. Use o link manual abaixo.',
        );
      }
      if (data?.assinatura_link) setContratoEmailFallbackLink(String(data.assinatura_link));
      if (data?.fallback_html_url) setContratoHtmlFallbackUrl(String(data.fallback_html_url));
      await loadOsDetail(osDraft.id);
    } catch (e) {
      setContratoEmailMsg(`Erro ao enviar e-mail: ${e.message || 'verifique configuração SMTP'}`);
    } finally {
      setContratoEmailLoading(false);
    }
  };

  const copiarLinkAssinatura = async () => {
    if (!contratoEmailFallbackLink) return;
    try {
      await navigator.clipboard.writeText(contratoEmailFallbackLink);
      setContratoEmailMsg('Link de assinatura copiado. Você pode enviar manualmente ao cliente.');
    } catch {
      setContratoEmailMsg('Não foi possível copiar automaticamente. Abra o link e copie manualmente.');
    }
  };

  const deleteOsDocumento = async (docId) => {
    if (!osDraft?.id || !window.confirm('Remover este arquivo?')) return;
    setOsError('');
    try {
      const res = await fetch(`${API_BASE}/ordens-servico/${osDraft.id}/documentos/${docId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro ao remover.');
      await loadOsDetail(osDraft.id);
      await refreshAlertasOperacionais();
    } catch (e) {
      setOsError(e.message || LOAD_ERROR_MESSAGE);
    }
  };

  const registrarRecebimento = async ({ os_id, valor, data_recebimento, observacao }) => {
    setFinError('');
    try {
      const res = await fetch(`${API_BASE}/financeiro/recebimentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          os_id: Number(os_id),
          valor: Number(valor),
          data_recebimento,
          observacao: observacao || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro ao salvar.');
      setFinReceberOsId(null);
      setFinModal(null);
      await loadFinanceiroPage({ quiet: true });
    } catch (e) {
      setFinError(e.message || LOAD_ERROR_MESSAGE);
    }
  };

  const saveDespesa = async (event) => {
    event.preventDefault();
    setFinError('');
    try {
      const res = await fetch(`${API_BASE}/financeiro/despesas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_despesa: finDespesaForm.data_despesa,
          descricao: finDespesaForm.descricao,
          valor: Number(finDespesaForm.valor),
          categoria: finDespesaForm.categoria,
          os_id: finDespesaForm.os_id || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro ao salvar despesa.');
      setFinDespesaForm({
        data_despesa: '',
        descricao: '',
        valor: '',
        categoria: 'operacional',
        os_id: '',
      });
      setFinModal(null);
      await loadFinanceiroPage({ quiet: true });
    } catch (e) {
      setFinError(e.message || LOAD_ERROR_MESSAGE);
    }
  };

  const deleteDespesa = async (id) => {
    if (!window.confirm('Excluir esta despesa?')) return;
    setFinError('');
    try {
      const res = await fetch(`${API_BASE}/financeiro/despesas/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro ao excluir.');
      await loadFinanceiroPage({ quiet: true });
    } catch (e) {
      setFinError(e.message || LOAD_ERROR_MESSAGE);
    }
  };

  const submitPagamentoModelo = async ({ os_modelo_id, valor, data_pagamento, observacao }) => {
    setExtratoError('');
    setFinError('');
    try {
      const res = await fetch(`${API_BASE}/financeiro/pagamentos-modelo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          os_modelo_id: Number(os_modelo_id),
          valor: Number(valor),
          data_pagamento,
          observacao: observacao || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro ao salvar.');
      setFinPagarLinha(null);
      setFinModal(null);
      const exRes = await fetch(
        extratoModeloFilter
          ? `${API_BASE}/extrato-modelo?modelo_id=${encodeURIComponent(extratoModeloFilter)}`
          : `${API_BASE}/extrato-modelo`,
      );
      if (exRes.ok) setExtratoRows(await exRes.json());
      await refreshAlertasOperacionais();
      await loadFinanceiroPage({ quiet: true });
    } catch (e) {
      setExtratoError(e.message || LOAD_ERROR_MESSAGE);
      setFinError(e.message || LOAD_ERROR_MESSAGE);
    }
  };

  const onChange = (key, value) => {
    setForm((prev) => {
      if (isModeloTab && key === 'sexo') {
        const next = { ...prev, sexo: value };
        const grupo = sexoGrupo(value);
        if (grupo === 'feminino' || grupo === 'masculino') {
          next.medida_busto = '';
          next.medida_torax = '';
          next.medida_cintura = '';
          next.medida_quadril = '';
        }
        return next;
      }
      return { ...prev, [key]: value };
    });
  };

  const buscarEnderecoPorCep = async () => {
    const cepDigits = String(form.cep || '').replace(/\D/g, '');
    if (cepDigits.length !== 8) return;
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.erro) return;
      setForm((prev) => ({
        ...prev,
        logradouro: data.logradouro || prev.logradouro,
        bairro: data.bairro || prev.bairro,
        cidade: data.localidade || prev.cidade,
        uf: data.uf || prev.uf,
      }));
    } catch {
      // Silent fail to keep form usable offline.
    }
  };

  const buscarDadosEmpresaPorCnpj = async () => {
    if (!isClienteTab || form.tipo_pessoa !== 'PJ') return;
    const cnpjDigits = String(form.documento || '').replace(/\D/g, '');
    if (cnpjDigits.length !== 14) return;
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjDigits}`);
      if (!response.ok) return;
      const data = await response.json();
      setForm((prev) => ({
        ...prev,
        nome_empresa: String(prev.nome_empresa || '').trim() || String(data.razao_social || ''),
        nome_fantasia: String(prev.nome_fantasia || '').trim() || String(data.nome_fantasia || ''),
        cep: String(prev.cep || '').trim() || formatCepDisplay(String(data.cep || '').replace(/\D/g, '')),
        logradouro: String(prev.logradouro || '').trim() || String(data.logradouro || ''),
        numero: String(prev.numero || '').trim() || String(data.numero || ''),
        bairro: String(prev.bairro || '').trim() || String(data.bairro || ''),
        cidade: String(prev.cidade || '').trim() || String(data.municipio || ''),
        uf: String(prev.uf || '').trim() || String(data.uf || ''),
      }));
    } catch {
      // Silent fail to keep form usable offline.
    }
  };

  const handleMaskedCadastroChange = (field, value) => {
    if (isClienteTab && field === 'documento') {
      const d = onlyDigits(value);
      onChange(field, form.tipo_pessoa === 'PF' ? formatCpfDisplay(d) : formatCnpjDisplay(d));
      return;
    }
    if (isClienteTab && field === 'documento_representante') {
      onChange(field, formatCpfDisplay(onlyDigits(value)));
      return;
    }
    if (isClienteTab && field === 'cep') {
      onChange(field, formatCepDisplay(onlyDigits(value)));
      return;
    }
    if (isBookerTab && field === 'cep') {
      onChange(field, formatCepDisplay(onlyDigits(value)));
      return;
    }
    if (isModeloTab && field === 'cpf') {
      onChange(field, formatCpfDisplay(onlyDigits(value)));
      return;
    }
    if (isModeloTab && field === 'responsavel_cpf') {
      onChange(field, formatCpfDisplay(onlyDigits(value)));
      return;
    }
    if (isModeloTab && field === 'responsavel_telefone') {
      onChange(field, formatPhoneDisplay(onlyDigits(value)));
      return;
    }
    if (isModeloTab && field === 'cep') {
      onChange(field, formatCepDisplay(onlyDigits(value)));
      return;
    }
    onChange(field, value);
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setCadastroSaving(true);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const base = API_BASE.replace(/\/$/, '');
      const ep = String(current.endpoint).replace(/^\/+/, '');
      const url = editingId ? `${base}/${ep}/${editingId}` : `${base}/${ep}`;

      const payload = { ...form };
      if (
        (isModeloTab || isBookerTab || isParceiroTab)
        && Array.isArray(form.formas_pagamento)
      ) {
        const fr = sanitizeAndValidateFormasPagamentoArray(form.formas_pagamento);
        if (!fr.ok) {
          setError(fr.message);
          return;
        }
        payload.formas_pagamento = fr.formas;
      }

      if (hasDynamicContacts) {
        const telefones = normalizeDynamicTextList(form.telefones)
          .map((item) => onlyDigits(String(item || '')))
          .filter(Boolean);
        const emails = normalizeDynamicTextList(form.emails).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
        if (telefones.length === 0 || emails.length === 0) {
          setError('Informe ao menos um telefone e um email válidos.');
          return;
        }

        if (isModeloTab && isMinor && (!form.responsavel_nome || !form.responsavel_cpf || !form.responsavel_telefone)) {
          setError('Modelo menor de idade exige dados completos do responsável.');
          return;
        }

        payload.telefones = telefones;
        payload.emails = emails;
        payload.telefone = telefones[0];
        payload.email = emails[0];
      }

      if (isClienteTab) {
        const sv = sanitizeAndValidateCliente(payload, false);
        if (!sv.ok) {
          setError(sv.message);
          return;
        }
        Object.assign(payload, sv.body);
      } else if (isModeloTab) {
        const sv = sanitizeAndValidateModelo(payload, false);
        if (!sv.ok) {
          setError(sv.message);
          return;
        }
        Object.assign(payload, sv.body);
      }

      if (method === 'POST') {
        delete payload.id;
      }

      const response = await fetchWithTimeout(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const raw = await response.text();
      throwIfHtmlOrCannotPost(raw, response.status);
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(
          raw?.slice(0, 300) || `Resposta inválida do servidor (HTTP ${response.status}).`,
        );
      }

      if (!response.ok) {
        throw new Error(data.message || `Erro ao salvar cadastro (HTTP ${response.status}).`);
      }

      const saved = data;

      const mergeSavedIntoItems = () => {
        if (editingId) {
          setItems((prev) =>
            prev.map((item) =>
              Number(item.id) === Number(saved.id) ? { ...item, ...saved } : item,
            ),
          );
        } else {
          setItems((prev) => [saved, ...prev]);
        }
      };

      /** Modelos: lista completa do GET para refletir foto_perfil_base64 persistida (URL), não o preview base64 em memória. */
      if (tab === 'modelos') {
        try {
          const listRes = await fetchWithTimeout(`${API_BASE}/modelos`);
          const listRaw = await listRes.text();
          throwIfHtmlOrCannotPost(listRaw, listRes.status);
          if (!listRes.ok) throw new Error('refetch');
          const listData = listRaw ? JSON.parse(listRaw) : [];
          if (Array.isArray(listData)) {
            setItems(listData);
          } else {
            mergeSavedIntoItems();
          }
        } catch {
          mergeSavedIntoItems();
        }
      } else {
        mergeSavedIntoItems();
      }

      setError('');
      setCadastroListError('');
      setEditingId(null);
      setForm(current.form);
      setCadastrosSubView('entrada');
    } catch (e) {
      if (e?.name === 'AbortError') {
        setError(
          `O servidor não respondeu a tempo. Na pasta backend: npm run dev (porta ${DEV_PROXY_PORT} no .env). Se já está, veja se o PostgreSQL está ligado.`,
        );
        return;
      }
      const msg = e?.message ? String(e.message).trim() : '';
      const network =
        !msg ||
        msg === 'Failed to fetch' ||
        msg === 'Load failed' ||
        e?.name === 'TypeError';
      setError(
        network
          ? 'Sem ligação ao servidor. No Terminal, na pasta backend, deixe rodando: npm run dev (e reinicie o frontend depois desta alteração).'
          : msg || 'Erro ao salvar cadastro. Verifique conexão com servidor.',
      );
    } finally {
      setCadastroSaving(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    const nextForm = {
      ...item,
      formas_pagamento: normalizeFormasRecebimento(item.formas_pagamento),
    };
    if (tab === 'modelos') {
      nextForm.telefones = normalizeDynamicTextList(item.telefones?.length ? item.telefones : [item.telefone]).map(
        (t) => formatPhoneDisplay(onlyDigits(String(t))),
      );
      nextForm.emails = normalizeDynamicTextList(item.emails?.length ? item.emails : [item.email]);
      nextForm.data_nascimento = item.data_nascimento || '';
      nextForm.responsavel_nome = item.responsavel_nome || '';
      nextForm.responsavel_cpf = formatCpfDisplay(onlyDigits(item.responsavel_cpf || ''));
      nextForm.responsavel_telefone = formatPhoneDisplay(onlyDigits(item.responsavel_telefone || ''));
      nextForm.cpf = formatCpfDisplay(onlyDigits(item.cpf || ''));
      nextForm.origem_cadastro = item.origem_cadastro ?? 'interno';
      nextForm.status_cadastro = item.status_cadastro ?? 'aprovado';
      nextForm.foto_perfil_base64 =
        item.foto_perfil_base64 != null && String(item.foto_perfil_base64).trim() !== ''
          ? String(item.foto_perfil_base64)
          : '';
    }
    if (tab === 'clientes') {
      nextForm.telefones = normalizeDynamicTextList(item.telefones?.length ? item.telefones : [item.telefone]).map(
        (t) => formatPhoneDisplay(onlyDigits(String(t))),
      );
      nextForm.emails = normalizeDynamicTextList(item.emails?.length ? item.emails : [item.email]);
      nextForm.tipo_pessoa = item.tipo_pessoa || 'PJ';
      const docRaw = onlyDigits(item.documento || item.cnpj || '');
      nextForm.documento =
        nextForm.tipo_pessoa === 'PF' ? formatCpfDisplay(docRaw) : formatCnpjDisplay(docRaw);
      nextForm.documento_representante = formatCpfDisplay(onlyDigits(item.documento_representante || ''));
      nextForm.cep = formatCepDisplay(onlyDigits(item.cep || ''));
      nextForm.website =
        item.website != null && String(item.website).trim() !== ''
          ? String(item.website).trim()
          : 'https://';
      nextForm.instagram =
        item.instagram != null && String(item.instagram).trim() !== ''
          ? String(item.instagram).trim()
          : 'https://www.instagram.com/';
      nextForm.logradouro = item.logradouro || '';
      nextForm.numero = item.numero || '';
      nextForm.bairro = item.bairro || '';
      nextForm.cidade = item.cidade || '';
      nextForm.uf = item.uf || '';
    }
    if (tab === 'bookers' || tab === 'parceiros') {
      nextForm.telefones = normalizeDynamicTextList(item.telefones?.length ? item.telefones : [item.telefone]);
      nextForm.emails = normalizeDynamicTextList(item.emails?.length ? item.emails : [item.email]);
    }
    setForm(nextForm);
    setCadastrosSubView('formulario');
  };

  const iniciarNovoCadastro = () => {
    setEditingId(null);
    setForm(cadastroConfig[tab].form);
    setError('');
    setCadastrosSubView('formulario');
  };

  const importarModelosDoSite = async () => {
    if (
      !window.confirm(
        'Importar modelos a partir do site (GET /api/models)? Entradas com o mesmo ID no site (website_model_id) já registadas no CRM serão ignoradas. CPF e contactos serão placeholders até completar a ficha.',
      )
    ) {
      return;
    }
    setImportSiteMsg('');
    setImportSiteBusy(true);
    try {
      const response = await fetchWithTimeout(`${API_BASE}/modelos/import-from-website`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const raw = await response.text();
      throwIfHtmlOrCannotPost(raw, response.status);
      const data = raw ? JSON.parse(raw) : {};
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      const errList = Array.isArray(data.errors) ? data.errors : [];
      const errN = errList.length;
      const errPreview = errList
        .slice(0, 6)
        .map((e) => {
          const parts = [e.slug && `slug:${e.slug}`, e.name && String(e.name).slice(0, 40), e.message]
            .filter(Boolean);
          return parts.join(' — ') || JSON.stringify(e);
        })
        .join(' | ');
      setImportSiteMsg(
        [
          data.list_source && `Lista: ${data.list_source}`,
          data.total_received != null && `No site: ${data.total_received} modelo(s)`,
          `Importados: ${data.imported ?? 0}`,
          `Ignorados (já tinham website_model_id): ${data.skipped ?? 0}`,
          errN > 0 && `Erros (${errN}): ${errPreview}${errN > 6 ? '…' : ''}`,
        ]
          .filter(Boolean)
          .join('. ') + '.',
      );
      const listRes = await fetchWithTimeout(`${API_BASE}/modelos`);
      const listRaw = await listRes.text();
      throwIfHtmlOrCannotPost(listRaw, listRes.status);
      if (listRes.ok) {
        const listData = listRaw ? JSON.parse(listRaw) : [];
        if (Array.isArray(listData)) setItems(listData);
      }
    } catch (e) {
      setImportSiteMsg(
        e?.name === 'AbortError' ? 'Servidor não respondeu.' : e?.message || 'Erro ao importar do site.',
      );
    } finally {
      setImportSiteBusy(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Deseja realmente deletar este cadastro?')) return;

    setError('');
    try {
      const response = await fetchWithTimeout(`${API_BASE}/${current.endpoint}/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Erro ao deletar cadastro.');
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setForm(current.form);
      }
    } catch (e) {
      setError(
        e?.name === 'AbortError'
          ? 'Servidor não respondeu. Inicie o backend (npm run dev na pasta backend).'
          : e?.message || 'Erro ao deletar cadastro. Verifique conexão com servidor.',
      );
    }
  };

  const gerarLinkCadastroModelo = async () => {
    setLinkCadastroMsg('');
    setLinkCadastroLoading(true);
    try {
      const response = await fetchWithTimeout(`${API_BASE}/cadastro-links/gerar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const raw = await response.text();
      throwIfHtmlOrCannotPost(raw, response.status);
      const data = raw ? JSON.parse(raw) : {};
      if (!response.ok) throw new Error(data.message || 'Não foi possível gerar o link.');
      setLinkCadastroUrl(data.url);
      const ate =
        data.valido_ate && data.horas_validade
          ? ` Válido até ${new Date(data.valido_ate).toLocaleString('pt-BR')} (${data.horas_validade} h).`
          : '';
      setLinkCadastroMsg(`Link de uso único gerado.${ate} Envie à modelo.`);
    } catch (e) {
      setLinkCadastroUrl('');
      setLinkCadastroMsg(
        e?.name === 'AbortError'
          ? 'Servidor não respondeu.'
          : e?.message || 'Erro ao gerar link.',
      );
    } finally {
      setLinkCadastroLoading(false);
    }
  };

  const gerarLinkCadastroCliente = async () => {
    setLinkCadastroClienteMsg('');
    setLinkCadastroClienteLoading(true);
    try {
      const response = await fetchWithTimeout(`${API_BASE}/cadastro-links/clientes/gerar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const raw = await response.text();
      throwIfHtmlOrCannotPost(raw, response.status);
      const data = raw ? JSON.parse(raw) : {};
      if (!response.ok) throw new Error(data.message || 'Não foi possível gerar o link.');
      setLinkCadastroClienteUrl(data.url);
      const ate =
        data.valido_ate && data.horas_validade
          ? ` Válido até ${new Date(data.valido_ate).toLocaleString('pt-BR')} (${data.horas_validade} h).`
          : '';
      setLinkCadastroClienteMsg(`Link de uso único gerado.${ate} Envie ao cliente.`);
    } catch (e) {
      setLinkCadastroClienteUrl('');
      setLinkCadastroClienteMsg(
        e?.name === 'AbortError'
          ? 'Servidor não respondeu.'
          : e?.message || 'Erro ao gerar link.',
      );
    } finally {
      setLinkCadastroClienteLoading(false);
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    setSenhaMsg('');
    setSenhaLoading(true);
    try {
      const response = await fetchWithTimeout(`${API_BASE}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha_atual: senhaAtual, nova_senha: senhaNova }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Falha ao alterar senha.');
      }
      setSenhaAtual('');
      setSenhaNova('');
      setSenhaMsg('Senha alterada com sucesso.');
    } catch (err) {
      setSenhaMsg(err?.message || 'Falha ao alterar senha.');
    } finally {
      setSenhaLoading(false);
    }
  };

  const addFormaPagamento = () => {
    setForm((prev) => ({
      ...prev,
      formas_pagamento: [...normalizeFormasRecebimento(prev.formas_pagamento), { ...emptyFormaRecebimento }],
    }));
  };

  const updateFormaPagamento = (index, key, value) => {
    setForm((prev) => ({
      ...prev,
      formas_pagamento: normalizeFormasRecebimento(prev.formas_pagamento).map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (key === 'tipo') {
          if (value === 'Conta bancária') {
            return {
              ...emptyFormaRecebimento,
              tipo: 'Conta bancária',
              banco: '',
              agencia: '',
              conta: '',
              tipo_conta: 'corrente',
            };
          }
          return {
            ...emptyFormaRecebimento,
            tipo: 'PIX',
            tipo_chave_pix: 'CPF',
            chave_pix: '',
          };
        }
        if (key === 'tipo_chave_pix') {
          return { ...item, tipo_chave_pix: value, chave_pix: '' };
        }
        return { ...item, [key]: value };
      }),
    }));
  };

  const handleFormaChavePixChange = (index, tipoChave, raw) => {
    let v = raw;
    if (tipoChave === 'CPF') v = formatCpfDisplay(onlyDigits(raw));
    else if (tipoChave === 'CNPJ') v = formatCnpjDisplay(onlyDigits(raw));
    else if (tipoChave === 'Celular') v = formatPhoneDisplay(onlyDigits(raw));
    updateFormaPagamento(index, 'chave_pix', v);
  };

  const removeFormaPagamento = (index) => {
    setForm((prev) => {
      const next = normalizeFormasRecebimento(prev.formas_pagamento).filter((_, itemIndex) => itemIndex !== index);
      return {
        ...prev,
        formas_pagamento: next.length > 0 ? next : [{ ...emptyFormaRecebimento }],
      };
    });
  };

  const addDynamicItem = (field) => {
    setForm((prev) => ({
      ...prev,
      [field]: [...normalizeDynamicTextList(prev[field]), ''],
    }));
  };

  const updateDynamicItem = (field, index, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: normalizeDynamicTextList(prev[field]).map((item, itemIndex) => (
        itemIndex === index ? value : item
      )),
    }));
  };

  const removeDynamicItem = (field, index) => {
    setForm((prev) => {
      const next = normalizeDynamicTextList(prev[field]).filter((_, itemIndex) => itemIndex !== index);
      return {
        ...prev,
        [field]: next.length > 0 ? next : [''],
      };
    });
  };

  const onChangeOrcamento = (key, value) => {
    setOrcamentoForm((prev) => ({ ...prev, [key]: value }));
  };

  /** Sem modelos no cálculo: atualiza os dois campos; preview/salvamento usam `orcamentoValorBaseSemModelo`. */
  const onChangeOrcamentoValorManualSemModelos = (value) => {
    setOrcamentoForm((prev) => ({
      ...prev,
      valor_servico_sem_modelo: value,
      cache_base_estimado_total: value,
    }));
  };

  const addOrcamentoLinhaCadastro = () => {
    setOrcamentoForm((prev) => {
      if (prev.job_sem_modelos) return prev;
      return {
        ...prev,
        linhas: [
          ...(prev.linhas || []),
          {
            origemCadastro: true,
            modelo_id: '',
            cache_modelo: '',
            emite_nf_propria: false,
          },
        ],
      };
    });
  };

  const updateOrcamentoLinha = (index, patch) => {
    setOrcamentoForm((prev) => ({
      ...prev,
      linhas: (prev.linhas || []).map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  };

  const removeOrcamentoLinha = (index) => {
    setOrcamentoForm((prev) => ({
      ...prev,
      linhas: (prev.linhas || []).filter((_, i) => i !== index),
    }));
  };

  const onChangeOrcamentoJobSemModelos = (checked) => {
    setOrcamentoForm((prev) => ({
      ...prev,
      job_sem_modelos: checked,
      linhas: checked ? [] : prev.linhas,
    }));
    if (checked) setOrcamentoModeloBuscaPorLinha([]);
  };

  const clearOrcamentoEdicao = () => {
    setOrcamentoEditingId(null);
    setOrcamentoEditingStatus(null);
    setOrcamentoEditingOsId(null);
    setOrcamentoForm(createEmptyOrcamentoForm());
    setOrcamentoClienteBusca('');
    setOrcamentoModeloBuscaPorLinha([]);
  };

  const voltarParaGestaoOrcamentos = () => {
    clearOrcamentoEdicao();
    setOrcamentosSubView('gestao');
  };

  const iniciarNovoOrcamento = () => {
    clearOrcamentoEdicao();
    setOrcamentosSubView('formulario');
    setOrcamentoError('');
  };

  const saveOrcamento = async (event) => {
    event.preventDefault();
    if (
      orcamentoEditingId != null &&
      orcamentoEditingStatus != null &&
      orcamentoEditingStatus !== 'rascunho'
    ) {
      return;
    }
    setOrcamentoError('');
    try {
      const method = orcamentoEditingId ? 'PUT' : 'POST';
      const url = orcamentoEditingId
        ? `${API_BASE}/orcamentos/${orcamentoEditingId}`
        : `${API_BASE}/orcamentos`;

      const jobSem = Boolean(orcamentoForm.job_sem_modelos);
      let linhasPayload = (orcamentoForm.linhas || [])
        .filter((l) => {
          const mid = l.modelo_id !== '' && l.modelo_id != null ? Number(l.modelo_id) : NaN;
          return Number.isFinite(mid) && mid > 0;
        })
        .map((l) => ({
          modelo_id: Number(l.modelo_id),
          cache_modelo: Number(l.cache_modelo),
          emite_nf_propria: Boolean(l.emite_nf_propria),
          rotulo: String(l.rotulo || '').trim() || undefined,
        }));
      if (jobSem) linhasPayload = [];
      const tipoProp = jobSem ? 'sem_modelo' : linhasPayload.length > 0 ? 'com_modelo' : 'sem_modelo';
      let cacheBase = Number(orcamentoForm.cache_base_estimado_total || 0);
      if (tipoProp === 'com_modelo' && linhasPayload.length > 0) {
        cacheBase = linhasPayload.reduce(
          (s, l) => s + (Number.isFinite(l.cache_modelo) ? l.cache_modelo : 0),
          0,
        );
      }

      const ip = Number(orcamentoForm.imposto_percent);
      const parceiroId =
        orcamentoForm.parceiro_id !== '' && orcamentoForm.parceiro_id != null
          ? Number(orcamentoForm.parceiro_id)
          : null;
      const bookerId =
        orcamentoForm.booker_id !== '' && orcamentoForm.booker_id != null
          ? Number(orcamentoForm.booker_id)
          : null;
      const parceiroPctRaw = orcamentoForm.parceiro_percent;
      const bookerPctRaw = orcamentoForm.booker_percent;
      const payload = {
        ...orcamentoForm,
        job_sem_modelos: jobSem,
        tipo_proposta_os: tipoProp,
        cliente_id: Number(orcamentoForm.cliente_id),
        cache_base_estimado_total: cacheBase,
        valor_servico_sem_modelo:
          tipoProp === 'sem_modelo'
            ? orcamentoValorBaseSemModelo(orcamentoForm)
            : Number(orcamentoForm.valor_servico_sem_modelo || 0),
        taxa_agencia_percent: Number(orcamentoForm.taxa_agencia_percent),
        extras_agencia_valor: Number(orcamentoForm.extras_agencia_valor),
        imposto_percent: Number.isFinite(ip) && ip >= 0 && ip <= 100 ? ip : 10,
        data_trabalho: orcamentoForm.data_trabalho ? String(orcamentoForm.data_trabalho).trim() : '',
        horario_trabalho: String(orcamentoForm.horario_trabalho ?? '').trim(),
        local_trabalho: String(orcamentoForm.local_trabalho ?? '').trim(),
        quantidade_modelos_referencia: null,
        parceiro_id: Number.isFinite(parceiroId) && parceiroId > 0 ? parceiroId : null,
        parceiro_percent:
          parceiroPctRaw === '' || parceiroPctRaw == null ? null : Number(parceiroPctRaw),
        booker_id: Number.isFinite(bookerId) && bookerId > 0 ? bookerId : null,
        booker_percent: bookerPctRaw === '' || bookerPctRaw == null ? null : Number(bookerPctRaw),
        linhas: linhasPayload,
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Erro ao salvar orçamento.');
      }

      await response.json();

      clearOrcamentoEdicao();
      setOrcamentosSubView('gestao');

      setOrcamentosRefreshTick((x) => x + 1);
    } catch (requestError) {
      setOrcamentoError(requestError.message);
    }
  };

  const editOrcamento = async (item) => {
    setOrcamentosSubView('formulario');
    setOrcamentoEditingId(item.id);
    setOrcamentoEditingStatus(item.status ?? 'rascunho');
    setOrcamentoEditingOsId(
      item.os_id_gerada != null && item.os_id_gerada !== '' ? Number(item.os_id_gerada) : null,
    );
    setOrcamentoError('');
    try {
      const r = await fetch(`${API_BASE}/orcamentos/${item.id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || LOAD_ERROR_MESSAGE);
      const dt = data.data_trabalho;
      let dataInput = '';
      if (dt) {
        const s = String(dt);
        dataInput = s.includes('T') ? s.slice(0, 10) : s.slice(0, 10);
      }
      const mappedLinhas = Array.isArray(data.linhas)
        ? data.linhas
            .filter((l) => l.modelo_id != null && l.modelo_id !== '')
            .map((l) => ({
              id: l.id,
              modelo_id: l.modelo_id,
              rotulo: l.rotulo ?? '',
              cache_modelo: l.cache_modelo,
              emite_nf_propria: Boolean(l.emite_nf_propria),
              origemCadastro: true,
            }))
        : [];
      const vsSm =
        data.valor_servico_sem_modelo != null && String(data.valor_servico_sem_modelo).trim() !== ''
          ? String(data.valor_servico_sem_modelo)
          : '';
      const cb = data.cache_base_estimado_total != null ? String(data.cache_base_estimado_total) : '';
      setOrcamentoForm({
        cliente_id: String(data.cliente_id),
        tipo_proposta_os: data.tipo_proposta_os === 'sem_modelo' ? 'sem_modelo' : 'com_modelo',
        tipo_trabalho: data.tipo_trabalho,
        descricao: data.descricao,
        data_trabalho: dataInput,
        horario_trabalho: data.horario_trabalho ?? '',
        local_trabalho: data.local_trabalho ?? '',
        cache_base_estimado_total: mappedLinhas.length > 0 ? cb : vsSm || cb,
        valor_servico_sem_modelo: mappedLinhas.length > 0 ? vsSm : vsSm || cb,
        taxa_agencia_percent: data.taxa_agencia_percent,
        extras_agencia_valor: data.extras_agencia_valor,
        imposto_percent:
          data.imposto_percent != null && data.imposto_percent !== ''
            ? String(data.imposto_percent)
            : '10',
        condicoes_pagamento: data.condicoes_pagamento,
        data_vencimento: data.data_vencimento || '',
        uso_imagem: data.uso_imagem,
        prazo: data.prazo,
        territorio: data.territorio,
        parceiro_id:
          data.parceiro_id != null && data.parceiro_id !== '' ? String(data.parceiro_id) : '',
        parceiro_percent:
          data.parceiro_percent != null && data.parceiro_percent !== ''
            ? String(data.parceiro_percent)
            : '',
        booker_id: data.booker_id != null && data.booker_id !== '' ? String(data.booker_id) : '',
        booker_percent:
          data.booker_percent != null && data.booker_percent !== '' ? String(data.booker_percent) : '',
        job_sem_modelos: Boolean(data.job_sem_modelos),
        linhas: mappedLinhas,
      });
      setOrcamentoEditingStatus(data.status ?? 'rascunho');
      setOrcamentoEditingOsId(
        data.os_id_gerada != null && data.os_id_gerada !== '' ? Number(data.os_id_gerada) : null,
      );
    } catch {
      setOrcamentoError(LOAD_ERROR_MESSAGE);
    }
  };

  const cancelarOrcamento = async (id) => {
    if (
      !window.confirm(
        'Cancelar este orçamento? O status passará a Cancelado e não será possível aprovar nem editar.',
      )
    ) {
      return;
    }
    setOrcamentoError('');
    try {
      const response = await fetch(`${API_BASE}/orcamentos/${id}/cancelar`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Erro ao cancelar orçamento.');
      if (orcamentoEditingId === id) {
        clearOrcamentoEdicao();
        setOrcamentosSubView('gestao');
      }
      setOrcamentosRefreshTick((x) => x + 1);
      alert(data.message || 'Orçamento cancelado.');
    } catch (requestError) {
      setOrcamentoError(requestError.message);
    }
  };

  /** Só administradores (API); remove orçamento + O.S. + financeiro/contratos da O.S. Irreversível. */
  const excluirOrcamentoDefinitivo = async (item) => {
    const id = item.id;
    const osId = item.os_id_gerada != null ? Number(item.os_id_gerada) : null;
    if (
      !window.confirm(
        `EXCLUIR DEFINITIVAMENTE o orçamento #${id}?\n\n` +
          'Serão removidos: o orçamento, a ordem de serviço (job) se existir, documentos/contrato dessa O.S., recebimentos e pagamentos a modelos vinculados a essa O.S. Isto não pode ser desfeito.',
      )
    ) {
      return;
    }
    setOrcamentoError('');
    try {
      const response = await fetchWithTimeout(`${API_BASE}/orcamentos/${id}/definitivo`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Erro ao excluir orçamento.');
      if (orcamentoEditingId === id) {
        clearOrcamentoEdicao();
        setOrcamentosSubView('gestao');
      }
      if (osDraft?.id && osId != null && Number(osDraft.id) === osId) {
        setOsDraft(null);
      }
      setOrcamentosRefreshTick((x) => x + 1);
      if (module === 'jobs') {
        const listRes = await fetchWithTimeout(`${API_BASE}/ordens-servico`);
        if (listRes.ok) setOsList(await listRes.json());
      }
      await refreshAlertasOperacionais();
      alert(data.message || 'Orçamento removido.');
    } catch (requestError) {
      setOrcamentoError(requestError.message);
    }
  };

  const abrirOsGerada = (osId) => {
    const oid = Number(osId);
    if (!Number.isFinite(oid) || oid <= 0) return;
    setModule('jobs');
    setOrcamentosSubView('gestao');
    setOsDraft(null);
    loadOsDetail(oid);
  };

  const aprovarOrcamento = async (id) => {
    if (
      !window.confirm(
        'Aprovar este orçamento? O status passará a Aprovado, a ordem de serviço será gerada automaticamente e o orçamento deixará de poder ser editado.',
      )
    ) {
      return;
    }
    setOrcamentoError('');
    try {
      const checkRes = await fetch(`${API_BASE}/orcamentos/${id}`);
      const budget = await checkRes.json();
      if (!checkRes.ok) throw new Error(budget.message || 'Orçamento não encontrado.');
      const jobSem = Boolean(budget.job_sem_modelos);
      const linhas = Array.isArray(budget.linhas) ? budget.linhas : [];
      const reais = linhas.filter((l) => l.modelo_id != null && Number(l.modelo_id) > 0);
      if (jobSem) {
        if (!(Number(budget.valor_servico_sem_modelo) > 0)) {
          setOrcamentoError('Para aprovar “sem modelo”, defina o valor do serviço no orçamento.');
          return;
        }
      } else {
        if (reais.length === 0) {
          setOrcamentoError(
            'Adicione pelo menos um modelo ou marque que este trabalho não possui modelos.',
          );
          return;
        }
        const invalid = reais.some((l) => !Number.isFinite(Number(l.cache_modelo)) || Number(l.cache_modelo) < 0);
        if (invalid) {
          setOrcamentoError('Cada modelo do cadastro precisa de cachê válido (≥ 0) antes de aprovar.');
          return;
        }
      }

      const response = await fetch(`${API_BASE}/orcamentos/${id}/aprovar`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        const extra = [data.codigo_bd && `Código BD: ${data.codigo_bd}`, data.detalhe_tecnico].filter(Boolean).join(' — ');
        throw new Error(
          [data.message || 'Erro ao aprovar orçamento.', extra].filter(Boolean).join(' ').trim(),
        );
      }
      if (orcamentoEditingId === id) {
        setOrcamentoEditingStatus('aprovado');
        const oid = data.os?.id;
        setOrcamentoEditingOsId(Number.isFinite(Number(oid)) ? Number(oid) : null);
      }
      setOrcamentosRefreshTick((x) => x + 1);
      const assinaturaLink = data?.contrato?.assinatura_link;
      const envioErro = data?.contrato?.envio_erro;
      const detalhes = [
        data.message || 'Orçamento aprovado.',
        assinaturaLink ? `Link de assinatura: ${assinaturaLink}` : null,
        envioErro ? `Aviso de envio: ${envioErro}` : null,
      ].filter(Boolean);
      alert(detalhes.join('\n\n'));
    } catch (requestError) {
      setOrcamentoError(requestError.message);
    }
  };

  const reenviarContrato = async (item) => {
    const destinoPadrao = item?.cliente_email ? String(item.cliente_email) : '';
    const destinatario = window.prompt('E-mail para reenviar contrato:', destinoPadrao);
    if (destinatario == null) return;
    setContratosError('');
    try {
      const response = await fetchWithTimeout(`${API_BASE}/contratos/${item.os_id}/reenviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinatario }),
      });
      const raw = await response.text();
      throwIfHtmlOrCannotPost(raw, response.status);
      const data = raw ? JSON.parse(raw) : {};
      if (!response.ok) throw new Error(data.message || 'Falha ao reenviar contrato.');
      alert(data.message || 'Contrato reenviado.');
      const refreshRes = await fetchWithTimeout(`${API_BASE}/contratos`);
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json();
        setContratosList(Array.isArray(refreshed) ? refreshed : []);
      }
    } catch (e) {
      setContratosError(e?.message || 'Falha ao reenviar contrato.');
    }
  };

  /** Na lista: abrir o orçamento na tela de edição; aprovação fica só no topo do formulário (rascunho). */
  const renderOrcamentoAcoes = (item) => {
    if (item.status === 'rascunho') {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
            onClick={() => editOrcamento(item)}
          >
            Abrir
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-red-700"
            onClick={() => cancelarOrcamento(item.id)}
          >
            Cancelar
          </button>
          <a
            href={`${API_BASE}/orcamentos/${item.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-slate-600 underline"
          >
            PDF
          </a>
          <button
            type="button"
            className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-800"
            title="Administrador: apaga orçamento e O.S. (testes)"
            onClick={() => excluirOrcamentoDefinitivo(item)}
          >
            Excluir definitivo
          </button>
        </div>
      );
    }
    if (item.status === 'aprovado') {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
            onClick={() => editOrcamento(item)}
          >
            Abrir
          </button>
          {item.os_id_gerada != null ? (
            <button
              type="button"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
              onClick={() => abrirOsGerada(item.os_id_gerada)}
            >
              Ver O.S. #{item.os_id_gerada}
            </button>
          ) : (
            <span className="text-xs text-slate-500">Sem O.S.</span>
          )}
          <a
            href={`${API_BASE}/orcamentos/${item.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-slate-600 underline"
          >
            PDF
          </a>
          <button
            type="button"
            className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-800"
            title="Administrador: apaga orçamento e O.S. (testes)"
            onClick={() => excluirOrcamentoDefinitivo(item)}
          >
            Excluir definitivo
          </button>
        </div>
      );
    }
    if (item.status === 'cancelado') {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
            onClick={() => editOrcamento(item)}
          >
            Abrir
          </button>
          <a
            href={`${API_BASE}/orcamentos/${item.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-slate-600 underline"
          >
            PDF
          </a>
          <button
            type="button"
            className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-800"
            title="Administrador: apaga orçamento e O.S. (testes)"
            onClick={() => excluirOrcamentoDefinitivo(item)}
          >
            Excluir definitivo
          </button>
        </div>
      );
    }
    return <span className="text-xs text-slate-400">—</span>;
  };

  const orcamentoFormLocked =
    orcamentoEditingId != null &&
    orcamentoEditingStatus != null &&
    orcamentoEditingStatus !== 'rascunho';

  const orcamentoFinanceiroPreview = previewOrcamentoFinanceiro(orcamentoForm);

  /** Pelo menos uma linha com modelo válido e cachê digitado → total do bloco Valores vem só da soma das linhas. */
  const orcamentoCacheModelosAutomatico = useMemo(() => {
    if (orcamentoForm.job_sem_modelos) return false;
    return (orcamentoForm.linhas || []).some((l) => {
      const mid = l.modelo_id !== '' && l.modelo_id != null ? Number(l.modelo_id) : NaN;
      const okModel = Number.isFinite(mid) && mid > 0;
      const c = String(l.cache_modelo ?? '').trim();
      const okCache = c !== '' && Number.isFinite(Number(c));
      return okModel && okCache;
    });
  }, [orcamentoForm.linhas, orcamentoForm.job_sem_modelos]);

  const orcamentoTotalCacheModelosSomado = useMemo(() => {
    if (orcamentoForm.job_sem_modelos) return 0;
    return (orcamentoForm.linhas || []).reduce((s, l) => {
      const mid = l.modelo_id !== '' && l.modelo_id != null ? Number(l.modelo_id) : NaN;
      if (!Number.isFinite(mid) || mid <= 0) return s;
      return s + (Number.isFinite(Number(l.cache_modelo)) ? Number(l.cache_modelo) : 0);
    }, 0);
  }, [orcamentoForm.linhas, orcamentoForm.job_sem_modelos]);

  useEffect(() => {
    if (!orcamentoCacheModelosAutomatico) return;
    const t = String(orcamentoTotalCacheModelosSomado);
    setOrcamentoForm((prev) => {
      if (String(prev.valor_servico_sem_modelo) === t && String(prev.cache_base_estimado_total) === t) return prev;
      return { ...prev, valor_servico_sem_modelo: t, cache_base_estimado_total: t };
    });
  }, [orcamentoCacheModelosAutomatico, orcamentoTotalCacheModelosSomado]);

  const clientesOrcamentoFiltrados = useMemo(() => {
    const q = String(orcamentoClienteBusca || '').trim().toLowerCase();
    const qDigits = onlyDigits(q);
    if (!q) return clients;
    return clients.filter((c) => {
      const nome = String(c.nome_empresa || c.nome_fantasia || '').toLowerCase();
      const doc = onlyDigits(String(c.documento || c.cnpj || c.cnpj_ou_cpf || ''));
      if (nome.includes(q)) return true;
      if (qDigits && doc.includes(qDigits)) return true;
      return false;
    });
  }, [clients, orcamentoClienteBusca]);

  useEffect(() => {
    const n = (orcamentoForm.linhas || []).length;
    setOrcamentoModeloBuscaPorLinha((prev) => {
      if (prev.length === n) return prev;
      const next = prev.slice(0, n);
      while (next.length < n) next.push('');
      return next;
    });
  }, [orcamentoForm.linhas?.length]);

  const websiteMainTitle = useMemo(() => {
    if (module !== 'website') return '';
    const labels = {
      modelos: 'Modelos',
      editar_modelo: 'Editar modelo',
      inscricoes: 'Inscrições',
      home: 'Home',
      instagram: 'Instagram',
      radio: 'Rádio',
    };
    return labels[websiteSubView] || 'Website';
  }, [module, websiteSubView]);

  const websiteSubtitle = useMemo(() => {
    if (module !== 'website') return '';
    const lines = {
      modelos: 'Catálogo do site institucional (somente leitura).',
      editar_modelo: '',
      inscricoes: 'Candidaturas recebidas pelo site — lista simples e detalhe ao clicar.',
      home: 'Ordem dos modelos em destaque na home do site.',
      instagram: 'Posts da home (imagem + link; sem embed no tile).',
      radio:
        'AndyRadio: playlists e MP3 (único backend CRM). O andymodels.com usa GET /api/public/radio/v2 no domínio do CRM.',
    };
    return lines[websiteSubView] || '';
  }, [module, websiteSubView]);

  const websiteBadgeLabel = useMemo(() => {
    if (module !== 'website') return '';
    return websiteSubView === 'modelos' || websiteSubView === 'editar_modelo'
      ? 'andymodels.com'
      : 'Website';
  }, [module, websiteSubView]);

  return (
    <div className="min-h-screen bg-[#F7F7F7] text-slate-900">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 p-5 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <img src="/logo-andy.png" alt="Andy Management" className="h-14 w-auto" />
          <p className="mt-3 text-sm text-slate-500">CRM financeiro - Cadastros, orçamentos e O.S.</p>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Logado como</p>
            <p className="text-sm font-medium text-slate-800">{authUser?.nome || authUser?.email || 'Admin'}</p>
            <p className="text-xs text-slate-500">{authUser?.email || ''}</p>
            <button
              type="button"
              onClick={onLogout}
              className="mt-3 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700"
            >
              Sair
            </button>
          </div>
          <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setModule('inicio')}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'inicio')}`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setModule('atendimento')}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'atendimento')}`}
            >
              Atendimento
            </button>
            <div className="rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setWebsiteMenuOpen((prev) => !prev);
                  setModule('website');
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'website')}`}
              >
                <span>Website</span>
                <span className="text-xs opacity-90">{websiteMenuOpen ? '▾' : '▸'}</span>
              </button>
              {websiteMenuOpen && (
                <nav className="mt-2 space-y-1.5 pl-2" aria-label="Secções do website">
                  {[
                    { id: 'modelos', label: 'Modelos' },
                    { id: 'inscricoes', label: 'Inscrições' },
                    { id: 'home', label: 'Home' },
                    { id: 'instagram', label: 'Instagram' },
                    { id: 'radio', label: 'Rádio' },
                  ].map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setWebsiteMenuOpen(true);
                        setModule('website');
                        setWebsiteSubView(id);
                        setWebsiteEditSlug(null);
                        setWebsiteEditModelId(null);
                      }}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${navSubBtn(
                        (websiteSubView === id && module === 'website') ||
                          (id === 'modelos' && module === 'website' && websiteSubView === 'editar_modelo'),
                      )}`}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
              )}
            </div>
            <div className="rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setCadastrosMenuOpen((prev) => !prev);
                  setModule('cadastros');
                  setTab('clientes');
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'cadastros')}`}
              >
                <span>Cadastros</span>
                <span className="text-xs opacity-90">{cadastrosMenuOpen ? '▾' : '▸'}</span>
              </button>
              {cadastrosMenuOpen && (
                <nav className="mt-2 space-y-1.5 pl-2" aria-label="Tipos de cadastro">
                  {tabEntries.map(([key, value]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setCadastrosMenuOpen(true);
                        setModule('cadastros');
                        setTab(key);
                      }}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${navSubBtn(tab === key && module === 'cadastros')}`}
                    >
                      {value.label}
                    </button>
                  ))}
                </nav>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setModule('orcamentos');
                setOrcamentosSubView('gestao');
              }}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'orcamentos')}`}
            >
              Orçamentos
            </button>
            <button
              type="button"
              onClick={() => {
                setModule('jobs');
                setOsDraft(null);
              }}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'jobs')}`}
            >
              Jobs / O.S.
            </button>
            <button
              type="button"
              onClick={() => setModule('agenda')}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'agenda')}`}
            >
              Agenda
            </button>
            <button
              type="button"
              onClick={() => setModule('contratos')}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'contratos')}`}
            >
              Contratos
            </button>
            <button
              type="button"
              onClick={() => setModule('financeiro')}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'financeiro')}`}
            >
              Financeiro
            </button>
            <button
              type="button"
              onClick={() => setModule('extrato')}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'extrato')}`}
            >
              Extrato modelo
            </button>
            <button
              type="button"
              onClick={() => {
                setModule('seguranca');
                setSenhaMsg('');
              }}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${navMainBtn(module === 'seguranca')}`}
            >
              Segurança
            </button>
          </div>
          <div className="mt-8 rounded-2xl bg-slate-100 p-3 text-xs text-slate-600">
            Resumo de caixa e alertas na <strong>Dashboard</strong>; detalhes em Financeiro e Jobs.
          </div>
        </aside>

        <main className="space-y-5">
          {apiOnline &&
            (contratosPendentes.count > 0 ||
              (alertasOperacionais?.contas_receber?.length ?? 0) > 0) && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
                <strong className="font-semibold">Operacional:</strong>{' '}
                {contratosPendentes.count > 0 && (
                  <span>
                    {contratosPendentes.count} contrato(s) sem assinatura arquivada
                    {(alertasOperacionais?.contas_receber?.length ?? 0) > 0 ? '; ' : '.'}{' '}
                  </span>
                )}
                {(alertasOperacionais?.contas_receber?.length ?? 0) > 0 && (
                  <span>
                    {(alertasOperacionais?.contas_receber?.length ?? 0)} O.S. com saldo a receber do cliente.
                  </span>
                )}{' '}
                Abra a <strong>Dashboard</strong> ou <strong>Jobs / O.S.</strong> para agir.
              </div>
            )}
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            {!apiOnline && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                API offline
                {API_URL ? ` em ${API_URL}` : ` (esperado o backend em http://127.0.0.1:${DEV_PROXY_PORT})`}. Abra o Terminal na pasta{' '}
                <code className="rounded bg-red-100 px-1">backend</code> e deixe <code className="rounded bg-red-100 px-1">npm run dev</code> a correr.
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold">
                  {module === 'cadastros'
                    ? current.label
                    : module === 'orcamentos'
                      ? orcamentosSubView === 'lista'
                        ? 'Todos os orçamentos'
                        : orcamentosSubView === 'formulario'
                          ? orcamentoEditingId
                            ? `Orçamento #${orcamentoEditingId}`
                            : 'Novo orçamento'
                          : 'Orçamentos'
                      : module === 'inicio'
                        ? 'Dashboard'
                        : module === 'agenda'
                          ? 'Agenda'
                          : module === 'contratos'
                            ? 'Contratos'
                            : module === 'seguranca'
                              ? 'Minha conta e segurança'
                              : module === 'financeiro'
                                ? 'Financeiro'
                                : module === 'extrato'
                                  ? 'Extrato modelo'
                                  : module === 'atendimento'
                                    ? 'Atendimento'
                                    : module === 'website'
                                      ? websiteMainTitle
                                      : 'Jobs / O.S.'}
                </h2>
                {module !== 'financeiro' && !(module === 'website' && !String(websiteSubtitle || '').trim()) ? (
                <p className="text-sm text-slate-500">
                  {module === 'cadastros'
                    ? cadastrosSubView === 'entrada'
                      ? 'Busque, veja os últimos registros ou crie um novo cadastro.'
                      : 'Cadastro simples e operacional, pronto para alimentar O.S. e financeiro.'
                    : module === 'orcamentos'
                      ? orcamentosSubView === 'lista'
                        ? 'Listagem completa com filtros e paginação.'
                        : orcamentosSubView === 'formulario'
                          ? 'Salve antes de aprovar; o botão “Aprovar Orçamento” fica no topo quando aplicável.'
                          : 'Busque orçamentos, abra para revisar ou aprovar, ou crie um novo.'
                      : module === 'inicio'
                        ? 'Resumo operacional e financeiro do momento.'
                        : module === 'agenda'
                          ? 'Calendário dos jobs e eventos manuais; envio de link e confirmação de presença por modelo.'
                          : module === 'contratos'
                            ? 'Central de contratos por O.S.: status, visualização e reenvio para assinatura.'
                            : module === 'seguranca'
                              ? 'Altere sua senha de administrador em uma tela dedicada.'
                              : module === 'extrato'
                                ? 'Líquido por linha de modelo, pagamentos registrados e saldo.'
                                : module === 'atendimento'
                                  ? 'Conversas e painel assistente — estrutura visual; dados e envio serão ligados mais tarde.'
                                  : module === 'website'
                                    ? websiteSubtitle
                                    : 'Lista das O.S. geradas ao aprovar orçamento — somente leitura; valores vêm do orçamento.'}
                </p>
                ) : null}
              </div>
              <span
                className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                {module === 'cadastros'
                  ? `${items.length} registros`
                  : module === 'orcamentos'
                    ? orcamentosSubView === 'gestao'
                      ? orcamentoBuscaDebounced.trim()
                        ? `${orcamentosTotal} resultado(s)`
                        : `${orcamentosTotal} orçamentos`
                      : orcamentosSubView === 'formulario'
                        ? orcamentoEditingId
                          ? labelOrcamentoStatus(orcamentoEditingStatus)
                          : 'Novo'
                        : `${orcamentosTotal} registro(s)`
                    : module === 'inicio'
                      ? dashboardResumo
                        ? `${formatBRL(dashboardResumo.resultado_final ?? 0)} resultado`
                        : '—'
                      : module === 'agenda'
                        ? 'Operação'
                        : module === 'contratos'
                          ? `${contratosList.length} contrato(s)`
                          : module === 'seguranca'
                            ? 'Administrador'
                            : module === 'financeiro'
                              ? finResumo
                                ? `${formatBRL(finResumo.total_recebido_cliente)} rec.`
                                : '—'
                              : module === 'extrato'
                                ? `${extratoRows.length} linha(s)`
                                : module === 'atendimento'
                                  ? 'Demonstração'
                                  : module === 'website'
                                    ? websiteBadgeLabel
                                    : `${osList.length} O.S.`}
              </span>
            </div>
          </section>

          {module === 'inicio' && (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Resumo financeiro</h3>
                {dashboardResumoLoading ? (
                  <p className="mt-4 text-sm text-slate-500">Carregando…</p>
                ) : dashboardResumo ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Recebido total</p>
                      <p className="text-lg font-semibold text-slate-900">
                        {formatBRL(dashboardResumo.total_recebido_cliente)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Pago modelos</p>
                      <p className="text-lg font-semibold text-slate-900">
                        {formatBRL(dashboardResumo.total_pago_modelos)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Comissões</p>
                      <p className="text-lg font-semibold text-slate-900">
                        {formatBRL(dashboardResumo.total_comissoes_os ?? 0)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Despesas</p>
                      <p className="text-lg font-semibold text-slate-900">
                        {formatBRL(dashboardResumo.total_despesas ?? 0)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:col-span-2 lg:col-span-1">
                      <p className="text-xs text-emerald-900">Resultado final</p>
                      <p className="text-lg font-semibold text-emerald-950">
                        {formatBRL(dashboardResumo.resultado_final ?? 0)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-amber-800">Não foi possível carregar o resumo.</p>
                )}
              </section>

              <OperacaoAgenda
                apiUrl={API_BASE}
                onOpenOs={(osId) => {
                  setModule('jobs');
                  loadOsDetail(osId);
                }}
              />

              {alertasOperacionais?.contas_receber?.length ? (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-base font-semibold text-slate-800">Contas a receber</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2">Cliente</th>
                          <th className="px-2 py-2">Valor</th>
                          <th className="px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {alertasOperacionais.contas_receber.map((row) => (
                          <tr key={row.os_id} className="border-b border-slate-100">
                            <td className="px-2 py-2">{row.cliente}</td>
                            <td className="px-2 py-2 font-medium text-amber-900">{formatBRL(row.saldo)}</td>
                            <td className="px-2 py-2 text-right">
                              <button
                                type="button"
                                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
                                style={{ backgroundColor: BRAND_ORANGE }}
                                onClick={() => {
                                  setModule('financeiro');
                                  setFinModal('receber');
                                  setFinReceberOsId(row.os_id);
                                  setFinReceberDraft({
                                    valor:
                                      Number(row.saldo) > 0
                                        ? String(Number(row.saldo).toFixed(2))
                                        : '',
                                    data_recebimento: new Date().toISOString().slice(0, 10),
                                    observacao: '',
                                  });
                                }}
                              >
                                Receber
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {alertasOperacionais?.pagamentos_modelo_pendentes?.length ? (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-base font-semibold text-slate-800">Pagamento de modelos</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2">Cliente</th>
                          <th className="px-2 py-2">Valor</th>
                          <th className="px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {alertasOperacionais.pagamentos_modelo_pendentes.map((row) => {
                          const bloqueadoCliente = osIdsComSaldoCliente.has(Number(row.job_id));
                          const bloqueadoContrato = !pagamentoModeloLiberadoContrato(row);
                          return (
                            <tr key={row.os_modelo_id} className="border-b border-slate-100">
                              <td className="px-2 py-2">
                                <span className="block font-medium">{row.cliente}</span>
                                <span className="text-xs text-slate-500">
                                  #{row.job_id} · {row.modelo_nome}
                                </span>
                              </td>
                              <td className="px-2 py-2 font-medium text-amber-900">{formatBRL(row.saldo)}</td>
                              <td className="px-2 py-2 text-right">
                                {bloqueadoCliente ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="max-w-[16rem] cursor-not-allowed rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-left text-xs font-medium text-amber-900"
                                  >
                                    Aguardando recebimento do cliente
                                  </button>
                                ) : bloqueadoContrato ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="max-w-[16rem] cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs font-medium text-slate-700"
                                  >
                                    Pagamento bloqueado: contrato ainda não assinado.
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
                                    style={{ backgroundColor: BRAND_ORANGE }}
                                    onClick={() => {
                                      setModule('financeiro');
                                      setFinModal('pagar');
                                      setFinPagarLinha(row);
                                      setFinPagarDraft({
                                        valor:
                                          Number(row.saldo) > 0
                                            ? String(Number(row.saldo).toFixed(2))
                                            : '',
                                        data_pagamento: new Date().toISOString().slice(0, 10),
                                        observacao: '',
                                      });
                                    }}
                                  >
                                    Pagar
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </>
          )}

          {module === 'agenda' && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <AgendaCentral apiBase={API_BASE} />
            </section>
          )}

          {module === 'atendimento' && (
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <AtendimentoPage />
            </section>
          )}

          {module === 'financeiro' && (
            <>
              {finModal ? (
                <div
                  className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
                  onClick={() => {
                    setFinModal(null);
                    setFinReceberOsId(null);
                    setFinPagarLinha(null);
                  }}
                  role="presentation"
                >
                  <div
                    className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                  >
                    {finModal === 'receber' && (
                      <div>
                        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                          <h3 className="text-lg font-semibold text-slate-900">Receber cliente</h3>
                          <button
                            type="button"
                            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                            onClick={() => {
                              setFinModal(null);
                              setFinReceberOsId(null);
                            }}
                          >
                            Fechar
                          </button>
                        </div>
                        {!finReceberOsId ? (
                          <div className="mt-4">
                            {!alertasOperacionais?.contas_receber?.length ? (
                              <p className="text-sm text-slate-600">Nenhuma O.S. com saldo a receber.</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-slate-200 text-left text-slate-500">
                                      <th className="px-2 py-2">O.S.</th>
                                      <th className="px-2 py-2">Cliente</th>
                                      <th className="px-2 py-2">Saldo</th>
                                      <th className="px-2 py-2" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {alertasOperacionais.contas_receber.map((row) => (
                                      <tr key={row.os_id} className="border-b border-slate-100">
                                        <td className="px-2 py-2 font-medium">#{row.os_id}</td>
                                        <td className="px-2 py-2">{row.cliente}</td>
                                        <td className="px-2 py-2">{formatBRL(row.saldo)}</td>
                                        <td className="px-2 py-2 text-right">
                                          <button
                                            type="button"
                                            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
                                            style={{ backgroundColor: BRAND_ORANGE }}
                                            onClick={() => {
                                              setFinReceberOsId(row.os_id);
                                              setFinReceberDraft({
                                                valor:
                                                  Number(row.saldo) > 0
                                                    ? String(Number(row.saldo).toFixed(2))
                                                    : '',
                                                data_recebimento: new Date().toISOString().slice(0, 10),
                                                observacao: '',
                                              });
                                            }}
                                          >
                                            Receber
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        ) : (
                          <form
                            className="mt-4 space-y-4"
                            onSubmit={(e) => {
                              e.preventDefault();
                              registrarRecebimento({
                                os_id: finReceberOsId,
                                valor: finReceberDraft.valor,
                                data_recebimento: finReceberDraft.data_recebimento,
                                observacao: finReceberDraft.observacao,
                              });
                            }}
                          >
                            <p className="text-sm text-slate-700">
                              O.S. <strong>#{finReceberOsId}</strong>
                            </p>
                            <label className="block text-sm text-slate-600">
                              <span className="mb-1 block">Valor (R$)</span>
                              <input
                                type="number"
                                step="0.01"
                                value={finReceberDraft.valor}
                                onChange={(e) =>
                                  setFinReceberDraft((p) => ({ ...p, valor: e.target.value }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                                required
                              />
                            </label>
                            <label className="block text-sm text-slate-600">
                              <span className="mb-1 block">Data</span>
                              <input
                                type="date"
                                autoComplete="off"
                                value={toDateInputValue(finReceberDraft.data_recebimento)}
                                onChange={(e) =>
                                  setFinReceberDraft((p) => ({ ...p, data_recebimento: e.target.value }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                                required
                              />
                            </label>
                            <label className="block text-sm text-slate-600">
                              <span className="mb-1 block">Observação</span>
                              <input
                                value={finReceberDraft.observacao}
                                onChange={(e) =>
                                  setFinReceberDraft((p) => ({ ...p, observacao: e.target.value }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                              />
                            </label>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                                onClick={() => setFinReceberOsId(null)}
                              >
                                Voltar
                              </button>
                              <button
                                type="submit"
                                className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                                style={{ backgroundColor: BRAND_ORANGE }}
                              >
                                Confirmar recebimento
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}

                    {finModal === 'pagar' && (
                      <div>
                        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                          <h3 className="text-lg font-semibold text-slate-900">Pagar modelos</h3>
                          <button
                            type="button"
                            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                            onClick={() => {
                              setFinModal(null);
                              setFinPagarLinha(null);
                            }}
                          >
                            Fechar
                          </button>
                        </div>
                        {!finPagarLinha ? (
                          <div className="mt-4">
                            {!alertasOperacionais?.pagamentos_modelo_pendentes?.length ? (
                              <p className="text-sm text-slate-600">Nenhuma linha com saldo pendente.</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-slate-200 text-left text-slate-500">
                                      <th className="px-2 py-2">O.S.</th>
                                      <th className="px-2 py-2">Modelo</th>
                                      <th className="px-2 py-2">Saldo</th>
                                      <th className="px-2 py-2" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {alertasOperacionais.pagamentos_modelo_pendentes.map((row) => {
                                      const bloqueadoCliente = osIdsComSaldoCliente.has(Number(row.job_id));
                                      const bloqueadoContrato = !pagamentoModeloLiberadoContrato(row);
                                      return (
                                        <tr key={row.os_modelo_id} className="border-b border-slate-100">
                                          <td className="px-2 py-2">#{row.job_id}</td>
                                          <td className="px-2 py-2">{row.modelo_nome}</td>
                                          <td className="px-2 py-2">{formatBRL(row.saldo)}</td>
                                          <td className="px-2 py-2 text-right">
                                            {bloqueadoCliente ? (
                                              <button
                                                type="button"
                                                disabled
                                                className="max-w-[14rem] cursor-not-allowed rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-left text-xs font-medium text-amber-900 disabled:opacity-100"
                                              >
                                                Aguardando recebimento do cliente
                                              </button>
                                            ) : bloqueadoContrato ? (
                                              <button
                                                type="button"
                                                disabled
                                                className="max-w-[16rem] cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs font-medium text-slate-700 disabled:opacity-100"
                                              >
                                                Pagamento bloqueado: contrato ainda não assinado.
                                              </button>
                                            ) : (
                                              <button
                                                type="button"
                                                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
                                                style={{ backgroundColor: BRAND_ORANGE }}
                                                onClick={() => {
                                                  setFinPagarLinha(row);
                                                  setFinPagarDraft({
                                                    valor:
                                                      Number(row.saldo) > 0
                                                        ? String(Number(row.saldo).toFixed(2))
                                                        : '',
                                                    data_pagamento: new Date().toISOString().slice(0, 10),
                                                    observacao: '',
                                                  });
                                                }}
                                              >
                                                Pagar
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        ) : (
                          <form
                            className="mt-4 space-y-4"
                            onSubmit={(e) => {
                              e.preventDefault();
                              submitPagamentoModelo({
                                os_modelo_id: finPagarLinha.os_modelo_id,
                                valor: finPagarDraft.valor,
                                data_pagamento: finPagarDraft.data_pagamento,
                                observacao: finPagarDraft.observacao,
                              });
                            }}
                          >
                            <p className="text-sm text-slate-700">
                              O.S. <strong>#{finPagarLinha.job_id}</strong> — {finPagarLinha.modelo_nome}
                            </p>
                            <label className="block text-sm text-slate-600">
                              <span className="mb-1 block">Valor (R$)</span>
                              <input
                                type="number"
                                step="0.01"
                                value={finPagarDraft.valor}
                                onChange={(e) =>
                                  setFinPagarDraft((p) => ({ ...p, valor: e.target.value }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                                required
                              />
                            </label>
                            <label className="block text-sm text-slate-600">
                              <span className="mb-1 block">Data</span>
                              <input
                                type="date"
                                autoComplete="off"
                                value={toDateInputValue(finPagarDraft.data_pagamento)}
                                onChange={(e) =>
                                  setFinPagarDraft((p) => ({ ...p, data_pagamento: e.target.value }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                                required
                              />
                            </label>
                            <label className="block text-sm text-slate-600">
                              <span className="mb-1 block">Observação</span>
                              <input
                                value={finPagarDraft.observacao}
                                onChange={(e) =>
                                  setFinPagarDraft((p) => ({ ...p, observacao: e.target.value }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                              />
                            </label>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                                onClick={() => setFinPagarLinha(null)}
                              >
                                Voltar
                              </button>
                              <button
                                type="submit"
                                className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                                style={{ backgroundColor: BRAND_ORANGE }}
                              >
                                Confirmar pagamento
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}

                    {finModal === 'despesa' && (
                      <div>
                        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                          <h3 className="text-lg font-semibold text-slate-900">Registrar despesa</h3>
                          <button
                            type="button"
                            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                            onClick={() => setFinModal(null)}
                          >
                            Fechar
                          </button>
                        </div>
                        <form className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={saveDespesa}>
                          <label className="block text-sm text-slate-600 sm:col-span-1">
                            <span className="mb-1 block">Data</span>
                            <input
                              type="date"
                              autoComplete="off"
                              value={toDateInputValue(finDespesaForm.data_despesa)}
                              onChange={(e) => setFinDespesaForm((p) => ({ ...p, data_despesa: e.target.value }))}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2"
                              required
                            />
                          </label>
                          <label className="block text-sm text-slate-600 sm:col-span-2">
                            <span className="mb-1 block">Descrição</span>
                            <input
                              value={finDespesaForm.descricao}
                              onChange={(e) => setFinDespesaForm((p) => ({ ...p, descricao: e.target.value }))}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2"
                              required
                            />
                          </label>
                          <label className="block text-sm text-slate-600">
                            <span className="mb-1 block">Valor (R$)</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={finDespesaForm.valor}
                              onChange={(e) => setFinDespesaForm((p) => ({ ...p, valor: e.target.value }))}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2"
                              required
                            />
                          </label>
                          <label className="block text-sm text-slate-600">
                            <span className="mb-1 block">Categoria</span>
                            <select
                              value={finDespesaForm.categoria}
                              onChange={(e) => setFinDespesaForm((p) => ({ ...p, categoria: e.target.value }))}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2"
                              required
                            >
                              {DESPESA_CATEGORIAS.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-sm text-slate-600 sm:col-span-2">
                            <span className="mb-1 block">O.S. (opcional)</span>
                            <select
                              value={finDespesaForm.os_id}
                              onChange={(e) => setFinDespesaForm((p) => ({ ...p, os_id: e.target.value }))}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2"
                            >
                              <option value="">Nenhuma</option>
                              {finOsOptions.map((os) => (
                                <option key={os.id} value={String(os.id)}>
                                  #{os.id} — {os.nome_empresa || os.nome_fantasia}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="sm:col-span-2">
                            <button
                              type="submit"
                              className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                              style={{ backgroundColor: BRAND_ORANGE }}
                            >
                              Salvar despesa
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    className="w-full rounded-2xl px-4 py-5 text-center text-base font-semibold text-white shadow-md transition hover:opacity-95"
                    style={{ backgroundColor: BRAND_ORANGE }}
                    onClick={() => {
                      setFinModal('receber');
                      setFinReceberOsId(null);
                      setFinReceberDraft({
                        valor: '',
                        data_recebimento: new Date().toISOString().slice(0, 10),
                        observacao: '',
                      });
                    }}
                  >
                    Receber cliente
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-2xl px-4 py-5 text-center text-base font-semibold text-white shadow-md transition hover:opacity-95"
                    style={{ backgroundColor: BRAND_ORANGE }}
                    onClick={() => {
                      setFinModal('pagar');
                      setFinPagarLinha(null);
                      setFinPagarDraft({
                        valor: '',
                        data_pagamento: new Date().toISOString().slice(0, 10),
                        observacao: '',
                      });
                    }}
                  >
                    Pagar modelos
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-2xl px-4 py-5 text-center text-base font-semibold text-white shadow-md transition hover:opacity-95"
                    style={{ backgroundColor: BRAND_ORANGE }}
                    onClick={() => {
                      setFinModal('despesa');
                      setFinDespesaForm({
                        data_despesa: new Date().toISOString().slice(0, 10),
                        descricao: '',
                        valor: '',
                        categoria: 'operacional',
                        os_id: '',
                      });
                    }}
                  >
                    Registrar despesa
                  </button>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Resumo financeiro</h3>
                {finLoading ? (
                  <p className="mt-3 text-sm text-slate-500">Carregando...</p>
                ) : finResumo ? (
                  <div className="mt-4 space-y-6">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Resultado do período
                    </p>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                        Resultado do job
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Entradas e saídas ligadas às O.S. (recebido, modelos e comissões).
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-xs text-slate-500">Recebido total (cliente)</p>
                          <p className="text-lg font-semibold text-slate-900">
                            {formatBRL(finResumo.total_recebido_cliente)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-xs text-slate-500">Pagamento de modelos</p>
                          <p className="text-lg font-semibold text-slate-900">
                            {formatBRL(finResumo.total_pago_modelos)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-xs text-slate-500">Comissões (booker/parceiros)</p>
                          <p className="text-lg font-semibold text-slate-900">
                            {formatBRL(finResumo.total_comissoes_os ?? 0)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                          <p className="text-xs text-sky-900">Resultado operacional do job</p>
                          <p className="text-lg font-semibold text-sky-950">
                            {formatBRL(finResultadoOperacionalJob ?? 0)}
                          </p>
                          <p className="mt-1 text-[10px] leading-tight text-sky-800/90">
                            Recebido − pagamento de modelos − comissões
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-violet-900">
                        Despesas da empresa
                      </p>
                      <p className="mt-1 text-[11px] text-violet-800/90">
                        Custos da agência (operacional, impostos lançados manualmente, etc.), fora do cálculo por O.S.
                      </p>
                      <div className="mt-3 max-w-md">
                        <div className="rounded-xl border border-violet-200 bg-white p-3">
                          <p className="text-xs text-violet-800">Total de despesas</p>
                          <p className="text-lg font-semibold text-violet-950">
                            {formatBRL(finResumo.total_despesas ?? 0)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                        Resultado final
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-emerald-950">
                        {formatBRL(finResumo.resultado_final ?? 0)}
                      </p>
                      <p className="mt-1 text-xs text-emerald-900/90">
                        Resultado do job após descontar despesas da empresa (mesmo total já calculado no sistema).
                      </p>
                    </div>

                    {Number(finResumo.total_faturado_os_abertas) > 0.005 ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-950">
                          Previsão (não entrou no caixa)
                        </p>
                        <p className="mt-2 text-sm text-amber-950">
                          Faturado em O.S. ainda não recebidas:{' '}
                          <strong>{formatBRL(finResumo.total_faturado_os_abertas)}</strong>
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {finError && <p className="mt-3 text-sm text-red-600">{finError}</p>}
              </section>

              {alertasOperacionais?.contas_receber?.length ? (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-base font-semibold text-slate-800">Contas a receber</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2">O.S.</th>
                          <th className="px-2 py-2">Cliente</th>
                          <th className="px-2 py-2">Total</th>
                          <th className="px-2 py-2">Recebido</th>
                          <th className="px-2 py-2">Saldo</th>
                          <th className="px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {alertasOperacionais.contas_receber.map((row) => (
                          <tr key={row.os_id} className="border-b border-slate-100">
                            <td className="px-2 py-2 font-medium">#{row.os_id}</td>
                            <td className="px-2 py-2">{row.cliente}</td>
                            <td className="px-2 py-2">{formatBRL(row.total_cliente)}</td>
                            <td className="px-2 py-2">{formatBRL(row.recebido)}</td>
                            <td className="px-2 py-2 font-medium text-amber-900">{formatBRL(row.saldo)}</td>
                            <td className="px-2 py-2 text-right">
                              <button
                                type="button"
                                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
                                style={{ backgroundColor: BRAND_ORANGE }}
                                onClick={() => {
                                  setFinModal('receber');
                                  setFinReceberOsId(row.os_id);
                                  setFinReceberDraft({
                                    valor:
                                      Number(row.saldo) > 0
                                        ? String(Number(row.saldo).toFixed(2))
                                        : '',
                                    data_recebimento: new Date().toISOString().slice(0, 10),
                                    observacao: '',
                                  });
                                }}
                              >
                                Receber
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Pagamento de modelos</h3>
                {!alertasOperacionais?.pagamentos_modelo_pendentes?.length ? (
                  <p className="mt-3 text-sm text-slate-600">Nenhuma linha com saldo pendente.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2">O.S.</th>
                          <th className="px-2 py-2">Modelo</th>
                          <th className="px-2 py-2">Cliente</th>
                          <th className="px-2 py-2">Líquido</th>
                          <th className="px-2 py-2">Pago</th>
                          <th className="px-2 py-2">Saldo</th>
                          <th className="px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {alertasOperacionais.pagamentos_modelo_pendentes.map((row) => {
                          const bloqueadoCliente = osIdsComSaldoCliente.has(Number(row.job_id));
                          const bloqueadoContrato = !pagamentoModeloLiberadoContrato(row);
                          return (
                            <tr key={row.os_modelo_id} className="border-b border-slate-100">
                              <td className="px-2 py-2">#{row.job_id}</td>
                              <td className="px-2 py-2">{row.modelo_nome}</td>
                              <td className="px-2 py-2">{row.cliente}</td>
                              <td className="px-2 py-2">{formatBRL(row.liquido)}</td>
                              <td className="px-2 py-2">{formatBRL(row.pago)}</td>
                              <td className="px-2 py-2 font-medium text-amber-900">{formatBRL(row.saldo)}</td>
                              <td className="px-2 py-2 text-right">
                                {bloqueadoCliente ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="max-w-[14rem] cursor-not-allowed rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-left text-xs font-medium text-amber-900"
                                  >
                                    Aguardando recebimento do cliente
                                  </button>
                                ) : bloqueadoContrato ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="max-w-[16rem] cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs font-medium text-slate-700"
                                  >
                                    Pagamento bloqueado: contrato ainda não assinado.
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
                                    style={{ backgroundColor: BRAND_ORANGE }}
                                    onClick={() => {
                                      setFinModal('pagar');
                                      setFinPagarLinha(row);
                                      setFinPagarDraft({
                                        valor:
                                          Number(row.saldo) > 0
                                            ? String(Number(row.saldo).toFixed(2))
                                            : '',
                                        data_pagamento: new Date().toISOString().slice(0, 10),
                                        observacao: '',
                                      });
                                    }}
                                  >
                                    Pagar
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Despesas da empresa</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Lista filtrada. Novo lançamento pelo botão <strong>Registrar despesa</strong>.
                </p>

                <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">De (data)</span>
                    <input
                      type="date"
                      autoComplete="off"
                      value={toDateInputValue(finDespesaFiltroDe)}
                      onChange={(e) => setFinDespesaFiltroDe(e.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Até (data)</span>
                    <input
                      type="date"
                      autoComplete="off"
                      value={toDateInputValue(finDespesaFiltroAte)}
                      onChange={(e) => setFinDespesaFiltroAte(e.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Categoria</span>
                    <select
                      value={finDespesaFiltroCategoria}
                      onChange={(e) => setFinDespesaFiltroCategoria(e.target.value)}
                      className="min-w-[10rem] rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="">Todas</option>
                      {DESPESA_CATEGORIAS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">O.S.</span>
                    <select
                      value={finDespesaFiltroOsId}
                      onChange={(e) => setFinDespesaFiltroOsId(e.target.value)}
                      className="min-w-[12rem] rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="">Todas</option>
                      {finOsOptions.map((os) => (
                        <option key={os.id} value={String(os.id)}>
                          #{os.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                    onClick={() => {
                      setFinDespesaFiltroDe('');
                      setFinDespesaFiltroAte('');
                      setFinDespesaFiltroCategoria('');
                      setFinDespesaFiltroOsId('');
                    }}
                  >
                    Limpar filtros
                  </button>
                </div>

                <h4 className="mt-6 text-sm font-semibold text-slate-800">Lista (filtrada)</h4>
                {finLoading ? (
                  <p className="mt-2 text-sm text-slate-500">Carregando...</p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2">Data</th>
                          <th className="px-2 py-2">Descrição</th>
                          <th className="px-2 py-2">Categoria</th>
                          <th className="px-2 py-2">Valor</th>
                          <th className="px-2 py-2">O.S.</th>
                          <th className="px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {finDespesas.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-2 py-6 text-center text-slate-500">
                              Nenhuma despesa neste filtro.
                            </td>
                          </tr>
                        ) : (
                          finDespesas.map((d) => (
                            <tr key={d.id} className="border-b border-slate-100">
                              <td className="px-2 py-2 whitespace-nowrap">
                                {String(d.data_despesa).slice(0, 10)}
                              </td>
                              <td className="px-2 py-2">{d.descricao}</td>
                              <td className="px-2 py-2">{labelDespesaCategoria(d.categoria)}</td>
                              <td className="px-2 py-2">{formatBRL(d.valor)}</td>
                              <td className="px-2 py-2">{d.os_id != null ? `#${d.os_id}` : '—'}</td>
                              <td className="px-2 py-2">
                                <button
                                  type="button"
                                  className="text-xs text-red-700 underline"
                                  onClick={() => deleteDespesa(d.id)}
                                >
                                  Excluir
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Últimos recebimentos</h3>
                {finLoading ? (
                  <p className="mt-2 text-sm text-slate-500">Carregando...</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2">O.S.</th>
                          <th className="px-2 py-2">Cliente</th>
                          <th className="px-2 py-2">Valor</th>
                          <th className="px-2 py-2">Data</th>
                          <th className="px-2 py-2">Obs.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finRecebimentos.map((r) => (
                          <tr key={r.id} className="border-b border-slate-100">
                            <td className="px-2 py-2">#{r.os_id}</td>
                            <td className="px-2 py-2">{r.nome_empresa || r.nome_fantasia}</td>
                            <td className="px-2 py-2">{formatBRL(r.valor)}</td>
                            <td className="px-2 py-2">{String(r.data_recebimento).slice(0, 10)}</td>
                            <td className="px-2 py-2">{r.observacao}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

            </>
          )}

          {module === 'extrato' && (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-800">Extrato por linha (job × modelo)</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Líquido calculado como na O.S.; pago é a soma dos lançamentos em pagamentos de modelo.
                    </p>
                  </div>
                  <label className="text-sm text-slate-600">
                    Filtrar por modelo
                    <select
                      value={extratoModeloFilter}
                      onChange={(e) => setExtratoModeloFilter(e.target.value)}
                      className="ml-2 rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="">Todos</option>
                      {modelosParaSelecao.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {extratoLoading ? (
                  <p className="mt-4 text-sm text-slate-500">Carregando...</p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2">Linha</th>
                          <th className="px-2 py-2">Job (O.S.)</th>
                          <th className="px-2 py-2">Cliente</th>
                          <th className="px-2 py-2">Modelo</th>
                          <th className="px-2 py-2">Líquido</th>
                          <th className="px-2 py-2">Pago</th>
                          <th className="px-2 py-2">Saldo</th>
                          <th className="px-2 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {extratoRows.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-2 py-6 text-center text-sm text-slate-500">
                              Nenhuma linha de modelo em O.S. Aprove um orçamento e adicione modelos na O.S.
                            </td>
                          </tr>
                        ) : (
                          extratoRows.map((row) => (
                            <tr key={row.os_modelo_id} className="border-b border-slate-100">
                              <td className="px-2 py-2 font-mono text-xs text-slate-600">{row.os_modelo_id}</td>
                              <td className="px-2 py-2 font-medium">#{row.job_id}</td>
                              <td className="px-2 py-2">{row.cliente}</td>
                              <td className="px-2 py-2">{row.modelo_nome}</td>
                              <td className="px-2 py-2">{formatBRL(row.liquido)}</td>
                              <td className="px-2 py-2">{formatBRL(row.pago)}</td>
                              <td className="px-2 py-2">{formatBRL(row.saldo)}</td>
                              <td className="px-2 py-2">
                                <span
                                  className={
                                    row.status === 'quitado'
                                      ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800'
                                      : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900'
                                  }
                                >
                                  {row.status}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                {extratoError && <p className="mt-3 text-sm text-red-600">{extratoError}</p>}
                <p className="mt-4 text-sm text-slate-500">
                  Pagamentos a modelos são registrados no módulo <strong>Financeiro</strong>.
                </p>
              </section>
            </>
          )}

          {module === 'website' && websiteSubView === 'modelos' && (
            <WebsiteModelsPage
              onOpenEdit={async (slug, modelId) => {
                const mid =
                  modelId != null && modelId !== ''
                    ? Number(modelId)
                    : NaN;
                if (!Number.isNaN(mid) && mid > 0) {
                  try {
                    const r = await fetchWithAuth(`${API_BASE}/modelos/by-website/${mid}`);
                    const raw = await r.text();
                    throwIfHtmlOrCannotPost(raw, r.status);
                    let row;
                    try {
                      row = raw ? JSON.parse(raw) : null;
                    } catch {
                      row = null;
                    }
                    if (r.ok && row && row.id != null) {
                      setCadastrosMenuOpen(true);
                      setModule('cadastros');
                      setTab('modelos');
                      setEditingId(Number(row.id));
                      setForm(cadastroConfig.modelos.form);
                      setError('');
                      setCadastrosSubView('formulario');
                      return;
                    }
                  } catch {
                    /* fallback: editor só site */
                  }
                }
                const s = String(slug || '').trim();
                setWebsiteEditSlug(s || null);
                setWebsiteEditModelId(() => {
                  if (modelId == null || modelId === '') return null;
                  const n = Number(modelId);
                  return Number.isNaN(n) ? null : n;
                });
                setWebsiteSubView('editar_modelo');
                setWebsiteMenuOpen(true);
              }}
            />
          )}
          {module === 'website' &&
            websiteSubView === 'editar_modelo' &&
            ((websiteEditSlug != null && String(websiteEditSlug).trim() !== '') ||
              (websiteEditModelId != null && !Number.isNaN(Number(websiteEditModelId)))) && (
              <WebsiteModeloEditorPage
                key={`we-${websiteEditModelId ?? 'x'}-${String(websiteEditSlug || '').slice(0, 48)}`}
                mode="edit"
                editSlug={websiteEditSlug || ''}
                editModelId={websiteEditModelId}
                canEditSiteActive={authUser?.tipo === 'admin'}
                onBackToList={() => {
                  setWebsiteSubView('modelos');
                  setWebsiteEditSlug(null);
                  setWebsiteEditModelId(null);
                }}
              />
            )}
          {module === 'website' && websiteSubView === 'inscricoes' && <WebsiteInscricoesPage />}
          {module === 'website' && websiteSubView === 'home' && <WebsiteHomeOrderPage />}
          {module === 'website' && websiteSubView === 'instagram' && <WebsiteInstagramPage />}
          {module === 'website' && websiteSubView === 'radio' && <WebsiteRadioPage />}

          {module === 'seguranca' && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-800">Alterar senha</h3>
              <p className="mt-1 text-sm text-slate-500">
                Por segurança, a troca de senha fica numa tela dedicada. Use sua senha atual e defina uma nova senha forte.
              </p>
              <form className="mt-4 grid gap-3 md:max-w-md" onSubmit={handleChangePassword}>
                <label className="text-sm text-slate-600">
                  <span className="mb-1 block">Senha atual</span>
                  <input
                    type="password"
                    value={senhaAtual}
                    onChange={(e) => setSenhaAtual(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    required
                  />
                </label>
                <label className="text-sm text-slate-600">
                  <span className="mb-1 block">Nova senha (mín. 8 caracteres)</span>
                  <input
                    type="password"
                    value={senhaNova}
                    onChange={(e) => setSenhaNova(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    required
                  />
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={senhaLoading}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
                  >
                    {senhaLoading ? 'Alterando...' : 'Alterar senha'}
                  </button>
                  {senhaMsg ? <p className="text-sm text-slate-600">{senhaMsg}</p> : null}
                </div>
              </form>
              <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50/90 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-amber-950">Links de modelo</p>
                    <p className="mt-1 max-w-xl text-xs text-amber-950/90">
                      Gere links únicos de cadastro. Cada link é de uso único, válido por 24h e expira automaticamente.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={linkCadastroLoading || !apiOnline}
                    onClick={gerarLinkCadastroModelo}
                    className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-950 shadow-sm disabled:opacity-50"
                  >
                    {linkCadastroLoading ? 'A gerar…' : 'Gerar link'}
                  </button>
                </div>
                {linkCadastroMsg ? (
                  <p className={`mt-3 text-xs ${linkCadastroUrl ? 'text-green-800' : 'text-red-700'}`}>
                    {linkCadastroMsg}
                  </p>
                ) : null}
                {linkCadastroUrl ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      readOnly
                      value={linkCadastroUrl}
                      className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-slate-800"
                    />
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                      onClick={() => {
                        navigator.clipboard.writeText(linkCadastroUrl).catch(() => {});
                      }}
                    >
                      Copiar
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/90 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-sky-950">Links de cliente</p>
                    <p className="mt-1 max-w-xl text-xs text-sky-950/90">
                      Gere links únicos para clientes preencherem o cadastro público (válido por 24h, uso único).
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={linkCadastroClienteLoading || !apiOnline}
                    onClick={gerarLinkCadastroCliente}
                    className="shrink-0 rounded-lg border border-sky-400 bg-white px-3 py-2 text-sm font-medium text-sky-950 shadow-sm disabled:opacity-50"
                  >
                    {linkCadastroClienteLoading ? 'A gerar…' : 'Gerar link'}
                  </button>
                </div>
                {linkCadastroClienteMsg ? (
                  <p className={`mt-3 text-xs ${linkCadastroClienteUrl ? 'text-green-800' : 'text-red-700'}`}>
                    {linkCadastroClienteMsg}
                  </p>
                ) : null}
                {linkCadastroClienteUrl ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      readOnly
                      value={linkCadastroClienteUrl}
                      className="min-w-0 flex-1 rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs text-slate-800"
                    />
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                      onClick={() => {
                        navigator.clipboard.writeText(linkCadastroClienteUrl).catch(() => {});
                      }}
                    >
                      Copiar
                    </button>
                  </div>
                ) : null}
              </div>
            </section>
          )}

          {module === 'contratos' && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3">
                <h3 className="text-base font-semibold text-slate-800">Lista de contratos</h3>
                <p className="text-xs text-slate-500">
                  Um contrato por O.S., com status automático de assinatura.
                </p>
              </div>
              {contratosError ? (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {contratosError}
                </p>
              ) : null}
              {contratosLoading ? (
                <p className="text-sm text-slate-500">Carregando contratos...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="px-2 py-2 font-medium">Cliente</th>
                        <th className="px-2 py-2 font-medium">Modelo(s)</th>
                        <th className="px-2 py-2 font-medium">O.S.</th>
                        <th className="px-2 py-2 font-medium">Data criação</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                        <th className="px-2 py-2 font-medium">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contratosList.map((item) => (
                        <tr key={item.os_id} className="border-b border-slate-100">
                          <td className="px-2 py-2">{item.cliente || '—'}</td>
                          <td className="px-2 py-2">{item.modelos || '—'}</td>
                          <td className="px-2 py-2">#{item.os_id}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-600">
                            {formatOrcamentoCriadoEm(item.created_at)}
                          </td>
                          <td className="px-2 py-2">{labelContratoStatus(item.status)}</td>
                          <td className="px-2 py-2 space-x-2">
                            <a
                              href={`${API_BASE}/contratos/${item.os_id}/preview`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                            >
                              Visualizar
                            </a>
                            <a
                              href={`${API_BASE}/ordens-servico/${item.os_id}/contrato-pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md border border-blue-300 px-2 py-1 text-xs text-blue-800"
                              title="Gerar PDF do contrato"
                            >
                              📄 PDF
                            </a>
                            <button
                              type="button"
                              className="rounded-md border border-amber-300 px-2 py-1 text-xs text-amber-900"
                              onClick={() => reenviarContrato(item)}
                            >
                              Reenviar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {module === 'cadastros' && cadastrosSubView === 'entrada' && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold text-slate-900">{current.label}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Busque cadastros existentes ou abra o formulário para criar um novo registro.
                  </p>
                  <label className="mt-4 block">
                    <span className="mb-1 block text-sm font-medium text-slate-800">Buscar</span>
                    <input
                      type="search"
                      value={cadastroBuscaInput}
                      onChange={(e) => setCadastroBuscaInput(e.target.value)}
                      placeholder="Nome, CPF, CNPJ, e-mail, telefone…"
                      className="w-full max-w-2xl rounded-xl border-2 border-slate-200 px-4 py-3 text-base shadow-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30"
                      autoComplete="off"
                    />
                  </label>
                  <p className="mt-2 max-w-2xl text-xs text-slate-500">
                    {CADASTRO_PAINEL_BUSCA_DICA[tab] || ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                  {tab === 'modelos' && (
                    <button
                      type="button"
                      className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                      onClick={importarModelosDoSite}
                      disabled={importSiteBusy}
                    >
                      {importSiteBusy ? 'A importar…' : 'Importar do site'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="shrink-0 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm"
                    style={{ backgroundColor: BRAND_ORANGE }}
                    onClick={iniciarNovoCadastro}
                  >
                    {CADASTRO_PAINEL_BOTAO_NOVO[tab] || 'Criar novo cadastro'}
                  </button>
                </div>
              </div>
              {cadastroListError ? (
                <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  {cadastroListError}
                </p>
              ) : null}
              {tab === 'modelos' && importSiteMsg ? (
                <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                  {importSiteMsg}
                </p>
              ) : null}
              <h4 className="mb-2 text-sm font-semibold text-slate-800">Últimos cadastros (até 10)</h4>
              {loading ? (
                <p className="text-sm text-slate-500">Carregando...</p>
              ) : cadastrosPainelRows.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {cadastroBuscaInput.trim()
                    ? 'Nenhum resultado para esta busca.'
                    : 'Nenhum cadastro ainda neste módulo.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        {current.columns.map((column) => (
                          <th key={column} className="px-2 py-2 font-medium">
                            {labelForField(column)}
                          </th>
                        ))}
                        <th className="px-2 py-2 font-medium">acao</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cadastrosPainelRows.map((item) => (
                        <tr key={item.id} className="border-b border-slate-100">
                          {current.columns.map((column) => (
                            <td key={column} className="px-2 py-2">
                              {column === 'formas_pagamento'
                                ? normalizeFormasRecebimento(item.formas_pagamento).map(formatFormaResumo).join(' · ')
                                : column === 'telefones'
                                  ? `${normalizeDynamicTextList(item.telefones?.length ? item.telefones : [item.telefone]).filter(Boolean).length} telefone(s)`
                                  : column === 'emails'
                                    ? `${normalizeDynamicTextList(item.emails?.length ? item.emails : [item.email]).filter(Boolean).length} email(s)`
                                    : String(item[column] ?? '')}
                            </td>
                          ))}
                          <td className="px-2 py-2 space-x-2">
                            <a
                              href={`${API_BASE}/${current.endpoint}/${item.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                            >
                              PDF
                            </a>
                            <button
                              type="button"
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                              onClick={() => startEdit(item)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700"
                              onClick={() => handleDelete(item.id)}
                            >
                              Deletar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {module === 'cadastros' && cadastrosSubView === 'formulario' && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setCadastrosSubView('entrada');
                    setEditingId(null);
                    setForm(current.form);
                    setError('');
                  }}
                >
                  ← Voltar ao painel
                </button>
              </div>
            {tab === 'modelos' ? (
              <WebsiteModeloEditorPage
                persistenceMode="crm"
                crmModeloId={editingId}
                mode="create"
                editSlug=""
                editModelId={null}
                canEditSiteActive={authUser?.tipo === 'admin'}
                onBackToList={() => {
                  setCadastrosSubView('entrada');
                  setEditingId(null);
                  setForm(current.form);
                  setError('');
                  (async () => {
                    try {
                      const listRes = await fetchWithTimeout(`${API_BASE}/modelos`);
                      const listRaw = await listRes.text();
                      throwIfHtmlOrCannotPost(listRaw, listRes.status);
                      if (listRes.ok) {
                        const listData = listRaw ? JSON.parse(listRaw) : [];
                        if (Array.isArray(listData)) setItems(listData);
                      }
                    } catch {
                      /* */
                    }
                  })();
                }}
                onCrmSaved={async (row) => {
                  if (row?.id != null) setEditingId(Number(row.id));
                  try {
                    const listRes = await fetchWithTimeout(`${API_BASE}/modelos`);
                    const listRaw = await listRes.text();
                    throwIfHtmlOrCannotPost(listRaw, listRes.status);
                    if (listRes.ok) {
                      const listData = listRaw ? JSON.parse(listRaw) : [];
                      if (Array.isArray(listData)) setItems(listData);
                    }
                  } catch {
                    /* */
                  }
                }}
              />
            ) : (
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-2"
              onSubmit={onSubmit}
              noValidate
            >
              {isBookerTab && (
                <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                  <strong>Teste rápido:</strong> preencha <strong>nome</strong> e <strong>CPF</strong>, depois nas listas
                  <strong> Telefones</strong> e <strong>Emails</strong> pelo menos um número e um email, e clique em{' '}
                  <strong>Salvar cadastro</strong>. Sem terminal do backend a correr, não grava.
                </div>
              )}
              {isModeloTab && (
                <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {idadeModelo === null
                    ? 'Informe a data de nascimento para validação automática de maioridade.'
                    : isMinor
                      ? 'Modelo menor de idade: preencha os dados do responsável.'
                      : `Idade calculada automaticamente: ${idadeModelo} anos.`}
                </div>
              )}
              {Object.entries(current.form).map(([field, initial]) => {
                if ((field === 'telefones' || field === 'emails') && hasDynamicContacts) {
                  return (
                    <DynamicTextListField
                      key={field}
                      label={labelForField(field)}
                      items={normalizeDynamicTextList(form[field])}
                      placeholder={field === 'telefones' ? 'Ex: (11) 99999-9999' : 'Ex: contato@modelo.com'}
                      onAdd={() => addDynamicItem(field)}
                      onUpdate={(index, value) => {
                        if (field === 'telefones' && (isClienteTab || isModeloTab)) {
                          updateDynamicItem(
                            field,
                            index,
                            formatPhoneDisplay(onlyDigits(value)),
                          );
                        } else {
                          updateDynamicItem(field, index, value);
                        }
                      }}
                      onRemove={(index) => removeDynamicItem(field, index)}
                    />
                  );
                }

                if (field === 'formas_pagamento') {
                  return (
                    <div key={field} className="md:col-span-2 rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-700">Formas de recebimento</span>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                          onClick={addFormaPagamento}
                        >
                          + adicionar
                        </button>
                      </div>
                      <p className="mb-3 text-xs text-slate-500">
                        Pix: informe o tipo de chave e o valor (validado). Conta bancária: banco, agência e conta só com
                        números (padrão brasileiro).
                      </p>
                      <div className="space-y-4">
                        {normalizeFormasRecebimento(form.formas_pagamento).map((forma, index) => (
                          <div
                            key={`forma-${index}`}
                            className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                          >
                            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                              <label className="text-xs text-slate-600">
                                <span className="mb-1 block font-medium text-slate-700">Receber via</span>
                                <select
                                  value={forma.tipo}
                                  onChange={(event) => updateFormaPagamento(index, 'tipo', event.target.value)}
                                  className="w-full min-w-[140px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                >
                                  <option value="PIX">PIX</option>
                                  <option value="Conta bancária">Conta bancária</option>
                                </select>
                              </label>
                              <button
                                type="button"
                                className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700"
                                onClick={() => removeFormaPagamento(index)}
                              >
                                Remover
                              </button>
                            </div>

                            {forma.tipo === 'PIX' ? (
                              <div className="grid gap-3 md:grid-cols-[200px_1fr]">
                                <label className="text-xs text-slate-600">
                                  <span className="mb-1 block font-medium text-slate-700">Tipo de chave Pix</span>
                                  <select
                                    value={forma.tipo_chave_pix || 'CPF'}
                                    onChange={(event) =>
                                      updateFormaPagamento(index, 'tipo_chave_pix', event.target.value)
                                    }
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                  >
                                    <option value="CPF">CPF</option>
                                    <option value="CNPJ">CNPJ</option>
                                    <option value="E-mail">E-mail</option>
                                    <option value="Celular">Telefone (celular)</option>
                                    <option value="Aleatória">Chave aleatória (UUID)</option>
                                  </select>
                                </label>
                                <label className="text-xs text-slate-600 md:col-span-1">
                                  <span className="mb-1 block font-medium text-slate-700">Chave Pix</span>
                                  <input
                                    value={forma.chave_pix ?? ''}
                                    onChange={(event) =>
                                      handleFormaChavePixChange(
                                        index,
                                        forma.tipo_chave_pix || 'CPF',
                                        event.target.value,
                                      )
                                    }
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
                                    placeholder={
                                      (forma.tipo_chave_pix || 'CPF') === 'E-mail'
                                        ? 'nome@provedor.com'
                                        : (forma.tipo_chave_pix || 'CPF') === 'Aleatória'
                                          ? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
                                          : (forma.tipo_chave_pix || 'CPF') === 'Celular'
                                            ? '(11) 99999-9999'
                                            : (forma.tipo_chave_pix || 'CPF') === 'CNPJ'
                                              ? '00.000.000/0000-00'
                                              : '000.000.000-00'
                                    }
                                    autoComplete="off"
                                  />
                                </label>
                              </div>
                            ) : (
                              <div className="grid gap-3">
                                <label className="text-xs text-slate-600 md:col-span-2">
                                  <span className="mb-1 block font-medium text-slate-700">Banco (nome ou código FEBRABAN)</span>
                                  <input
                                    value={forma.banco ?? ''}
                                    onChange={(event) => updateFormaPagamento(index, 'banco', event.target.value)}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="Ex: 001 — Banco do Brasil"
                                  />
                                </label>
                                <div className="grid gap-3 md:grid-cols-3">
                                  <label className="text-xs text-slate-600">
                                    <span className="mb-1 block font-medium text-slate-700">Agência (só números)</span>
                                    <input
                                      inputMode="numeric"
                                      value={forma.agencia ?? ''}
                                      onChange={(event) =>
                                        updateFormaPagamento(index, 'agencia', onlyDigits(event.target.value))
                                      }
                                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                      placeholder="Ex: 1234"
                                    />
                                  </label>
                                  <label className="text-xs text-slate-600">
                                    <span className="mb-1 block font-medium text-slate-700">Conta (só números)</span>
                                    <input
                                      inputMode="numeric"
                                      value={forma.conta ?? ''}
                                      onChange={(event) =>
                                        updateFormaPagamento(index, 'conta', onlyDigits(event.target.value))
                                      }
                                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                      placeholder="Ex: 12345"
                                    />
                                  </label>
                                  <label className="text-xs text-slate-600">
                                    <span className="mb-1 block font-medium text-slate-700">Tipo de conta</span>
                                    <select
                                      value={forma.tipo_conta === 'poupanca' ? 'poupanca' : 'corrente'}
                                      onChange={(event) =>
                                        updateFormaPagamento(index, 'tipo_conta', event.target.value)
                                      }
                                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    >
                                      <option value="corrente">Corrente</option>
                                      <option value="poupanca">Poupança</option>
                                    </select>
                                  </label>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }

                if (isModeloTab && (field === 'responsavel_nome' || field === 'responsavel_cpf' || field === 'responsavel_telefone') && !isMinor) {
                  return null;
                }

                if (
                  isModeloTab
                  && [
                    'medida_altura',
                    'medida_busto',
                    'medida_torax',
                    'medida_cintura',
                    'medida_quadril',
                    'medida_sapato',
                    'medida_cabelo',
                    'medida_olhos',
                  ].includes(field)
                ) {
                  const grupo = sexoGrupo(form.sexo);
                  if (grupo === 'feminino' && !medidaCamposFeminino.includes(field)) return null;
                  if (grupo === 'masculino' && !medidaCamposMasculino.includes(field)) return null;
                }

                if (isModeloTab && field === 'origem_cadastro') {
                  return (
                    <label key={field} className="text-sm text-slate-600 md:col-span-2">
                      <span className="mb-1 block">{labelForField(field)}</span>
                      <input
                        value={form.origem_cadastro ?? ''}
                        readOnly
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                      />
                    </label>
                  );
                }

                if (isModeloTab && field === 'status_cadastro') {
                  return (
                    <label key={field} className="text-sm text-slate-600">
                      <span className="mb-1 block">{labelForField(field)}</span>
                      <select
                        value={form.status_cadastro ?? 'aprovado'}
                        onChange={(event) => onChange('status_cadastro', event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="pendente">Pendente</option>
                        <option value="aprovado">Aprovado</option>
                      </select>
                    </label>
                  );
                }

                if (isModeloTab && field === 'foto_perfil_base64') {
                  return (
                    <div key={field} className="text-sm text-slate-600 md:col-span-2">
                      <span className="mb-1 block">{labelForField(field)}</span>
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        {form.foto_perfil_base64 ? (
                          <img
                            src={form.foto_perfil_base64}
                            alt="Foto de perfil"
                            className="mb-3 h-28 w-28 rounded-lg border border-slate-200 object-cover"
                          />
                        ) : (
                          <p className="mb-3 text-xs text-slate-500">Nenhuma foto enviada.</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex cursor-pointer items-center rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700">
                            Escolher foto
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => onChange('foto_perfil_base64', String(reader.result || ''));
                                reader.readAsDataURL(file);
                                event.target.value = '';
                              }}
                            />
                          </label>
                          {form.foto_perfil_base64 ? (
                            <button
                              type="button"
                              className="rounded-md border border-red-300 px-3 py-2 text-xs text-red-700"
                              onClick={() => onChange('foto_perfil_base64', '')}
                            >
                              Remover foto
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (typeof initial === 'boolean') {
                  return (
                    <label key={field} className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(form[field])}
                        onChange={(event) => onChange(field, event.target.checked)}
                      />
                      {labelForField(field)}
                    </label>
                  );
                }

                if (isClienteTab && field === 'tipo_pessoa') {
                  return (
                    <label key={field} className="text-sm text-slate-600">
                      <span className="mb-1 block">{labelForField(field)}</span>
                      <select
                        value={form.tipo_pessoa || 'PJ'}
                        onChange={(event) => {
                          const v = event.target.value;
                          setForm((prev) => {
                            const d = onlyDigits(prev.documento);
                            const nextDoc =
                              v === 'PF' ? formatCpfDisplay(d) : formatCnpjDisplay(d);
                            return { ...prev, tipo_pessoa: v, documento: nextDoc };
                          });
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="PF">PF</option>
                        <option value="PJ">PJ</option>
                      </select>
                    </label>
                  );
                }

                const contractRequiredCliente =
                  isClienteTab
                  && [
                    'documento',
                    'contato_principal',
                    'cep',
                    'logradouro',
                    'numero',
                    'bairro',
                    'cidade',
                    'uf',
                  ].includes(field);
                const useMaskedCadastroInput =
                  (isClienteTab
                    && (field === 'documento' || field === 'documento_representante' || field === 'cep'))
                  || (isBookerTab && field === 'cep')
                  || (isModeloTab
                    && (field === 'cpf' || field === 'responsavel_cpf' || field === 'responsavel_telefone' || field === 'cep'));

                if (isClienteTab && field === 'website') {
                  return (
                    <label key={field} className="text-sm text-slate-600 md:col-span-2">
                      <span className="mb-1 block">{labelForField(field)}</span>
                      <input
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        placeholder="exemplo.com.br"
                        value={form[field] ?? ''}
                        onChange={(event) => onChange(field, event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
                      />
                      <span className="mt-1 block text-xs text-slate-500">Começa com https:// — complete o domínio.</span>
                    </label>
                  );
                }

                if (isClienteTab && field === 'instagram') {
                  return (
                    <label key={field} className="text-sm text-slate-600 md:col-span-2">
                      <span className="mb-1 block">{labelForField(field)}</span>
                      <input
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        placeholder="utilizador ou restante do endereço"
                        value={form[field] ?? ''}
                        onChange={(event) => onChange(field, event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
                      />
                      <span className="mt-1 block text-xs text-slate-500">
                        Pré-preenchido com https://www.instagram.com/ — indique só o utilizador, se preferir.
                      </span>
                    </label>
                  );
                }

                return (
                  <label key={field} className="text-sm text-slate-600">
                    <span className="mb-1 block">
                      {isClienteTab && field === 'documento'
                        ? (form.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ')
                        : isModeloTab && String(field).startsWith('medida_')
                          ? labelMedidaModelo(field, form.sexo) || labelForField(field)
                          : labelForField(field)}
                      {contractRequiredCliente || (isModeloTab && field === 'cpf') ? (
                        <span className="text-red-600"> *</span>
                      ) : null}
                    </span>
                    <input
                      type={field === 'data_nascimento' ? 'date' : 'text'}
                      autoComplete={field === 'data_nascimento' ? 'off' : undefined}
                      value={
                        field === 'data_nascimento' ? toDateInputValue(form[field]) : form[field] ?? ''
                      }
                      onChange={(event) =>
                        useMaskedCadastroInput
                          ? handleMaskedCadastroChange(field, event.target.value)
                          : onChange(field, event.target.value)
                      }
                      onBlur={
                        isClienteTab && field === 'documento' && form.tipo_pessoa === 'PJ'
                          ? buscarDadosEmpresaPorCnpj
                          : (isClienteTab || isModeloTab || isBookerTab) && field === 'cep'
                            ? buscarEnderecoPorCep
                            : undefined
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
                    />
                  </label>
                );
              })}

              {(cadastroListError || error) && (
                <div
                  ref={cadastroErrorRef}
                  className="md:col-span-2 space-y-2"
                  role="alert"
                >
                  {cadastroListError ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      {cadastroListError}
                    </p>
                  ) : null}
                  {error ? (
                    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                      {error}
                    </p>
                  ) : null}
                </div>
              )}
              <div className="md:col-span-2 flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={cadastroSaving}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  {cadastroSaving ? 'Salvando…' : editingId ? 'Atualizar cadastro' : 'Salvar cadastro'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                    onClick={() => {
                      setEditingId(null);
                      setForm(current.form);
                      setCadastrosSubView('entrada');
                    }}
                  >
                    Cancelar edicao
                  </button>
                )}
              </div>
            </form>
            )}
            </section>
          )}

          {module === 'cadastros' && cadastrosSubView === 'formulario' && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">Lista de {current.label.toLowerCase()}</h3>
              <span className="text-xs font-medium text-slate-500">Editar e deletar com um clique</span>
            </div>
            {loading ? (
              <p className="text-sm text-slate-500">Carregando...</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      {current.columns.map((column) => (
                        <th key={column} className="px-2 py-2 font-medium">
                          {labelForField(column)}
                        </th>
                      ))}
                      <th className="px-2 py-2 font-medium">acao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100">
                        {current.columns.map((column) => (
                          <td key={column} className="px-2 py-2">
                            {column === 'formas_pagamento'
                              ? normalizeFormasRecebimento(item.formas_pagamento).map(formatFormaResumo).join(' · ')
                              : column === 'telefones'
                                ? `${normalizeDynamicTextList(item.telefones?.length ? item.telefones : [item.telefone]).filter(Boolean).length} telefone(s)`
                                : column === 'emails'
                                  ? `${normalizeDynamicTextList(item.emails?.length ? item.emails : [item.email]).filter(Boolean).length} email(s)`
                              : String(item[column] ?? '')}
                          </td>
                        ))}
                        <td className="px-2 py-2 space-x-2">
                          <a
                            href={`${API_BASE}/${current.endpoint}/${item.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                          >
                            PDF
                          </a>
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                            onClick={() => startEdit(item)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700"
                            onClick={() => handleDelete(item.id)}
                          >
                            Deletar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {CADASTROS_COM_MULTI_PAGAMENTO.includes(tab) && (
              <p className="mt-3 text-xs text-slate-500">
                Dica: você pode registrar múltiplos telefones, emails e formas de recebimento.
              </p>
            )}
          </section>
          )}

          {module === 'orcamentos' && (
            <>
              {orcamentoError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
                  {orcamentoError}
                </p>
              )}

              {orcamentosSubView === 'gestao' && (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-600">
                      Busque, abra um orçamento ou crie um novo.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm"
                    style={{ backgroundColor: BRAND_ORANGE }}
                    onClick={iniciarNovoOrcamento}
                  >
                    Novo Orçamento
                  </button>
                </div>
                <label className="mb-4 block text-sm text-slate-600">
                  <span className="mb-1 block font-medium">Buscar</span>
                  <input
                    type="search"
                    value={orcamentoBuscaInput}
                    onChange={(event) => setOrcamentoBuscaInput(event.target.value)}
                    placeholder="Cliente, tipo de trabalho ou descrição"
                    className="w-full max-w-xl rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <div className="mb-4">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                    onClick={() => {
                      setOrcamentosListaPage(1);
                      setOrcamentosSubView('lista');
                    }}
                  >
                    Ver todos os orçamentos
                  </button>
                </div>
                {orcamentoLoading ? (
                  <p className="text-sm text-slate-500">Carregando...</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2 font-medium">Cliente</th>
                          <th className="px-2 py-2 font-medium">Tipo</th>
                          <th className="px-2 py-2 font-medium whitespace-nowrap">Criado em</th>
                          <th className="px-2 py-2 font-medium">Cachê base</th>
                          <th className="px-2 py-2 font-medium">Taxa agência</th>
                          <th className="px-2 py-2 font-medium">Status</th>
                          <th className="px-2 py-2 font-medium whitespace-nowrap">O.S. gerada</th>
                          <th className="px-2 py-2 font-medium">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orcamentos.map((item) => (
                          <tr key={item.id} className="border-b border-slate-100">
                            <td className="px-2 py-2">{item.nome_empresa || item.nome_fantasia}</td>
                            <td className="px-2 py-2">{item.tipo_trabalho}</td>
                            <td className="px-2 py-2 whitespace-nowrap text-slate-600">
                              {formatOrcamentoCriadoEm(item.created_at)}
                            </td>
                            <td className="px-2 py-2">R$ {Number(item.cache_base_estimado_total).toFixed(2)}</td>
                            <td className="px-2 py-2">{Number(item.taxa_agencia_percent).toFixed(2)}%</td>
                            <td className="px-2 py-2">{labelOrcamentoStatus(item.status)}</td>
                            <td className="px-2 py-2 whitespace-nowrap text-slate-600">
                              {item.status === 'aprovado' && item.os_id_gerada != null ? (
                                <span title="O.S. gerada a partir deste orçamento">#{item.os_id_gerada}</span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-2 py-2">{renderOrcamentoAcoes(item)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  {orcamentoBuscaDebounced.trim()
                    ? 'Até 25 resultados na busca.'
                    : 'Lista dos 20 orçamentos mais recentes.'}
                </p>
              </section>
              )}

              {orcamentosSubView === 'formulario' && (
              <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="mb-2 flex flex-col gap-2 rounded-lg border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-white p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <button
                      type="button"
                      className="shrink-0 self-start rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700"
                      onClick={voltarParaGestaoOrcamentos}
                    >
                      ← Voltar
                    </button>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {orcamentoEditingId ? `Orçamento #${orcamentoEditingId}` : 'Novo orçamento'}
                      </p>
                      {orcamentoEditingId ? (
                        <p className="mt-0.5 text-sm text-slate-600">
                          {labelOrcamentoStatus(orcamentoEditingStatus)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                    {orcamentoEditingId &&
                      orcamentoEditingStatus === 'rascunho' &&
                      !orcamentoFormLocked && (
                        <button
                          type="button"
                          className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm sm:min-w-[180px]"
                          style={{ backgroundColor: BRAND_ORANGE }}
                          onClick={() => aprovarOrcamento(orcamentoEditingId)}
                        >
                          Aprovar Orçamento
                        </button>
                      )}
                    {orcamentoEditingId &&
                      orcamentoEditingStatus === 'aprovado' &&
                      orcamentoEditingOsId != null && (
                        <button
                          type="button"
                          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 sm:min-w-[180px]"
                          onClick={() => abrirOsGerada(orcamentoEditingOsId)}
                        >
                          Ver O.S. #{orcamentoEditingOsId}
                        </button>
                      )}
                  </div>
                </div>
                <form className="grid grid-cols-1 gap-1.5 md:grid-cols-2 md:gap-x-3 md:gap-y-1.5" onSubmit={saveOrcamento}>
                  {orcamentoFormLocked && (
                    <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      <p className="font-medium">
                        Este orçamento está {labelOrcamentoStatus(orcamentoEditingStatus)} — a edição está bloqueada.
                      </p>
                      {orcamentoEditingStatus === 'aprovado' && orcamentoEditingOsId != null && (
                        <button
                          type="button"
                          className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                          onClick={() => abrirOsGerada(orcamentoEditingOsId)}
                        >
                          Ver O.S. #{orcamentoEditingOsId}
                        </button>
                      )}
                    </div>
                  )}
                  <fieldset
                    disabled={orcamentoFormLocked}
                    className="md:col-span-2 grid min-w-0 grid-cols-1 gap-1.5 border-0 p-0 md:grid-cols-2 [&:disabled]:opacity-60"
                  >
                  <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50/90 p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cliente</p>
                    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end">
                      <label className="min-w-0 flex-1 text-xs text-slate-600 sm:min-w-[220px]">
                        <span className="mb-0.5 block font-medium text-slate-700">Cliente</span>
                        <select
                          required
                          value={orcamentoForm.cliente_id}
                          onChange={(event) => onChangeOrcamento('cliente_id', event.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                        >
                          <option value="">Selecione o cliente</option>
                          {clientesOrcamentoComSelecao(
                            orcamentoForm.cliente_id,
                            clientesOrcamentoFiltrados,
                            clients,
                          ).map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.nome_empresa}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="min-w-0 flex-1 text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Buscar (nome ou CNPJ)</span>
                        <input
                          type="search"
                          value={orcamentoClienteBusca}
                          onChange={(event) => setOrcamentoClienteBusca(event.target.value)}
                          placeholder="Filtra a lista do select"
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                          autoComplete="off"
                        />
                      </label>
                    </div>
                    {orcamentoClienteBusca.trim() && clientesOrcamentoFiltrados.length === 0 ? (
                      <p className="mt-1 text-[11px] text-amber-800">Nenhum cliente corresponde à busca.</p>
                    ) : null}
                  </div>

                  <div
                    className={`md:col-span-2 rounded-lg border border-slate-200 bg-white p-2 ${!orcamentoForm.cliente_id ? 'pointer-events-none opacity-50' : ''}`}
                  >
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Modelos</p>
                    <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-800">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={Boolean(orcamentoForm.job_sem_modelos)}
                        disabled={orcamentoFormLocked}
                        onChange={(event) => onChangeOrcamentoJobSemModelos(event.target.checked)}
                      />
                      <span>
                        <span className="font-medium">JOB sem modelos</span>
                        <span className="mt-0.5 block text-[11px] font-normal text-slate-600">
                          Marque se o trabalho não inclui modelos (aprovação sem linhas). Desmarque para exigir pelo
                          menos um modelo do cadastro.
                        </span>
                      </span>
                    </label>
                    {(orcamentoForm.linhas || []).length === 0 && !orcamentoForm.job_sem_modelos ? (
                      <p className="mb-2 text-[11px] text-slate-500">
                        Adicione modelo(s) do cadastro ou marque “JOB sem modelos” acima. Sem linhas, use o cachê
                        manual em Valores.
                      </p>
                    ) : null}
                    <div
                      className={`space-y-1 ${orcamentoForm.job_sem_modelos ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      {(orcamentoForm.linhas || []).map((line, index) => {
                        const qLinha = String(orcamentoModeloBuscaPorLinha[index] ?? '')
                          .trim()
                          .toLowerCase();
                        const modelosFiltradosLinha =
                          !qLinha
                            ? modelosParaSelecao
                            : modelosParaSelecao.filter((m) =>
                                String(m.nome || '')
                                  .toLowerCase()
                                  .includes(qLinha),
                              );
                        return (
                          <div
                            key={line.id ?? `ol-${index}`}
                            className="flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50/60 p-1.5 sm:flex-row sm:flex-wrap sm:items-end"
                          >
                            <div className="flex min-w-0 flex-1 gap-1 sm:min-w-[200px]">
                              <select
                                value={line.modelo_id ?? ''}
                                onChange={(event) =>
                                  updateOrcamentoLinha(index, {
                                    modelo_id: event.target.value ? Number(event.target.value) : '',
                                    origemCadastro: true,
                                  })}
                                className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                              >
                                <option value="">Modelo…</option>
                                {modelosOrcamentoComSelecao(
                                  line,
                                  modelosFiltradosLinha,
                                  modelosParaSelecao,
                                ).map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.nome}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="search"
                                value={orcamentoModeloBuscaPorLinha[index] ?? ''}
                                onChange={(event) => {
                                  const v = event.target.value;
                                  setOrcamentoModeloBuscaPorLinha((prev) => {
                                    const next = [...prev];
                                    next[index] = v;
                                    return next;
                                  });
                                }}
                                placeholder="Filtrar…"
                                className="w-[6.5rem] shrink-0 rounded border border-slate-300 px-1.5 py-1 text-xs"
                                autoComplete="off"
                                title="Filtra as opções do select ao lado"
                              />
                            </div>
                            <label className="min-w-[6.5rem] shrink-0 sm:w-[7.5rem]">
                              <span className="mb-0.5 block text-[10px] font-medium text-slate-500">Cachê R$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0,00"
                                value={line.cache_modelo ?? ''}
                                onChange={(event) =>
                                  updateOrcamentoLinha(index, { cache_modelo: event.target.value })}
                                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            </label>
                            <label className="flex items-center gap-1 text-[10px] text-slate-700 sm:ml-1">
                              <input
                                type="checkbox"
                                checked={Boolean(line.emite_nf_propria)}
                                onChange={(event) =>
                                  updateOrcamentoLinha(index, { emite_nf_propria: event.target.checked })}
                              />
                              NF própria
                            </label>
                            <button
                              type="button"
                              className="text-[11px] text-red-700 sm:ml-auto"
                              onClick={() => removeOrcamentoLinha(index)}
                            >
                              remover
                            </button>
                            {qLinha && modelosFiltradosLinha.length === 0 ? (
                              <p className="w-full text-[10px] text-amber-800">Nenhum modelo neste filtro.</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2">
                      <button
                        type="button"
                        disabled={orcamentoForm.job_sem_modelos}
                        className="rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ backgroundColor: BRAND_ORANGE }}
                        onClick={addOrcamentoLinhaCadastro}
                      >
                        + adicionar modelo
                      </button>
                    </div>
                  </div>

                  <label
                    className={`text-xs text-slate-600 md:col-span-2 ${!orcamentoForm.cliente_id ? 'opacity-50' : ''}`}
                  >
                    <span className="mb-0.5 block font-medium text-slate-700">Tipo de trabalho (obrigatório)</span>
                    <input
                      required
                      value={orcamentoForm.tipo_trabalho}
                      onChange={(event) => onChangeOrcamento('tipo_trabalho', event.target.value)}
                      disabled={!orcamentoForm.cliente_id}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                    />
                  </label>

                  <div className="md:col-span-2 rounded-lg border border-slate-200 bg-white p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Descrição e agenda
                    </p>
                    <label className="mb-1.5 block text-xs text-slate-600">
                      <span className="mb-0.5 block font-medium text-slate-700">Descrição do trabalho</span>
                      <input
                        value={orcamentoForm.descricao}
                        onChange={(event) => onChangeOrcamento('descricao', event.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Data</span>
                        <input
                          type="date"
                          autoComplete="off"
                          value={toDateInputValue(orcamentoForm.data_trabalho)}
                          onChange={(event) => onChangeOrcamento('data_trabalho', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Horário</span>
                        <input
                          type="time"
                          autoComplete="off"
                          value={toTimeInputValue(orcamentoForm.horario_trabalho)}
                          onChange={(event) => onChangeOrcamento('horario_trabalho', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          Intervalo (ex.: 9h–18h) pode ir na descrição do trabalho.
                        </span>
                      </label>
                      <label className="text-xs text-slate-600 sm:col-span-2 lg:col-span-2">
                        <span className="mb-0.5 block font-medium text-slate-700">Local</span>
                        <input
                          value={orcamentoForm.local_trabalho}
                          onChange={(event) => onChangeOrcamento('local_trabalho', event.target.value)}
                          placeholder="Estúdio / endereço"
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="md:col-span-2 rounded-lg border border-slate-200 bg-white p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Uso de imagem
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Mídias</span>
                        <input
                          value={orcamentoForm.uso_imagem}
                          onChange={(event) => onChangeOrcamento('uso_imagem', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Tempo de uso</span>
                        <input
                          value={orcamentoForm.prazo}
                          onChange={(event) => onChangeOrcamento('prazo', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Território</span>
                        <input
                          value={orcamentoForm.territorio}
                          onChange={(event) => onChangeOrcamento('territorio', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="md:col-span-2 rounded-lg border border-slate-300 bg-slate-50/90 p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      Valores — fechamento ao cliente
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">
                          Cachê dos modelos (R$)
                          {orcamentoCacheModelosAutomatico ? ' · soma automática' : ' · total manual'}
                        </span>
                        {orcamentoCacheModelosAutomatico ? (
                          <input
                            type="text"
                            readOnly
                            disabled
                            tabIndex={-1}
                            aria-readonly="true"
                            value={String(orcamentoTotalCacheModelosSomado)}
                            className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-sm text-slate-800"
                          />
                        ) : (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={
                              orcamentoForm.valor_servico_sem_modelo !== '' &&
                              orcamentoForm.valor_servico_sem_modelo != null
                                ? orcamentoForm.valor_servico_sem_modelo
                                : orcamentoForm.cache_base_estimado_total
                            }
                            onChange={(event) => onChangeOrcamentoValorManualSemModelos(event.target.value)}
                            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                          />
                        )}
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Taxa da agência (%)</span>
                        <input
                          type="number"
                          value={orcamentoForm.taxa_agencia_percent}
                          onChange={(event) => onChangeOrcamento('taxa_agencia_percent', event.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                        />
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          ≈ {formatBRL(orcamentoFinanceiroPreview.taxa_agencia_valor)}
                        </span>
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Extras (R$)</span>
                        <input
                          type="number"
                          value={orcamentoForm.extras_agencia_valor}
                          onChange={(event) => onChangeOrcamento('extras_agencia_valor', event.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Imposto (%)</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={orcamentoForm.imposto_percent}
                          onChange={(event) => onChangeOrcamento('imposto_percent', event.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                          placeholder="10"
                        />
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          ≈ {formatBRL(orcamentoFinanceiroPreview.impostoValor)} sobre a base (antes do imposto)
                        </span>
                      </label>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 rounded-md border-2 border-amber-300/90 bg-amber-50/90 px-2.5 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-950/90">
                          Valor total do trabalho
                        </p>
                        <p className="text-[10px] text-slate-600">Proposta ao cliente e valor da nota.</p>
                      </div>
                      <p className="text-lg font-bold tabular-nums text-slate-900 sm:text-xl">
                        {formatBRL(orcamentoFinanceiroPreview.totalCliente)}
                      </p>
                    </div>
                  </div>

                  <div className="md:col-span-2 rounded-lg border border-slate-200 bg-white p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Condições de pagamento
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <label className="text-xs text-slate-600 sm:col-span-2">
                        <span className="mb-0.5 block font-medium text-slate-700">Condições de pagamento</span>
                        <input
                          value={orcamentoForm.condicoes_pagamento}
                          onChange={(event) => onChangeOrcamento('condicoes_pagamento', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Data de vencimento</span>
                        <input
                          type="date"
                          autoComplete="off"
                          value={toDateInputValue(orcamentoForm.data_vencimento)}
                          onChange={(event) => onChangeOrcamento('data_vencimento', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="md:col-span-2 rounded-lg border border-slate-200 bg-white p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Parceiros e booker
                    </p>
                    <p className="mb-1.5 text-[10px] leading-snug text-slate-500">
                      Percentuais sobre a margem da agência (após modelo e imposto), como na O.S.
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Parceiro / fornecedor</span>
                        <select
                          value={orcamentoForm.parceiro_id !== '' && orcamentoForm.parceiro_id != null ? String(orcamentoForm.parceiro_id) : ''}
                          onChange={(event) => onChangeOrcamento('parceiro_id', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        >
                          <option value="">Nenhum</option>
                          {parceirosList.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.razao_social_ou_nome}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Parceiro (% sobre margem)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={orcamentoForm.parceiro_percent ?? ''}
                          onChange={(event) => onChangeOrcamento('parceiro_percent', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">Booker</span>
                        <select
                          value={orcamentoForm.booker_id !== '' && orcamentoForm.booker_id != null ? String(orcamentoForm.booker_id) : ''}
                          onChange={(event) => onChangeOrcamento('booker_id', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        >
                          <option value="">Nenhum</option>
                          {bookersList.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.nome}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-0.5 block font-medium text-slate-700">
                          Booker (% sobre margem após parceiro)
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          value={orcamentoForm.booker_percent ?? ''}
                          onChange={(event) => onChangeOrcamento('booker_percent', event.target.value)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <p className="mt-1.5 text-[10px] leading-snug text-slate-600">
                      Estimativa interna: parceiro {formatBRL(orcamentoFinanceiroPreview.parceiroValor)} · booker{' '}
                      {formatBRL(orcamentoFinanceiroPreview.bookerValor)} · resultado agência{' '}
                      {formatBRL(orcamentoFinanceiroPreview.resultadoAgencia)}
                    </p>
                  </div>
                  </fieldset>
                  <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                    {!orcamentoFormLocked && (
                      <button type="submit" className="rounded-xl px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: BRAND_ORANGE }}>
                        {orcamentoEditingId ? 'Atualizar orçamento' : 'Salvar orçamento'}
                      </button>
                    )}
                    {orcamentoEditingId && (
                      <a
                        href={`${API_BASE}/orcamentos/${orcamentoEditingId}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium text-white no-underline"
                        style={{ backgroundColor: BRAND_ORANGE }}
                      >
                        Gerar PDF
                      </a>
                    )}
                    {orcamentoEditingId && (
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                        onClick={voltarParaGestaoOrcamentos}
                      >
                        {orcamentoFormLocked ? 'Fechar' : 'Cancelar edição'}
                      </button>
                    )}
                    {orcamentoEditingId && (
                      <button
                        type="button"
                        className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800"
                        title="Remove este orçamento e a O.S. gerada (irreversível)"
                        onClick={() =>
                          excluirOrcamentoDefinitivo({
                            id: orcamentoEditingId,
                            os_id_gerada: orcamentoEditingOsId,
                          })}
                      >
                        Excluir definitivo (admin)
                      </button>
                    )}
                  </div>
                  {orcamentoEditingId && (
                    <p className="md:col-span-2 text-[11px] leading-snug text-slate-500">
                      PDF ao cliente: A4, marca no topo, cliente, descrição, nomes dos modelos e valor total — sem
                      comissões ou divisão interna.
                    </p>
                  )}
                </form>
              </section>
              )}

              {orcamentosSubView === 'lista' && (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                      onClick={() => setOrcamentosSubView('gestao')}
                    >
                      ← Voltar à gestão
                    </button>
                    <h3 className="text-base font-semibold">Todos os orçamentos</h3>
                  </div>
                  <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block font-medium">Status</span>
                      <select
                        value={orcamentosListaStatus}
                        onChange={(event) => setOrcamentosListaStatus(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="">Todos</option>
                        <option value="rascunho">Rascunho</option>
                        <option value="aprovado">Aprovado</option>
                        <option value="cancelado">Cancelado</option>
                      </select>
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block font-medium">Cliente</span>
                      <select
                        value={orcamentosListaClienteId}
                        onChange={(event) => setOrcamentosListaClienteId(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="">Todos</option>
                        {clients.map((client) => (
                          <option key={client.id} value={String(client.id)}>
                            {client.nome_empresa}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block font-medium">Ordenar por data de criação</span>
                      <select
                        value={orcamentosListaSort}
                        onChange={(event) => setOrcamentosListaSort(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="created_at_desc">Mais recente primeiro</option>
                        <option value="created_at_asc">Mais antigo primeiro</option>
                      </select>
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block font-medium">Itens por página</span>
                      <select
                        value={String(orcamentosListaPageSize)}
                        onChange={(event) => setOrcamentosListaPageSize(Number(event.target.value))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="10">10</option>
                        <option value="20">20</option>
                      </select>
                    </label>
                  </div>
                  {orcamentoLoading ? (
                    <p className="text-sm text-slate-500">Carregando...</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-left text-slate-500">
                              <th className="px-2 py-2 font-medium">#</th>
                              <th className="px-2 py-2 font-medium">Cliente</th>
                              <th className="px-2 py-2 font-medium">Tipo</th>
                              <th className="px-2 py-2 font-medium whitespace-nowrap">Criado em</th>
                              <th className="px-2 py-2 font-medium">Cachê base</th>
                              <th className="px-2 py-2 font-medium">Taxa agência</th>
                              <th className="px-2 py-2 font-medium">Status</th>
                              <th className="px-2 py-2 font-medium whitespace-nowrap">O.S. gerada</th>
                              <th className="px-2 py-2 font-medium">Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orcamentos.map((item) => (
                              <tr key={item.id} className="border-b border-slate-100">
                                <td className="px-2 py-2 font-medium text-slate-600">#{item.id}</td>
                                <td className="px-2 py-2">{item.nome_empresa || item.nome_fantasia}</td>
                                <td className="px-2 py-2">{item.tipo_trabalho}</td>
                                <td className="px-2 py-2 whitespace-nowrap text-slate-600">
                                  {formatOrcamentoCriadoEm(item.created_at)}
                                </td>
                                <td className="px-2 py-2">R$ {Number(item.cache_base_estimado_total).toFixed(2)}</td>
                                <td className="px-2 py-2">{Number(item.taxa_agencia_percent).toFixed(2)}%</td>
                                <td className="px-2 py-2">{labelOrcamentoStatus(item.status)}</td>
                                <td className="px-2 py-2 whitespace-nowrap text-slate-600">
                                  {item.status === 'aprovado' && item.os_id_gerada != null ? (
                                    <span title="O.S. gerada a partir deste orçamento">#{item.os_id_gerada}</span>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="px-2 py-2">{renderOrcamentoAcoes(item)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {(() => {
                        const totalPages = Math.max(
                          1,
                          Math.ceil(orcamentosTotal / orcamentosListaPageSize) || 1,
                        );
                        const from =
                          orcamentosTotal === 0
                            ? 0
                            : (orcamentosListaPage - 1) * orcamentosListaPageSize + 1;
                        const to = Math.min(
                          orcamentosListaPage * orcamentosListaPageSize,
                          orcamentosTotal,
                        );
                        return (
                          <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                            <p>
                              {orcamentosTotal === 0
                                ? 'Nenhum registro nesta página.'
                                : `Mostrando ${from}–${to} de ${orcamentosTotal}`}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                                disabled={orcamentosListaPage <= 1 || orcamentoLoading}
                                onClick={() => setOrcamentosListaPage((p) => Math.max(1, p - 1))}
                              >
                                Anterior
                              </button>
                              <span className="text-xs">
                                Página {orcamentosListaPage} de {totalPages}
                              </span>
                              <button
                                type="button"
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                                disabled={
                                  orcamentosListaPage >= totalPages || orcamentoLoading || orcamentosTotal === 0
                                }
                                onClick={() =>
                                  setOrcamentosListaPage((p) => Math.min(totalPages, p + 1))
                                }
                              >
                                Próxima
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </section>
              )}
            </>
          )}

          {module === 'jobs' && (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">Ordens de serviço</h3>
                  <span className="text-xs text-slate-500">
                    Reflexo do orçamento aprovado — valores não são editados aqui
                  </span>
                </div>
                {osLoading ? (
                  <p className="text-sm text-slate-500">Carregando...</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2 font-medium whitespace-nowrap">O.S.</th>
                          <th className="px-2 py-2 font-medium">Cliente</th>
                          <th className="px-2 py-2 font-medium">Descrição</th>
                          <th className="px-2 py-2 font-medium whitespace-nowrap">Valor total</th>
                          <th className="px-2 py-2 font-medium">Status</th>
                          <th className="px-2 py-2 font-medium">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {osList.map((row) => {
                          const desc = String(row.descricao || '');
                          const descShort = desc.length > 72 ? `${desc.slice(0, 72)}…` : desc;
                          const st = String(row.status || '').toLowerCase();
                          const podeCancelar = st === 'ativa' || st === 'aberta';
                          return (
                            <tr key={row.id} className="border-b border-slate-100">
                              <td className="px-2 py-2 font-medium whitespace-nowrap">#{row.id}</td>
                              <td className="px-2 py-2">{row.nome_empresa || row.nome_fantasia}</td>
                              <td className="max-w-[220px] px-2 py-2 text-slate-700 sm:max-w-md" title={desc}>
                                {descShort || '—'}
                              </td>
                              <td className="px-2 py-2 whitespace-nowrap">{formatBRL(row.total_cliente)}</td>
                              <td className="px-2 py-2">{labelOsStatus(row.status)}</td>
                              <td className="px-2 py-2">
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                                    onClick={() => loadOsDetail(row.id)}
                                  >
                                    Visualizar
                                  </button>
                                  <a
                                    href={`${API_BASE}/ordens-servico/${row.id}/pdf`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700"
                                  >
                                    PDF
                                  </a>
                                  {podeCancelar && (
                                    <button
                                      type="button"
                                      className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-800"
                                      title="Admin: só com zero recebimentos e zero pagamentos a modelos"
                                      onClick={() => cancelarOs(row.id)}
                                    >
                                      Cancelar O.S.
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {osError && !osDraft && <p className="mt-3 text-sm font-medium text-red-600">{osError}</p>}
              </section>

              {osDraft && (() => {
                const stOs = String(osDraft.status || '').toLowerCase();
                const osOperacional = stOs !== 'cancelada';
                return (
                <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold">O.S. #{osDraft.id}</h3>
                      <p className="text-xs text-slate-500">
                        Orçamento #{osDraft.orcamento_numero ?? osDraft.orcamento_id} · Status:{' '}
                        <strong>{labelOsStatus(osDraft.status)}</strong>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`${API_BASE}/ordens-servico/${osDraft.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-800"
                      >
                        PDF da O.S.
                      </a>
                      {(stOs === 'ativa' || stOs === 'aberta') && (
                        <button
                          type="button"
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-sm font-medium text-red-800"
                          onClick={() => cancelarOs(osDraft.id)}
                        >
                          Cancelar O.S.
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
                        onClick={() => setOsDraft(null)}
                      >
                        Fechar
                      </button>
                    </div>
                  </div>

                  <p className="mb-3 text-sm text-slate-600">
                    <span className="font-medium">Cliente:</span>{' '}
                    {osDraft.nome_empresa || osDraft.nome_fantasia}
                  </p>

                  <div className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm md:grid-cols-2">
                    <div className="md:col-span-2">
                      <p className="text-xs font-medium text-slate-500">Descrição do trabalho</p>
                      <p className="text-slate-800">{osDraft.descricao || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500">Tipo de trabalho</p>
                      <p className="text-slate-800">{osDraft.tipo_trabalho || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500">Tipo O.S.</p>
                      <p className="text-slate-800">{osDraft.tipo_os === 'sem_modelo' ? 'Sem modelo' : 'Com modelo'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500">Data do trabalho</p>
                      <p className="text-slate-800">
                        {osDraft.data_trabalho ? String(osDraft.data_trabalho).slice(0, 10) : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500">Vencimento (cliente)</p>
                      <p className="text-slate-800">
                        {osDraft.data_vencimento_cliente
                          ? String(osDraft.data_vencimento_cliente).slice(0, 10)
                          : '—'}
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs font-medium text-slate-500">Uso de imagem / prazo / território</p>
                      <p className="text-slate-800">
                        {[osDraft.uso_imagem, osDraft.prazo, osDraft.territorio].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs font-medium text-slate-500">Condições de pagamento</p>
                      <p className="text-slate-800">{osDraft.condicoes_pagamento || '—'}</p>
                    </div>
                  </div>

                  {osDraft.tipo_os === 'com_modelo' && (osDraft.linhas || []).length > 0 && (
                    <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                            <th className="px-2 py-2">Modelo</th>
                            <th className="px-2 py-2">Cachê R$</th>
                            <th className="px-2 py-2">NF própria</th>
                            <th className="px-2 py-2">Prev. pagamento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(osDraft.linhas || []).map((line) => (
                            <tr key={line.id} className="border-b border-slate-100">
                              <td className="px-2 py-2">{line.modelo_nome || line.rotulo || '—'}</td>
                              <td className="px-2 py-2">{formatBRL(line.cache_modelo)}</td>
                              <td className="px-2 py-2">{line.emite_nf_propria ? 'Sim' : 'Não'}</td>
                              <td className="px-2 py-2">
                                {line.data_prevista_pagamento
                                  ? String(line.data_prevista_pagamento).slice(0, 10)
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {osDraft.tipo_os === 'sem_modelo' && (
                    <p className="mb-4 text-sm text-slate-600">
                      <span className="font-medium">Valor serviço (sem modelo):</span>{' '}
                      {formatBRL(osDraft.valor_servico)}
                    </p>
                  )}

                  <div className="mb-4 rounded-lg border-2 border-amber-200 bg-amber-50/90 p-3">
                    <p className="text-xs font-medium text-amber-950">Total ao cliente</p>
                    <p className="text-xl font-bold text-slate-900">{formatBRL(osDraft.total_cliente)}</p>
                  </div>

                  <div className="mb-4 grid gap-2 rounded-lg border border-amber-200/80 bg-amber-50/50 p-3 text-sm md:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <p className="text-xs text-slate-500">Taxa agência (R$)</p>
                      <p className="font-semibold">{formatBRL(osDraft.taxa_agencia_valor)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Imposto</p>
                      <p className="font-semibold">{formatBRL(osDraft.imposto_valor)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Líquido modelos</p>
                      <p className="font-semibold">{formatBRL(osDraft.modelo_liquido_total)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Resultado agência</p>
                      <p className="font-semibold">{formatBRL(osDraft.resultado_agencia)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Parceiro / booker (R$)</p>
                      <p className="font-semibold">
                        {formatBRL(osDraft.parceiro_valor)} / {formatBRL(osDraft.booker_valor)}
                      </p>
                    </div>
                  </div>

                  {osDraft.emitir_contrato && osOperacional && (
                    <div className="mb-4 rounded-lg border border-slate-200 p-3">
                      <h4 className="text-sm font-semibold text-slate-800">Contrato com cliente</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Status: <strong>{labelContratoStatus(osDraft.contrato_status)}</strong>
                        {osDraft.contrato_assinado_em && (
                          <span className="ml-2">
                            — assinado em {String(osDraft.contrato_assinado_em).slice(0, 10)}
                          </span>
                        )}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <a
                          href={`${API_BASE}/ordens-servico/${osDraft.id}/contrato-preview`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-800"
                        >
                          Pré-visualizar HTML
                        </a>
                        <a
                          href={`${API_BASE}/ordens-servico/${osDraft.id}/contrato-pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-800"
                        >
                          PDF contrato
                        </a>
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                        <label className="flex-1 text-xs text-slate-600">
                          <span className="mb-0.5 block font-medium">E-mail destino</span>
                          <input
                            type="email"
                            value={contratoEmailDest}
                            onChange={(e) => setContratoEmailDest(e.target.value)}
                            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                            disabled={contratoEmailLoading}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={contratoEmailLoading}
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                          style={{ backgroundColor: BRAND_ORANGE }}
                          onClick={enviarContratoPorEmail}
                        >
                          {contratoEmailLoading ? 'Enviando...' : 'Enviar contrato por e-mail'}
                        </button>
                      </div>
                      {contratoEmailMsg && (
                        <p
                          className={`mt-2 text-xs ${contratoEmailMsg.includes('sucesso') ? 'text-emerald-700' : 'text-red-600'}`}
                        >
                          {contratoEmailMsg}
                        </p>
                      )}
                      {contratoEmailFallbackLink && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                            onClick={copiarLinkAssinatura}
                          >
                            Copiar link de assinatura
                          </button>
                          <a
                            href={contratoEmailFallbackLink}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                          >
                            Abrir link
                          </a>
                        </div>
                      )}
                      {contratoHtmlFallbackUrl && (
                        <a
                          href={contratoHtmlFallbackUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block rounded-md border border-slate-300 px-2 py-1 text-xs"
                        >
                          Baixar HTML (fallback)
                        </a>
                      )}
                    </div>
                  )}

                  <div className="mb-4 rounded-lg border border-slate-200 p-3">
                    <h4 className="text-sm font-semibold text-slate-800">Documentos</h4>
                    <ul className="mt-2 space-y-2 text-sm">
                      {(osDraft.documentos || []).length === 0 ? (
                        <li className="text-slate-500">Nenhum arquivo.</li>
                      ) : (
                        (osDraft.documentos || []).map((d) => (
                          <li
                            key={d.id}
                            className="flex flex-wrap items-center gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1.5"
                          >
                            <span className="text-xs uppercase text-slate-500">{d.tipo}</span>
                            <span className="flex-1 truncate text-xs">{d.nome_arquivo}</span>
                            <a
                              href={`${API_BASE}/ordens-servico/${osDraft.id}/documentos/${d.id}/download`}
                              className="text-xs text-amber-800 underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              Baixar
                            </a>
                            {osOperacional && (
                              <button
                                type="button"
                                className="text-xs text-red-700"
                                onClick={() => deleteOsDocumento(d.id)}
                              >
                                Remover
                              </button>
                            )}
                          </li>
                        ))
                      )}
                    </ul>
                    {osOperacional && (
                      <label className="mt-2 block text-xs text-slate-600">
                        <span className="mb-1 block font-medium">Enviar contrato assinado (PDF ou imagem)</span>
                        <input
                          type="file"
                          accept=".pdf,image/*"
                          className="text-sm"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadOsDocumento(f, 'contrato_assinado_scan');
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>

                  {(osDraft.historico || []).length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <h4 className="text-sm font-semibold text-slate-800">Histórico (legado)</h4>
                      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-slate-600">
                        {(osDraft.historico || []).map((h) => (
                          <li key={h.id}>
                            {h.campo} — {h.usuario} — {String(h.created_at || '').slice(0, 19).replace('T', ' ')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {osError && <p className="mt-3 text-sm font-medium text-red-600">{osError}</p>}
                </section>
                );
              })()}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
