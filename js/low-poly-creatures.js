import * as THREE from 'three';

// Shared, texture-free geometry; each creature owns its materials for status tinting.
const shapes = {
  gem: new THREE.IcosahedronGeometry(1, 0),
  head: new THREE.IcosahedronGeometry(1, 1),
  cone: new THREE.ConeGeometry(1, 1, 6),
  barrel: new THREE.CylinderGeometry(.8, 1, 1, 6),
  limb: new THREE.CylinderGeometry(.8, 1, 1, 6).translate(0, -.5, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
};

export function buildLowPolyCreature(type, palette, sex) {
  const root = new THREE.Group(), tintTargets = [], materials = new Map();
  root.userData.style = 'low-poly';
  root.userData.species = type;
  const part = (name, shape, color, position, scale, parent = root) => {
    if (!materials.has(color)) {
      const material = new THREE.MeshStandardMaterial({color, roughness: .95, flatShading: true});
      material.userData.base = material.color.clone();
      materials.set(color, material);
      tintTargets.push({material});
    }
    const m = new THREE.Mesh(shapes[shape], materials.get(color));
    m.name = name; m.position.set(...position); m.scale.set(...scale);
    m.castShadow = true; parent.add(m); return m;
  };
  const eye = (x,y,z,size=.027,parent=root) => part('eye','gem',0x20282b,[x,y,z],[size,size*1.15,size*.55],parent);
  const wing = (side,y,z,color,parent=root) => {
    const m=part('wing','gem',color,[side*.48,y,z],[.48,.12,.32],parent);
    m.rotation.z=side*.35;return m;
  };
  const p=palette;
  if(p.kind==='fish') {
    const body=part('body','gem',p.body,[0,0,.02],[.13,.18,.32]);
    const tail=part('tail','gem',p.fin,[0,0,-.32],[.035,.19,.14]);
    part('dorsal-fin','gem',p.fin,[0,.19,0],[.025,.14,.14]);
    eye(-.115,.05,.18,.018);eye(.115,.05,.18,.018);
    return {root,body,tail,tintTargets,kind:p.kind};
  }
  if(p.kind==='quad') {
    const dragon=type==='dragon',bear=type==='bear',deer=type==='herbivore',boar=type==='boar';
    const body=part('body','head',p.body,[0,.53,0],[bear?.43:.32,bear?.4:.28,dragon?.65:.52]);
    const head=part('head','head',p.head,[0,.73,.52],[bear?.28:.22,.23,.28]);
    part('muzzle','barrel',p.head,[0,.65,.75],[.14,.16,.15]).rotation.x=Math.PI/2;
    const legs=[];
    for(const [x,z] of [[-.22,.3],[.22,.3],[-.22,-.3],[.22,-.3]]){
      const leg=part('leg','limb',p.legs,[x,.45,z],[bear?.1:.065,.42,.07]);
      legs.push(leg);
      part('hoof','gem',p.legs,[0,-.92,.2],[1.1,.12,1.4],leg);
    }
    for(const side of [-1,1]){
      part('ear',bear?'gem':'cone',p.ear,[side*.17,.95,.5],[.065,.16,.08]);
      eye(side*.16,.78,.725);
      if(deer) {
        const antler=part('antler','barrel',0xa88b60,[side*.16,1.17,.45],[.025,.42,.025]);antler.rotation.z=-side*.35;
        part('antler-tip','cone',0xa88b60,[side*.3,1.29,.45],[.025,.2,.025]).rotation.z=-side*.8;
      }
      if(boar)part('tusk','cone',0xeee2be,[side*.13,.66,.84],[.035,.19,.035]);
      if(dragon)wing(side,.83,-.15,0xc57b42);
    }
    if(type==='carnivore')part('neck-ruff','gem',0x534d49,[0,.68,.33],[.29,.31,.25]);
    const tail=part('tail','cone',p.body,[0,.57,-.62],[.07,dragon?.72:.3,.07]);tail.rotation.x=-Math.PI/2;
    if(dragon)for(let i=0;i<4;i++)part('spine','cone',p.ear,[0,.84,-.45+i*.22],[.07,.2,.07]);
    return {root,body,head,tail,legFL:legs[0],legFR:legs[1],legBL:legs[2],legBR:legs[3],tintTargets,kind:p.kind};
  }

  const dwarf=type==='dwarf',orc=type==='orc',elf=type==='elf',skeleton=type==='skeleton',ghost=type==='ghost';
  const width=orc?1.22:dwarf?1.13:elf?.86:1;
  const hip=dwarf?.39:.49, shoulder=hip+.43, headY=shoulder+.24;
  const legColor=skeleton?p.skin:p.legs;
  const limb=(name,color,position,scale)=>{
    const pivot=new THREE.Group();pivot.name=name;pivot.position.set(...position);root.add(pivot);
    part(name+'-mesh','limb',color,[0,0,0],scale,pivot);return pivot;
  };
  const legL=limb('left-leg',legColor,[-.12*width,hip,0],[skeleton?.045:.075,hip-.055,.08]);
  const legR=limb('right-leg',legColor,[.12*width,hip,0],[skeleton?.045:.075,hip-.055,.08]);
  if(!skeleton)for(const leg of [legL,legR])part('boot','gem',0x403c35,[0,-hip+.06,.035],[.1,.075,.15],leg);
  const torso=part('tunic','barrel',skeleton?p.skin:p.tunic,[0,hip+.22,0],[.27*width,.44,.18]);
  part('belt','barrel',0x594635,[0,hip+.06,0],[.275*width,.055,.185]);
  part('buckle','box',0xbca16a,[0,hip+.06,.185],[.065,.06,.025]);
  const armL=limb('left-arm',p.skin,[-.29*width,shoulder,0],[skeleton?.038:.065,.39,.07]);
  const armR=limb('right-arm',p.skin,[.29*width,shoulder,0],[skeleton?.038:.065,.39,.07]);
  if(!skeleton)for(const arm of [armL,armR])part('sleeve','barrel',p.tunic,[0,-.09,0],[.08,.2,.085],arm);
  part('neck','barrel',p.skin,[0,shoulder+.035,0],[.07,.1,.07]);
  const head=part('head','head',p.skin,[0,headY,0],[type==='alien'?.245:.205,.23,.195]);
  for(const side of [-1,1])eye(side*.075,headY+.025,.18,type==='alien'?.054:skeleton?.045:.026);
  part('nose','gem',p.skin,[0,headY-.035,.193],[.036,.045,.055]);
  if(p.hair){
    part('hair','head',p.hair,[0,headY+.125,-.025],[.214,.145,.198]);
    if(elf||sex==='f')part('back-hair','gem',p.hair,[0,headY-.055,-.145],[.19,.24,.085]);
  }
  if(p.ears==='pointed')for(const side of [-1,1]){
    const ear=part('pointed-ear','cone',p.skin,[side*.235,headY+.02,0],[.055,.21,.06]);ear.rotation.z=-side*1.1;
  }
  if(p.tusks)for(const side of [-1,1])part('tusk','cone',0xf0e7ce,[side*.085,headY-.09,.18],[.03,.115,.03]);
  if(p.beard)part('beard','gem',p.beard,[0,headY-.16,.14],[.18,.23,.12]);
  if(p.helmet)part('helmet','head',p.helmet,[0,headY+.15,-.025],[.23,.16,.21]);
  if(orc)part('shoulder-guard','gem',0x776d5b,[-.34,shoulder,0],[.14,.11,.19]);
  if(type==='mage'){
    part('hat-brim','barrel',p.tunic,[0,headY+.22,0],[.29,.045,.27]);
    part('wizard-hat','cone',p.tunic,[0,headY+.42,0],[.21,.42,.21]);
  }
  if(type==='demon')for(const side of [-1,1]){
    const horn=part('horn','cone',0xc6ad86,[side*.14,headY+.28,-.025],[.055,.27,.06]);horn.rotation.z=-side*.3;
  }
  if(type==='fairy')for(const side of [-1,1]){
    const w=wing(side,shoulder,-.16,0xbce8df);w.scale.y=.25;w.rotation.z=side*.6;
  }
  if(skeleton){
    torso.scale.x=.045;
    for(let i=0;i<3;i++)part('rib','barrel',p.skin,[0,hip+.16+i*.09,.035],[.18-i*.018,.038,.095]);
  }
  if(ghost){
    part('spectral-robe','cone',p.tunic,[0,.4,0],[.34,.85,.26]);
    for(const material of materials.values()){material.transparent=true;material.opacity=.68;material.depthWrite=false;}
  }
  return {root,legL,legR,armL,armR,torso,head,tintTargets,kind:p.kind};
}
