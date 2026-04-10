import { useCallback, useEffect, useId, useRef, useState } from 'react';
import DynamicTextListField from './DynamicTextListField';
import { onlyDigits } from '../utils/brValidators';

const emptyFormaRecebimento = () => ({
  tipo: 'PIX',
  tipo_chave_pix: 'CPF',
  chave_pix: '',
  banco: '',
  agencia: '',
  conta: '',
  tipo_conta: 'corrente',
});

function createInitialForm() {
  return {
    nome: '',
    bio: '',
    featured: false,
    ativo: true,
    catFeminino: false,
    catMasculino: false,
    catCreators: false,
    medida_altura: '',
    medida_busto: '',
    medida_torax: '',
    medida_cintura: '',
    medida_quadril: '',
    medida_sapato: '',
    medida_cabelo: '',
    medida_olhos: '',
    status_cadastro: 'pendente',
    telefones: [''],
    emails: [''],
    instagram: '',
    tiktok: '',
    cpf: '',
    rg: '',
    passaporte: '',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    formas_pagamento: [emptyFormaRecebimento()],
    observacoes: '',
    video_url: '',
    slug_site: '',
  };
}

function Section({ title, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm ${className}`}>
      <h4 className="border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
        {title}
      </h4>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`text-sm text-slate-600 ${className}`}>
      <span className="mb-1 block font-medium text-slate-800">{label}</span>
      {children}
    </label>
  );
}

/**
 * Formulário completo Novo modelo / Editar modelo (Website).
 * Estado local apenas — sem persistência na API.
 */
export default function WebsiteModeloEditorPage() {
  const formId = useId();
  const fileInputId = `${formId}-files`;
  const [modo, setModo] = useState('novo');
  const [form, setForm] = useState(createInitialForm);
  const [mediaItems, setMediaItems] = useState([]);
  const mediaItemsRef = useRef([]);
  useEffect(() => {
    mediaItemsRef.current = mediaItems;
  }, [mediaItems]);

  const setField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const normalizeList = (arr) => (Array.isArray(arr) && arr.length > 0 ? arr.map((x) => String(x ?? '')) : ['']);

  const addTelefone = () => setForm((p) => ({ ...p, telefones: [...normalizeList(p.telefones), ''] }));
  const updateTelefone = (i, v) =>
    setForm((p) => {
      const t = [...normalizeList(p.telefones)];
      t[i] = v;
      return { ...p, telefones: t };
    });
  const removeTelefone = (i) =>
    setForm((p) => {
      const t = normalizeList(p.telefones).filter((_, j) => j !== i);
      return { ...p, telefones: t.length ? t : [''] };
    });

  const addEmail = () => setForm((p) => ({ ...p, emails: [...normalizeList(p.emails), ''] }));
  const updateEmail = (i, v) =>
    setForm((p) => {
      const t = [...normalizeList(p.emails)];
      t[i] = v;
      return { ...p, emails: t };
    });
  const removeEmail = (i) =>
    setForm((p) => {
      const t = normalizeList(p.emails).filter((_, j) => j !== i);
      return { ...p, emails: t.length ? t : [''] };
    });

  const updateForma = (index, key, value) => {
    setForm((p) => {
      const list = [...(p.formas_pagamento || [])];
      list[index] = { ...list[index], [key]: value };
      return { ...p, formas_pagamento: list };
    });
  };

  const addForma = () =>
    setForm((p) => ({
      ...p,
      formas_pagamento: [...(p.formas_pagamento || []), emptyFormaRecebimento()],
    }));

  const removeForma = (index) =>
    setForm((p) => {
      const list = (p.formas_pagamento || []).filter((_, i) => i !== index);
      return { ...p, formas_pagamento: list.length ? list : [emptyFormaRecebimento()] };
    });

  const onPickFiles = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setMediaItems((prev) => {
      const next = [...prev];
      for (const f of files) {
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        next.push({ id, preview: URL.createObjectURL(f), name: f.name });
      }
      return next;
    });
    e.target.value = '';
  };

  const removeMedia = (id) => {
    setMediaItems((prev) => {
      const item = prev.find((x) => x.id === id);
      if (item?.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview);
      return prev.filter((x) => x.id !== id);
    });
  };

  const moveMedia = (index, delta) => {
    setMediaItems((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  useEffect(() => {
    return () => {
      mediaItemsRef.current.forEach((m) => {
        if (m.preview?.startsWith('blob:')) URL.revokeObjectURL(m.preview);
      });
    };
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
  };

  const formas = form.formas_pagamento?.length ? form.formas_pagamento : [emptyFormaRecebimento()];

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              {modo === 'novo' ? 'Novo modelo' : 'Editar modelo'}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Campos alinhados ao cadastro de modelos do CRM e às categorias do site (women / men / creators). A
              gravação será ligada à API num passo seguinte.
            </p>
          </div>
          <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setModo('novo')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                modo === 'novo' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Novo modelo
            </button>
            <button
              type="button"
              onClick={() => setModo('editar')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                modo === 'editar' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Editar modelo
            </button>
          </div>
        </div>

        {modo === 'editar' ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
            <span className="font-medium">Identificação no site:</span> use o slug para localizar o registo quando a API
            existir.
            <label className="mt-2 block max-w-md">
              <span className="mb-1 block text-xs font-medium text-slate-700">Slug / URL no site</span>
              <input
                value={form.slug_site}
                onChange={(e) => setField('slug_site', e.target.value)}
                placeholder="ex.: nome-da-modelo"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <Section title="Identificação e site">
          <Field label="Nome" className="md:col-span-2">
            <input
              value={form.nome}
              onChange={(e) => setField('nome', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Nome completo ou artístico"
              autoComplete="off"
            />
          </Field>
          <Field label="Bio" className="md:col-span-2">
            <textarea
              value={form.bio}
              onChange={(e) => setField('bio', e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Texto exibido no perfil público (quando aplicável)."
            />
          </Field>
          <div className="flex flex-wrap gap-6 md:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(e) => setField('featured', e.target.checked)}
                className="rounded border-slate-300 text-amber-600 focus:ring-amber-400"
              />
              Destaque (featured)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setField('ativo', e.target.checked)}
                className="rounded border-slate-300 text-amber-600 focus:ring-amber-400"
              />
              Ativo
            </label>
          </div>
          <div className="md:col-span-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Categoria no site</p>
            <div className="flex flex-wrap gap-4">
              {[
                { key: 'catFeminino', label: 'Feminino', hint: 'women' },
                { key: 'catMasculino', label: 'Masculino', hint: 'men' },
                { key: 'catCreators', label: 'Creators', hint: 'creators' },
              ].map(({ key, label, hint }) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(form[key])}
                    onChange={(e) => setField(key, e.target.checked)}
                    className="rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                  />
                  {label}
                  <span className="text-xs text-slate-400">({hint})</span>
                </label>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Medidas principais">
          {[
            ['medida_altura', 'Altura'],
            ['medida_busto', 'Busto'],
            ['medida_torax', 'Tórax'],
            ['medida_cintura', 'Cintura'],
            ['medida_quadril', 'Quadril'],
            ['medida_sapato', 'Sapato'],
            ['medida_cabelo', 'Cabelo'],
            ['medida_olhos', 'Olhos'],
          ].map(([k, lab]) => (
            <Field key={k} label={lab}>
              <input
                value={form[k]}
                onChange={(e) => setField(k, e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="—"
              />
            </Field>
          ))}
        </Section>

        <Section title="Status do modelo">
          <Field label="Status do cadastro">
            <select
              value={form.status_cadastro}
              onChange={(e) => setField('status_cadastro', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="pendente">Pendente</option>
              <option value="aprovado">Aprovado</option>
            </select>
          </Field>
          <p className="text-xs text-slate-500 md:col-span-2">
            Mesmos valores usados no CRM (<code className="rounded bg-slate-100 px-1">status_cadastro</code>).
          </p>
        </Section>

        <Section title="Contato">
          <div className="md:col-span-2">
            <DynamicTextListField
              label="Telefones"
              items={normalizeList(form.telefones)}
              placeholder="Ex: (11) 99999-9999"
              onAdd={addTelefone}
              onUpdate={updateTelefone}
              onRemove={removeTelefone}
            />
          </div>
          <div className="md:col-span-2">
            <DynamicTextListField
              label="E-mails"
              items={normalizeList(form.emails)}
              placeholder="Ex: contato@email.com"
              onAdd={addEmail}
              onUpdate={updateEmail}
              onRemove={removeEmail}
            />
          </div>
          <Field label="Instagram">
            <input
              value={form.instagram}
              onChange={(e) => setField('instagram', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="@usuario ou URL"
            />
          </Field>
          <Field label="TikTok">
            <input
              value={form.tiktok}
              onChange={(e) => setField('tiktok', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="@usuario ou URL"
            />
          </Field>
        </Section>

        <Section title="Documentos">
          <Field label="CPF">
            <input
              value={form.cpf}
              onChange={(e) => setField('cpf', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="000.000.000-00"
            />
          </Field>
          <Field label="RG">
            <input
              value={form.rg}
              onChange={(e) => setField('rg', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Passaporte" className="md:col-span-2">
            <input
              value={form.passaporte}
              onChange={(e) => setField('passaporte', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
        </Section>

        <Section title="Endereço">
          <Field label="CEP">
            <input
              value={form.cep}
              onChange={(e) => setField('cep', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="00000-000"
            />
          </Field>
          <Field label="Logradouro">
            <input
              value={form.logradouro}
              onChange={(e) => setField('logradouro', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Número">
            <input
              value={form.numero}
              onChange={(e) => setField('numero', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Complemento">
            <input
              value={form.complemento}
              onChange={(e) => setField('complemento', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Bairro">
            <input
              value={form.bairro}
              onChange={(e) => setField('bairro', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Cidade">
            <input
              value={form.cidade}
              onChange={(e) => setField('cidade', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="UF">
            <input
              value={form.uf}
              onChange={(e) => setField('uf', e.target.value.toUpperCase())}
              maxLength={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="SP"
            />
          </Field>
        </Section>

        <Section title="Dados bancários">
          <div className="md:col-span-2 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Formas de recebimento (como no cadastro de modelos).</p>
              <button
                type="button"
                onClick={addForma}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
              >
                + adicionar
              </button>
            </div>
            {formas.map((forma, index) => (
              <div key={`forma-${index}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <label className="text-xs text-slate-600">
                    <span className="mb-1 block font-medium text-slate-700">Receber via</span>
                    <select
                      value={forma.tipo}
                      onChange={(e) => updateForma(index, 'tipo', e.target.value)}
                      className="w-full min-w-[140px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="PIX">PIX</option>
                      <option value="Conta bancária">Conta bancária</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeForma(index)}
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700"
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
                        onChange={(e) => updateForma(index, 'tipo_chave_pix', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="CPF">CPF</option>
                        <option value="CNPJ">CNPJ</option>
                        <option value="E-mail">E-mail</option>
                        <option value="Celular">Telefone (celular)</option>
                        <option value="Aleatória">Chave aleatória (UUID)</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-600">
                      <span className="mb-1 block font-medium text-slate-700">Chave Pix</span>
                      <input
                        value={forma.chave_pix ?? ''}
                        onChange={(e) => updateForma(index, 'chave_pix', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <label className="text-xs text-slate-600 md:col-span-2">
                      <span className="mb-1 block font-medium text-slate-700">Banco</span>
                      <input
                        value={forma.banco ?? ''}
                        onChange={(e) => updateForma(index, 'banco', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Nome ou código FEBRABAN"
                      />
                    </label>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs text-slate-600">
                        <span className="mb-1 block font-medium text-slate-700">Agência</span>
                        <input
                          inputMode="numeric"
                          value={forma.agencia ?? ''}
                          onChange={(e) => updateForma(index, 'agencia', onlyDigits(e.target.value))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-1 block font-medium text-slate-700">Conta</span>
                        <input
                          inputMode="numeric"
                          value={forma.conta ?? ''}
                          onChange={(e) => updateForma(index, 'conta', onlyDigits(e.target.value))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="mb-1 block font-medium text-slate-700">Tipo de conta</span>
                        <select
                          value={forma.tipo_conta === 'poupanca' ? 'poupanca' : 'corrente'}
                          onChange={(e) => updateForma(index, 'tipo_conta', e.target.value)}
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
        </Section>

        <Section title="Informações internas">
          <Field label="Observações" className="md:col-span-2">
            <textarea
              value={form.observacoes}
              onChange={(e) => setField('observacoes', e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Notas internas — não exibidas no site."
            />
          </Field>
        </Section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
          <h4 className="border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
            Mídia
          </h4>
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input id={fileInputId} type="file" accept="image/*" multiple className="hidden" onChange={onPickFiles} />
              <label
                htmlFor={fileInputId}
                className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
              >
                Adicionar imagens
              </label>
              <span className="text-xs text-slate-500">Pré-visualização local; reordene com os botões em cada cartão.</span>
            </div>

            {mediaItems.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                Nenhuma imagem adicionada.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mediaItems.map((item, index) => (
                  <li
                    key={item.id}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="relative aspect-[3/4] w-full bg-slate-100">
                      <img src={item.preview} alt="" className="h-full w-full object-cover" />
                      <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                        {index + 1}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 border-t border-slate-200 p-2">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveMedia(index, -1)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
                        title="Mover para cima"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === mediaItems.length - 1}
                        onClick={() => moveMedia(index, 1)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
                        title="Mover para baixo"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMedia(item.id)}
                        className="ml-auto rounded border border-red-200 px-2 py-1 text-xs text-red-700"
                      >
                        Remover
                      </button>
                    </div>
                    {item.name ? <p className="truncate px-2 pb-2 text-xs text-slate-500">{item.name}</p> : null}
                  </li>
                ))}
              </ul>
            )}

            <label className="block max-w-xl text-sm text-slate-600">
              <span className="mb-1 block font-medium text-slate-800">Vídeo (URL)</span>
              <input
                value={form.video_url}
                onChange={(e) => setField('video_url', e.target.value)}
                type="url"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="https://…"
              />
            </label>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <button
            type="button"
            onClick={() => {
              setForm(createInitialForm());
              setMediaItems((prev) => {
                prev.forEach((m) => {
                  if (m.preview?.startsWith('blob:')) URL.revokeObjectURL(m.preview);
                });
                return [];
              });
              setModo('novo');
            }}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Limpar formulário
          </button>
          <button
            type="submit"
            disabled
            className="cursor-not-allowed rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
            title="Gravação na API ainda não disponível"
          >
            Guardar (em breve)
          </button>
        </div>
      </form>
    </div>
  );
}
