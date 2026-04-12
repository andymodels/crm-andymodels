import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE, fetchWithAuth, throwIfHtmlOrCannotPost } from '../apiConfig';
import { getWebsitePublicOrigin } from '../utils/websiteMediaDisplay';

function extractInstagramList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.posts)) return data.posts;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
  }
  return [];
}

function absolutizeImageSrc(u) {
  const t = String(u || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t) || t.startsWith('//')) return t.startsWith('//') ? `https:${t}` : t;
  const base = getWebsitePublicOrigin().replace(/\/$/, '');
  return `${base}${t.startsWith('/') ? '' : '/'}${t}`;
}

function sortByPosition(list) {
  return [...list].sort((a, b) => {
    const pa = Number(a.position);
    const pb = Number(b.position);
    if (!Number.isNaN(pa) && !Number.isNaN(pb) && pa !== pb) return pa - pb;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

/**
 * Gestão dos cartões Instagram da home do site (proxy para /api/instagram no site).
 * Pré-visualização: só imagem 3:4, P&B → cor ao hover (como no front público).
 */
export default function WebsiteInstagramPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newFile, setNewFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [imageUrlById, setImageUrlById] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/website/instagram`);
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      let data;
      try {
        data = raw ? JSON.parse(raw) : [];
      } catch {
        throw new Error('Resposta inválida.');
      }
      if (!r.ok) {
        const msg = data && typeof data.message === 'string' ? data.message : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      setItems(sortByPosition(extractInstagramList(data)));
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addPost = async () => {
    const url = String(newUrl || '').trim();
    if (!url) {
      setError('Cole o URL do post no Instagram.');
      return;
    }
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const fd = new FormData();
      fd.append('url', url);
      if (newFile instanceof File) {
        fd.append('image', newFile, newFile.name || 'image.jpg');
      }
      const r = await fetchWithAuth(`${API_BASE}/website/instagram`, {
        method: 'POST',
        body: fd,
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
            : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      setNewUrl('');
      setNewFile(null);
      setOkMsg('Post adicionado. O site pode demorar a extrair a imagem se não enviou ficheiro.');
      await load();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao adicionar.');
    } finally {
      setSaving(false);
    }
  };

  const patchPosition = async (id, position) => {
    const r = await fetchWithAuth(`${API_BASE}/website/instagram/${encodeURIComponent(String(id))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: Number(position) }),
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
          : `HTTP ${r.status}`;
      throw new Error(msg);
    }
  };

  const move = async (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const a = items[index];
    const b = items[j];
    const posA = Number(a.position);
    const posB = Number(b.position);
    const useA = !Number.isNaN(posA) ? posA : index + 1;
    const useB = !Number.isNaN(posB) ? posB : j + 1;
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      await patchPosition(a.id, useB);
      await patchPosition(b.id, useA);
      setOkMsg('Ordem atualizada no site.');
      await load();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao reordenar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id, name) => {
    if (!window.confirm(`Remover este post da home${name ? ` (${name})` : ''}?`)) return;
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/website/instagram/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) {
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }
        const msg =
          data && typeof data.message === 'string' && data.message.trim()
            ? data.message.trim()
            : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      setOkMsg('Removido.');
      await load();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao remover.');
    } finally {
      setSaving(false);
    }
  };

  const applyImageUrl = async (id) => {
    const imageUrl = String(imageUrlById[id] || '').trim();
    if (!imageUrl) {
      setError('Indique uma URL de imagem (https://…).');
      return;
    }
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/website/instagram/${encodeURIComponent(String(id))}/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
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
            : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      setImageUrlById((prev) => ({ ...prev, [id]: '' }));
      setOkMsg('Imagem atualizada.');
      await load();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao atualizar imagem.');
    } finally {
      setSaving(false);
    }
  };

  const sorted = useMemo(() => sortByPosition(items), [items]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">Instagram na home</h3>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Os cartões no site mostram só a foto (corte 3:4), sem legenda no tile — o clique abre o post no Instagram.
        Aqui gere URLs, ordem e imagem de capa (o backend do site extrai thumbnail ou pode enviar ficheiro / URL
        direta).
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">A carregar…</p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {okMsg ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {okMsg}
        </p>
      ) : null}

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Adicionar post</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="min-w-[220px] flex-1 text-sm text-slate-600">
            <span className="mb-1 block font-medium text-slate-800">URL do post (Instagram)</span>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://www.instagram.com/p/… ou /reel/…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm text-slate-600">
            <span className="mb-1 block font-medium text-slate-800">Imagem (opcional)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setNewFile(e.target.files?.[0] || null)}
              className="text-sm"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={addPost}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
      </div>

      {!loading && sorted.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">Nenhum post na lista (ou API do site indisponível).</p>
      ) : null}

      {sorted.length > 0 ? (
        <ul className="mt-8 grid list-none grid-cols-2 gap-px bg-slate-200 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {sorted.map((it, index) => {
            const src = absolutizeImageSrc(it.image_url);
            const href = String(it.url || '').trim();
            const id = it.id;
            return (
              <li key={id != null ? `ig-${id}` : `ig-${index}`} className="bg-white p-2">
                <div className="group relative w-full overflow-hidden bg-slate-100" style={{ aspectRatio: '3/4' }}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative block h-full w-full"
                      title="Abrir no Instagram"
                    >
                      {src ? (
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover object-top grayscale transition-all duration-700 group-hover:scale-[1.03] group-hover:grayscale-0"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-200 text-xs text-slate-500">
                          Sem imagem
                        </div>
                      )}
                    </a>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                      Sem URL
                    </div>
                  )}
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-slate-600">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                      #{index + 1} pos. {it.position != null ? it.position : '—'}
                    </span>
                    <button
                      type="button"
                      disabled={saving || index <= 0}
                      onClick={() => move(index, -1)}
                      className="rounded border border-slate-200 px-1.5 py-0.5 hover:bg-slate-50 disabled:opacity-40"
                      title="Subir"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={saving || index >= sorted.length - 1}
                      onClick={() => move(index, 1)}
                      className="rounded border border-slate-200 px-1.5 py-0.5 hover:bg-slate-50 disabled:opacity-40"
                      title="Descer"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => remove(id, href.slice(0, 40))}
                      className="ml-auto text-red-600 hover:underline"
                    >
                      Remover
                    </button>
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="url"
                      placeholder="URL direta da imagem (opcional)"
                      value={imageUrlById[id] ?? ''}
                      onChange={(e) =>
                        setImageUrlById((prev) => ({
                          ...prev,
                          [id]: e.target.value,
                        }))
                      }
                      className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-[10px]"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => applyImageUrl(id)}
                      className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium hover:bg-slate-50"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
