import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import WebsiteModeloEditorPage from './components/WebsiteModeloEditorPage';
import { API_BASE, fetchWithTimeout } from './apiConfig';

const SUCCESS_TEXT = 'Cadastro recebido com sucesso. Obrigado pela atualização.';

function trimStr(v) {
  return String(v ?? '').trim();
}

export default function PublicCadastroModelo() {
  const [searchParams] = useSearchParams();
  const tokenParam = trimStr(searchParams.get('token') || '');

  const [tokenGate, setTokenGate] = useState(() => (tokenParam ? 'loading' : 'missing'));
  const [tokenCheckMessage, setTokenCheckMessage] = useState('');
  const [done, setDone] = useState(false);

  const validarUrl = useMemo(() => `${API_BASE.replace(/\/$/, '')}/public/cadastro-modelo/validar`, []);

  useEffect(() => {
    const t = trimStr(searchParams.get('token') || '');
    if (!t) {
      setTokenGate('missing');
      setTokenCheckMessage('Este cadastro só pode ser acedido através do link enviado pela agência.');
      return;
    }
    setTokenGate('loading');
    setTokenCheckMessage('');
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchWithTimeout(`${validarUrl}?token=${encodeURIComponent(t)}`, { method: 'GET' });
        const raw = await response.text();
        const data = raw ? JSON.parse(raw) : {};
        if (cancelled) return;
        if (response.ok && data.ok) setTokenGate('ok');
        else {
          setTokenGate('invalid');
          setTokenCheckMessage(data.message || 'Link inválido, expirado ou já utilizado.');
        }
      } catch {
        if (!cancelled) {
          setTokenGate('invalid');
          setTokenCheckMessage('Não foi possível validar o link. Verifique a ligação e tente novamente.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, validarUrl]);

  if (done) {
    return (
      <div className="min-h-screen bg-[#F7F7F7] px-4 py-16 text-slate-800">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <img
            src="/logo-andy.png"
            alt="Andy Management"
            className="mx-auto h-12 w-auto max-w-full object-contain"
            width={393}
            height={157}
          />
          <p className="mt-6 text-lg font-semibold text-slate-900">{SUCCESS_TEXT}</p>
        </div>
      </div>
    );
  }

  if (tokenGate === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F7F7] px-4 text-slate-700">
        <p className="text-sm">A verificar o link…</p>
      </div>
    );
  }

  if (tokenGate === 'missing' || tokenGate === 'invalid') {
    return (
      <div className="min-h-screen bg-[#F7F7F7] px-4 py-16 text-slate-800">
        <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <img
            src="/logo-andy.png"
            alt="Andy Management"
            className="mx-auto h-12 w-auto max-w-full object-contain opacity-90"
            width={393}
            height={157}
          />
          <h1 className="mt-6 text-lg font-semibold text-slate-900">Link não disponível</h1>
          <p className="mt-3 text-sm text-slate-600">{tokenCheckMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F7F7] px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 text-center">
          <img
            src="/logo-andy.png"
            alt="Andy Management"
            className="mx-auto h-14 w-auto max-w-[min(100%,280px)] object-contain"
            width={393}
            height={157}
          />
          <h1 className="mt-6 text-2xl font-semibold text-slate-900">Cadastro de modelo</h1>
          <p className="mt-2 text-sm text-slate-600">Preencha todos os blocos para concluir seu cadastro completo.</p>
        </header>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <WebsiteModeloEditorPage
            persistenceMode="cadastro_link"
            cadastroLinkToken={tokenParam}
            onCadastroLinkSuccess={() => setDone(true)}
          />
        </div>
      </div>
    </div>
  );
}
