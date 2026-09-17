import * as THREE from 'three';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { riverSurfaceAt } from './river-surface.js';

export function planRiverBridges(world, nodes, width = .9) {
  const samples = [];
  let distance = 0;
  for (let i=1;i<nodes.length;i++) {
    const a=nodes[i-1], b=nodes[i], length=Math.hypot(b[0]-a[0],b[1]-a[1]), n=Math.max(1,Math.ceil(length/.25));
    for (let k=0;k<n;k++) {
      const t=k/n, x=a[0]+(b[0]-a[0])*t, z=a[1]+(b[1]-a[1])*t;
      const nx=(b[1]-a[1])/(length||1)*width/2, nz=-(b[0]-a[0])/(length||1)*width/2;
      const waters=[riverSurfaceAt(world,x,z),riverSurfaceAt(world,x+nx,z+nz),riverSurfaceAt(world,x-nx,z-nz)].filter(v=>v!=null);
      samples.push({x,z,d:distance+length*t, water:waters.length?Math.max(...waters):null});
    }
    distance+=length;
  }
  if (!samples.length) return [];
  const last=nodes.at(-1); samples.push({x:last[0],z:last[1],d:distance,water:riverSurfaceAt(world,...last)});
  const bridges=[];
  for (let i=0;i<samples.length;i++) {
    if (samples[i].water==null) continue;
    const first=i; let end=i;
    while (end+1<samples.length && samples[end+1].water!=null) end++;
    // A crossing needs two actual banks; don't build a pier ending in a lake.
    if (first===0 || end===samples.length-1 || samples[end].d-samples[first].d>24) {i=end;continue;}
    let a=first-1,b=end+1;
    while(a>0 && samples[first].d-samples[a].d<1.7) a--;
    while(b<samples.length-1 && samples[b].d-samples[end].d<1.7) b++;
    const water=Math.max(...samples.slice(first,end+1).map(p=>p.water));
    const bankA=world.heightAtWorld(samples[a].x,samples[a].z)+.04, bankB=world.heightAtWorld(samples[b].x,samples[b].z)+.04;
    const deck=Math.max(water+.35,bankA,bankB);
    const startD=Math.max(samples[a].d+.01,samples[first].d-.35);
    const endD=Math.min(samples[b].d-.01,samples[end].d+.35);
    const points=samples.slice(a,b+1).map(p=>{
      let y=deck;
      if(p.d<startD) y=bankA+(deck-bankA)*(p.d-samples[a].d)/Math.max(.01,startD-samples[a].d);
      if(p.d>endD) y=deck+(bankB-deck)*(p.d-endD)/Math.max(.01,samples[b].d-endD);
      return {x:p.x,z:p.z,y:Math.max(y,world.heightAtWorld(p.x,p.z)+.04)};
    });
    bridges.push({points,width:Math.max(1.6,width+.2),water,deck,key:points.map(p=>`${p.x.toFixed(2)},${p.z.toFixed(2)}`).join('|')});
    i=end;
  }
  return bridges;
}

export function bridgeHeightAt(bridges, x, z, margin=0) {
  let height=null;
  for(const bridge of bridges||[]) for(let i=1;i<bridge.points.length;i++) {
    const a=bridge.points[i-1],b=bridge.points[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;
    const t=((x-a.x)*dx+(z-a.z)*dz)/(l2||1);
    if(t<0 || t>1) continue;
    if(Math.hypot(x-a.x-dx*t,z-a.z-dz*t)>bridge.width/2+margin) continue;
    const y=a.y+(b.y-a.y)*t;
    height=height==null?y:Math.max(height,y);
  }
  return height;
}

export function buildBridgeGeometry(world,bridges) {
  const parts=[];
  const beam=(a,b,width,depth,color)=>{
    const start=new THREE.Vector3(a.x,a.y,a.z),end=new THREE.Vector3(b.x,b.y,b.z),dir=end.clone().sub(start);
    if(dir.length()<.001)return;
    const g=new THREE.BoxGeometry(width,depth,dir.length()+.018).toNonIndexed();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),dir.normalize()));
    g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);
    const c=new THREE.Color(color), colors=[];
    for(let i=0;i<g.attributes.position.count;i++)colors.push(c.r,c.g,c.b);
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));parts.push(g);
  };
  for(const bridge of bridges) for(let i=1;i<bridge.points.length;i++) {
    const a=bridge.points[i-1],b=bridge.points[i],length=Math.hypot(b.x-a.x,b.z-a.z)||1;
    beam({...a,y:a.y-.065},{...b,y:b.y-.065},bridge.width,.12,i%2?0xa27d50:0x947044);
    for(const side of [-1,1]) {
      const ox=(b.z-a.z)/length*bridge.width*.45*side,oz=-(b.x-a.x)/length*bridge.width*.45*side;
      for(const lift of [.3,.62])beam({x:a.x+ox,y:a.y+lift,z:a.z+oz},{x:b.x+ox,y:b.y+lift,z:b.z+oz},.055,.065,0x6c5033);
      if(i%4===1 || i===bridge.points.length-1) {
        const x=a.x+ox,z=a.z+oz;
        beam({x,z,y:world.heightAtWorld(x,z)-.08},{x,z,y:a.y+.7},.09,.09,0x614b34);
      }
    }
  }
  const result=parts.length?mergeGeometries(parts):new THREE.BufferGeometry();
  for(const p of parts)p.dispose();return result;
}
