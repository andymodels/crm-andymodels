import { useEffect, useMemo, useRef, useState } from 'react';
import DynamicTextListField from './components/DynamicTextListField';
import OperacaoCalendar from './components/OperacaoCalendar';
import { sanitizeAndValidateCliente, sanitizeAndValidateModelo, onlyDigits } from './utils/brValidators';
import { sanitizeAndValidateFormasPagamentoArray } from './utils/formasPagamento';
import { formatCpfDisplay, formatCnpjDisplay, formatCepDisplay, formatPhoneDisplay } from './utils/brMasks';

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

const labelContratoStatus = (s) => {
  if (s === 'aguardando_assinatura') return 'Aguardando assinatura';
  if (s === 'assinado') return 'Assinado';
  if (s === 'cancelado') return 'Cancelado';
  return s ? String(s) : '—';
};

const nPrev = (v) => Number(v || 0);

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
    uso_imagem: '',
    prazo: '',
    territorio: '',
    quantidade_modelos_referencia: '',
    linhas: [],
  };
}

/** Espelha `computeOsFinancials` do backend para exibir % taxa / NF e valores em R$ no formulário. */
function previewOrcamentoFinanceiro(form) {
  const tipo = form.tipo_proposta_os === 'sem_modelo' ? 'sem_modelo' : 'com_modelo';
  const impPct = nPrev(form.imposto_percent ?? 10);
  const feePct = nPrev(form.taxa_agencia_percent);
  const extrasAg = nPrev(form.extras_agencia_valor);
  const linhas = (form.linhas || [])
    .filter((l) => {
      const mid = l.modelo_id !== '' && l.modelo_id != null ? Number(l.modelo_id) : NaN;
      return Number.isFinite(mid) && mid > 0;
    })
    .map((l) => ({
      cache_modelo: nPrev(l.cache_modelo),
      emite_nf_propria: Boolean(l.emite_nf_propria),
    }));

  if (tipo === 'sem_modelo') {
    const vs = nPrev(form.valor_servico_sem_modelo);
    const subtotal = vs + extrasAg;
    const impostoValor = subtotal * (impPct / 100);
    const totalCliente = subtotal + impostoValor;
    return { totalCliente, subtotal, taxa_agencia_valor: 0, impostoValor };
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
  return { totalCliente, subtotal, taxa_agencia_valor: taxaAgenciaValor, impostoValor };
}

const CADASTROS_COM_MULTI_PAGAMENTO = ['modelos', 'bookers', 'parceiros'];
const BRAND_ORANGE = '#F59E0B';
/** Menu principal: ativo — laranja marca; inativo — neutro com bom contraste */
const navMainBtn = (active) =>
  active
    ? 'bg-[#F59E0B] text-white shadow-sm ring-1 ring-amber-500/40'
    : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800';
/** Submenu Cadastros: só o item ativo em destaque (âmbar suave); resto neutro */
const navSubBtn = (active) =>
  active
    ? 'border border-amber-300 bg-amber-100 font-semibold text-amber-950 shadow-sm ring-1 ring-amber-400/30'
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
  medida_altura: 'Altura',
  medida_busto: 'Busto',
  medida_torax: 'Torax',
  medida_cintura: 'Cintura',
  medida_quadril: 'Quadril',
  medida_sapato: 'Sapato',
  medida_cabelo: 'Cabelo',
  medida_olhos: 'Olhos',
  foto_perfil_base64: 'Foto de perfil',
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
      website: '',
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
      nome: '',
      cpf: '',
      rg: '',
      passaporte: '',
      sexo: '',
      data_nascimento: '',
      telefones: [''],
      emails: [''],
      foto_perfil_base64: '',
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

function App({ authUser, onLogout = () => {} }) {
  const [module, setModule] = useState('inicio');
  const [cadastrosMenuOpen, setCadastrosMenuOpen] = useState(false);
  const [tab, setTab] = useState('clientes');
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(cadastroConfig.bookers.form);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  /** Erros do formulário (validação, salvar, apagar). */
  const [error, setError] = useState('');
  /** Erro ao carregar a lista (GET); separado para não apagar mensagens do formulário quando o GET termina depois. */
  const [cadastroListError, setCadastroListError] = useState('');
  const [cadastroSaving, setCadastroSaving] = useState(false);
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
  const [contratosList, setContratosList] = useState([]);
  const [contratosLoading, setContratosLoading] = useState(false);
  const [contratosError, setContratosError] = useState('');

  const [osList, setOsList] = useState([]);
  const [osLoading, setOsLoading] = useState(false);
  const [osError, setOsError] = useState('');
  const [osSaving, setOsSaving] = useState(false);
  const [osDraft, setOsDraft] = useState(null);
  const [osUsuarioAlteracao, setOsUsuarioAlteracao] = useState('');
  const [modelosList, setModelosList] = useState([]);
  const modelosParaSelecao = useMemo(
    () => modelosList.filter((m) => Boolean(m.ativo)),
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
  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova, setSenhaNova] = useState('');
  const [senhaMsg, setSenhaMsg] = useState('');
  const [senhaLoading, setSenhaLoading] = useState(false);

  const [linkCadastroUrl, setLinkCadastroUrl] = useState('');
  const [linkCadastroMsg, setLinkCadastroMsg] = useState('');
  const [linkCadastroLoading, setLinkCadastroLoading] = useState(false);

  const [finResumo, setFinResumo] = useState(null);
  const [finRecebimentos, setFinRecebimentos] = useState([]);
  const [finOsOptions, setFinOsOptions] = useState([]);
  const [finLoading, setFinLoading] = useState(false);
  const [finError, setFinError] = useState('');
  const [finForm, setFinForm] = useState({
    os_id: '',
    valor: '',
    data_recebimento: '',
    observacao: '',
  });
  /** Contexto da O.S. selecionada no recebimento (espelha o job, sem redigitar total). */
  const [finOsContexto, setFinOsContexto] = useState(null);

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

  const [extratoRows, setExtratoRows] = useState([]);
  const [extratoLoading, setExtratoLoading] = useState(false);
  const [extratoError, setExtratoError] = useState('');
  const [extratoModeloFilter, setExtratoModeloFilter] = useState('');
  const [pagamentoForm, setPagamentoForm] = useState({
    os_modelo_id: '',
    valor: '',
    data_pagamento: '',
    observacao: '',
  });

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

  useEffect(() => {
    if (module === 'cadastros') setCadastrosMenuOpen(true);
  }, [module]);
  const saldoAbertoClienteDashboard = useMemo(
    () =>
      (alertasOperacionais?.contas_receber ?? []).reduce(
        (acc, row) => acc + Number(row.saldo ?? 0),
        0,
      ),
    [alertasOperacionais],
  );

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
    if (!finForm.os_id) {
      setFinOsContexto(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/financeiro/os/${finForm.os_id}/contexto`);
        if (!r.ok) {
          if (!cancelled) setFinOsContexto(null);
          return;
        }
        const c = await r.json();
        if (cancelled) return;
        setFinOsContexto(c);
        setFinForm((prev) => ({
          ...prev,
          valor:
            c.saldo_receber > 0.005 ? String(Number(c.saldo_receber).toFixed(2)) : '',
        }));
      } catch {
        if (!cancelled) setFinOsContexto(null);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [finForm.os_id]);

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
        const m = await fetch(`${API_BASE}/modelos`);
        if (m.ok) setModelosList(await m.json());
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
    const load = async () => {
      setFinLoading(true);
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
      } catch {
        setFinError(LOAD_ERROR_MESSAGE);
      } finally {
        setFinLoading(false);
      }
    };
    load();
  }, [
    module,
    finDespesaFiltroDe,
    finDespesaFiltroAte,
    finDespesaFiltroCategoria,
    finDespesaFiltroOsId,
  ]);

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
      setOsUsuarioAlteracao('');
      setContratoEmailDest(data.cliente_email ? String(data.cliente_email) : '');
      setContratoEmailMsg('');
    } catch {
      setOsError(LOAD_ERROR_MESSAGE);
      setOsDraft(null);
    }
  };

  const updateOsDraft = (key, value) => {
    setOsDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const addOsLinha = () => {
    setOsDraft((prev) => {
      if (!prev) return prev;
      const n = prev.linhas.length + 1;
      return {
        ...prev,
        linhas: [
          ...prev.linhas,
          {
            modelo_id: '',
            rotulo: `Modelo ${n}`,
            cache_modelo: '',
            emite_nf_propria: false,
            data_prevista_pagamento: '',
          },
        ],
      };
    });
  };

  const updateOsLinha = (index, patch) => {
    setOsDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        linhas: prev.linhas.map((line, i) => (i === index ? { ...line, ...patch } : line)),
      };
    });
  };

  const removeOsLinha = (index) => {
    setOsDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, linhas: prev.linhas.filter((_, i) => i !== index) };
    });
  };

  const saveOs = async (event) => {
    event.preventDefault();
    if (!osDraft?.id) return;
    setOsError('');
    setOsSaving(true);
    try {
      const tipo = osDraft.tipo_os || 'com_modelo';
      if (osDraft.emitir_contrato) {
        const faltando = [];
        if (!String(osDraft.uso_imagem ?? '').trim()) faltando.push('uso de imagem');
        if (!String(osDraft.prazo ?? '').trim()) faltando.push('prazo');
        if (!String(osDraft.territorio ?? '').trim()) faltando.push('território');
        if (!String(osDraft.condicoes_pagamento ?? '').trim()) faltando.push('condições de pagamento');
        if (faltando.length > 0) {
          setOsError(
            `Com “Contrato com cliente” ativo, preencha na O.S.: ${faltando.join(', ')} (texto objetivo, não deixe em branco).`,
          );
          setOsSaving(false);
          return;
        }
      }
      if (tipo === 'com_modelo') {
        if (!osDraft.linhas || osDraft.linhas.length === 0) {
          setOsError('Com o tipo “Com modelo”, adicione pelo menos um modelo ao job e preencha cachê e NF.');
          setOsSaving(false);
          return;
        }
        for (let i = 0; i < osDraft.linhas.length; i += 1) {
          const l = osDraft.linhas[i];
          const cacheNum = Number(l.cache_modelo);
          if (!Number.isFinite(cacheNum) || cacheNum < 0) {
            setOsError(`Modelos do job — linha ${i + 1}: informe o cachê do modelo (valor numérico ≥ 0).`);
            setOsSaving(false);
            return;
          }
          if (!l.modelo_id && !String(l.rotulo ?? '').trim()) {
            setOsError(
              `Modelos do job — linha ${i + 1}: selecione um modelo cadastrado ou preencha a referência da vaga.`,
            );
            setOsSaving(false);
            return;
          }
        }
      }

      const payload = {
        tipo_os: tipo,
        descricao: osDraft.descricao,
        data_trabalho: osDraft.data_trabalho || null,
        uso_imagem: osDraft.uso_imagem,
        tipo_trabalho: osDraft.tipo_trabalho,
        prazo: osDraft.prazo,
        territorio: osDraft.territorio,
        condicoes_pagamento: osDraft.condicoes_pagamento,
        valor_servico: tipo === 'sem_modelo' ? Number(osDraft.valor_servico || 0) : 0,
        agencia_fee_percent: Number(osDraft.agencia_fee_percent ?? 0),
        extras_agencia_valor: Number(osDraft.extras_agencia_valor ?? 0),
        extras_despesa_valor: Number(osDraft.extras_despesa_valor ?? 0),
        extras_despesa_descricao: osDraft.extras_despesa_descricao || '',
        imposto_percent: Number(osDraft.imposto_percent ?? 10),
        parceiro_id: osDraft.parceiro_id ? Number(osDraft.parceiro_id) : null,
        parceiro_percent:
          osDraft.parceiro_percent === '' || osDraft.parceiro_percent == null ? null : Number(osDraft.parceiro_percent),
        booker_id: osDraft.booker_id ? Number(osDraft.booker_id) : null,
        booker_percent: osDraft.booker_percent === '' || osDraft.booker_percent == null ? null : Number(osDraft.booker_percent),
        emitir_contrato: Boolean(osDraft.emitir_contrato),
        contrato_template_versao: osDraft.contrato_template_versao || null,
        contrato_observacao: osDraft.contrato_observacao ?? '',
        data_vencimento_cliente: osDraft.data_vencimento_cliente || null,
      };
      if (tipo === 'com_modelo') {
        payload.linhas = osDraft.linhas.map((l) => {
          const mid = l.modelo_id !== '' && l.modelo_id != null ? Number(l.modelo_id) : null;
          return {
            modelo_id: mid != null && !Number.isNaN(mid) && mid > 0 ? mid : null,
            rotulo: String(l.rotulo ?? '').trim() || undefined,
            cache_modelo: Number(l.cache_modelo),
            emite_nf_propria: Boolean(l.emite_nf_propria),
            data_prevista_pagamento: l.data_prevista_pagamento || null,
          };
        });
      }
      payload.usuario = osUsuarioAlteracao.trim();

      const response = await fetch(`${API_BASE}/ordens-servico/${osDraft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Erro ao salvar O.S.');

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
      setOsUsuarioAlteracao('');
      if (data.cliente_email) setContratoEmailDest(String(data.cliente_email));
      const listRes = await fetch(`${API_BASE}/ordens-servico`);
      if (listRes.ok) setOsList(await listRes.json());
      await refreshAlertasOperacionais();
    } catch (requestError) {
      setOsError(requestError.message || LOAD_ERROR_MESSAGE);
    } finally {
      setOsSaving(false);
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
      setContratoEmailMsg('Enviado com sucesso.');
      await loadOsDetail(osDraft.id);
    } catch (e) {
      setContratoEmailMsg(e.message || 'Erro ao enviar.');
    } finally {
      setContratoEmailLoading(false);
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

  const saveRecebimento = async (event) => {
    event.preventDefault();
    setFinError('');
    try {
      const res = await fetch(`${API_BASE}/financeiro/recebimentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          os_id: Number(finForm.os_id),
          valor: Number(finForm.valor),
          data_recebimento: finForm.data_recebimento,
          observacao: finForm.observacao,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro ao salvar.');
      setFinForm({ os_id: '', valor: '', data_recebimento: '', observacao: '' });
      setFinOsContexto(null);
      const [r1, r2, r3] = await Promise.all([
        fetch(`${API_BASE}/financeiro/resumo`),
        fetch(`${API_BASE}/financeiro/recebimentos`),
        fetch(`${API_BASE}/ordens-servico`),
      ]);
      if (r1.ok) setFinResumo(await r1.json());
      if (r2.ok) setFinRecebimentos(await r2.json());
      if (r3.ok) setFinOsOptions(await r3.json());
      await refreshAlertasOperacionais();
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
      const despParams = new URLSearchParams();
      if (finDespesaFiltroDe) despParams.set('data_de', finDespesaFiltroDe);
      if (finDespesaFiltroAte) despParams.set('data_ate', finDespesaFiltroAte);
      if (finDespesaFiltroCategoria) despParams.set('categoria', finDespesaFiltroCategoria);
      if (finDespesaFiltroOsId) despParams.set('os_id', finDespesaFiltroOsId);
      const despQ = despParams.toString() ? `?${despParams.toString()}` : '';
      const [r1, r4] = await Promise.all([
        fetch(`${API_BASE}/financeiro/resumo`),
        fetch(`${API_BASE}/financeiro/despesas${despQ}`),
      ]);
      if (r1.ok) setFinResumo(await r1.json());
      if (r4.ok) setFinDespesas(await r4.json());
      await refreshAlertasOperacionais();
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
      const despParams = new URLSearchParams();
      if (finDespesaFiltroDe) despParams.set('data_de', finDespesaFiltroDe);
      if (finDespesaFiltroAte) despParams.set('data_ate', finDespesaFiltroAte);
      if (finDespesaFiltroCategoria) despParams.set('categoria', finDespesaFiltroCategoria);
      if (finDespesaFiltroOsId) despParams.set('os_id', finDespesaFiltroOsId);
      const despQ = despParams.toString() ? `?${despParams.toString()}` : '';
      const [r1, r4] = await Promise.all([
        fetch(`${API_BASE}/financeiro/resumo`),
        fetch(`${API_BASE}/financeiro/despesas${despQ}`),
      ]);
      if (r1.ok) setFinResumo(await r1.json());
      if (r4.ok) setFinDespesas(await r4.json());
    } catch (e) {
      setFinError(e.message || LOAD_ERROR_MESSAGE);
    }
  };

  const savePagamentoModelo = async (event) => {
    event.preventDefault();
    setExtratoError('');
    try {
      const res = await fetch(`${API_BASE}/financeiro/pagamentos-modelo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          os_modelo_id: Number(pagamentoForm.os_modelo_id),
          valor: Number(pagamentoForm.valor),
          data_pagamento: pagamentoForm.data_pagamento,
          observacao: pagamentoForm.observacao,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro ao salvar.');
      setPagamentoForm({ os_modelo_id: '', valor: '', data_pagamento: '', observacao: '' });
      const exRes = await fetch(
        extratoModeloFilter
          ? `${API_BASE}/extrato-modelo?modelo_id=${encodeURIComponent(extratoModeloFilter)}`
          : `${API_BASE}/extrato-modelo`,
      );
      if (exRes.ok) setExtratoRows(await exRes.json());
      await refreshAlertasOperacionais();
    } catch (e) {
      setExtratoError(e.message || LOAD_ERROR_MESSAGE);
    }
  };

  const onChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
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

      if (editingId) {
        setItems((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
      } else {
        setItems((prev) => [saved, ...prev]);
      }

      setError('');
      setCadastroListError('');
      setEditingId(null);
      setForm(current.form);
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
      nextForm.website = item.website != null ? String(item.website) : '';
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

  const handleQuantidadeModelosRefChange = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      onChangeOrcamento('quantidade_modelos_referencia', '');
      return;
    }
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    onChangeOrcamento('quantidade_modelos_referencia', String(Math.max(0, Math.min(999, n))));
  };

  const addOrcamentoLinhaCadastro = () => {
    setOrcamentoForm((prev) => ({
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
    }));
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

  const clearOrcamentoEdicao = () => {
    setOrcamentoEditingId(null);
    setOrcamentoEditingStatus(null);
    setOrcamentoEditingOsId(null);
    setOrcamentoForm(createEmptyOrcamentoForm());
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

      const tipoProp = orcamentoForm.tipo_proposta_os === 'sem_modelo' ? 'sem_modelo' : 'com_modelo';
      let linhasPayload = [];
      if (tipoProp === 'com_modelo') {
        linhasPayload = (orcamentoForm.linhas || [])
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
      }
      let cacheBase = Number(orcamentoForm.cache_base_estimado_total || 0);
      if (tipoProp === 'com_modelo' && linhasPayload.length > 0) {
        cacheBase = linhasPayload.reduce(
          (s, l) => s + (Number.isFinite(l.cache_modelo) ? l.cache_modelo : 0),
          0,
        );
      }

      const qtdRefPayload =
        tipoProp === 'com_modelo' &&
        orcamentoForm.quantidade_modelos_referencia !== '' &&
        orcamentoForm.quantidade_modelos_referencia != null
          ? Number(orcamentoForm.quantidade_modelos_referencia)
          : null;

      const ip = Number(orcamentoForm.imposto_percent);
      const payload = {
        ...orcamentoForm,
        tipo_proposta_os: tipoProp,
        cliente_id: Number(orcamentoForm.cliente_id),
        cache_base_estimado_total: cacheBase,
        valor_servico_sem_modelo: Number(orcamentoForm.valor_servico_sem_modelo || 0),
        taxa_agencia_percent: Number(orcamentoForm.taxa_agencia_percent),
        extras_agencia_valor: Number(orcamentoForm.extras_agencia_valor),
        imposto_percent: Number.isFinite(ip) && ip >= 0 && ip <= 100 ? ip : 10,
        data_trabalho: orcamentoForm.data_trabalho ? String(orcamentoForm.data_trabalho).trim() : '',
        horario_trabalho: String(orcamentoForm.horario_trabalho ?? '').trim(),
        local_trabalho: String(orcamentoForm.local_trabalho ?? '').trim(),
        quantidade_modelos_referencia: Number.isFinite(qtdRefPayload) ? qtdRefPayload : null,
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
      setOrcamentoForm({
        cliente_id: String(data.cliente_id),
        tipo_proposta_os: data.tipo_proposta_os === 'sem_modelo' ? 'sem_modelo' : 'com_modelo',
        tipo_trabalho: data.tipo_trabalho,
        descricao: data.descricao,
        data_trabalho: dataInput,
        horario_trabalho: data.horario_trabalho ?? '',
        local_trabalho: data.local_trabalho ?? '',
        cache_base_estimado_total: data.cache_base_estimado_total,
        valor_servico_sem_modelo:
          data.valor_servico_sem_modelo != null ? String(data.valor_servico_sem_modelo) : '',
        taxa_agencia_percent: data.taxa_agencia_percent,
        extras_agencia_valor: data.extras_agencia_valor,
        imposto_percent:
          data.imposto_percent != null && data.imposto_percent !== ''
            ? String(data.imposto_percent)
            : '10',
        condicoes_pagamento: data.condicoes_pagamento,
        uso_imagem: data.uso_imagem,
        prazo: data.prazo,
        territorio: data.territorio,
        quantidade_modelos_referencia:
          data.quantidade_modelos_referencia != null && data.quantidade_modelos_referencia !== ''
            ? String(data.quantidade_modelos_referencia)
            : '',
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
      const tipo = budget.tipo_proposta_os === 'sem_modelo' ? 'sem_modelo' : 'com_modelo';
      if (tipo === 'com_modelo') {
        const linhas = Array.isArray(budget.linhas) ? budget.linhas : [];
        const reais = linhas.filter((l) => l.modelo_id != null && Number(l.modelo_id) > 0);
        if (reais.length === 0) {
          setOrcamentoError(
            'Para aprovar com modelos, cadastre pelo menos um modelo do cadastro com cachê. A quantidade de referência não autoriza a O.S.',
          );
          return;
        }
        const invalid = reais.some((l) => !Number.isFinite(Number(l.cache_modelo)) || Number(l.cache_modelo) < 0);
        if (invalid) {
          setOrcamentoError('Cada modelo do cadastro precisa de cachê válido (≥ 0) antes de aprovar.');
          return;
        }
      } else if (!(Number(budget.valor_servico_sem_modelo) > 0)) {
        setOrcamentoError('Para aprovar “sem modelo”, defina o valor do serviço no orçamento.');
        return;
      }

      const response = await fetch(`${API_BASE}/orcamentos/${id}/aprovar`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Erro ao aprovar orçamento.');
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
            <div
              onMouseEnter={() => setCadastrosMenuOpen(true)}
              className="rounded-xl"
            >
              <button
                type="button"
                onClick={() => {
                  setCadastrosMenuOpen((prev) => !prev);
                  setModule('cadastros');
                  setTab('clientes');
                }}
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${
                  module === 'cadastros'
                    ? 'border-amber-300 bg-amber-50 text-amber-950'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center justify-between">
                  <span>Cadastros</span>
                  <span className="text-xs">{cadastrosMenuOpen ? '▾' : '▸'}</span>
                </span>
              </button>
              {cadastrosMenuOpen && (
                <nav className="mt-2 space-y-1.5 pl-2" aria-label="Tipos de cadastro">
                  {tabEntries.map(([key, value]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
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
                          : 'Gestão de orçamentos'
                      : module === 'inicio'
                        ? 'Dashboard'
                        : module === 'contratos'
                          ? 'Contratos'
                        : module === 'seguranca'
                          ? 'Minha conta e segurança'
                        : module === 'financeiro'
                          ? 'Financeiro'
                          : module === 'extrato'
                            ? 'Extrato modelo'
                            : 'Jobs / O.S.'}
                </h2>
                <p className="text-sm text-slate-500">
                  {module === 'cadastros'
                    ? 'Cadastro simples e operacional, pronto para alimentar O.S. e financeiro.'
                    : module === 'orcamentos'
                      ? orcamentosSubView === 'lista'
                        ? 'Listagem completa com filtros e paginação.'
                        : orcamentosSubView === 'formulario'
                          ? 'Preencha o rascunho, salve e use “Aprovar Orçamento” no topo para gerar a O.S.'
                          : 'Busque orçamentos, abra para revisar ou aprovar, ou crie um novo.'
                      : module === 'inicio'
                        ? 'Caixa, resultado da agência e pendências (contrato, receber, pagar modelos).'
                        : module === 'contratos'
                          ? 'Central de contratos por O.S.: status, visualização e reenvio para assinatura.'
                        : module === 'seguranca'
                          ? 'Altere sua senha de administrador em uma tela dedicada.'
                        : module === 'financeiro'
                          ? 'Recebimentos do cliente por O.S. e resumo (vínculo ao número da O.S.).'
                          : module === 'extrato'
                            ? 'Líquido por linha de modelo, pagamentos registrados e saldo.'
                            : 'Ordens de serviço após aprovação do orçamento: linhas de modelo e resumo financeiro.'}
                </p>
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
                          : `${osList.length} O.S.`}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Modulo atual</p>
                <p className="text-lg font-semibold text-slate-800">
                  {module === 'cadastros'
                    ? 'Cadastros'
                    : module === 'orcamentos'
                      ? 'Orçamentos'
                      : module === 'inicio'
                        ? 'Visão geral'
                      : module === 'contratos'
                        ? 'Contratos'
                      : module === 'seguranca'
                        ? 'Conta'
                        : module === 'financeiro'
                          ? 'Caixa'
                          : module === 'extrato'
                            ? 'Modelos'
                            : 'Jobs'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Tipo selecionado</p>
                <p className="text-lg font-semibold text-slate-800">
                  {module === 'cadastros'
                    ? current.label
                    : module === 'orcamentos'
                      ? orcamentosSubView === 'lista'
                        ? 'Lista completa'
                        : orcamentosSubView === 'formulario'
                          ? 'Formulário'
                          : 'Painel'
                      : module === 'inicio'
                        ? 'Operação'
                        : module === 'contratos'
                          ? 'Assinaturas'
                        : module === 'seguranca'
                          ? 'Acesso'
                        : module === 'financeiro'
                          ? 'Financeiro'
                          : module === 'extrato'
                            ? 'Por O.S. / modelo'
                            : 'Operacional'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Status</p>
                <p className="text-lg font-semibold text-emerald-600">Ativo</p>
              </div>
            </div>
          </section>

          {module === 'inicio' && (
            <>
              <OperacaoCalendar
                apiUrl={API_BASE}
                onOpenOs={(osId) => {
                  setModule('jobs');
                  loadOsDetail(osId);
                }}
              />
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-800">Resumo financeiro</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Totais globais (mesma base da aba <strong>Financeiro</strong>).
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
                      onClick={() => setModule('financeiro')}
                    >
                      Ir para Financeiro
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
                      onClick={() => setModule('extrato')}
                    >
                      Ir para Extrato modelo
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
                      onClick={() => {
                        setModule('jobs');
                        setOsDraft(null);
                      }}
                    >
                      Ir para Jobs / O.S.
                    </button>
                  </div>
                </div>
                {dashboardResumoLoading ? (
                  <p className="mt-4 text-sm text-slate-500">Carregando resumo...</p>
                ) : dashboardResumo ? (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Total recebido (cliente)</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(dashboardResumo.total_recebido_cliente)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Total pago a modelos</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(dashboardResumo.total_pago_modelos)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">Soma dos pagamentos na O.S. / extrato</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Total comissões (O.S.)</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(dashboardResumo.total_comissoes_os ?? 0)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">Σ parceiro + booker (valores do job)</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Total despesas (agência)</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(dashboardResumo.total_despesas ?? 0)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Impostos, operacional, outros — lançamentos manuais
                        </p>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <p className="text-xs text-emerald-900">Resultado final (caixa)</p>
                        <p className="text-lg font-semibold text-emerald-950">
                          {formatBRL(dashboardResumo.resultado_final ?? 0)}
                        </p>
                        <p className="mt-1 text-[11px] text-emerald-900/90">
                          Único saldo: recebido − modelos − comissões − despesas
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-slate-600">
                      Faturado em O.S. ainda não recebidas:{' '}
                      <strong>{formatBRL(dashboardResumo.total_faturado_os_abertas)}</strong>
                    </p>
                    <p className="mt-4 text-xs font-medium text-slate-600">
                      Referência — somas de colunas nas O.S. (não substituem o <strong>Resultado final</strong> de caixa
                      acima).
                    </p>
                    <div className="mt-2 grid gap-3 grid-cols-2 md:grid-cols-4">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Σ Total cliente (todas as O.S.)</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(dashboardResumo.soma_total_cliente_os)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Σ Líquido modelos</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(dashboardResumo.soma_modelo_liquido_os)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Σ Parceiro</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(dashboardResumo.soma_parceiro_valor_os)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Σ Booker</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(dashboardResumo.soma_booker_valor_os)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-3">
                        <p className="text-xs text-amber-900">Saldo a receber (lista abaixo)</p>
                        <p className="text-lg font-semibold text-amber-950">{formatBRL(saldoAbertoClienteDashboard)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Contratos sem assinatura</p>
                        <p className="text-lg font-semibold text-slate-900">{contratosPendentes.count}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Linhas c/ pag. modelo pendente</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {alertasOperacionais?.pagamentos_modelo_pendentes?.length ?? 0}
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-amber-800">Não foi possível carregar o resumo — verifique a API.</p>
                )}
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Contratos aguardando assinatura</h3>
                <p className="mt-1 text-sm text-slate-500">
                  O.S. com contrato ativo e sem arquivo de contrato assinado — dados vêm do job.
                </p>
                {contratosPendentes.count === 0 ? (
                  <p className="mt-4 text-sm text-slate-600">Nenhuma pendência neste critério.</p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {contratosPendentes.items.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                      >
                        <span>
                          O.S. <strong>#{row.id}</strong> — {row.nome_empresa || row.nome_fantasia}
                          {row.contrato_status && (
                            <span className="ml-2 text-xs text-slate-500">({row.contrato_status})</span>
                          )}
                        </span>
                        <button
                          type="button"
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium"
                          onClick={() => {
                            setModule('jobs');
                            loadOsDetail(row.id);
                          }}
                        >
                          Abrir O.S.
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Contas a receber (cliente)</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Saldo em aberto por O.S. (total_cliente − recebimentos). Ir a <strong>Financeiro</strong> para
                  confirmar entrada.
                </p>
                {!alertasOperacionais?.contas_receber?.length ? (
                  <p className="mt-4 text-sm text-slate-600">Nenhuma O.S. com saldo a receber.</p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2">O.S.</th>
                          <th className="px-2 py-2">Cliente</th>
                          <th className="px-2 py-2">Total (job)</th>
                          <th className="px-2 py-2">Recebido</th>
                          <th className="px-2 py-2">Saldo</th>
                          <th className="px-2 py-2">Status</th>
                          <th className="px-2 py-2">Ação</th>
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
                            <td className="px-2 py-2">{row.status}</td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                className="rounded border border-slate-300 px-2 py-1 text-xs"
                                onClick={() => {
                                  setModule('financeiro');
                                  setFinForm((p) => ({ ...p, os_id: String(row.os_id) }));
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
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Pagamentos a modelos (pendências)</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {alertasOperacionais?.meta?.nota_prazos ||
                    'Linhas com saldo em aberto (líquido da O.S. − pagamentos registrados).'}
                </p>
                {!alertasOperacionais?.pagamentos_modelo_pendentes?.length ? (
                  <p className="mt-4 text-sm text-slate-600">Nenhuma linha com saldo pendente.</p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2">Job</th>
                          <th className="px-2 py-2">Modelo</th>
                          <th className="px-2 py-2">Cliente</th>
                          <th className="px-2 py-2">Líquido</th>
                          <th className="px-2 py-2">Pago</th>
                          <th className="px-2 py-2">Saldo</th>
                          <th className="px-2 py-2">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alertasOperacionais.pagamentos_modelo_pendentes.map((row) => (
                          <tr key={row.os_modelo_id} className="border-b border-slate-100">
                            <td className="px-2 py-2">#{row.job_id}</td>
                            <td className="px-2 py-2">{row.modelo_nome}</td>
                            <td className="px-2 py-2">{row.cliente}</td>
                            <td className="px-2 py-2">{formatBRL(row.liquido)}</td>
                            <td className="px-2 py-2">{formatBRL(row.pago)}</td>
                            <td className="px-2 py-2 font-medium text-amber-900">{formatBRL(row.saldo)}</td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                className="rounded border border-slate-300 px-2 py-1 text-xs"
                                onClick={() => {
                                  setModule('extrato');
                                  setPagamentoForm((p) => ({
                                    ...p,
                                    os_modelo_id: String(row.os_modelo_id),
                                    valor: row.saldo > 0 ? String(Number(row.saldo).toFixed(2)) : '',
                                  }));
                                }}
                              >
                                Pagar no extrato
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {module === 'financeiro' && (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Resumo financeiro</h3>
                <p className="mt-1 text-sm text-slate-500">
                  <strong>Recebimentos</strong> só por aqui. <strong>Pagamentos a modelos</strong> e{' '}
                  <strong>comissões</strong> vêm apenas dos dados gravados na O.S. (soma, sem recálculo).{' '}
                  <strong>Despesas</strong> são só operacionais (impostos, operacional, outros), módulo separado — nunca
                  cachê ou comissão manual.
                </p>
                {finLoading ? (
                  <p className="mt-3 text-sm text-slate-500">Carregando...</p>
                ) : finResumo ? (
                  <>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Total recebido (cliente)</p>
                        <p className="text-lg font-semibold text-slate-900">{formatBRL(finResumo.total_recebido_cliente)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Total pago a modelos</p>
                        <p className="text-lg font-semibold text-slate-900">{formatBRL(finResumo.total_pago_modelos)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Total comissões (O.S.)</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(finResumo.total_comissoes_os ?? 0)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">Σ parceiro + booker nos jobs</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Total despesas (agência)</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(finResumo.total_despesas ?? 0)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Impostos, operacional, outros — lançamentos manuais
                        </p>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <p className="text-xs text-emerald-900">Resultado final (caixa)</p>
                        <p className="text-lg font-semibold text-emerald-950">
                          {formatBRL(finResumo.resultado_final ?? 0)}
                        </p>
                        <p className="mt-1 text-[11px] text-emerald-900/90">
                          Único saldo: recebido − modelos − comissões − despesas
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-slate-600">
                      Faturado em O.S. ainda não recebidas:{' '}
                      <strong>{formatBRL(finResumo.total_faturado_os_abertas)}</strong>
                    </p>
                  </>
                ) : null}
                {finError && <p className="mt-3 text-sm text-red-600">{finError}</p>}
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Despesas da agência</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Apenas <strong>impostos</strong>, <strong>operacional</strong> e <strong>outros</strong> — não use para
                  cachê de modelo nem comissões (isso só na O.S.). Vínculo opcional a um job é só referência. Filtros:
                  período, categoria, O.S.
                </p>

                <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">De (data)</span>
                    <input
                      type="date"
                      value={finDespesaFiltroDe}
                      onChange={(e) => setFinDespesaFiltroDe(e.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Até (data)</span>
                    <input
                      type="date"
                      value={finDespesaFiltroAte}
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

                <form className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6" onSubmit={saveDespesa}>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Data</span>
                    <input
                      type="date"
                      value={finDespesaForm.data_despesa}
                      onChange={(e) => setFinDespesaForm((p) => ({ ...p, data_despesa: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      required
                    />
                  </label>
                  <label className="text-sm text-slate-600 md:col-span-2">
                    <span className="mb-1 block">Descrição</span>
                    <input
                      value={finDespesaForm.descricao}
                      onChange={(e) => setFinDespesaForm((p) => ({ ...p, descricao: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      required
                    />
                  </label>
                  <label className="text-sm text-slate-600">
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
                  <label className="text-sm text-slate-600">
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
                  <label className="text-sm text-slate-600">
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
                  <div className="flex items-end lg:col-span-6">
                    <button
                      type="submit"
                      className="rounded-xl px-4 py-2 text-sm font-medium text-white"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      Registrar despesa
                    </button>
                  </div>
                </form>

                <h4 className="mt-8 text-sm font-semibold text-slate-800">Lista (filtrada)</h4>
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
                <h3 className="text-base font-semibold text-slate-800">Recebimentos (cliente)</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Ao registrar um recebimento, a O.S. passa para <strong>recebida</strong> e os valores do job deixam de
                  poder ser alterados. O valor vem do <strong>total_cliente</strong> da O.S.; você só confirma o montante
                  (saldo em aberto é preenchido automaticamente).
                </p>
                {finOsContexto && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span className="font-medium">O.S. #{finOsContexto.os_id}</span> — Total cliente{' '}
                    <strong>{formatBRL(finOsContexto.total_cliente)}</strong>, já recebido{' '}
                    <strong>{formatBRL(finOsContexto.recebido)}</strong>, saldo{' '}
                    <strong className="text-amber-900">{formatBRL(finOsContexto.saldo_receber)}</strong>.
                    <button
                      type="button"
                      className="ml-2 text-xs font-medium text-amber-800 underline"
                      onClick={() =>
                        setFinForm((p) => ({
                          ...p,
                          valor:
                            finOsContexto.saldo_receber > 0
                              ? String(Number(finOsContexto.saldo_receber).toFixed(2))
                              : p.valor,
                        }))
                      }
                    >
                      Repor saldo no campo
                    </button>
                  </div>
                )}
                <form className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4" onSubmit={saveRecebimento}>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">O.S.</span>
                    <select
                      value={finForm.os_id}
                      onChange={(e) => setFinForm((p) => ({ ...p, os_id: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      required
                    >
                      <option value="">Selecione</option>
                      {finOsOptions.map((os) => (
                        <option key={os.id} value={os.id}>
                          #{os.id} — {os.nome_empresa || os.nome_fantasia}
                          {os.status === 'recebida' ? ' (recebida)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Valor (máx. = saldo em aberto)</span>
                    <input
                      type="number"
                      step="0.01"
                      value={finForm.valor}
                      onChange={(e) => setFinForm((p) => ({ ...p, valor: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      required
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Data</span>
                    <input
                      type="date"
                      value={finForm.data_recebimento}
                      onChange={(e) => setFinForm((p) => ({ ...p, data_recebimento: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      required
                    />
                  </label>
                  <label className="text-sm text-slate-600 md:col-span-2 lg:col-span-1">
                    <span className="mb-1 block">Obs.</span>
                    <input
                      value={finForm.observacao}
                      onChange={(e) => setFinForm((p) => ({ ...p, observacao: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="rounded-xl px-4 py-2 text-sm font-medium text-white"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      Registrar recebimento
                    </button>
                  </div>
                </form>
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
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Registrar pagamento ao modelo</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Use o <strong>id da linha</strong> (interno) mostrado na tabela acima — coluna implícita: cada linha tem
                  os_modelo_id no backend; escolha o id correspondente à linha do Job × Modelo.
                </p>
                <form className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5" onSubmit={savePagamentoModelo}>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">ID da linha (os_modelo_id)</span>
                    <select
                      value={pagamentoForm.os_modelo_id}
                      onChange={(e) => setPagamentoForm((p) => ({ ...p, os_modelo_id: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      required
                    >
                      <option value="">Selecione</option>
                      {extratoRows.map((row) => (
                        <option key={row.os_modelo_id} value={row.os_modelo_id}>
                          #{row.job_id} — {row.modelo_nome} (saldo {formatBRL(row.saldo)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Valor</span>
                    <input
                      type="number"
                      step="0.01"
                      value={pagamentoForm.valor}
                      onChange={(e) => setPagamentoForm((p) => ({ ...p, valor: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      required
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Data</span>
                    <input
                      type="date"
                      value={pagamentoForm.data_pagamento}
                      onChange={(e) => setPagamentoForm((p) => ({ ...p, data_pagamento: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      required
                    />
                  </label>
                  <label className="text-sm text-slate-600 md:col-span-2 lg:col-span-1">
                    <span className="mb-1 block">Obs.</span>
                    <input
                      value={pagamentoForm.observacao}
                      onChange={(e) => setPagamentoForm((p) => ({ ...p, observacao: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="rounded-xl px-4 py-2 text-sm font-medium text-white"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      Registrar pagamento
                    </button>
                  </div>
                </form>
              </section>
            </>
          )}

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
                      Gere links únicos de cadastro. Cada link é de uso único e expira automaticamente.
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

          {module === 'cadastros' && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
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
                  || (isModeloTab
                    && (field === 'cpf' || field === 'responsavel_cpf' || field === 'responsavel_telefone'));

                if (isClienteTab && field === 'website') {
                  return (
                    <label key={field} className="text-sm text-slate-600 md:col-span-2">
                      <span className="mb-1 block">
                        {labelForField(field)}
                        <span className="font-normal text-slate-500"> (opcional)</span>
                      </span>
                      <input
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        placeholder="https://www.exemplo.com.br"
                        value={form[field] ?? ''}
                        onChange={(event) => onChange(field, event.target.value.trim())}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
                      />
                    </label>
                  );
                }

                return (
                  <label key={field} className="text-sm text-slate-600">
                    <span className="mb-1 block">
                      {isClienteTab && field === 'documento'
                        ? (form.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ')
                        : labelForField(field)}
                      {contractRequiredCliente || (isModeloTab && field === 'cpf') ? (
                        <span className="text-red-600"> *</span>
                      ) : null}
                    </span>
                    <input
                      type={field === 'data_nascimento' ? 'date' : 'text'}
                      value={form[field] ?? ''}
                      onChange={(event) =>
                        useMaskedCadastroInput
                          ? handleMaskedCadastroChange(field, event.target.value)
                          : onChange(field, event.target.value)
                      }
                      onBlur={
                        isClienteTab && field === 'documento' && form.tipo_pessoa === 'PJ'
                          ? buscarDadosEmpresaPorCnpj
                          : isClienteTab && field === 'cep'
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
                    }}
                  >
                    Cancelar edicao
                  </button>
                )}
              </div>
            </form>
          </section>}

          {module === 'cadastros' && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
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
          </section>}

          {module === 'orcamentos' && (
            <>
              {orcamentoError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
                  {orcamentoError}
                </p>
              )}

              {orcamentosSubView === 'gestao' && (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-slate-900">Gestão de orçamentos</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Busque, abra um orçamento para revisar ou aprove, ou crie um novo.
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
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <button
                      type="button"
                      className="shrink-0 self-start rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                      onClick={voltarParaGestaoOrcamentos}
                    >
                      ← Gestão de orçamentos
                    </button>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {orcamentoEditingId ? `Orçamento #${orcamentoEditingId}` : 'Novo orçamento'}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {orcamentoEditingId
                          ? labelOrcamentoStatus(orcamentoEditingStatus)
                          : 'Salve como rascunho antes de aprovar.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                    {orcamentoEditingId &&
                      orcamentoEditingStatus === 'rascunho' &&
                      !orcamentoFormLocked && (
                        <button
                          type="button"
                          className="w-full rounded-xl px-6 py-3.5 text-base font-semibold text-white shadow-md sm:min-w-[220px]"
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
                          className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 sm:min-w-[200px]"
                          onClick={() => abrirOsGerada(orcamentoEditingOsId)}
                        >
                          Ver O.S. #{orcamentoEditingOsId}
                        </button>
                      )}
                  </div>
                </div>
                <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={saveOrcamento}>
                  {orcamentoFormLocked && (
                    <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                      <p className="font-medium">
                        Este orçamento está {labelOrcamentoStatus(orcamentoEditingStatus)} — a edição está bloqueada.
                      </p>
                      {orcamentoEditingStatus === 'aprovado' && orcamentoEditingOsId != null && (
                        <button
                          type="button"
                          className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
                          onClick={() => abrirOsGerada(orcamentoEditingOsId)}
                        >
                          Ver O.S. #{orcamentoEditingOsId}
                        </button>
                      )}
                    </div>
                  )}
                  <fieldset
                    disabled={orcamentoFormLocked}
                    className="md:col-span-2 grid min-w-0 grid-cols-1 gap-3 border-0 p-0 md:grid-cols-2 [&:disabled]:opacity-60"
                  >
                  <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">1. Cliente</p>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block font-medium">Cliente</span>
                      <select
                        value={orcamentoForm.cliente_id}
                        onChange={(event) => onChangeOrcamento('cliente_id', event.target.value)}
                        className="w-full max-w-lg rounded-lg border border-slate-300 bg-white px-3 py-2"
                      >
                        <option value="">Selecione o cliente</option>
                        {clients.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.nome_empresa}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label
                    className={`text-sm text-slate-600 ${!orcamentoForm.cliente_id ? 'opacity-50' : ''}`}
                  >
                    <span className="mb-1 block">Tipo de trabalho</span>
                    <input
                      value={orcamentoForm.tipo_trabalho}
                      onChange={(event) => onChangeOrcamento('tipo_trabalho', event.target.value)}
                      disabled={!orcamentoForm.cliente_id}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                    />
                  </label>

                  <div
                    className={`rounded-xl border border-slate-200 bg-white p-4 ${!orcamentoForm.cliente_id ? 'opacity-50' : ''}`}
                  >
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      2. O job inclui modelos?
                    </p>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block font-medium">Resposta</span>
                      <select
                        value={orcamentoForm.tipo_proposta_os || 'com_modelo'}
                        disabled={!orcamentoForm.cliente_id}
                        onChange={(event) => {
                          const v = event.target.value;
                        setOrcamentoForm((prev) => ({
                          ...prev,
                          tipo_proposta_os: v,
                          linhas: v === 'sem_modelo' ? [] : prev.linhas || [],
                          quantidade_modelos_referencia: v === 'sem_modelo' ? '' : prev.quantidade_modelos_referencia ?? '',
                        }));
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                      >
                        <option value="com_modelo">Sim</option>
                        <option value="sem_modelo">Não (serviço sem modelo)</option>
                      </select>
                    </label>
                    <p className="mt-2 text-xs text-slate-500">
                      Com modelos: use a quantidade como referência e, quando souber, adicione modelos do cadastro com
                      cachê. Para aprovar, é obrigatório ter modelos reais definidos.
                    </p>
                  </div>

                  {orcamentoForm.tipo_proposta_os === 'sem_modelo' && (
                    <label className="text-sm text-slate-600 md:col-span-2">
                      <span className="mb-1 block">Valor do serviço (sem modelo)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={orcamentoForm.valor_servico_sem_modelo}
                        onChange={(event) => onChangeOrcamento('valor_servico_sem_modelo', event.target.value)}
                        disabled={!orcamentoForm.cliente_id}
                        className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                      />
                      <span className="mt-1 block text-xs text-slate-500">
                        Obrigatório para aprovar quando não houver modelos. No rascunho pode ficar zero.
                      </span>
                    </label>
                  )}

                  {orcamentoForm.tipo_proposta_os === 'com_modelo' && (
                    <div
                      className={`md:col-span-2 rounded-xl border border-amber-200 bg-amber-50/60 p-4 ${!orcamentoForm.cliente_id ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-900/80">
                        3. Modelos no orçamento
                      </p>
                      <label className="mb-4 block max-w-xs text-sm text-slate-700">
                        <span className="mb-1 block font-medium">Quantidade de modelos</span>
                        <input
                          type="number"
                          min={0}
                          max={999}
                          inputMode="numeric"
                          placeholder="0"
                          value={orcamentoForm.quantidade_modelos_referencia}
                          onChange={handleQuantidadeModelosRefChange}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                        />
                        <span className="mt-1 block text-xs text-slate-600">
                          Referência inicial (opcional). Não gera linhas automáticas. Na aprovação, serão exigidos
                          modelos do cadastro com cachê.
                        </span>
                      </label>

                      <p className="mb-2 text-sm font-medium text-slate-800">Modelos do cadastro (opcional no rascunho)</p>
                      {(orcamentoForm.linhas || []).length === 0 ? (
                        <p className="text-sm text-slate-600">
                          Adicione modelos reais quando já souber quem entra no job. Para aprovar, preencha pelo menos um
                          modelo com cachê.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {(orcamentoForm.linhas || []).map((line, index) => (
                            <div
                              key={line.id ?? `ol-${index}`}
                              className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_minmax(100px,1fr)_auto_auto]"
                            >
                              <select
                                value={line.modelo_id ?? ''}
                                onChange={(event) =>
                                  updateOrcamentoLinha(index, {
                                    modelo_id: event.target.value ? Number(event.target.value) : '',
                                    origemCadastro: true,
                                  })}
                                className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                              >
                                <option value="">Selecione o modelo…</option>
                                {modelosParaSelecao.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.nome}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Cachê R$"
                                value={line.cache_modelo ?? ''}
                                onChange={(event) =>
                                  updateOrcamentoLinha(index, { cache_modelo: event.target.value })}
                                className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                              />
                              <label className="flex items-center gap-2 text-xs text-slate-700">
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
                                className="text-xs text-red-700"
                                onClick={() => removeOrcamentoLinha(index)}
                              >
                                remover
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-3">
                        <button
                          type="button"
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                          style={{ backgroundColor: BRAND_ORANGE }}
                          onClick={addOrcamentoLinhaCadastro}
                        >
                          + Modelo do cadastro
                        </button>
                      </div>
                    </div>
                  )}
                  <label className="text-sm text-slate-600 md:col-span-2">
                    <span className="mb-1 block">Descrição</span>
                    <input value={orcamentoForm.descricao} onChange={(event) => onChangeOrcamento('descricao', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Data do trabalho</span>
                    <input
                      type="date"
                      value={orcamentoForm.data_trabalho}
                      onChange={(event) => onChangeOrcamento('data_trabalho', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Horário</span>
                    <input
                      value={orcamentoForm.horario_trabalho}
                      onChange={(event) => onChangeOrcamento('horario_trabalho', event.target.value)}
                      placeholder="Ex.: 09h–18h"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-slate-600 md:col-span-2">
                    <span className="mb-1 block">Local</span>
                    <input
                      value={orcamentoForm.local_trabalho}
                      onChange={(event) => onChangeOrcamento('local_trabalho', event.target.value)}
                      placeholder="Endereço ou estúdio"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">
                      Cachê base estimado (total)
                      {orcamentoForm.tipo_proposta_os === 'com_modelo' &&
                        (orcamentoForm.linhas || []).length > 0 &&
                        ' — soma dos modelos'}
                    </span>
                    {orcamentoForm.tipo_proposta_os === 'com_modelo' && (orcamentoForm.linhas || []).length > 0 ? (
                      <input
                        type="text"
                        readOnly
                        value={String(
                          (orcamentoForm.linhas || []).reduce(
                            (s, l) => s + (Number.isFinite(Number(l.cache_modelo)) ? Number(l.cache_modelo) : 0),
                            0,
                          ),
                        )}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                      />
                    ) : (
                      <input
                        type="number"
                        value={orcamentoForm.cache_base_estimado_total}
                        onChange={(event) => onChangeOrcamento('cache_base_estimado_total', event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    )}
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Taxa da agência (%)</span>
                    <input type="number" value={orcamentoForm.taxa_agencia_percent} onChange={(event) => onChangeOrcamento('taxa_agencia_percent', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                    <span className="mt-1 block text-xs text-slate-500">
                      Valor ref. da taxa: {formatBRL(orcamentoFinanceiroPreview.taxa_agencia_valor)}
                    </span>
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Extras da agência (valor)</span>
                    <input type="number" value={orcamentoForm.extras_agencia_valor} onChange={(event) => onChangeOrcamento('extras_agencia_valor', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="text-sm text-slate-600 md:col-span-2">
                    <span className="mb-1 block font-medium">Nota fiscal / imposto (%)</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={orcamentoForm.imposto_percent}
                      onChange={(event) => onChangeOrcamento('imposto_percent', event.target.value)}
                      className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2"
                      placeholder="10"
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      Sobre o <strong>subtotal</strong> (cachê + taxa da agência + extras):{' '}
                      {formatBRL(orcamentoFinanceiroPreview.impostoValor)}. O{' '}
                      <strong>total ao cliente</strong> = subtotal + nota (
                      {formatBRL(orcamentoFinanceiroPreview.totalCliente)}). No PDF ao cliente vai só o total final.
                    </span>
                  </label>
                  <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <p className="text-xs text-slate-500">Subtotal (base + taxa + extras)</p>
                    <p className="font-medium text-slate-800">{formatBRL(orcamentoFinanceiroPreview.subtotal)}</p>
                    <p className="mt-2 text-xs text-slate-500">Total ao cliente (subtotal + nota)</p>
                    <p className="text-lg font-semibold text-slate-900">{formatBRL(orcamentoFinanceiroPreview.totalCliente)}</p>
                  </div>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Condições de pagamento</span>
                    <input value={orcamentoForm.condicoes_pagamento} onChange={(event) => onChangeOrcamento('condicoes_pagamento', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Uso de imagem</span>
                    <input value={orcamentoForm.uso_imagem} onChange={(event) => onChangeOrcamento('uso_imagem', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Prazo</span>
                    <input value={orcamentoForm.prazo} onChange={(event) => onChangeOrcamento('prazo', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="text-sm text-slate-600 md:col-span-2">
                    <span className="mb-1 block">Território</span>
                    <input value={orcamentoForm.territorio} onChange={(event) => onChangeOrcamento('territorio', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
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
                  </div>
                  {orcamentoEditingId && (
                    <p className="md:col-span-2 text-xs text-slate-500">
                      No PDF ao cliente: lista de modelos (apenas nomes), texto fixo sobre prestação de serviços e valor
                      total — o detalhamento financeiro fica só no sistema.
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
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold">Ordens de serviço</h3>
                  <span className="text-xs font-medium text-slate-500">Geradas ao aprovar orçamento</span>
                </div>
                {osLoading ? (
                  <p className="text-sm text-slate-500">Carregando...</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-2 py-2 font-medium">O.S.</th>
                          <th className="px-2 py-2 font-medium">Orçamento</th>
                          <th className="px-2 py-2 font-medium">Cliente</th>
                          <th className="px-2 py-2 font-medium">Total cliente</th>
                          <th className="px-2 py-2 font-medium">Agência (resultado)</th>
                          <th className="px-2 py-2 font-medium">Status</th>
                          <th className="px-2 py-2 font-medium">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {osList.map((row) => (
                          <tr key={row.id} className="border-b border-slate-100">
                            <td className="px-2 py-2 font-medium">#{row.id}</td>
                            <td className="px-2 py-2">#{row.orcamento_numero ?? row.orcamento_id}</td>
                            <td className="px-2 py-2">{row.nome_empresa || row.nome_fantasia}</td>
                            <td className="px-2 py-2">{formatBRL(row.total_cliente)}</td>
                            <td className="px-2 py-2">{formatBRL(row.resultado_agencia)}</td>
                            <td className="px-2 py-2">{row.status}</td>
                            <td className="px-2 py-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                                  onClick={() => loadOsDetail(row.id)}
                                >
                                  Abrir
                                </button>
                                <a
                                  href={`${API_BASE}/ordens-servico/${row.id}/pdf`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700"
                                >
                                  PDF
                                </a>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {osError && !osDraft && <p className="mt-3 text-sm font-medium text-red-600">{osError}</p>}
              </section>

              {osDraft && (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold">
                      Editar O.S. #{osDraft.id}
                      {osDraft.status === 'recebida' && (
                        <span className="ml-2 text-sm font-normal text-amber-700">(somente leitura — recebida)</span>
                      )}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`${API_BASE}/ordens-servico/${osDraft.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-800"
                      >
                        O.S. para PDF
                      </a>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
                        onClick={() => setOsDraft(null)}
                      >
                        Fechar
                      </button>
                    </div>
                  </div>
                  <p className="mb-4 text-sm text-slate-600">
                    Orçamento de origem:{' '}
                    <strong>#{osDraft.orcamento_numero ?? osDraft.orcamento_id}</strong>
                    <span className="ml-2 text-xs text-slate-500">
                      (O.S. e orçamento têm numerações distintas; a O.S. permanece vinculada a este orçamento.)
                    </span>
                  </p>

                  <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={saveOs}>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Tipo de O.S.</span>
                      <select
                        value={osDraft.tipo_os || 'com_modelo'}
                        onChange={(e) => {
                          const v = e.target.value;
                          setOsDraft((prev) => {
                            if (!prev || prev.status === 'recebida') return prev;
                            if (v === 'sem_modelo') {
                              return { ...prev, tipo_os: v, linhas: [] };
                            }
                            if (v === 'com_modelo') {
                              if (prev.linhas && prev.linhas.length > 0) return { ...prev, tipo_os: v };
                              return {
                                ...prev,
                                tipo_os: v,
                                linhas: [
                                  {
                                    modelo_id: '',
                                    rotulo: 'Modelo 1',
                                    cache_modelo: '',
                                    emite_nf_propria: false,
                                    data_prevista_pagamento: '',
                                  },
                                ],
                              };
                            }
                            return { ...prev, tipo_os: v };
                          });
                        }}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="com_modelo">Com modelo</option>
                        <option value="sem_modelo">Sem modelo (serviço)</option>
                      </select>
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Data do trabalho</span>
                      <input
                        type="date"
                        value={osDraft.data_trabalho ? String(osDraft.data_trabalho).slice(0, 10) : ''}
                        onChange={(e) => updateOsDraft('data_trabalho', e.target.value || null)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Vencimento (cliente — calendário)</span>
                      <input
                        type="date"
                        value={
                          osDraft.data_vencimento_cliente
                            ? String(osDraft.data_vencimento_cliente).slice(0, 10)
                            : ''
                        }
                        onChange={(e) => updateOsDraft('data_vencimento_cliente', e.target.value || null)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        Se vazio, o calendário usa a data do trabalho como referência para “à receber”.
                      </span>
                    </label>
                    <label className="text-sm text-slate-600 md:col-span-2">
                      <span className="mb-1 block">Descrição</span>
                      <input
                        value={osDraft.descricao ?? ''}
                        onChange={(e) => updateOsDraft('descricao', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Uso de imagem</span>
                      <input
                        value={osDraft.uso_imagem ?? ''}
                        onChange={(e) => updateOsDraft('uso_imagem', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Tipo de trabalho</span>
                      <input
                        value={osDraft.tipo_trabalho ?? ''}
                        onChange={(e) => updateOsDraft('tipo_trabalho', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Prazo</span>
                      <input
                        value={osDraft.prazo ?? ''}
                        onChange={(e) => updateOsDraft('prazo', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Território</span>
                      <input
                        value={osDraft.territorio ?? ''}
                        onChange={(e) => updateOsDraft('territorio', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600 md:col-span-2">
                      <span className="mb-1 block">Condições de pagamento</span>
                      <input
                        value={osDraft.condicoes_pagamento ?? ''}
                        onChange={(e) => updateOsDraft('condicoes_pagamento', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    {osDraft.emitir_contrato && (
                      <p className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
                        <strong>Contrato:</strong> os quatro campos acima (uso de imagem, prazo, território e condições de
                        pagamento) entram no texto jurídico — use descrições claras (ex.: prazo em meses; território Brasil
                        ou lista de países; pagamento parcelado ou à vista). Com O.S. “com modelo”, cada modelo na linha
                        precisa ter CPF no cadastro.
                      </p>
                    )}

                    {osDraft.tipo_os === 'sem_modelo' && (
                      <label className="text-sm text-slate-600 md:col-span-2">
                        <span className="mb-1 block">Valor do serviço (sem modelo)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={osDraft.valor_servico ?? ''}
                          onChange={(e) => updateOsDraft('valor_servico', e.target.value)}
                          disabled={osDraft.status === 'recebida'}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                      </label>
                    )}

                    {osDraft.tipo_os === 'com_modelo' && (
                      <div className="md:col-span-2 rounded-xl border-2 border-amber-200 bg-amber-50/50 p-4">
                        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900">Modelos do job</h4>
                            <p className="mt-0.5 text-xs text-slate-600">
                              Cachê e NF por linha. Pode haver vaga só com referência (sem cadastro); para contrato, vincule o
                              modelo depois. Use “Adicionar modelo” para mais linhas.
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={osDraft.status === 'recebida'}
                            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                            style={{ backgroundColor: BRAND_ORANGE }}
                            onClick={addOsLinha}
                          >
                            + Adicionar modelo
                          </button>
                        </div>
                        {osDraft.linhas.length === 0 ? (
                          <p className="text-sm text-red-700">
                            Nenhum modelo na lista — clique em “Adicionar modelo” ou altere o tipo de O.S.
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {osDraft.linhas.map((line, index) => (
                              <div
                                key={line.id ?? `new-${index}`}
                                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                              >
                                <div className="mb-2 text-xs font-medium text-slate-500">Modelo {index + 1}</div>
                                <div className="grid gap-3 md:grid-cols-[1fr_minmax(120px,1fr)_auto_auto] md:items-end">
                                  <label className="text-sm text-slate-600">
                                    <span className="mb-1 block">Modelo (cadastro)</span>
                                    <select
                                      value={line.modelo_id ?? ''}
                                      onChange={(e) =>
                                        updateOsLinha(index, {
                                          modelo_id: e.target.value ? Number(e.target.value) : '',
                                        })}
                                      disabled={osDraft.status === 'recebida'}
                                      className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                                    >
                                      <option value="">A definir / selecione…</option>
                                      {modelosParaSelecao.map((m) => (
                                        <option key={m.id} value={m.id}>
                                          {m.nome}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="text-sm text-slate-600">
                                    <span className="mb-1 block">Cachê (R$)</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder="0,00"
                                      value={line.cache_modelo ?? ''}
                                      onChange={(e) => updateOsLinha(index, { cache_modelo: e.target.value })}
                                      disabled={osDraft.status === 'recebida'}
                                      className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                                    />
                                  </label>
                                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-slate-300"
                                      checked={Boolean(line.emite_nf_propria)}
                                      onChange={(e) =>
                                        updateOsLinha(index, { emite_nf_propria: e.target.checked })}
                                      disabled={osDraft.status === 'recebida'}
                                    />
                                    Emite NF própria
                                  </label>
                                  <button
                                    type="button"
                                    disabled={osDraft.status === 'recebida' || osDraft.linhas.length <= 1}
                                    className="rounded-md border border-red-200 px-2 py-2 text-xs text-red-700 disabled:opacity-40"
                                    title={osDraft.linhas.length <= 1 ? 'Mínimo de uma linha em “Com modelo”' : 'Remover linha'}
                                    onClick={() => removeOsLinha(index)}
                                  >
                                    Remover
                                  </button>
                                </div>
                                <label className="mt-2 block text-xs text-slate-600">
                                  <span className="mb-0.5 block">Referência da vaga (obrigatória se não houver modelo no cadastro)</span>
                                  <input
                                    value={line.rotulo ?? ''}
                                    onChange={(e) => updateOsLinha(index, { rotulo: e.target.value })}
                                    disabled={osDraft.status === 'recebida'}
                                    placeholder="Ex.: Modelo 1"
                                    className="w-full max-w-md rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                                  />
                                </label>
                                <label className="mt-2 block text-xs text-slate-600">
                                  <span className="mb-0.5 block">Previsão pagamento ao modelo</span>
                                  <input
                                    type="date"
                                    value={line.data_prevista_pagamento || ''}
                                    onChange={(e) =>
                                      updateOsLinha(index, { data_prevista_pagamento: e.target.value || '' })}
                                    disabled={osDraft.status === 'recebida'}
                                    className="w-full max-w-[220px] rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                                  />
                                </label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Taxa agência (%)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={osDraft.agencia_fee_percent ?? ''}
                        onChange={(e) => updateOsDraft('agencia_fee_percent', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Imposto (%)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={osDraft.imposto_percent ?? ''}
                        onChange={(e) => updateOsDraft('imposto_percent', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Extras agência (R$)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={osDraft.extras_agencia_valor ?? ''}
                        onChange={(e) => updateOsDraft('extras_agencia_valor', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Extras despesa (R$)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={osDraft.extras_despesa_valor ?? ''}
                        onChange={(e) => updateOsDraft('extras_despesa_valor', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600 md:col-span-2">
                      <span className="mb-1 block">Descrição das despesas extras</span>
                      <input
                        value={osDraft.extras_despesa_descricao ?? ''}
                        onChange={(e) => updateOsDraft('extras_despesa_descricao', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>

                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Parceiro</span>
                      <select
                        value={osDraft.parceiro_id != null ? String(osDraft.parceiro_id) : ''}
                        onChange={(e) => updateOsDraft('parceiro_id', e.target.value ? Number(e.target.value) : null)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="">Nenhum</option>
                        {parceirosList.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.razao_social_ou_nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Parceiro (% sobre margem)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={osDraft.parceiro_percent ?? ''}
                        onChange={(e) => updateOsDraft('parceiro_percent', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Booker</span>
                      <select
                        value={osDraft.booker_id != null ? String(osDraft.booker_id) : ''}
                        onChange={(e) => updateOsDraft('booker_id', e.target.value ? Number(e.target.value) : null)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="">Nenhum</option>
                        {bookersList.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Booker (% sobre margem após parceiro)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={osDraft.booker_percent ?? ''}
                        onChange={(e) => updateOsDraft('booker_percent', e.target.value)}
                        disabled={osDraft.status === 'recebida'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>

                    <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <label className="flex items-start gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={Boolean(osDraft.emitir_contrato)}
                          onChange={(e) => updateOsDraft('emitir_contrato', e.target.checked)}
                          disabled={osDraft.status === 'recebida'}
                        />
                        <span>
                          <strong>Contrato com cliente</strong> — o texto padrão é montado automaticamente com dados da
                          O.S. e dos cadastros (cliente, modelos, valores calculados no job). Nada é digitado na hora de
                          gerar. Envie por e-mail e arquive o PDF assinado nesta O.S.
                        </span>
                      </label>
                      {osDraft.emitir_contrato && (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <label className="text-sm text-slate-600">
                            <span className="mb-1 block">Versão do template jurídico</span>
                            <input
                              value={osDraft.contrato_template_versao ?? ''}
                              onChange={(e) => updateOsDraft('contrato_template_versao', e.target.value)}
                              disabled={osDraft.status === 'recebida'}
                              placeholder="ex: 2025.1"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2"
                            />
                          </label>
                          <label className="text-sm text-slate-600 md:col-span-2">
                            <span className="mb-1 block">Observação interna (contrato)</span>
                            <input
                              value={osDraft.contrato_observacao ?? ''}
                              onChange={(e) => updateOsDraft('contrato_observacao', e.target.value)}
                              disabled={osDraft.status === 'recebida'}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2"
                            />
                          </label>
                        </div>
                      )}
                      {osDraft.emitir_contrato && osDraft.id && (
                        <div className="mt-3 space-y-3 text-sm">
                          <p>
                            <a
                              href={`${API_BASE}/ordens-servico/${osDraft.id}/contrato-preview`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-amber-800 underline"
                            >
                              Gerar / visualizar contrato (HTML)
                            </a>
                            <span className="text-slate-500">
                              {' '}
                              — impressão ou “Salvar como PDF” no navegador. Conteúdo jurídico definitivo deve ser validado
                              pelo jurídico; os valores acompanham o cálculo da O.S.
                            </span>
                          </p>
                          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-amber-100 bg-white p-3">
                            <label className="min-w-[200px] flex-1 text-sm text-slate-600">
                              <span className="mb-1 block text-xs">Enviar por e-mail (destinatário)</span>
                              <input
                                type="email"
                                value={contratoEmailDest}
                                onChange={(e) => setContratoEmailDest(e.target.value)}
                                placeholder="e-mail do cliente"
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                              />
                            </label>
                            <button
                              type="button"
                              disabled={contratoEmailLoading}
                              className="rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                              style={{ backgroundColor: BRAND_ORANGE }}
                              onClick={enviarContratoPorEmail}
                            >
                              {contratoEmailLoading ? 'Enviando...' : 'Enviar contrato por e-mail'}
                            </button>
                          </div>
                          {contratoEmailMsg && (
                            <p
                              className={`text-xs ${contratoEmailMsg.includes('sucesso') ? 'text-emerald-700' : 'text-red-600'}`}
                            >
                              {contratoEmailMsg}
                            </p>
                          )}
                          {osDraft.contrato_enviado_em && (
                            <p className="text-xs text-slate-500">
                              Último envio registrado em: {String(osDraft.contrato_enviado_em).slice(0, 19).replace('T', ' ')}
                            </p>
                          )}
                        </div>
                      )}
                      {osDraft.contrato_status && (
                        <p className="mt-2 text-xs text-slate-600">
                          Status contrato: <strong>{osDraft.contrato_status}</strong>
                          {osDraft.contrato_assinado_em && (
                            <span className="ml-2">
                              — assinado em {String(osDraft.contrato_assinado_em).slice(0, 10)}
                            </span>
                          )}
                        </p>
                      )}
                    </div>

                    <div className="md:col-span-2 rounded-xl border border-slate-200 p-4">
                      <h4 className="text-sm font-semibold text-slate-800">Documentos desta O.S.</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Arquivos vinculados ao número da O.S. (contrato assinado, anexos).
                      </p>
                      <ul className="mt-3 space-y-2 text-sm">
                        {(osDraft.documentos || []).length === 0 ? (
                          <li className="text-slate-500">Nenhum arquivo ainda.</li>
                        ) : (
                          (osDraft.documentos || []).map((d) => (
                            <li
                              key={d.id}
                              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-2"
                            >
                              <span className="text-xs font-medium uppercase text-slate-500">{d.tipo}</span>
                              <span className="flex-1 truncate">{d.nome_arquivo}</span>
                              <a
                                href={`${API_BASE}/ordens-servico/${osDraft.id}/documentos/${d.id}/download`}
                                className="text-xs font-medium text-amber-700 underline"
                                target="_blank"
                                rel="noreferrer"
                              >
                                Baixar
                              </a>
                              {osDraft.status !== 'recebida' && (
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
                      <label className="mt-3 block text-xs text-slate-600">
                        <span className="mb-1 block font-medium text-slate-700">Enviar contrato assinado (PDF ou imagem)</span>
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
                    </div>

                    <div className="md:col-span-2 grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm md:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <p className="text-xs text-slate-500">Total cliente</p>
                        <p className="font-semibold text-slate-900">{formatBRL(osDraft.total_cliente)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Taxa agência (R$)</p>
                        <p className="font-semibold text-slate-900">{formatBRL(osDraft.taxa_agencia_valor)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Imposto</p>
                        <p className="font-semibold text-slate-900">{formatBRL(osDraft.imposto_valor)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Líquido modelos</p>
                        <p className="font-semibold text-slate-900">{formatBRL(osDraft.modelo_liquido_total)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Agência parcial</p>
                        <p className="font-semibold text-slate-900">{formatBRL(osDraft.agencia_parcial)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Parceiro</p>
                        <p className="font-semibold text-slate-900">{formatBRL(osDraft.parceiro_valor)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Após parceiro</p>
                        <p className="font-semibold text-slate-900">{formatBRL(osDraft.agencia_apos_parceiro)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Booker</p>
                        <p className="font-semibold text-slate-900">{formatBRL(osDraft.booker_valor)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Agência final</p>
                        <p className="font-semibold text-slate-900">{formatBRL(osDraft.agencia_final)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Resultado agência</p>
                        <p className="font-semibold text-slate-900">{formatBRL(osDraft.resultado_agencia)}</p>
                      </div>
                    </div>

                    <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <h4 className="text-sm font-semibold text-slate-800">Histórico de alterações</h4>
                      <p className="text-xs text-slate-500">
                        Alterações na O.S. ficam registradas com data, usuário e campos modificados.
                      </p>
                      {(osDraft.historico || []).length === 0 ? (
                        <p className="mt-2 text-sm text-slate-500">Nenhum registro ainda.</p>
                      ) : (
                        <ul className="mt-2 max-h-52 space-y-2 overflow-y-auto text-xs">
                          {(osDraft.historico || []).map((h) => (
                            <li key={h.id} className="rounded border border-slate-100 bg-white p-2">
                              <span className="font-medium text-slate-700">{h.campo}</span>
                              <span className="text-slate-500">
                                {' '}
                                — {h.usuario} — {String(h.created_at || '').slice(0, 19).replace('T', ' ')}
                              </span>
                              <div className="mt-1 text-slate-600">Anterior: {h.valor_anterior ?? '—'}</div>
                              <div>Novo: {h.valor_novo ?? '—'}</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {osDraft.status !== 'recebida' && (
                      <label className="md:col-span-2 text-sm text-slate-600">
                        <span className="mb-1 block font-medium">
                          Usuário (obrigatório ao salvar alterações)
                        </span>
                        <input
                          value={osUsuarioAlteracao}
                          onChange={(e) => setOsUsuarioAlteracao(e.target.value)}
                          placeholder="Nome de quem está alterando"
                          className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2"
                        />
                      </label>
                    )}

                    {osDraft.status !== 'recebida' && (
                      <div className="md:col-span-2">
                        <button
                          type="submit"
                          disabled={osSaving}
                          className="rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                          style={{ backgroundColor: BRAND_ORANGE }}
                        >
                          {osSaving ? 'Salvando...' : 'Salvar O.S.'}
                        </button>
                      </div>
                    )}
                  </form>
                  {osError && osDraft && <p className="mt-3 text-sm font-medium text-red-600">{osError}</p>}
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
