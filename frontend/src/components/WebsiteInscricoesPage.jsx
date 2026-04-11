import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE, fetchWithAuth, throwIfHtmlOrCannotPost } from '../apiConfig';

const APPLICATIONS_ADMIN = `${API_BASE}/website/applications/admin`;

function formatListDate(iso) {
  if (iso == null || iso === '') return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pt-BR');
}

function formatCityState(row) {
  const c = row?.city != null ? String(row.city).trim() : '';
  const s = row?.state != null ? String(row.state).trim() : '';
  if (c && s) return `${c} / ${s}`;
  if (c) return c;
  if (s) return s;
  return '—';
}

/** URLs de fotos (apenas strings; ignora thumb_url e campos técnicos). */
function photoUrlsFromItem(item) {
  if (!item || !Array.isArray(item.photos)) return [];
  return item.photos
    .map((p) => {
      if (typeof p === 'string') return p.trim();
      if (p && typeof p === 'object' && typeof p.url === 'string') return p.url.trim();
      return '';
    })
    .filter(Boolean);
}

function FieldRow({ label, value }) {
  const v = value != null && String(value).trim() !== '' ? String(value) : '—';
  return (
    <div className="grid gap-1 border-b border-slate-100 py-2.5 sm:grid-cols-[120px_1fr]">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{v}</dd>
    </div>
  );
}

export default function WebsiteInscricoesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [notes, setNotes] = useState('');
  const [mutationLoading, setMutationLoading] = useState(false);
  const [mutationError, setMutationError] = useState('');
  /** Índice na grelha ou null se o lightbox estiver fechado */
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const load = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    if (!silent) setLoading(true);
    setError('');
    try {
      const r = await fetchWithAuth(APPLICATIONS_ADMIN);
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
      if (!Array.isArray(data)) throw new Error('Lista de inscrições inválida.');
      setRows(data);
      return data;
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao carregar.');
      setRows([]);
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
  }, [rows]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detail) {
      setNotes('');
      return;
    }
    const n = detail.notes || detail.feedback || detail.internal_notes || '';
    setNotes(n != null ? String(n) : '');
    setMutationError('');
  }, [detail]);

  useEffect(() => {
    if (!detail && lightboxIndex === null) return undefined;
    const onKey = (e) => {
      if (lightboxIndex !== null && detail) {
        const urls = photoUrlsFromItem(detail);
        if (e.key === 'Escape') {
          e.preventDefault();
          setLightboxIndex(null);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setLightboxIndex((i) => (i != null && i > 0 ? i - 1 : i));
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setLightboxIndex((i) => {
            if (i == null) return i;
            return i < urls.length - 1 ? i + 1 : i;
          });
        }
        return;
      }
      if (e.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, lightboxIndex]);

  const refreshAndReselect = useCallback(
    async (id) => {
      const list = await load({ silent: true });
      if (id == null) return;
      const found = list?.find((x) => x != null && String(x.id) === String(id));
      setDetail(found || null);
    },
    [load],
  );

  const saveNotesPatch = async (item) => {
    const prev =
      item.notes != null
        ? String(item.notes)
        : item.feedback != null
          ? String(item.feedback)
          : item.internal_notes != null
            ? String(item.internal_notes)
            : '';
    if (notes === prev) return;
    setMutationLoading(true);
    setMutationError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/website/applications/admin/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ notes }),
      });
      const raw = await r.text();
      throwIfHtmlOrCannotPost(raw, r.status);
      let data;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (!r.ok) {
        const msg =
          data && typeof data.message === 'string'
            ? data.message
            : data && typeof data.error === 'string'
              ? data.error
              : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      await refreshAndReselect(item.id);
    } catch (e) {
      setMutationError(e?.message ? String(e.message) : 'Erro ao guardar notas.');
    } finally {
      setMutationLoading(false);
    }
  };

  const handleNotesBlur = () => {
    if (!detail) return;
    saveNotesPatch(detail);
  };

  const handleDelete = () => {
    if (!detail) return;
    if (!confirm('Tem certeza que deseja excluir esta inscrição?')) return;
    const id = detail.id;
    (async () => {
      setMutationLoading(true);
      setMutationError('');
      try {
        const r = await fetchWithAuth(`${APPLICATIONS_ADMIN}/${encodeURIComponent(String(id))}`, {
          method: 'DELETE',
          Accept: 'application/json',
        });
        const raw = await r.text();
        throwIfHtmlOrCannotPost(raw, r.status);
        if (!r.ok && r.status !== 204) {
          let data;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = null;
          }
          const msg =
            data && typeof data.message === 'string'
              ? data.message
              : data && typeof data.error === 'string'
                ? data.error
                : `HTTP ${r.status}`;
          throw new Error(msg);
        }
        setDetail(null);
        setLightboxIndex(null);
        await load({ silent: true });
      } catch (e) {
        setMutationError(e?.message ? String(e.message) : 'Erro ao excluir.');
      } finally {
        setMutationLoading(false);
      }
    })();
  };

  const modalPhotos = detail ? photoUrlsFromItem(detail) : [];

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Inscrições</h3>
          <p className="mt-1 text-sm text-slate-500">
            Caixa de entrada das candidaturas enviadas pelo site.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Atualizar
        </button>
      </div>

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-slate-500">A carregar…</p>
        ) : error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : sortedRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
            Nenhuma inscrição.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full min-w-[400px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-2.5">Nome</th>
                  <th className="px-3 py-2.5">Cidade / estado</th>
                  <th className="px-3 py-2.5">Data</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const isNew = String(row.status || '').trim() === 'new';
                  return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetail(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setDetail(row);
                        }
                      }}
                      className={`cursor-pointer border-b border-slate-100 transition-colors last:border-b-0 ${
                        isNew
                          ? 'bg-slate-100/95 text-slate-900 shadow-[inset_3px_0_0_0_rgb(245,158,11)] hover:bg-slate-100'
                          : 'bg-white hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="px-3 py-2.5 font-medium">{row.name != null ? String(row.name) : '—'}</td>
                      <td className="px-3 py-2.5 text-slate-700">{formatCityState(row)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{formatListDate(row.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Painel lateral — detalhe */}
      {detail ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inscricao-detail-title"
          onClick={() => setDetail(null)}
        >
          <div
            className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl sm:max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
              <h4 id="inscricao-detail-title" className="pr-2 text-base font-semibold text-slate-900">
                {detail.name ? String(detail.name) : 'Inscrição'}
              </h4>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={mutationLoading}
                  onClick={handleDelete}
                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Excluir
                </button>
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {mutationError ? (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {mutationError}
                </p>
              ) : null}

              <dl>
                <FieldRow label="Nome" value={detail.name} />
                <FieldRow label="Idade" value={detail.age} />
                <FieldRow label="Altura" value={detail.height} />
                <FieldRow label="Cidade / estado" value={formatCityState(detail)} />
                <FieldRow label="E-mail" value={detail.email} />
                <FieldRow label="Telefone" value={detail.phone} />
                <FieldRow label="Instagram" value={detail.instagram} />
                <FieldRow label="Data" value={formatListDate(detail.created_at)} />
              </dl>

              {modalPhotos.length > 0 ? (
                <div className="mt-6 border-t border-slate-100 pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Fotos</p>
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                    {modalPhotos.map((src, i) => (
                      <button
                        key={`${src}-${i}`}
                        type="button"
                        onClick={() => setLightboxIndex(i)}
                        className="relative aspect-[3/4] overflow-hidden rounded-md border border-slate-200 bg-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        <img
                          src={src}
                          alt=""
                          className="h-full w-full object-cover object-top"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-6 border-t border-slate-100 pt-4">
                <label htmlFor="inscricao-notas" className="mb-1 block text-sm font-medium text-slate-700">
                  Notas internas
                </label>
                <p className="mb-2 text-xs text-slate-500">Guardadas automaticamente ao sair do campo.</p>
                <textarea
                  id="inscricao-notas"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={handleNotesBlur}
                  disabled={mutationLoading}
                  rows={4}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Lightbox — por cima do painel */}
      {detail && lightboxIndex !== null && modalPhotos[lightboxIndex] ? (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/92"
          role="presentation"
          onClick={() => setLightboxIndex(null)}
        >
          <div className="flex items-center justify-between px-3 py-2 text-white">
            <span className="text-sm opacity-80">
              {lightboxIndex + 1} / {modalPhotos.length}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(null);
              }}
              className="rounded-lg px-3 py-2 text-lg font-light hover:bg-white/10"
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>
          <div className="relative flex flex-1 items-center justify-center px-2 pb-8 pt-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={lightboxIndex <= 0}
              onClick={() => setLightboxIndex((i) => (i != null && i > 0 ? i - 1 : i))}
              className="absolute left-2 z-10 rounded-full bg-white/15 px-3 py-3 text-white hover:bg-white/25 disabled:opacity-30"
              aria-label="Anterior"
            >
              ←
            </button>
            <img
              src={modalPhotos[lightboxIndex]}
              alt=""
              className="max-h-[min(80vh,calc(100vw-8rem))] max-w-full object-contain"
            />
            <button
              type="button"
              disabled={lightboxIndex >= modalPhotos.length - 1}
              onClick={() =>
                setLightboxIndex((i) =>
                  i != null && i < modalPhotos.length - 1 ? i + 1 : i,
                )
              }
              className="absolute right-2 z-10 rounded-full bg-white/15 px-3 py-3 text-white hover:bg-white/25 disabled:opacity-30"
              aria-label="Próximo"
            >
              →
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
