import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DynamicTextListField from './components/DynamicTextListField';
import { API_BASE, fetchWithTimeout, throwIfHtmlOrCannotPost } from './apiConfig';
import { sanitizeAndValidateCliente, onlyDigits } from './utils/brValidators';
import { formatCpfDisplay, formatCnpjDisplay, formatCepDisplay, formatPhoneDisplay } from './utils/brMasks';

const BRAND_ORANGE = '#F59E0B';
const SUCCESS_TEXT = 'Cadastro de cliente recebido com sucesso. Obrigado.';
const CLIENTE_WEBSITE_PREFILL = 'https://';
const CLIENTE_INSTAGRAM_PREFILL = 'https://www.instagram.com/';

const trimStr = (v) => String(v ?? '').trim();
const normalizeDynamicTextList = (items) => {
  if (!Array.isArray(items) || items.length === 0) return [''];
  return items.map((item) => String(item || ''));
};

const emptyForm = () => ({
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
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  website: CLIENTE_WEBSITE_PREFILL,
  instagram: CLIENTE_INSTAGRAM_PREFILL,
  observacoes: '',
});

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

export default function PublicCadastroCliente() {
  const [searchParams] = useSearchParams();
  const tokenParam = trimStr(searchParams.get('token') || '');
  const [tokenGate, setTokenGate] = useState(() => (tokenParam ? 'loading' : 'missing'));
  const [tokenCheckMessage, setTokenCheckMessage] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const validarUrl = `${API_BASE.replace(/\/$/, '')}/public/cadastro-cliente/validar`;
  const submitUrl = `${API_BASE.replace(/\/$/, '')}/public/cadastro-cliente`;

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
      // ignore
    }
  };

  const buscarDadosEmpresaPorCnpj = async () => {
    if (form.tipo_pessoa !== 'PJ') return;
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
      // ignore
    }
  };

  const handleDocumentoChange = (value) => {
    const d = onlyDigits(value);
    onChange('documento', form.tipo_pessoa === 'PF' ? formatCpfDisplay(d) : formatCnpjDisplay(d));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const telefones = normalizeDynamicTextList(form.telefones).map((v) => onlyDigits(v)).filter(Boolean);
      const emails = normalizeDynamicTextList(form.emails).map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
      if (telefones.length === 0 || emails.length === 0) return setError('Informe ao menos um telefone e um e-mail válidos.');

      const payload = {
        ...form,
        tipo_pessoa: form.tipo_pessoa === 'PF' ? 'PF' : 'PJ',
        telefones,
        emails,
        telefone: telefones[0],
        email: emails[0],
      };
      const sv = sanitizeAndValidateCliente(payload, false);
      if (!sv.ok) return setError(sv.message);

      const body = {
        ...sv.body,
        token: tokenParam,
      };

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
    } catch (err) {
      setError(err?.name === 'AbortError' ? 'O servidor não respondeu a tempo. Tente novamente.' : (err?.message || 'Erro ao enviar cadastro.'));
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return <div className="min-h-screen bg-[#F7F7F7] px-4 py-16"><div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><p className="text-lg font-semibold text-slate-900">{SUCCESS_TEXT}</p></div></div>;
  }
  if (tokenGate !== 'ok') {
    const msg = tokenGate === 'loading' ? 'A verificar o link…' : tokenCheckMessage;
    return <div className="min-h-screen bg-[#F7F7F7] px-4 py-16 text-center text-slate-700">{msg}</div>;
  }

  return (
    <div className="min-h-screen bg-[#F7F7F7] px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 text-center">
          <img src="/logo-andy.png" alt="Andy Management" className="mx-auto h-14 w-auto max-w-[min(100%,280px)] object-contain" />
          <h1 className="mt-6 text-2xl font-semibold text-slate-900">Cadastro de cliente</h1>
        </header>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2" noValidate>
          <BlockTitle>Dados da empresa</BlockTitle>
          <label className="text-sm text-slate-600">
            <span className="mb-1 block font-medium text-slate-800">Tipo de pessoa <span className="text-red-600">*</span></span>
            <select
              value={form.tipo_pessoa}
              onChange={(e) => {
                const v = e.target.value === 'PF' ? 'PF' : 'PJ';
                const d = onlyDigits(form.documento);
                setForm((prev) => ({ ...prev, tipo_pessoa: v, documento: v === 'PF' ? formatCpfDisplay(d) : formatCnpjDisplay(d) }));
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="PJ">PJ</option>
              <option value="PF">PF</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            <span className="mb-1 block font-medium text-slate-800">{form.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ'} <span className="text-red-600">*</span></span>
            <input value={form.documento} onChange={(e) => handleDocumentoChange(e.target.value)} onBlur={buscarDadosEmpresaPorCnpj} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <TextField label="Razão social" value={form.nome_empresa} onChange={(v) => onChange('nome_empresa', v)} required />
          <TextField label="Nome fantasia" value={form.nome_fantasia} onChange={(v) => onChange('nome_fantasia', v)} required />
          <TextField label="Inscrição estadual" value={form.inscricao_estadual} onChange={(v) => onChange('inscricao_estadual', v)} />

          <BlockTitle>Representante e contato</BlockTitle>
          <TextField label="Representante legal" value={form.contato_principal} onChange={(v) => onChange('contato_principal', v)} required />
          <label className="text-sm text-slate-600">
            <span className="mb-1 block font-medium text-slate-800">CPF do representante</span>
            <input value={form.documento_representante} onChange={(e) => onChange('documento_representante', formatCpfDisplay(onlyDigits(e.target.value)))} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <div className="md:col-span-2">
            <DynamicTextListField label="Telefones" items={normalizeDynamicTextList(form.telefones)} placeholder="Ex: (11) 99999-9999" onAdd={() => addDynamicItem('telefones')} onUpdate={(i, v) => updateDynamicItem('telefones', i, formatPhoneDisplay(onlyDigits(v)))} onRemove={(i) => removeDynamicItem('telefones', i)} />
          </div>
          <div className="md:col-span-2">
            <DynamicTextListField label="E-mails" items={normalizeDynamicTextList(form.emails)} placeholder="Ex: contato@email.com" onAdd={() => addDynamicItem('emails')} onUpdate={(i, v) => updateDynamicItem('emails', i, v)} onRemove={(i) => removeDynamicItem('emails', i)} />
          </div>

          <BlockTitle>Endereço</BlockTitle>
          <label className="text-sm text-slate-600">
            <span className="mb-1 block font-medium text-slate-800">CEP <span className="text-red-600">*</span></span>
            <input value={form.cep} onChange={(e) => onChange('cep', formatCepDisplay(onlyDigits(e.target.value)))} onBlur={buscarEnderecoPorCep} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <TextField label="Logradouro" value={form.logradouro} onChange={(v) => onChange('logradouro', v)} required />
          <TextField label="Número" value={form.numero} onChange={(v) => onChange('numero', v)} required />
          <TextField label="Complemento" value={form.complemento} onChange={(v) => onChange('complemento', v)} />
          <TextField label="Bairro" value={form.bairro} onChange={(v) => onChange('bairro', v)} required />
          <TextField label="Cidade" value={form.cidade} onChange={(v) => onChange('cidade', v)} required />
          <TextField label="UF" value={form.uf} onChange={(v) => onChange('uf', v.toUpperCase())} required />

          <BlockTitle>Presença online</BlockTitle>
          <TextField
            label="Website"
            value={form.website}
            onChange={(v) => onChange('website', v)}
            placeholder="exemplo.com.br"
            className="md:col-span-2"
          />
          <TextField
            label="Instagram"
            value={form.instagram}
            onChange={(v) => onChange('instagram', v)}
            placeholder="utilizador ou restante do endereço"
            className="md:col-span-2"
          />

          <BlockTitle>Observações</BlockTitle>
          <label className="text-sm text-slate-600 md:col-span-2">
            <span className="mb-1 block font-medium text-slate-800">Observações</span>
            <textarea value={form.observacoes} onChange={(e) => onChange('observacoes', e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>

          {error ? <div className="md:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
          <div className="md:col-span-2 border-t border-slate-200 pt-4">
            <button type="submit" disabled={sending} className="rounded-xl px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60" style={{ backgroundColor: BRAND_ORANGE }}>
              {sending ? 'Enviando…' : 'Enviar cadastro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
