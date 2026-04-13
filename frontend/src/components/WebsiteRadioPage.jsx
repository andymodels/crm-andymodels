import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, API_REQUEST_MS_BULK, fetchWithAuth, throwIfHtmlOrCannotPost } from '../apiConfig';

function fmtDur(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return '—';
  const n = Math.floor(Number(sec));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** URL da capa da playlist (API: `cover_url`; alias opcional `playlist_cover_url`). */
function playlistCoverUrl(p) {
  if (!p) return '';
  const u = p.playlist_cover_url ?? p.cover_url;
  const s = u != null ? String(u).trim() : '';
  return s;
}

function AndyPlaylistCoverPlaceholder() {
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900"
      aria-hidden
    >
      <span className="select-none text-lg font-black leading-none text-orange-500">A</span>
    </div>
  );
}

/**
 * `src` da capa da faixa: anexa `t=` (timestamp) para o browser não reutilizar bitmap antigo.
 * Prioridade: `updated_at` da API; senão fingerprint da própria `cover_url` (muda a cada ficheiro novo).
 */
function trackCoverImgSrc(t) {
  const u = t?.cover_url;
  if (!u || typeof u !== 'string') return '';
  let ts;
  if (t.updated_at != null) {
    const ms = new Date(t.updated_at).getTime();
    ts = Number.isFinite(ms) ? ms : String(t.updated_at);
  } else {
    ts = u;
  }
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}t=${encodeURIComponent(String(ts))}`;
}

function formMatchesPlaylist(form, p) {
  if (!form || !p) return true;
  return (
    form.name.trim() === String(p.name || '').trim() &&
    form.status === p.status &&
    (form.auto_next_playlist !== false) === (p.auto_next_playlist !== false) &&
    Boolean(form.active) === Boolean(p.active)
  );
}

/** Gestão de playlists e faixas da rádio no site. */
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
  const [radioMeta, setRadioMeta] = useState(null);
  /** Upload em lote de MP3 (feedback visual — o pedido pode demorar). */
  const [bulkUploadStatus, setBulkUploadStatus] = useState(null);
  /** Ficheiros MP3 escolhidos — só sobem ao clicar «Enviar músicas». */
  const [pendingAudioFiles, setPendingAudioFiles] = useState([]);
  /** Rascunho local da playlist selecionada — grava com «Guardar alterações». */
  const [editForm, setEditForm] = useState(null);
  /** Evita repor o rascunho ao dar refresh às playlists (perdia edição não guardada). */
  const editFormSyncedForPlaylistId = useRef(null);

  const loadMeta = useCallback(async () => {
    try {
      const r = await fetchWithAuth(`${API_BASE}/radio/meta`);
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      const data = raw ? JSON.parse(raw) : {};
      if (r.ok) setRadioMeta(data);
      else setRadioMeta({ max_tracks_per_playlist: 50, max_bulk_audio_files: 25 });
    } catch {
      setRadioMeta({ max_tracks_per_playlist: 50, max_bulk_audio_files: 25 });
    }
  }, []);

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
    loadMeta();
  }, [loadPlaylists, loadMeta]);

  useEffect(() => {
    if (selectedId != null) loadTracks(selectedId);
  }, [selectedId, loadTracks]);

  const selected = playlists.find((p) => p.id === selectedId);

  useEffect(() => {
    if (!selectedId) {
      setEditForm(null);
      editFormSyncedForPlaylistId.current = null;
      return;
    }
    const p = playlists.find((x) => x.id === selectedId);
    if (!p) return;
    if (editFormSyncedForPlaylistId.current === selectedId) return;
    editFormSyncedForPlaylistId.current = selectedId;
    setEditForm({
      name: p.name || '',
      status: p.status === 'draft' ? 'draft' : 'published',
      auto_next_playlist: p.auto_next_playlist !== false,
      active: p.active !== false,
    });
  }, [selectedId, playlists]);

  const playlistEditDirty = useMemo(() => {
    if (!editForm || !selected) return false;
    return !formMatchesPlaylist(editForm, selected);
  }, [editForm, selected]);

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

  const savePlaylistEdits = async () => {
    if (!selected || !editForm) return;
    const name = String(editForm.name || '').trim();
    if (!name) {
      setError('O nome da playlist não pode ficar vazio.');
      return;
    }
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const body = {
        name,
        description: String(selected.description ?? ''),
        status: editForm.status === 'draft' ? 'draft' : 'published',
        auto_next_playlist: Boolean(editForm.auto_next_playlist),
        active: Boolean(editForm.active),
        slug: selected.slug,
        cover_url: selected.cover_url,
        sort_order: selected.sort_order,
      };
      const r = await fetchWithAuth(`${API_BASE}/radio/playlists/${encodeURIComponent(String(selected.id))}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg('Playlist guardada.');
      editFormSyncedForPlaylistId.current = null;
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
      if (selectedId === p.id) {
        setSelectedId(null);
        editFormSyncedForPlaylistId.current = null;
      }
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
    const max = radioMeta?.max_tracks_per_playlist ?? 50;
    const bulkMax = radioMeta?.max_bulk_audio_files ?? 25;
    if (fileList.length > bulkMax) {
      setError(
        `Limite de ${bulkMax} ficheiros por envio. Selecionou ${fileList.length}. Divida em vários envios (ex.: ${bulkMax} + ${fileList.length - bulkMax}).`,
      );
      return;
    }
    if (tracks.length + fileList.length > max) {
      setError(
        `Limite de ${max} faixas por playlist. Esta lista tem ${tracks.length} faixa(s) e tentou enviar ${fileList.length} ficheiro(s). Reduza a seleção ou apague faixas antes de continuar.`,
      );
      return;
    }
    const fd = new FormData();
    for (let i = 0; i < fileList.length; i += 1) {
      fd.append('audio', fileList[i], fileList[i].name);
    }
    setSaving(true);
    setBulkUploadStatus({ files: fileList.length });
    setError('');
    setOkMsg('');
    try {
      const r = await fetchWithAuth(
        `${API_BASE}/radio/playlists/${encodeURIComponent(String(selectedId))}/tracks/bulk`,
        { method: 'POST', body: fd, timeoutMs: API_REQUEST_MS_BULK },
      );
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      const data = raw ? JSON.parse(raw) : {};
      if (!r.ok) throw new Error(parseErr(raw, r));
      const msg = `Importadas ${data.created ?? 0} faixa(s).`;
      const errN = data.errors?.length;
      setOkMsg(errN ? `${msg} (${errN} com erro)` : msg);
      if (errN && data.errors) console.warn('[radio bulk]', data.errors);
      setPendingAudioFiles([]);
      await loadTracks(selectedId);
      await loadPlaylists();
    } catch (e) {
      const msg = String(e?.message || '');
      const aborted =
        e?.name === 'AbortError' || /aborted/i.test(msg) || msg.includes('The user aborted');
      setError(
        aborted
          ? 'O envio demorou demasiado e foi interrompido (limite de tempo). Tente menos ficheiros de uma vez ou verifique a rede; o servidor pode ainda estar a processar — atualize a lista de faixas daqui a instantes.'
          : msg || 'Erro no upload.',
      );
    } finally {
      setBulkUploadStatus(null);
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

  const onPickAudioFiles = (fileList) => {
    if (!fileList?.length) return;
    setPendingAudioFiles(Array.from(fileList));
    setError('');
  };

  const sendPendingAudio = () => {
    if (pendingAudioFiles.length === 0) return;
    bulkUpload(pendingAudioFiles);
  };

  const clearPendingAudio = () => {
    setPendingAudioFiles([]);
    setError('');
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="border-b border-slate-100 pb-5">
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">Rádio</h3>
        <p className="mt-1 max-w-xl text-sm text-slate-600">
          Playlists e músicas ouvidas no site. Guarde as alterações da playlist antes de sair.
        </p>
        {radioMeta ? (
          <p className="mt-3 text-xs text-slate-500">
            Até <span className="font-medium text-slate-700">{radioMeta.max_bulk_audio_files ?? 25}</span> ficheiros por
            envio · máximo{' '}
            <span className="font-medium text-slate-700">{radioMeta.max_tracks_per_playlist ?? 50}</span> faixas por
            playlist
          </p>
        ) : null}
      </header>

      <div className="mt-5 space-y-3">
        {loading ? <p className="text-sm text-slate-500">A carregar…</p> : null}
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        {okMsg ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{okMsg}</p>
        ) : null}
        {bulkUploadStatus ? (
          <div
            className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
            role="status"
            aria-live="polite"
          >
            <span
              className="mt-0.5 inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-sky-700 border-t-transparent"
              aria-hidden
            />
            <div>
              <p className="font-medium">A enviar músicas…</p>
              <p className="mt-0.5 text-sky-900/90">
                {bulkUploadStatus.files} ficheiro(s). Pode demorar um minuto — não feche esta página.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(240px,280px)_1fr] lg:items-start">
        <aside className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Playlists</h4>
            <p className="mt-0.5 text-xs text-slate-500">Arraste para ordenar · clique no nome para abrir</p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newPlName}
              onChange={(e) => setNewPlName(e.target.value)}
              placeholder="Nome da playlist"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
            />
            <button
              type="button"
              disabled={saving}
              onClick={createPlaylist}
              className="shrink-0 whitespace-nowrap rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Criar playlist
            </button>
          </div>
          <ul className="space-y-2">
            {playlists.map((p, idx) => {
              const coverSrc = playlistCoverUrl(p);
              return (
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
                  className={`flex gap-3 rounded-xl border bg-white px-3 py-2.5 shadow-sm ${
                    selectedId === p.id ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-200'
                  } ${plDragFrom === idx ? 'ring-2 ring-amber-400' : ''} cursor-grab active:cursor-grabbing`}
                >
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className="w-full text-left"
                    >
                      <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {p.track_count ?? 0} faixas · {p.status === 'draft' ? 'Rascunho' : 'Publicada'} ·{' '}
                        {p.active !== false ? 'Ativa' : 'Inativa'}
                      </p>
                    </button>
                    <div className="mt-2 flex justify-start border-t border-slate-100 pt-2">
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        disabled={saving}
                        onClick={(e) => {
                          e.stopPropagation();
                          deletePlaylist(p);
                        }}
                      >
                        Apagar
                      </button>
                    </div>
                  </div>
                  <div className="shrink-0 self-start pt-0.5">
                    <div
                      className="relative h-14 w-14 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm"
                      aria-hidden
                    >
                      {coverSrc ? (
                        <img
                          src={coverSrc}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <AndyPlaylistCoverPlaceholder />
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="min-w-0 space-y-8">
          {!selectedId ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
              <p className="text-sm text-slate-600">Escolha uma playlist à esquerda ou crie uma nova.</p>
            </div>
          ) : (
            <>
              {editForm && selected ? (
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="border-b border-slate-100 pb-4">
                    <h4 className="text-sm font-semibold text-slate-900">Detalhes da playlist</h4>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Nome, estado e opções. As capas das faixas são sempre automáticas (ID3 → lojas públicas → modelo).
                    </p>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm text-slate-700 sm:col-span-2">
                      <span className="mb-1 block font-medium text-slate-800">Nome</span>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => (f ? { ...f, name: e.target.value } : f))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
                      />
                    </label>
                    <label className="block text-sm text-slate-700">
                      <span className="mb-1 block font-medium text-slate-800">Estado</span>
                      <select
                        value={editForm.status}
                        onChange={(e) =>
                          setEditForm((f) => (f ? { ...f, status: e.target.value === 'draft' ? 'draft' : 'published' } : f))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
                      >
                        <option value="published">Publicada</option>
                        <option value="draft">Rascunho</option>
                      </select>
                    </label>
                    <div className="flex flex-col justify-end gap-3 text-sm text-slate-700 sm:col-span-1">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={editForm.auto_next_playlist}
                          onChange={(e) =>
                            setEditForm((f) => (f ? { ...f, auto_next_playlist: e.target.checked } : f))
                          }
                        />
                        <span>Passar à playlist seguinte quando esta terminar</span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={editForm.active}
                          onChange={(e) => setEditForm((f) => (f ? { ...f, active: e.target.checked } : f))}
                        />
                        <span>Playlist ativa no site</span>
                      </label>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={saving || !playlistEditDirty}
                      onClick={savePlaylistEdits}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                    >
                      Guardar alterações
                    </button>
                    {playlistEditDirty ? <span className="text-xs text-amber-700">Alterações não guardadas</span> : null}
                  </div>
                </div>
              ) : null}

              <div>
                <div className="border-t border-slate-100 pt-8">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-slate-900">Músicas</h4>
                    <p className="mt-0.5 truncate text-sm text-slate-700">{selected?.name}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {tracks.length} / {radioMeta?.max_tracks_per_playlist ?? 50} faixas
                      {tracks.length >= (radioMeta?.max_tracks_per_playlist ?? 50) ? (
                        <span className="ml-2 font-medium text-amber-700">· Limite atingido</span>
                      ) : null}
                    </p>
                    <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-500">
                      Capa por faixa (automática): primeiro ID3 no ficheiro; senão capa oficial (iTunes/Deezer); senão
                      modelo aleatório do elenco. Sem upload manual.
                    </p>
                  </div>

                  <div className="mx-auto mt-6 w-full max-w-xl">
                    <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-4">
                      <p className="text-center text-sm font-medium text-slate-900">Adicionar músicas</p>
                      <p className="mt-0.5 text-center text-xs text-slate-500">
                        MP3 e outros formatos · arraste ou clique
                      </p>
                      <div className="mt-3 flex flex-col items-center">
                        <input
                          type="file"
                          accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/wav,audio/flac,.mp3,.m4a,.wav"
                          multiple
                          className="sr-only"
                          id="radio-bulk-audio-input"
                          disabled={saving}
                          onChange={(e) => {
                            const f = e.target.files;
                            if (f?.length) onPickAudioFiles(f);
                            e.target.value = '';
                          }}
                        />
                        <label
                          htmlFor="radio-bulk-audio-input"
                          className={`flex w-full max-w-sm cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 ${
                            saving ? 'pointer-events-none opacity-60' : ''
                          }`}
                        >
                          Escolher ficheiros MP3
                        </label>
                        <div className="mt-3 flex w-full max-w-sm flex-wrap items-center justify-center gap-2">
                          <button
                            type="button"
                            disabled={saving || bulkUploadStatus != null || pendingAudioFiles.length === 0}
                            title={
                              pendingAudioFiles.length === 0
                                ? 'Escolha ficheiros acima'
                                : 'Enviar os ficheiros selecionados'
                            }
                            onClick={sendPendingAudio}
                            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            Enviar músicas
                          </button>
                          <button
                            type="button"
                            disabled={saving || pendingAudioFiles.length === 0}
                            onClick={clearPendingAudio}
                            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Limpar
                          </button>
                        </div>
                        <p className="mt-2 text-center text-xs text-slate-600">
                          {pendingAudioFiles.length === 0
                            ? 'Nenhum ficheiro selecionado.'
                            : `${pendingAudioFiles.length} na fila para envio.`}
                        </p>
                        {pendingAudioFiles.length > 0 ? (
                          <ul className="mt-2 max-h-24 w-full max-w-sm overflow-y-auto rounded border border-slate-200 bg-white p-2 text-left text-xs text-slate-700">
                            {pendingAudioFiles.map((f) => (
                              <li key={f.name + f.size} className="truncate py-0.5">
                                {f.name}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                {loadingTracks ? (
                  <p className="mt-6 text-sm text-slate-500">A carregar músicas…</p>
                ) : (
                  <ul className="mt-6 space-y-2">
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
                        className={`flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${
                          trDragFrom === index ? 'ring-2 ring-amber-400' : ''
                        } ${!saving ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
                          {index + 1}
                        </span>
                        {t.cover_url ? (
                          <img
                            key={`track-cover-${t.id}-${t.cover_url}-${String(t.updated_at ?? '')}`}
                            src={trackCoverImgSrc(t)}
                            alt=""
                            className="h-14 w-14 shrink-0 rounded-lg object-cover"
                            loading="eager"
                            decoding="async"
                          />
                        ) : (
                          <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-100" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900">{t.title}</p>
                          <p className="truncate text-xs text-slate-500">
                            {t.artist || '—'} · {fmtDur(t.duration_sec)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              className="text-xs text-red-600 hover:underline"
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
                  <p className="mt-6 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center text-sm text-slate-500">
                    Ainda não há músicas nesta playlist. Escolha ficheiros acima e envie.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
