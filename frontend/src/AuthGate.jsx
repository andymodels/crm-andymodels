import { useEffect, useState } from 'react';
import { API_BASE, fetchWithTimeout } from './apiConfig';

const BRAND_ORANGE = '#F59E0B';

export default function AuthGate({ children }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchWithTimeout(`${API_BASE}/auth/me`);
        if (!cancelled && r.ok) {
          const data = await r.json();
          setUser(data.user || null);
        }
      } catch {
        // login screen
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await fetchWithTimeout(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || 'Falha no login.');
      setUser(data.user || null);
      setSenha('');
    } catch (err) {
      setError(err?.message || 'Falha no login.');
    } finally {
      setLoading(false);
    }
  };

  const onLogout = async () => {
    try {
      await fetchWithTimeout(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
  };

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        A verificar sessão...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <form
          onSubmit={onLogin}
          className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <img src="/logo-andy.png" alt="Andy Management" className="mx-auto mb-4 h-12 w-auto" />
          <h1 className="text-center text-lg font-semibold text-slate-900">Login do administrador</h1>
          <p className="mt-1 text-center text-sm text-slate-500">
            Acesso restrito ao CRM interno.
          </p>
          <label className="mt-5 block text-sm text-slate-700">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
              required
            />
          </label>
          <label className="mt-3 block text-sm text-slate-700">
            Senha
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring"
              required
            />
          </label>
          {error ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
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

  return children({ user, onLogout });
}
