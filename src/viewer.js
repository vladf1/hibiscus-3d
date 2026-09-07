import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const $=s=>document.querySelector(s);
const host=$('#stage');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<700?1.5:2));renderer.setClearColor(0,0);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
host.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','Interactive 3D hibiscus. Drag to orbit, scroll to zoom, right-drag to pan.');
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(40,1,.02,150);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.minDistance=1;controls.maxDistance=30;controls.autoRotateSpeed=.65;
const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();const environment=pmrem.fromScene(room,.025);scene.environment=environment.texture;scene.environmentIntensity=.25;room.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xf6f5e6,0x355438,.6));
function light(p,c,intensity){const l=new THREE.DirectionalLight(c,intensity);l.position.set(...p);if(p[0]===-4&&p[1]===7){l.castShadow=true;l.shadow.mapSize.set(2048,2048);Object.assign(l.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.1,far:30});l.shadow.bias=-.0003;l.shadow.normalBias=.025}scene.add(l)}
light([-4,7,9],0xfff0e0,1.28);light([5,2,5],0xe3efff,.84);light([-4,3,-5],0xffb79e,1.0);
let flower,materials=[],meshes=[],transition=null,loaded=false;
const presets={portrait:{p:[5.2,.6,11.6],t:[0,-.85,.6]},front:{p:[0,-.05,10.8],t:[0,0,.65]},side:{p:[10.7,.9,1.1],t:[0,-.15,1]},back:{p:[-2.6,1,-11.2],t:[0,-.5,-.45]},macro:{p:[2,1.1,6.6],t:[-.32,.0,3.45]}};
function go(name,instant=false){const source=presets[name];const factor=name==='macro'?1:Math.max(1,.78/camera.aspect);const v=source?{t:source.t,p:source.p.map((x,i)=>source.t[i]+(x-source.t[i])*factor)}:null;if(!v)return;controls.autoRotate=false;$('#rotate').setAttribute('aria-pressed','false');$('.view.active')?.classList.remove('active');$(`[data-view="${name}"]`)?.classList.add('active');if(instant){camera.position.set(...v.p);controls.target.set(...v.t);controls.update()}else transition={from:camera.position.clone(),to:new THREE.Vector3(...v.p),startTarget:controls.target.clone(),endTarget:new THREE.Vector3(...v.t),time:performance.now()};$('#view-name').textContent={portrait:'Three-quarter portrait',front:'Corolla · front',side:'Profile · side',back:'Calyx · reverse',macro:'Stigma & pollen · macro'}[name];}
go('portrait',true);
function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();if(!loaded)go('portrait',true)}
new ResizeObserver(resize).observe(host);resize();
let bytes;
async function loadFlower(){
try{const response=await fetch(new URL('../assets/hibiscus.glb', import.meta.url));if(!response.ok)throw new Error('Model download failed');bytes=new Uint8Array(await response.arrayBuffer());
new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(bytes.buffer,'',g=>{
 flower=g.scene;flower.rotation.x=Math.PI/2;scene.add(flower);
 flower.traverse(o=>{if(o.isMesh){meshes.push(o);o.frustumCulled=false;o.receiveShadow=true;o.castShadow=/Petal|leaf|column|throat|sepal/i.test(o.name);for(const m of (Array.isArray(o.material)?o.material:[o.material])){m.side=THREE.DoubleSide;m.envMapIntensity=.65;if(m.name.includes('Scarlet')){m.roughness=.64;m.normalScale.set(.48,.48);m.sheen=0;m.specularIntensity=.4}if(m.name.includes('Water')){m.envMapIntensity=1.2}materials.push(m)}}});
 loaded=true;$('#loading').classList.add('loaded');$('#status').textContent='MODEL READY';$('#mesh-count').textContent=`${Math.round(meshes.reduce((a,m)=>a+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0)/1000)}k triangles`;
 window.hibiscus={scene,camera,renderer,controls,flower,meshes,go,get ready(){return loaded}};
},e=>{$('#loading').textContent='The model could not load. '+e.message;console.error(e)});
}catch(e){$('#loading').textContent='Could not open the flower. Please refresh to try again.';console.error(e)}
}
loadFlower();
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>go(b.dataset.view);
$('#rotate').onclick=()=>{transition=null;controls.autoRotate=!controls.autoRotate;$('#rotate').setAttribute('aria-pressed',String(controls.autoRotate))};
$('#reset').onclick=()=>go('portrait');
$('#foliage').onchange=e=>{meshes.filter(o=>/Leaf|leaf|pedicel|stem|petiole/i.test(o.name)).forEach(o=>o.visible=e.target.checked)};
$('#dew').onchange=e=>meshes.filter(o=>/dew.droplets/i.test(o.name)).forEach(o=>o.visible=e.target.checked);
$('#wire').onchange=e=>materials.forEach(m=>m.wireframe=e.target.checked);
$('#exposure').oninput=e=>renderer.toneMappingExposure=+e.target.value;
$('#background').onclick=()=>{document.body.classList.toggle('light');$('#background').setAttribute('aria-pressed',String(document.body.classList.contains('light')))};
$('#fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen?.()};
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000)}
$('#save').onclick=()=>{renderer.render(scene,camera);renderer.domElement.toBlob(b=>download(b,'hibiscus-view.png'))};
$('#glb').onclick=()=>bytes&&download(new Blob([bytes],{type:'model/gltf-binary'}),'hibiscus.glb');
$('#details').onclick=()=>{const p=$('#detail-panel');p.hidden=!p.hidden;$('#details').setAttribute('aria-expanded',String(!p.hidden))};
window.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;if(e.code==='Space'){e.preventDefault();$('#rotate').click()}if(e.key.toLowerCase()==='r')go('portrait');if(e.key==='Escape')$('#detail-panel').hidden=true});
controls.addEventListener('start',()=>transition=null);
function frame(now){requestAnimationFrame(frame);if(transition){let t=Math.min((now-transition.time)/850,1);t=t*t*(3-2*t);camera.position.lerpVectors(transition.from,transition.to,t);controls.target.lerpVectors(transition.startTarget,transition.endTarget,t);if(t>=1)transition=null}controls.update();renderer.render(scene,camera)}requestAnimationFrame(frame);
