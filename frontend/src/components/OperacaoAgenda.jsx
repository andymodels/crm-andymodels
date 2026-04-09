import { useCallback, useEffect, useMemo, useState } from 'react';

const formatBRL = (value) => {
  const n = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number.isFinite(n) ? n : 0,
  );
};

function addDaysYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function dayHeading(dateStr, hojeStr) {
  if (dateStr === hojeStr) return 'Hoje';
  const t = new Date(`${dateStr}T12:00:00`);
  const h = new Date(`${hojeStr}T12:00:00`);
  const diff = Math.round((t.getTime() - h.getTime()) / 86400000);
  if (diff === 1) return 'Amanhã';
  return t.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
}

function eventLine(ev) {
  if (ev.tipo === 'os_trabalho') {
    return { text: `Job #${ev.os_id} — ${ev.cliente || '—'}`, action: 'os' };
  }
  if (ev.tipo === 'conta_receber') {
    return {
      text: `Receber #${ev.os_id} — ${ev.cliente || '—'} — ${formatBRL(ev.saldo)}`,
      action: 'os',
    };
  }
  if (ev.tipo === 'pagamento_modelo_previsto') {
    return {
      text: `Pagar modelo — ${ev.modelo || '—'} — O.S. #${ev.os_id} — ${formatBRL(ev.saldo_linha)}`,
      action: 'os',
    };
  }
  if (ev.tipo === 'pagamento_modelo_realizado') {
    return {
      text: `Pago modelo — ${ev.modelo || '—'} — ${formatBRL(ev.valor)}`,
      action: 'os',
    };
  }
  return { text: '—', action: 'os' };
}

export default function OperacaoAgenda({ apiUrl, onOpenOs }) {
  const [events, setEvents] = useState([]);
  const [hoje, setHoje] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { from, to } = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const start = `${y}-${m}-${d}`;
    return { from: start, to: addDaysYmd(start, 14) };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(
        `${apiUrl}/dashboard/calendario?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Erro ao carregar agenda.');
      setEvents(Array.isArray(data.events) ? data.events : []);
      setHoje(data.hoje || from);
    } catch (e) {
      setEvents([]);
      setError(e.message || 'Erro ao carregar agenda.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      const k = ev.data;
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(ev);
    }
    return map;
  }, [events]);

  const sortedDates = useMemo(() => [...byDate.keys()].sort(), [byDate]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">Hoje e próximos dias</h3>
      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Carregando…</p>
      ) : error ? (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      ) : sortedDates.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Nada neste período.</p>
      ) : (
        <div className="mt-4 space-y-5">
          {sortedDates.map((dateStr) => (
            <div key={dateStr}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {dayHeading(dateStr, hoje || from)}
              </p>
              <ul className="mt-2 space-y-1.5">
                {(byDate.get(dateStr) || []).map((ev) => {
                  const { text, action } = eventLine(ev);
                  return (
                    <li key={ev.id}>
                      <button
                        type="button"
                        className="w-full rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-left text-sm text-slate-800 transition hover:bg-slate-100"
                        onClick={() => action === 'os' && ev.os_id != null && onOpenOs?.(ev.os_id)}
                      >
                        {text}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
