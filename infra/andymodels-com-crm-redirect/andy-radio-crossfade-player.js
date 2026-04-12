/**
 * Player de fila com crossfade estilo rádio (dois elementos Audio).
 * Sobreposição: os últimos N segundos da faixa atual com os primeiros N da seguinte,
 * com fade-out / fade-in linear (volume). N padrão = 20; em faixas curtas, N = min(20, duração).
 *
 * Uso no site (Vite/React): copiar este ficheiro para o projeto do andymodels.com e importar:
 *   import { AndyRadioCrossfadePlayer } from './andy-radio-crossfade-player.js';
 *
 * Não depende do CRM em runtime — só precisa de objetos de faixa com `.url` (https).
 */

/** @typedef {{ url: string, title?: string, artist?: string, [k: string]: unknown }} RadioTrack */

export class AndyRadioCrossfadePlayer {
  /**
   * @param {object} [options]
   * @param {number} [options.crossfadeSec=20] — duração do overlap (segundos)
   * @param {(track: RadioTrack, index: number) => void} [options.onTrackChange] — faixa que o ouvinte ouve a seguir (início de cada faixa)
   * @param {() => void} [options.onQueueEnd] — fila terminou
   * @param {(err: unknown) => void} [options.onError]
   */
  constructor(options = {}) {
    this.crossfadeMaxSec = Number(options.crossfadeSec) > 0 ? Number(options.crossfadeSec) : 20;
    this.onTrackChange = typeof options.onTrackChange === 'function' ? options.onTrackChange : () => {};
    this.onQueueEnd = typeof options.onQueueEnd === 'function' ? options.onQueueEnd : () => {};
    this.onError = typeof options.onError === 'function' ? options.onError : () => {};

    /** @type {HTMLAudioElement} */
    this.primary = new Audio();
    /** @type {HTMLAudioElement} */
    this.secondary = new Audio();
    this.primary.preload = 'auto';
    this.secondary.preload = 'auto';

    /** @type {RadioTrack[]} */
    this.queue = [];
    this.index = 0;
    /** @type {'idle'|'playing'|'crossfading'} */
    this.mode = 'idle';

    this._raf = 0;
    this._crossfadeStart = 0;
    this._crossfadeMs = 0;

    this._tickPlayback = this._tickPlayback.bind(this);
    this._tickCrossfade = this._tickCrossfade.bind(this);

    /** Só reage ao elemento que for o «primary» atual (mudamos a referência em cada crossfade). */
    this._endedOnTarget = (e) => {
      if (e.target !== this.primary) return;
      this._onEndedPrimary();
    };
    this.primary.addEventListener('ended', this._endedOnTarget);
    this.secondary.addEventListener('ended', this._endedOnTarget);
  }

  /**
   * @param {RadioTrack[]} tracks
   * @param {number} [startIndex=0]
   */
  setQueue(tracks, startIndex = 0) {
    this.stop();
    this.queue = Array.isArray(tracks) ? tracks.filter((t) => t && typeof t.url === 'string') : [];
    this.index = Math.max(0, Math.min(startIndex | 0, this.queue.length - 1));
  }

  get currentIndex() {
    return this.index;
  }

  get currentTrack() {
    return this.queue[this.index] || null;
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this.mode = 'idle';
    this.primary.pause();
    this.secondary.pause();
    this.primary.removeAttribute('src');
    this.secondary.removeAttribute('src');
    this.primary.volume = 1;
    this.secondary.volume = 1;
  }

  async play() {
    if (this.queue.length === 0) return;
    this.stop();
    this.mode = 'playing';
    await this._playIndex(this.index);
  }

  /**
   * @param {number} i
   */
  async _playIndex(i) {
    const t = this.queue[i];
    if (!t?.url) return;
    this.primary.src = t.url;
    this.primary.volume = 1;
    try {
      await this.primary.play();
    } catch (e) {
      this.mode = 'idle';
      this.onError(e);
      return;
    }
    this.onTrackChange(t, i);
    this._raf = requestAnimationFrame(this._tickPlayback);
  }

  _onEndedPrimary() {
    if (this.mode === 'crossfading') return;
    if (this.index >= this.queue.length - 1) {
      this.mode = 'idle';
      this.onQueueEnd();
      return;
    }
    this.index += 1;
    this.mode = 'playing';
    void this._playIndex(this.index);
  }

  _tickPlayback() {
    if (this.mode !== 'playing') return;
    const out = this.primary;
    if (out.paused) return;

    const dur = out.duration;
    const ct = out.currentTime;
    if (!Number.isFinite(dur) || dur <= 0) {
      this._raf = requestAnimationFrame(this._tickPlayback);
      return;
    }

    const nextIdx = this.index + 1;
    if (nextIdx >= this.queue.length) {
      this._raf = requestAnimationFrame(this._tickPlayback);
      return;
    }

    const cross = computeCrossfadeSec(dur, this.crossfadeMaxSec);
    const startAt = dur - cross;
    if (ct >= startAt - 0.02) {
      cancelAnimationFrame(this._raf);
      void this._beginCrossfade(cross);
      return;
    }

    this._raf = requestAnimationFrame(this._tickPlayback);
  }

  /**
   * @param {number} crossSec
   */
  async _beginCrossfade(crossSec) {
    if (this.mode !== 'playing') return;
    const nextIdx = this.index + 1;
    if (nextIdx >= this.queue.length) return;

    const next = this.queue[nextIdx];
    if (!next?.url) return;

    this.mode = 'crossfading';
    this.secondary.src = next.url;
    this.secondary.volume = 0;
    this.secondary.currentTime = 0;

    try {
      await this.secondary.play();
    } catch (e) {
      this.mode = 'playing';
      this.onError(e);
      this._raf = requestAnimationFrame(this._tickPlayback);
      return;
    }

    this.index = nextIdx;
    this.onTrackChange(next, nextIdx);

    this._crossfadeMs = Math.max(80, crossSec * 1000);
    this._crossfadeStart = performance.now();
    this._raf = requestAnimationFrame(this._tickCrossfade);
  }

  _tickCrossfade() {
    if (this.mode !== 'crossfading') return;

    const elapsed = performance.now() - this._crossfadeStart;
    const p = Math.min(1, elapsed / this._crossfadeMs);

    this.primary.volume = Math.max(0, 1 - p);
    this.secondary.volume = Math.min(1, p);

    if (p < 1) {
      this._raf = requestAnimationFrame(this._tickCrossfade);
      return;
    }

    this.primary.pause();
    this.primary.removeAttribute('src');
    this.primary.volume = 1;

    const tmp = this.primary;
    this.primary = this.secondary;
    this.secondary = tmp;
    this.secondary.volume = 1;
    this.secondary.pause();
    this.secondary.removeAttribute('src');

    this.mode = 'playing';
    this._raf = requestAnimationFrame(this._tickPlayback);
  }
}

/**
 * Duração do overlap: até crossfadeMax, mas nunca maior que a duração da faixa.
 * @param {number} durationSec
 * @param {number} crossfadeMaxSec
 */
export function computeCrossfadeSec(durationSec, crossfadeMaxSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return Math.min(20, crossfadeMaxSec);
  const cap = Math.min(crossfadeMaxSec, durationSec);
  return Math.max(0.05, cap);
}
