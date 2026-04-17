import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  API_BASE,
  API_REQUEST_MS_BULK,
  RADIO_MAX_AUDIO_FILE_BYTES,
  fetchWithAuth,
  throwIfHtmlOrCannotPost,
  xhrPostWithAuth,
} from '../apiConfig';

let ytIframeApiPromise;
function loadYoutubeIframeApi() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (!ytIframeApiPromise) {
    ytIframeApiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') prev();
        resolve();
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const first = document.getElementsByTagName('script')[0];
        first.parentNode.insertBefore(tag, first);
      }
    });
  }
  return ytIframeApiPromise;
}

function fmtDur(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return '—';
  const n = Math.floor(Number(sec));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatRadioFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
    Boolean(form.active) === Boolean(p.active) &&
    String(form.curator_name ?? '').trim() === String(p.curator_name ?? '').trim() &&
    String(form.curator_instagram ?? '').trim() === String(p.curator_instagram ?? '').trim()
  );
}

function IconTrackPrevious({ className = 'h-6 w-6' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M5 5h2.5v14H5V5z" />
      <path d="M16 6v12L9 12 16 6z" />
    </svg>
  );
}

function IconTrackNext({ className = 'h-6 w-6' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 6v12L15 12 8 6z" />
      <path d="M16.5 5H19v14h-2.5V5z" />
    </svg>
  );
}

/**
 * Pré-escuta no CRM: áudio (MP3…) ou YouTube via iframe API (YT.Player), mesmo layout.
 */
function RadioCrmPreviewPlayer({ tracks, playlistCoverUrl, playlistId }) {
  const audioRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ytApiReady, setYtApiReady] = useState(false);

  const ytContainerId = useMemo(() => `crm-radio-yt-${playlistId}`, [playlistId]);
  const hasAnyYt = useMemo(() => tracks.some((t) => t.youtube_video_id), [tracks]);

  useEffect(() => {
    if (!hasAnyYt) {
      setYtApiReady(false);
      return;
    }
    let cancelled = false;
    loadYoutubeIframeApi().then(() => {
      if (!cancelled) setYtApiReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hasAnyYt]);

  useEffect(() => {
    setIdx(0);
    setPos(0);
    setDur(0);
    setPlaying(false);
    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.destroy();
      } catch {
        /* */
      }
      ytPlayerRef.current = null;
    }
  }, [playlistId]);

  useEffect(() => {
    if (tracks.length === 0) return;
    setIdx((i) => Math.min(Math.max(0, i), tracks.length - 1));
  }, [tracks.length]);

  const cur = tracks[idx];
  const src = cur?.audio_url;
  const isYt = Boolean(cur?.youtube_video_id);

  useEffect(() => {
    if (!cur) return;

    if (!isYt) {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          /* */
        }
        ytPlayerRef.current = null;
      }
      const a = audioRef.current;
      if (!a || !src) return;
      setPos(0);
      setDur(0);
      setPlaying(false);
      a.src = src;
      a.load();
      const onTime = () => setPos(a.currentTime);
      const onDur = () => {
        const x = a.duration;
        setDur(Number.isFinite(x) && x > 0 ? x : 0);
      };
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);
      const onEnded = () => {
        setPlaying(false);
        if (tracks.length > 1) setIdx((i) => (i + 1) % tracks.length);
      };
      a.addEventListener('timeupdate', onTime);
      a.addEventListener('loadedmetadata', onDur);
      a.addEventListener('durationchange', onDur);
      a.addEventListener('play', onPlay);
      a.addEventListener('pause', onPause);
      a.addEventListener('ended', onEnded);
      return () => {
        a.removeEventListener('timeupdate', onTime);
        a.removeEventListener('loadedmetadata', onDur);
        a.removeEventListener('durationchange', onDur);
        a.removeEventListener('play', onPlay);
        a.removeEventListener('pause', onPause);
        a.removeEventListener('ended', onEnded);
      };
    }

    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    return undefined;
  }, [isYt, src, cur?.id, tracks.length]);

  useEffect(() => {
    if (!isYt || !cur?.youtube_video_id || !ytApiReady || typeof window === 'undefined' || !window.YT) return;

    const vid = cur.youtube_video_id;
    setPos(0);
    setPlaying(false);

    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.loadVideoById(vid);
        const d = ytPlayerRef.current.getDuration?.();
        if (d && Number.isFinite(d) && d > 0) setDur(d);
      } catch {
        /* */
      }
      return undefined;
    }

    ytPlayerRef.current = new window.YT.Player(ytContainerId, {
      videoId: vid,
      height: '144',
      width: '256',
      playerVars: {
        controls: 0,
        rel: 0,
        playsinline: 1,
        modestbranding: 1,
      },
      events: {
        onReady: (e) => {
          const d = e.target.getDuration?.();
          setDur(Number.isFinite(d) && d > 0 ? d : 0);
          setPos(0);
        },
        onStateChange: (e) => {
          if (e.data === window.YT.PlayerState.PLAYING) setPlaying(true);
          if (e.data === window.YT.PlayerState.PAUSED) setPlaying(false);
          if (e.data === window.YT.PlayerState.ENDED) {
            setPlaying(false);
            setPos(0);
            if (tracks.length > 1) setIdx((i) => (i + 1) % tracks.length);
          }
        },
      },
    });

    return undefined;
  }, [isYt, cur?.youtube_video_id, ytApiReady, ytContainerId, tracks.length]);

  useEffect(() => {
    if (!isYt || !playing) return;
    const t = setInterval(() => {
      const p = ytPlayerRef.current;
      if (!p?.getCurrentTime) return;
      try {
        setPos(p.getCurrentTime());
        const d = p.getDuration?.();
        if (d && Number.isFinite(d) && d > 0) setDur(d);
      } catch {
        /* */
      }
    }, 250);
    return () => clearInterval(t);
  }, [isYt, playing]);

  const pct = dur > 0 ? Math.min(1000, Math.round((pos / dur) * 1000)) : 0;
  const art = playlistCoverUrl || (cur ? trackCoverImgSrc(cur) : '');

  const goPrev = () => {
    if (tracks.length === 0) return;
    setIdx((i) => (i - 1 + tracks.length) % tracks.length);
  };
  const goNext = () => {
    if (tracks.length === 0) return;
    setIdx((i) => (i + 1) % tracks.length);
  };

  const togglePlay = () => {
    if (cur?.youtube_video_id) {
      const p = ytPlayerRef.current;
      if (!p?.playVideo) return;
      try {
        if (playing) p.pauseVideo();
        else void p.playVideo();
      } catch {
        /* */
      }
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else void a.play().catch(() => {});
  };

  if (!tracks.length || !cur) return null;

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">Pré-escuta (CRM)</p>
      <p className="mt-0.5 text-xs text-slate-500">
        MP3 no elemento de áudio; faixas YouTube via iframe API. O JSON público inclui{' '}
        <span className="font-mono text-[11px]">youtube_video_id</span> para o site.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="radio-cover-frame relative w-12 shrink-0 rounded-lg bg-slate-100 sm:w-14">
          {art ? (
            <img src={art} alt="" />
          ) : (
            <AndyPlaylistCoverPlaceholder />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{cur.title || '—'}</p>
          <p className="truncate text-xs text-slate-600">{cur.artist || '—'}</p>
        </div>
      </div>
      <div
        id={ytContainerId}
        className="pointer-events-none fixed left-[-9999px] top-0 h-px w-px overflow-hidden opacity-0"
        aria-hidden
      />
      <audio ref={audioRef} preload="metadata" className="hidden" />
      <div className="mt-3 flex items-center gap-2">
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-600">{fmtDur(pos)}</span>
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={pct}
          disabled={!dur}
          onChange={(e) => {
            if (cur?.youtube_video_id) {
              const p = ytPlayerRef.current;
              if (!p?.seekTo || !dur) return;
              const next01 = Number(e.target.value) / 1000;
              const t = next01 * dur;
              p.seekTo(t, true);
              setPos(t);
              return;
            }
            const a = audioRef.current;
            if (!a || !dur) return;
            const next01 = Number(e.target.value) / 1000;
            a.currentTime = next01 * dur;
            setPos(a.currentTime);
          }}
          className="h-2 w-full min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#F27121] [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-200 [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#F27121] [&::-webkit-slider-thumb]:bg-white"
          aria-label="Posição na faixa"
        />
        <span className="w-10 shrink-0 text-xs tabular-nums text-slate-600">{fmtDur(dur)}</span>
      </div>
      <div className="mt-3 flex items-center justify-center gap-4 text-slate-800">
        <button
          type="button"
          onClick={goPrev}
          className="rounded-full p-2 text-slate-800 hover:bg-slate-100"
          title="Faixa anterior"
        >
          <IconTrackPrevious className="h-7 w-7" />
        </button>
        <button
          type="button"
          onClick={togglePlay}
          className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {playing ? 'Pausa' : 'Reproduzir'}
        </button>
        <button
          type="button"
          onClick={goNext}
          className="rounded-full p-2 text-slate-800 hover:bg-slate-100"
          title="Faixa seguinte"
        >
          <IconTrackNext className="h-7 w-7" />
        </button>
      </div>
    </div>
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
  const [ytUrl, setYtUrl] = useState('');
  const [ytTitle, setYtTitle] = useState('');
  const [ytArtist, setYtArtist] = useState('');
  /** Rascunho local da playlist selecionada — grava com «Guardar alterações». */
  const [editForm, setEditForm] = useState(null);
  /** Evita repor o rascunho ao dar refresh às playlists (perdia edição não guardada). */
  const editFormSyncedForPlaylistId = useRef(null);
  const playlistCoverFileInputRef = useRef(null);
  const playlistCoverUploadTargetIdRef = useRef(null);

  const loadMeta = useCallback(async () => {
    try {
      const r = await fetchWithAuth(`${API_BASE}/radio/meta`);
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      const data = raw ? JSON.parse(raw) : {};
      if (r.ok) setRadioMeta(data);
      else setRadioMeta({ max_tracks_per_playlist: 50, max_bulk_audio_files: 50 });
    } catch {
      setRadioMeta({ max_tracks_per_playlist: 50, max_bulk_audio_files: 50 });
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
      curator_name: String(p.curator_name ?? '').trim(),
      curator_instagram: String(p.curator_instagram ?? '').trim(),
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
      const createPayload = {
        name,
        status: 'published',
        active: true,
        curator_name: '',
        curator_instagram: '',
      };
      console.log('[radio CRM] POST /radio/playlists — payload enviado', createPayload);
      const r = await fetchWithAuth(`${API_BASE}/radio/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
      });
      const raw = await r.text();
      let createData;
      try {
        createData = raw ? JSON.parse(raw) : null;
      } catch {
        createData = raw;
      }
      console.log('[radio CRM] POST /radio/playlists — resposta', r.status, createData);
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
      const coverStr =
        selected.cover_url != null && String(selected.cover_url).trim() !== ''
          ? String(selected.cover_url).trim()
          : '';
      const body = {
        name,
        description: String(selected.description ?? ''),
        status: editForm.status === 'draft' ? 'draft' : 'published',
        auto_next_playlist: Boolean(editForm.auto_next_playlist),
        active: Boolean(editForm.active),
        slug: selected.slug,
        sort_order: selected.sort_order,
        cover_url: coverStr,
        playlist_cover_url: coverStr,
        curator_name: String(editForm.curator_name ?? '').trim(),
        curator_instagram: String(editForm.curator_instagram ?? '').trim(),
      };
      console.log('[radio CRM] PUT /radio/playlists/:id — payload enviado', body);
      const r = await fetchWithAuth(`${API_BASE}/radio/playlists/${encodeURIComponent(String(selected.id))}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await r.text();
      let saved;
      try {
        saved = raw ? JSON.parse(raw) : null;
      } catch {
        saved = raw;
      }
      console.log('[radio CRM] PUT /radio/playlists/:id — resposta', r.status, saved);
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg('Playlist guardada (persistida no servidor).');
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

  const bulkUpload = async (fileList) => {
    if (!selectedId || !fileList?.length) return;
    const max = radioMeta?.max_tracks_per_playlist ?? 50;
    const bulkMax = radioMeta?.max_bulk_audio_files ?? 50;
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
    const maxBytes = radioMeta?.max_audio_file_bytes ?? RADIO_MAX_AUDIO_FILE_BYTES;
    for (let i = 0; i < fileList.length; i += 1) {
      const f = fileList[i];
      if (f.size > maxBytes) {
        setError(
          `Ficheiro demasiado grande: «${f.name}» (${formatRadioFileSize(f.size)}). Máximo: ${formatRadioFileSize(maxBytes)} por ficheiro.`,
        );
        return;
      }
    }
    const fd = new FormData();
    for (let i = 0; i < fileList.length; i += 1) {
      fd.append('audio', fileList[i], fileList[i].name);
    }
    const totalBytes = fileList.reduce((acc, f) => acc + (f.size || 0), 0);
    const label = fileList.length === 1 ? fileList[0].name : `${fileList.length} ficheiros`;
    setSaving(true);
    setBulkUploadStatus({
      files: fileList.length,
      totalBytes,
      label,
      phase: 'uploading',
      loaded: 0,
      total: totalBytes,
      percent: 0,
    });
    setError('');
    setOkMsg('');
    try {
      const r = await xhrPostWithAuth(
        `${API_BASE}/radio/playlists/${encodeURIComponent(String(selectedId))}/tracks/bulk`,
        fd,
        {
          timeoutMs: API_REQUEST_MS_BULK,
          onUploadProgress: ({ loaded, total, percent }) => {
            setBulkUploadStatus((prev) =>
              prev
                ? {
                    ...prev,
                    loaded,
                    total,
                    percent,
                    phase: percent >= 100 ? 'processing' : 'uploading',
                  }
                : prev,
            );
          },
        },
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

  const reorderPlaylists = async (from, to) => {
    if (from == null || to == null || from === to) return;
    const next = [...playlists];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setPlaylists(next);
    setSaving(true);
    setError('');
    setOkMsg('');
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

  const regenerateTrackCover = async (t) => {
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const r = await fetchWithAuth(
        `${API_BASE}/radio/tracks/${encodeURIComponent(String(t.id))}/cover/regenerate-model`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg('Nova capa gerada.');
      await loadTracks(selectedId);
      await loadPlaylists();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro.');
    } finally {
      setSaving(false);
    }
  };

  const uploadPlaylistCover = async (playlistId, file) => {
    if (!file?.size || playlistId == null) return;
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const fd = new FormData();
      fd.append('cover', file);
      const r = await fetchWithAuth(
        `${API_BASE}/radio/playlists/${encodeURIComponent(String(playlistId))}/cover`,
        { method: 'POST', body: fd, timeoutMs: API_REQUEST_MS_BULK },
      );
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      if (!r.ok) throw new Error(parseErr(raw, r));
      const updated = raw ? JSON.parse(raw) : {};
      setPlaylists((prev) => prev.map((pl) => (pl.id === playlistId ? { ...pl, ...updated } : pl)));
      setOkMsg('Capa da playlist atualizada.');
      editFormSyncedForPlaylistId.current = null;
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro.');
    } finally {
      setSaving(false);
    }
  };

  const openPlaylistCoverPicker = (playlistId, e) => {
    e?.stopPropagation?.();
    playlistCoverUploadTargetIdRef.current = playlistId;
    queueMicrotask(() => playlistCoverFileInputRef.current?.click());
  };

  const onPickAudioFiles = (fileList) => {
    if (!fileList?.length) return;
    const maxBytes = radioMeta?.max_audio_file_bytes ?? RADIO_MAX_AUDIO_FILE_BYTES;
    const arr = Array.from(fileList);
    const tooBig = arr.find((f) => f.size > maxBytes);
    if (tooBig) {
      setError(
        `Ficheiro demasiado grande: «${tooBig.name}» (${formatRadioFileSize(tooBig.size)}). Máximo: ${formatRadioFileSize(maxBytes)} por ficheiro.`,
      );
      return;
    }
    setPendingAudioFiles(arr);
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

  const addYoutubeTrack = async () => {
    if (selectedId == null) return;
    const url = String(ytUrl || '').trim();
    if (!url) {
      setError('Cole o link do YouTube.');
      return;
    }
    const max = radioMeta?.max_tracks_per_playlist ?? 50;
    if (tracks.length >= max) {
      setError(`Limite de ${max} faixas por playlist.`);
      return;
    }
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const body = {
        youtube_url: url,
        ...(String(ytTitle || '').trim() ? { title: String(ytTitle).trim() } : {}),
        ...(String(ytArtist || '').trim() ? { artist: String(ytArtist).trim() } : {}),
      };
      const r = await fetchWithAuth(
        `${API_BASE}/radio/playlists/${encodeURIComponent(String(selectedId))}/tracks/youtube`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      const data = raw ? JSON.parse(raw) : {};
      if (!r.ok) throw new Error(parseErr(raw, r));
      setOkMsg(`Faixa YouTube adicionada${data?.youtube_video_id ? ` (${data.youtube_video_id})` : ''}.`);
      setYtUrl('');
      setYtTitle('');
      setYtArtist('');
      await loadTracks(selectedId);
      await loadPlaylists();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao adicionar YouTube.');
    } finally {
      setSaving(false);
    }
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
            Até <span className="font-medium text-slate-700">{radioMeta.max_bulk_audio_files ?? 50}</span> ficheiros por
            envio · até{' '}
            <span className="font-medium text-slate-700">{radioMeta.max_audio_file_mb ?? 250}</span> MB por ficheiro ·
            máximo <span className="font-medium text-slate-700">{radioMeta.max_tracks_per_playlist ?? 50}</span> faixas
            por playlist
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
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {bulkUploadStatus.phase === 'processing'
                  ? 'A processar no servidor…'
                  : 'A enviar músicas…'}
              </p>
              <p className="mt-0.5 truncate text-sky-900/90" title={bulkUploadStatus.label}>
                {bulkUploadStatus.label}
                {bulkUploadStatus.totalBytes != null ? (
                  <>
                    {' '}
                    · {formatRadioFileSize(bulkUploadStatus.totalBytes)} no total
                  </>
                ) : null}
              </p>
              {bulkUploadStatus.percent != null ? (
                <p className="mt-1 font-mono text-xs tabular-nums text-sky-950">
                  {bulkUploadStatus.phase === 'uploading'
                    ? `${bulkUploadStatus.percent}% · ${formatRadioFileSize(bulkUploadStatus.loaded ?? 0)} / ${formatRadioFileSize(bulkUploadStatus.total ?? bulkUploadStatus.totalBytes ?? 0)}`
                    : 'Upload concluído — a aguardar resposta…'}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-sky-800/90">Não feche esta página durante o envio.</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(240px,280px)_1fr] lg:items-start">
        <aside className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Playlists</h4>
            <p className="mt-0.5 text-xs text-slate-500">
              Mais recentes no topo · arrastar para reordenar (grava posição) · clique no nome · capa à direita
            </p>
          </div>
          <input
            ref={playlistCoverFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            disabled={saving}
            onChange={(e) => {
              const f = e.target.files?.[0];
              const pid = playlistCoverUploadTargetIdRef.current;
              playlistCoverUploadTargetIdRef.current = null;
              e.target.value = '';
              if (f && pid != null) uploadPlaylistCover(pid, f);
            }}
          />
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
            {playlists.map((p, plIndex) => {
              const coverSrc = playlistCoverUrl(p);
              return (
                <li
                  key={p.id}
                  draggable={!saving}
                  onDragStart={() => setPlDragFrom(plIndex)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (plDragFrom == null) return;
                    reorderPlaylists(plDragFrom, plIndex);
                    setPlDragFrom(null);
                  }}
                  onDragEnd={() => setPlDragFrom(null)}
                  className={`flex gap-3 rounded-xl border bg-white px-3 py-2.5 shadow-sm ${
                    selectedId === p.id ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-200'
                  } ${plDragFrom === plIndex ? 'ring-2 ring-amber-400' : ''} ${
                    !saving ? 'cursor-grab active:cursor-grabbing' : ''
                  }`}
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
                    <button
                      type="button"
                      title="Enviar capa da playlist (JPEG/PNG/WebP)"
                      disabled={saving}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => openPlaylistCoverPicker(p.id, e)}
                      className="radio-cover-frame relative w-12 cursor-pointer rounded-lg border border-slate-200 bg-slate-100 shadow-sm transition hover:border-slate-300 hover:ring-2 hover:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-14"
                    >
                      {coverSrc ? (
                        <img
                          key={`pl-${p.id}-${coverSrc}-${String(p.updated_at ?? '')}`}
                          src={coverSrc}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <AndyPlaylistCoverPlaceholder />
                      )}
                    </button>
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
                      Nome, estado e opções. Capa da playlist: clique na miniatura à esquerda. Capas das faixas são
                      automáticas (ID3 → lojas públicas → pool de imagens).
                    </p>
                  </div>
                  {editForm.status !== 'published' || editForm.active === false ? (
                    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-950">
                      <strong className="font-semibold">Visível no site:</strong> o JSON público (
                      <code className="rounded bg-white/80 px-1">/api/public/radio/v2</code>) só inclui playlists com
                      estado <strong>Publicada</strong> e com <strong>Playlist ativa no site</strong> ativada. Ajuste
                      abaixo e guarde.
                    </div>
                  ) : null}
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
                    <label className="block text-sm text-slate-700 sm:col-span-2">
                      <span className="mb-1 block font-medium text-slate-800">Nome do curador</span>
                      <input
                        type="text"
                        value={editForm.curator_name ?? ''}
                        onChange={(e) =>
                          setEditForm((f) => (f ? { ...f, curator_name: e.target.value } : f))
                        }
                        placeholder="Opcional"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
                      />
                    </label>
                    <label className="block text-sm text-slate-700 sm:col-span-2">
                      <span className="mb-1 block font-medium text-slate-800">Instagram do curador</span>
                      <input
                        type="url"
                        value={editForm.curator_instagram ?? ''}
                        onChange={(e) =>
                          setEditForm((f) => (f ? { ...f, curator_instagram: e.target.value } : f))
                        }
                        placeholder="https://instagram.com/… ou @utilizador"
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
                      Faixas com ficheiro: capa automática (ID3 → iTunes/Deezer → pool B2). Faixas só com link YouTube:
                      capa oficial <span className="font-mono text-[11px]">hqdefault</span> do vídeo; sem upload de
                      áudio.
                    </p>
                  </div>

                  {!loadingTracks && tracks.length > 0 && selected ? (
                    <RadioCrmPreviewPlayer
                      playlistId={selected.id}
                      tracks={tracks}
                      playlistCoverUrl={playlistCoverUrl(selected)}
                    />
                  ) : null}

                  {selected ? (
                    <p className="mt-4 text-xs text-slate-600">
                      <button
                        type="button"
                        className="font-medium text-slate-800 underline"
                        onClick={() => window.open(`${API_BASE}/public/radio`, '_blank', 'noopener,noreferrer')}
                      >
                        Abrir JSON público (o que o site deve pedir)
                      </button>
                      . O servidor envia cabeçalhos anti-cache; no site use fetch com{' '}
                      <span className="font-mono text-[11px]">cache: &apos;no-store&apos;</span>. Só playlists{' '}
                      <strong>publicadas</strong> e <strong>ativas</strong> entram neste JSON — se não vir alterações,
                      confira o estado da playlist.
                    </p>
                  ) : null}

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
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <p className="text-center text-sm font-medium text-slate-900">Adicionar do YouTube</p>
                      <p className="mt-0.5 text-center text-xs text-slate-500">
                        Link do vídeo (watch, youtu.be ou shorts) — sem ficheiro
                      </p>
                      <label className="mx-auto mt-3 block max-w-sm text-left text-xs text-slate-700">
                        <span className="mb-1 block font-medium text-slate-800">URL do YouTube</span>
                        <input
                          type="url"
                          value={ytUrl}
                          onChange={(e) => setYtUrl(e.target.value)}
                          placeholder="https://www.youtube.com/watch?v=…"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
                          disabled={saving}
                        />
                      </label>
                      <div className="mx-auto mt-2 grid max-w-sm gap-2 sm:grid-cols-2">
                        <label className="block text-xs text-slate-700">
                          <span className="mb-1 block font-medium text-slate-800">Título (opcional)</span>
                          <input
                            type="text"
                            value={ytTitle}
                            onChange={(e) => setYtTitle(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
                            disabled={saving}
                          />
                        </label>
                        <label className="block text-xs text-slate-700">
                          <span className="mb-1 block font-medium text-slate-800">Artista (opcional)</span>
                          <input
                            type="text"
                            value={ytArtist}
                            onChange={(e) => setYtArtist(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
                            disabled={saving}
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex justify-center">
                        <button
                          type="button"
                          disabled={saving || !String(ytUrl || '').trim()}
                          onClick={addYoutubeTrack}
                          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          Adicionar vídeo
                        </button>
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
                        className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${
                          trDragFrom === index ? 'ring-2 ring-amber-400' : ''
                        } ${!saving ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
                          {index + 1}
                        </span>
                        {t.cover_url ? (
                          <div className="radio-cover-frame relative w-12 shrink-0 rounded-lg bg-slate-100 sm:w-14">
                            <img
                              key={`track-cover-${t.id}-${t.cover_url}-${String(t.updated_at ?? '')}`}
                              src={trackCoverImgSrc(t)}
                              alt=""
                              loading="eager"
                              decoding="async"
                            />
                          </div>
                        ) : (
                          <div className="radio-cover-frame w-12 shrink-0 rounded-lg bg-slate-100 sm:w-14" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900">{t.title}</p>
                          <p className="truncate text-xs text-slate-500">
                            {t.artist || '—'} · {fmtDur(t.duration_sec)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            {!t.youtube_video_id ? (
                              <button
                                type="button"
                                className="text-xs font-medium text-slate-700 hover:underline"
                                disabled={saving}
                                onClick={() => regenerateTrackCover(t)}
                              >
                                Nova capa
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">Capa: YouTube</span>
                            )}
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
