"""Renders .tmp-rig/raw.json (from render-raw-clips.mjs) front and side, flat shaded, with Pillow."""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw
def sub(a,b): return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]
def dot(a,b): return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
def cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def norm(a):
    l=math.sqrt(dot(a,a)) or 1; return [x/l for x in a]
poses=json.loads(Path(sys.argv[1] if len(sys.argv)>1 else '.tmp-rig/raw.json').read_text())
W,H=(420,560) if "--big" in sys.argv else (200,200) if "--small" in sys.argv else (240,340)
small="--small" in sys.argv
sys.argv=[a for a in sys.argv if a not in ("--big","--small")]
views=[[0.6,1.0,-3.2],[3.2,1.0,-0.3]] if "--neg" in sys.argv else [[0.6,1.0,3.2],[3.2,1.0,0.3]]
sys.argv=[a for a in sys.argv if a!="--neg"]
sheet=Image.new('RGB',(W*len(poses),H*len(views)),'#202832')
for r,eye in enumerate(views):
    for c,pose in enumerate(poses):
        pts=[p for m in pose['meshes'] for p in m['positions']]
        cy=(max(p[1] for p in pts)+min(p[1] for p in pts))/2
        cx=sum(p[0] for p in pts)/len(pts); cz=sum(p[2] for p in pts)/len(pts)
        target=[cx,cy,cz]; cam=[cx+eye[0],cy+eye[1]-0.9,cz+eye[2]]
        f=norm(sub(target,cam)); rt=norm(cross(f,[0,1,0])); up=cross(rt,f)
        img=Image.new('RGB',(W,H),'#202832'); d=ImageDraw.Draw(img); tris=[]
        for m in pose['meshes']:
            V=m['positions']; P=[]
            for v in V:
                q=sub(v,cam); z=dot(q,f); P.append((W/2+(800 if W>300 else 460)*dot(q,rt)/z,H/2-(800 if W>300 else 460)*dot(q,up)/z,z))
            I=m['indices']
            for j in range(0,len(I),3):
                a,b,cc=I[j],I[j+1],I[j+2]
                n=norm(cross(sub(V[b],V[a]),sub(V[cc],V[a])))
                l=.35+.65*abs(dot(n,norm([.4,.8,.6])))
                col=tuple(int(max(0,min(255,(m['colors'][a][k]+m['colors'][b][k]+m['colors'][cc][k])/3*l*255))) for k in range(3))
                tris.append(((P[a][2]+P[b][2]+P[cc][2])/3,[P[a][:2],P[b][:2],P[cc][:2]],col))
        for _,p,col in sorted(tris,key=lambda t:-t[0]): d.polygon(p,fill=col)
        d.text((8,8),pose['label'],fill='white'); sheet.paste(img,(c*W,r*H))
o=sys.argv[2] if len(sys.argv)>2 else '.tmp-rig/raw.png'; sheet.save(o); print(o)
