import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE, fetchWithAuth, throwIfHtmlOrCannotPost } from '../apiConfig';

/**
 * Proxy no backend CRM → GET/PATCH/DELETE no site.
 * O Bearer (ADMIN_SECRET) é aplicado só no servidor (websiteModels.js).
 */
const APPLICATIONS_ADMIN = `${API_BASE}/website/applications/admin`;

const STATUS_VALUES = ['new', 'reviewing', 'approved', 'rejected'];

const STATUS_LABEL_PT = {
  new: 'Novo',
  reviewing: 'Avaliado',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

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

function statusLabelPt(status) {
  if (status == null || status === '') return '—';
  const k = String(status).trim();
  return STATUS_LABEL_PT[k] || k;
}

/**
 * Todos os campos do objeto tal como na API (chave = nome original).
 * photos: grelha; resto: texto ou JSON.
 */
function ApplicationAllFieldsReadonly({ item }) {
  if (!item || typeof item !== 'object') return null;
  const keys = Object.keys(item).sort((a, b) => a.localeCompare(b));
  return (
    <dl className="grid gap-2 text-sm">
      {keys.map((key) => {
        const val = item[key];
        if (key === 'photos' && Array.isArray(val)) {
          return (
            <div
              key={key}
              className="grid gap-1 border-b border-slate-100 py-2 sm:grid-cols-[minmax(140px,200px)_1fr]"
            >
              <dt className="font-mono text-xs font-medium text-slate-600">{key}</dt>
              <dd className="min-w-0 text-slate-800">
                {val.length === 0 ? (
                  '—'
                ) : (
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {val.map((url, i) => {
                      const src = url != null ? String(url).trim() : '';
                      if (!src) return null;
                      return (
                        <li key={`${src}-${i}`} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          <a href={src} target="_blank" rel="noopener noreferrer" className="block">
                            <img src={src} alt="" className="h-36 w-full object-cover object-top" loading="lazy" />
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </dd>
            </div>
          );
        }
        let display;
        if (val === null || val === undefined) {
          display = '—';
        } else if (Array.isArray(val)) {
          display = (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs">
              {JSON.stringify(val, null, 2)}
            </pre>
          );
        } else if (typeof val === 'object') {
          display = (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs">
              {JSON.stringify(val, null, 2)}
            </pre>
          );
        } else {
          const s = String(val);
          const d = new Date(s);
          if (
            (key === 'created_at' || key.endsWith('_at')) &&
            !Number.isNaN(d.getTime()) &&
            s.length >= 8
          ) {
            display = d.toLocaleString('pt-BR');
          } else {
            display = s;
          }
        }
        return (
          <div
            key={key}
            className="grid gap-1 border-b border-slate-100 py-2 sm:grid-cols-[minmax(140px,200px)_1fr]"
          >
            <dt className="font-mono text-xs font-medium text-slate-600">{key}</dt>
            <dd className="min-w-0 break-words text-slate-800">{display}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export default function WebsiteInscricoesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoria, setCategoria] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [detail, setDetail] = useState(null);
  const [notes, setNotes] = useState('');
  const [mutationLoading, setMutationLoading] = useState(false);
  const [mutationError, setMutationError] = useState('');

  const querySuffix = useMemo(() => {
    const params = new URLSearchParams();
    if (categoria === 'women' || categoria === 'men') params.set('category', categoria);
    if (statusFilter !== 'todos' && STATUS_VALUES.includes(statusFilter)) params.set('status', statusFilter);
    const q = params.toString();
    return q ? `?${q}` : '';
  }, [categoria, statusFilter]);

  const load = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    if (!silent) setLoading(true);
    setError('');
    try {
      const url = `${APPLICATIONS_ADMIN}${querySuffix}`;
      const r = await fetchWithAuth(url);
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
  }, [querySuffix]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detail) {
      setNotes('');
      return;
    }
    // eslint-disable-next-line no-console -- pedido: inspecionar payload real da API
    console.log('INSCRICAO COMPLETA:', detail);
    const n = detail.notes || detail.feedback || detail.internal_notes || '';
    setNotes(n != null ? String(n) : '');
    setMutationError('');
  }, [detail]);

  useEffect(() => {
    if (!detail) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  const refreshAndReselect = useCallback(
    async (id) => {
      const list = await load({ silent: true });
      if (id == null) return;
      const found = list?.find((x) => x != null && String(x.id) === String(id));
      setDetail(found || null);
    },
    [load],
  );

  const patchApplication = async (id, body) => {
    setMutationLoading(true);
    setMutationError('');
    try {
      const r = await fetchWithAuth(`${APPLICATIONS_ADMIN}/${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
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
      await refreshAndReselect(id);
    } catch (e) {
      setMutationError(e?.message ? String(e.message) : 'Erro ao atualizar.');
    } finally {
      setMutationLoading(false);
    }
  };

  const handleStatus = (status) => {
    if (!detail) return;
    patchApplication(detail.id, { status });
  };

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
    if (!confirm('Tem certeza que deseja apagar esta inscrição?')) return;
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
        await load({ silent: true });
      } catch (e) {
        setMutationError(e?.message ? String(e.message) : 'Erro ao apagar.');
      } finally {
        setMutationLoading(false);
      }
    })();
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Inscrições</h3>
          <p className="mt-1 text-sm text-slate-500">
            Mesma origem que a administração do site:{' '}
            <code className="rounded bg-slate-100 px-1">GET /api/applications/admin</code> em{' '}
            <span className="whitespace-nowrap">www.andymodels.com</span> (via proxy do CRM com{' '}
            <code className="rounded bg-slate-100 px-1">ADMIN_SECRET</code>).
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

      <div className="mt-6 space-y-6">
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Categoria</p>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {[
                { id: 'todos', label: 'Todos' },
                { id: 'women', label: 'Feminino' },
                { id: 'men', label: 'Masculino' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCategoria(id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    categoria === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
            <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {[
                { id: 'todos', label: 'Todos' },
                { id: 'new', label: 'Novos' },
                { id: 'reviewing', label: 'Avaliados' },
                { id: 'approved', label: 'Aprovados' },
                { id: 'rejected', label: 'Rejeitados' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatusFilter(id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    statusFilter === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">A carregar…</p>
        ) : error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
            Nenhuma inscrição encontrada com estes filtros.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Cidade</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-slate-100 hover:bg-amber-50/50"
                    onClick={() => setDetail(row)}
                  >
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {row.name != null ? String(row.name) : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{formatListDate(row.created_at)}</td>
                    <td className="px-3 py-2 text-slate-600">{formatCityState(row)}</td>
                    <td className="px-3 py-2 text-slate-600">{statusLabelPt(row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inscricao-detail-title"
          onClick={() => setDetail(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <h4 id="inscricao-detail-title" className="text-base font-semibold text-slate-900">
                Inscrição #{detail.id}
                {detail.name ? ` — ${detail.name}` : ''}
              </h4>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>
            <div className="space-y-4 p-4">
              {mutationError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {mutationError}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-4">
                <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Alterar status</span>
                {STATUS_VALUES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={mutationLoading}
                    onClick={() => handleStatus(s)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                      String(detail.status) === s
                        ? 'border-amber-600 bg-amber-500 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    } disabled:opacity-50`}
                  >
                    {STATUS_LABEL_PT[s]}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={mutationLoading}
                  onClick={handleDelete}
                  className="ml-auto rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Apagar inscrição
                </button>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Campos (como na API)
                </p>
                <ApplicationAllFieldsReadonly item={detail} />
              </div>

              <div>
                <label htmlFor="inscricao-notas" className="mb-1 block text-sm font-medium text-slate-700">
                  Notas internas
                </label>
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
    </section>
  );
}
