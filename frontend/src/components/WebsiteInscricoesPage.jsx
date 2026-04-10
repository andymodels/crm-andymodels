import { useState } from 'react';

const CATEGORIAS = [
  { id: 'feminino', label: 'Feminino' },
  { id: 'masculino', label: 'Masculino' },
];

const STATUS = [
  { id: 'novos', label: 'Novos' },
  { id: 'avaliados', label: 'Avaliados' },
  { id: 'aprovados', label: 'Aprovados' },
  { id: 'rejeitados', label: 'Rejeitados' },
];

/**
 * Estrutura visual de gestão de inscrições (filtros + área de lista; sem backend).
 */
export default function WebsiteInscricoesPage() {
  const [categoria, setCategoria] = useState('feminino');
  const [status, setStatus] = useState('novos');

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">Inscrições</h3>
      <p className="mt-1 text-sm text-slate-500">
        Inscrições recebidas pelo site — filtros abaixo; integração com dados em breve.
      </p>

      <div className="mt-6 space-y-6">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Categoria</p>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {CATEGORIAS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setCategoria(id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  categoria === id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
          <div className="flex flex-wrap gap-2">
            {STATUS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatus(id)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  status === id
                    ? 'border-amber-400 bg-amber-50 text-amber-950 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="text-sm font-medium text-slate-700">Listagem</p>
          <p className="mt-2 text-xs text-slate-500">
            Os registos de inscrição aparecerão aqui após ligação à API. Nenhum dado carregado por enquanto.
          </p>
        </div>
      </div>
    </section>
  );
}
