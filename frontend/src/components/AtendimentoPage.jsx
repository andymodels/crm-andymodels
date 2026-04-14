import { useMemo, useState } from 'react';

const BRAND_ORANGE = '#F59E0B';

const MOCK_CONTACTS = [
  { id: '1', nome: 'Mariana Costa', ultimaMensagem: 'Obrigada pelo orçamento, podemos fechar?' },
  { id: '2', nome: 'Studio Luz SP', ultimaMensagem: 'Confirma o horário da segunda às 14h?' },
  { id: '3', nome: 'Ricardo Almeida', ultimaMensagem: 'Enviei o comprovante por e-mail.' },
  { id: '4', nome: 'Agência Norte', ultimaMensagem: 'Precisamos da lista final de modelos até sexta.' },
  { id: '5', nome: 'Helena Duarte', ultimaMensagem: 'Combinado, aguardo o contrato.' },
];

const MOCK_MESSAGES = {
  '1': [
    { id: 'm1', de: 'contacto', texto: 'Bom dia! Gostaria de um orçamento para editorial.' },
    { id: 'm2', de: 'equipa', texto: 'Olá, Mariana. Enviamos a proposta por e-mail ontem.' },
    { id: 'm3', de: 'contacto', texto: 'Obrigada pelo orçamento, podemos fechar?' },
  ],
  '2': [
    { id: 'm1', de: 'contacto', texto: 'Oi, tudo bem? Conseguem o estúdio na segunda?' },
    { id: 'm2', de: 'equipa', texto: 'Sim, temos janela à tarde. Sugerimos 14h.' },
    { id: 'm3', de: 'contacto', texto: 'Confirma o horário da segunda às 14h?' },
  ],
  '3': [
    { id: 'm1', de: 'contacto', texto: 'Segue o PIX quando puder validar.' },
    { id: 'm2', de: 'equipa', texto: 'Recebido, obrigado! Vou lançar no financeiro.' },
    { id: 'm3', de: 'contacto', texto: 'Enviei o comprovante por e-mail.' },
  ],
  '4': [
    { id: 'm1', de: 'equipa', texto: 'Boa tarde! Temos 6 modelos disponíveis para a data.' },
    { id: 'm2', de: 'contacto', texto: 'Precisamos da lista final de modelos até sexta.' },
  ],
  '5': [
    { id: 'm1', de: 'contacto', texto: 'Podemos seguir com o job de verão?' },
    { id: 'm2', de: 'equipa', texto: 'Sim, enviamos o contrato amanhã.' },
    { id: 'm3', de: 'contacto', texto: 'Combinado, aguardo o contrato.' },
  ],
};

const MOCK_ASSISTENTE = {
  sugestao:
    '“Olá! Sim, o horário das 14h está reservado para vocês. Envio a confirmação formal por e-mail em seguida.”',
  resumo:
    'O cliente pede confirmação de horário para segunda-feira. Já houve alinhamento prévio da equipa sobre disponibilidade à tarde.',
  acao:
    'Enviar confirmação por escrito e atualizar a agenda interna quando o backend estiver ligado.',
};

export default function AtendimentoPage() {
  const [selectedId, setSelectedId] = useState(MOCK_CONTACTS[0]?.id ?? '');
  const [rascunho, setRascunho] = useState('');

  const contacto = useMemo(
    () => MOCK_CONTACTS.find((c) => c.id === selectedId) ?? MOCK_CONTACTS[0],
    [selectedId],
  );

  const mensagens = MOCK_MESSAGES[selectedId] ?? [];

  return (
    <div className="flex min-h-[560px] flex-col overflow-hidden bg-white lg:min-h-[620px] lg:flex-row">
      {/* Coluna esquerda — lista */}
      <aside
        className="flex w-full flex-shrink-0 flex-col border-b border-slate-200 bg-white lg:w-[min(100%,320px)] lg:min-w-[280px] lg:max-w-[320px] lg:border-b-0 lg:border-r"
        aria-label="Lista de conversas"
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">Conversas</h3>
          <p className="text-xs text-slate-500">Dados de demonstração</p>
        </div>
        <ul className="max-h-[240px] flex-1 overflow-y-auto lg:max-h-none">
          {MOCK_CONTACTS.map((c) => {
            const active = c.id === selectedId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full border-b border-slate-50 px-4 py-3 text-left transition ${
                    active
                      ? 'border-l-4 border-l-[#F59E0B] bg-orange-50/80'
                      : 'border-l-4 border-l-transparent hover:bg-slate-50'
                  }`}
                >
                  <p
                    className={`truncate text-sm font-medium ${active ? 'text-amber-950' : 'text-slate-800'}`}
                  >
                    {c.nome}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{c.ultimaMensagem}</p>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Centro — conversa */}
      <section className="flex min-h-[320px] min-w-0 flex-1 flex-col bg-white" aria-label="Conversa">
        <header className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{contacto?.nome ?? '—'}</h3>
          <p className="text-xs text-slate-500">Última mensagem na lista: {contacto?.ultimaMensagem}</p>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/50 px-4 py-4">
          {mensagens.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.de === 'equipa' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  m.de === 'equipa'
                    ? 'rounded-br-md text-white'
                    : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
                }`}
                style={m.de === 'equipa' ? { backgroundColor: BRAND_ORANGE } : undefined}
              >
                {m.texto}
              </div>
            </div>
          ))}
        </div>
        <footer className="border-t border-slate-100 bg-white p-3">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="atendimento-composer">
              Mensagem
            </label>
            <input
              id="atendimento-composer"
              type="text"
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              placeholder="Escreva uma mensagem…"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
            />
            <button
              type="button"
              className="flex-shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm"
              style={{ backgroundColor: BRAND_ORANGE }}
            >
              Enviar
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400">Envio desativado nesta versão.</p>
        </footer>
      </section>

      {/* Coluna direita — Assistente (só em ecrãs largos; em menores, bloco abaixo) */}
      <aside
        className="hidden w-full flex-shrink-0 flex-col border-t border-slate-200 bg-white xl:flex xl:w-[min(100%,360px)] xl:min-w-[300px] xl:max-w-[360px] xl:border-l xl:border-t-0"
        aria-label="Assistente"
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">Assistente</h3>
          <p className="text-xs text-slate-500">Sugestões e resumo (mock)</p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Sugestão de resposta</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{MOCK_ASSISTENTE.sugestao}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resumo</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{MOCK_ASSISTENTE.resumo}</p>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Ação sugerida</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-800">{MOCK_ASSISTENTE.acao}</p>
          </div>
        </div>
      </aside>

      {/* Painel assistente empilhado em ecrãs mais estreitos */}
      <div className="border-t border-slate-200 bg-slate-50 p-4 xl:hidden">
        <h3 className="text-sm font-semibold text-slate-800">Assistente</h3>
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-amber-800">Sugestão de resposta</p>
            <p className="mt-1 text-sm text-slate-700">{MOCK_ASSISTENTE.sugestao}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-500">Resumo</p>
            <p className="mt-1 text-sm text-slate-700">{MOCK_ASSISTENTE.resumo}</p>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
            <p className="text-xs font-semibold text-amber-900">Ação sugerida</p>
            <p className="mt-1 text-sm text-slate-800">{MOCK_ASSISTENTE.acao}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
