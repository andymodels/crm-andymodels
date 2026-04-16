import { useCallback, useEffect, useState } from 'react';
import { API_BASE, fetchWithAuth, throwIfHtmlOrCannotPost } from '../apiConfig';
import { absolutizeWebsiteAssetUrl } from '../utils/websiteMediaDisplay';
import { buildMediaItems } from './WebsiteMediaImage';

const ORDER_FIELD_CANDIDATES = [
  'home_order',
  'featured_order',
  'order',
  'sort_order',
  'position',
  'display_order',
];

function extractWebsiteModelsArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.models)) return data.models;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.records)) return data.records;
    if (Array.isArray(data.rows)) return data.rows;
  }
  return [];
}

function strLower(v) {
  return String(v ?? '').trim().toLowerCase();
}

/** Home do site: apenas `featured` (API pública / admin — não usar category home, status, etc.). */
function isFeaturedForHomeOrder(m) {
  if (!m || typeof m !== 'object') return false;
  if (m.featured === true || m.featured === 1 || m.featured === '1') return true;
  const s = String(m.featured ?? '').trim().toLowerCase();
  return s === 'true' || s === 't' || s === 'on';
}

/** Prioriza home_order quando existir no objeto (mesmo 0), para alinhar ao site. */
function detectOrderField(sample) {
  if (!sample || typeof sample !== 'object') return 'home_order';
  if (Object.prototype.hasOwnProperty.call(sample, 'home_order')) return 'home_order';
  for (const k of ORDER_FIELD_CANDIDATES) {
    if (k === 'home_order') continue;
    if (Object.prototype.hasOwnProperty.call(sample, k) && sample[k] != null && String(sample[k]).trim() !== '') {
      return k;
    }
  }
  return 'home_order';
}

function getOrderValue(m, field) {
  if (!m || typeof m !== 'object') return 999999;
  const v = m[field];
  if (v == null || v === '') return 999999;
  const n = Number(v);
  return Number.isNaN(n) ? 999999 : n;
}

function categoryLabel(m) {
  if (!m || typeof m !== 'object') return '—';
  const c = String(m.category || '').trim().toLowerCase();
  if (c === 'men' || c === 'masculino') return 'MEN';
  if (c === 'women' || c === 'feminino') return 'WOMEN';
  const arr = Array.isArray(m.categories) ? m.categories : [];
  for (const x of arr) {
    const t = String(x || '').trim().toLowerCase();
    if (t === 'men' || t === 'masculino') return 'MEN';
    if (t === 'women' || t === 'feminino') return 'WOMEN';
  }
  return c ? c.toUpperCase() : '—';
}

function firstThumbUrl(m) {
  const items = buildMediaItems(m);
  const img = items.find((it) => it.type !== 'video') || items[0];
  if (img) {
    const u = img.thumb || img.url;
    if (u) return String(u);
  }
  const direct = m.cover_image || m.cover || m.photo || m.foto || m.thumbnail;
  if (direct) return absolutizeWebsiteAssetUrl(String(direct).trim());
  return '';
}

/**
 * Ordem dos modelos em destaque na home do site (proxy PUT /api/admin/models/:id).
 * Arrastar para reordenar; «Salvar ordem» grava a posição no backend do site.
 */
export default function WebsiteHomeOrderPage() {
  const [ordered, setOrdered] = useState([]);
  const [orderField, setOrderField] = useState('home_order');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [dragFrom, setDragFrom] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setOkMsg('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/admin/models?limit=500`);
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error('Resposta inválida do servidor.');
      }
      if (!r.ok) {
        const msg = parsed && typeof parsed.message === 'string' ? parsed.message : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      const arr = extractWebsiteModelsArray(parsed);
      const feat = arr.filter((m) => isFeaturedForHomeOrder(m));
      const field = feat.length ? detectOrderField(feat[0]) : 'home_order';
      setOrderField(field);
      feat.sort((a, b) => getOrderValue(a, field) - getOrderValue(b, field));
      setOrdered(feat);
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reorder = useCallback((from, to) => {
    if (from == null || to == null || from === to) return;
    setOrdered((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const saveOrder = useCallback(async () => {
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const field = orderField;
      for (let i = 0; i < ordered.length; i += 1) {
        const m = ordered[i];
        const id = m?.id;
        if (id == null) continue;
        const body = {
          featured: '1',
          [field]: i + 1,
        };
        const r = await fetchWithAuth(`${API_BASE}/admin/models/${encodeURIComponent(String(id))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const raw = await r.text();
        throwIfHtmlOrCannotPost(raw, r.status);
        let data;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }
        if (!r.ok) {
          const msg =
            data && typeof data.message === 'string' && data.message.trim()
              ? data.message.trim()
              : `HTTP ${r.status} ao guardar modelo ${id}`;
          throw new Error(msg);
        }
      }
      setOkMsg('Ordem guardada no site.');
      await load();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao guardar.');
    } finally {
      setSaving(false);
    }
  }, [ordered, orderField, load]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Ordem da Home</h3>
          <p className="mt-1 text-sm text-slate-500">
            Modelos com <span className="font-medium text-slate-700">featured</span> ativo no site — arraste para
            definir a ordem (1 = primeiro). A ordem também é embaralhada automaticamente de hora a hora no servidor.
            Campo no site: <span className="font-mono text-slate-700">{orderField}</span>
          </p>
        </div>
        <button
          type="button"
          disabled={saving || ordered.length === 0}
          onClick={saveOrder}
          className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'A guardar…' : 'Salvar ordem'}
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">A carregar…</p>
      ) : error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {okMsg ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{okMsg}</p>
      ) : null}

      {!loading && !error && ordered.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">
          Nenhum modelo em destaque. Na ficha do modelo (Website → Modelos), ative «Destaque / featured», guarde e
          volte aqui.
        </p>
      ) : null}

      {!loading && ordered.length > 0 ? (
        <ul className="mt-6 grid list-none grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {ordered.map((m, index) => {
            const name = m?.name != null ? String(m.name) : m?.nome != null ? String(m.nome) : '—';
            const thumb = firstThumbUrl(m);
            const key = m?.id != null ? `home-${m.id}` : `home-idx-${index}`;
            return (
              <li
                key={key}
                draggable
                onDragStart={() => setDragFrom(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom == null) return;
                  reorder(dragFrom, index);
                  setDragFrom(null);
                }}
                onDragEnd={() => setDragFrom(null)}
                className={`relative cursor-grab overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm active:cursor-grabbing ${
                  dragFrom === index ? 'ring-2 ring-amber-400' : ''
                }`}
              >
                <div className="relative w-full overflow-hidden bg-slate-200" style={{ aspectRatio: '3/4' }}>
                  <span className="absolute left-2 top-2 z-[1] flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    <div className="flex h-full min-h-[120px] items-center justify-center text-xs text-slate-500">
                      Sem foto
                    </div>
                  )}
                </div>
                <div className="border-t border-slate-200 bg-white px-2 py-1.5">
                  <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-900" title={name}>
                    {name}
                  </p>
                  <p className="text-[10px] text-slate-500">{categoryLabel(m)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!loading && ordered.length > 0 ? (
        <p className="mt-4 text-xs text-slate-500">
          Dica: arraste um cartão e largue na posição desejada. Se o site usar outro nome de campo para a ordem, ele é
          detetado pela API; caso o «Salvar ordem» falhe, confirme no backend do site o campo (ex.: <code>home_order</code>
          ) no PUT <code>/api/admin/models/:id</code>.
        </p>
      ) : null}
    </section>
  );
}
