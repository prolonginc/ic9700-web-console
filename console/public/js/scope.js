// The spectrum line and the waterfall beneath it. Both are fed by the radio's
// own scope sweeps, so what you see is what the radio's screen shows.

const HISTORY_ROWS = 480; // sweeps kept; the radio sends about eight a second
const ROW_CSS_PX = 2; // on-screen height of one sweep
const LEVEL_RANGE = 58; // sweep units between "noise" and "full brightness"
const WHEEL_TUNE_THRESHOLD = 40;
const WHEEL_ZOOM_THRESHOLD = 24;

// Waterfall colors, quiet to loud. Starts at the screen's own background so
// an empty band looks empty.
const PALETTE_STOPS = [
  [0.0, [10, 28, 41]],
  [0.22, [22, 62, 110]],
  [0.45, [24, 150, 178]],
  [0.68, [240, 214, 92]],
  [0.86, [250, 132, 40]],
  [1.0, [255, 250, 240]],
];

function buildPalette() {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 1;
    while (k < PALETTE_STOPS.length - 1 && t > PALETTE_STOPS[k][0]) k++;
    const [t0, c0] = PALETTE_STOPS[k - 1];
    const [t1, c1] = PALETTE_STOPS[k];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(c0[c] + (c1[c] - c0[c]) * f);
  }
  return lut;
}

function niceStep(spanHz) {
  const steps = [500, 1e3, 2e3, 5e3, 1e4, 2.5e4, 5e4, 1e5, 2e5, 5e5, 1e6];
  return steps.find((s) => spanHz / s <= 8) || 1e6;
}

function decimalsFor(stepHz) {
  for (let d = 0; d <= 6; d++) {
    const v = (stepHz / 1e6) * 10 ** d;
    if (Math.abs(v - Math.round(v)) < 1e-9) return d;
  }
  return 6;
}

export class Scope {
  // els: { area, spectrum, waterfall, axis, marker, hover, hoverLabel }
  // hooks: { getStep, onPick(freqHz), onTune(direction), onZoom(direction) }
  constructor(els, hooks) {
    this.els = els;
    this.hooks = hooks;
    this.palette = buildPalette();
    this.start = 0;
    this.end = 0;
    this.bins = 0;
    this.line = null; // smoothed copy of the latest sweep, for the spectrum
    this.floor = null; // running estimate of the noise level
    this.freq = 0;
    this.history = document.createElement('canvas');
    this.historyCtx = this.history.getContext('2d', { willReadFrequently: false });
    this.row = null;
    this.dirty = false;
    this.wheelTune = 0;
    this.wheelZoom = 0;
    this.axisKey = '';

    new ResizeObserver(() => this.resize()).observe(els.area);
    this.resize();

    els.area.addEventListener('pointermove', (e) => this.onHover(e));
    els.area.addEventListener('pointerleave', () => {
      els.hover.hidden = true;
    });
    els.area.addEventListener('click', (e) => {
      if (e.target.closest('button, .scope-zoom, .scope-tag')) return;
      const f = this.freqAt(e.clientX);
      if (f) hooks.onPick(f);
    });
    els.area.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    const draw = () => {
      if (this.dirty) {
        this.dirty = false;
        this.render();
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  get span() {
    return this.end - this.start;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.els.spectrum, this.els.waterfall]) {
      const w = Math.max(1, Math.round(c.clientWidth * dpr));
      const h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
    this.dirty = true;
  }

  // One sweep from the radio.
  push({ start, end, pixels }) {
    if (!(end > start) || pixels.length === 0) return;
    const prevStart = this.start;
    const prevSpan = this.span;

    if (pixels.length !== this.bins) {
      this.bins = pixels.length;
      this.history.width = this.bins;
      this.history.height = HISTORY_ROWS;
      this.row = this.historyCtx.createImageData(this.bins, 1);
      this.line = null;
    }
    this.start = start;
    this.end = end;
    const span = end - start;
    const ctx = this.historyCtx;

    // Keep old sweeps lined up with the new frequency scale.
    if (prevSpan > 0) {
      if (Math.abs(prevSpan - span) > span * 1e-3) {
        ctx.clearRect(0, 0, this.bins, HISTORY_ROWS); // zoom changed: start over
        this.line = null;
      } else {
        const dx = Math.round(((prevStart - start) / span) * this.bins);
        if (Math.abs(dx) >= this.bins) {
          ctx.clearRect(0, 0, this.bins, HISTORY_ROWS);
          this.line = null;
        } else if (dx !== 0) {
          ctx.globalCompositeOperation = 'copy';
          ctx.drawImage(this.history, dx, 0);
          ctx.globalCompositeOperation = 'source-over';
          this.line = null;
        }
      }
    }

    // Noise level: the 30th percentile of the sweep, eased so it doesn't jump.
    const sorted = Uint8Array.from(pixels).sort();
    const noise = sorted[Math.floor(sorted.length * 0.3)];
    this.floor = this.floor === null ? noise : this.floor + (noise - this.floor) * 0.08;

    // Newest sweep goes on top; everything else moves down one row.
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.history, 0, 1);
    ctx.globalCompositeOperation = 'source-over';
    const data = this.row.data;
    const lut = this.palette;
    for (let i = 0; i < this.bins; i++) {
      const level = Math.max(0, Math.min(1, (pixels[i] - this.floor) / LEVEL_RANGE));
      const p = Math.round(level * 255) * 3;
      data[i * 4] = lut[p];
      data[i * 4 + 1] = lut[p + 1];
      data[i * 4 + 2] = lut[p + 2];
      data[i * 4 + 3] = 255;
    }
    ctx.putImageData(this.row, 0, 0);

    if (!this.line || this.line.length !== this.bins) {
      this.line = Float32Array.from(pixels);
    } else {
      for (let i = 0; i < this.bins; i++) this.line[i] += (pixels[i] - this.line[i]) * 0.55;
    }

    this.updateAxis();
    this.updateMarker();
    this.dirty = true;
  }

  setFrequency(freqHz) {
    this.freq = freqHz;
    this.updateMarker();
  }

  clear() {
    if (this.bins) this.historyCtx.clearRect(0, 0, this.bins, HISTORY_ROWS);
    this.line = null;
    this.dirty = true;
  }

  updateMarker() {
    const { marker } = this.els;
    if (!(this.span > 0) || !this.freq) {
      marker.hidden = true;
      return;
    }
    const x = (this.freq - this.start) / this.span;
    marker.hidden = x < 0 || x > 1;
    marker.style.left = `${(x * 100).toFixed(3)}%`;
  }

  updateAxis() {
    const key = `${Math.round(this.start / 10)}:${Math.round(this.end / 10)}`;
    if (key === this.axisKey) return;
    this.axisKey = key;
    const step = niceStep(this.span);
    const decimals = Math.max(1, decimalsFor(step));
    const frag = document.createDocumentFragment();
    for (let f = Math.ceil(this.start / step) * step; f <= this.end; f += step) {
      const x = (f - this.start) / this.span;
      if (x < 0.03 || x > 0.97) continue; // keep labels off the edges
      const tick = document.createElement('span');
      tick.className = 'axis-tick';
      tick.style.left = `${(x * 100).toFixed(3)}%`;
      tick.textContent = (f / 1e6).toFixed(decimals);
      frag.appendChild(tick);
    }
    this.els.axis.replaceChildren(frag);
  }

  freqAt(clientX) {
    if (!(this.span > 0)) return 0;
    const rect = this.els.area.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    if (x < 0 || x > 1) return 0;
    const step = this.hooks.getStep();
    return Math.round((this.start + x * this.span) / step) * step;
  }

  onHover(e) {
    const { hover, hoverLabel, area } = this.els;
    if (e.target.closest('button, .scope-zoom, .scope-tag')) {
      hover.hidden = true;
      return;
    }
    const f = this.freqAt(e.clientX);
    if (!f) {
      hover.hidden = true;
      return;
    }
    const rect = area.getBoundingClientRect();
    const x = (f - this.start) / this.span;
    hover.hidden = false;
    hover.style.left = `${(x * 100).toFixed(3)}%`;
    hoverLabel.textContent = `${(f / 1e6).toFixed(3)} MHz`;
    // Flip the label to the left of the line near the right edge.
    hover.classList.toggle('flip', x * rect.width > rect.width - 130);
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      // Trackpad pinch arrives as a wheel event with ctrlKey set.
      this.wheelZoom += e.deltaY;
      if (Math.abs(this.wheelZoom) >= WHEEL_ZOOM_THRESHOLD) {
        this.hooks.onZoom(this.wheelZoom < 0 ? 1 : -1);
        this.wheelZoom = 0;
      }
      return;
    }
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : -e.deltaX;
    this.wheelTune += delta;
    if (Math.abs(this.wheelTune) >= WHEEL_TUNE_THRESHOLD) {
      this.hooks.onTune(this.wheelTune < 0 ? 1 : -1);
      this.wheelTune = 0;
    }
  }

  render() {
    this.renderSpectrum();
    this.renderWaterfall();
  }

  renderSpectrum() {
    const c = this.els.spectrum;
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    if (!this.line || this.floor === null) return;

    const n = this.bins;
    const range = LEVEL_RANGE + 14;
    const yFor = (v) => {
      const level = Math.max(0, Math.min(1, (v - this.floor + 8) / range));
      return h - 2 - level * (h - 6);
    };
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < n; i++) ctx.lineTo((i / (n - 1)) * w, yFor(this.line[i]));
    ctx.lineTo(w, h);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(94, 200, 222, 0.55)');
    fill.addColorStop(1, 'rgba(94, 200, 222, 0.04)');
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = yFor(this.line[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#9fe3f0';
    ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 1.1);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  renderWaterfall() {
    const c = this.els.waterfall;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (!this.bins) return;
    const dpr = window.devicePixelRatio || 1;
    const rows = Math.min(HISTORY_ROWS, Math.ceil(c.height / (ROW_CSS_PX * dpr)));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.history, 0, 0, this.bins, rows, 0, 0, c.width, rows * ROW_CSS_PX * dpr);
  }
}
