import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, API_REQUEST_MS_BULK, fetchWithAuth, throwIfHtmlOrCannotPost } from '../apiConfig';

function fmtDur(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return '—';
  const n = Math.floor(Number(sec));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formMatchesPlaylist(form, p) {
  if (!form || !p) return true;
  return (
    form.name.trim() === String(p.name || '').trim() &&
    String(form.description || '') === String(p.description || '') &&
    form.status === p.status &&
    (form.auto_next_playlist !== false) === (p.auto_next_playlist !== false) &&
    Boolean(form.active) === Boolean(p.active)
  );
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
      description: p.description ?? '',
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
      setOkMsg('Playlist criada. Selecione-a à esquerda e use «Guardar alterações» se quiser mudar nome ou opções.');
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
        description: String(editForm.description ?? ''),
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
      setOkMsg(errN ? `${msg} (${errN} erro(s) — ver consola)` : msg);
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

  const uploadTrackCover = async (trackId, file) => {
    if (!file?.size) return;
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const fd = new FormData();
      fd.append('cover', file);
      const r = await fetchWithAuth(
        `${API_BASE}/radio/tracks/${encodeURIComponent(String(trackId))}/cover`,
        {
          method: 'POST',
          body: fd,
          timeoutMs: API_REQUEST_MS_BULK,
        },
      );
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg('Capa atualizada com a imagem enviada.');
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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">Andy Radio</h3>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        <strong className="font-semibold text-slate-800">Único backend (CRM):</strong> o que gravar aqui fica nesta API.
        O front do andymodels.com <strong className="font-semibold text-slate-700">não</strong> deve ter outro servidor só
        para a rádio: o player do site lê o JSON em{' '}
        <code className="rounded bg-slate-100 px-1 text-xs text-slate-800">GET /api/public/radio/v2</code> no domínio do CRM
        (URL completa: <code className="rounded bg-slate-100 px-1 text-xs">PUBLIC_APP_URL</code>
        + esse caminho). «Enviar músicas» e «Guardar alterações» são o que «sobem» o conteúdo para o site usar.{' '}
        <strong className="font-semibold text-slate-700">Capas por faixa (automático ao enviar MP3):</strong> usa primeiro a
        capa embutida no ficheiro (ID3), se existir; se não houver, gera uma capa com foto aleatória de uma modelo feminina do
        cadastro (P&amp;B + primeiro nome em laranja). Pode substituir por imagem manual em cada faixa. Para desligar só o
        fallback modelo:{' '}
        <code className="rounded bg-slate-100 px-1 text-xs">RADIO_COVER_AUTO_MODEL=0</code>.
      </p>

      {radioMeta ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Regras de envio</p>
          <p className="mt-1 text-amber-900/95">
            Até <strong>{radioMeta.max_bulk_audio_files ?? 25}</strong> ficheiros por cada envio; máximo{' '}
            <strong>{radioMeta.max_tracks_per_playlist ?? 50}</strong> faixas no total por playlist. O servidor recusa
            com mensagem clara se ultrapassar.
          </p>
        </div>
      ) : null}

      {loading ? <p className="mt-4 text-sm text-slate-500">A carregar…</p> : null}
      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {okMsg ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{okMsg}</p>
      ) : null}

      {bulkUploadStatus ? (
        <div
          className="mt-4 flex items-start gap-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950 shadow-sm"
          role="status"
          aria-live="polite"
        >
          <span
            className="mt-0.5 inline-block h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-sky-700 border-t-transparent"
            aria-hidden
          />
          <div>
            <p className="font-semibold text-sky-950">A enviar músicas…</p>
            <p className="mt-1 text-sky-900/95">
              <strong>{bulkUploadStatus.files}</strong> ficheiro(s) em processamento. Isto pode demorar um minuto (upload,
              leitura de áudio e capas). Não feche a página.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Playlists</p>
          <p className="mt-1 text-xs text-slate-500">Arraste para ordenar. Clique no nome para selecionar.</p>
          <div className="mt-3 grid gap-2">
            <input
              type="text"
              value={newPlName}
              onChange={(e) => setNewPlName(e.target.value)}
              placeholder="Nome da nova playlist"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={saving}
              onClick={createPlaylist}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Criar playlist
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
                    {p.slug} · {p.track_count ?? 0} faixa(s) · {p.status === 'draft' ? 'rascunho' : 'publicada'} ·{' '}
                    {p.active !== false ? 'ativa' : 'inativa'}
                  </p>
                </button>
                <div className="mt-2 flex justify-end border-t border-slate-200/80 pt-2">
                  <button
                    type="button"
                    className="text-[11px] text-red-600 hover:underline"
                    disabled={saving}
                    onClick={() => deletePlaylist(p)}
                  >
                    Apagar playlist
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
              {editForm && selected ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Editar playlist</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Altere os campos e clique em «Guardar alterações». Nada é gravado no servidor até guardar.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm text-slate-700">
                      <span className="mb-1 block font-medium">Nome</span>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => (f ? { ...f, name: e.target.value } : f))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-sm text-slate-700 sm:col-span-2">
                      <span className="mb-1 block font-medium">Descrição (opcional)</span>
                      <textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm((f) => (f ? { ...f, description: e.target.value } : f))}
                        rows={2}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-sm text-slate-700">
                      <span className="mb-1 block font-medium">Estado</span>
                      <select
                        value={editForm.status}
                        onChange={(e) =>
                          setEditForm((f) => (f ? { ...f, status: e.target.value === 'draft' ? 'draft' : 'published' } : f))
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="published">Publicada</option>
                        <option value="draft">Rascunho</option>
                      </select>
                    </label>
                    <div className="flex flex-col gap-2 text-sm text-slate-700">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editForm.auto_next_playlist}
                          onChange={(e) =>
                            setEditForm((f) => (f ? { ...f, auto_next_playlist: e.target.checked } : f))
                          }
                        />
                        Avançar à playlist seguinte quando esta terminar (site)
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editForm.active}
                          onChange={(e) => setEditForm((f) => (f ? { ...f, active: e.target.checked } : f))}
                        />
                        Playlist ativa
                      </label>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={saving || !playlistEditDirty}
                      onClick={savePlaylistEdits}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                    >
                      Guardar alterações
                    </button>
                    {playlistEditDirty ? (
                      <span className="text-xs text-amber-700">Alterações por guardar</span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Faixas</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{selected?.name}</p>
                  <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] leading-snug text-slate-700">
                    <strong className="font-semibold text-slate-800">Enviar MP3:</strong> 1) «Escolher ficheiros MP3» → 2){' '}
                    «Enviar músicas». Isto grava no CRM; o andymodels.com (player) usa só a API do CRM, sem outro backend no
                    site.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {tracks.length} / {radioMeta?.max_tracks_per_playlist ?? 50} faixas nesta playlist
                    {tracks.length >= (radioMeta?.max_tracks_per_playlist ?? 50) ? (
                      <span className="ml-2 font-semibold text-amber-700">— limite atingido</span>
                    ) : null}
                  </p>
                  {selected?.cover_url ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Capa da playlist:{' '}
                      <a href={selected.cover_url} className="text-amber-800 underline" target="_blank" rel="noreferrer">
                        ver
                      </a>
                    </p>
                  ) : null}
                </div>
                <div className="flex w-full max-w-lg flex-col gap-2 sm:w-auto sm:items-stretch">
                  <p className="text-[11px] text-slate-500 sm:text-right">
                    Máx. {radioMeta?.max_bulk_audio_files ?? 25} ficheiros por envio.
                  </p>
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
                    className={`cursor-pointer rounded-lg border-2 border-dashed border-amber-500/80 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-950 hover:bg-amber-100 ${
                      saving ? 'pointer-events-none opacity-60' : ''
                    }`}
                  >
                    Escolher ficheiros MP3
                  </label>
                  <div className="flex w-full flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving || bulkUploadStatus != null || pendingAudioFiles.length === 0}
                      title={
                        pendingAudioFiles.length === 0
                          ? 'Escolha primeiro um ou mais ficheiros MP3 com o botão acima'
                          : 'Enviar os ficheiros selecionados para o servidor'
                      }
                      onClick={sendPendingAudio}
                      className="min-h-[44px] flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 sm:min-w-[160px] sm:flex-none"
                    >
                      Enviar músicas
                    </button>
                    <button
                      type="button"
                      disabled={saving || pendingAudioFiles.length === 0}
                      onClick={clearPendingAudio}
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Limpar seleção
                    </button>
                  </div>
                  <p className="text-center text-[11px] text-slate-500 sm:text-left">
                    {pendingAudioFiles.length === 0
                      ? 'Nenhum ficheiro na fila — use «Escolher ficheiros MP3».'
                      : `${pendingAudioFiles.length} ficheiro(s) na fila — clique «Enviar músicas».`}
                  </p>
                  {pendingAudioFiles.length > 0 ? (
                    <ul className="max-h-28 list-inside list-disc overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 text-left text-[11px] text-slate-600">
                      {pendingAudioFiles.map((f) => (
                        <li key={f.name + f.size} className="truncate">
                          {f.name}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
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
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <label className="cursor-pointer text-[11px] font-medium text-slate-600 hover:underline">
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="sr-only"
                              disabled={saving}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) uploadTrackCover(t.id, f);
                                e.target.value = '';
                              }}
                            />
                            Enviar capa (imagem)
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
                <p className="mt-4 text-sm text-slate-500">
                  Nenhuma faixa — escolha ficheiros com «Escolher ficheiros MP3» e clique «Enviar músicas».
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
