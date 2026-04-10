import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE, fetchWithAuth, throwIfHtmlOrCannotPost } from '../apiConfig';

/** Inscrições via formulário público: `POST /api/public/cadastro-modelo` grava em `modelos` com esta origem. */
const ORIGEM_INSCRICAO_SITE = 'cadastro_site';

function formatListDate(iso) {
  if (iso == null || iso === '') return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pt-BR');
}

function formatDetailValue(key, v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (Array.isArray(v)) {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  const s = String(v);
  if (key === 'foto_perfil_base64' && (s.startsWith('http') || s.startsWith('data:image'))) {
    return s;
  }
  if ((key === 'created_at' || key === 'updated_at' || key === 'data_nascimento') && s) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('pt-BR');
  }
  return s;
}

/** Rótulos alinhados a `labelForField` em cadastros.js (subset modelos). */
const FIELD_LABEL = {
  id: 'ID',
  nome: 'Nome',
  cpf: 'CPF',
  data_nascimento: 'Data de nascimento',
  sexo: 'Sexo',
  telefones: 'Telefones',
  emails: 'E-mails',
  telefone: 'Telefone',
  email: 'E-mail',
  cidade: 'Cidade',
  uf: 'UF',
  cep: 'CEP',
  logradouro: 'Logradouro',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  observacoes: 'Observações',
  origem_cadastro: 'Origem do cadastro',
  status_cadastro: 'Status do cadastro',
  ativo: 'Ativo',
  created_at: 'Criado em',
  updated_at: 'Atualizado em',
  medida_altura: 'Altura',
  medida_busto: 'Busto',
  medida_torax: 'Tórax',
  medida_cintura: 'Cintura',
  medida_quadril: 'Quadril',
  medida_sapato: 'Sapato',
  medida_cabelo: 'Cabelo',
  medida_olhos: 'Olhos',
  formas_pagamento: 'Formas de pagamento',
  emite_nf_propria: 'Emite NF própria',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  passaporte: 'Passaporte',
  rg: 'RG',
  responsavel_nome: 'Responsável (nome)',
  responsavel_cpf: 'Responsável (CPF)',
  responsavel_telefone: 'Responsável (telefone)',
  foto_perfil_base64: 'Foto de perfil',
  chave_pix: 'Chave Pix',
  banco_dados: 'Dados bancários',
};

function fieldLabel(key) {
  return FIELD_LABEL[key] || key.replace(/_/g, ' ');
}

export default function WebsiteInscricoesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoria, setCategoria] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${API_BASE}/modelos`);
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
      if (!Array.isArray(data)) throw new Error('Lista de modelos inválida.');
      setRows(data);
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Erro ao carregar.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detail) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  const inscricoes = useMemo(() => {
    let list = rows.filter((m) => m && String(m.origem_cadastro || '').trim() === ORIGEM_INSCRICAO_SITE);
    if (categoria === 'feminino') list = list.filter((m) => String(m.sexo || '').toLowerCase() === 'feminino');
    if (categoria === 'masculino') list = list.filter((m) => String(m.sexo || '').toLowerCase() === 'masculino');
    if (statusFilter === 'pendente') list = list.filter((m) => String(m.status_cadastro || '').toLowerCase() === 'pendente');
    if (statusFilter === 'aprovado') list = list.filter((m) => String(m.status_cadastro || '').toLowerCase() === 'aprovado');
    list = [...list].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
    return list;
  }, [rows, categoria, statusFilter]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Inscrições</h3>
          <p className="mt-1 text-sm text-slate-500">
            Cadastros recebidos pelo formulário público do CRM (
            <code className="rounded bg-slate-100 px-1">origem_cadastro = cadastro_site</code>
            ). Dados: <code className="rounded bg-slate-100 px-1">GET /api/modelos</code>.
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
                { id: 'feminino', label: 'Feminino' },
                { id: 'masculino', label: 'Masculino' },
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
                { id: 'pendente', label: 'Pendente' },
                { id: 'aprovado', label: 'Aprovado' },
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
        ) : inscricoes.length === 0 ? (
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
                {inscricoes.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-slate-100 hover:bg-amber-50/50"
                    onClick={() => setDetail(row)}
                  >
                    <td className="px-3 py-2 font-medium text-slate-900">{row.nome != null ? String(row.nome) : '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{formatListDate(row.created_at)}</td>
                    <td className="px-3 py-2 text-slate-600">{row.cidade != null && String(row.cidade).trim() !== '' ? String(row.cidade) : '—'}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.status_cadastro != null ? String(row.status_cadastro) : '—'}
                    </td>
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
                {detail.nome ? ` — ${detail.nome}` : ''}
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
              {(() => {
                const foto = detail.foto_perfil_base64;
                const fotoStr = foto != null ? String(foto).trim() : '';
                const showImg = fotoStr.startsWith('http') || fotoStr.startsWith('data:image');
                return showImg ? (
                  <div className="flex justify-center border-b border-slate-100 pb-4">
                    <img src={fotoStr} alt="" className="max-h-56 max-w-full rounded-lg object-contain" />
                  </div>
                ) : null;
              })()}
              <dl className="grid gap-2 text-sm">
                {Object.keys(detail)
                  .sort((a, b) => a.localeCompare(b))
                  .map((key) => {
                    const val = detail[key];
                    const text = formatDetailValue(key, val);
                    const isLong = text.length > 200 || text.includes('\n');
                    const isFotoKey = key === 'foto_perfil_base64';
                    const skipDuplicateImg = isFotoKey && (String(val).startsWith('http') || String(val).startsWith('data:image'));
                    return (
                      <div
                        key={key}
                        className="grid gap-1 border-b border-slate-100 py-2 sm:grid-cols-[minmax(140px,200px)_1fr]"
                      >
                        <dt className="font-medium text-slate-700">{fieldLabel(key)}</dt>
                        <dd className="min-w-0 text-slate-800">
                          {skipDuplicateImg ? (
                            <span className="text-slate-500">(ver acima)</span>
                          ) : isLong ? (
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs">
                              {text}
                            </pre>
                          ) : (
                            text
                          )}
                        </dd>
                      </div>
                    );
                  })}
              </dl>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
