/**
 * Página placeholder do módulo Website (sem ligação a API).
 */
export default function WebsitePlaceholderPage({ title }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      <p className="mt-2 text-sm text-slate-500">Conteúdo em definição.</p>
    </section>
  );
}
