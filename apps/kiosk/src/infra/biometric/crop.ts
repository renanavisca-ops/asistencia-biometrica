/** Recorte cuadrado alrededor de la caja del rostro, igual que CropImage._get_new_box del original. */
export function cropBox(srcW: number, srcH: number, box: { x: number; y: number; width: number; height: number }, scale: number) {
  const s = Math.min((srcH - 1) / box.height, (srcW - 1) / box.width, scale);
  const nw = box.width * s, nh = box.height * s, cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  let l = cx - nw / 2, t = cy - nh / 2, r = cx + nw / 2, b = cy + nh / 2;
  if (l < 0) { r -= l; l = 0; }
  if (t < 0) { b -= t; t = 0; }
  if (r > srcW - 1) { l -= r - srcW + 1; r = srcW - 1; }
  if (b > srcH - 1) { t -= b - srcH + 1; b = srcH - 1; }
  return { l, t, w: r - l, h: b - t };
}

