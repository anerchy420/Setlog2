// Vlog：その日の動画をつないで1本の動画にする（ブラウザ内で描画して録画）
import { gridDims, slotLabel, fmtDateKey } from './logic.js';

export const ASPECTS = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [960, 960] };
export const FILTERS = {
  none: { name: 'なし', css: 'none' },
  film: { name: 'フィルム', css: 'sepia(.28) contrast(1.08) saturate(1.15) brightness(1.02)' },
  vivid: { name: 'ビビッド', css: 'saturate(1.55) contrast(1.06)' },
  soft: { name: 'ふんわり', css: 'brightness(1.08) saturate(.85) contrast(.92)' },
  mono: { name: 'モノクロ', css: 'grayscale(1) contrast(1.12)' },
};
const OUT_MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

function loadMedia(m) {
  return new Promise((res) => {
    if (!m) return res(null);
    if (m.mime?.startsWith('image')) {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = m.data;
      return;
    }
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    let ok = false;
    v.onloadeddata = () => { ok = true; res(v); };
    v.onerror = () => res(null);
    v.src = m.data;
    setTimeout(() => { if (!ok) res(v.readyState >= 2 ? v : null); }, 6000);
  });
}

const mw = (el) => el.videoWidth || el.naturalWidth || 16;
const mh = (el) => el.videoHeight || el.naturalHeight || 9;
function cover(ctx, el, x, y, w, h, zoom = 1) {
  const s = Math.max(w / mw(el), h / mh(el)) * zoom;
  const dw = mw(el) * s, dh = mh(el) * s;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}
function contain(ctx, el, x, y, w, h, zoom = 1) {
  const s = Math.min(w / mw(el), h / mh(el));
  const dw = mw(el) * s, dh = mh(el) * s;
  const ox = x + (w - dw) / 2, oy = y + (h - dh) / 2;
  ctx.save();
  roundRect(ctx, ox, oy, dw, dh, 28); ctx.clip();
  const zw = dw * zoom, zh = dh * zoom;
  ctx.drawImage(el, ox - (zw - dw) / 2, oy - (zh - dh) / 2, zw, zh);
  ctx.restore();
  return { x: ox, y: oy, w: dw, h: dh };
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function text(ctx, s, x, y, { size = 40, weight = 800, align = 'left', color = '#fff', shadow = true, max = 0 } = {}) {
  ctx.font = `${weight} ${size}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = size * 0.35; ctx.shadowOffsetY = 2; }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y, max || undefined);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
}
function avatar(ctx, info, x, y, r) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = info?.color || '#888'; ctx.fill();
  ctx.font = `${r * 1.15}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(info?.emoji || '🙂', x, y + r * 0.08);
  ctx.restore();
}

// opts: { segments, media: Map(clipId -> {data,mime}), info: {uid: {name,emoji,color}}, title, date, color,
//         aspect, filter, captions, names, speed, clipAudio, bgm(File|null), bgmVolume }
export class VlogPlayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stopFlag = false;
  }
  async prepare(opts) {
    this.o = opts;
    const [W, H] = ASPECTS[opts.aspect] || ASPECTS['9:16'];
    this.canvas.width = W; this.canvas.height = H;
    this.W = W; this.H = H;
    this.els = new Map();
    const ids = [...new Set(opts.segments.flatMap((s) => (s.clips || []).map((c) => c.id)))];
    let n = 0;
    await Promise.all(ids.map(async (id) => {
      this.els.set(id, await loadMedia(opts.media.get(id)));
      opts.onLoad?.(++n / ids.length);
    }));
    this.drawTitle(1);
  }

  // record=true で録画して Blob を返す
  async play({ record = false, onProgress = () => {} } = {}) {
    const o = this.o;
    this.stopFlag = false;
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    await ac.resume().catch(() => {});
    const dest = ac.createMediaStreamDestination();
    const out = (node) => { node.connect(dest); node.connect(ac.destination); };
    const sources = [];
    if (o.bgm) {
      try {
        const buf = await ac.decodeAudioData(await o.bgm.arrayBuffer());
        const src = ac.createBufferSource();
        src.buffer = buf; src.loop = true;
        const g = ac.createGain(); g.gain.value = o.bgmVolume ?? 0.6;
        src.connect(g); out(g);
        sources.push(src);
      } catch { /* 読めない音声 */ }
    }
    const audioNodes = new Map();
    if (o.clipAudio) {
      for (const [id, el] of this.els) {
        if (el instanceof HTMLVideoElement) {
          try {
            el.muted = false;
            const s = ac.createMediaElementSource(el);
            const g = ac.createGain(); g.gain.value = o.bgm ? 0.8 : 1;
            s.connect(g); out(g);
            audioNodes.set(id, g);
          } catch { /* 既に接続済み */ }
        }
      }
    }
    let rec = null, chunks = [], mime = null;
    if (record) {
      mime = OUT_MIMES.find((m) => MediaRecorder.isTypeSupported?.(m));
      const st = this.canvas.captureStream(30);
      dest.stream.getAudioTracks().forEach((t) => st.addTrack(t));
      rec = new MediaRecorder(st, { mimeType: mime, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000 });
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.start(250);
    }
    sources.forEach((s) => s.start());

    const segs = o.segments;
    const speed = o.speed || 1;
    const durs = segs.map((s) => (s.type === 'clip' || s.type === 'grid' ? s.dur / speed : s.dur));
    const total = durs.reduce((a, b) => a + b, 0);
    let elapsed = 0;
    for (let i = 0; i < segs.length && !this.stopFlag; i++) {
      const seg = segs[i];
      const els = (seg.clips || []).map((c) => this.els.get(c.id));
      for (const el of els) {
        if (el instanceof HTMLVideoElement) {
          el.currentTime = 0;
          el.playbackRate = speed;
          el.muted = !o.clipAudio || seg.type === 'grid' && els.length > 1 && el !== els[0];
          el.play().catch(() => {});
        }
      }
      const t0 = performance.now();
      await new Promise((res) => {
        const frame = () => {
          if (this.stopFlag) return res();
          const t = (performance.now() - t0) / 1000;
          const p = Math.min(1, t / durs[i]);
          this.drawSeg(seg, els, p);
          // つなぎ目を短くフェード
          const f = Math.min(t, durs[i] - t);
          if (f < 0.12) { this.ctx.fillStyle = `rgba(0,0,0,${(1 - f / 0.12) * 0.6})`; this.ctx.fillRect(0, 0, this.W, this.H); }
          onProgress((elapsed + Math.min(t, durs[i])) / total);
          if (t >= durs[i]) res(); else requestAnimationFrame(frame);
        };
        frame();
      });
      for (const el of els) if (el instanceof HTMLVideoElement) el.pause();
      elapsed += durs[i];
    }
    sources.forEach((s) => { try { s.stop(); } catch { /* 停止済み */ } });
    let blob = null;
    if (rec) {
      const done = new Promise((r) => { rec.onstop = r; });
      rec.stop();
      await done;
      blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
    }
    for (const g of audioNodes.values()) g.disconnect();
    ac.close().catch(() => {});
    onProgress(1);
    return blob;
  }
  stop() { this.stopFlag = true; }

  drawSeg(seg, els, p) {
    if (seg.type === 'title') return this.drawTitle(p);
    if (seg.type === 'end') return this.drawEnd(p);
    if (seg.type === 'grid') return this.drawGrid(seg, els, p);
    return this.drawClip(seg, els[0], p);
  }
  bg() {
    const { ctx, W, H } = this;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, this.o.color || '#8a6cff');
    g.addColorStop(1, '#111');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  drawTitle(p) {
    const { ctx, W, H, o } = this;
    this.bg();
    const k = Math.min(W, H) / 720;
    const a = Math.min(1, p * 3);
    ctx.globalAlpha = a;
    ctx.font = `${170 * k}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.emoji || '📸', W / 2, H * 0.36 - (1 - a) * 30);
    text(ctx, o.title || 'setlog', W / 2, H * 0.36 + 150 * k, { size: 64 * k, align: 'center', max: W * 0.9 });
    text(ctx, fmtDateKey(o.date, true), W / 2, H * 0.36 + 215 * k, { size: 34 * k, weight: 600, align: 'center', color: 'rgba(255,255,255,.85)' });
    const ids = o.order.filter((u) => o.info[u]).slice(0, 12);
    const r = 30 * k, gap = 12 * k;
    const tw = ids.length * (r * 2 + gap) - gap;
    ids.forEach((u, i) => avatar(ctx, o.info[u], W / 2 - tw / 2 + r + i * (r * 2 + gap), H * 0.36 + 290 * k, r));
    ctx.globalAlpha = 1;
  }
  drawEnd(p) {
    const { ctx, W, H, o } = this;
    this.bg();
    const k = Math.min(W, H) / 720;
    ctx.globalAlpha = Math.min(1, p * 3);
    text(ctx, 'また明日', W / 2, H / 2 - 10 * k, { size: 72 * k, align: 'center' });
    text(ctx, `${o.stats}`, W / 2, H / 2 + 60 * k, { size: 32 * k, weight: 600, align: 'center', color: 'rgba(255,255,255,.85)' });
    text(ctx, 'setlog2', W / 2, H - 60 * k, { size: 28 * k, weight: 700, align: 'center', color: 'rgba(255,255,255,.6)' });
    ctx.globalAlpha = 1;
  }
  drawClip(seg, el, p) {
    const { ctx, W, H, o } = this;
    const c = seg.clips[0];
    const info = o.info[c.uid] || {};
    const k = Math.min(W, H) / 720;
    const zoom = el instanceof HTMLImageElement ? 1 + p * 0.06 : 1;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!el) { text(ctx, '読み込めませんでした', W / 2, H / 2, { size: 30 * k, align: 'center' }); return; }
    ctx.filter = FILTERS[o.filter]?.css || 'none';
    let box;
    if (W / H < 1.2) {
      // 縦・正方形：ぼかした背景＋中央に動画
      ctx.save(); ctx.filter = `${ctx.filter === 'none' ? '' : ctx.filter} blur(40px) brightness(.6)`; cover(ctx, el, -40, -40, W + 80, H + 80); ctx.restore();
      ctx.filter = FILTERS[o.filter]?.css || 'none';
      box = contain(ctx, el, 28 * k, 0, W - 56 * k, H, zoom);
    } else {
      cover(ctx, el, 0, 0, W, H, zoom);
      box = { x: 0, y: 0, w: W, h: H };
      const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.filter = 'none';
    const vertical = W / H < 1.2;
    const tx = vertical ? W / 2 : 40 * k;
    const al = vertical ? 'center' : 'left';
    const ty = vertical ? box.y - 40 * k : H - 120 * k;
    text(ctx, slotLabel(seg.slot), tx, ty, { size: (vertical ? 96 : 76) * k, align: al });
    if (o.names) {
      const ny = vertical ? box.y + box.h + 70 * k : H - 48 * k;
      if (vertical) {
        avatar(ctx, info, W / 2 - ctx.measureText(info.name || '').width / 2 - 34 * k, ny - 14 * k, 22 * k);
        text(ctx, info.name || '', W / 2 + 10 * k, ny, { size: 36 * k, weight: 700, align: 'center' });
      } else {
        avatar(ctx, info, tx + 22 * k, ny - 13 * k, 22 * k);
        text(ctx, info.name || '', tx + 56 * k, ny, { size: 34 * k, weight: 700 });
      }
    }
    if (o.captions && c.caption) {
      const cy = vertical ? box.y + box.h + 130 * k : H - 48 * k;
      text(ctx, c.caption, vertical ? W / 2 : W - 40 * k, cy, { size: 38 * k, weight: 700, align: vertical ? 'center' : 'right', max: W * 0.86 });
    }
  }
  drawGrid(seg, els, p) {
    const { ctx, W, H, o } = this;
    const k = Math.min(W, H) / 720;
    ctx.fillStyle = '#0c0c0f'; ctx.fillRect(0, 0, W, H);
    const top = W / H < 1.2 ? 150 * k : 0;
    const { cols, rows } = gridDims(els.length, W, H - top);
    const gap = 6 * k;
    const cw = (W - gap * (cols + 1)) / cols, ch = (H - top - gap * (rows + 1)) / rows;
    ctx.filter = FILTERS[o.filter]?.css || 'none';
    seg.clips.forEach((c, i) => {
      const el = els[i];
      const x = gap + (i % cols) * (cw + gap), y = top + gap + Math.floor(i / cols) * (ch + gap);
      ctx.save(); roundRect(ctx, x, y, cw, ch, 14 * k); ctx.clip();
      if (el) cover(ctx, el, x, y, cw, ch, el instanceof HTMLImageElement ? 1 + p * 0.05 : 1);
      ctx.restore();
    });
    ctx.filter = 'none';
    seg.clips.forEach((c, i) => {
      const x = gap + (i % cols) * (cw + gap), y = top + gap + Math.floor(i / cols) * (ch + gap);
      const s = Math.max(16, Math.min(28 * k, ch / 7));
      if (o.names) {
        avatar(ctx, o.info[c.uid], x + 12 + s * 0.6, y + 12 + s * 0.6, s * 0.6);
        text(ctx, o.info[c.uid]?.name || '', x + 18 + s * 1.3, y + 12 + s * 0.95, { size: s * 0.8, weight: 700, max: cw - s * 2 });
      }
      if (o.captions && c.caption) text(ctx, c.caption, x + cw / 2, y + ch - 14, { size: s * 0.85, weight: 700, align: 'center', max: cw - 20 });
    });
    if (top) text(ctx, slotLabel(seg.slot), W / 2, top - 40 * k, { size: 90 * k, align: 'center' });
    else text(ctx, slotLabel(seg.slot), W / 2, H / 2 + 30 * k, { size: 80 * k, align: 'center' });
  }
}

export function canExportVideo() {
  return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream && OUT_MIMES.some((m) => MediaRecorder.isTypeSupported?.(m));
}
