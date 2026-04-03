import { useCallback, useEffect, useMemo, useState } from 'react';

const formatBRL = (value) => {
  const n = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number.isFinite(n) ? n : 0,
  );
};

function padMonthKey(y, m) {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

function monthRange(y, m) {
  const from = `${padMonthKey(y, m)}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const to = `${padMonthKey(y, m)}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const LABELS = {
  os_trabalho: 'Job / O.S.',
  conta_receber: 'À receber',
  pagamento_modelo_previsto: 'Pag. modelo (previsto)',
  pagamento_modelo_realizado: 'Pag. modelo (pago)',
};

function chipClass(tipo, ev) {
  switch (tipo) {
    case 'os_trabalho':
      return 'border-sky-300 bg-sky-50 text-sky-950';
    case 'conta_receber': {
      if (ev.situacao === 'atrasado') return 'border-red-300 bg-red-50 text-red-950';
      if (ev.situacao === 'vence_hoje') return 'border-amber-400 bg-amber-100 text-amber-950';
      return 'border-amber-200 bg-amber-50/90 text-amber-950';
    }
    case 'pagamento_modelo_previsto':
      return 'border-violet-300 bg-violet-50 text-violet-950';
    case 'pagamento_modelo_realizado':
      return 'border-emerald-300 bg-emerald-50 text-emerald-950';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-800';
  }
}

function eventTitle(ev) {
  if (ev.tipo === 'os_trabalho') {
    const mod = ev.modelos?.length ? ev.modelos.join(', ') : '—';
    return `#${ev.os_id} ${ev.cliente} · ${mod}`;
  }
  if (ev.tipo === 'conta_receber') {
    const sit =
      ev.situacao === 'atrasado'
        ? 'atrasado'
        : ev.situacao === 'vence_hoje'
          ? 'vence hoje'
          : 'pendente';
    let s = `O.S. #${ev.os_id} · ${formatBRL(ev.saldo)} · ${sit}`;
    if (ev.usa_fallback_data_trabalho) s += ' · ref. trabalho';
    return s;
  }
  if (ev.tipo === 'pagamento_modelo_previsto') {
    return `${ev.modelo} · ${formatBRL(ev.saldo_linha)} · O.S. #${ev.os_id}`;
  }
  return `${ev.modelo} · ${formatBRL(ev.valor)} · O.S. #${ev.os_id}`;
}

export default function OperacaoCalendar({ apiUrl, onOpenOs }) {
  const initial = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  }, []);
  const [cursor, setCursor] = useState(initial);
  const [events, setEvents] = useState([]);
  const [hoje, setHoje] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { from, to } = useMemo(() => monthRange(cursor.y, cursor.m), [cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(
        `${apiUrl}/dashboard/calendario?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Erro ao carregar calendário.');
      setEvents(Array.isArray(data.events) ? data.events : []);
      setHoje(data.hoje || '');
    } catch (e) {
      setEvents([]);
      setError(e.message || 'Erro ao carregar calendário.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      const k = ev.data;
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(ev);
    }
    return map;
  }, [events]);

  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i += 1) cells.push({ type: 'empty', key: `e-${i}` });
    for (let d = 1; d <= daysInMonth; d += 1) {
      const key = `${padMonthKey(cursor.y, cursor.m)}-${String(d).padStart(2, '0')}`;
      cells.push({
        type: 'day',
        key,
        day: d,
        list: byDay.get(key) || [],
      });
    }
    while (cells.length % 7 !== 0) cells.push({ type: 'empty', key: `tail-${cells.length}` });
    return cells;
  }, [cursor.y, cursor.m, byDay]);

  const monthLabel = new Date(cursor.y, cursor.m).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  const prevMonth = () => {
    setCursor((c) => {
      const nm = c.m - 1;
      if (nm < 0) return { y: c.y - 1, m: 11 };
      return { y: c.y, m: nm };
    });
  };

  const nextMonth = () => {
    setCursor((c) => {
      const nm = c.m + 1;
      if (nm > 11) return { y: c.y + 1, m: 0 };
      return { y: c.y, m: nm };
    });
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Calendário operacional</h3>
          <p className="mt-1 text-sm text-slate-500">
            Jobs pela <strong>data do trabalho</strong>; à receber pelo <strong>vencimento</strong> na O.S. (se vazio,
            usa a data do trabalho como referência); previsão de pagamento a modelo por linha; pagamentos registrados
            aparecem na <strong>data do lançamento</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            onClick={prevMonth}
          >
            ←
          </button>
          <span className="min-w-[140px] text-center text-sm font-medium capitalize text-slate-800">{monthLabel}</span>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            onClick={nextMonth}
          >
            →
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm bg-sky-200" /> Job / O.S.
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm bg-amber-200" /> À receber
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm bg-violet-200" /> Pag. modelo (previsto)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm bg-emerald-200" /> Pag. modelo (pago)
        </span>
        {hoje && (
          <span className="text-slate-500">
            Hoje no servidor: <strong>{hoje}</strong>
          </span>
        )}
      </div>

      {loading && <p className="mt-4 text-sm text-slate-500">Carregando eventos...</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="mt-4 overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-7 gap-1 text-xs">
            {WEEKDAYS.map((wd) => (
              <div key={wd} className="px-1 py-2 text-center font-medium text-slate-500">
                {wd}
              </div>
            ))}
            {grid.map((cell) => {
              if (cell.type === 'empty') {
                return <div key={cell.key} className="min-h-[88px] rounded-lg bg-slate-50/50" />;
              }
              const isToday = hoje && cell.key === hoje;
              return (
                <div
                  key={cell.key}
                  className={`flex min-h-[88px] flex-col rounded-lg border p-1 ${
                    isToday ? 'border-2' : 'border-slate-200'
                  } ${isToday ? 'border-amber-500 bg-amber-50/30' : 'bg-white'}`}
                >
                  <div className="flex justify-end px-0.5">
                    <span className={`text-[11px] font-semibold ${isToday ? 'text-amber-900' : 'text-slate-600'}`}>
                      {cell.day}
                    </span>
                  </div>
                  <div className="max-h-[120px] space-y-0.5 overflow-y-auto">
                    {cell.list.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        title={`${LABELS[ev.tipo] || ev.tipo}: ${eventTitle(ev)}`}
                        onClick={() => onOpenOs(ev.os_id)}
                        className={`w-full rounded border px-1 py-0.5 text-left text-[10px] leading-tight ${chipClass(
                          ev.tipo,
                          ev,
                        )}`}
                      >
                        <span className="font-medium">{LABELS[ev.tipo] || ev.tipo}</span>
                        <span className="line-clamp-2 block text-[9px] opacity-90">{eventTitle(ev)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
