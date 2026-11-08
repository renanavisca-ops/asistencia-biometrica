import torch, numpy as np, onnxruntime as ort, onnx, hashlib
from collections import OrderedDict
from MiniFASNet import MiniFASNetV2, MiniFASNetV1SE
from PIL import Image

def load(cls, path):
    m = cls(conv6_kernel=(5, 5)); sd = torch.load(path, map_location='cpu')
    sd = OrderedDict((k[7:] if k.startswith('module.') else k, v) for k, v in sd.items())
    m.load_state_dict(sd); m.eval(); return m

res = {}
for name, cls, path in [('minifasnet_v2_2.7', MiniFASNetV2, '2.7_80x80_MiniFASNetV2.pth'), ('minifasnet_v1se_4.0', MiniFASNetV1SE, '4_0_0_80x80_MiniFASNetV1SE.pth')]:
    m = load(cls, path)
    out = f'{name}.onnx'
    torch.onnx.export(m, torch.zeros(1, 3, 80, 80), out, input_names=['input'], output_names=['logits'], opset_version=13, dynamo=False)
    onnx.checker.check_model(onnx.load(out))
    sess = ort.InferenceSession(out, providers=['CPUExecutionProvider'])
    rng = np.random.default_rng(0)
    maxdiff = 0
    for _ in range(5):
        x = rng.uniform(0, 255, (1, 3, 80, 80)).astype(np.float32)
        with torch.no_grad(): t = torch.softmax(m(torch.from_numpy(x)), 1).numpy()
        o = ort.InferenceSession(out).run(None, {'input': x})[0]
        e = np.exp(o - o.max(1, keepdims=True)); o = e / e.sum(1, keepdims=True)
        maxdiff = max(maxdiff, float(np.abs(t - o).max()))
    res[name] = {'maxdiff_softmax': maxdiff, 'sha256': hashlib.sha256(open(out, 'rb').read()).hexdigest(), 'bytes': len(open(out, 'rb').read())}
print(res)

# Rostro real (retrato público) recortado como en el original (escala 2.7 / 4.0 alrededor de la caja), BGR, 0–255.
img = np.array(Image.open('../models/portrait.jpg').convert('RGB'))[:, :, ::-1].astype(np.float32)
H, W, _ = img.shape
box = [int(W*0.33), int(H*0.07), int(W*0.33), int(H*0.2)]  # caja aproximada de la cara en portrait.jpg
def crop(scale):
    x, y, bw, bh = box; s = min((H-1)/bh, (W-1)/bw, scale); nw, nh = bw*s, bh*s; cx, cy = x+bw/2, y+bh/2
    l, t, r, b = cx-nw/2, cy-nh/2, cx+nw/2, cy+nh/2
    if l < 0: r -= l; l = 0
    if t < 0: b -= t; t = 0
    if r > W-1: l -= r-W+1; r = W-1
    if b > H-1: t -= b-H+1; b = H-1
    pil = Image.fromarray(img[int(t):int(b)+1, int(l):int(r)+1].astype(np.uint8)).resize((80, 80), Image.BILINEAR)
    return np.asarray(pil, dtype=np.float32).transpose(2, 0, 1)[None]
tot = np.zeros(3)
for name, sc in [('minifasnet_v2_2.7', 2.7), ('minifasnet_v1se_4.0', 4.0)]:
    o = ort.InferenceSession(f'{name}.onnx').run(None, {'input': crop(sc)})[0]
    e = np.exp(o - o.max()); p = (e / e.sum())[0]; tot += p; print(name, 'softmax', np.round(p, 4))
print('combinado/2', np.round(tot / 2, 4), '-> clase', int(tot.argmax()), '(1 = real)')
