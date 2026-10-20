import io
p='apps/web/src/game/render/scope-lens.ts'
s=io.open(p,encoding='utf8').read()
pairs=[
("""import {
  Box3, HalfFloatType, Matrix4, PerspectiveCamera, Quaternion, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget,""","""import {
  Box3, HalfFloatType, PerspectiveCamera, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget,"""),
("""        float onLine = (abs(p.x) < 1.0 || abs(p.y) < 1.0) ? 1.0 : 0.0;
        float within = max(abs(nearest.x), abs(nearest.y)) <= 5.0 ? 1.0 : 0.0;
        float d = min(length(p - vec2(nearest.x * uPxPerMil, 0.0)), length(p - vec2(0.0, nearest.y * uPxPerMil)));
        ink = max(ink, step(d, 2.0) * within * onLine * 0.0 + step(d, 2.0) * within);""","""        float within = max(abs(nearest.x), abs(nearest.y)) <= 5.0 ? 1.0 : 0.0;
        float d = min(length(p - vec2(nearest.x * uPxPerMil, 0.0)), length(p - vec2(0.0, nearest.y * uPxPerMil)));
        ink = max(ink, step(d, 2.2) * within);"""),
("""

/** Unused helpers kept typed for callers building fallback lenses. */
export const LENS_UP = new Quaternion();
export const LENS_MATRIX = new Matrix4();
""","""
"""),
]
for a,b in pairs:
    assert a in s, a[:60]; s=s.replace(a,b,1)
io.open(p,'w',encoding='utf8').write(s)
print('ok')
