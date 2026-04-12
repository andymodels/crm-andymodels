import { useCallback, useEffect, useState } from 'react';
import { API_BASE, fetchWithAuth, throwIfHtmlOrCannotPost } from '../apiConfig';

function fmtDur(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return '—';
  const n = Math.floor(Number(sec));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Gestão AndyRadio: playlists, faixas, upload múltiplo, ordem por arrastar.
 * API pública para o site: GET /api/public/radio/v2 (sem login).
 */
export default function WebsiteRadioPage() {
  const [playlists, setPlaylists] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [newPlName, setNewPlName] = useState('');
  const [plDragFrom, setPlDragFrom] = useState(null);
  const [trDragFrom, setTrDragFrom] = useState(null);

  const loadPlaylists = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/radio/playlists`);
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      const data = raw ? JSON.parse(raw) : [];
      if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`);
      setPlaylists(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao carregar playlists.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTracks = useCallback(async (playlistId) => {
    if (playlistId == null) {
      setTracks([]);
      return;
    }
    setLoadingTracks(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/radio/playlists/${encodeURIComponent(String(playlistId))}/tracks`);
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      const data = raw ? JSON.parse(raw) : [];
      if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`);
      setTracks(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao carregar faixas.');
      setTracks([]);
    } finally {
      setLoadingTracks(false);
    }
  }, []);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  useEffect(() => {
    if (selectedId != null) loadTracks(selectedId);
  }, [selectedId, loadTracks]);

  const parseErr = (raw, r) => {
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      /* */
    }
    return data?.message && String(data.message).trim() ? String(data.message).trim() : `HTTP ${r.status}`;
  };

  const createPlaylist = async () => {
    const name = String(newPlName || '').trim();
    if (!name) {
      setError('Indique o nome da playlist.');
      return;
    }
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/radio/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, status: 'published' }),
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setNewPlName('');
      setOkMsg('Playlist criada.');
      await loadPlaylists();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro.');
    } finally {
      setSaving(false);
    }
  };

  const updatePlaylist = async (p, patch) => {
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const body = {
        name: p.name,
        slug: p.slug,
        description: p.description ?? '',
        cover_url: p.cover_url,
        sort_order: p.sort_order,
        active: p.active,
        status: p.status,
        ...patch,
      };
      const r = await fetchWithAuth(`${API_BASE}/radio/playlists/${encodeURIComponent(String(p.id))}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg('Playlist atualizada.');
      await loadPlaylists();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro.');
    } finally {
      setSaving(false);
    }
  };

  const deletePlaylist = async (p) => {
    if (!window.confirm(`Apagar a playlist «${p.name}» e todas as faixas?`)) return;
    setSaving(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/radio/playlists/${encodeURIComponent(String(p.id))}`, {
        method: 'DELETE',
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      if (selectedId === p.id) setSelectedId(null);
      setOkMsg('Playlist apagada.');
      await loadPlaylists();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro.');
    } finally {
      setSaving(false);
    }
  };

  const reorderPlaylists = async (from, to) => {
    if (from == null || to == null || from === to) return;
    const next = [...playlists];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setPlaylists(next);
    setSaving(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/radio/playlists/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map((x) => x.id) }),
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg('Ordem das playlists atualizada.');
      await loadPlaylists();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro.');
      await loadPlaylists();
    } finally {
      setSaving(false);
    }
  };

  const bulkUpload = async (fileList) => {
    if (!selectedId || !fileList?.length) return;
    const fd = new FormData();
    for (let i = 0; i < fileList.length; i += 1) {
      fd.append('audio', fileList[i], fileList[i].name);
    }
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const r = await fetchWithAuth(
        `${API_BASE}/radio/playlists/${encodeURIComponent(String(selectedId))}/tracks/bulk`,
        { method: 'POST', body: fd },
      );
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      const data = raw ? JSON.parse(raw) : {};
      if (!r.ok) throw new Error(parseErr(raw, r));
      const msg = `Importadas ${data.created ?? 0} faixa(s).`;
      const errN = data.errors?.length;
      setOkMsg(errN ? `${msg} (${errN} erro(s) — ver consola)` : msg);
      if (errN && data.errors) console.warn('[radio bulk]', data.errors);
      await loadTracks(selectedId);
      await loadPlaylists();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro no upload.');
    } finally {
      setSaving(false);
    }
  };

  const reorderTracks = async (from, to) => {
    if (selectedId == null || from == null || to == null || from === to) return;
    const next = [...tracks];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setTracks(next);
    setSaving(true);
    setError('');
    try {
      const r = await fetchWithAuth(
        `${API_BASE}/radio/playlists/${encodeURIComponent(String(selectedId))}/tracks/reorder`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: next.map((x) => x.id) }),
        },
      );
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg('Ordem das faixas atualizada.');
      await loadTracks(selectedId);
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro.');
      await loadTracks(selectedId);
    } finally {
      setSaving(false);
    }
  };

  const deleteTrack = async (t) => {
    if (!window.confirm(`Remover «${t.title}»?`)) return;
    setSaving(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/radio/tracks/${encodeURIComponent(String(t.id))}`, {
        method: 'DELETE',
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg('Faixa removida.');
      await loadTracks(selectedId);
      await loadPlaylists();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro.');
    } finally {
      setSaving(false);
    }
  };

  const uploadPlaylistCover = async (playlistId, file) => {
    if (!(file instanceof File)) return;
    const fd = new FormData();
    fd.append('cover', file, file.name);
    setSaving(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/radio/playlists/${encodeURIComponent(String(playlistId))}/cover`, {
        method: 'POST',
        body: fd,
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg('Capa da playlist atualizada.');
      await loadPlaylists();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro.');
    } finally {
      setSaving(false);
    }
  };

  const uploadTrackCover = async (trackId, file) => {
    if (!(file instanceof File)) return;
    const fd = new FormData();
    fd.append('cover', file, file.name);
    setSaving(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/radio/tracks/${encodeURIComponent(String(trackId))}/cover`, {
        method: 'POST',
        body: fd,
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg('Capa da faixa atualizada.');
      await loadTracks(selectedId);
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro.');
    } finally {
      setSaving(false);
    }
  };

  const selected = playlists.find((p) => p.id === selectedId);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">Andy Radio</h3>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Playlists e faixas MP3 ficam neste CRM. O site público pode consumir{' '}
        <code className="rounded bg-slate-100 px-1 text-xs text-slate-800">GET /api/public/radio/v2</code> (JSON com
        playlists e URLs absolutas de áudio e capas). Duração e capa embutida no MP3 são lidas automaticamente quando
        possível.
      </p>

      {loading ? <p className="mt-4 text-sm text-slate-500">A carregar…</p> : null}
      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {okMsg ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{okMsg}</p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Playlists</p>
          <p className="mt-1 text-xs text-slate-500">Arraste para ordenar. Clique para escolher e editar faixas.</p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newPlName}
              onChange={(e) => setNewPlName(e.target.value)}
              placeholder="Nome da nova playlist"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={saving}
              onClick={createPlaylist}
              className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              +
            </button>
          </div>
          <ul className="mt-4 space-y-2">
            {playlists.map((p, idx) => (
              <li
                key={p.id}
                draggable={!saving}
                onDragStart={() => setPlDragFrom(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (plDragFrom == null) return;
                  reorderPlaylists(plDragFrom, idx);
                  setPlDragFrom(null);
                }}
                onDragEnd={() => setPlDragFrom(null)}
                className={`cursor-grab rounded-xl border px-3 py-2 active:cursor-grabbing ${
                  selectedId === p.id ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-400' : 'border-slate-200 bg-slate-50'
                } ${plDragFrom === idx ? 'ring-2 ring-amber-400' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className="w-full text-left"
                >
                  <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {p.slug} · {p.track_count ?? 0} faixa(s) · {p.status === 'draft' ? 'rascunho' : 'publicada'}
                  </p>
                </button>
                <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-200/80 pt-2">
                  <select
                    value={p.status}
                    onChange={(e) => updatePlaylist(p, { status: e.target.value })}
                    disabled={saving}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                  >
                    <option value="published">Publicada</option>
                    <option value="draft">Rascunho</option>
                  </select>
                  <label className="flex items-center gap-1 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={p.active}
                      onChange={(e) => updatePlaylist(p, { active: e.target.checked })}
                      disabled={saving}
                    />
                    Ativa
                  </label>
                  <button
                    type="button"
                    className="ml-auto text-[11px] text-red-600 hover:underline"
                    disabled={saving}
                    onClick={() => deletePlaylist(p)}
                  >
                    Apagar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          {!selectedId ? (
            <p className="text-sm text-slate-500">Selecione uma playlist à esquerda ou crie uma nova.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Faixas</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{selected?.name}</p>
                  {selected?.cover_url ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Capa:{' '}
                      <a href={selected.cover_url} className="text-amber-800 underline" target="_blank" rel="noreferrer">
                        ver imagem
                      </a>
                    </p>
                  ) : null}
                  <div className="mt-2">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      id="ig-pl-cover"
                      disabled={saving}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f && selectedId) uploadPlaylistCover(selectedId, f);
                        e.target.value = '';
                      }}
                    />
                    <label
                      htmlFor="ig-pl-cover"
                      className="inline-block cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      Capa da playlist (imagem)
                    </label>
                  </div>
                </div>
                <label className="cursor-pointer rounded-lg border-2 border-dashed border-amber-500/80 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 hover:bg-amber-100">
                  <input
                    type="file"
                    accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/wav,audio/flac,.mp3,.m4a,.wav"
                    multiple
                    className="sr-only"
                    disabled={saving}
                    onChange={(e) => {
                      const f = e.target.files;
                      if (f?.length) bulkUpload(f);
                      e.target.value = '';
                    }}
                  />
                  Carregar vários MP3
                </label>
              </div>

              {loadingTracks ? (
                <p className="mt-4 text-sm text-slate-500">A carregar faixas…</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {tracks.map((t, index) => (
                    <li
                      key={t.id}
                      draggable={!saving}
                      onDragStart={() => setTrDragFrom(index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (trDragFrom == null) return;
                        reorderTracks(trDragFrom, index);
                        setTrDragFrom(null);
                      }}
                      onDragEnd={() => setTrDragFrom(null)}
                      className={`flex cursor-grab gap-3 rounded-xl border border-slate-200 bg-white p-2 shadow-sm active:cursor-grabbing ${
                        trDragFrom === index ? 'ring-2 ring-amber-400' : ''
                      }`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
                        {index + 1}
                      </span>
                      {t.cover_url ? (
                        <img
                          src={t.cover_url}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-200" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{t.title}</p>
                        <p className="truncate text-xs text-slate-500">{t.artist || '—'} · {fmtDur(t.duration_sec)}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="sr-only"
                            id={`cover-tr-${t.id}`}
                            disabled={saving}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadTrackCover(t.id, f);
                              e.target.value = '';
                            }}
                          />
                          <label
                            htmlFor={`cover-tr-${t.id}`}
                            className="cursor-pointer text-[11px] font-medium text-amber-800 hover:underline"
                          >
                            Capa
                          </label>
                          <button
                            type="button"
                            className="text-[11px] text-red-600 hover:underline"
                            disabled={saving}
                            onClick={() => deleteTrack(t)}
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!loadingTracks && tracks.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Nenhuma faixa — use «Carregar vários MP3».</p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
