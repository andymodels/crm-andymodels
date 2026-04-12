import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [ordered, setOrdered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newFile, setNewFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [imageUrlById, setImageUrlById] = useState({});
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const newFileInputRef = useRef(null);

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
      const list = sortByPosition(extractInstagramList(data));
      setOrdered(list);
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchPosition = useCallback(async (id, position) => {
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
  }, []);

  const reorderAndSave = useCallback(
    async (from, to) => {
      if (from == null || to == null || from === to) return;
      const next = [...ordered];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      setOrdered(next);
      setSaving(true);
      setError('');
      setOkMsg('');
      try {
        for (let i = 0; i < next.length; i += 1) {
          const it = next[i];
          if (it?.id == null) continue;
          await patchPosition(it.id, i + 1);
        }
        setOkMsg('Ordem atualizada no site.');
        await load();
      } catch (e) {
        setError(e?.message ? String(e.message) : 'Erro ao reordenar.');
        await load();
      } finally {
        setSaving(false);
      }
    },
    [ordered, load, patchPosition],
  );

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
      if (newFileInputRef.current) newFileInputRef.current.value = '';
      setOkMsg('Post adicionado. O site pode demorar a extrair a imagem se não enviou ficheiro.');
      await load();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao adicionar.');
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

  const applyImageFile = async (id, file) => {
    if (!(file instanceof File)) return;
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const fd = new FormData();
      fd.append('image', file, file.name || 'image.jpg');
      const r = await fetchWithAuth(`${API_BASE}/website/instagram/${encodeURIComponent(String(id))}/image`, {
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
      setOkMsg('Imagem enviada.');
      await load();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao enviar imagem.');
    } finally {
      setSaving(false);
    }
  };

  const onNewFileChosen = (e) => {
    const f = e.target.files?.[0];
    setNewFile(f || null);
  };

  const onNewDropZoneDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onNewDropZoneDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer?.files?.[0];
    if (f && /^image\//i.test(f.type)) {
      setNewFile(f);
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">Instagram na home</h3>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Os cartões no site mostram só a foto (corte 3:4), sem legenda no tile — o clique abre o post no Instagram.
        Arraste os cartões para mudar a ordem (é gravado ao largar). Para a imagem de capa: o Instagram não permite
        arrastar a miniatura diretamente para aqui; use captura de ecrã, export ou ficheiro e carregue abaixo.
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

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Adicionar post</p>
        <label className="mt-3 block text-sm text-slate-700">
          <span className="mb-1 block font-medium text-slate-900">URL do post (Instagram)</span>
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://www.instagram.com/p/… ou /reel/…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
          />
        </label>

        <div className="mt-4">
          <p className="text-sm font-medium text-slate-900">Imagem de capa (recomendado)</p>
          <p className="mt-1 text-xs text-slate-600">
            Não dá para puxar a foto diretamente do Instagram para esta janela — escolha um ficheiro (ou arraste para a
            caixa).
          </p>
          <input
            ref={newFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            id="ig-new-post-image"
            onChange={onNewFileChosen}
          />
          <div
            onDragOver={onNewDropZoneDragOver}
            onDrop={onNewDropZoneDrop}
            className="mt-2 flex flex-col items-stretch gap-3 rounded-xl border-2 border-dashed border-amber-400/80 bg-amber-50/50 p-4 sm:flex-row sm:items-center"
          >
            <label
              htmlFor="ig-new-post-image"
              className="inline-flex cursor-pointer items-center justify-center rounded-lg border-2 border-slate-900 bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Escolher imagem no computador
            </label>
            <div className="min-w-0 flex-1 text-sm text-slate-700">
              {newFile instanceof File ? (
                <span className="font-medium text-slate-900">{newFile.name}</span>
              ) : (
                <span className="text-slate-500">Nenhum ficheiro — opcional se o site extrair a miniatura sozinho.</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={addPost}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'A guardar…' : 'Adicionar post'}
          </button>
        </div>
      </div>

      {!loading && ordered.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">Nenhum post na lista (ou API do site indisponível).</p>
      ) : null}

      {ordered.length > 0 ? (
        <ul className="mt-8 grid list-none grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {ordered.map((it, index) => {
            const src = absolutizeImageSrc(it.image_url);
            const href = String(it.url || '').trim();
            const id = it.id;
            return (
              <li
                key={id != null ? `ig-${id}` : `ig-${index}`}
                draggable={!saving}
                onDragStart={() => setDragFrom(index)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverIndex(index);
                }}
                onDragLeave={() => setDragOverIndex((x) => (x === index ? null : x))}
                onDrop={() => {
                  if (dragFrom == null) return;
                  reorderAndSave(dragFrom, index);
                  setDragFrom(null);
                  setDragOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOverIndex(null);
                }}
                className={`rounded-xl border bg-white p-2 shadow-sm transition ${
                  dragFrom === index ? 'ring-2 ring-amber-400' : ''
                } ${
                  dragOverIndex === index && dragFrom != null && dragFrom !== index
                    ? 'ring-2 ring-sky-400 ring-offset-2'
                    : 'border-slate-200'
                }`}
              >
                <div className="group relative w-full cursor-grab overflow-hidden bg-slate-100 active:cursor-grabbing" style={{ aspectRatio: '3/4' }}>
                  <span className="absolute left-2 top-2 z-[1] flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative block h-full w-full"
                      title="Abrir no Instagram"
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => e.preventDefault()}
                    >
                      {src ? (
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          draggable={false}
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
                <div className="mt-2 space-y-2 text-[11px] text-slate-600">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                      pos. {it.position != null ? it.position : '—'}
                    </span>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => remove(id, href.slice(0, 40))}
                      className="ml-auto text-red-600 hover:underline"
                    >
                      Remover
                    </button>
                  </div>

                  <div>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      id={`ig-card-img-${id}`}
                      disabled={saving}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) applyImageFile(id, f);
                        e.target.value = '';
                      }}
                    />
                    <label
                      htmlFor={`ig-card-img-${id}`}
                      className="flex cursor-pointer items-center justify-center rounded-lg border border-amber-500/70 bg-amber-50 px-2 py-2 text-center text-[11px] font-semibold text-amber-950 hover:bg-amber-100"
                    >
                      Carregar imagem (ficheiro)
                    </label>
                  </div>

                  <div className="flex gap-1 border-t border-slate-100 pt-2">
                    <input
                      type="url"
                      placeholder="Ou URL https da imagem"
                      value={imageUrlById[id] ?? ''}
                      onChange={(e) =>
                        setImageUrlById((prev) => ({
                          ...prev,
                          [id]: e.target.value,
                        }))
                      }
                      className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1.5 text-[10px]"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => applyImageUrl(id)}
                      className="shrink-0 rounded border border-slate-400 bg-slate-100 px-2 py-1.5 text-[10px] font-semibold text-slate-800 hover:bg-slate-200"
                    >
                      Aplicar URL
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {saving && ordered.length > 0 ? (
        <p className="mt-3 text-xs text-slate-500">A sincronizar com o site…</p>
      ) : null}
    </section>
  );
}
