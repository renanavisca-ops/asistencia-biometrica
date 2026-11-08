import type { Point } from './types.ts';

/** Plantilla estándar de 5 puntos para caras alineadas de 112×112 (ArcFace/SFace). */
export const TEMPLATE_112: readonly Point[] = [
  { x: 38.2946, y: 51.6963 }, { x: 73.5318, y: 51.5014 }, { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 }, { x: 70.7299, y: 92.2041 },
];

/** Transformación de similitud (escala, rotación, traslación) por mínimos cuadrados: x' = a·x − b·y + tx ; y' = b·x + a·y + ty. */
export function similarity(src: readonly Point[], dst: readonly Point[]) {
  const n = src.length;
  let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let i = 0; i < n; i++) { msx += src[i]!.x; msy += src[i]!.y; mdx += dst[i]!.x; mdy += dst[i]!.y; }
  msx /= n; msy /= n; mdx /= n; mdy /= n;
  let na = 0, nb = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const xs = src[i]!.x - msx, ys = src[i]!.y - msy, xd = dst[i]!.x - mdx, yd = dst[i]!.y - mdy;
    na += xs * xd + ys * yd; nb += xs * yd - ys * xd; den += xs * xs + ys * ys;
  }
  const a = na / den, b = nb / den;
  return { a, b, tx: mdx - (a * msx - b * msy), ty: mdy - (b * msx + a * msy) };
}

export const applySim = (t: ReturnType<typeof similarity>, p: Point): Point => ({ x: t.a * p.x - t.b * p.y + t.tx, y: t.b * p.x + t.a * p.y + t.ty });

/** Recorta y alinea la cara a 112×112 en un canvas. */
export function alignFace(src: CanvasImageSource, five: readonly Point[], out?: HTMLCanvasElement): HTMLCanvasElement {
  const c = out ?? document.createElement('canvas');
  c.width = 112; c.height = 112;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const t = similarity(five, TEMPLATE_112);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 112, 112);
  ctx.setTransform(t.a, t.b, -t.b, t.a, t.tx, t.ty);
  ctx.drawImage(src, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}
