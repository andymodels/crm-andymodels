import { useCallback, useEffect, useId, useRef, useState } from 'react';
import DynamicTextListField from './DynamicTextListField';
import { API_BASE, fetchWithAuth, fetchWithTimeout, throwIfHtmlOrCannotPost } from '../apiConfig';
import { onlyDigits, formatPhoneBRMask, formatCEPMask, isValidEmail } from '../utils/brValidators';
import {
  extractYoutubeVideoId,
  getWebsiteModelPublicUrl,
  normalizeHttpUrl,
  youtubePosterFromAnyUrl,
} from '../utils/websiteMediaDisplay';
import { WebsiteMediaImg, mediaItemThumbOrUrl } from './WebsiteMediaImage';
import WebsitePublicVideoEmbed from './WebsitePublicVideoEmbed';
import { toDateInputValue } from '../utils/dateInput';

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
    /** Nome civil / cadastro completo (API: full_name, se o site suportar). */
    nome_completo: '',
    /** Nome exibido na vitrine e no perfil público (API: name). */
    nome: '',
    /** Cadastro interno — não é exibida na vitrine (API: birth_date / data_nascimento). */
    data_nascimento: '',
    bio: '',
    featured: false,
    ativo: true,
    catFeminino: true,
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
    telefones: [''],
    emails: [''],
    instagram: '',
    /** Se falso, o utilizador pode guardar o @ mas o site pode ocultar o link no perfil público. */
    mostrar_instagram: true,
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
    /** GET/PATCH — texto único opcional exibido no site (ex.: public_info) */
    public_info: '',
  };
}

/** Valor do campo no CRM: URL completa no instagram.com; handles só texto viram https://instagram.com/… */
function instagramDisplayFromStored(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const noAt = s.replace(/^@/, '');
  try {
    const u = new URL(/^https?:\/\//i.test(noAt) ? noAt : `https://${noAt.replace(/^\/+/, '')}`);
    if (u.hostname.replace(/^www\./, '').includes('instagram.com')) {
      u.hash = '';
      const host = u.hostname.replace(/^www\./, '');
      let path = u.pathname || '/';
      if (path !== '/' && path.length > 1) path = path.replace(/\/$/, '');
      return `https://${host}${path}${u.search || ''}`;
    }
    if (/^https?:\/\//i.test(noAt)) return noAt;
  } catch {
    /* handle só texto */
  }
  const bare = noAt.replace(/^\//, '').split(/[/?#]/)[0];
  if (bare && /^[\w.]+$/.test(bare)) {
    return `https://instagram.com/${bare}`;
  }
  return noAt;
}

function instagramUrlFromUsername(username) {
  const u = String(username || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '');
  if (!u) return '';
  return `https://instagram.com/${u}`;
}

/** Apenas `model.media` da API, sem cover_image/images/concatenações. */
function mediaArrayFromDetail(detail) {
  if (!detail || typeof detail !== 'object') return [];
  const m = detail.media;
  return Array.isArray(m) ? m.slice() : [];
}

/** Grelha como no site institucional. */
const WEBSITE_GALLERY_GRID_CLASS =
  'grid w-full grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1';

/** Mensagem útil em respostas JSON do proxy / site. */
function extractApiErrorMessage(data) {
  if (!data || typeof data !== 'object') return '';
  for (const k of ['message', 'error', 'msg', 'detail', 'details']) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Multipart: o site costuma usar um único campo `photos` para imagens e vídeo (MP4/WebM).
 * O campo `gallery` em alguns builds provoca erro 500 no processamento — não usar para ficheiros.
 */
function isImageFileForGalleryUpload(f) {
  if (!(f instanceof File)) return false;
  const t = String(f.type || '');
  if (t.startsWith('image/')) return true;
  if (!t && /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name || '')) return true;
  return false;
}

function isVideoFileUpload(f) {
  if (!(f instanceof File)) return false;
  const t = String(f.type || '');
  if (t.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|m4v|avi)$/i.test(f.name || '');
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

/** Índices ordenados; todos consecutivos → { start, end }; senão null. */
function consecutiveBlockRange(indices) {
  if (!indices.length) return null;
  const s = [...indices].sort((a, b) => a - b);
  for (let i = 1; i < s.length; i += 1) {
    if (s[i] !== s[i - 1] + 1) return null;
  }
  return { start: s[0], end: s[s.length - 1] };
}

/**
 * Move o bloco contíguo [start..end] para começar na posição dropIndex (como reorderApiMedia para um item).
 */
function reorderBlockTo(arr, start, end, dropIndex) {
  if (start < 0 || end >= arr.length || start > end) return arr;
  if (dropIndex < 0 || dropIndex >= arr.length) return arr;
  if (dropIndex >= start && dropIndex <= end) return arr;
  const len = end - start + 1;
  const block = arr.slice(start, end + 1);
  const without = [...arr.slice(0, start), ...arr.slice(end + 1)];
  let insertAt = dropIndex;
  if (dropIndex > end) insertAt = dropIndex - len;
  return [...without.slice(0, insertAt), ...block, ...without.slice(insertAt)];
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

/**
 * Corpo PUT /api/admin/models/:id no site (adminModels.js): strings featured/active '1'/'0',
 * model_status para linha nos cards, categories em JSON, sem public_info/creator/description.
 */
function formToWebsiteModelPut(form) {
  const trim = (s) => (s != null ? String(s).trim() : '');
  const baseCat = form.catMasculino ? 'men' : 'women';
  const categories = [baseCat];
  if (form.catCreators) categories.push('creators');

  const bioText = trim(form.bio);
  let ig = trim(form.instagram);
  if (ig) {
    if (!/^https?:\/\//i.test(ig)) {
      ig = instagramUrlFromUsername(ig);
    } else {
      try {
        const u = new URL(ig);
        if (u.hostname.replace(/^www\./, '').includes('instagram.com')) {
          u.hash = '';
          const host = u.hostname.replace(/^www\./, '');
          let path = u.pathname || '/';
          if (path !== '/' && path.length > 1) path = path.replace(/\/$/, '');
          ig = `https://${host}${path}${u.search || ''}`;
        }
      } catch {
        /* mantém */
      }
    }
  } else {
    ig = '';
  }

  const pi = trim(form.public_info);
  const nomeSite = trim(form.nome);
  const nomeCompleto = trim(form.nome_completo);

  const out = {
    name: nomeSite,
    bio: bioText,
    featured: form.featured ? '1' : '0',
    active: form.ativo ? '1' : '0',
    categories: JSON.stringify(categories),
    shoes: trim(form.medida_sapato) || null,
    hair: trim(form.medida_cabelo) || null,
    eyes: trim(form.medida_olhos) || null,
    waist: trim(form.medida_cintura) || null,
    instagram: ig || null,
    show_instagram: form.mostrar_instagram ? '1' : '0',
    tiktok: trim(form.tiktok) || null,
    ...(() => {
      const v = trim(form.video_url);
      if (!v) return { youtube: null, video_url: null };
      const n = normalizeHttpUrl(v);
      /** Alguns endpoints do site leem `youtube`, outros `video_url` — enviamos os dois. */
      return { youtube: n, video_url: n };
    })(),
  };

  if (pi) out.model_status = pi;

  /** Nome completo para cadastro; o site deve persistir `full_name` (reencaminhado pelo proxy). */
  if (nomeCompleto) out.full_name = nomeCompleto;

  const dn = trim(form.data_nascimento);
  /** Data de nascimento só para arquivo interno; o CRM não usa isto no perfil público. */
  if (dn) {
    out.birth_date = dn;
    out.data_nascimento = dn;
  }

  if (baseCat === 'women') {
    out.height = trim(form.medida_altura) || null;
    out.bust = trim(form.medida_busto) || null;
    out.waist = trim(form.medida_cintura) || null;
    out.hips = trim(form.medida_quadril) || null;
    out.torax = '';
  } else {
    out.height = trim(form.medida_altura) || null;
    out.torax = trim(form.medida_torax) || null;
    out.waist = trim(form.medida_cintura) || null;
    out.bust = '';
    out.hips = '';
  }

  const slug = trim(form.slug_site);
  if (slug) out.slug = slug;
  return out;
}

/** Anexa objeto plano ao FormData (valores em string; objetos com JSON.stringify). */
function appendModelFieldsToFormData(fd, obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
}

function mapDetailToForm(detail) {
  const base = createInitialForm();
  if (!detail || typeof detail !== 'object') return base;
  const cats = Array.isArray(detail.categories) ? detail.categories.map((c) => String(c).toLowerCase()) : [];
  const cat = String(detail.category || '').toLowerCase();
  const has = (x) => cats.includes(x) || cat === x;
  const creatorFlag =
    detail.creator === 1 ||
    detail.creator === true ||
    Number(detail.creator) === 1 ||
    has('creators');
  const isMen = has('men') || has('masculino') || cat === 'men' || cat === 'masculino';

  const legacyPublic =
    detail.model_status != null && String(detail.model_status).trim() !== ''
      ? String(detail.model_status).trim()
      : detail.public_info != null && String(detail.public_info).trim() !== ''
        ? String(detail.public_info).trim()
        : [detail.city]
            .filter((x) => x != null && String(x).trim() !== '')
            .map((x) => String(x).trim())
            .join(' · ');

  const igStored = detail.instagram != null ? String(detail.instagram) : '';

  const nomeSite = detail.name != null ? String(detail.name) : '';
  const nomeCompletoFromApi = (() => {
    const raw =
      detail.full_name != null
        ? String(detail.full_name)
        : detail.legal_name != null
          ? String(detail.legal_name)
          : '';
    const t = raw.trim();
    if (t) return t;
    /** Modelos antigos: um único «name» servia para tudo — repete no completo até editar. */
    return nomeSite.trim();
  })();

  const dataNascFromApi =
    detail.birth_date != null
      ? String(detail.birth_date)
      : detail.data_nascimento != null
        ? String(detail.data_nascimento)
        : detail.date_of_birth != null
          ? String(detail.date_of_birth)
          : detail.birthdate != null
            ? String(detail.birthdate)
            : '';

  return {
    ...base,
    nome_completo: nomeCompletoFromApi,
    nome: nomeSite,
    data_nascimento: toDateInputValue(dataNascFromApi),
    bio:
      detail.bio != null
        ? String(detail.bio)
        : detail.description != null
          ? String(detail.description)
          : '',
    featured: Number(detail.featured) === 1 || detail.featured === true,
    ativo: !(Number(detail.active) === 0 || detail.active === false || detail.ativo === false),
    catFeminino: !isMen,
    catMasculino: isMen,
    catCreators: creatorFlag,
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
    instagram: instagramDisplayFromStored(igStored),
    mostrar_instagram: (() => {
      const v = detail.show_instagram ?? detail.instagram_visible;
      if (v === undefined || v === null) return true;
      if (v === false || v === '0' || v === 0 || Number(v) === 0) return false;
      return true;
    })(),
    tiktok: detail.tiktok != null ? String(detail.tiktok) : '',
    video_url:
      detail.youtube != null
        ? String(detail.youtube)
        : detail.video_url != null
          ? String(detail.video_url)
          : detail.video != null
            ? String(detail.video)
            : '',
    slug_site: detail.slug != null ? String(detail.slug) : '',
    observacoes: detail.observacoes != null ? String(detail.observacoes) : '',
    public_info: legacyPublic,
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
 * Cadastro mestre Website — «Novo modelo» (mode=create) e «Editar modelo» (mode=edit) são o MESMO ecrã.
 * Qualquer ajuste de campo, mídia ou validação deve ser feito aqui; não há segunda página de cadastro.
 * Salvar: PUT/POST no site via CRM (multipart ou JSON); galeria pela resposta ou GET /website/models/:slug.
 */
export default function WebsiteModeloEditorPage({
  mode = 'create',
  editSlug = '',
  editModelId = null,
  onBackToList,
}) {
  const fileInputId = `${useId()}-files`;
  const isEdit = mode === 'edit';
  const [form, setForm] = useState(createInitialForm);
  /** Em edição: cópia de `model.media` apenas — URLs tal como no backend. */
  const [apiMedia, setApiMedia] = useState([]);
  /** Em criação: pré-visualizações locais (ficheiros). */
  const [localMediaItems, setLocalMediaItems] = useState([]);
  const [loadLoading, setLoadLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  /** ID numérico do modelo no site (GET /api/models/:slug → id). */
  const [websiteModelId, setWebsiteModelId] = useState(null);
  const [saveSaving, setSaveSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState('');
  const [fileQueueNotice, setFileQueueNotice] = useState('');
  const [editBoot, setEditBoot] = useState(() => isEdit && String(editSlug || '').trim() !== '');
  /** Edição: índices de fotos selecionadas para mover bloco (sequência contígua). */
  const [apiMediaSelected, setApiMediaSelected] = useState(() => new Set());
  const cepLookupRef = useRef(null);
  const localMediaRef = useRef([]);
  useEffect(() => {
    localMediaRef.current = localMediaItems;
  }, [localMediaItems]);

  useEffect(() => {
    const d = onlyDigits(form.cep);
    if (d.length !== 8) return undefined;
    if (cepLookupRef.current) clearTimeout(cepLookupRef.current);
    cepLookupRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
        const data = await r.json();
        if (data.erro) return;
        setForm((p) => ({
          ...p,
          logradouro: data.logradouro ? String(data.logradouro) : p.logradouro,
          bairro: data.bairro ? String(data.bairro) : p.bairro,
          cidade: data.localidade ? String(data.localidade) : p.cidade,
          uf: data.uf ? String(data.uf).toUpperCase().slice(0, 2) : p.uf,
        }));
      } catch {
        /* ignorar rede */
      }
    }, 450);
    return () => {
      if (cepLookupRef.current) clearTimeout(cepLookupRef.current);
    };
  }, [form.cep]);

  useEffect(() => {
    const slug = String(editSlug || '').trim();
    const mid = editModelId != null && !Number.isNaN(Number(editModelId)) ? Number(editModelId) : null;
    if (!isEdit || (!slug && mid == null)) {
      setForm(createInitialForm());
      setApiMedia([]);
      setLocalMediaItems([]);
      setWebsiteModelId(null);
      setSaveError('');
      setSaveOk('');
      setLoadError('');
      setLoadLoading(false);
      setEditBoot(false);
      setApiMediaSelected(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      setEditBoot(true);
      setLoadLoading(true);
      setLoadError('');
      try {
        let d = null;
        if (mid != null) {
          const rAdm = await fetchWithAuth(`${API_BASE}/admin/models/${mid}`);
          const rawAdm = await rAdm.text();
          throwIfHtmlOrCannotPost(rawAdm, rAdm.status);
          let adm;
          try {
            adm = rawAdm ? JSON.parse(rawAdm) : null;
          } catch {
            adm = null;
          }
          if (rAdm.ok && adm && typeof adm === 'object') {
            d = adm;
          }
        }
        if (!d && slug) {
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
          d = data && typeof data === 'object' ? data : null;
        }
        if (!d) {
          throw new Error('Não foi possível carregar o modelo. Volte à lista e abra o modelo de novo.');
        }
        if (cancelled) return;
        setForm(mapDetailToForm(d));
        setApiMedia(mediaArrayFromDetail(d));
        setWebsiteModelId(d.id != null ? Number(d.id) : null);
        setSaveError('');
        setSaveOk('');
        setLocalMediaItems([]);
        setApiMediaSelected(new Set());
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
  }, [isEdit, editSlug, editModelId]);

  const setField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const normalizeList = (arr) => (Array.isArray(arr) && arr.length > 0 ? arr.map((x) => String(x ?? '')) : ['']);

  const addTelefone = () => setForm((p) => ({ ...p, telefones: [...normalizeList(p.telefones), ''] }));
  const updateTelefone = (i, v) =>
    setForm((p) => {
      const t = [...normalizeList(p.telefones)];
      t[i] = formatPhoneBRMask(v);
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
    setFileQueueNotice('');
    let skippedOther = false;
    setLocalMediaItems((prev) => {
      const next = [...prev];
      for (const f of files) {
        if (isVideoFileUpload(f)) {
          const id =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          next.push({
            id,
            preview: URL.createObjectURL(f),
            name: f.name,
            file: f,
            polaroid: false,
            isVideo: true,
          });
          continue;
        }
        if (!isImageFileForGalleryUpload(f)) {
          skippedOther = true;
          continue;
        }
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        next.push({
          id,
          preview: URL.createObjectURL(f),
          name: f.name,
          file: f,
          polaroid: false,
          isVideo: false,
        });
      }
      return next;
    });
    if (skippedOther) {
      setFileQueueNotice('Alguns ficheiros foram ignorados — use imagens (JPEG, PNG…) ou vídeo (MP4, WebM…).');
    }
    e.target.value = '';
  };

  const removeLocalMediaConfirmed = useCallback((id) => {
    setLocalMediaItems((prev) => {
      const item = prev.find((x) => x.id === id);
      if (item?.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const setLocalCover = useCallback((index) => {
    setLocalMediaItems((prev) => moveToCover(prev, index));
  }, []);

  const toggleLocalPolaroid = useCallback((index) => {
    setLocalMediaItems((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = [...prev];
      const el = next[index];
      next[index] = { ...el, polaroid: !Boolean(el.polaroid) };
      return next;
    });
  }, []);

  const handleLocalDragStart = useCallback((e, index) => {
    e.dataTransfer.setData('text/plain', `local:${index}`);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleLocalDrop = useCallback((e, dropIndex) => {
    e.preventDefault();
    const plain = e.dataTransfer.getData('text/plain');
    if (!plain.startsWith('local:')) return;
    const from = parseInt(plain.slice(6), 10);
    if (Number.isNaN(from)) return;
    setLocalMediaItems((prev) => reorderApiMedia(prev, from, dropIndex));
  }, []);

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

  /**
   * Fluxo suportado pelo CRM (proxy): multipart ou JSON para PUT/POST no site;
   * se a resposta não trouxer `media`, obtém URLs com GET /api/website/models/:slug (já existente).
   * Não usar POST /api/admin/models/:id/media/upload (não existe no site nem deve existir no CRM).
   */
  const saveAllToSite = useCallback(async () => {
    setSaveSaving(true);
    setSaveError('');
    setSaveOk('');
    setFileQueueNotice('');
    try {
      const emails = normalizeList(form.emails).map((x) => String(x || '').trim().toLowerCase());
      for (let i = 0; i < emails.length; i += 1) {
        if (emails[i] && !isValidEmail(emails[i])) {
          throw new Error(`E-mail ${i + 1} com formato inválido.`);
        }
      }

      const nomeCompletoOk = String(form.nome_completo || '').trim();
      const nomeSiteOk = String(form.nome || '').trim();
      if (!nomeCompletoOk) {
        throw new Error('Preencha «Nome completo» (cadastro com o nome inteiro da pessoa).');
      }
      if (!nomeSiteOk) {
        throw new Error('Preencha «Nome para o site» (como quer que apareça na vitrine).');
      }

      const pendingImageFiles = localMediaItems.filter(
        (x) => x.file instanceof File && isImageFileForGalleryUpload(x.file),
      );
      const pendingVideoFiles = localMediaItems.filter(
        (x) => x.file instanceof File && isVideoFileUpload(x.file),
      );

      const putBase = formToWebsiteModelPut(form);
      /**
       * NUNCA enviar `ordered_images` como "[]" só porque o estado local está vazio (ex.: modelo inativo
       * ausente na API pública) — o site substitui a galeria e apaga fotos. Só incluir galeria quando há
       * itens em memória OU uploads pendentes (primeira carga de ficheiros).
       */
      const mustPersistGallery =
        apiMedia.length > 0 || pendingImageFiles.length > 0 || pendingVideoFiles.length > 0;
      const putBody = { ...putBase };
      if (mustPersistGallery) {
        putBody.ordered_images = JSON.stringify(apiMedia);
      }

      let id = websiteModelId;
      const hasSiteId = id != null && !Number.isNaN(Number(id));
      const shouldUpdate = isEdit || hasSiteId;

      const parseJsonSafe = (raw) => {
        try {
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      };

      const applyMediaFromResponse = (data) => {
        const root = data && typeof data === 'object' ? data : null;
        const media = root?.media ?? root?.model?.media;
        if (Array.isArray(media)) {
          setApiMedia(media);
          return true;
        }
        return false;
      };

      if (shouldUpdate) {
        if (id == null || Number.isNaN(Number(id))) {
          throw new Error('ID do modelo no site não disponível. Recarregue a página.');
        }
        let r1;
        let raw1;
        if (pendingImageFiles.length > 0 || pendingVideoFiles.length > 0) {
          const fd = new FormData();
          appendModelFieldsToFormData(fd, putBody);
          pendingImageFiles.forEach((x) => {
            fd.append('photos', x.file, x.file.name || 'photo.jpg');
          });
          pendingVideoFiles.forEach((x) => {
            fd.append('photos', x.file, x.file.name || 'video.mp4');
          });
          r1 = await fetchWithAuth(`${API_BASE}/admin/models/${id}`, {
            method: 'PUT',
            body: fd,
          });
          raw1 = await r1.text();
        } else {
          r1 = await fetchWithAuth(`${API_BASE}/admin/models/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(putBody),
          });
          raw1 = await r1.text();
        }
        throwIfHtmlOrCannotPost(raw1, r1.status);
        const data1 = parseJsonSafe(raw1) || {};
        if (!r1.ok) {
          const serverMsg = extractApiErrorMessage(data1);
          let msg = serverMsg || `HTTP ${r1.status}`;
          if (r1.status === 500 && !serverMsg) {
            msg =
              'Erro interno no site (HTTP 500) ao guardar. MP4 é um formato normal; a falha costuma ser limite de tamanho, tempo de processamento ou o servidor do site. Tente um ficheiro mais pequeno ou use «Vídeo (URL)».';
          }
          throw new Error(`[Dados do modelo] ${msg}`);
        }
        if (pendingImageFiles.length > 0 || pendingVideoFiles.length > 0) {
          setLocalMediaItems((prev) => {
            prev.forEach((m) => {
              if (m.preview?.startsWith('blob:')) URL.revokeObjectURL(m.preview);
            });
            return [];
          });
        }
        if (!applyMediaFromResponse(data1)) {
          const slug =
            String(form.slug_site || '').trim() || (isEdit ? String(editSlug || '').trim() : '');
          let media = null;
          if (slug) {
            const rf = await fetchWithAuth(`${API_BASE}/website/models/${encodeURIComponent(slug)}`);
            const rawRf = await rf.text();
            throwIfHtmlOrCannotPost(rawRf, rf.status);
            const detailRf = parseJsonSafe(rawRf) || {};
            if (rf.ok && Array.isArray(detailRf.media)) {
              media = detailRf.media;
            }
          }
          if (!media && id != null) {
            const rAdm = await fetchWithAuth(`${API_BASE}/admin/models/${id}`);
            const rawAdm = await rAdm.text();
            throwIfHtmlOrCannotPost(rawAdm, rAdm.status);
            const adm = parseJsonSafe(rawAdm) || {};
            if (rAdm.ok && Array.isArray(adm.media)) {
              media = adm.media;
            }
          }
          if (!media) {
            throw new Error(
              'Não foi possível atualizar a pré-visualização da galeria. Recarregue a página ou volte à lista.',
            );
          }
          setApiMedia(media);
        }
      } else {
        let r0;
        let raw0;
        if (pendingImageFiles.length > 0 || pendingVideoFiles.length > 0) {
          const fd = new FormData();
          appendModelFieldsToFormData(fd, putBody);
          pendingImageFiles.forEach((x) => {
            fd.append('photos', x.file, x.file.name || 'photo.jpg');
          });
          pendingVideoFiles.forEach((x) => {
            fd.append('photos', x.file, x.file.name || 'video.mp4');
          });
          r0 = await fetchWithAuth(`${API_BASE}/admin/models`, {
            method: 'POST',
            body: fd,
          });
          raw0 = await r0.text();
        } else {
          r0 = await fetchWithAuth(`${API_BASE}/admin/models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(putBody),
          });
          raw0 = await r0.text();
        }
        throwIfHtmlOrCannotPost(raw0, r0.status);
        const data0 = parseJsonSafe(raw0) || {};
        if (!r0.ok) {
          const serverMsg = extractApiErrorMessage(data0);
          let msg = serverMsg || `HTTP ${r0.status}`;
          if (r0.status === 500 && !serverMsg) {
            msg =
              'Erro interno no site (HTTP 500) ao criar. MP4 é um formato normal; a falha costuma ser limite de tamanho ou o servidor do site. Tente um ficheiro mais pequeno ou use «Vídeo (URL)».';
          }
          throw new Error(`[Criar modelo] ${msg}`);
        }
        const newId = data0.id != null ? Number(data0.id) : NaN;
        if (Number.isNaN(newId)) {
          throw new Error('O site não devolveu o ID do novo modelo.');
        }
        id = newId;
        setWebsiteModelId(newId);
        if (pendingImageFiles.length > 0 || pendingVideoFiles.length > 0) {
          setLocalMediaItems((prev) => {
            prev.forEach((m) => {
              if (m.preview?.startsWith('blob:')) URL.revokeObjectURL(m.preview);
            });
            return [];
          });
        }
        if (!applyMediaFromResponse(data0)) {
          const slug =
            String(form.slug_site || '').trim() ||
            (data0 && data0.slug != null ? String(data0.slug).trim() : '');
          let media = null;
          if (slug) {
            const rf = await fetchWithAuth(`${API_BASE}/website/models/${encodeURIComponent(slug)}`);
            const rawRf = await rf.text();
            throwIfHtmlOrCannotPost(rawRf, rf.status);
            const detailRf = parseJsonSafe(rawRf) || {};
            if (rf.ok && Array.isArray(detailRf.media)) {
              media = detailRf.media;
            }
          }
          if (!media && id != null) {
            const rAdm = await fetchWithAuth(`${API_BASE}/admin/models/${id}`);
            const rawAdm = await rAdm.text();
            throwIfHtmlOrCannotPost(rawAdm, rAdm.status);
            const adm = parseJsonSafe(rawAdm) || {};
            if (rAdm.ok && Array.isArray(adm.media)) {
              media = adm.media;
            }
          }
          if (!media) {
            throw new Error(
              'O servidor não devolveu a galeria nem o slug. Abra o modelo na lista e tente de novo.',
            );
          }
          setApiMedia(media);
        }
      }

      setSaveOk('Salvo no site.');
    } catch (e) {
      setSaveError(e?.message ? String(e.message) : 'Erro ao salvar.');
    } finally {
      setSaveSaving(false);
    }
  }, [isEdit, editSlug, websiteModelId, form, apiMedia, localMediaItems]);

  const clearForm = () => {
    setForm(createInitialForm());
    setWebsiteModelId(null);
    setApiMedia([]);
    setFileQueueNotice('');
    setLocalMediaItems((prev) => {
      prev.forEach((m) => {
        if (m.preview?.startsWith('blob:')) URL.revokeObjectURL(m.preview);
      });
      return [];
    });
  };

  const handleApiMediaDragStart = useCallback(
    (e, index) => {
      const range = consecutiveBlockRange([...apiMediaSelected]);
      // Só move em bloco se a seleção for consecutiva e o arranque for dentro desse bloco; senão move só o cartão.
      if (range && index >= range.start && index <= range.end) {
        e.dataTransfer.setData('text/plain', `block:${range.start}:${range.end}`);
      } else {
        e.dataTransfer.setData('text/plain', String(index));
      }
      e.dataTransfer.effectAllowed = 'move';
    },
    [apiMediaSelected],
  );

  const handleApiMediaDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleApiMediaDrop = useCallback((e, dropIndex) => {
    e.preventDefault();
    const plain = e.dataTransfer.getData('text/plain');
    if (plain.startsWith('block:')) {
      const seg = plain.split(':');
      const start = Number(seg[1], 10);
      const end = Number(seg[2], 10);
      if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end) {
        setApiMedia((prev) => reorderBlockTo(prev, start, end, dropIndex));
        setApiMediaSelected(new Set());
        return;
      }
    }
    const from = parseInt(plain, 10);
    if (Number.isNaN(from)) return;
    setApiMedia((prev) => reorderApiMedia(prev, from, dropIndex));
    setApiMediaSelected(new Set());
  }, []);

  const handleApiMediaSetCover = useCallback((index) => {
    setApiMedia((prev) => moveToCover(prev, index));
  }, []);

  const handleApiMediaTogglePolaroid = useCallback((index) => {
    setApiMedia((prev) => togglePolaroidAt(prev, index));
  }, []);

  const toggleApiMediaSelect = useCallback((index) => {
    setApiMediaSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const removeSelectedApiMedia = useCallback(() => {
    const n = apiMediaSelected.size;
    if (n < 2) return;
    if (!window.confirm(`Apagar ${n} fotos selecionadas?`)) return;
    setApiMedia((prev) => prev.filter((_, i) => !apiMediaSelected.has(i)));
    setApiMediaSelected(new Set());
  }, [apiMediaSelected]);

  const applyRemoveApiMediaAt = useCallback((index) => {
    setApiMedia((prev) => removeApiMediaAt(prev, index));
    setApiMediaSelected((prevSel) => {
      const next = new Set();
      prevSel.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  }, []);

  const formas = form.formas_pagamento?.length ? form.formas_pagamento : [emptyFormaRecebimento()];

  const setGenderWomen = () => setForm((p) => ({ ...p, catFeminino: true, catMasculino: false }));
  const setGenderMen = () => setForm((p) => ({ ...p, catFeminino: false, catMasculino: true }));

  const addVideoToGallery = () => {
    const raw = String(form.video_url || '').trim();
    if (!raw) return;
    const normalized = normalizeHttpUrl(raw);
    const ytId = extractYoutubeVideoId(normalized);
    /** URL canónica watch?v= para o site público reconhecer YouTube (embed no cliente); não gravar só /embed/. */
    const urlForItem = ytId ? `https://www.youtube.com/watch?v=${ytId}` : normalized;
    const thumb =
      youtubePosterFromAnyUrl(normalized) || youtubePosterFromAnyUrl(urlForItem) || '';
    setApiMedia((prev) => [...prev, { type: 'video', url: urlForItem, thumb }]);
  };

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

  const saveDisabled =
    saveSaving || loadLoading || (isEdit && (websiteModelId == null || Number.isNaN(Number(websiteModelId))));
  const saveBar = (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/90 p-3 shadow-sm">
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={saveAllToSite}
          disabled={saveDisabled}
          className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saveSaving ? 'A salvar…' : 'Salvar'}
        </button>
      </div>
      {saveError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>
      ) : null}
      {saveOk ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{saveOk}</p>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-5">
        <Section title="Identificação e site">
          <Field label="Nome completo" className="md:col-span-2">
            <input
              value={form.nome_completo}
              onChange={(e) => setField('nome_completo', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Nome civil completo (cadastro interno)"
              autoComplete="name"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Nome civil completo para o vosso cadastro interno. O visitante vê apenas o «Nome para o site» em baixo.
            </p>
          </Field>
          <Field label="Nome para o site" className="md:col-span-2">
            <input
              value={form.nome}
              onChange={(e) => setField('nome', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Ex.: primeiro nome ou nome artístico — como aparece online"
              autoComplete="off"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              É o nome exibido na vitrine, nos cartões e no perfil público. Pode ser mais curto que o nome completo.
            </p>
          </Field>
          <Field label="Data de nascimento" className="md:col-span-2">
            <input
              type="date"
              value={toDateInputValue(form.data_nascimento)}
              onChange={(e) => setField('data_nascimento', e.target.value)}
              className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
              autoComplete="bday"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Cadastro interno no CRM — não é exibida na vitrine nem no perfil público do site.
            </p>
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
              Destaque na Home
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setField('ativo', e.target.checked)}
                className="rounded border-slate-300 text-amber-600 focus:ring-amber-400"
              />
              Ativo no site
            </label>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 md:col-span-2">
            <span className="font-medium text-slate-800">Ativo no site:</span> desmarcar só oculta o modelo da vitrine
            (tira do ar temporariamente). <span className="font-medium">Não apaga</span> fotos, vídeo nem dados — tudo
            continua guardado no servidor até voltar a marcar e salvar.
          </p>
          <div className="md:col-span-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Categoria no site</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
              <div className="flex flex-wrap gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="website-model-gender"
                    checked={form.catFeminino}
                    onChange={setGenderWomen}
                    className="border-slate-300 text-amber-600 focus:ring-amber-400"
                  />
                  Feminino
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="website-model-gender"
                    checked={form.catMasculino}
                    onChange={setGenderMen}
                    className="border-slate-300 text-amber-600 focus:ring-amber-400"
                  />
                  Masculino
                </label>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.catCreators}
                  onChange={(e) => setField('catCreators', e.target.checked)}
                  className="rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                />
                Creators (adicional — continua nas listagens de creators quando marcado)
              </label>
            </div>
          </div>
          <Field label="Informação pública" className="md:col-span-2">
            <input
              value={form.public_info}
              onChange={(e) => setField('public_info', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Opcional — ex.: Aracruz ES, Em temporada na Europa… (vazio não aparece no site)"
              autoComplete="off"
            />
          </Field>
        </Section>

        <Section title="Medidas principais">
          {form.catFeminino
            ? [
                ['medida_altura', 'Altura'],
                ['medida_busto', 'Busto'],
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
              ))
            : [
                ['medida_altura', 'Altura'],
                ['medida_torax', 'Tórax'],
                ['medida_cintura', 'Cintura'],
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
          <Field label="Instagram" className="md:col-span-2">
            <input
              value={form.instagram}
              onChange={(e) => setField('instagram', e.target.value.replace(/^@/, '').trim())}
              type="text"
              inputMode="url"
              autoComplete="off"
              className="w-full max-w-xl rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="https://www.instagram.com/seu_perfil/ ou @usuario"
            />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.mostrar_instagram}
                onChange={(e) => setField('mostrar_instagram', e.target.checked)}
                className="rounded border-slate-300 text-amber-600 focus:ring-amber-400"
              />
              <span>Exibir online</span>
            </label>
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
              onChange={(e) => setField('cep', formatCEPMask(e.target.value))}
              inputMode="numeric"
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
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 pb-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Mídia</h4>
              {(() => {
                const slugPublico = String(form.slug_site || editSlug || '').trim();
                const urlPerfil = slugPublico ? getWebsiteModelPublicUrl(slugPublico) : '';
                return urlPerfil ? (
                  <a
                    href={urlPerfil}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-amber-700 underline-offset-2 hover:underline"
                  >
                    Ver perfil no site ↗
                  </a>
                ) : (
                  <span className="text-xs text-slate-500" title="Defina o slug em Identificação">
                    (Defina o slug para abrir o perfil público)
                  </span>
                );
              })()}
            </div>
            {apiMedia.length > 0 && apiMediaSelected.size >= 2 ? (
              <button
                type="button"
                onClick={removeSelectedApiMedia}
                className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
              >
                Apagar selecionadas ({apiMediaSelected.size})
              </button>
            ) : null}
          </div>
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                id={fileInputId}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm"
                multiple
                className="hidden"
                onChange={onPickFiles}
              />
              <label
                htmlFor={fileInputId}
                className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
              >
                Adicionar mídias
              </label>
              <span className="text-xs text-slate-500">
                Arraste os cartões para reordenar; Capa e Polaroid. Fotos e MP4/WebM no mesmo envio (campo «photos» no
                site). Alternativa: «Vídeo (URL)» ou «Adicionar à galeria».
              </span>
            </div>

            {localMediaItems.length > 0 ? (
              <p className="text-xs text-amber-800">
                {localMediaItems.length} ficheiro(s) pendente(s) de envio — clique em Salvar para enviar ao site.
              </p>
            ) : null}
            {fileQueueNotice ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                {fileQueueNotice}
              </p>
            ) : null}

            <div className="flex max-w-xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="block min-w-[200px] flex-1 text-sm text-slate-600">
                <span className="mb-1 block font-medium text-slate-800">Vídeo (URL)</span>
                <input
                  value={form.video_url}
                  onChange={(e) => setField('video_url', e.target.value)}
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Link do YouTube (recomendado no site)…"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  No site público, o YouTube costuma reproduzir melhor. «Adicionar à galeria» grava o link na grelha
                  (YouTube fica em formato compatível com o embed).
                </span>
              </label>
              <button
                type="button"
                onClick={addVideoToGallery}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Adicionar à galeria
              </button>
            </div>

            {apiMedia.length === 0 && localMediaItems.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                Nenhuma imagem ou vídeo na galeria. Adicione imagens ou use o vídeo acima.
              </p>
            ) : null}
            {apiMedia.length > 0 ? (
                <ul className={WEBSITE_GALLERY_GRID_CLASS}>
                  {apiMedia.map((item, index) => {
                    const isVideo = item && typeof item === 'object' && item.type === 'video';
                    const isCover = index === 0;
                    const polaroidOn =
                      item && typeof item === 'object' && (item.polaroid === true || item.polaroid === 'true');
                    const { primary: mediaPrimary } = mediaItemThumbOrUrl(item);
                    return (
                      <li
                        key={index}
                        draggable
                        onDragStart={(e) => handleApiMediaDragStart(e, index)}
                        onDragOver={handleApiMediaDragOver}
                        onDrop={(e) => handleApiMediaDrop(e, index)}
                        className={`min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm ${
                          isCover ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-200'
                        } ${polaroidOn ? 'ring-1 ring-sky-300' : ''}`}
                      >
                        <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: '4/5' }}>
                          {isVideo ? (
                            <WebsitePublicVideoEmbed
                              url={item && typeof item === 'object' ? item.url : ''}
                              item={item}
                            />
                          ) : mediaPrimary ? (
                            <WebsiteMediaImg
                              item={item}
                              alt=""
                              loading="lazy"
                              draggable={false}
                              className="absolute inset-0 h-full w-full object-cover object-top"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-xs text-slate-400">
                              —
                            </div>
                          )}
                          <div className="pointer-events-auto absolute left-2 top-2 z-[2] flex max-w-[calc(100%-0.5rem)] flex-wrap items-center gap-1">
                            <input
                              type="checkbox"
                              checked={apiMediaSelected.has(index)}
                              onChange={() => toggleApiMediaSelect(index)}
                              onMouseDown={(e) => e.stopPropagation()}
                              title="Selecionar"
                              className="h-3.5 w-3.5 shrink-0 rounded border-slate-500 text-amber-600 focus:ring-amber-500"
                              aria-label={`Selecionar foto ${index + 1}`}
                            />
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
                          <span className="pointer-events-none absolute bottom-2 right-2 z-[1] rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                            ⋮⋮
                          </span>
                        </div>
                        <div
                          className="grid grid-cols-3 gap-0.5 border-t border-slate-200 p-1"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            disabled={isCover}
                            onClick={() => handleApiMediaSetCover(index)}
                            className="min-w-0 rounded border border-amber-300 bg-amber-50 px-0.5 py-1 text-center text-[10px] font-medium leading-tight text-amber-950 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Capa
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApiMediaTogglePolaroid(index)}
                            className={`min-w-0 rounded border px-0.5 py-1 text-center text-[10px] font-medium leading-tight ${
                              polaroidOn
                                ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                                : 'border-sky-300 bg-sky-50 text-sky-900'
                            }`}
                          >
                            Polaroid
                          </button>
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              if (!confirm('Tem certeza que deseja apagar esta foto?')) return;
                              applyRemoveApiMediaAt(index);
                            }}
                            className="min-w-0 rounded border border-red-200 px-0.5 py-1 text-center text-[10px] leading-tight text-red-700"
                          >
                            Apagar
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
            ) : null}
            {localMediaItems.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-700">
                  Novas mídias locais (ainda não enviadas ao site)
                </p>
                <ul className={WEBSITE_GALLERY_GRID_CLASS}>
                  {localMediaItems.map((item, index) => {
                    const isCover = index === 0;
                    const polaroidOn = item.polaroid === true || item.polaroid === 'true';
                    return (
                      <li
                        key={item.id}
                        draggable
                        onDragStart={(e) => handleLocalDragStart(e, index)}
                        onDragOver={handleApiMediaDragOver}
                        onDrop={(e) => handleLocalDrop(e, index)}
                        className={`min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm ${
                          isCover ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-200'
                        } ${polaroidOn ? 'ring-1 ring-sky-300' : ''}`}
                      >
                        <div className="relative w-full overflow-hidden bg-slate-100" style={{ aspectRatio: '4/5' }}>
                          {item.preview ? (
                            item.isVideo ? (
                              <video
                                src={item.preview}
                                className="absolute inset-0 h-full w-full object-cover object-top"
                                controls
                                muted
                                playsInline
                                preload="metadata"
                              />
                            ) : (
                              <img
                                src={item.preview}
                                alt=""
                                loading="lazy"
                                draggable={false}
                                className="absolute inset-0 h-full w-full object-cover object-top"
                              />
                            )
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                              —
                            </div>
                          )}
                          <div className="pointer-events-none absolute left-2 top-2 z-[2] flex max-w-[calc(100%-0.5rem)] flex-wrap items-center gap-1">
                            <span className="rounded bg-emerald-700 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                              Novo
                            </span>
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
                          <span className="pointer-events-none absolute bottom-2 right-2 z-[1] rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                            ⋮⋮
                          </span>
                        </div>
                        <div
                          className="grid grid-cols-3 gap-0.5 border-t border-slate-200 p-1"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            disabled={isCover}
                            onClick={() => setLocalCover(index)}
                            className="min-w-0 rounded border border-amber-300 bg-amber-50 px-0.5 py-1 text-center text-[10px] font-medium leading-tight text-amber-950 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Capa
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleLocalPolaroid(index)}
                            className={`min-w-0 rounded border px-0.5 py-1 text-center text-[10px] font-medium leading-tight ${
                              polaroidOn
                                ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                                : 'border-sky-300 bg-sky-50 text-sky-900'
                            }`}
                          >
                            Polaroid
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!confirm('Tem certeza que deseja apagar esta foto?')) return;
                              removeLocalMediaConfirmed(item.id);
                            }}
                            className="min-w-0 rounded border border-red-200 px-0.5 py-1 text-center text-[10px] leading-tight text-red-700"
                          >
                            Apagar
                          </button>
                        </div>
                        {item.name ? <p className="truncate px-2 pb-2 text-xs text-slate-500">{item.name}</p> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        <div className="sticky bottom-0 z-10 mt-6 border-t border-slate-200 bg-white/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {onBackToList ? (
              <button
                type="button"
                onClick={() => onBackToList()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                ← Voltar à lista
              </button>
            ) : (
              <span />
            )}
            {!isEdit ? (
              <button
                type="button"
                onClick={clearForm}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Limpar formulário
              </button>
            ) : (
              <span />
            )}
          </div>
          {saveBar}
        </div>
      </form>

    </div>
  );
}
