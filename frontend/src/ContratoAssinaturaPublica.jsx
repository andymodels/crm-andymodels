import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { API_BASE } from './apiConfig'

export default function ContratoAssinaturaPublica() {
  const [searchParams] = useSearchParams()
  const token = useMemo(() => (searchParams.get('token') || '').trim(), [searchParams])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [status, setStatus] = useState(null)
  const [nome, setNome] = useState('')
  const [documento, setDocumento] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [okMsg, setOkMsg] = useState('')

  useEffect(() => {
    let ativo = true
    async function run() {
      if (!token) {
        if (ativo) {
          setErro('Link inválido.')
          setLoading(false)
        }
        return
      }
      try {
        const res = await fetch(`${API_BASE}/public/contratos/validar?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (!res.ok || !data.valid) throw new Error(data.message || 'Link inválido.')
        if (ativo) setStatus(data)
      } catch (e) {
        if (ativo) setErro(e?.message || 'Não foi possível validar o contrato.')
      } finally {
        if (ativo) setLoading(false)
      }
    }
    run()
    return () => {
      ativo = false
    }
  }, [token])

  const onAssinar = async (event) => {
    event.preventDefault()
    if (!token) return
    setErro('')
    setOkMsg('')
    setSalvando(true)
    try {
      const res = await fetch(`${API_BASE}/public/contratos/assinar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          nome_assinante: nome,
          documento_assinante: documento,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Falha ao assinar contrato.')
      setOkMsg(data.message || 'Contrato assinado com sucesso.')
      setStatus((prev) => ({ ...(prev || {}), assinado: true, contrato_status: 'assinado' }))
    } catch (e) {
      setErro(e?.message || 'Erro ao assinar contrato.')
    } finally {
      setSalvando(false)
    }
  }

  if (loading) return <main className="mx-auto max-w-4xl p-6 text-sm text-slate-600">Carregando contrato...</main>
  if (erro) return <main className="mx-auto max-w-4xl p-6 text-sm text-red-700">{erro}</main>

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-900">Assinatura de contrato</h1>
        <p className="mt-1 text-sm text-slate-600">O.S. #{status?.os_id}</p>
        {status?.assinado ? (
          <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Este contrato já está assinado.
          </p>
        ) : (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Revise o documento abaixo e assine para concluir.
          </p>
        )}
      </section>

      <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <iframe
          title="Contrato"
          src={`${API_BASE}/public/contratos/documento?token=${encodeURIComponent(token)}`}
          className="h-[70vh] w-full"
        />
      </section>

      {!status?.assinado && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={onAssinar}>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block">Nome do assinante *</span>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block">CPF/CNPJ (opcional)</span>
              <input
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="md:col-span-2">
              {okMsg ? (
                <p className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {okMsg}
                </p>
              ) : null}
              {erro ? (
                <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>
              ) : null}
              <button
                type="submit"
                disabled={salvando}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {salvando ? 'Assinando...' : 'Assinar contrato'}
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  )
}
