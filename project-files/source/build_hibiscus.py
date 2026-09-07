"""Photo-guided hibiscus: procedural editable surfaces, physical botanical details.
Run in Blender 5.2. All geometry and textures are generated locally.
"""
import bpy, math, random, json
import numpy as np
from mathutils import Vector
from pathlib import Path
from math import sin, cos, pi, exp, sqrt
OUT=Path(__file__).resolve().parent.parent
random.seed(5425)
scene = bpy.data.scenes.new('Hibiscus — photo study')
bpy.context.window.scene = scene
COL={}
for name in ['01 Corolla — five ruffled petals','02 Staminal column and filaments','03 Golden anthers and pollen','04 Five stigma pads','05 Calyx and epicalyx','06 Stem and serrated foliage','07 Water droplets','08 Studio']:
    c=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(c);COL[name[:2]]=c

def mesh(name,verts,faces,mat,col,uv=None):
    m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.update()
    o=bpy.data.objects.new(name,m);COL[col].objects.link(o)
    if mat:m.materials.append(mat)
    for f in m.polygons:f.use_smooth=True
    if uv:
        lay=m.uv_layers.new(name='Botanical UV')
        for p in m.polygons:
            for li in p.loop_indices:lay.data[li].uv=uv[m.loops[li].vertex_index]
    return o

def material(name,color,rough=.45):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
    m.diffuse_color=(*color,1)
    return m,p

def image_tex(name,arr,noncolor=False):
    h,w=arr.shape[:2]
    im=bpy.data.images.new(name,width=w,height=h,alpha=True)
    if noncolor:im.colorspace_settings.name='Non-Color'
    a=np.ones((h,w,4),dtype=np.float32);a[:,:,:3]=arr
    im.pixels.foreach_set(a.ravel());im.filepath_raw=str(OUT/'textures'/f'{name}.png');im.file_format='PNG';im.save();im.pack()
    return im

def botanical_textures():
    n=2048
    v,u=np.meshgrid(np.linspace(-1,1,n,dtype=np.float32),np.linspace(0,1,n,dtype=np.float32))
    # Longitudinal veins fan from the throat. A branch field adds fine secondary ribs.
    phase=v*94+1.9*np.sin(u*8+v*9)+.7*np.sin(u*23+v*13)
    ridge=np.exp(-((np.sin(phase*pi))/.20)**2)
    micro=np.sin(v*820+2*np.sin(u*72+v*55))*np.sin(u*410+v*34)
    branch=np.exp(-(np.sin((v*180+u*42+2*np.sin(v*19))*pi)/.17)**2)
    h=.60*ridge+.13*branch+.10*micro+.10*np.sin(phase*1.2)
    gy,gx=np.gradient(h)
    normal=np.stack((-gx*15,-gy*15,np.ones_like(h)),axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    normal=normal*.5+.5
    # Scarlet lamina with darker burgundy throat and subtle pale basal rays.
    lum=.86+.075*np.sin(v*21+u*13)+.055*ridge+.035*micro
    throat=np.clip((.22-u)/.22,0,1)
    blush=np.exp(-((u-.26)/.15)**2)*np.exp(-(v/.77)**4)*(.28+.72*np.maximum(0,np.sin(phase*1.5))**5)*.27
    c=np.stack((.90*lum*(1-.63*throat),.018*lum+.43*blush,.085*lum+.51*blush),axis=-1)
    return image_tex('petal-scarlet-albedo',np.clip(c,0,1)),image_tex('petal-radial-veins-normal',normal,True)

albedo,normal=botanical_textures()
petal,p=material('Scarlet silk • radial microveins',(.8,.004,.025),.47)
p.inputs['Subsurface Weight'].default_value=.10
p.inputs['Subsurface Radius'].default_value=(1,.15,.09)
p.inputs['Sheen Weight'].default_value=0
p.inputs['Specular IOR Level'].default_value=.20
for im,socket in [(albedo,'Base Color'),(normal,'Normal')]:
    n=petal.node_tree.nodes.new('ShaderNodeTexImage');n.image=im
    if socket=='Normal':
        no=petal.node_tree.nodes.new('ShaderNodeNormalMap');no.inputs['Strength'].default_value=.10;petal.node_tree.links.new(n.outputs['Color'],no.inputs['Color']);petal.node_tree.links.new(no.outputs['Normal'],p.inputs['Normal'])
    else:petal.node_tree.links.new(n.outputs['Color'],p.inputs[socket])
pink,_=material('Rose pink staminal tube',(.72,.012,.049),.35)
filament,_=material('Rose filaments',(.85,.075,.11),.40)
cream,_=material('Pale yellow style branches',(.92,.59,.16),.42)
yellow,_=material('Saffron yellow anthers',(.95,.40,.003),.60)
pollen,_=material('Golden pollen grains',(1,.57,.006),.70)
stigma,_=material('Crimson stigma velvet',(.56,.002,.032),.82)
rim,_=material('Stigma papillae',(.84,.026,.075),.76)
green,gp=material('Calyx • moss green',(.13,.23,.022),.56)
stemmat,_=material('Fresh green pedicel',(.17,.29,.035),.49)
veinmat,_=material('Leaf veins',(.22,.34,.055),.62)
water,wp=material('Water • clear droplets',(.95,.99,1),.055)
wp.inputs['Transmission Weight'].default_value=1;wp.inputs['IOR'].default_value=1.333
wp.inputs['Coat Weight'].default_value=.35

# Shared fast mesh accumulator; small forms remain proper watertight meshes.
class Batch:
    def __init__(self):self.v=[];self.f=[]
    def ellipsoid(self,center,scale,seg=12,rings=7,axis=None):
        base=len(self.v);c=Vector(center)
        rot=Vector((0,0,1)).rotation_difference(Vector(axis).normalized()) if axis is not None else None
        for j in range(rings+1):
            t=pi*j/rings
            for k in range(seg):
                a=2*pi*k/seg;q=Vector((scale[0]*sin(t)*cos(a),scale[1]*sin(t)*sin(a),scale[2]*cos(t)))
                if rot:q=rot@q
                self.v.append(tuple(c+q))
        for j in range(rings):
            for k in range(seg):
                a=base+j*seg+k;b=base+j*seg+(k+1)%seg
                self.f.append((a,b,b+seg,a+seg))
    def done(self,name,mat,col):return mesh(name,self.v,self.f,mat,col)

def tube(name,points,radii,mat,col,sides=12):
    vv=[];ff=[]
    for j,p in enumerate(points):
        tangent=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])
        q=Vector((0,0,1)).rotation_difference(tangent.normalized())
        for k in range(sides):
            a=2*pi*k/sides;vv.append(tuple(Vector(p)+q@Vector((radii[j]*cos(a),radii[j]*sin(a),0))))
    for j in range(len(points)-1):
        for k in range(sides):
            a=j*sides+k;b=j*sides+(k+1)%sides;ff.append((a,b,b+sides,a+sides))
    ff.append(tuple(reversed(range(sides))));ff.append(tuple((len(points)-1)*sides+k for k in range(sides)))
    return mesh(name,vv,ff,mat,col)

def petal_point(i,u,v):
    angle=pi/2+i*2*pi/5+[.03,-.03,.04,-.025,.01][i]
    breadth=.73+.035*sin(pi*u)
    a=angle+v*breadth+.055*sin(u*pi)*sin(i*2)
    r=.105+(3.00+[.12,-.02,.22,.03,-.08][i])*u-.42*v*v*u**4
    r+=(.065*sin(v*18+i)+.033*sin(v*39+i*3))*u**8
    z=.08+.91*(1-exp(-5*u))-.63*u*u
    z+=.16*sin(v*4.8+i*.8)*u**1.7+.27*v*u**1.4
    z+=(.14*sin(v*13+i*1.7)+.075*sin(v*29+i))*u**7
    z+=.11*cos(v*8+u*3+i)*u*(.4+.6*abs(v))
    z+=.0035*sin(v*95+sin(u*8)*1.5)*u**.7
    z+=.001*sin(v*245+u*35)*u
    return Vector((r*cos(a),r*sin(a),z))

for i in range(5):
    nr,nc=150,190;vv=[];uv=[];ff=[]
    for j in range(nr+1):
        u=j/nr
        for k in range(nc+1):
            v=2*k/nc-1;vv.append(tuple(petal_point(i,u,v)));uv.append((k/nc,u))
    for j in range(nr):
        for k in range(nc):
            a=j*(nc+1)+k;ff.append((a,a+1,a+nc+2,a+nc+1))
    o=mesh(f'Petal {i+1} • folded fan surface',vv,ff,petal,'01',uv)
    # Explicit thin double-sided sheet; glTF material preserves back faces.
    o['reference']='IMG_5425–IMG_5428';o['anatomy']='corolla petal';o['surface']='radial veins, asymmetric folds, scalloped edge'

# Long, gently bent projecting staminal column.
def column(t):return Vector((-.34*t*t,.06*sin(t*pi),.12+3.75*t))
pts=[column(j/100) for j in range(101)]
tube('Staminal column • curved pink tube',pts,[.083-.039*(j/100)+.009*sin(j/100*pi) for j in range(101)],pink,'02',32)
# Fine longitudinal ridges along the column.
for k in range(12):
    a=2*pi*k/12
    ps=[column(t)+Vector((cos(a),sin(a),0))*(.080-.038*t) for t in np.linspace(.03,.90,42)]
    tube(f'Column rib {k+1:02}',ps,[.0023]*len(ps),filament,'02',5)

ab=Batch();pb=Batch()
for j in range(96):
    t=.61+.30*(j/95)**.70;a=j*2.39996+random.uniform(-.22,.22)
    length=random.uniform(.16,.32)*(1-.4*abs(t-.81))
    base=column(t);direction=Vector((cos(a),sin(a),.2))
    end=base+direction*length+Vector((0,0,random.uniform(-.10,.04)))
    points=[base.lerp(end,q)+Vector((0,0,.055*sin(pi*q))) for q in np.linspace(0,1,10)]
    tube(f'Filament {j+1:03}',points,[.007*(1-.32*q) for q in np.linspace(0,1,10)],filament,'02',6)
    scale=(random.uniform(.035,.047),random.uniform(.026,.038),random.uniform(.035,.047))
    ab.ellipsoid(end,scale,12,7)
    # Rough clustered pollen across the anther lobes.
    for k in range(17):
        az=random.random()*2*pi;zz=random.uniform(-1,1);rr=sqrt(1-zz*zz)
        d=Vector((rr*cos(az),rr*sin(az),zz));pos=end+Vector((d.x*scale[0],d.y*scale[1],d.z*scale[2]))
        sz=random.uniform(.006,.010);pb.ellipsoid(pos,(sz,sz,sz),6,4)
ab.done('96 lobed golden anthers',yellow,'03');pb.done('1632 individual pollen grains',pollen,'03')

sb=Batch();pap=Batch()
for i in range(5):
    a=2*pi*i/5+.25;base=column(.92);end=column(1.075)+Vector((.21*cos(a),.21*sin(a),.035*sin(a)))
    ps=[]
    for t in np.linspace(0,1,28):
        ps.append(base.lerp(end,t)+Vector((-.03*sin(pi*t),0,.055*sin(pi*t))))
    tube(f'Style branch {i+1}',ps,[.022-.008*j/27 for j in range(28)],cream,'04',10)
    axis=Vector((.23*cos(a),.23*sin(a),1)).normalized()
    sb.ellipsoid(end,(.074,.074,.036),24,12,axis)
    q=Vector((0,0,1)).rotation_difference(axis)
    for k in range(140):
        r=.071*sqrt(random.random());b=random.random()*2*pi
        p=end+q@Vector((r*cos(b),r*sin(b),.033*sqrt(max(0,1-(r/.075)**2))))
        s=random.uniform(.003,.0055);pap.ellipsoid(p,(s,s,s*1.15),5,3)
sb.done('Five crimson stigma pads',stigma,'04');pap.done('700 velvet stigma papillae',rim,'04')

# Receptacle, five enclosing pointed sepals, and nine narrow epicalyx bracts.
b=Batch();b.ellipsoid((0,0,-.25),(.29,.29,.46),32,18);b.done('Green receptacle',green,'05')
for i in range(5):
    a=2*pi*i/5;vv=[];ff=[];uv=[]
    for j in range(37):
        t=j/36;r=.16+.37*t;z=-.64+.94*t;w=.18*sin(pi*t)**.8
        for k in range(13):
            s=2*k/12-1;vv.append((r*cos(a)-w*s*sin(a),r*sin(a)+w*s*cos(a),z-.10*s*s*sin(pi*t)));uv.append((k/12,t))
    for j in range(36):
        for k in range(12):
            n=j*13+k;ff.append((n,n+1,n+14,n+13))
    mesh(f'Pointed calyx sepal {i+1}',vv,ff,green,'05',uv)
for i in range(9):
    a=2*pi*i/9+.15
    pts=[Vector(((.12+.36*t)*cos(a),(.12+.36*t)*sin(a),-.56+.47*t)) for t in np.linspace(0,1,15)]
    tube(f'Epicalyx bract {i+1}',pts,[.039*(1-j/14)+.002 for j in range(15)],stemmat,'05',8)
# Pedicel runs back from the flower, then a short leafy branch drops below it.
pts=[(0,0,-.6),(.12,-.15,-1.1),(.32,-.45,-1.55),(.47,-.9,-1.80),(.50,-1.45,-1.92)]
tube('Arched flower pedicel',pts,[.077,.070,.062,.059,.065],stemmat,'06',20)
pts=[(.5+.09*sin(t*3),-1.40-3.9*t,-1.92-.15*t) for t in np.linspace(0,1,60)]
tube('Leaf-bearing stem',pts,[.07+.035*t for t in np.linspace(0,1,60)],stemmat,'06',20)

# Textured serrate ovate leaf lamina, pinnate veins plus fine reticulation.
n=1024;x,y=np.meshgrid(np.linspace(-1,1,n,dtype=np.float32),np.linspace(0,1,n,dtype=np.float32))
veins=np.exp(-((np.sin((y*9-np.abs(x)*.67)*pi))/.10)**2)*.7+np.exp(-(x/.027)**2)
noise=(np.sin(x*470+y*310)*np.sin(y*512-x*190))*.025
col=np.stack((.18+.11*veins+noise,.32+.14*veins+noise,.055+.025*veins+noise*.3),-1)
leaf,lp=material('Living leaf • pinnate venation',(.08,.20,.018),.46)
li=image_tex('leaf-venation-albedo',np.clip(col,0,1));tex=leaf.node_tree.nodes.new('ShaderNodeTexImage');tex.image=li;leaf.node_tree.links.new(tex.outputs['Color'],lp.inputs['Base Color'])
for i,(t,a,L,W) in enumerate([(.03,.18,1.68,.62),(.29,2.85,1.61,.62),(.48,-.12,1.52,.57),(.70,3.03,1.45,.54),(.91,.38,1.28,.50)]):
    base=Vector((.5+.09*sin(t*3),-1.4-3.9*t,-1.92-.15*t));d=Vector((cos(a),.5+sin(a)*.35,.18)).normalized();side=Vector((-d.y,d.x,0)).normalized()
    root=base+d*.28
    tube(f'Leaf petiole {i+1}',[base,root],[.035,.022],stemmat,'06',10)
    def leafpoint(u,v):
        width=W*sin(pi*u)**.85*(1+.055*sin(u*23*2*pi))
        return root+d*(L*u)+side*(width*v)+Vector((0,0,.19*sin(pi*u)-.18*v*v*sin(pi*u)+.025*sin(u*35)*abs(v)))
    vv=[];uv=[];ff=[];nr=90;nc=36
    for j in range(nr+1):
        for k in range(nc+1):vv.append(tuple(leafpoint(j/nr,2*k/nc-1)));uv.append((k/nc,j/nr))
    for j in range(nr):
        for k in range(nc):
            q=j*(nc+1)+k;ff.append((q,q+1,q+nc+2,q+nc+1))
    mesh(f'Serrated leaf {i+1}',vv,ff,leaf,'06',uv)
    ps=[leafpoint(u,0)+Vector((0,0,.006)) for u in np.linspace(.01,.98,50)]
    tube(f'Leaf midrib {i+1}',ps,[.016*(1-j/50)+.002 for j in range(50)],veinmat,'06',6)
    for j in range(1,9):
        for sign in [-1,1]:
            u0=.08+j*.082
            ps=[leafpoint(u0+q*.105,sign*q*.95)+Vector((0,0,.007)) for q in np.linspace(0,1,12)]
            tube(f'Leaf {i+1} secondary vein {j} {sign}',ps,[.005*(1-.7*q) for q in np.linspace(0,1,12)],veinmat,'06',5)

# Droplets lie on actual folded petal surfaces, with local surface normals.
drops=Batch()
for i in range(5):
    for j in range(36):
        u=random.uniform(.37,.96);v=random.uniform(-.92,.92);p=petal_point(i,u,v)
        tangent=petal_point(i,u+.001,v)-p;cross=petal_point(i,u,v+.001)-p
        normal=tangent.cross(cross).normalized()
        if normal.z<0:normal=-normal
        r=random.uniform(.012,.037)*(1.6 if j%15==0 else 1)
        drops.ellipsoid(p+normal*r*.40,(r,r,r*.68),16,9,normal)
drops.done('180 dew droplets on petal surfaces',water,'07')

# Dark red throat shields the green receptacle from the front.
v=[];f=[]
for j in range(16):
    t=j/15;r=.057+.09*t;z=-.10+.25*t
    for k in range(64):a=k*2*pi/64;v.append((r*cos(a),r*sin(a),z))
for j in range(15):
    for k in range(64):a=j*64+k;b=j*64+(k+1)%64;f.append((a,b,b+64,a+64))
m=bpy.data.materials.new('Deep crimson throat');m.diffuse_color=(.28,.001,.014,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.28,.001,.014,1);p.inputs['Roughness'].default_value=.6
me=bpy.data.meshes.new('Inner throat');me.from_pydata(v,[],f);me.materials.append(m);ob=bpy.data.objects.new('Inner crimson throat',me);COL['01'].objects.link(ob)
for p in me.polygons:p.use_smooth=True

# Studio and editable scene presentation.
scene=bpy.context.scene
scene.world=bpy.data.worlds.new('Hibiscus studio world')
scene.world.color=(.15,.15,.15);scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.19,.17,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5

def area(name,loc,power,color,size):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.color=color;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);COL['08'].objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,.4))-o.location).to_track_quat('-Z','Y').to_euler()
area('Large soft key',(-4,5,8),850,(1,.87,.77),6)
area('Cool petal fill',(5,1,5),650,(.80,.89,1),5)
area('Translucent rim',(-2,4,-3),1050,(1,.63,.43),4)
cam=bpy.data.cameras.new('Botanical portrait');co=bpy.data.objects.new('Botanical portrait',cam);COL['08'].objects.link(co)
co.location=(8,-.0,14);target=Vector((0,-.65,.7));co.rotation_euler=(target-co.location).to_track_quat('-Z','Y').to_euler();cam.type='ORTHO';cam.ortho_scale=10.8;scene.camera=co
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1400;scene.render.resolution_y=1400;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
scene.view_settings.view_transform='AgX'
# Set viewport to a useful initial angle and materials.
for screen in bpy.data.screens:
    for a in screen.areas:
        if a.type=='VIEW_3D':
            a.spaces.active.region_3d.view_rotation=co.rotation_euler.to_quaternion()
            a.spaces.active.region_3d.view_distance=12
            a.spaces.active.region_3d.view_location=target
            a.spaces.active.shading.type='MATERIAL'
            a.spaces.active.overlay.show_overlays=False
bpy.ops.object.select_all(action='DESELECT')
for c in COL.values():
    if c==COL['08']:continue
    for o in c.objects:o.select_set(True)
scene['Reference photographs']='IMG_5425, IMG_5426, IMG_5427, IMG_5428'
scene['Model interpretation']='Photo-guided artistic reconstruction; unseen surfaces inferred. Scale illustrative.'
# Clear material backface culling for thin botanical surfaces.
for m in bpy.data.materials:m.use_backface_culling=False
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'hibiscus.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'hibiscus.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
verts=sum(len(o.data.vertices) for o in bpy.context.selected_objects if o.type=='MESH')
tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in bpy.context.selected_objects if o.type=='MESH')
info={'vertices':verts,'triangles':tris,'objects':len(bpy.context.selected_objects),'petals':5,'anthers':96,'pollen_grains':1632,'stigma_pads':5,'stigma_papillae':700,'dew_droplets':180}
(OUT/'model-info.json').write_text(json.dumps(info,indent=2))
print('HIBISCUS_COMPLETE',json.dumps(info))


# Photo-guided asymmetric sculpt and unique textures.
"""Second sculpt pass: five individually shaped petals and independent branching texture fields."""
import bpy, math,random,json
import numpy as np
from pathlib import Path
from math import sin,cos,pi,exp,sqrt
from mathutils import Vector,Matrix
OUT=Path(__file__).resolve().parent.parent
COL={c.name[:2]:c for c in bpy.context.scene.collection.children}
# angle, length, width, sideways lean, tip depth, twist: matched to the reference's uneven silhouette.
SHAPES=[(91,3.25,1.38,-.13,.46,.32),(154,2.88,1.51,.11,-.13,-.39),(225,3.42,1.69,-.14,-.66,.16),(283,3.37,1.58,.19,-.34,-.28),(13,3.10,1.87,-.08,.20,.43)]
EDGE=[];FOLDS=[]
for i in range(5):
    r=random.Random(627+i*101)
    EDGE.append([r.uniform(-1,1) for _ in range(34)])
    FOLDS.append([(r.uniform(.46,1.02),r.uniform(-1,1),r.uniform(-.23,.26),r.uniform(.2,.48),r.uniform(.13,.34)) for _ in range(9)])
def sample(values,x):
    x=max(0,min(len(values)-1.00001,x));j=int(x);f=x-j;f=f*f*(3-2*f);return values[j]*(1-f)+values[j+1]*f
def petal_point(i,u,v):
    deg,L,W,lean,tip,twist=SHAPES[i];a=deg*pi/180
    width=(.038+W*sin(pi*.79*u)**.78)*(1+.085*v+.045*sin(u*7.1+i))
    lateral=width*v+lean*u*u+.04*sin(u*4.3+i)*u
    longitudinal=.075+L*u-.39*v*v*u**5
    longitudinal+=u**7*(.105*sample(EDGE[i],(v+1)*16.4)+.05*sin(v*7.4+i*2.3))
    # Irregular shallow cupping, gravity droop and local folded regions, without radial corrugations.
    z=.065+.55*(1-exp(-5*u))+tip*u*u
    z+=twist*v*u**1.5+.16*v*v*sin(pi*u)
    for uc,vc,amp,su,sv in FOLDS[i]:z+=amp*exp(-((u-uc)/su)**2-((v-vc)/sv)**2)*u
    z+=.10*sample(EDGE[(i+2)%5],(v+1)*16.4)*u**7
    z+=.004*(sin(v*103+u*31+i)+.45*sin(v*211-u*74+i*3))*u
    # Broad individual folds visible in the side references.
    if i==0:z+=.42*exp(-((v-.65)/.33)**2)*u**3
    if i==4:z+=.31*exp(-((v+.78)/.21)**2)*sin(pi*u)**.6
    return Vector((longitudinal*cos(a)-lateral*sin(a),longitudinal*sin(a)+lateral*cos(a),z))
for i in range(5):
    o=bpy.data.objects[f'Petal {i+1} • folded fan surface']
    for j in range(151):
        for k in range(191):o.data.vertices[j*191+k].co=petal_point(i,j/150,2*k/190-1)
    o.data.update()

# Random smooth fields and a branching vein network; each petal has its own seed and images.
n=1536
u,v=np.meshgrid(np.linspace(-1,1,n,dtype=np.float32),np.linspace(0,1,n,dtype=np.float32))
def noise(rows,cols,rng):
    g=rng.random((rows+1,cols+1),dtype=np.float32)*2-1
    yy=np.linspace(0,rows-.001,n,dtype=np.float32);xx=np.linspace(0,cols-.001,n,dtype=np.float32)
    iy=yy.astype(int);ix=xx.astype(int);fy=yy-iy;fx=xx-ix;fy=fy*fy*(3-2*fy);fx=fx*fx*(3-2*fx)
    lo=g[iy[:,None],ix[None,:]]*(1-fx)+g[iy[:,None],ix[None,:]+1]*fx
    hi=g[iy[:,None]+1,ix[None,:]]*(1-fx)+g[iy[:,None]+1,ix[None,:]+1]*fx
    return (lo*(1-fy[:,None])+hi*fy[:,None]).astype(np.float32)
def save_image(name,rgb,nc=False):
    im=bpy.data.images.new(name,width=n,height=n,alpha=True)
    if nc:im.colorspace_settings.name='Non-Color'
    arr=np.ones((n,n,4),np.float32);arr[:,:,:3]=rgb;im.pixels.foreach_set(arr.ravel());im.update();im.filepath_raw=str(OUT/'textures'/f'{name}.png');im.file_format='PNG';im.save();im.pack();return im
for i in range(5):
    rng=np.random.default_rng(7400+i*349)
    broad=noise(12,19,rng);fiber=noise(48,310,rng);fine=noise(210,760,rng);grain=noise(710,880,rng)
    field=np.zeros((n,n),np.float32)
    def stroke(ys,xs,width,strength):
        y=np.asarray(ys,dtype=int);x=np.asarray(xs)*(n-1);b=x.astype(int)
        offsets=np.arange(-5,6);xx=b[:,None]+offsets
        weights=np.exp(-((xx-x[:,None])/width)**2)*strength
        good=(xx>=0)&(xx<n)&(y[:,None]>=0)&(y[:,None]<n)
        yy=np.broadcast_to(y[:,None],xx.shape);np.add.at(field,(yy[good],xx[good]),weights[good])
    endpoints=np.sort(rng.uniform(.015,.985,31))
    yy=np.arange(30,n);t=yy/(n-1)
    for j,ep in enumerate(endpoints):
        phase=rng.uniform(0,6.28);bend=rng.uniform(-.025,.025)
        path=ep+bend*np.sin(t*3.5+phase)*t+.0035*np.sin(t*rng.uniform(8,16)+phase)*t
        stroke(yy,path,rng.uniform(.8,1.7),rng.uniform(.30,.65))
        for sign in [-1,1]:
            begin=rng.uniform(.22,.67);end=min(.98,begin+rng.uniform(.15,.4));yb=np.arange(int(begin*n),int(end*n));tb=yb/(n-1);q=(tb-begin)/(end-begin)
            branch=ep+bend*np.sin(tb*3.5+phase)*tb+.0035*np.sin(tb*12+phase)*tb+sign*rng.uniform(.018,.055)*q**1.2
            stroke(yb,branch,.8,rng.uniform(.10,.27))
    # Crinkled fine tissue, with an irregular vein network instead of equally spaced rays.
    h=.35*fiber+.16*fine+.055*grain+.10*broad+.33*field
    gy,gx=np.gradient(h);no=np.stack((-gx*10,-gy*10,np.ones_like(gx)),-1);no/=np.linalg.norm(no,axis=-1,keepdims=True)
    throat=np.clip((.18-v)/.18,0,1)
    basal=np.exp(-((v-.22)/.135)**2)*np.exp(-((u+.10)/.67)**4)
    blush=basal*(.11+.11*np.clip(fiber+field,0,1))
    intensity=.90+.060*broad+.045*fiber+.025*fine+.025*field
    rgb=np.stack((intensity*(.82+.022*i)*(1-.58*throat),.010+.20*blush,.044+.34*blush),-1)
    rgb[:,:,0]*=1-.035*np.maximum(0,grain)
    alb=save_image(f'petal-{i+1}-unique-pigment',np.clip(rgb,0,1));normal=save_image(f'petal-{i+1}-branching-veins',no*.5+.5,True)
    m=bpy.data.materials.new(f'Scarlet petal {i+1} • unique crinkled tissue');m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value=.68;p.inputs['Specular IOR Level'].default_value=.22;p.inputs['Subsurface Weight'].default_value=.055
    p.inputs['Subsurface Radius'].default_value=(1,.1,.05)
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=alb;m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=normal;no=m.node_tree.nodes.new('ShaderNodeNormalMap');no.inputs['Strength'].default_value=.55;m.node_tree.links.new(tex.outputs['Color'],no.inputs['Color']);m.node_tree.links.new(no.outputs['Normal'],p.inputs['Normal'])
    ob=bpy.data.objects[f'Petal {i+1} • folded fan surface'];ob.data.materials.clear();ob.data.materials.append(m)
# Re-seat droplets and vary their concentration, rather than spreading them uniformly.
o=bpy.data.objects['180 dew droplets on petal surfaces'];vertices=list(o.data.vertices)
rng=random.Random(9234)
for i in range(5):
    for j in range(36):
        group=vertices[(i*36+j)*160:(i*36+j+1)*160]
        u0=rng.uniform(.42,.98);v0=max(-.96,min(.96,rng.gauss([.25,-.3,-.05,.15,.5][i],.4)))
        p=petal_point(i,u0,v0);nrm=(petal_point(i,u0+.001,v0)-p).cross(petal_point(i,u0,v0+.001)-p).normalized()
        if nrm.z<0:nrm=-nrm
        r=rng.uniform(.010,.031)*(1.7 if j%13==0 else 1);q=Vector((0,0,1)).rotation_difference(nrm)
        for jj in range(10):
            for kk in range(16):
                th=pi*jj/9;ph=2*pi*kk/16;pt=Vector((r*sin(th)*cos(ph),r*sin(th)*sin(ph),r*.66*cos(th)))
                group[jj*16+kk].co=p+nrm*r*.35+q@pt
o.data.update()
# Add irregular pollen shapes and break the perfect five-spoke symmetry of stigma branches.
for i in range(5):
    o=bpy.data.objects[f'Style branch {i+1}'];o.location.x=[-.024,.017,.009,-.014,.031][i];o.location.y=[.017,-.029,.023,-.01,.015][i]
for name,count in [('Five crimson stigma pads',312),('700 velvet stigma papillae',2800)]:
    ob=bpy.data.objects[name]
    for i in range(5):
        delta=Vector(([ -.024,.017,.009,-.014,.031][i],[.017,-.029,.023,-.01,.015][i],0))
        for k in range(i*count,(i+1)*count):ob.data.vertices[k].co+=delta
    ob.data.update()

# Camera with world Y up, matching the browser portrait.
cam=bpy.context.scene.camera;cam.location=(6.0,.8,12.8);target=Vector((0,-.6,.7));forward=(target-cam.location).normalized();right=forward.cross(Vector((0,1,0))).normalized();up=right.cross(forward)
cam.rotation_euler=Matrix((right,up,-forward)).transposed().to_euler();cam.data.ortho_scale=10.6
bpy.context.scene.render.filepath=str(OUT/'hibiscus-render.png')
# Save the revised geometry and export only this study's botanical objects.
bpy.ops.object.select_all(action='DESELECT')
for k,c in COL.items():
    if k!='08':
        for o in c.objects:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'hibiscus.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'hibiscus.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
print('NATURAL_SCULPT_DONE: five distinct silhouettes and five unique branching tissue textures')

# Finish with the photo-guided, irregular foliage arrangement.
foliage_script=OUT / "source" / "refine_foliage.py"
exec(compile(foliage_script.read_text(), str(foliage_script), "exec"))
