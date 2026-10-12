import * as THREE from 'three'
import { createHuman } from './human'
import type { HandWave } from './hand-tracking'

const atlas=new THREE.Texture();atlas.colorSpace=THREE.SRGBColorSpace
const front=new THREE.Vector4(),back=new THREE.Vector4()
let ready:Promise<void>|undefined
export function loadWizardPhotos(){
  return ready??=new THREE.ImageLoader().loadAsync(`${import.meta.env.BASE_URL}models/wizard-photo-atlas.png`).then(image=>{
    atlas.image=image;atlas.needsUpdate=true
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d')!;context.drawImage(image,0,0)
    const pixels=context.getImageData(0,0,image.width,image.height).data
    for(let panel=0;panel<2;panel++){
      let left=image.width,right=0,top=image.height,bottom=0
      for(let y=0;y<image.height;y++)for(let x=panel*image.width/2;x<(panel+1)*image.width/2;x++)if(pixels[(y*image.width+x)*4+3]>200){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}
      let headX=0,count=0
      for(let y=top;y<top+(bottom-top)*.14;y++)for(let x=left;x<=right;x++)if(pixels[(y*image.width+x)*4+3]>200){headX+=x;count++}
      const width=right-left+1,center=count?headX/count:(left+right)/2
      ;(panel?back:front).set((center-width/2)/image.width,1-(bottom+1)/image.height,width/image.width,(bottom-top+1)/image.height)
    }
  }).catch(error=>{ready=undefined;throw error})
}
export function createWizard(){
  const human=createHuman({atlas,front,back,muscular:true,whiteSuit:true,squareJaw:true,strideReach:1.12,neutralNeck:true}),root=human.root;root.name='wizard-visitor'
  root.scale.multiply(new THREE.Vector3(1.15,1.19,1.13))
  root.getObjectByName('crossbody-bag')!.visible=false;root.getObjectByName('crossbody-strap')!.visible=false
  root.traverse(object=>{if(object instanceof THREE.Mesh&&object.userData.handSurface){const material=object.material as THREE.MeshStandardMaterial;material.vertexColors=false;material.color.set(0xf4f2eb);material.needsUpdate=true}})
  const white=new THREE.MeshStandardMaterial({color:0xf4f2ed,roughness:.8}),navy=new THREE.MeshStandardMaterial({color:0x244269,roughness:.85}),silver=new THREE.MeshStandardMaterial({color:0xc5c9cb,metalness:.8,roughness:.25})
  const extras:THREE.Mesh[]=[]
  const add=(name:string,geometry:THREE.BufferGeometry,material:THREE.Material,parent:THREE.Object3D,x:number,y:number,z:number)=>{const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);extras.push(mesh);return mesh}
  const head=root.getObjectByName('head')!,hat=new THREE.Group();hat.name='wizard-top-hat';head.add(hat);hat.position.y=-.13;hat.rotation.z=-.025
  head.scale.multiplyScalar(.86);hat.scale.set(.92,.9,.92)
  add('hat-brim',new THREE.CylinderGeometry(.98,.98,.065,40),white,hat,0,.67,0)
  add('hat-crown',new THREE.CylinderGeometry(.61,.55,1.5,40),white,hat,0,1.44,0)
  add('hat-blue-band',new THREE.CylinderGeometry(.567,.555,.22,40),navy,hat,0,.83,0)
  add('monocle-rim',new THREE.TorusGeometry(.122,.011,8,32),silver,head,.15,.065,.4)
  const glass=new THREE.MeshPhysicalMaterial({color:0xcbdfe5,transparent:true,opacity:.12,roughness:.05,depthWrite:false})
  add('monocle-glass',new THREE.CircleGeometry(.117,32),glass,head,.15,.065,.403)
  const chain=new THREE.CatmullRomCurve3([new THREE.Vector3(.26,.065,.4),new THREE.Vector3(.37,-.22,.37),new THREE.Vector3(.32,-.5,.26),new THREE.Vector3(.15,-.62,.24)])
  add('monocle-chain',new THREE.TubeGeometry(chain,24,.009,5,false),silver,head,0,0,0)
  const columns=24,rows=28,geometry=new THREE.PlaneGeometry(1,1,columns,rows),positions=geometry.getAttribute('position'),clothVelocity=new Float32Array(positions.count*3)
  const capeMaterial=new THREE.MeshStandardMaterial({color:0xe7e9e7,roughness:.95,side:THREE.DoubleSide})
  const body=head.parent!,cape=add('wizard-cape',geometry,capeMaterial,body,0,0,0)
  const leftShoulder=root.getObjectByName('left-shoulder')!,rightShoulder=root.getObjectByName('right-shoulder')!
  let capeTime=0,clothReady=false
  const capePose=(time:number,walking:boolean)=>{
    if(clothReady&&time-capeTime<1/30)return
    const dt=Math.min(.05,Math.max(0,time-capeTime));capeTime=time
    for(let i=0;i<positions.count;i++){
      const column=i%(columns+1),row=Math.floor(i/(columns+1)),t=row/rows,u=column/columns*2-1,s=(u+1)/2
      const topX=THREE.MathUtils.lerp(leftShoulder.position.x-.22,rightShoulder.position.x+.22,s)
      const topY=5.22-.07*(1-u*u),topZ=THREE.MathUtils.lerp(leftShoulder.position.z-.2,rightShoulder.position.z-.2,s)-.42*(1-u*u)
      const fold=Math.sin(u*15+t*3)*(.012+t*.06)
      const flutter=Math.sin(time*(walking?5.5:2.1)-t*5+u*2)*(walking?.2:.065)*t*t
      const hem=-body.position.y+.05+.02*Math.sin(u*6+time*2)
      const target=[THREE.MathUtils.lerp(topX,u*1.65,t)+Math.sin(time*1.4+t*3)*.06*t*t,THREE.MathUtils.lerp(topY,hem,t),THREE.MathUtils.lerp(topZ,-.65-(walking?.2:0),t)+fold+flutter]
      for(let axis=0;axis<3;axis++){
        const current=axis===0?positions.getX(i):axis===1?positions.getY(i):positions.getZ(i),offset=i*3+axis
        let value=target[axis]
        if(clothReady&&row>0){clothVelocity[offset]+=((target[axis]-current)*(55-30*t)-clothVelocity[offset]*8)*dt;value=current+clothVelocity[offset]*dt}
        if(axis===0)positions.setX(i,value);else if(axis===1)positions.setY(i,Math.max(-body.position.y+.025,value));else positions.setZ(i,value)
      }
    }
    clothReady=true
    positions.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere()
    cape.visible=true
  }
  return{root,animate(time:number,walking:boolean,travelled:number,wave?:HandWave,hanging=0){human.animate(time,0,walking,travelled,wave,hanging);capePose(time,walking)},dispose(){for(const mesh of extras)mesh.geometry.dispose();white.dispose();navy.dispose();silver.dispose();glass.dispose();capeMaterial.dispose();human.dispose()}}
}
