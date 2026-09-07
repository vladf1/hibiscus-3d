"""Photo-guided foliage sculpt. Run after build_hibiscus.py or on hibiscus.blend.
Replaces only the generated '06 Stem and serrated foliage' collection.
"""
import bpy,math,random,json
import numpy as np
from pathlib import Path
from mathutils import Vector,Quaternion,Matrix
from math import sin,cos,pi,exp,sqrt
OUT=Path(__file__).resolve().parent.parent
scene=bpy.context.scene
foliage=next(c for c in scene.collection.children if c.name=='06 Stem and serrated foliage')
assert all(o.type=='MESH' for o in foliage.objects),'Unexpected non-generated foliage content'
# This collection belongs to the procedural model; the flower and all other collections are preserved.
for ob in list(foliage.objects):bpy.data.objects.remove(ob,do_unlink=True)
def mesh(name,vs,fs,mat,uv=None):
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update()
    ob=bpy.data.objects.new(name,me);foliage.objects.link(ob);me.materials.append(mat)
    ob['anatomy']='foliage';ob['reference']='IMG_5426 and IMG_5428'
    for p in me.polygons:p.use_smooth=True
    if uv:
        layer=me.uv_layers.new(name='Leaf surface')
        for p in me.polygons:
            for li in p.loop_indices:layer.data[li].uv=uv[me.loops[li].vertex_index]
    return ob

def material(name,color,rough=.52):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
    return m,p
stemmat,_=material('Foliage stem • olive green',(.11,.22,.027),.57)
veinmat,_=material('Foliage veins • muted yellow green',(.12,.25,.043),.59)

def tube(name,pts,radii,mat,sides=8):
    vs=[];fs=[]
    for j,pt in enumerate(pts):
        direction=Vector(pts[min(j+1,len(pts)-1)])-Vector(pts[max(0,j-1)])
        q=Vector((0,0,1)).rotation_difference(direction.normalized())
        for k in range(sides):
            a=2*pi*k/sides;vs.append(tuple(Vector(pt)+q@Vector((radii[j]*cos(a),radii[j]*sin(a),0))))
    for j in range(len(pts)-1):
        for k in range(sides):
            a=j*sides+k;b=j*sides+(k+1)%sides;fs.append((a,b,b+sides,a+sides))
    fs.append(tuple(reversed(range(sides))));fs.append(tuple((len(pts)-1)*sides+k for k in range(sides)))
    return mesh(name,vs,fs,mat)

def stem(y):
    t=(y+5.3)/7.0
    return Vector((.45+.53*t+.13*sin(t*6.1),y,-2.10+.17*sin(t*4.3)))
ys=np.linspace(-5.3,1.70,110)
tube('Foliage stem • curved growing shoot',[stem(y) for y in ys],[.104-.076*((y+5.3)/7) for y in ys],stemmat,18)
# A curved pedicel connects the bloom to a side node; the shoot continues above it, as in the photos.
a=Vector((0,0,-.60));b=stem(-1.36);c1=Vector((.05,-.12,-1.18));c2=b+Vector((-.26,.38,.0))
pts=[a*(1-t)**3+3*c1*t*(1-t)**2+3*c2*t*t*(1-t)+b*t**3 for t in np.linspace(0,1,35)]
tube('Foliage pedicel • curved flower stalk',pts,[.071-.013*j/34 for j in range(35)],stemmat,16)
# Uneven nodes, varied 3D directions, lengths, widths, rolls, camber, tip droop.
SPECS=[
 (-4.83,(-.92,.18,.40),1.94,.74,-.34,.13,-.30),
 (-4.38,(.89,.30,.31),2.26,.85,.31,.08,-.23),
 (-3.53,(-.28,.82,.85),1.47,.46,1.04,.18,.13),
 (-2.88,(-.95,.38,-.32),2.26,.87,-.40,.10,-.35),
 (-2.14,(.78,.55,-.31),2.12,.64,.48,.15,-.11),
 (-.93,(.70,.92,.17),2.28,.76,-.21,.22,.08),
 (-.17,(-.57,.89,.51),1.85,.58,-.72,.19,-.16),
 (.66,(.74,.67,-.58),1.57,.47,.70,.16,.04),
 (1.38,(.14,1,.14),1.16,.34,-.14,.19,.11),
 (1.56,(-.40,.84,-.31),.67,.18,.88,.14,.04)
]
N=768
xx,yy=np.meshgrid(np.linspace(-1,1,N,dtype=np.float32),np.linspace(0,1,N,dtype=np.float32))
def noise(rows,cols,rng):
    g=rng.uniform(-1,1,(rows+1,cols+1));y=np.linspace(0,rows-.001,N);x=np.linspace(0,cols-.001,N)
    iy=y.astype(int);ix=x.astype(int);fy=y-iy;fx=x-ix;fy=fy*fy*(3-2*fy);fx=fx*fx*(3-2*fx)
    lo=g[iy[:,None],ix[None,:]]*(1-fx)+g[iy[:,None],ix[None,:]+1]*fx
    hi=g[iy[:,None]+1,ix[None,:]]*(1-fx)+g[iy[:,None]+1,ix[None,:]+1]*fx
    return lo*(1-fy[:,None])+hi*fy[:,None]
def image(name,rgb,nc=False):
    im=bpy.data.images.get(name) or bpy.data.images.new(name,width=N,height=N,alpha=True)
    if nc:im.colorspace_settings.name='Non-Color'
    a=np.ones((N,N,4),np.float32);a[:,:,:3]=rgb;im.pixels.foreach_set(a.ravel());im.update();im.filepath_raw=str(OUT/'textures'/f'{name}.png');im.file_format='PNG';im.save();im.pack();return im

for i,(node,direction,L,W,roll,camber,droop) in enumerate(SPECS):
    rng=np.random.default_rng(5428+i*119);rnd=random.Random(602+i*71)
    d=Vector(direction).normalized();side=d.cross(Vector((0,0,1))).normalized();side=Quaternion(d,roll)@side;normal=side.cross(d).normalized()
    base=stem(node);petiole_len=rnd.uniform(.16,.36)*(L/2)**.4
    root=base+d*petiole_len+normal*.04
    tube(f'Foliage leaf {i+1:02} petiole',[base,base.lerp(root,.4)+normal*.025,root],[.027,.021,.015] if i<8 else [.017,.012,.007],stemmat,10)
    asym=rnd.uniform(-.16,.17);bend=rnd.uniform(-.17,.18);twist=rnd.uniform(-.18,.17)
    # Unequal serrations on each side, with varied spacing and tooth depth.
    margins=[]
    for sign in [-1,1]:
        knots=[.05]
        while knots[-1]<.965:knots.append(min(.99,knots[-1]+rnd.uniform(.031,.055)))
        margins.append((knots,[rnd.uniform(.012,.044) for _ in knots]))
    def edge(t,sign):
        knots,heights=margins[0 if sign<0 else 1]
        for k in range(len(knots)-1):
            if knots[k]<=t<=knots[k+1]:
                f=(t-knots[k])/(knots[k+1]-knots[k]);p=.30
                return heights[k]*(f/p if f<p else (1-f)/(1-p))*sin(pi*t)**.5
        return 0
    def point(u,v):
        profile=(max(u,0)**.54*max(1-u,0)**.90)/(.375**.54*.625**.90)
        sign=-1 if v<0 else 1
        w=W*profile*(1+asym*sign+.035*sin(u*7.2+i*1.7))
        w+=edge(u,sign)*min(L,2)
        center=bend*sin(pi*u)*u
        # Twisted lamina, unequal cups, a gently bending midrib and a curled pointed tip.
        z=camber*sin(pi*u)+droop*u**3+twist*v*sin(pi*u)-(.085+.03*sin(i))*v*v*sin(pi*u)
        z+=.013*sin(u*17.2+i+v*3.1)*abs(v)**2*sin(pi*u)
        return root+d*(L*u)+side*(center+w*v)+normal*z
    nr,nc=110,46;vs=[];uv=[];fs=[]
    for j in range(nr+1):
        for k in range(nc+1):vs.append(tuple(point(j/nr,2*k/nc-1)));uv.append((k/nc,j/nr))
    for j in range(nr):
        for k in range(nc):
            a=j*(nc+1)+k;fs.append((a,a+1,a+nc+2,a+nc+1))
    # Branching veins at independently staggered left/right positions.
    branches=[]
    for sign in [-1,1]:
        pos=.10+rnd.uniform(0,.025)
        while pos<.85:
            branches.append((pos,sign,rnd.uniform(.09,.15)));pos+=rnd.uniform(.085,.135)
    veins=np.exp(-(xx/.018)**2)*.72
    for start,sign,rise in branches:
        mask=(xx*sign>0)
        line=start+rise*np.abs(xx)**.78
        veins+=np.exp(-((yy-line)/.0045)**2)*mask*.39*(1-.35*np.abs(xx))
        # Uneven smaller tributaries entering each lateral vein.
        for t0 in [.37,.67]:
            line2=start+rise*t0**.78+(np.abs(xx)-t0)*.23
            veins+=np.exp(-((yy-line2)/.0028)**2)*mask*(np.abs(xx)>t0)*.085
    mottled=noise(17,23,rng);small=noise(130,150,rng);grain=noise(480,460,rng)
    young=i>=8
    pigment=np.array([.27,.405,.080] if not young else [.39,.50,.125])
    pigment*=rnd.uniform(.85,1.05)
    rgb=np.broadcast_to(pigment,(N,N,3)).copy();rgb+=(.035*mottled+.014*small)[:,:,None]
    rgb+=veins[:,:,None]*np.array([.055,.063,.016])
    rgb-=np.clip(grain-.69,0,1)[:,:,None]*np.array([.08,.09,.04])
    h=.15*veins+.16*small+.045*grain
    gy,gx=np.gradient(h);no=np.stack((-gx*7,-gy*7,np.ones_like(gx)),-1);no/=np.linalg.norm(no,axis=-1,keepdims=True)
    alb=image(f'leaf-{i+1:02}-varied-pigment',np.clip(rgb,0,1));bump=image(f'leaf-{i+1:02}-branching-venation',no*.5+.5,True)
    mat,p=material(f'Foliage leaf {i+1:02} • '+('young yellow-green' if young else 'mottled olive-green'),(.12,.24,.03),rnd.uniform(.42,.57))
    p.inputs['Subsurface Weight'].default_value=.06;p.inputs['Subsurface Radius'].default_value=(.3,.6,.12)
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=alb;mat.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bump;nm=mat.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.42;mat.node_tree.links.new(tex.outputs['Color'],nm.inputs['Color']);mat.node_tree.links.new(nm.outputs['Normal'],p.inputs['Normal'])
    ob=mesh(f'Foliage leaf {i+1:02} • asymmetric serrated blade',vs,fs,mat,uv);ob['node_y']=node;ob['length']=L;ob['roll']=roll
    tube(f'Foliage leaf {i+1:02} curved midrib',[point(t,0)+normal*.004 for t in np.linspace(.007,.982,45)],[.009*(1-t)+.001 for t in np.linspace(0,1,45)],veinmat,6)
    for j,(u0,sign,rise) in enumerate(branches):
        qs=np.linspace(0,.95,15);ps=[point(u0+rise*q**.78,sign*q)+normal*.004 for q in qs]
        tube(f'Foliage leaf {i+1:02} side vein {j+1:02}',ps,[.0035*(1-q)+.0007 for q in qs],veinmat,5)
# Save the selected botanical study with new foliage. The flower geometry is untouched.
bpy.ops.object.select_all(action='DESELECT')
for c in scene.collection.children:
    if not c.name.startswith('08 '):
        for ob in c.objects:ob.select_set(True)
scene['Foliage reference']='Uneven alternate nodes, shoot above pedicel, independently rolled and curled serrated leaves; IMG_5426 and IMG_5428.'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'hibiscus.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'hibiscus.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
info=json.loads((OUT/'model-info.json').read_text());info.update({'leaves':len(SPECS),'objects':len(bpy.context.selected_objects),'vertices':sum(len(o.data.vertices) for o in bpy.context.selected_objects if o.type=='MESH'),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in bpy.context.selected_objects if o.type=='MESH')});(OUT/'model-info.json').write_text(json.dumps(info,indent=2))
print('FOLIAGE_REBUILT',json.dumps(info))
