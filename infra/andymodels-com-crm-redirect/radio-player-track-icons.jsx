/**
 * Ícones «faixa anterior» vs «faixa seguinte» (direcções opostas).
 * Copiar para o projeto do andymodels.com e substituir os SVG/buttons onde os dois ícones estavam iguais.
 *
 * Anterior: barra vertical à esquerda + triângulo a apontar para a esquerda.
 * Seguinte: triângulo a apontar para a direita + barra vertical à direita.
 */

export function IconTrackPrevious({ className = 'h-6 w-6' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      {/* Barra | à esquerda; triângulo ◀ (ponta x=9) */}
      <path d="M5 5h2.5v14H5V5z" />
      <path d="M16 6v12L9 12 16 6z" />
    </svg>
  );
}

export function IconTrackNext({ className = 'h-6 w-6' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      {/* Triângulo ▶ (ponta x=15); barra à direita */}
      <path d="M8 6v12L15 12 8 6z" />
      {/* Barra | à direita */}
      <path d="M16.5 5H19v14h-2.5V5z" />
    </svg>
  );
}
