import { useEffect, useMemo, useState } from 'react';
import DynamicTextListField from './components/DynamicTextListField';
import OperacaoCalendar from './components/OperacaoCalendar';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const formatBRL = (value) => {
  const n = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(n) ? n : 0);
};
const CADASTROS_COM_MULTI_PAGAMENTO = ['modelos', 'bookers', 'parceiros'];
const BRAND_ORANGE = '#F59E0B';
const LOAD_ERROR_MESSAGE = 'Erro ao carregar dados. Verifique conexão com servidor.';

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
  formas_pagamento: 'Formas de pagamento',
  razao_social_ou_nome: 'Razão social ou nome',
  cnpj_ou_cpf: 'CNPJ ou CPF',
  tipo_servico: 'Tipo de serviço',
  contato: 'Contato',
};

const labelForField = (field) => fieldLabels[field] || field;
const emptyFormaRecebimento = { tipo: 'PIX', tipo_chave_pix: 'CPF', valor: '' };
const normalizeFormasRecebimento = (formas) => {
  if (!Array.isArray(formas) || formas.length === 0) return [{ ...emptyFormaRecebimento }];
  return formas.map((item) => {
    if (typeof item === 'string') {
      return { tipo: 'PIX', valor: item };
    }
    return {
      tipo: item?.tipo === 'Conta bancária' ? 'Conta bancária' : 'PIX',
      tipo_chave_pix: item?.tipo_chave_pix || 'CPF',
      valor: item?.valor || '',
    };
  });
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
    endpoint: 'clients',
    columns: ['nome_empresa', 'tipo_pessoa', 'documento', 'contato_principal', 'documento_representante', 'telefones', 'emails'],
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
      observacoes: '',
    },
  },
  modelos: {
    label: 'Modelos',
    endpoint: 'modelos',
    columns: ['nome', 'cpf', 'data_nascimento', 'telefones', 'emails', 'formas_pagamento'],
    form: {
      nome: '',
      cpf: '',
      data_nascimento: '',
      telefones: [''],
      emails: [''],
      emite_nf_propria: false,
      formas_pagamento: [{ ...emptyFormaRecebimento }],
      responsavel_nome: '',
      responsavel_cpf: '',
      responsavel_telefone: '',
      observacoes: '',
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

function App() {
  const [module, setModule] = useState('inicio');
  const [tab, setTab] = useState('clientes');
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(cadastroConfig.clientes.form);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [apiOnline, setApiOnline] = useState(true);
  const [clients, setClients] = useState([]);
  const [orcamentos, setOrcamentos] = useState([]);
  const [orcamentoForm, setOrcamentoForm] = useState({
    cliente_id: '',
    tipo_trabalho: '',
    descricao: '',
    cache_base_estimado_total: '',
    taxa_agencia_percent: '',
    extras_agencia_valor: '',
    condicoes_pagamento: '',
    uso_imagem: '',
    prazo: '',
    territorio: '',
  });
  const [orcamentoEditingId, setOrcamentoEditingId] = useState(null);
  const [orcamentoError, setOrcamentoError] = useState('');
  const [orcamentoLoading, setOrcamentoLoading] = useState(false);

  const [osList, setOsList] = useState([]);
  const [osLoading, setOsLoading] = useState(false);
  const [osError, setOsError] = useState('');
  const [osSaving, setOsSaving] = useState(false);
  const [osDraft, setOsDraft] = useState(null);
  const [modelosList, setModelosList] = useState([]);
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
  }, [tab]);

  const refreshAlertasOperacionais = async () => {
    try {
      const response = await fetch(`${API_URL}/dashboard/alertas`);
      if (response.ok) setAlertasOperacionais(await response.json());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const checkApi = async () => {
      try {
        const response = await fetch(`${API_URL}/health`);
        setApiOnline(response.ok);
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
          fetch(`${API_URL}/dashboard/alertas`),
          fetch(`${API_URL}/financeiro/resumo`),
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
        const r = await fetch(`${API_URL}/financeiro/os/${finForm.os_id}/contexto`);
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
        const response = await fetch(`${API_URL}/${current.endpoint}`);
        if (!response.ok) throw new Error(LOAD_ERROR_MESSAGE);
        const data = await response.json();
        setItems(data);
        setError('');
      } catch {
        setError(LOAD_ERROR_MESSAGE);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [current.endpoint, module]);

  useEffect(() => {
    const loadClients = async () => {
      try {
        const response = await fetch(`${API_URL}/clients`);
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
    const loadOrcamentos = async () => {
      try {
        setOrcamentoLoading(true);
        const response = await fetch(`${API_URL}/orcamentos`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        setOrcamentos(data);
        setOrcamentoError('');
      } catch {
        setOrcamentoError(LOAD_ERROR_MESSAGE);
      } finally {
        setOrcamentoLoading(false);
      }
    };
    loadOrcamentos();
  }, [module]);

  useEffect(() => {
    if (module === 'jobs') refreshAlertasOperacionais();
  }, [module]);

  useEffect(() => {
    if (module !== 'financeiro') return;
    const load = async () => {
      setFinLoading(true);
      setFinError('');
      try {
        const [r1, r2, r3] = await Promise.all([
          fetch(`${API_URL}/financeiro/resumo`),
          fetch(`${API_URL}/financeiro/recebimentos`),
          fetch(`${API_URL}/ordens-servico`),
        ]);
        if (!r1.ok || !r2.ok || !r3.ok) throw new Error();
        setFinResumo(await r1.json());
        setFinRecebimentos(await r2.json());
        setFinOsOptions(await r3.json());
      } catch {
        setFinError(LOAD_ERROR_MESSAGE);
      } finally {
        setFinLoading(false);
      }
    };
    load();
  }, [module]);

  useEffect(() => {
    if (module !== 'extrato') return;
    const load = async () => {
      setExtratoLoading(true);
      setExtratoError('');
      try {
        const [mRes, exRes] = await Promise.all([
          fetch(`${API_URL}/modelos`),
          fetch(
            extratoModeloFilter
              ? `${API_URL}/extrato-modelo?modelo_id=${encodeURIComponent(extratoModeloFilter)}`
              : `${API_URL}/extrato-modelo`,
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
          fetch(`${API_URL}/ordens-servico`),
          fetch(`${API_URL}/modelos`),
          fetch(`${API_URL}/bookers`),
          fetch(`${API_URL}/parceiros`),
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
      const response = await fetch(`${API_URL}/ordens-servico/${id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || LOAD_ERROR_MESSAGE);
      setOsDraft({
        ...data,
        linhas: Array.isArray(data.linhas)
          ? data.linhas.map((l) => ({
            id: l.id,
            modelo_id: l.modelo_id,
            cache_modelo: l.cache_modelo,
            emite_nf_propria: Boolean(l.emite_nf_propria),
            data_prevista_pagamento: l.data_prevista_pagamento
              ? String(l.data_prevista_pagamento).slice(0, 10)
              : '',
          }))
          : [],
        documentos: Array.isArray(data.documentos) ? data.documentos : [],
      });
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
      const firstModelo = modelosList[0]?.id;
      return {
        ...prev,
        linhas: [
          ...prev.linhas,
          { modelo_id: firstModelo || '', cache_modelo: '', emite_nf_propria: false, data_prevista_pagamento: '' },
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
      if (tipo === 'com_modelo' && osDraft.linhas.length > 0) {
        payload.linhas = osDraft.linhas.map((l) => ({
          modelo_id: Number(l.modelo_id),
          cache_modelo: Number(l.cache_modelo),
          emite_nf_propria: Boolean(l.emite_nf_propria),
          data_prevista_pagamento: l.data_prevista_pagamento || null,
        }));
      }
      if (tipo === 'com_modelo' && osDraft.linhas.length === 0) {
        payload.cache_modelo_total = Number(osDraft.cache_modelo_total ?? 0);
      }

      const response = await fetch(`${API_URL}/ordens-servico/${osDraft.id}`, {
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
            modelo_id: l.modelo_id,
            cache_modelo: l.cache_modelo,
            emite_nf_propria: Boolean(l.emite_nf_propria),
            data_prevista_pagamento: l.data_prevista_pagamento
              ? String(l.data_prevista_pagamento).slice(0, 10)
              : '',
          }))
          : [],
        documentos: Array.isArray(data.documentos) ? data.documentos : [],
      });
      if (data.cliente_email) setContratoEmailDest(String(data.cliente_email));
      const listRes = await fetch(`${API_URL}/ordens-servico`);
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
      const res = await fetch(`${API_URL}/ordens-servico/${osDraft.id}/documentos`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro no upload.');
      await loadOsDetail(osDraft.id);
      await refreshAlertasOperacionais();
      const listRes = await fetch(`${API_URL}/ordens-servico`);
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
      const r = await fetch(`${API_URL}/ordens-servico/${osDraft.id}/contrato-enviar-email`, {
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
      const res = await fetch(`${API_URL}/ordens-servico/${osDraft.id}/documentos/${docId}`, { method: 'DELETE' });
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
      const res = await fetch(`${API_URL}/financeiro/recebimentos`, {
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
        fetch(`${API_URL}/financeiro/resumo`),
        fetch(`${API_URL}/financeiro/recebimentos`),
        fetch(`${API_URL}/ordens-servico`),
      ]);
      if (r1.ok) setFinResumo(await r1.json());
      if (r2.ok) setFinRecebimentos(await r2.json());
      if (r3.ok) setFinOsOptions(await r3.json());
      await refreshAlertasOperacionais();
    } catch (e) {
      setFinError(e.message || LOAD_ERROR_MESSAGE);
    }
  };

  const savePagamentoModelo = async (event) => {
    event.preventDefault();
    setExtratoError('');
    try {
      const res = await fetch(`${API_URL}/financeiro/pagamentos-modelo`, {
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
          ? `${API_URL}/extrato-modelo?modelo_id=${encodeURIComponent(extratoModeloFilter)}`
          : `${API_URL}/extrato-modelo`,
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

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId
        ? `${API_URL}/${current.endpoint}/${editingId}`
        : `${API_URL}/${current.endpoint}`;

      const payload = { ...form };
      if (Array.isArray(form.formas_pagamento)) {
        payload.formas_pagamento = form.formas_pagamento
          .map((item) => ({
            tipo: item?.tipo === 'Conta bancária' ? 'Conta bancária' : 'PIX',
            tipo_chave_pix: item?.tipo === 'PIX' ? (item?.tipo_chave_pix || 'CPF') : null,
            valor: (item?.valor || '').trim(),
          }))
          .filter((item) => item.valor);
      }

      if (hasDynamicContacts) {
        const telefones = normalizeDynamicTextList(form.telefones).map((item) => item.trim()).filter(Boolean);
        const emails = normalizeDynamicTextList(form.emails).map((item) => item.trim()).filter(Boolean);
        if (telefones.length === 0 || emails.length === 0) {
          setError('Informe ao menos um telefone e um email.');
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
      if (isModeloTab && !String(form.cpf || '').trim()) {
        setError('CPF do modelo é obrigatório (contrato).');
        return;
      }
      if (isClienteTab) {
        if (!String(form.documento_representante || '').trim()) {
          setError('Informe o CPF do representante legal (campo próprio; não é o CNPJ da empresa).');
          return;
        }
        if (!String(form.inscricao_estadual || '').trim()) {
          setError('Inscrição estadual é obrigatória para o contrato (use “ISENTO” se aplicável).');
          return;
        }
        if (
          !String(form.logradouro || '').trim()
          || !String(form.cidade || '').trim()
          || !String(form.uf || '').trim()
        ) {
          setError('Preencha logradouro, cidade e UF para montar o endereço completo no contrato.');
          return;
        }
        payload.cnpj = form.documento;
        payload.endereco_completo = `${form.logradouro || ''}, ${form.numero || ''} - ${form.bairro || ''}, ${form.cidade || ''}/${form.uf || ''} CEP ${form.cep || ''}`.trim();
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Erro ao salvar cadastro.');
      }

      const saved = await response.json();

      if (editingId) {
        setItems((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
      } else {
        setItems((prev) => [saved, ...prev]);
      }

      setError('');
      setEditingId(null);
      setForm(current.form);
    } catch {
      setError('Erro ao salvar cadastro. Verifique conexão com servidor.');
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    const nextForm = {
      ...item,
      formas_pagamento: normalizeFormasRecebimento(item.formas_pagamento),
    };
    if (tab === 'modelos') {
      nextForm.telefones = normalizeDynamicTextList(item.telefones?.length ? item.telefones : [item.telefone]);
      nextForm.emails = normalizeDynamicTextList(item.emails?.length ? item.emails : [item.email]);
      nextForm.data_nascimento = item.data_nascimento || '';
      nextForm.responsavel_nome = item.responsavel_nome || '';
      nextForm.responsavel_cpf = item.responsavel_cpf || '';
      nextForm.responsavel_telefone = item.responsavel_telefone || '';
    }
    if (tab === 'clientes') {
      nextForm.telefones = normalizeDynamicTextList(item.telefones?.length ? item.telefones : [item.telefone]);
      nextForm.emails = normalizeDynamicTextList(item.emails?.length ? item.emails : [item.email]);
      nextForm.tipo_pessoa = item.tipo_pessoa || 'PJ';
      nextForm.documento = item.documento || item.cnpj || '';
      nextForm.documento_representante = item.documento_representante || '';
      nextForm.cep = item.cep || '';
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
      const response = await fetch(`${API_URL}/${current.endpoint}/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Erro ao deletar cadastro.');
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setForm(current.form);
      }
    } catch {
      setError('Erro ao deletar cadastro. Verifique conexão com servidor.');
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
      formas_pagamento: normalizeFormasRecebimento(prev.formas_pagamento).map((item, itemIndex) => (
        itemIndex === index ? { ...item, [key]: value } : item
      )),
    }));
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

  const saveOrcamento = async (event) => {
    event.preventDefault();
    setOrcamentoError('');
    try {
      const method = orcamentoEditingId ? 'PUT' : 'POST';
      const url = orcamentoEditingId
        ? `${API_URL}/orcamentos/${orcamentoEditingId}`
        : `${API_URL}/orcamentos`;

      const payload = {
        ...orcamentoForm,
        cliente_id: Number(orcamentoForm.cliente_id),
        cache_base_estimado_total: Number(orcamentoForm.cache_base_estimado_total),
        taxa_agencia_percent: Number(orcamentoForm.taxa_agencia_percent),
        extras_agencia_valor: Number(orcamentoForm.extras_agencia_valor),
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

      const saved = await response.json();
      if (orcamentoEditingId) {
        setOrcamentos((prev) => prev.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)));
      } else {
        setOrcamentos((prev) => [saved, ...prev]);
      }

      setOrcamentoEditingId(null);
      setOrcamentoForm({
        cliente_id: '',
        tipo_trabalho: '',
        descricao: '',
        cache_base_estimado_total: '',
        taxa_agencia_percent: '',
        extras_agencia_valor: '',
        condicoes_pagamento: '',
        uso_imagem: '',
        prazo: '',
        territorio: '',
      });

      const refresh = await fetch(`${API_URL}/orcamentos`);
      if (refresh.ok) setOrcamentos(await refresh.json());
    } catch (requestError) {
      setOrcamentoError(requestError.message);
    }
  };

  const editOrcamento = (item) => {
    setOrcamentoEditingId(item.id);
    setOrcamentoForm({
      cliente_id: String(item.cliente_id),
      tipo_trabalho: item.tipo_trabalho,
      descricao: item.descricao,
      cache_base_estimado_total: item.cache_base_estimado_total,
      taxa_agencia_percent: item.taxa_agencia_percent,
      extras_agencia_valor: item.extras_agencia_valor,
      condicoes_pagamento: item.condicoes_pagamento,
      uso_imagem: item.uso_imagem,
      prazo: item.prazo,
      territorio: item.territorio,
    });
  };

  const aprovarOrcamento = async (id) => {
    if (!window.confirm('Aprovar este orçamento e gerar O.S.?')) return;
    setOrcamentoError('');
    try {
      const response = await fetch(`${API_URL}/orcamentos/${id}/aprovar`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Erro ao aprovar orçamento.');
      const refresh = await fetch(`${API_URL}/orcamentos`);
      if (refresh.ok) setOrcamentos(await refresh.json());
      alert(data.message);
    } catch (requestError) {
      setOrcamentoError(requestError.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F7F7] text-slate-900">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 p-5 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <img src="/logo-andy.png" alt="Andy Management" className="h-14 w-auto" />
          <p className="mt-3 text-sm text-slate-500">CRM financeiro - Cadastros, orçamentos e O.S.</p>
          <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setModule('inicio')}
              className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition"
              style={{
                backgroundColor: module === 'inicio' ? BRAND_ORANGE : '#fff',
                color: module === 'inicio' ? '#fff' : '#334155',
              }}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setModule('cadastros')}
              className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition"
              style={{
                backgroundColor: module === 'cadastros' ? BRAND_ORANGE : '#fff',
                color: module === 'cadastros' ? '#fff' : '#334155',
              }}
            >
              Cadastros
            </button>
            <button
              type="button"
              onClick={() => setModule('orcamentos')}
              className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition"
              style={{
                backgroundColor: module === 'orcamentos' ? BRAND_ORANGE : '#fff',
                color: module === 'orcamentos' ? '#fff' : '#334155',
              }}
            >
              Orçamentos
            </button>
            <button
              type="button"
              onClick={() => {
                setModule('jobs');
                setOsDraft(null);
              }}
              className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition"
              style={{
                backgroundColor: module === 'jobs' ? BRAND_ORANGE : '#fff',
                color: module === 'jobs' ? '#fff' : '#334155',
              }}
            >
              Jobs / O.S.
            </button>
            <button
              type="button"
              onClick={() => setModule('financeiro')}
              className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition"
              style={{
                backgroundColor: module === 'financeiro' ? BRAND_ORANGE : '#fff',
                color: module === 'financeiro' ? '#fff' : '#334155',
              }}
            >
              Financeiro
            </button>
            <button
              type="button"
              onClick={() => setModule('extrato')}
              className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition"
              style={{
                backgroundColor: module === 'extrato' ? BRAND_ORANGE : '#fff',
                color: module === 'extrato' ? '#fff' : '#334155',
              }}
            >
              Extrato modelo
            </button>
          </div>
          {module === 'cadastros' && <nav className="mt-6 space-y-2">
            {tabEntries.map(([key, value]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition"
                style={{
                  backgroundColor: tab === key ? BRAND_ORANGE : '#fff',
                  color: tab === key ? '#fff' : '#334155',
                }}
              >
                {value.label}
              </button>
            ))}
          </nav>}
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
                API offline em `{API_URL}`. Verifique se o backend está rodando e se o `.env` do frontend está correto.
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold">
                  {module === 'cadastros'
                    ? current.label
                    : module === 'orcamentos'
                      ? 'Orçamentos'
                      : module === 'inicio'
                        ? 'Dashboard'
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
                      ? 'Orçamento comercial sem modelos e sem financeiro.'
                      : module === 'inicio'
                        ? 'Caixa, resultado da agência e pendências (contrato, receber, pagar modelos).'
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
                    ? `${orcamentos.length} registros`
                    : module === 'inicio'
                      ? dashboardResumo
                        ? `${formatBRL(dashboardResumo.saldo_aproximado)} caixa`
                        : '—'
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
                      ? 'Comercial'
                      : module === 'inicio'
                        ? 'Operação'
                        : module === 'financeiro'
                          ? 'Recebimentos'
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
                apiUrl={API_URL}
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
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Faturado em O.S. não recebidas</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(dashboardResumo.total_faturado_os_abertas)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs text-amber-800">Saldo aprox. de caixa</p>
                        <p className="text-lg font-semibold text-amber-950">
                          {formatBRL(dashboardResumo.saldo_aproximado)}
                        </p>
                        <p className="mt-1 text-[11px] text-amber-900/80">Recebimentos − pagamentos a modelos</p>
                      </div>
                    </div>
                    <p className="mt-4 text-xs font-medium text-slate-600">
                      Indicadores derivados das O.S. (somas das colunas gravadas em cada job).
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
                        <p className="text-xs text-slate-500">Σ Resultado agência</p>
                        <p className="text-lg font-semibold text-slate-900">
                          {formatBRL(dashboardResumo.soma_resultado_agencia_os)}
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
                  Caixa: recebimentos e pagamentos a modelos. Abaixo, somas das colunas já gravadas em cada O.S. (mesmos
                  números do job — sem recálculo).
                </p>
                {finLoading ? (
                  <p className="mt-3 text-sm text-slate-500">Carregando...</p>
                ) : finResumo ? (
                  <>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Total recebido (cliente)</p>
                        <p className="text-lg font-semibold text-slate-900">{formatBRL(finResumo.total_recebido_cliente)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Total pago a modelos</p>
                        <p className="text-lg font-semibold text-slate-900">{formatBRL(finResumo.total_pago_modelos)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Soma total cliente (O.S. abertas)</p>
                        <p className="text-lg font-semibold text-slate-900">{formatBRL(finResumo.total_faturado_os_abertas)}</p>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs text-amber-800">Saldo aprox. (rec. − pag. modelos)</p>
                        <p className="text-lg font-semibold text-amber-950">{formatBRL(finResumo.saldo_aproximado)}</p>
                      </div>
                    </div>
                    <p className="mt-4 text-xs font-medium text-slate-600">Totais das O.S. (todas — colunas do job)</p>
                    <div className="mt-2 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Σ Total cliente</p>
                        <p className="text-lg font-semibold text-slate-900">{formatBRL(finResumo.soma_total_cliente_os)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Σ Líquido modelos</p>
                        <p className="text-lg font-semibold text-slate-900">{formatBRL(finResumo.soma_modelo_liquido_os)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Σ Parceiros</p>
                        <p className="text-lg font-semibold text-slate-900">{formatBRL(finResumo.soma_parceiro_valor_os)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">Σ Booker</p>
                        <p className="text-lg font-semibold text-slate-900">{formatBRL(finResumo.soma_booker_valor_os)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-amber-50 p-3">
                        <p className="text-xs text-amber-900">Σ Resultado agência</p>
                        <p className="text-lg font-semibold text-amber-950">{formatBRL(finResumo.soma_resultado_agencia_os)}</p>
                      </div>
                    </div>
                  </>
                ) : null}
                {finError && <p className="mt-3 text-sm text-red-600">{finError}</p>}
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-800">Novo recebimento (cliente)</h3>
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
                      {modelosList.map((m) => (
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

          {module === 'cadastros' && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={onSubmit}>
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
                      onUpdate={(index, value) => updateDynamicItem(field, index, value)}
                      onRemove={(index) => removeDynamicItem(field, index)}
                    />
                  );
                }

                if (field === 'formas_pagamento') {
                  return (
                    <div key={field} className="md:col-span-2 rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">Formas de recebimento</span>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                          onClick={addFormaPagamento}
                        >
                          + adicionar
                        </button>
                      </div>
                      <div className="space-y-2">
                        {normalizeFormasRecebimento(form.formas_pagamento).map((forma, index) => (
                          <div key={`forma-${index}`} className="grid gap-2 md:grid-cols-[160px_170px_1fr_auto]">
                            <select
                              value={forma.tipo}
                              onChange={(event) => updateFormaPagamento(index, 'tipo', event.target.value)}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            >
                              <option value="PIX">PIX</option>
                              <option value="Conta bancária">Conta bancária</option>
                            </select>
                            <select
                              value={forma.tipo === 'PIX' ? (forma.tipo_chave_pix || 'CPF') : 'Conta'}
                              onChange={(event) => updateFormaPagamento(index, 'tipo_chave_pix', event.target.value)}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                              disabled={forma.tipo !== 'PIX'}
                            >
                              <option value="CPF">CPF</option>
                              <option value="Celular">Celular</option>
                              <option value="E-mail">E-mail</option>
                              <option value="Aleatória">Aleatória</option>
                              <option value="Conta">Conta bancária</option>
                            </select>
                            <input
                              value={forma.valor}
                              onChange={(event) => updateFormaPagamento(index, 'valor', event.target.value)}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
                              placeholder={forma.tipo === 'PIX' ? 'Ex: pix@agencia.com' : 'Ex: Banco X Ag 0001 Conta 12345-6'}
                            />
                            <button
                              type="button"
                              className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700"
                              onClick={() => removeFormaPagamento(index)}
                            >
                              remover
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }

                if (isModeloTab && (field === 'responsavel_nome' || field === 'responsavel_cpf' || field === 'responsavel_telefone') && !isMinor) {
                  return null;
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
                        onChange={(event) => onChange('tipo_pessoa', event.target.value)}
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
                    'documento_representante',
                    'inscricao_estadual',
                    'cep',
                    'logradouro',
                    'cidade',
                    'uf',
                  ].includes(field);
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
                      onChange={(event) => onChange(field, event.target.value)}
                      onBlur={isClienteTab && field === 'cep' ? buscarEnderecoPorCep : undefined}
                      required={contractRequiredCliente || (isModeloTab && field === 'cpf')}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
                    />
                  </label>
                );
              })}

              <div className="md:col-span-2 flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  className="rounded-xl px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  {editingId ? 'Atualizar cadastro' : 'Salvar cadastro'}
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
            {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
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
                              ? `${normalizeFormasRecebimento(item.formas_pagamento).length} forma(s)`
                              : column === 'telefones'
                                ? `${normalizeDynamicTextList(item.telefones?.length ? item.telefones : [item.telefone]).filter(Boolean).length} telefone(s)`
                                : column === 'emails'
                                  ? `${normalizeDynamicTextList(item.emails?.length ? item.emails : [item.email]).filter(Boolean).length} email(s)`
                              : String(item[column] ?? '')}
                          </td>
                        ))}
                        <td className="px-2 py-2 space-x-2">
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
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={saveOrcamento}>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Cliente</span>
                    <select
                      value={orcamentoForm.cliente_id}
                      onChange={(event) => onChangeOrcamento('cliente_id', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      <option value="">Selecione</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.nome_empresa}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Tipo de trabalho</span>
                    <input value={orcamentoForm.tipo_trabalho} onChange={(event) => onChangeOrcamento('tipo_trabalho', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="text-sm text-slate-600 md:col-span-2">
                    <span className="mb-1 block">Descrição</span>
                    <input value={orcamentoForm.descricao} onChange={(event) => onChangeOrcamento('descricao', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Cachê base estimado (total)</span>
                    <input type="number" value={orcamentoForm.cache_base_estimado_total} onChange={(event) => onChangeOrcamento('cache_base_estimado_total', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Taxa da agência (%)</span>
                    <input type="number" value={orcamentoForm.taxa_agencia_percent} onChange={(event) => onChangeOrcamento('taxa_agencia_percent', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="text-sm text-slate-600">
                    <span className="mb-1 block">Extras da agência (valor)</span>
                    <input type="number" value={orcamentoForm.extras_agencia_valor} onChange={(event) => onChangeOrcamento('extras_agencia_valor', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
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
                  <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                    <button type="submit" className="rounded-xl px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: BRAND_ORANGE }}>
                      {orcamentoEditingId ? 'Atualizar orçamento' : 'Salvar orçamento'}
                    </button>
                    {orcamentoEditingId && (
                      <a
                        href={`${API_URL}/orcamentos/${orcamentoEditingId}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-slate-700 underline"
                      >
                        Ver proposta para impressão / PDF
                      </a>
                    )}
                    {orcamentoEditingId && (
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                        onClick={() => {
                          setOrcamentoEditingId(null);
                          setOrcamentoForm({
                            cliente_id: '',
                            tipo_trabalho: '',
                            descricao: '',
                            cache_base_estimado_total: '',
                            taxa_agencia_percent: '',
                            extras_agencia_valor: '',
                            condicoes_pagamento: '',
                            uso_imagem: '',
                            prazo: '',
                            territorio: '',
                          });
                        }}
                      >
                        Cancelar edição
                      </button>
                    )}
                  </div>
                </form>
                {orcamentoError && <p className="mt-3 text-sm font-medium text-red-600">{orcamentoError}</p>}
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold">Lista de orçamentos</h3>
                  <span className="text-xs font-medium text-slate-500">Aprovar gera O.S. automaticamente</span>
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
                          <th className="px-2 py-2 font-medium">Cachê base</th>
                          <th className="px-2 py-2 font-medium">Taxa agência</th>
                          <th className="px-2 py-2 font-medium">Status</th>
                          <th className="px-2 py-2 font-medium">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orcamentos.map((item) => (
                          <tr key={item.id} className="border-b border-slate-100">
                            <td className="px-2 py-2">{item.nome_empresa || item.nome_fantasia}</td>
                            <td className="px-2 py-2">{item.tipo_trabalho}</td>
                            <td className="px-2 py-2">R$ {Number(item.cache_base_estimado_total).toFixed(2)}</td>
                            <td className="px-2 py-2">{Number(item.taxa_agencia_percent).toFixed(2)}%</td>
                            <td className="px-2 py-2">{item.status}</td>
                            <td className="px-2 py-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                                  onClick={() => editOrcamento(item)}
                                  disabled={item.status !== 'rascunho'}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                                  style={{ backgroundColor: BRAND_ORANGE }}
                                  onClick={() => aprovarOrcamento(item.id)}
                                  disabled={item.status !== 'rascunho'}
                                >
                                  Aprovar
                                </button>
                                <a
                                  href={`${API_URL}/orcamentos/${item.id}/pdf`}
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
              </section>
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
                                  href={`${API_URL}/ordens-servico/${row.id}/pdf`}
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
                        href={`${API_URL}/ordens-servico/${osDraft.id}/pdf`}
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

                  <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={saveOs}>
                    <label className="text-sm text-slate-600">
                      <span className="mb-1 block">Tipo de O.S.</span>
                      <select
                        value={osDraft.tipo_os || 'com_modelo'}
                        onChange={(e) => updateOsDraft('tipo_os', e.target.value)}
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

                    {osDraft.tipo_os === 'com_modelo' && osDraft.linhas.length === 0 && (
                      <label className="text-sm text-slate-600 md:col-span-2">
                        <span className="mb-1 block">Cachê modelo total (até definir linhas)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={osDraft.cache_modelo_total ?? ''}
                          onChange={(e) => updateOsDraft('cache_modelo_total', e.target.value)}
                          disabled={osDraft.status === 'recebida'}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                      </label>
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
                              href={`${API_URL}/ordens-servico/${osDraft.id}/contrato-preview`}
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
                                href={`${API_URL}/ordens-servico/${osDraft.id}/documentos/${d.id}/download`}
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

                    {osDraft.tipo_os === 'com_modelo' && (
                      <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-700">Linhas de modelo</span>
                          <button
                            type="button"
                            disabled={osDraft.status === 'recebida'}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                            onClick={addOsLinha}
                          >
                            + Linha
                          </button>
                        </div>
                        {osDraft.linhas.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            Nenhuma linha ainda — valores usam o cachê total acima ou adicione modelos.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {osDraft.linhas.map((line, index) => (
                              <div
                                key={line.id ?? `new-${index}`}
                                className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"
                              >
                                <div className="grid gap-2 md:grid-cols-[1fr_140px_auto_auto]">
                                  <select
                                    value={line.modelo_id ?? ''}
                                    onChange={(e) =>
                                      updateOsLinha(index, { modelo_id: e.target.value ? Number(e.target.value) : '' })}
                                    disabled={osDraft.status === 'recebida'}
                                    className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                                  >
                                    <option value="">Modelo</option>
                                    {modelosList.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.nome}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    step="0.01"
                                    placeholder="Cachê"
                                    value={line.cache_modelo ?? ''}
                                    onChange={(e) => updateOsLinha(index, { cache_modelo: e.target.value })}
                                    disabled={osDraft.status === 'recebida'}
                                    className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                                  />
                                  <label className="flex items-center gap-2 text-xs text-slate-600">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(line.emite_nf_propria)}
                                      onChange={(e) => updateOsLinha(index, { emite_nf_propria: e.target.checked })}
                                      disabled={osDraft.status === 'recebida'}
                                    />
                                    NF própria
                                  </label>
                                  <button
                                    type="button"
                                    disabled={osDraft.status === 'recebida'}
                                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700"
                                    onClick={() => removeOsLinha(index)}
                                  >
                                    remover
                                  </button>
                                </div>
                                <label className="block text-xs text-slate-600">
                                  <span className="mb-0.5 block">Previsão pagamento ao modelo (calendário)</span>
                                  <input
                                    type="date"
                                    value={line.data_prevista_pagamento || ''}
                                    onChange={(e) =>
                                      updateOsLinha(index, { data_prevista_pagamento: e.target.value || '' })}
                                    disabled={osDraft.status === 'recebida'}
                                    className="w-full max-w-[200px] rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                                  />
                                </label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

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
