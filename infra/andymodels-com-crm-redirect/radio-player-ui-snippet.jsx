/**
 * Snippets de UI para o AndyRadio no andymodels.com (não faz parte do build do CRM).
 * Copiar e integrar no site: ligação apenas visual — a lógica de áudio continua no vosso player.
 *
 * Dados: GET {CRM}/api/radio | /api/public/radio | /api/public/radio/v2
 *   playlist_cover_url (e cover_url) · curator_name · curator_instagram
 *   fetch com cache: 'no-store'. Ver radioPublicJson.js.
 */

const ORANGE = '#F27121';

/**
 * Curadoria só a partir da API (playlist.curator_name / playlist.curator_instagram).
 * Sem texto de marca fixa. Se curator_name vazio → não renderiza nada.
 */
export function RadioCuratorLine({ curatorName, curatorInstagram }) {
  const name = curatorName != null ? String(curatorName).trim() : '';
  const ig = curatorInstagram != null ? String(curatorInstagram).trim() : '';
  if (!name) return null;
  const inner = <>Curadoria by {name}</>;
  if (ig) {
    return (
      <a href={ig} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-700 underline hover:text-slate-900">
        {inner}
      </a>
    );
  }
  return <span className="text-sm text-slate-700">{inner}</span>;
}

/** Atalho: lê curator_name e curator_instagram do objeto playlist (JSON público ou CRM). */
export function RadioCuratorFromPlaylist({ playlist }) {
  if (!playlist || typeof playlist !== 'object') return null;
  return (
    <RadioCuratorLine
      curatorName={playlist.curator_name}
      curatorInstagram={playlist.curator_instagram}
    />
  );
}

/**
 * Barra de progresso (seek). O pai calcula `value01` (0–1) a partir de audio.currentTime / duration
 * e chama `onSeek01` com o novo valor (definir audio.currentTime = value01 * duration).
 *
 * Não altera a lógica do áudio — só input range estilizado.
 */
export function RadioSeekBar({
  value01,
  onSeek01,
  disabled,
  className = '',
}) {
  const v = Math.max(0, Math.min(1000, Math.round((Number(value01) || 0) * 1000)));
  const pct = `${(v / 1000) * 100}%`;
  return (
    <input
      type="range"
      min={0}
      max={1000}
      step={1}
      value={v}
      disabled={disabled}
      onChange={(e) => onSeek01(Number(e.target.value) / 1000)}
      aria-label="Posição na faixa"
      className={[
        'andy-radio-seek w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      ].join(' ')}
      style={{ accentColor: ORANGE, ['--seek-pct']: pct }}
    />
  );
}

/**
 * Incluir no CSS global do site (ou módulo) para o aspeto pedido:
 * trilho cinza claro, preenchimento laranja, thumb visível. WebKit + Firefox.
 */
export const RADIO_SEEK_BAR_CSS = `
.andy-radio-seek {
  height: 20px;
}
.andy-radio-seek::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    ${ORANGE} 0%,
    ${ORANGE} var(--seek-pct, 0%),
    #e5e7eb var(--seek-pct, 0%),
    #e5e7eb 100%
  );
}
.andy-radio-seek::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: #fff;
  border: 2px solid ${ORANGE};
  margin-top: -6px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
}
.andy-radio-seek::-moz-range-track {
  height: 3px;
  border-radius: 9999px;
  background: #e5e7eb;
}
.andy-radio-seek::-moz-range-progress {
  height: 3px;
  border-radius: 9999px;
  background: ${ORANGE};
}
.andy-radio-seek::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: #fff;
  border: 2px solid ${ORANGE};
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
}
`;

/**
 * Ícones secundários: preferir `text-slate-700` ou `text-white/90` em fundo escuro,
 * em vez de `text-slate-400` (muito apagado).
 */
