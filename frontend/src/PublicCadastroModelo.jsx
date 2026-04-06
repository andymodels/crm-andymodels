import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DynamicTextListField from './components/DynamicTextListField';
import { API_BASE, fetchWithTimeout, throwIfHtmlOrCannotPost } from './apiConfig';
import { sanitizeAndValidateModelo, onlyDigits } from './utils/brValidators';
import { sanitizeAndValidateFormasPagamentoArray } from './utils/formasPagamento';
import { formatCpfDisplay, formatPhoneDisplay, formatCepDisplay } from './utils/brMasks';

const BRAND_ORANGE = '#F59E0B';
const SUCCESS_TEXT = 'Cadastro recebido com sucesso. Obrigado pela atualização.';

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
  const arr = Array.isArray(formas) ? formas : [];
  if (arr.length === 0) return [{ ...emptyFormaRecebimento }];
  return arr.map((item) => {
    const tipo = item?.tipo === 'Conta bancária' ? 'Conta bancária' : 'PIX';
    if (tipo === 'PIX') {
      return {
        ...emptyFormaRecebimento,
        tipo: 'PIX',
        tipo_chave_pix: item?.tipo_chave_pix || 'CPF',
        chave_pix: String(item?.chave_pix || item?.valor || ''),
      };
    }
    return {
      ...emptyFormaRecebimento,
      tipo: 'Conta bancária',
      banco: String(item?.banco || ''),
      agencia: String(item?.agencia || ''),
      conta: String(item?.conta || item?.valor || ''),
      tipo_conta: item?.tipo_conta === 'poupanca' ? 'poupanca' : 'corrente',
    };
  });
};

const normalizeDynamicTextList = (items) => {
  if (!Array.isArray(items) || items.length === 0) return [''];
  return items.map((item) => String(item || ''));
};

const trimStr = (v) => String(v ?? '').trim();

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

const emptyForm = () => ({
  nome: '',
  cpf: '',
  passaporte: '',
  rg: '',
  data_nascimento: '',
  senha_acesso: '',
  foto_perfil_base64: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  telefones: [''],
  emails: [''],
  sexo: '',
  emite_nf_propria: false,
  formas_pagamento: [{ ...emptyFormaRecebimento }],
  responsavel_nome: '',
  responsavel_cpf: '',
  responsavel_telefone: '',
  observacoes: '',
  medida_altura: '',
  medida_busto: '',
  medida_torax: '',
  medida_cintura: '',
  medida_quadril: '',
  medida_sapato: '',
  medida_cabelo: '',
  medida_olhos: '',
});

function validateMedidasLocal(form) {
  const sl = trimStr(form.sexo).toLowerCase();
  if (sl !== 'masculino' && sl !== 'feminino') return 'Informe o sexo como Masculino ou Feminino.';
  const need = sl === 'feminino'
    ? [['medida_altura', 'Altura'], ['medida_busto', 'Busto'], ['medida_cintura', 'Cintura'], ['medida_quadril', 'Quadril'], ['medida_sapato', 'Sapato'], ['medida_cabelo', 'Cabelo'], ['medida_olhos', 'Olhos']]
    : [['medida_altura', 'Altura'], ['medida_torax', 'Tórax'], ['medida_cintura', 'Cintura'], ['medida_sapato', 'Sapato'], ['medida_cabelo', 'Cabelo'], ['medida_olhos', 'Olhos']];
  for (const [key, label] of need) {
    if (!trimStr(form[key])) return `${label} é obrigatório.`;
  }
  return null;
}

function BlockTitle({ children }) {
  return (
    <div className="md:col-span-2 border-t border-slate-200 pt-5 first:border-t-0 first:pt-0">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-700">{children}</h2>
    </div>
  );
}

function TextField({ label, value, onChange, required, placeholder, className = '' }) {
  return (
    <label className={`text-sm text-slate-600 ${className}`}>
      <span className="mb-1 block font-medium text-slate-800">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
        autoComplete="off"
        required={Boolean(required)}
      />
    </label>
  );
}

export default function PublicCadastroModelo() {
  const [searchParams] = useSearchParams();
  const tokenParam = trimStr(searchParams.get('token') || '');

  const [tokenGate, setTokenGate] = useState(() => (tokenParam ? 'loading' : 'missing'));
  const [tokenCheckMessage, setTokenCheckMessage] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [fotoPreview, setFotoPreview] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const validarUrl = useMemo(() => `${API_BASE.replace(/\/$/, '')}/public/cadastro-modelo/validar`, []);
  const submitUrl = useMemo(() => `${API_BASE.replace(/\/$/, '')}/public/cadastro-modelo`, []);

  useEffect(() => {
    const t = trimStr(searchParams.get('token') || '');
    if (!t) {
      setTokenGate('missing');
      setTokenCheckMessage('Este cadastro só pode ser acedido através do link enviado pela agência.');
      return;
    }
    setTokenGate('loading');
    setTokenCheckMessage('');
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchWithTimeout(`${validarUrl}?token=${encodeURIComponent(t)}`, { method: 'GET' });
        const raw = await response.text();
        const data = raw ? JSON.parse(raw) : {};
        if (cancelled) return;
        if (response.ok && data.ok) setTokenGate('ok');
        else {
          setTokenGate('invalid');
          setTokenCheckMessage(data.message || 'Link inválido, expirado ou já utilizado.');
        }
      } catch {
        if (!cancelled) {
          setTokenGate('invalid');
          setTokenCheckMessage('Não foi possível validar o link. Verifique a ligação e tente novamente.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, validarUrl]);

  const idadeModelo = calculateAge(form.data_nascimento);
  const isMinor = idadeModelo !== null && idadeModelo < 18;
  const sexoLower = trimStr(form.sexo).toLowerCase();
  const showMedidasFem = sexoLower === 'feminino';
  const showMedidasMasc = sexoLower === 'masculino';

  const onChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const addDynamicItem = (field) => setForm((prev) => ({ ...prev, [field]: [...normalizeDynamicTextList(prev[field]), ''] }));
  const updateDynamicItem = (field, index, value) => setForm((prev) => ({
    ...prev,
    [field]: normalizeDynamicTextList(prev[field]).map((item, i) => (i === index ? value : item)),
  }));
  const removeDynamicItem = (field, index) => setForm((prev) => {
    const next = normalizeDynamicTextList(prev[field]).filter((_, i) => i !== index);
    return { ...prev, [field]: next.length > 0 ? next : [''] };
  });

  const updateFormaPagamento = (index, key, value) => {
    setForm((prev) => ({
      ...prev,
      formas_pagamento: normalizeFormasRecebimento(prev.formas_pagamento).map((item, i) => {
        if (i !== index) return item;
        if (key === 'tipo') {
          if (value === 'Conta bancária') {
            return { ...emptyFormaRecebimento, tipo: 'Conta bancária' };
          }
          return { ...emptyFormaRecebimento, tipo: 'PIX', tipo_chave_pix: 'CPF' };
        }
        return { ...item, [key]: value };
      }),
    }));
  };

  const addFormaPagamento = () => setForm((prev) => ({
    ...prev,
    formas_pagamento: [...normalizeFormasRecebimento(prev.formas_pagamento), { ...emptyFormaRecebimento }],
  }));

  const removeFormaPagamento = (index) => setForm((prev) => {
    const next = normalizeFormasRecebimento(prev.formas_pagamento).filter((_, i) => i !== index);
    return { ...prev, formas_pagamento: next.length ? next : [{ ...emptyFormaRecebimento }] };
  });

  const handleMaskedChange = (field, value) => {
    if (field === 'cpf' || field === 'responsavel_cpf') return onChange(field, formatCpfDisplay(onlyDigits(value)));
    if (field === 'responsavel_telefone') return onChange(field, formatPhoneDisplay(onlyDigits(value)));
    if (field === 'cep') return onChange(field, formatCepDisplay(onlyDigits(value)));
    onChange(field, value);
  };

  const handleFotoFile = (file) => {
    if (!file) {
      onChange('foto_perfil_base64', '');
      setFotoPreview('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || '');
      onChange('foto_perfil_base64', base64);
      setFotoPreview(base64);
    };
    reader.readAsDataURL(file);
  };

  const buscarEnderecoPorCep = async () => {
    const cepDigits = onlyDigits(form.cep);
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
      // Silent fail para não bloquear o preenchimento manual.
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const telefones = normalizeDynamicTextList(form.telefones).map((v) => onlyDigits(v)).filter(Boolean);
      const emails = normalizeDynamicTextList(form.emails).map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
      if (telefones.length === 0 || emails.length === 0) return setError('Informe ao menos um telefone e um e-mail válidos.');
      if (!trimStr(form.cep) || !trimStr(form.logradouro) || !trimStr(form.numero) || !trimStr(form.bairro) || !trimStr(form.cidade) || !trimStr(form.uf)) {
        return setError('Preencha CEP, logradouro, número, bairro, cidade e UF.');
      }
      if (!form.senha_acesso || String(form.senha_acesso).trim().length < 8) return setError('Senha de acesso deve ter no mínimo 8 caracteres.');
      if (isMinor && (!form.responsavel_nome || !form.responsavel_cpf || !form.responsavel_telefone)) {
        return setError('Modelo menor de idade: preencha nome, CPF e telefone do responsável.');
      }
      const medidasErr = validateMedidasLocal(form);
      if (medidasErr) return setError(medidasErr);
      const fr = sanitizeAndValidateFormasPagamentoArray(form.formas_pagamento);
      if (!fr.ok) return setError(fr.message);

      const payload = {
        nome: form.nome,
        cpf: form.cpf,
        data_nascimento: form.data_nascimento,
        telefones,
        emails,
        telefone: telefones[0],
        email: emails[0],
        emite_nf_propria: form.emite_nf_propria,
        responsavel_nome: form.responsavel_nome,
        responsavel_cpf: form.responsavel_cpf,
        responsavel_telefone: form.responsavel_telefone,
        observacoes: form.observacoes,
        sexo: form.sexo,
        medida_altura: form.medida_altura,
        medida_busto: form.medida_busto,
        medida_torax: form.medida_torax,
        medida_cintura: form.medida_cintura,
        medida_quadril: form.medida_quadril,
        medida_sapato: form.medida_sapato,
        medida_cabelo: form.medida_cabelo,
        medida_olhos: form.medida_olhos,
        formas_pagamento: fr.formas,
        ativo: false,
      };
      const sv = sanitizeAndValidateModelo(payload, false);
      if (!sv.ok) return setError(sv.message);

      const body = {
        nome: sv.body.nome,
        cpf: sv.body.cpf,
        passaporte: trimStr(form.passaporte),
        rg: trimStr(form.rg),
        data_nascimento: sv.body.data_nascimento,
        telefones: sv.body.telefones,
        emails: sv.body.emails,
        emite_nf_propria: sv.body.emite_nf_propria,
        observacoes: sv.body.observacoes,
        sexo: trimStr(form.sexo),
        cep: trimStr(form.cep),
        logradouro: trimStr(form.logradouro),
        numero: trimStr(form.numero),
        complemento: trimStr(form.complemento),
        bairro: trimStr(form.bairro),
        cidade: trimStr(form.cidade),
        uf: trimStr(form.uf).toUpperCase(),
        formas_pagamento: fr.formas,
        medida_altura: trimStr(form.medida_altura),
        medida_busto: trimStr(form.medida_busto),
        medida_torax: trimStr(form.medida_torax),
        medida_cintura: trimStr(form.medida_cintura),
        medida_quadril: trimStr(form.medida_quadril),
        medida_sapato: trimStr(form.medida_sapato),
        medida_cabelo: trimStr(form.medida_cabelo),
        medida_olhos: trimStr(form.medida_olhos),
        foto_perfil_base64: trimStr(form.foto_perfil_base64),
        senha_acesso: form.senha_acesso,
        token: tokenParam,
      };
      if (isMinor) {
        body.responsavel_nome = sv.body.responsavel_nome;
        body.responsavel_cpf = sv.body.responsavel_cpf;
        body.responsavel_telefone = sv.body.responsavel_telefone;
      }

      const response = await fetchWithTimeout(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      throwIfHtmlOrCannotPost(raw, response.status);
      const data = raw ? JSON.parse(raw) : {};
      if (!response.ok) throw new Error(data.message || `Erro ao enviar (HTTP ${response.status}).`);
      setDone(true);
      setForm(emptyForm());
      setFotoPreview('');
    } catch (err) {
      setError(err?.name === 'AbortError' ? 'O servidor não respondeu a tempo. Tente novamente em instantes.' : (err?.message || 'Erro ao enviar cadastro.'));
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-[#F7F7F7] px-4 py-16 text-slate-800">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <img
            src="/logo-andy.png"
            alt="Andy Management"
            className="mx-auto h-12 w-auto max-w-full object-contain"
            width={393}
            height={157}
          />
          <p className="mt-6 text-lg font-semibold text-slate-900">{SUCCESS_TEXT}</p>
        </div>
      </div>
    );
  }

  if (tokenGate === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F7F7] px-4 text-slate-700">
        <p className="text-sm">A verificar o link…</p>
      </div>
    );
  }

  if (tokenGate === 'missing' || tokenGate === 'invalid') {
    return (
      <div className="min-h-screen bg-[#F7F7F7] px-4 py-16 text-slate-800">
        <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <img
            src="/logo-andy.png"
            alt="Andy Management"
            className="mx-auto h-12 w-auto max-w-full object-contain opacity-90"
            width={393}
            height={157}
          />
          <h1 className="mt-6 text-lg font-semibold text-slate-900">Link não disponível</h1>
          <p className="mt-3 text-sm text-slate-600">{tokenCheckMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F7F7] px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 text-center">
          <img
            src="/logo-andy.png"
            alt="Andy Management"
            className="mx-auto h-14 w-auto max-w-[min(100%,280px)] object-contain"
            width={393}
            height={157}
          />
          <h1 className="mt-6 text-2xl font-semibold text-slate-900">Cadastro de modelo</h1>
          <p className="mt-2 text-sm text-slate-600">Preencha todos os blocos para concluir seu cadastro completo.</p>
        </header>

        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2"
          noValidate
        >
          <BlockTitle>Dados pessoais</BlockTitle>

          <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {idadeModelo === null
              ? 'Informe a data de nascimento para validação de maioridade.'
              : isMinor
                ? 'Modelo menor de idade: preencha os dados do responsável legal.'
                : `Idade: ${idadeModelo} anos.`}
          </div>

          <TextField label="Nome completo" value={form.nome} onChange={(v) => onChange('nome', v)} required />
          <label className="text-sm text-slate-600">
            <span className="mb-1 block font-medium text-slate-800">
              CPF <span className="text-red-600">*</span>
            </span>
            <input
              value={form.cpf}
              onChange={(e) => handleMaskedChange('cpf', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
              inputMode="numeric"
              autoComplete="off"
              required
            />
          </label>

          <TextField label="Passaporte" value={form.passaporte} onChange={(v) => onChange('passaporte', v)} />
          <TextField label="RG" value={form.rg} onChange={(v) => onChange('rg', v)} />

          <label className="text-sm text-slate-600 md:col-span-2">
            <span className="mb-1 block font-medium text-slate-800">
              Data de nascimento <span className="text-red-600">*</span>
            </span>
            <input
              type="date"
              value={form.data_nascimento}
              onChange={(e) => onChange('data_nascimento', e.target.value)}
              className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
              required
            />
          </label>

          <label className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(form.emite_nf_propria)}
              onChange={(e) => onChange('emite_nf_propria', e.target.checked)}
            />
            Emite NF própria <span className="text-red-600">*</span>
          </label>

          {isMinor ? (
            <>
              <label className="text-sm text-slate-600 md:col-span-2">
                <span className="mb-1 block font-medium text-slate-800">
                  Nome do responsável <span className="text-red-600">*</span>
                </span>
                <input
                  value={form.responsavel_nome}
                  onChange={(e) => onChange('responsavel_nome', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
                />
              </label>
              <label className="text-sm text-slate-600">
                <span className="mb-1 block font-medium text-slate-800">
                  CPF do responsável <span className="text-red-600">*</span>
                </span>
                <input
                  value={form.responsavel_cpf}
                  onChange={(e) => handleMaskedChange('responsavel_cpf', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
                  inputMode="numeric"
                />
              </label>
              <label className="text-sm text-slate-600">
                <span className="mb-1 block font-medium text-slate-800">
                  Telefone do responsável <span className="text-red-600">*</span>
                </span>
                <input
                  value={form.responsavel_telefone}
                  onChange={(e) => handleMaskedChange('responsavel_telefone', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
                  inputMode="numeric"
                />
              </label>
            </>
          ) : null}

          <label className="text-sm text-slate-600 md:col-span-2">
            <span className="mb-1 block font-medium text-slate-800">Observações (opcional)</span>
            <textarea
              value={form.observacoes}
              onChange={(e) => onChange('observacoes', e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
              maxLength={2000}
            />
          </label>
          <BlockTitle>Acesso</BlockTitle>

          <label className="text-sm text-slate-600 md:col-span-2">
            <span className="mb-1 block font-medium text-slate-800">
              Senha de acesso ao extrato <span className="text-red-600"> *</span>
            </span>
            <input
              type="password"
              value={form.senha_acesso}
              onChange={(e) => onChange('senha_acesso', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
              required
            />
          </label>
          <BlockTitle>Foto de perfil</BlockTitle>

          <div className="md:col-span-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="mb-2 text-sm font-medium text-amber-950">Envie sua foto</p>
            <label className="inline-flex cursor-pointer items-center rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: BRAND_ORANGE }}>
              Escolher foto
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleFotoFile(e.target.files?.[0])}
                className="hidden"
              />
            </label>
            <p className="mt-2 text-xs text-amber-900/90">Clique no botão laranja para selecionar a imagem.</p>
            {fotoPreview ? (
              <img
                src={fotoPreview}
                alt="Prévia da foto"
                className="mt-2 h-24 w-24 rounded-lg border border-slate-200 object-cover"
              />
            ) : null}
          </div>

          <BlockTitle>Endereço</BlockTitle>
          <label className="text-sm text-slate-600">
            <span className="mb-1 block font-medium text-slate-800">CEP <span className="text-red-600">*</span></span>
            <input
              value={form.cep}
              onChange={(e) => handleMaskedChange('cep', e.target.value)}
              onBlur={buscarEnderecoPorCep}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
              inputMode="numeric"
              required
            />
          </label>
          <TextField label="Logradouro" value={form.logradouro} onChange={(v) => onChange('logradouro', v)} required />
          <TextField label="Número" value={form.numero} onChange={(v) => onChange('numero', v)} required />
          <TextField label="Complemento" value={form.complemento} onChange={(v) => onChange('complemento', v)} />
          <TextField label="Bairro" value={form.bairro} onChange={(v) => onChange('bairro', v)} required />
          <TextField label="Cidade" value={form.cidade} onChange={(v) => onChange('cidade', v)} required />
          <TextField label="Estado/UF" value={form.uf} onChange={(v) => onChange('uf', v.toUpperCase())} required />

          <BlockTitle>Contato</BlockTitle>

          <div className="md:col-span-2">
            <DynamicTextListField
              label="Telefones"
              items={normalizeDynamicTextList(form.telefones)}
              placeholder="Ex: (11) 99999-9999"
              onAdd={() => addDynamicItem('telefones')}
              onUpdate={(index, value) =>
                updateDynamicItem('telefones', index, formatPhoneDisplay(onlyDigits(value)))
              }
              onRemove={(index) => removeDynamicItem('telefones', index)}
            />
          </div>
          <div className="md:col-span-2">
            <DynamicTextListField
              label="E-mails"
              items={normalizeDynamicTextList(form.emails)}
              placeholder="Ex: contato@email.com"
              onAdd={() => addDynamicItem('emails')}
              onUpdate={(index, value) => updateDynamicItem('emails', index, value)}
              onRemove={(index) => removeDynamicItem('emails', index)}
            />
          </div>

          <BlockTitle>Medidas</BlockTitle>

          <div className="md:col-span-2">
            <TextField
              label="Sexo"
              value={form.sexo}
              onChange={(v) => onChange('sexo', v)}
              placeholder="Masculino ou Feminino"
              required
            />
          </div>

          {!showMedidasFem && !showMedidasMasc ? (
            <p className="md:col-span-2 text-sm text-slate-600">
              Preencha o sexo (Masculino ou Feminino) para exibir os campos de medida.
            </p>
          ) : null}

          {showMedidasFem ? (
            <>
              <TextField
                label="Altura"
                value={form.medida_altura}
                onChange={(v) => onChange('medida_altura', v)}
                required
              />
              <TextField label="Busto" value={form.medida_busto} onChange={(v) => onChange('medida_busto', v)} required />
              <TextField
                label="Cintura"
                value={form.medida_cintura}
                onChange={(v) => onChange('medida_cintura', v)}
                required
              />
              <TextField
                label="Quadril"
                value={form.medida_quadril}
                onChange={(v) => onChange('medida_quadril', v)}
                required
              />
              <TextField
                label="Sapato"
                value={form.medida_sapato}
                onChange={(v) => onChange('medida_sapato', v)}
                required
              />
              <TextField
                label="Cabelo"
                value={form.medida_cabelo}
                onChange={(v) => onChange('medida_cabelo', v)}
                required
              />
              <TextField label="Olhos" value={form.medida_olhos} onChange={(v) => onChange('medida_olhos', v)} required />
            </>
          ) : null}

          {showMedidasMasc ? (
            <>
              <TextField
                label="Altura"
                value={form.medida_altura}
                onChange={(v) => onChange('medida_altura', v)}
                required
              />
              <TextField label="Tórax" value={form.medida_torax} onChange={(v) => onChange('medida_torax', v)} required />
              <TextField
                label="Cintura"
                value={form.medida_cintura}
                onChange={(v) => onChange('medida_cintura', v)}
                required
              />
              <TextField
                label="Sapato"
                value={form.medida_sapato}
                onChange={(v) => onChange('medida_sapato', v)}
                required
              />
              <TextField
                label="Cabelo"
                value={form.medida_cabelo}
                onChange={(v) => onChange('medida_cabelo', v)}
                required
              />
              <TextField label="Olhos" value={form.medida_olhos} onChange={(v) => onChange('medida_olhos', v)} required />
            </>
          ) : null}

          <BlockTitle>Financeiro</BlockTitle>
          <div className="md:col-span-2 rounded-lg border border-slate-200 p-3">
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
            <div className="space-y-4">
              {normalizeFormasRecebimento(form.formas_pagamento).map((forma, index) => (
                <div key={`forma-${index}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <label className="text-xs text-slate-600">
                      <span className="mb-1 block font-medium text-slate-700">Forma de recebimento</span>
                      <select
                        value={forma.tipo}
                        onChange={(e) => updateFormaPagamento(index, 'tipo', e.target.value)}
                        className="w-full min-w-[160px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="PIX">Pix</option>
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
                    <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                      <label className="text-xs text-slate-600">
                        <span className="mb-1 block font-medium text-slate-700">Tipo de chave Pix</span>
                        <select
                          value={forma.tipo_chave_pix || 'CPF'}
                          onChange={(e) => updateFormaPagamento(index, 'tipo_chave_pix', e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="CPF">CPF</option>
                          <option value="CNPJ">CNPJ</option>
                          <option value="E-mail">E-mail</option>
                          <option value="Celular">Celular</option>
                          <option value="Aleatória">Aleatória</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-1 block font-medium text-slate-700">Chave Pix</span>
                        <input
                          value={forma.chave_pix ?? ''}
                          onChange={(e) => updateFormaPagamento(index, 'chave_pix', e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs text-slate-600 md:col-span-3">
                        <span className="mb-1 block font-medium text-slate-700">Banco</span>
                        <input
                          value={forma.banco ?? ''}
                          onChange={(e) => updateFormaPagamento(index, 'banco', e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-1 block font-medium text-slate-700">Agência</span>
                        <input
                          value={forma.agencia ?? ''}
                          onChange={(e) => updateFormaPagamento(index, 'agencia', onlyDigits(e.target.value))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-1 block font-medium text-slate-700">Conta</span>
                        <input
                          value={forma.conta ?? ''}
                          onChange={(e) => updateFormaPagamento(index, 'conta', onlyDigits(e.target.value))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-1 block font-medium text-slate-700">Tipo de conta</span>
                        <select
                          value={forma.tipo_conta === 'poupanca' ? 'poupanca' : 'corrente'}
                          onChange={(e) => updateFormaPagamento(index, 'tipo_conta', e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="corrente">Corrente</option>
                          <option value="poupanca">Poupança</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {error ? (
            <div className="md:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {error}
            </div>
          ) : null}

          <div className="md:col-span-2 border-t border-slate-200 pt-4">
            <button
              type="submit"
              disabled={sending}
              className="rounded-xl px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: BRAND_ORANGE }}
            >
              {sending ? 'Enviando…' : 'Enviar cadastro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
