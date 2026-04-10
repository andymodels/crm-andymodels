import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from './apiConfig';

/** yyyy-mm-dd → dd/mm/yyyy (data civil em UTC, evita “Invalid Date”) */
function formatarDataBr(ymd) {
  if (!ymd || typeof ymd !== 'string') return '—';
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

/** dd/mm/yyyy, dia da semana, horário — funciona para datas passadas ou futuras */
function linhaDataHorario(dataYmd, horario) {
  const br = formatarDataBr(dataYmd);
  if (br === '—') return horario ? `— às ${horario}` : '—';
  const m = String(dataYmd).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return horario ? `${br} às ${horario}` : br;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(dt.getTime())) return horario ? `${br} às ${horario}` : br;
  const diaSemana = dt.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
  const parte = `${br} (${diaSemana})`;
  return horario ? `${parte} · ${horario}` : parte;
}

function JobResumo({ info }) {
  if (!info) return null;
  return (
    <dl className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
      <div>
        <dt className="text-xs text-slate-500">Cliente / job</dt>
        <dd className="font-medium text-slate-900">
          {info.cliente || '—'}
          {info.os_id ? ` — O.S. #${info.os_id}` : ''}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">Tipo de trabalho</dt>
        <dd>{info.tipo_trabalho || '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">Data e horário</dt>
        <dd>{linhaDataHorario(info.data_trabalho, info.horario)}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">Local</dt>
        <dd>{info.local || '—'}</dd>
      </div>
      {info.observacoes_extras ? (
        <div>
          <dt className="text-xs text-slate-500">Observações</dt>
          <dd className="whitespace-pre-wrap">{info.observacoes_extras}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export default function PublicAgendaConfirmacao() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => (searchParams.get('token') || '').trim(), [searchParams]);
  const acaoUrl = useMemo(() => {
    const a = (searchParams.get('acao') || '').trim().toLowerCase();
    return a === 'confirmar' || a === 'recusar' ? a : '';
  }, [searchParams]);

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [info, setInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  /** Resposta acabada de enviar nesta sessão (mostra mensagem de sucesso, não a de “já registrada”) */
  const [acabeiDeResponder, setAcabeiDeResponder] = useState(false);

  const registrar = useCallback(
    async (acao) => {
      if (!token) return;
      setErro('');
      setSubmitting(true);
      try {
        const res = await fetch(`${API_BASE}/public/agenda-presenca`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, acao }),
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          throw new Error('Resposta inválida do servidor.');
        }
        if (res.status === 409) {
          setErro(data.message || 'Resposta já registrada para este convite.');
          setInfo((prev) =>
            prev
              ? {
                  ...prev,
                  status: data.status || prev.status,
                  resposta_ja_registrada: true,
                  pode_responder: false,
                }
              : prev,
          );
          return;
        }
        if (!res.ok) throw new Error(data.message || 'Não foi possível registrar.');
        const novo = data.status === 'recusado' ? 'recusado' : 'confirmado';
        setAcabeiDeResponder(true);
        setInfo((prev) =>
          prev
            ? {
                ...prev,
                status: novo,
                respondido_em: new Date().toISOString(),
                resposta_ja_registrada: true,
                pode_responder: false,
              }
            : prev,
        );
      } catch (e) {
        setErro(e?.message || 'Erro.');
      } finally {
        setSubmitting(false);
      }
    },
    [token],
  );

  useEffect(() => {
    let ativo = true;
    async function run() {
      if (!token) {
        if (ativo) {
          setErro('Link inválido ou expirado.');
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setErro('');
      try {
        const res = await fetch(`${API_BASE}/public/agenda-presenca?token=${encodeURIComponent(token)}`);
        let data = {};
        try {
          data = await res.json();
        } catch {
          throw new Error('Resposta inválida do servidor.');
        }
        if (!res.ok) throw new Error(data.message || 'Link inválido ou expirado.');
        if (!ativo) return;
        setInfo(data);

        const ja = data.resposta_ja_registrada === true || data.pode_responder === false;

        if (ja) {
          setLoading(false);
          return;
        }

        if (acaoUrl) {
          setSubmitting(true);
          try {
            const res2 = await fetch(`${API_BASE}/public/agenda-presenca`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, acao: acaoUrl }),
            });
            let data2 = {};
            try {
              data2 = await res2.json();
            } catch {
              throw new Error('Resposta inválida do servidor.');
            }
            if (res2.status === 409) {
              setErro(data2.message || 'Resposta já registrada para este convite.');
              setInfo((prev) =>
                prev
                  ? {
                      ...prev,
                      status: data2.status || prev.status,
                      resposta_ja_registrada: true,
                      pode_responder: false,
                    }
                  : prev,
              );
              return;
            }
            if (!res2.ok) throw new Error(data2.message || 'Não foi possível registrar.');
            if (!ativo) return;
            const novo = data2.status === 'recusado' ? 'recusado' : 'confirmado';
            setAcabeiDeResponder(true);
            setInfo((prev) =>
              prev
                ? {
                    ...prev,
                    status: novo,
                    respondido_em: new Date().toISOString(),
                    resposta_ja_registrada: true,
                    pode_responder: false,
                  }
                : prev,
            );
          } catch (e) {
            if (ativo) setErro(e?.message || 'Erro ao registar a resposta.');
          } finally {
            if (ativo) setSubmitting(false);
          }
        }
      } catch (e) {
        if (ativo) setErro(e?.message || 'Erro ao abrir.');
      } finally {
        if (ativo) setLoading(false);
      }
    }
    run();
    return () => {
      ativo = false;
    };
  }, [token, acaoUrl]);

  if (loading) {
    return (
      <main className="mx-auto max-w-lg p-6 text-center text-sm text-slate-600">A carregar convite…</main>
    );
  }

  if (erro && !info) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Convite</h1>
          <p className="mt-2 text-sm text-slate-700">{erro}</p>
        </div>
      </main>
    );
  }

  const jaRegistradoAntes = info?.resposta_ja_registrada === true && !acabeiDeResponder;
  const tituloSucesso =
    info?.status === 'confirmado'
      ? 'Presença confirmada com sucesso.'
      : info?.status === 'recusado'
        ? 'Você informou que não poderá comparecer.'
        : '';

  const caixaSucessoClass =
    info?.status === 'recusado'
      ? 'border-rose-200 bg-rose-50 text-rose-900'
      : 'border-emerald-200 bg-emerald-50 text-emerald-900';

  const mostrarSucessoPrimeiraResposta = acabeiDeResponder && info?.resposta_ja_registrada;

  return (
    <main className="mx-auto max-w-lg p-4 md:p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Confirmação de presença</h1>
        <p className="mt-1 text-sm text-slate-600">Olá, {info?.modelo_nome || 'modelo'}.</p>

        {jaRegistradoAntes ? (
          <>
            <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-800">
              Resposta já registrada para este convite.
            </p>
            {info?.status === 'confirmado' ? (
              <p className="mt-2 text-sm text-slate-600">O seu registo: <strong>confirmado</strong>.</p>
            ) : null}
            {info?.status === 'recusado' ? (
              <p className="mt-2 text-sm text-slate-600">O seu registo: <strong>não poderá comparecer</strong>.</p>
            ) : null}
            <JobResumo info={info} />
          </>
        ) : mostrarSucessoPrimeiraResposta ? (
          <>
            <p className={`mt-4 rounded-lg border px-3 py-3 text-sm font-medium ${caixaSucessoClass}`}>
              {tituloSucesso}
            </p>
            <JobResumo info={info} />
          </>
        ) : (
          <>
            <JobResumo info={info} />
            {erro ? <p className="mt-3 text-sm text-red-700">{erro}</p> : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={submitting}
                onClick={() => registrar('confirmar')}
                className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                Confirmar presença
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => registrar('recusar')}
                className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-800 disabled:opacity-60"
              >
                Não posso ir
              </button>
            </div>
          </>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">Andy Management — agenda</p>
      </div>
    </main>
  );
}
