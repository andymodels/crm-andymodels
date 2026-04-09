import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from './apiConfig';

export default function PublicAgendaConfirmacao() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => (searchParams.get('token') || '').trim(), [searchParams]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [info, setInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [okMsg, setOkMsg] = useState('');

  useEffect(() => {
    let ativo = true;
    async function run() {
      if (!token) {
        if (ativo) {
          setErro('Link inválido.');
          setLoading(false);
        }
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/public/agenda-presenca?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Não foi possível carregar.');
        if (ativo) setInfo(data);
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
  }, [token]);

  const enviar = async (acao) => {
    if (!token) return;
    setErro('');
    setOkMsg('');
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/public/agenda-presenca`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, acao }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Não foi possível registrar.');
      setOkMsg(data.message || 'Registrado.');
      setInfo((prev) =>
        prev
          ? {
              ...prev,
              status: data.status || prev.status,
              respondido_em: new Date().toISOString(),
            }
          : prev,
      );
    } catch (e) {
      setErro(e?.message || 'Erro.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-lg p-6 text-center text-sm text-slate-600">Carregando convite…</main>
    );
  }
  if (erro && !info) {
    return <main className="mx-auto max-w-lg p-6 text-sm text-red-700">{erro}</main>;
  }

  const status = info?.status;
  const jaRespondeu = status === 'confirmado' || status === 'recusado';

  return (
    <main className="mx-auto max-w-lg p-4 md:p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Confirmação de presença</h1>
        <p className="mt-1 text-sm text-slate-600">Olá, {info?.modelo_nome || 'modelo'}.</p>

        <dl className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Cliente / job</dt>
            <dd className="font-medium text-slate-900">
              {info?.cliente || '—'}
              {info?.os_id ? ` — O.S. #${info.os_id}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Tipo de trabalho</dt>
            <dd>{info?.tipo_trabalho || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Data e horário</dt>
            <dd>
              {info?.data_trabalho
                ? new Date(`${info.data_trabalho}T12:00:00`).toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })
                : '—'}{' '}
              {info?.horario ? `às ${info.horario}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Local</dt>
            <dd>{info?.local || '—'}</dd>
          </div>
          {info?.observacoes_extras ? (
            <div>
              <dt className="text-xs text-slate-500">Observações</dt>
              <dd className="whitespace-pre-wrap">{info.observacoes_extras}</dd>
            </div>
          ) : null}
        </dl>

        {erro ? <p className="mt-3 text-sm text-red-700">{erro}</p> : null}
        {okMsg ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {okMsg}
          </p>
        ) : null}

        {jaRespondeu ? (
          <p className="mt-4 text-sm font-medium text-slate-800">
            Seu status: {status === 'confirmado' ? 'Confirmado' : 'Recusado'}.
            {info?.respondido_em
              ? ` Registrado em ${new Date(info.respondido_em).toLocaleString('pt-BR')}.`
              : ''}
          </p>
        ) : (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={submitting}
              onClick={() => enviar('confirmar')}
              className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              Confirmar presença
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => enviar('recusar')}
              className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-800 disabled:opacity-60"
            >
              Não posso ir
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">Andy Management — agenda</p>
      </div>
    </main>
  );
}
