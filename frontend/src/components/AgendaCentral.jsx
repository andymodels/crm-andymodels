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

/** Segunda = coluna 0 */
function mondayPadFirstOfMonth(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const dow = first.getDay();
  return (dow + 6) % 7;
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

const labelPresenca = (s) => {
  if (s === 'confirmado') return 'Confirmado';
  if (s === 'recusado') return 'Recusado';
  return 'Pendente';
};

const badgePresenca = (s) => {
  if (s === 'confirmado') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (s === 'recusado') return 'border-rose-200 bg-rose-50 text-rose-900';
  return 'border-amber-200 bg-amber-50 text-amber-900';
};

export default function AgendaCentral({ apiBase }) {
  const hoje = useMemo(() => ymdFromDate(new Date()), []);
  const [cursorY, setCursorY] = useState(() => new Date().getFullYear());
  const [cursorM, setCursorM] = useState(() => new Date().getMonth());

  const range = useMemo(() => {
    const dim = daysInMonth(cursorY, cursorM);
    const from = `${cursorY}-${pad2(cursorM + 1)}-01`;
    const to = `${cursorY}-${pad2(cursorM + 1)}-${pad2(dim)}`;
    return { from, to, dim };
  }, [cursorY, cursorM]);

  const [selectedYmd, setSelectedYmd] = useState(hoje);
  const [events, setEvents] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState('');

  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [obsExtrasDraft, setObsExtrasDraft] = useState('');
  const [manualDraft, setManualDraft] = useState({
    manual_tipo: 'compromisso',
    data_evento: hoje,
    hora_evento: '',
    local_evento: '',
    observacoes_manual: '',
    link_mapa: '',
  });
  const [saveMsg, setSaveMsg] = useState('');
  const [saveErr, setSaveErr] = useState('');

  const [novoOpen, setNovoOpen] = useState(false);
  const [envioPreview, setEnvioPreview] = useState({ presencaId: null, text: '' });
  const [enviandoId, setEnviandoId] = useState(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const r = await fetchWithTimeout(
        `${apiBase}/agenda?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      );
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

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    const inMonth =
      selectedYmd >= range.from && selectedYmd <= range.to;
    if (!inMonth) {
      setSelectedYmd(range.from);
    }
  }, [range.from, range.to, selectedYmd]);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const ev of events) {
      const day = ev.data_evento;
      if (!day) continue;
      const key = String(day).slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(ev);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => String(a.hora_evento || '').localeCompare(String(b.hora_evento || '')));
    }
    return m;
  }, [events]);

  const calendarCells = useMemo(() => {
    const pad = mondayPadFirstOfMonth(cursorY, cursorM);
    const dim = range.dim;
    const cells = [];
    let i = 1 - pad;
    while (cells.length < 42) {
      if (i >= 1 && i <= dim) {
        const ymd = `${cursorY}-${pad2(cursorM + 1)}-${pad2(i)}`;
        cells.push({ type: 'in', d: i, ymd, count: (byDay.get(ymd) || []).length });
      } else {
        cells.push({ type: 'out' });
      }
      i += 1;
    }
    return cells;
  }, [byDay, cursorM, cursorY, range.dim]);

  const dayEvents = byDay.get(selectedYmd) || [];

  const openDetail = async (id) => {
    setDetailId(id);
    setSaveMsg('');
    setSaveErr('');
    setEnvioPreview({ presencaId: null, text: '' });
    setLoadingDetail(true);
    setDetail(null);
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/eventos/${id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Evento não encontrado.');
      setDetail(data);
      const ev = data.evento;
      if (ev.source === 'os') setObsExtrasDraft(ev.observacoes_extras || '');
      else {
        setManualDraft({
          manual_tipo: ev.manual_tipo || 'compromisso',
          data_evento: ev.data_evento_manual
            ? String(ev.data_evento_manual).slice(0, 10)
            : selectedYmd,
          hora_evento: ev.hora_evento || '',
          local_evento: ev.local_evento || '',
          observacoes_manual: ev.observacoes_manual || '',
          link_mapa: ev.link_mapa || '',
        });
      }
    } catch (e) {
      setSaveErr(e?.message || 'Erro ao abrir evento.');
    } finally {
      setLoadingDetail(false);
    }
  };

  const saveOsObs = async () => {
    if (!detailId) return;
    setSaveMsg('');
    setSaveErr('');
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/eventos/${detailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observacoes_extras: obsExtrasDraft }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Não foi possível salvar.');
      setSaveMsg('Observações extras salvas.');
      await loadList();
      await openDetail(detailId);
    } catch (e) {
      setSaveErr(e?.message || 'Erro ao salvar.');
    }
  };

  const saveManual = async () => {
    if (!detailId) return;
    setSaveMsg('');
    setSaveErr('');
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/eventos/${detailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualDraft),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Não foi possível salvar.');
      setSaveMsg('Evento atualizado.');
      await loadList();
      await openDetail(detailId);
    } catch (e) {
      setSaveErr(e?.message || 'Erro ao salvar.');
    }
  };

  const deleteManual = async () => {
    if (!detailId || !detail?.evento || detail.evento.source !== 'manual') return;
    if (!window.confirm('Excluir este evento manual?')) return;
    setSaveErr('');
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/eventos/${detailId}`, { method: 'DELETE' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Não foi possível excluir.');
      setDetail(null);
      setDetailId(null);
      await loadList();
    } catch (e) {
      setSaveErr(e?.message || 'Erro ao excluir.');
    }
  };

  const criarManual = async (e) => {
    e.preventDefault();
    setSaveErr('');
    try {
      const r = await fetchWithTimeout(`${apiBase}/agenda/eventos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualDraft),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Não foi possível criar.');
      setNovoOpen(false);
      setManualDraft({
        manual_tipo: 'compromisso',
        data_evento: selectedYmd,
        hora_evento: '',
        local_evento: '',
        observacoes_manual: '',
        link_mapa: '',
      });
      await loadList();
      if (data.id) {
        const dia = manualDraft.data_evento;
        setSelectedYmd(dia);
        const y = Number(dia.slice(0, 4));
        const m = Number(dia.slice(5, 7)) - 1;
        if (!Number.isNaN(y) && !Number.isNaN(m)) {
          setCursorY(y);
          setCursorM(m);
        }
        await openDetail(data.id);
      }
    } catch (err) {
      setSaveErr(err?.message || 'Erro ao criar.');
    }
  };

  const enviarModelo = async (presencaId) => {
    if (!detailId) return;
    setEnviandoId(presencaId);
    setSaveErr('');
    try {
      const r = await fetchWithTimeout(
        `${apiBase}/agenda/eventos/${detailId}/presenca/${presencaId}/enviar`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Falha ao gerar mensagem.');
      setEnvioPreview({ presencaId, text: data.mensagem || '' });
      await loadList();
      await openDetail(detailId);
    } catch (err) {
      setSaveErr(err?.message || 'Erro ao enviar.');
    } finally {
      setEnviandoId(null);
    }
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setSaveMsg('Copiado para a área de transferência.');
    } catch {
      setSaveErr('Não foi possível copiar (permissão do navegador).');
    }
  };

  const monthTitle = new Date(cursorY, cursorM, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              onClick={() => {
                const { y, m } = addMonths(cursorY, cursorM, -1);
                setCursorY(y);
                setCursorM(m);
              }}
            >
              ‹ Mês
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              onClick={() => {
                const { y, m } = addMonths(cursorY, cursorM, 1);
                setCursorY(y);
                setCursorM(m);
              }}
            >
              Mês ›
            </button>
            <span className="text-lg font-semibold capitalize text-slate-800">{monthTitle}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSaveErr('');
              setNovoOpen(true);
              setManualDraft({
                manual_tipo: 'compromisso',
                data_evento: selectedYmd,
                hora_evento: '',
                local_evento: '',
                observacoes_manual: '',
                link_mapa: '',
              });
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Novo evento manual
          </button>
        </div>

        {listError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{listError}</p>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
            {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {calendarCells.map((cell, idx) => {
              if (cell.type === 'out') {
                return <div key={idx} className="aspect-square rounded-lg bg-slate-50" />;
              }
              const sel = cell.ymd === selectedYmd;
              const isToday = cell.ymd === hoje;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedYmd(cell.ymd)}
                  className={`flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition ${
                    sel
                      ? 'border-orange-400 bg-orange-50 font-semibold text-orange-950'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  } ${isToday && !sel ? 'ring-1 ring-slate-400' : ''}`}
                >
                  <span>{cell.d}</span>
                  {cell.count > 0 ? (
                    <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-orange-500" title={`${cell.count} evento(s)`} />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-semibold text-slate-800">
            {new Date(`${selectedYmd}T12:00:00`).toLocaleDateString('pt-BR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </h3>
          {loadingList ? (
            <p className="mt-3 text-sm text-slate-500">Carregando…</p>
          ) : dayEvents.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nenhum evento neste dia.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {dayEvents.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => openDetail(ev.id)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm transition hover:border-orange-300 hover:bg-orange-50/40"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-slate-900">
                        {ev.source === 'os' ? (
                          <>
                            O.S. #{ev.os_id} — {ev.tipo_trabalho || 'Job'}
                          </>
                        ) : (
                          <>{ev.manual_tipo || 'Evento manual'}</>
                        )}
                      </span>
                      <span className="text-xs text-slate-500">{ev.hora_evento || '—'}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {ev.source === 'os' ? ev.cliente_nome || 'Cliente' : ev.local_evento || 'Sem local'}
                    </p>
                    {ev.presencas?.length ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {ev.presencas.filter((p) => p.status === 'confirmado').length}/{ev.presencas.length}{' '}
                        confirmados
                      </p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:self-start">
        {!detailId ? (
          <p className="text-sm text-slate-500">Selecione um evento na lista para ver detalhes, modelos e envio.</p>
        ) : loadingDetail ? (
          <p className="text-sm text-slate-500">Carregando detalhes…</p>
        ) : detail?.evento ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {detail.evento.source === 'os'
                  ? `O.S. #${detail.evento.os_id}`
                  : 'Evento manual'}
              </h3>
              <p className="text-xs text-slate-500">
                {detail.evento.source === 'os' ? 'Origem: orçamento / O.S. (campos bloqueados)' : 'Edite livremente'}
              </p>
            </div>

            {saveErr ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">{saveErr}</p>
            ) : null}
            {saveMsg ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
                {saveMsg}
              </p>
            ) : null}

            {detail.evento.source === 'os' ? (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Cliente</dt>
                  <dd className="font-medium">{detail.evento.cliente_nome || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Tipo de trabalho</dt>
                  <dd>{detail.evento.tipo_trabalho || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Data</dt>
                  <dd>
                    {detail.evento.data_trabalho
                      ? String(detail.evento.data_trabalho).slice(0, 10)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Horário</dt>
                  <dd>{detail.evento.hora_evento || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Local</dt>
                  <dd>{detail.evento.local_evento || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Modelos</dt>
                  <dd>{detail.evento.modelos_resumo || '—'}</dd>
                </div>
                <label className="block pt-1">
                  <span className="text-xs font-medium text-slate-700">Observações extras (instruções ao modelo)</span>
                  <textarea
                    value={obsExtrasDraft}
                    onChange={(e) => setObsExtrasDraft(e.target.value)}
                    rows={4}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={saveOsObs}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 text-sm font-medium text-white"
                >
                  Salvar observações extras
                </button>
              </dl>
            ) : (
              <form
                className="space-y-2 text-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveManual();
                }}
              >
                <label className="block">
                  <span className="text-xs text-slate-500">Tipo</span>
                  <select
                    value={manualDraft.manual_tipo}
                    onChange={(e) => setManualDraft((p) => ({ ...p, manual_tipo: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
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
                    value={manualDraft.data_evento}
                    onChange={(e) => setManualDraft((p) => ({ ...p, data_evento: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Horário</span>
                  <input
                    value={manualDraft.hora_evento}
                    onChange={(e) => setManualDraft((p) => ({ ...p, hora_evento: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Local</span>
                  <input
                    value={manualDraft.local_evento}
                    onChange={(e) => setManualDraft((p) => ({ ...p, local_evento: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Link do mapa (opcional)</span>
                  <input
                    value={manualDraft.link_mapa}
                    onChange={(e) => setManualDraft((p) => ({ ...p, link_mapa: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Observações</span>
                  <textarea
                    value={manualDraft.observacoes_manual}
                    onChange={(e) => setManualDraft((p) => ({ ...p, observacoes_manual: e.target.value }))}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <button
                  type="submit"
                  className="w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white"
                >
                  Salvar alterações
                </button>
                <button
                  type="button"
                  onClick={deleteManual}
                  className="w-full rounded-lg border border-rose-300 py-2 text-sm text-rose-800"
                >
                  Excluir evento
                </button>
              </form>
            )}

            {detail.evento.source === 'os' && detail.presencas?.length ? (
              <div className="border-t border-slate-200 pt-3">
                <h4 className="text-sm font-semibold text-slate-800">Presença por modelo</h4>
                <ul className="mt-2 space-y-2">
                  {detail.presencas.map((p) => (
                    <li key={p.id} className="rounded-lg border border-slate-200 p-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{p.modelo_nome}</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgePresenca(p.status)}`}
                        >
                          {labelPresenca(p.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-500">
                        Enviado: {p.enviado_em ? new Date(p.enviado_em).toLocaleString('pt-BR') : '—'}
                      </p>
                      <p className="text-slate-500">
                        Resposta: {p.respondido_em ? new Date(p.respondido_em).toLocaleString('pt-BR') : '—'}
                      </p>
                      <button
                        type="button"
                        disabled={enviandoId === p.id}
                        onClick={() => enviarModelo(p.id)}
                        className="mt-2 w-full rounded-md bg-orange-500 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        {enviandoId === p.id ? 'Gerando…' : 'Enviar para modelo'}
                      </button>
                    </li>
                  ))}
                </ul>
                {envioPreview.text ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-xs font-medium text-slate-700">Mensagem (copie e cole no WhatsApp)</p>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-800">
                      {envioPreview.text}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copyText(envioPreview.text)}
                      className="mt-2 w-full rounded border border-slate-300 py-1 text-xs"
                    >
                      Copiar mensagem
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {detail.historico?.length ? (
              <div className="border-t border-slate-200 pt-3">
                <h4 className="text-sm font-semibold text-slate-800">Histórico</h4>
                <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-[11px] text-slate-600">
                  {detail.historico.map((h) => (
                    <li key={h.id}>
                      {new Date(h.created_at).toLocaleString('pt-BR')} — {h.tipo}: {h.detalhe}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setDetailId(null);
                setDetail(null);
              }}
              className="w-full text-xs text-slate-500 underline"
            >
              Fechar painel
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Não foi possível carregar o evento.</p>
        )}
      </aside>

      {novoOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Novo evento manual</h3>
            <form className="mt-4 space-y-3 text-sm" onSubmit={criarManual}>
              <label className="block">
                <span className="text-xs text-slate-500">Tipo</span>
                <select
                  value={manualDraft.manual_tipo}
                  onChange={(e) => setManualDraft((p) => ({ ...p, manual_tipo: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
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
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Horário</span>
                <input
                  value={manualDraft.hora_evento}
                  onChange={(e) => setManualDraft((p) => ({ ...p, hora_evento: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Local</span>
                <input
                  value={manualDraft.local_evento}
                  onChange={(e) => setManualDraft((p) => ({ ...p, local_evento: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Link do mapa (opcional)</span>
                <input
                  value={manualDraft.link_mapa}
                  onChange={(e) => setManualDraft((p) => ({ ...p, link_mapa: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Observações</span>
                <textarea
                  value={manualDraft.observacoes_manual}
                  onChange={(e) => setManualDraft((p) => ({ ...p, observacoes_manual: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5"
                />
              </label>
              {saveErr && novoOpen ? (
                <p className="text-xs text-red-700">{saveErr}</p>
              ) : null}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setNovoOpen(false);
                    setSaveErr('');
                  }}
                  className="flex-1 rounded-lg border border-slate-300 py-2 text-sm"
                >
                  Cancelar
                </button>
                <button type="submit" className="flex-1 rounded-lg bg-slate-900 py-2 text-sm font-medium text-white">
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
