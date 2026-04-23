import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE, fetchWithTimeout } from './apiConfig';
import { WebsiteMediaImg, buildMediaItems, mediaItemThumbOrUrl } from './components/WebsiteMediaImage';
import WebsitePublicVideoEmbed from './components/WebsitePublicVideoEmbed';
import { getWebsiteModelPublicUrl, isDirectVideoFileUrl, normalizeHttpUrl } from './utils/websiteMediaDisplay';

/**
 * Página pública (sem login): link «secreto» com token na query.
 * A mídia vem do site (API admin) ou, em último caso, da cópia em `perfil_site` no CRM.
 */
export default function PublicModeloVitrine() {
  const [searchParams] = useSearchParams();
  const token = String(searchParams.get('t') || '').trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setLoading(false);
        setError('Link incompleto (falta o token na URL).');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const url = `${API_BASE}/public/modelo-vitrine?t=${encodeURIComponent(token)}`;
        const r = await fetchWithTimeout(url);
        const raw = await r.text();
        let json;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = null;
        }
        if (!r.ok) {
          const msg = json && typeof json.message === 'string' ? json.message : `Erro HTTP ${r.status}`;
          throw new Error(msg);
        }
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Nao foi possivel carregar.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const mediaDisplay = useMemo(() => {
    if (!data || typeof data !== 'object') return [];
    const wrapped = { media: data.media };
    return buildMediaItems(wrapped);
  }, [data]);

  const medidasLinha = useMemo(() => {
    const m = data?.medidas && typeof data.medidas === 'object' ? data.medidas : {};
    const pairs = [
      ['Alt.', m.medida_altura],
      ['Busto', m.medida_busto],
      ['Manequim', m.medida_torax],
      ['Cint.', m.medida_cintura],
      ['Quadril', m.medida_quadril],
      ['Sap.', m.medida_sapato],
      ['Cabelo', m.medida_cabelo],
      ['Olhos', m.medida_olhos],
    ];
    return pairs
      .filter(([, v]) => v && String(v).trim())
      .map(([k, v]) => `${k} ${String(v).trim()}`)
      .join(' · ');
  }, [data]);

  const urlPublico =
    data?.slug && data?.ativo_na_vitrine ? getWebsiteModelPublicUrl(String(data.slug).trim()) : '';

  const videoExtra = data?.video_url ? String(data.video_url).trim() : '';

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 text-stone-600">
        A carregar pré-visualização…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-stone-100 px-4 text-center">
        <p className="text-lg font-semibold text-stone-800">Não foi possível abrir esta página</p>
        <p className="max-w-md text-sm text-stone-600">{error || 'Dados em falta.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 pb-16 pt-8">
      <div className="mx-auto max-w-4xl px-4">
        <div className="mb-6 rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong>Pré-visualização confidencial</strong> — partilhe só com quem deve ver esta ficha. Quando o modelo estiver{' '}
          <em>ativo na vitrine</em>
          {urlPublico ? (
            <>
              , o perfil público é o mesmo conteúdo em{' '}
              <a className="font-medium underline" href={urlPublico} target="_blank" rel="noreferrer">
                {urlPublico}
              </a>
              .
            </>
          ) : (
            ' no site institucional, o endereço público passará a mostrar o mesmo perfil.'
          )}
        </div>

        <header className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900">{data.nome_exibicao}</h1>
          {data.slug ? (
            <p className="mt-1 text-sm text-stone-500">
              Slug: <span className="font-mono text-stone-700">{data.slug}</span>
            </p>
          ) : null}
          {medidasLinha ? <p className="mt-3 text-sm text-stone-700">{medidasLinha}</p> : null}
        </header>

        {data.bio ? (
          <p className="mx-auto mt-6 max-w-2xl whitespace-pre-wrap text-center text-stone-800">{data.bio}</p>
        ) : null}

        {data.instagram ? (
          <p className="mt-4 text-center text-sm">
            <a
              href={
                /^https?:\/\//i.test(String(data.instagram).trim())
                  ? String(data.instagram).trim()
                  : normalizeHttpUrl(`instagram.com/${String(data.instagram).replace(/^@/, '').replace(/^.*instagram\.com\//i, '')}`)
              }
              target="_blank"
              rel="noreferrer"
              className="font-medium text-amber-800 underline"
            >
              @{String(data.instagram).replace(/^@/, '').replace(/^.*instagram\.com\//i, '')}
            </a>
          </p>
        ) : null}

        {videoExtra ? (
          <div className="relative mx-auto mt-8 aspect-video max-w-3xl overflow-hidden rounded-2xl border border-stone-200 bg-black shadow-lg">
            <WebsitePublicVideoEmbed url={videoExtra} />
          </div>
        ) : null}

        <div className="mt-10 grid grid-cols-2 gap-2 sm:grid-cols-3 md:gap-3">
          {mediaDisplay.map((item, i) => {
            if (item == null) return null;
            const type = item.type != null ? String(item.type).trim() : 'image';
            const { url: vidUrl } = mediaItemThumbOrUrl(item);
            const u = vidUrl || '';
            if (type === 'video' && isDirectVideoFileUrl(u)) {
              return (
                <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-stone-200 bg-black">
                  <video src={u} className="h-full w-full object-cover" controls playsInline muted />
                </div>
              );
            }
            if (type === 'video') {
              return (
                <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-stone-200 bg-black shadow">
                  <WebsitePublicVideoEmbed item={item} url={u} />
                </div>
              );
            }
            return (
              <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-stone-200 bg-stone-200 shadow">
                <WebsiteMediaImg item={item} className="h-full w-full object-cover" alt="" />
              </div>
            );
          })}
        </div>

        {mediaDisplay.length === 0 && !videoExtra ? (
          <p className="mt-10 text-center text-sm text-stone-500">Sem mídia para mostrar nesta pré-visualização.</p>
        ) : null}

        <p className="mt-12 text-center text-xs text-stone-400">Andy Models · pré-visualização interna</p>
      </div>
    </div>
  );
}
