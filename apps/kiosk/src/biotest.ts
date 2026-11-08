// Solo desarrollo/pruebas: ejecuta el motor gratuito real sobre imágenes de muestra (scripts/test-biometric-engine.mjs).
import { cosine } from '@asistencia/core';
import { FreeFaceRecognitionAdapter } from './infra/biometric/freeEngine.ts';

const load = (src: string) => new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
function crop(img: HTMLImageElement, fy: number, fh: number, fx = 0, fw = 1) {
  const c = document.createElement('canvas'); c.width = Math.round(img.width * fw); c.height = Math.round(img.height * fh);
  c.getContext('2d')!.drawImage(img, img.width * fx, img.height * fy, c.width, c.height, 0, 0, c.width, c.height); return c;
}
function variant(img: CanvasImageSource & { width: number; height: number }, opts: { scale?: number; rotate?: number; brightness?: number; dx?: number }) {
  const s = opts.scale ?? 1;
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const g = c.getContext('2d')!;
  g.filter = `brightness(${opts.brightness ?? 1})`;
  g.translate(c.width / 2 + (opts.dx ?? 0), c.height / 2); g.rotate(((opts.rotate ?? 0) * Math.PI) / 180);
  g.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
  return c;
}
function sideBySide(a: HTMLCanvasElement, b: HTMLCanvasElement) {
  const c = document.createElement('canvas'); c.width = a.width + b.width; c.height = Math.max(a.height, b.height);
  const g = c.getContext('2d')!; g.drawImage(a, 0, 0); g.drawImage(b, a.width, 0); return c;
}

(async () => {
  const out: Record<string, unknown> = {};
  try {
    const eng = new FreeFaceRecognitionAdapter();
    let t = performance.now(); await eng.init(); out.initMs = Math.round(performance.now() - t);
    const raw = { a: await load('/__biotest__/a.jpg'), b: await load('/__biotest__/b.jpg'), c: await load('/__biotest__/c.jpg') };
    // Encuadre tipo quiosco: parte superior (cabeza y hombros).
    const imgs = { a: crop(raw.a, 0, 0.5, 0.1, 0.8), b: crop(raw.b, 0, 0.4, 0.2, 0.6) };
    const base = { a: variant(imgs.a, {}), b: variant(imgs.b, {}) };
    const emb: Record<string, Float32Array> = {};
    const report: Record<string, unknown> = {};
    const cases: [string, HTMLCanvasElement][] = [
      ['a', base.a], ['a_dark', variant(imgs.a, { brightness: 0.7 })], ['a_rot8', variant(imgs.a, { rotate: 8 })], ['a_small', variant(imgs.a, { scale: 0.8, dx: 20 })],
      ['b', base.b], ['b_bright', variant(imgs.b, { brightness: 1.25 })], ['b_rot10', variant(imgs.b, { rotate: -10 })],
      ['c', variant(raw.c, {})],
    ];
    for (const [k, c] of cases) {
      const r = await eng.analyze(c);
      report[k] = { faces: r.faces.length, quality: r.quality, detectMs: Math.round(r.ms) };
      if (r.aligned && r.faces.length === 1) { t = performance.now(); emb[k] = await eng.embed(r.aligned); (report[k] as Record<string, unknown>).embedMs = Math.round(performance.now() - t); }
    }
    report.blank = (await eng.analyze(variant(document.createElement('canvas'), { scale: 1 }))).quality;
    const both = await eng.analyze(sideBySide(base.a, variant(imgs.b, { scale: base.a.height / imgs.b.height })));
    report.two_people = { faces: both.faces.length, issues: both.quality.issues };
    const sim = (x: string, y: string) => (emb[x] && emb[y] ? +cosine(emb[x]!, emb[y]!).toFixed(4) : null);
    out.report = report;
    out.similarity = {
      misma_persona: { a_vs_a_dark: sim('a', 'a_dark'), a_vs_a_rot8: sim('a', 'a_rot8'), a_vs_a_small: sim('a', 'a_small'), b_vs_b_bright: sim('b', 'b_bright'), b_vs_b_rot10: sim('b', 'b_rot10') },
      distinta_persona: { a_vs_b: sim('a', 'b'), a_dark_vs_b_bright: sim('a_dark', 'b_bright'), a_rot8_vs_b_rot10: sim('a_rot8', 'b_rot10') },
    };
    out.dims = emb.a?.length ?? null;
    // Embeddings exportados (base64 de float32 LE) para la prueba E2E de enrolamiento.
    const b64 = (v: Float32Array) => btoa(String.fromCharCode(...new Uint8Array(v.buffer)));
    out.templates = { a: ['a', 'a_dark', 'a_rot8'].map((k) => b64(emb[k]!)), b: ['b', 'b_bright', 'b_rot10'].map((k) => b64(emb[k]!)) };
    out.norm = emb.a ? +Math.sqrt(cosine(emb.a, emb.a)).toFixed(4) : null;
  } catch (e) { out.error = String((e as Error)?.stack ?? e); }
  (window as unknown as { __result: unknown }).__result = out;
})();
