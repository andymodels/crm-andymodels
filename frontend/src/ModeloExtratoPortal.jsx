import { useEffect, useMemo, useState } from 'react';
import { API_BASE, fetchWithTimeout } from './apiConfig';

const BRAND_ORANGE = '#F59E0B';

const formatBRL = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));

export default function ModeloExtratoPortal() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [token, setToken] = useState('');
  const [modelo, setModelo] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('modelo_extrato_token') || '';
    if (saved) setToken(saved);
  }, []);

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchWithTimeout(`${API_BASE}/modelo/auth/me`, { headers: authHeaders });
        if (!me.ok) throw new Error('Sessão expirada.');
        const meData = await me.json();
        const ex = await fetchWithTimeout(`${API_BASE}/modelo/extrato`, { headers: authHeaders });
        if (!ex.ok) throw new Error('Falha ao carregar extrato.');
        const exData = await ex.json();
        if (cancelled) return;
        setModelo(meData.modelo || null);
        setRows(Array.isArray(exData) ? exData : []);
      } catch (e) {
        if (!cancelled) {
          setToken('');
          localStorage.removeItem('modelo_extrato_token');
          setError(e?.message || 'Falha de sessão.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authHeaders]);

  const onLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await fetchWithTimeout(`${API_BASE}/modelo/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || 'Credenciais invalidas.');
      const t = data.token || '';
      if (!t) throw new Error('Token ausente.');
      localStorage.setItem('modelo_extrato_token', t);
      setToken(t);
      setSenha('');
    } catch (err) {
      setError(err?.message || 'Falha no login.');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setToken('');
    setModelo(null);
    setRows([]);
    localStorage.removeItem('modelo_extrato_token');
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <form onSubmit={onLogin} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <img src="/logo-andy.png" alt="Andy Management" className="mx-auto mb-4 h-12 w-auto" />
          <h1 className="text-center text-lg font-semibold text-slate-900">Extrato do modelo</h1>
          <p className="mt-1 text-center text-sm text-slate-500">Acesso liberado após aprovação do cadastro.</p>
          <label className="mt-5 block text-sm text-slate-700">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              required
            />
          </label>
          <label className="mt-3 block text-sm text-slate-700">
            Senha
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              required
            />
          </label>
          {error ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: BRAND_ORANGE }}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Extrato do modelo</h1>
            <p className="text-sm text-slate-500">{modelo?.nome} · {modelo?.email}</p>
          </div>
          <button type="button" onClick={logout} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
            Sair
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-2 py-2">Data</th>
                <th className="px-2 py-2">Descrição</th>
                <th className="px-2 py-2">Valor</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-6 text-center text-slate-500">Sem lançamentos.</td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-2 py-2">{r.data || '—'}</td>
                  <td className="px-2 py-2">{r.descricao || 'Job publicidade'}</td>
                  <td className="px-2 py-2">{formatBRL(r.valor)}</td>
                  <td className="px-2 py-2">{r.status === 'pago' ? 'pago' : 'a receber'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
