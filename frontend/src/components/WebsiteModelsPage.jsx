import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE, fetchWithAuth, fetchWithTimeout, throwIfHtmlOrCannotPost } from '../apiConfig';
import { buildMediaItems } from './WebsiteMediaImage';

/** Mesma densidade e proporção da grelha de mídia na ficha do modelo (WebsiteModeloEditorPage). */
const LIST_THUMB_GRID_CLASS =
  'grid w-full grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1';

/** Género para listagem: women / men; usa `category` e, se necessário, `categories`. */
function websiteModelGender(m) {
  if (!m || typeof m !== 'object') return '';
  const c = String(m.category || '').trim().toLowerCase();
  if (c === 'women' || c === 'men') return c;
  const arr = Array.isArray(m.categories) ? m.categories : [];
  for (const x of arr) {
    const t = String(x || '').trim().toLowerCase();
    if (t === 'women' || t === 'men') return t;
  }
  return '';
}

function extractWebsiteModelsArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.models)) return data.models;
    if (Array.isArray(data.data)) return data.data;
  }
  return [];
}

function modelIsInactive(m) {
  if (!m || typeof m !== 'object') return false;
  const a = m.active;
  return a === false || a === '0' || a === 0 || Number(a) === 0;
}

/** Lista Website → Modelos: só entram modelos explicitamente ativos na vitrine. */
function modelIsActiveOnSite(m) {
  if (!m || typeof m !== 'object') return false;
  const a = m.active;
  if (a === true || a === 1 || a === '1') return true;
  if (typeof a === 'string') {
    const t = a.trim().toLowerCase();
    if (t === 'true' || t === 't' || t === 'on') return true;
  }
  return false;
}

function hasCreatorsTag(m) {
  if (!m || typeof m !== 'object') return false;
  const arr = Array.isArray(m.categories) ? m.categories : [];
  return arr.some((x) => String(x || '').trim().toLowerCase() === 'creators');
}

/** Destaca no topo sem alterar a ordem relativa dentro de cada grupo. */
function prioritizeFeaturedStable(list) {
  const featured = [];
  const rest = [];
  for (const m of list) {
    if (m && typeof m === 'object' && m.featured === true) featured.push(m);
    else rest.push(m);
  }
  return featured.concat(rest);
}

/**
 * Lista de modelos do site (proxy CRM: /api/website/models).
 * Clicar num modelo abre o fluxo de edição no CRM (via onOpenEdit(slug, id)).
 */
export default function WebsiteModelsPage({ onOpenEdit }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const [siteGender, setSiteGender] = useState('women');
  const [creatorsOnly, setCreatorsOnly] = useState(false);

  const filteredRows = useMemo(() => {
    const filtered = rows.filter((m) => {
      if (!modelIsActiveOnSite(m)) return false;
      if (websiteModelGender(m) !== siteGender) return false;
      if (creatorsOnly && !hasCreatorsTag(m)) return false;
      return true;
    });
    return prioritizeFeaturedStable(filtered);
  }, [rows, siteGender, creatorsOnly]);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/admin/models`);
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error('Resposta inválida do servidor.');
      }
      if (r.ok && parsed != null) {
        const arr = extractWebsiteModelsArray(parsed);
        setRows(arr);
        return;
      }
      const msg = parsed && typeof parsed.message === 'string' ? parsed.message : `HTTP ${r.status}`;
      const r2 = await fetchWithTimeout(`${API_BASE}/website/models`);
      const raw2 = await r2.text();
      throwIfHtmlOrCannotPost(raw2, r2.status);
      let data2;
      try {
        data2 = raw2 ? JSON.parse(raw2) : [];
      } catch {
        throw new Error(msg || 'Resposta inválida do servidor.');
      }
      if (!r2.ok) {
        const msg2 = data2 && typeof data2.message === 'string' ? data2.message : msg;
        throw new Error(msg2);
      }
      setRows(Array.isArray(data2) ? data2 : []);
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const openEdit = useCallback(
    (slug, modelId) => {
      const s = String(slug || '').trim();
      const hasId = modelId != null && modelId !== '' && !Number.isNaN(Number(modelId));
      if ((!s && !hasId) || typeof onOpenEdit !== 'function') return;
      onOpenEdit(s, modelId);
    },
    [onOpenEdit],
  );

  const deleteModel = useCallback(
    async (m) => {
      const id = m?.id;
      if (id == null || id === '') {
        window.alert('Não é possível apagar: modelo sem identificador no site.');
        return;
      }
      const name = m?.name != null ? String(m.name) : 'este modelo';
      const ok = window.confirm(
        `Deseja mesmo apagar definitivamente o modelo «${name}» no site? Esta ação não pode ser desfeita.`,
      );
      if (!ok) return;
      const idStr = String(id);
      setDeletingId(idStr);
      setError('');
      try {
        const r = await fetchWithAuth(`${API_BASE}/admin/models/${encodeURIComponent(idStr)}`, {
          method: 'DELETE',
        });
        const raw = await r.text();
        throwIfHtmlOrCannotPost(raw, r.status);
        let data = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = null;
        }
        if (!r.ok) {
          const msg =
            data && typeof data.message === 'string' && data.message.trim()
              ? data.message.trim()
              : `HTTP ${r.status}`;
          throw new Error(msg);
        }
        setRows((prev) => prev.filter((row) => row && String(row.id) !== idStr));
      } catch (e) {
        setError(e?.message ? String(e.message) : 'Erro ao apagar.');
      } finally {
        setDeletingId(null);
      }
    },
    [],
  );

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">Modelos no site</h3>
      <p className="mt-1 text-sm text-slate-500">
        Lista do admin do site (inclui fora do ar). Clique no cartão para editar; use «Apagar» para remover o modelo do
        site (com confirmação).
      </p>

      <>
          {loading ? (
            <p className="mt-6 text-sm text-slate-500">Carregando…</p>
          ) : error ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : rows.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">Nenhum modelo retornado.</p>
          ) : (
            <>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  {[
                    { key: 'women', label: 'Feminino' },
                    { key: 'men', label: 'Masculino' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSiteGender(key)}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        siteGender === key
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={creatorsOnly}
                    onChange={(e) => setCreatorsOnly(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  Creators
                </label>
              </div>

              {filteredRows.length === 0 ? (
                <p className="mt-6 text-sm text-slate-500">Nenhum modelo nesta seleção.</p>
              ) : (
            <ul className={`mt-6 ${LIST_THUMB_GRID_CLASS}`}>
              {filteredRows.map((m, idx) => {
                const name = m?.name != null ? String(m.name) : '—';
                const nomeCompletoList =
                  m?.full_name != null && String(m.full_name).trim()
                    ? String(m.full_name).trim()
                    : m?.legal_name != null && String(m.legal_name).trim()
                      ? String(m.legal_name).trim()
                      : '';
                const slug = m?.slug != null ? String(m.slug).trim() : '';
                const mediaItems = buildMediaItems(m);
                const firstImage =
                  mediaItems.find((item) => item.type === 'image')?.thumb ||
                  mediaItems.find((item) => item.type === 'image')?.url ||
                  '';
                const key = m?.id != null ? `wm-${m.id}` : `wm-${idx}`;
                const modelId = m?.id != null ? m.id : null;
                const canOpen = Boolean(slug) || (modelId != null && String(modelId).trim() !== '');
                const inactive = modelIsInactive(m);
                const canDelete = modelId != null && String(modelId).trim() !== '';
                const deletingThis = deletingId != null && String(deletingId) === String(modelId);
                return (
                  <li key={key} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
                    <div className="relative">
                      {canDelete ? (
                        <button
                          type="button"
                          disabled={deletingThis}
                          onClick={() => deleteModel(m)}
                          className="absolute right-1 top-1 z-[2] rounded-md border border-red-200 bg-white/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                          title="Apagar modelo no site"
                        >
                          {deletingThis ? '…' : 'Apagar'}
                        </button>
                      ) : null}
                      <div
                        role={canOpen ? 'button' : undefined}
                        tabIndex={canOpen ? 0 : undefined}
                        onClick={() => canOpen && openEdit(slug, modelId)}
                        onKeyDown={(e) => {
                          if (!canOpen) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openEdit(slug, modelId);
                          }
                        }}
                        className={`w-full text-left ${
                          canOpen ? 'cursor-pointer hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-amber-400/40' : 'cursor-not-allowed opacity-80'
                        }`}
                      >
                        <div
                          className="relative w-full overflow-hidden bg-slate-200"
                          style={{ aspectRatio: '4/5' }}
                        >
                          {firstImage ? (
                            <img
                              src={firstImage}
                              alt=""
                              loading="lazy"
                              draggable={false}
                              className="absolute inset-0 h-full w-full object-cover object-top"
                              onError={(e) => {
                                const entry = mediaItems.find((item) => item.type === 'image');
                                if (!entry?.url || !entry?.thumb || entry.thumb === entry.url) return;
                                const el = e.currentTarget;
                                if (el.dataset.wmImgFallback === '1') return;
                                el.dataset.wmImgFallback = '1';
                                el.src = entry.url;
                              }}
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs text-slate-500">
                              Sem imagem
                            </div>
                          )}
                        </div>
                        <div
                          className="border-t border-slate-200 bg-white px-1.5 py-1 text-xs leading-tight"
                          title={nomeCompletoList ? `${name} — ${nomeCompletoList}` : name}
                        >
                          <p className="truncate font-medium text-slate-900">{name}</p>
                          {nomeCompletoList && nomeCompletoList !== name ? (
                            <p className="truncate text-[10px] font-normal text-slate-500">{nomeCompletoList}</p>
                          ) : null}
                          <span className="inline">
                            {inactive ? (
                              <span className="ml-1 text-[10px] font-normal text-slate-500">(fora do ar)</span>
                            ) : null}
                            {!canOpen ? (
                              <span className="ml-1 text-[10px] font-normal text-amber-700">(sem slug)</span>
                            ) : null}
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
              )}
            </>
          )}
      </>
    </section>
  );
}
