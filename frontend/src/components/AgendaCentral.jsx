import { useCallback, useEffect, useMemo, useState } from 'react';

const API_REQUEST_MS = 25_000;

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), API_REQUEST_MS);
  return fetch(url, { credentials: 'include', ...options, signal: controller.signal }).finally(() => {
    clearTimeout(id);
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymdFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function mondayPadFirstOfMonth(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  return (first.getDay() + 6) % 7;
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addMonths(year, monthIndex, delta) {
  const d = new Date(year, monthIndex + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

const MANUAL_TIPOS = [
  { value: 'compromisso', label: 'Compromisso' },
  { value: 'casting', label: 'Casting' },
  { value: 'reuniao', label: 'Reunião' },
];

const statusLabel = (s) => {
  if (s === 'confirmado') return 'Confirmado';
  if (s === 'recusado') return 'Recusado';
  if (s === 'enviado') return 'Enviado';
  return 'Pendente';
};

const statusBadge = (s) => {
  if (s === 'confirmado') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (s === 'recusado') return 'border-rose-200 bg-rose-50 text-rose-900';
  if (s === 'enviado') return 'border-sky-200 bg-sky-50 text-sky-900';
  return 'border-amber-200 bg-amber-50 text-amber-900';
};

export default function AgendaCentral({ apiBase }) {
  const hoje = useMemo(() => ymdFromDate(new Date()), []);
  const [cursorY, setCursorY] = useState(() => new Date().getFullYear());
  const [cursorM, setCursorM] = useState(() => new Date().getMonth());
  const [selectedYmd, setSelectedYmd] = useState(hoje);
  const [filtrarDia, setFiltrarDia] = useState(false);

  const [events, setEvents] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState('');
  const [globalMsg, setGlobalMsg] = useState('');
  const [globalErr, setGlobalErr] = useState('');

  const [expandedId, setExpandedId] = useState(null);
  const [detailById, setDetailById] = useState({});
  const [obsDraftById, setObsDraftById] = useState({});
  const [models, setModels] = useState([]);
  const [substituirByPresenca, setSubstituirByPresenca] = useState({});
  const [actionLoadingKey, setActionLoadingKey] = useState('');

  const [novoOpen, setNovoOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState({
    manual_tipo: 'compromisso',
    data_evento: hoje,
    hora_evento: '',
    local_evento: '',
    observacoes_manual: '',
    link_mapa: '',
  });

  const range = useMemo(() => {
    const dim = daysInMonth(cursorY, cursorM);
    return {
      from: `${cursorY}-${pad2(cursorM + 1)}-01`,
      to: `${cursorY}-${pad2(cursorM + 1)}-${pad2(dim)}`,
      dim,
    };
  }, [cursorY, cursorM]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda?from=${range.from}&to=${range.to}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Erro ao carregar agenda.');
      setEvents(Array.isArray(data) ? data : []);
    } catch (e) {
      setEvents([]);
      setListError(e?.message || 'Falha ao carregar.');
    } finally {
      setLoadingList(false);
    }
  }, [apiBase, range.from, range.to]);

  const loadModels = useCallback(async () => {
    try {
      const r = await fetchWithTimeout(`${apiBase}/modelos`);
      const data = await r.json();
      if (!r.ok) return;
      setModels(Array.isArray(data) ? data : []);
    } catch {
      setModels([]);
    }
  }, [apiBase]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (selectedYmd < range.from || selectedYmd > range.to) setSelectedYmd(range.from);
  }, [range.from, range.to, selectedYmd]);

  const byDay = useMemo(() => {
    const out = new Map();
    for (const ev of events) {
      const key = String(ev.data_evento || '').slice(0, 10);
      if (!key) continue;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(ev);
    }
    return out;
  }, [events]);

  const calendarCells = useMemo(() => {
    const pad = mondayPadFirstOfMonth(cursorY, cursorM);
    const cells = [];
    let i = 1 - pad;
    while (cells.length < 42) {
      if (i >= 1 && i <= range.dim) {
        const ymd = `${cursorY}-${pad2(cursorM + 1)}-${pad2(i)}`;
        cells.push({ type: 'in', d: i, ymd, count: (byDay.get(ymd) || []).length });
      } else {
        cells.push({ type: 'out' });
      }
      i += 1;
    }
    return cells;
  }, [byDay, cursorM, cursorY, range.dim]);

  const osRows = useMemo(() => {
    const rows = events.filter((ev) => ev.source === 'os');
    const base = filtrarDia ? rows.filter((ev) => String(ev.data_evento).slice(0, 10) === selectedYmd) : rows;
    return base.sort((a, b) => {
      const ad = String(a.data_evento || '');
      const bd = String(b.data_evento || '');
      if (ad !== bd) return ad.localeCompare(bd);
      return String(a.hora_evento || '').localeCompare(String(b.hora_evento || ''));
    });
  }, [events, filtrarDia, selectedYmd]);

  const monthTitle = new Date(cursorY, cursorM, 1).toLocaleDateString('pt-BR', {
    month: 'short',
    year: 'numeric',
  });

  const openExpand = async (eventId) => {
    setGlobalErr('');
    if (expandedId === eventId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(eventId);
    if (detailById[eventId]) return;
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/eventos/${eventId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Erro ao abrir detalhe.');
      setDetailById((prev) => ({ ...prev, [eventId]: data }));
      setObsDraftById((prev) => ({ ...prev, [eventId]: data?.evento?.observacoes_extras || '' }));
    } catch (e) {
      setGlobalErr(e?.message || 'Falha no detalhe.');
    }
  };

  const saveObs = async (eventId) => {
    setActionLoadingKey(`obs-${eventId}`);
    setGlobalErr('');
    setGlobalMsg('');
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/eventos/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observacoes_extras: obsDraftById[eventId] || '' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Erro ao salvar observações.');
      setGlobalMsg('Observações extras salvas.');
      await loadList();
      setDetailById((prev) => ({
        ...prev,
        [eventId]: {
          ...(prev[eventId] || {}),
          evento: { ...(prev[eventId]?.evento || {}), observacoes_extras: obsDraftById[eventId] || '' },
        },
      }));
    } catch (e) {
      setGlobalErr(e?.message || 'Falha ao salvar.');
    } finally {
      setActionLoadingKey('');
    }
  };

  const enviarModelo = async (eventId, presencaId) => {
    setActionLoadingKey(`send-${presencaId}`);
    setGlobalErr('');
    setGlobalMsg('');
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/enviar-modelo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, presenca_id: presencaId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Falha ao enviar.');
      setGlobalMsg(data.message || 'Enviado.');
      await loadList();
      if (detailById[eventId]) {
        const rd = await fetchWithTimeout(`${apiBase}/agenda/eventos/${eventId}`);
        const dd = await rd.json();
        if (rd.ok) setDetailById((prev) => ({ ...prev, [eventId]: dd }));
      }
    } catch (e) {
      setGlobalErr(e?.message || 'Erro no envio.');
    } finally {
      setActionLoadingKey('');
    }
  };

  const confirmarManual = async (eventId, presencaId) => {
    setActionLoadingKey(`confirm-${presencaId}`);
    setGlobalErr('');
    setGlobalMsg('');
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/presenca/${presencaId}/confirmar-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Falha na confirmação manual.');
      setGlobalMsg('Modelo marcado como confirmado.');
      await loadList();
      if (detailById[eventId]) {
        const rd = await fetchWithTimeout(`${apiBase}/agenda/eventos/${eventId}`);
        const dd = await rd.json();
        if (rd.ok) setDetailById((prev) => ({ ...prev, [eventId]: dd }));
      }
    } catch (e) {
      setGlobalErr(e?.message || 'Erro ao confirmar.');
    } finally {
      setActionLoadingKey('');
    }
  };

  const substituirModelo = async (eventId, presencaId) => {
    const modeloId = Number(substituirByPresenca[presencaId]);
    if (!Number.isFinite(modeloId) || modeloId <= 0) {
      setGlobalErr('Escolha o novo modelo antes de substituir.');
      return;
    }
    setActionLoadingKey(`swap-${presencaId}`);
    setGlobalErr('');
    setGlobalMsg('');
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/presenca/${presencaId}/substituir-modelo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelo_id: modeloId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Falha ao substituir modelo.');
      setGlobalMsg('Modelo substituído. Reenvie para o novo modelo.');
      await loadList();
      const rd = await fetchWithTimeout(`${apiBase}/agenda/eventos/${eventId}`);
      const dd = await rd.json();
      if (rd.ok) setDetailById((prev) => ({ ...prev, [eventId]: dd }));
      setSubstituirByPresenca((prev) => ({ ...prev, [presencaId]: '' }));
    } catch (e) {
      setGlobalErr(e?.message || 'Erro ao substituir.');
    } finally {
      setActionLoadingKey('');
    }
  };

  const criarManual = async (e) => {
    e.preventDefault();
    setGlobalErr('');
    setGlobalMsg('');
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/eventos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualDraft),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Não foi possível criar evento manual.');
      setNovoOpen(false);
      setGlobalMsg('Evento manual criado.');
      await loadList();
      setManualDraft({
        manual_tipo: 'compromisso',
        data_evento: selectedYmd,
        hora_evento: '',
        local_evento: '',
        observacoes_manual: '',
        link_mapa: '',
      });
    } catch (e2) {
      setGlobalErr(e2?.message || 'Falha ao criar evento manual.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Agenda operacional</h3>
            <p className="text-xs text-slate-500">Lista direta de jobs (O.S.) com ações por modelo sem trocar de tela.</p>
          </div>
          <button
            type="button"
            onClick={() => setNovoOpen(true)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            Novo evento manual
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const { y, m } = addMonths(cursorY, cursorM, -1);
                  setCursorY(y);
                  setCursorM(m);
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => {
                  const { y, m } = addMonths(cursorY, cursorM, 1);
                  setCursorY(y);
                  setCursorM(m);
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                ›
              </button>
              <span className="text-sm font-medium capitalize text-slate-700">{monthTitle}</span>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={filtrarDia} onChange={(e) => setFiltrarDia(e.target.checked)} />
              Filtrar pelo dia do calendário
            </label>
          </div>

          {listError ? <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{listError}</p> : null}
          {globalErr ? <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{globalErr}</p> : null}
          {globalMsg ? <p className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{globalMsg}</p> : null}

          <div className="space-y-2">
            {loadingList ? (
              <p className="text-sm text-slate-500">Carregando jobs…</p>
            ) : osRows.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum job no filtro atual.</p>
            ) : (
              osRows.map((row) => {
                const expanded = expandedId === row.id;
                const detail = detailById[row.id];
                return (
                  <div key={row.id} className="rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => openExpand(row.id)}
                      className="w-full px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <div className="grid gap-2 md:grid-cols-[110px_110px_minmax(120px,1fr)_minmax(120px,1fr)]">
                        <div className="text-sm">
                          <p className="text-[11px] text-slate-500">Data</p>
                          <p className="font-medium">{String(row.data_evento || '').slice(0, 10) || '—'}</p>
                        </div>
                        <div className="text-sm">
                          <p className="text-[11px] text-slate-500">Horário</p>
                          <p className="font-medium">{row.hora_evento || '—'}</p>
                        </div>
                        <div className="text-sm">
                          <p className="text-[11px] text-slate-500">Cliente</p>
                          <p className="font-medium">{row.cliente_nome || '—'}</p>
                        </div>
                        <div className="text-sm">
                          <p className="text-[11px] text-slate-500">Tipo</p>
                          <p className="font-medium">{row.tipo_trabalho || '—'}</p>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-500">Modelos:</span>
                        {(row.presencas || []).map((p) => (
                          <span key={p.id} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadge(p.status)}`}>
                            {p.modelo_nome}: {statusLabel(p.status)}
                          </span>
                        ))}
                      </div>
                    </button>

                    <div className="border-t border-slate-100 px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {(row.presencas || []).map((p) => {
                          const sendLabel = p.enviado_em ? 'Reenviar' : 'Enviar para modelo';
                          return (
                            <div key={p.id} className="rounded-lg border border-slate-200 p-2">
                              <p className="mb-1 text-xs font-medium text-slate-700">{p.modelo_nome}</p>
                              <div className="flex flex-wrap gap-1">
                                <button
                                  type="button"
                                  onClick={() => enviarModelo(row.id, p.id)}
                                  disabled={actionLoadingKey === `send-${p.id}`}
                                  className="rounded bg-orange-500 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                                >
                                  {actionLoadingKey === `send-${p.id}` ? 'Enviando…' : sendLabel}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => confirmarManual(row.id, p.id)}
                                  disabled={actionLoadingKey === `confirm-${p.id}`}
                                  className="rounded border border-emerald-300 px-2 py-1 text-[11px] text-emerald-800 disabled:opacity-60"
                                >
                                  {actionLoadingKey === `confirm-${p.id}` ? 'Salvando…' : 'Confirmar manual'}
                                </button>
                              </div>
                              <div className="mt-1 flex gap-1">
                                <select
                                  value={substituirByPresenca[p.id] || ''}
                                  onChange={(e) =>
                                    setSubstituirByPresenca((prev) => ({ ...prev, [p.id]: e.target.value }))
                                  }
                                  className="rounded border border-slate-300 px-1 py-1 text-[11px]"
                                >
                                  <option value="">Substituir modelo…</option>
                                  {models.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.nome || `Modelo #${m.id}`}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => substituirModelo(row.id, p.id)}
                                  disabled={actionLoadingKey === `swap-${p.id}`}
                                  className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 disabled:opacity-60"
                                >
                                  {actionLoadingKey === `swap-${p.id}` ? 'Trocando…' : 'Trocar'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {expanded ? (
                      <div className="border-t border-slate-200 bg-slate-50 px-3 py-3">
                        {!detail ? (
                          <p className="text-xs text-slate-500">Carregando detalhe…</p>
                        ) : (
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <p className="text-xs font-semibold text-slate-600">Observações extras</p>
                              <textarea
                                rows={4}
                                value={obsDraftById[row.id] || ''}
                                onChange={(e) =>
                                  setObsDraftById((prev) => ({ ...prev, [row.id]: e.target.value }))
                                }
                                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => saveObs(row.id)}
                                disabled={actionLoadingKey === `obs-${row.id}`}
                                className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                              >
                                {actionLoadingKey === `obs-${row.id}` ? 'Salvando…' : 'Salvar observações'}
                              </button>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-slate-600">Histórico de envio/status</p>
                              <ul className="mt-1 max-h-36 overflow-auto space-y-1 text-[11px] text-slate-700">
                                {(detail.historico || []).length === 0 ? (
                                  <li className="text-slate-500">Sem histórico.</li>
                                ) : (
                                  detail.historico.map((h) => (
                                    <li key={h.id}>
                                      {new Date(h.created_at).toLocaleString('pt-BR')} — {h.tipo}: {h.detalhe}
                                    </li>
                                  ))
                                )}
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Calendário (filtro)</p>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-500">
            {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
              <div key={`${d}-${i}`}>{d}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {calendarCells.map((c, idx) =>
              c.type === 'out' ? (
                <div key={idx} className="h-7 rounded bg-slate-50" />
              ) : (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setSelectedYmd(c.ymd);
                    setFiltrarDia(true);
                  }}
                  className={`h-7 rounded border text-[11px] ${
                    selectedYmd === c.ymd ? 'border-orange-400 bg-orange-50 font-semibold text-orange-900' : 'border-slate-200'
                  }`}
                  title={`${c.count} evento(s)`}
                >
                  {c.d}
                </button>
              ),
            )}
          </div>
          <button
            type="button"
            onClick={() => setFiltrarDia(false)}
            className="mt-2 w-full rounded border border-slate-300 py-1 text-xs"
          >
            Mostrar todo o mês
          </button>
        </aside>
      </div>

      {novoOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Novo evento manual</h3>
            <form className="mt-4 space-y-3 text-sm" onSubmit={criarManual}>
              <label className="block">
                <span className="text-xs text-slate-500">Tipo</span>
                <select
                  value={manualDraft.manual_tipo}
                  onChange={(e) => setManualDraft((p) => ({ ...p, manual_tipo: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
                >
                  {MANUAL_TIPOS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Data</span>
                <input
                  type="date"
                  required
                  value={manualDraft.data_evento}
                  onChange={(e) => setManualDraft((p) => ({ ...p, data_evento: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Horário</span>
                <input
                  value={manualDraft.hora_evento}
                  onChange={(e) => setManualDraft((p) => ({ ...p, hora_evento: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Local</span>
                <input
                  value={manualDraft.local_evento}
                  onChange={(e) => setManualDraft((p) => ({ ...p, local_evento: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Observações</span>
                <textarea
                  value={manualDraft.observacoes_manual}
                  onChange={(e) => setManualDraft((p) => ({ ...p, observacoes_manual: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNovoOpen(false)}
                  className="flex-1 rounded border border-slate-300 py-2"
                >
                  Cancelar
                </button>
                <button type="submit" className="flex-1 rounded bg-slate-900 py-2 font-medium text-white">
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
