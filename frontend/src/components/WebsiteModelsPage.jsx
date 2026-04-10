import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE, fetchWithTimeout, throwIfHtmlOrCannotPost } from '../apiConfig';

/** Ordem preservada; sem sort/filter/reorganização. media tem prioridade se existir; senão images. */
function websiteModelImages(model) {
  if (!model || typeof model !== 'object') return [];
  if (model.media != null) {
    return Array.isArray(model.media) ? model.media : [];
  }
  return Array.isArray(model.images) ? model.images : [];
}

function itemToImageSrc(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    if (item.url != null) return String(item.url);
    if (item.src != null) return String(item.src);
  }
  return '';
}

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
 * Lista e detalhe de modelos do site (proxy CRM: /api/website/models, /api/website/models/:slug).
 */
export default function WebsiteModelsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedSlug, setSelectedSlug] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [siteGender, setSiteGender] = useState('women');
  const [creatorsOnly, setCreatorsOnly] = useState(false);

  const filteredRows = useMemo(() => {
    const filtered = rows.filter((m) => {
      if (websiteModelGender(m) !== siteGender) return false;
      if (creatorsOnly && !hasCreatorsTag(m)) return false;
      return true;
    });
    return prioritizeFeaturedStable(filtered);
  }, [rows, siteGender, creatorsOnly]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const r = await fetchWithTimeout(`${API_BASE}/website/models`);
        const raw = await r.text();
        throwIfHtmlOrCannotPost(raw, r.status);
        let data;
        try {
          data = raw ? JSON.parse(raw) : [];
        } catch {
          throw new Error('Resposta inválida do servidor.');
        }
        if (!r.ok) {
          const msg = data && typeof data.message === 'string' ? data.message : `HTTP ${r.status}`;
          throw new Error(msg);
        }
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e?.message ? String(e.message) : 'Erro ao carregar.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadDetail = useCallback(async (slug) => {
    const s = String(slug || '').trim();
    if (!s) return;
    setSelectedSlug(s);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const r = await fetchWithTimeout(`${API_BASE}/website/models/${encodeURIComponent(s)}`);
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
      setDetail(data && typeof data === 'object' ? data : null);
    } catch (e) {
      setDetailError(e?.message ? String(e.message) : 'Erro ao carregar detalhe.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedSlug(null);
    setDetail(null);
    setDetailError('');
  }, []);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">Modelos no site</h3>
      <p className="mt-1 text-sm text-slate-500">
        Dados públicos de andymodels.com (somente leitura). Clique num modelo para ver o detalhe.
      </p>

      {selectedSlug ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={closeDetail}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Voltar à lista
          </button>

          {detailLoading ? (
            <p className="mt-6 text-sm text-slate-500">A carregar detalhe…</p>
          ) : detailError ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{detailError}</p>
          ) : detail ? (
            <div className="mt-6 space-y-6">
              <div>
                <h4 className="text-xl font-semibold text-slate-900">
                  {detail.name != null ? String(detail.name) : '—'}
                </h4>
                {detail.slug != null ? (
                  <p className="text-sm text-slate-500">/{String(detail.slug)}</p>
                ) : null}
              </div>

              <div>
                <h5 className="mb-2 text-sm font-semibold text-slate-800">Medidas</h5>
                <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {[
                    ['Altura', detail.height],
                    ['Busto', detail.bust],
                    ['Cintura', detail.waist],
                    ['Quadril', detail.hips],
                    ['Sapato', detail.shoes],
                    ['Olhos', detail.eyes],
                    ['Cabelo', detail.hair],
                    ['Idade', detail.age],
                  ].map(([label, val]) => (
                    <div key={label} className="contents">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="font-medium text-slate-900">
                        {val != null && String(val).trim() !== '' ? String(val) : '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div>
                <h5 className="mb-3 text-sm font-semibold text-slate-800">Imagens</h5>
                {(() => {
                  const items = websiteModelImages(detail);
                  if (items.length === 0) {
                    return <p className="text-sm text-slate-500">Nenhuma imagem.</p>;
                  }
                  return (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((item, i) => (
                        <li
                          key={i}
                          className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                        >
                          <img
                            src={itemToImageSrc(item)}
                            alt=""
                            className="aspect-[3/4] w-full object-cover"
                            loading="lazy"
                          />
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
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
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredRows.map((m, idx) => {
                const name = m?.name != null ? String(m.name) : '—';
                const slug = m?.slug != null ? String(m.slug).trim() : '';
                const img =
                  m?.cover_image != null && String(m.cover_image).trim() !== ''
                    ? String(m.cover_image).trim()
                    : null;
                const key = m?.id != null ? `wm-${m.id}` : `wm-${idx}`;
                const canOpen = Boolean(slug);
                return (
                  <li key={key} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
                    <button
                      type="button"
                      disabled={!canOpen}
                      onClick={() => canOpen && loadDetail(slug)}
                      className={`w-full text-left ${canOpen ? 'cursor-pointer hover:opacity-95' : 'cursor-not-allowed opacity-80'}`}
                    >
                      <div className="aspect-[3/4] w-full overflow-hidden bg-slate-200">
                        {img ? (
                          <img
                            src={img}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-slate-500">
                            Sem imagem
                          </div>
                        )}
                      </div>
                      <p className="border-t border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900">
                        {name}
                        {!canOpen ? (
                          <span className="ml-2 text-xs font-normal text-amber-700">(sem slug)</span>
                        ) : null}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
