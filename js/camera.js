// カメラ：2秒の動画を横長(16:9)・小さめの容量で撮る。動画が撮れない端末では写真にする
const W = 640, H = 360; // 保存サイズ（1本 100〜250KB 程度）

const MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
export function pickMime(list = MIMES) {
  if (typeof MediaRecorder === 'undefined') return null;
  return list.find((m) => MediaRecorder.isTypeSupported?.(m)) || null;
}

const toDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

export class Camera {
  constructor(videoEl) {
    this.video = videoEl;
    this.facing = 'user';
    this.stream = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.raf = 0;
  }
  async start(facing = this.facing) {
    this.stopStream();
    this.facing = facing;
    const want = (audio) => navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio,
    });
    try {
      this.stream = await want(true);
      this.hasAudio = true;
    } catch {
      this.stream = await want(false); // マイクが使えなければ映像だけ
      this.hasAudio = false;
    }
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => {});
    this.video.classList.toggle('mirror', facing === 'user');
    this.loop();
  }
  flip() { return this.start(this.facing === 'user' ? 'environment' : 'user'); }
  get portrait() { return this.video.videoHeight > this.video.videoWidth; }

  // 映像を16:9に切り抜いてキャンバスへ（保存は鏡像にしない。プレビューだけCSSで鏡像）
  loop() {
    cancelAnimationFrame(this.raf);
    const draw = () => {
      const v = this.video;
      if (v.videoWidth) {
        const vw = v.videoWidth, vh = v.videoHeight;
        const s = Math.max(W / vw, H / vh);
        const dw = vw * s, dh = vh * s;
        this.ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      this.raf = requestAnimationFrame(draw);
    };
    draw();
  }
  thumb() {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    c.getContext('2d').drawImage(this.canvas, 0, 0, 320, 180);
    return c.toDataURL('image/jpeg', 0.7);
  }

  // seconds 秒録画。onTick(0〜1)
  async record(seconds = 2, onTick = () => {}) {
    const mime = pickMime();
    if (!mime || !this.canvas.captureStream) return this.photo();
    const out = this.canvas.captureStream(30);
    if (this.hasAudio) this.stream.getAudioTracks().forEach((t) => out.addTrack(t));
    const rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 650_000, audioBitsPerSecond: 48_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    let thumb = null;
    const t0 = performance.now();
    rec.start(100);
    await new Promise((res) => {
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / (seconds * 1000));
        onTick(p);
        if (!thumb && p > 0.45) thumb = this.thumb();
        if (p >= 1) res(); else requestAnimationFrame(tick);
      };
      tick();
    });
    rec.stop();
    await done;
    out.getVideoTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (blob.size > 700_000) throw new Error('動画が大きすぎました。もう一度撮ってください');
    return { kind: 'video', data: await toDataURL(blob), mime: blob.type, thumb: thumb || this.thumb(), size: blob.size, blob };
  }
  async photo() {
    const data = this.canvas.toDataURL('image/jpeg', 0.8);
    return { kind: 'image', data, mime: 'image/jpeg', thumb: this.thumb(), size: data.length * 0.75 };
  }

  stopStream() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
