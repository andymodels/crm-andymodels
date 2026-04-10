import { useCallback, useEffect, useId, useRef, useState } from 'react';
import DynamicTextListField from './DynamicTextListField';
import { API_BASE, fetchWithTimeout, throwIfHtmlOrCannotPost } from '../apiConfig';
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

/** Cópia rasa do array `media` do GET /website/models/:slug — mesma ordem, sem fallback para images/cover_image. */
function cloneMediaArrayFromDetail(detail) {
  if (!detail || typeof detail !== 'object') return [];
  const m = detail.media;
  if (!Array.isArray(m)) return [];
  return m.slice();
}

/** Só `type === 'video'` desativa <img> (sem images[]/cover_image). */
function isMediaItemVideo(item) {
  return item != null && typeof item === 'object' && item.type === 'video';
}

/** Miniatura utilizável: URL absoluta http(s) (evita thumb inválido pós-migração B2). */
function isHttpThumbUrl(thumb) {
  const t = thumb == null ? '' : String(thumb).trim();
  return t.length > 0 && /^https?:\/\//i.test(t);
}

/**
 * Src para <img> no editor de mídia. Sem images[]/cover_image.
 * — Vídeo (`type === 'video'`): sem src para <img>.
 * — Imagem: usar `thumb` só se for URL http(s); senão `item.url` como fallback (sempre que existir).
 */
function resolveModelEditorMediaImageSrc(item, logMeta = {}) {
  if (isMediaItemVideo(item)) {
    // eslint-disable-next-line no-console -- log temporário para validar migração B2 / thumb
    console.log('[Website editor media]', { ...logMeta, thumb: item?.thumb, url: item?.url, srcFinal: '' });
    return '';
  }
  if (typeof item === 'string') {
    const u = String(item).trim();
    // eslint-disable-next-line no-console
    console.log('[Website editor media]', { ...logMeta, thumb: '(item string)', url: u, srcFinal: u });
    return u;
  }
  if (item && typeof item === 'object') {
    const thumb = item.thumb != null ? String(item.thumb).trim() : '';
    const url = item.url != null ? String(item.url).trim() : '';
    let src = '';
    if (isHttpThumbUrl(thumb)) {
      src = thumb;
    } else if (url) {
      src = url;
    } else if (thumb) {
      src = thumb;
    }
    // eslint-disable-next-line no-console
    console.log('[Website editor media]', { ...logMeta, thumb, url, srcFinal: src });
    return src;
  }
  // eslint-disable-next-line no-console
  console.log('[Website editor media]', { ...logMeta, thumb: undefined, url: undefined, srcFinal: '' });
  return '';
}

/** Grelha de thumbnails: colunas 280–320px, alinhamento consistente. */
const MEDIA_THUMB_GRID_CLASS =
  'grid w-full justify-center gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,320px))]';

/** Área 3:4: imagem só com src válido; vídeo ou falha → placeholder (sem ícone partido). */
function MediaThumbFrame({
  src,
  isVideo = false,
  children,
  videoLabel = 'Vídeo',
  emptyLabel = 'Sem imagem',
}) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [src]);
  const showImg = Boolean(src) && !isVideo && !imgFailed;
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-100">
      {isVideo ? (
        <div className="flex h-full min-h-0 w-full items-center justify-center bg-gradient-to-b from-slate-200 to-slate-300/90 p-3 text-center">
          <span className="text-xs font-medium text-slate-600">{videoLabel}</span>
        </div>
      ) : showImg ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setImgFailed(true)}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
        />
      ) : (
        <div className="flex h-full min-h-0 w-full items-center justify-center border border-dashed border-slate-200 bg-slate-50 p-2 text-center text-xs text-slate-500">
          {emptyLabel}
        </div>
      )}
      {children}
    </div>
  );
}

/** Novo array com mesmos elementos; só muda a ordem. */
function reorderApiMedia(arr, fromIndex, toIndex) {
  if (fromIndex === toIndex) return arr;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= arr.length || toIndex >= arr.length) return arr;
  const next = [...arr];
  const [removed] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, removed);
  return next;
}

/** Novo array: item em `index` passa para índice 0 (capa). */
function moveToCover(arr, index) {
  if (index <= 0 || index >= arr.length) return arr;
  const next = [...arr];
  const [removed] = next.splice(index, 1);
  next.unshift(removed);
  return next;
}

/** Novo array sem o índice. */
function removeApiMediaAt(arr, index) {
  if (index < 0 || index >= arr.length) return arr;
  return arr.filter((_, i) => i !== index);
}

/** Novo array; no índice, cópia rasa do objeto com `polaroid` alternado. */
function togglePolaroidAt(arr, index) {
  if (index < 0 || index >= arr.length) return arr;
  const next = [...arr];
  const el = next[index];
  if (!el || typeof el !== 'object') return arr;
  next[index] = Object.assign({}, el, { polaroid: !Boolean(el.polaroid) });
  return next;
}

function mapDetailToForm(detail) {
  const base = createInitialForm();
  if (!detail || typeof detail !== 'object') return base;
  const cats = Array.isArray(detail.categories) ? detail.categories.map((c) => String(c).toLowerCase()) : [];
  const cat = String(detail.category || '').toLowerCase();
  const has = (x) => cats.includes(x) || cat === x;
  return {
    ...base,
    nome: detail.name != null ? String(detail.name) : '',
    bio:
      detail.bio != null
        ? String(detail.bio)
        : detail.description != null
          ? String(detail.description)
          : '',
    featured: detail.featured === true,
    ativo: detail.active !== false && detail.ativo !== false,
    catFeminino: has('women') || has('feminino'),
    catMasculino: has('men') || has('masculino'),
    catCreators: has('creators'),
    medida_altura: detail.height != null ? String(detail.height) : '',
    medida_busto: detail.bust != null ? String(detail.bust) : '',
    medida_torax:
      detail.chest != null
        ? String(detail.chest)
        : detail.torax != null
          ? String(detail.torax)
          : '',
    medida_cintura: detail.waist != null ? String(detail.waist) : '',
    medida_quadril: detail.hips != null ? String(detail.hips) : '',
    medida_sapato: detail.shoes != null ? String(detail.shoes) : '',
    medida_cabelo: detail.hair != null ? String(detail.hair) : '',
    medida_olhos: detail.eyes != null ? String(detail.eyes) : '',
    instagram: detail.instagram != null ? String(detail.instagram) : '',
    tiktok: detail.tiktok != null ? String(detail.tiktok) : '',
    video_url:
      detail.video_url != null
        ? String(detail.video_url)
        : detail.video != null
          ? String(detail.video)
          : '',
    slug_site: detail.slug != null ? String(detail.slug) : '',
    observacoes: detail.observacoes != null ? String(detail.observacoes) : '',
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
 * Formulário Website — criação (vazio) ou edição (carrega GET público por slug).
 * Sem persistência de gravação.
 */
export default function WebsiteModeloEditorPage({ mode = 'create', editSlug = '', onBackToList }) {
  const fileInputId = `${useId()}-files`;
  const isEdit = mode === 'edit';
  const [form, setForm] = useState(createInitialForm);
  /** Em edição: itens exatamente como em `detail.media` da API (ordem preservada). */
  const [apiMedia, setApiMedia] = useState([]);
  /** ID do modelo no site (GET /website/models/:slug) para PATCH .../admin/models/:id/media */
  const [websiteModelId, setWebsiteModelId] = useState(null);
  /** Em criação: pré-visualizações locais (ficheiros). */
  const [localMediaItems, setLocalMediaItems] = useState([]);
  const [loadLoading, setLoadLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [editBoot, setEditBoot] = useState(() => isEdit && String(editSlug || '').trim() !== '');
  const localMediaRef = useRef([]);
  useEffect(() => {
    localMediaRef.current = localMediaItems;
  }, [localMediaItems]);

  useEffect(() => {
    if (!isEdit || !String(editSlug || '').trim()) {
      setForm(createInitialForm());
      setApiMedia([]);
      setWebsiteModelId(null);
      setLocalMediaItems([]);
      setLoadError('');
      setLoadLoading(false);
      setEditBoot(false);
      setSaveMessage('');
      setSaveError('');
      return;
    }
    let cancelled = false;
    (async () => {
      setEditBoot(true);
      setLoadLoading(true);
      setLoadError('');
      setSaveMessage('');
      setSaveError('');
      try {
        const r = await fetchWithTimeout(`${API_BASE}/website/models/${encodeURIComponent(String(editSlug).trim())}`);
        const raw = await r.text();
        throwIfHtmlOrCannotPost(raw, r.status);
        let data;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          throw new Error('Resposta inválida do servidor.');
        }
        if (!r.ok) {
          const msg = data && typeof data.message === 'string' ? data.message : `HTTP ${r.status}`;
          throw new Error(msg);
        }
        if (cancelled) return;
        const d = data && typeof data === 'object' ? data : null;
        setForm(mapDetailToForm(d));
        setApiMedia(d ? cloneMediaArrayFromDetail(d) : []);
        setLocalMediaItems([]);
        setWebsiteModelId(
          d && d.id != null && String(d.id).trim() !== '' ? String(d.id) : null,
        );
      } catch (e) {
        if (!cancelled) setLoadError(e?.message ? String(e.message) : 'Erro ao carregar.');
      } finally {
        if (!cancelled) {
          setLoadLoading(false);
          setEditBoot(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, editSlug]);

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
    if (isEdit) return;
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setLocalMediaItems((prev) => {
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

  const removeLocalMedia = (id) => {
    setLocalMediaItems((prev) => {
      const item = prev.find((x) => x.id === id);
      if (item?.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview);
      return prev.filter((x) => x.id !== id);
    });
  };

  const moveLocalMedia = (index, delta) => {
    setLocalMediaItems((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  useEffect(() => {
    return () => {
      localMediaRef.current.forEach((m) => {
        if (m.preview?.startsWith('blob:')) URL.revokeObjectURL(m.preview);
      });
    };
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
  };

  const reloadEdit = useCallback(() => {
    if (!isEdit || !String(editSlug || '').trim()) return;
    const slug = String(editSlug).trim();
    setLoadLoading(true);
    setLoadError('');
    setSaveMessage('');
    setSaveError('');
    (async () => {
      try {
        const r = await fetchWithTimeout(`${API_BASE}/website/models/${encodeURIComponent(slug)}`);
        const raw = await r.text();
        throwIfHtmlOrCannotPost(raw, r.status);
        let data;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          throw new Error('Resposta inválida do servidor.');
        }
        if (!r.ok) {
          const msg = data && typeof data.message === 'string' ? data.message : `HTTP ${r.status}`;
          throw new Error(msg);
        }
        const d = data && typeof data === 'object' ? data : null;
        setForm(mapDetailToForm(d));
        setApiMedia(d ? cloneMediaArrayFromDetail(d) : []);
        setLocalMediaItems([]);
        setWebsiteModelId(
          d && d.id != null && String(d.id).trim() !== '' ? String(d.id) : null,
        );
      } catch (e) {
        setLoadError(e?.message ? String(e.message) : 'Erro ao carregar.');
      } finally {
        setLoadLoading(false);
      }
    })();
  }, [isEdit, editSlug]);

  const handleSaveMedia = useCallback(async () => {
    if (!isEdit || !websiteModelId) return;
    setSaveLoading(true);
    setSaveMessage('');
    setSaveError('');
    try {
      const r = await fetchWithTimeout(`${API_BASE}/admin/models/${encodeURIComponent(websiteModelId)}/media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ media: apiMedia }),
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = raw ? JSON.parse(raw) : null;
          if (j && typeof j.message === 'string') msg = j.message;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      setSaveMessage('Salvo com sucesso');
    } catch (e) {
      setSaveError(e?.message ? String(e.message) : 'Erro ao salvar.');
    } finally {
      setSaveLoading(false);
    }
  }, [isEdit, websiteModelId, apiMedia]);

  const clearForm = () => {
    if (isEdit) {
      reloadEdit();
      return;
    }
    setForm(createInitialForm());
    setApiMedia([]);
    setLocalMediaItems((prev) => {
      prev.forEach((m) => {
        if (m.preview?.startsWith('blob:')) URL.revokeObjectURL(m.preview);
      });
      return [];
    });
  };

  const handleApiMediaDragStart = useCallback((e, index) => {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleApiMediaDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleApiMediaDrop = useCallback((e, dropIndex) => {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (Number.isNaN(from)) return;
    setApiMedia((prev) => reorderApiMedia(prev, from, dropIndex));
  }, []);

  const handleApiMediaSetCover = useCallback((index) => {
    setApiMedia((prev) => moveToCover(prev, index));
  }, []);

  const handleApiMediaTogglePolaroid = useCallback((index) => {
    setApiMedia((prev) => togglePolaroidAt(prev, index));
  }, []);

  const handleApiMediaRemove = useCallback((index) => {
    setApiMedia((prev) => removeApiMediaAt(prev, index));
  }, []);

  const formas = form.formas_pagamento?.length ? form.formas_pagamento : [emptyFormaRecebimento()];

  if (isEdit && editBoot) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        A carregar modelo…
      </div>
    );
  }

  if (isEdit && loadError) {
    return (
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
        <button
          type="button"
          onClick={() => onBackToList && onBackToList()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
        >
          ← Voltar à lista
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {isEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onBackToList && onBackToList()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Voltar à lista
          </button>
        </div>
      ) : null}

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
          <Field label="Slug (URL no site)" className="md:col-span-2">
            <input
              value={form.slug_site}
              onChange={(e) => setField('slug_site', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="ex.: nome-da-modelo"
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
            {isEdit ? (
              <p className="text-xs text-slate-500">
                Edição local do array <code className="rounded bg-slate-100 px-1">media</code> (arrastar para
                reordenar; use <strong>Salvar</strong> para persistir).
              </p>
            ) : (
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
            )}

            {isEdit ? (
              apiMedia.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                  O endpoint não devolveu itens em <code className="rounded bg-slate-100 px-1">media</code>.
                </p>
              ) : (
                <ul className={MEDIA_THUMB_GRID_CLASS}>
                  {apiMedia.map((item, index) => {
                    const isVideo = isMediaItemVideo(item);
                    const src = resolveModelEditorMediaImageSrc(item, { index });
                    const isCover = index === 0;
                    const polaroidOn =
                      item && typeof item === 'object' && (item.polaroid === true || item.polaroid === 'true');
                    return (
                      <li
                        key={index}
                        draggable
                        onDragStart={(e) => handleApiMediaDragStart(e, index)}
                        onDragOver={handleApiMediaDragOver}
                        onDrop={(e) => handleApiMediaDrop(e, index)}
                        className={`min-w-0 w-full max-w-[320px] overflow-hidden rounded-xl border bg-white shadow-sm ${
                          isCover ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-200'
                        } ${polaroidOn ? 'ring-1 ring-sky-300' : ''}`}
                      >
                        <MediaThumbFrame src={src} isVideo={isVideo} emptyLabel="Sem pré-visualização">
                          <div className="pointer-events-none absolute left-2 top-2 z-[1] flex flex-wrap gap-1">
                            {isCover ? (
                              <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white shadow">
                                Capa
                              </span>
                            ) : (
                              <span className="rounded bg-black/60 px-2 py-0.5 text-xs text-white">{index + 1}</span>
                            )}
                            {polaroidOn ? (
                              <span className="rounded bg-sky-600 px-2 py-0.5 text-xs font-medium text-white shadow">
                                Polaroid
                              </span>
                            ) : null}
                          </div>
                          <span
                            className="pointer-events-none absolute bottom-2 right-2 z-[1] rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white"
                            title="Arrastar para reordenar"
                          >
                            ⋮⋮
                          </span>
                        </MediaThumbFrame>
                        <div className="flex flex-wrap gap-1 border-t border-slate-200 p-2">
                          <button
                            type="button"
                            disabled={isCover}
                            onClick={() => handleApiMediaSetCover(index)}
                            className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-950 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Capa
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApiMediaTogglePolaroid(index)}
                            className={`rounded border px-2 py-1 text-xs font-medium ${
                              polaroidOn
                                ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                                : 'border-sky-300 bg-sky-50 text-sky-900'
                            }`}
                          >
                            Polaroid
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApiMediaRemove(index)}
                            className="ml-auto rounded border border-red-200 px-2 py-1 text-xs text-red-700"
                          >
                            Apagar
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : localMediaItems.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                Nenhuma imagem adicionada.
              </p>
            ) : (
              <ul className={MEDIA_THUMB_GRID_CLASS}>
                {localMediaItems.map((item, index) => (
                  <li
                    key={item.id}
                    className="min-w-0 w-full max-w-[320px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                  >
                    <MediaThumbFrame src={item.preview} emptyLabel="Sem pré-visualização.">
                      <span className="pointer-events-none absolute left-2 top-2 z-[1] rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                        {index + 1}
                      </span>
                    </MediaThumbFrame>
                    <div className="flex flex-wrap gap-1 border-t border-slate-200 p-2">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveLocalMedia(index, -1)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
                        title="Mover para cima"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === localMediaItems.length - 1}
                        onClick={() => moveLocalMedia(index, 1)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
                        title="Mover para baixo"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeLocalMedia(item.id)}
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

        <div className="flex flex-col items-end gap-2 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={clearForm}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {isEdit ? 'Repor dados do site' : 'Limpar formulário'}
            </button>
            {isEdit ? (
              <button
                type="button"
                onClick={handleSaveMedia}
                disabled={!websiteModelId || saveLoading}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                title={!websiteModelId ? 'Modelo sem ID no site — não é possível salvar media.' : undefined}
              >
                {saveLoading ? 'A guardar…' : 'Salvar'}
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
              >
                Guardar (em breve)
              </button>
            )}
          </div>
          {saveMessage ? <p className="text-sm text-emerald-700">{saveMessage}</p> : null}
          {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}
        </div>
      </form>
    </div>
  );
}
