import * as THREE from 'three'
import type { Pigeon } from './world'
import type { HandWave } from './hand-tracking'
import type { FlockBody } from './flock-physics'
import { createWizard } from './wizard'
import { resolveContacts } from './flock-physics'

export function createWizardVisit(scene:THREE.Scene,camera:THREE.PerspectiveCamera,container:HTMLElement,birds:Pigeon[],finished:()=>void,viewTarget=new THREE.Vector3(0,1,0)){
  const wizard=createWizard();scene.add(wizard.root)
  wizard.root.traverse(object=>{if(object instanceof THREE.Mesh)object.castShadow=false})
  const shadowGeometry=new THREE.PlaneGeometry(3.8,2.8)
  const shadowMaterial=new THREE.ShaderMaterial({
    uniforms:{opacity:{value:0}},transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform float opacity;varying vec2 vUv;void main(){vec2 p=(vUv-vec2(0.35,0.5))/vec2(0.2,0.32);vec2 q=(vUv-vec2(0.65,0.5))/vec2(0.2,0.32);float a=exp(-dot(p,p)*3.0)+exp(-dot(q,q)*3.0);gl_FragColor=vec4(0.0,0.0,0.0,min(a,1.0)*opacity);}'
  })
  const footShadow=new THREE.Mesh(shadowGeometry,shadowMaterial);footShadow.name='wizard-foot-shadow';footShadow.renderOrder=1;footShadow.visible=false;scene.add(footShadow)
  const updateShadow=()=>{
    const contact=1-THREE.MathUtils.smoothstep(wizard.root.position.y,.08,1.7)
    shadowMaterial.uniforms.opacity.value=contact*.32;footShadow.visible=contact>.001
    footShadow.position.set(wizard.root.position.x,.035,wizard.root.position.z)
    footShadow.rotation.set(-Math.PI/2,0,-wizard.root.rotation.y)
    footShadow.scale.setScalar(1+(1-contact)*.15)
  }
  wizard.animate(0,false,0);wizard.root.updateMatrixWorld(true)
  const wizardHeight=new THREE.Box3().setFromObject(wizard.root).max.y
  const guide=document.createElement('div');guide.className='wizard-guide';guide.hidden=true
  const guideText=document.createElement('span');guideText.className='wide-text';guideText.textContent='"Move your hand to guide the pigeons."';guide.append(guideText);container.append(guide)
  const visible=birds.filter(bird=>bird.root.visible),center=visible.length?visible.reduce((sum,bird)=>sum.add(bird.root.position),new THREE.Vector3()).divideScalar(visible.length).setY(0):viewTarget.clone().setY(0)
  const cameraFrom=camera.position.clone(),targetFrom=viewTarget.clone(),viewDirection=cameraFrom.clone().sub(viewTarget).normalize(),targetTo=center.clone().setY(3.5)
  const forward=center.clone().sub(camera.position).setY(0).normalize();if(forward.lengthSq()<.01)forward.set(0,0,-1)
  const right=new THREE.Vector3(-forward.z,0,forward.x),standing=center.clone()
  const currentDistance=cameraFrom.distanceTo(viewTarget),maximumDistance=Math.max(32,currentDistance)
  const minimumDistance=camera.aspect<1&&visible.length>20?32:20
  let distance=Math.max(minimumDistance,currentDistance),cameraTo=new THREE.Vector3();const fit=camera.clone()
  // Frame the wizard and nearby flight height, not every scattered pigeon.
  // The control phase brings the flock into view without widening the camera.
  const fitPoints=[standing.clone(),standing.clone().setY(wizardHeight+1),center.clone().setY(12)]
  for(let i=0;i<30;i++){
    cameraTo.copy(targetTo).addScaledVector(viewDirection,distance);fit.position.copy(cameraTo);fit.lookAt(targetTo);fit.updateMatrixWorld(true)
    if(fitPoints.every(point=>{const p=point.clone().project(fit);return p.z>-1&&p.z<1&&Math.abs(p.x)<.85&&Math.abs(p.y)<.85})||distance>=maximumDistance)break
    distance=Math.min(maximumDistance,distance*1.1)
  }
  const rise=Math.max(22,distance),enterDuration=2.9,exitDuration=2.5,turnDuration=1.1,controlDuration=60
  const faceHeading=Math.atan2(-forward.x,-forward.z),approachHeading=faceHeading+.16
  wizard.root.position.copy(standing).y=rise;wizard.root.rotation.y=approachHeading
  const ropeGeometry=new THREE.CylinderGeometry(.045,.045,1,8),ropeMaterial=new THREE.MeshStandardMaterial({color:0x9b8260,roughness:1})
  const rope=new THREE.Mesh(ropeGeometry,ropeMaterial);rope.name='wizard-rope';scene.add(rope)
  const ropeTail=4,ropeTop=rise+wizardHeight+32,grip=new THREE.Vector3(),releaseGrip=new THREE.Vector3()
  rope.userData.tail=ropeTail
  const ropePose=(bottom:THREE.Vector3)=>{const end=bottom.y-ropeTail;rope.visible=true;rope.position.set(bottom.x,(ropeTop+end)/2,bottom.z);rope.scale.y=Math.max(.01,ropeTop-end)}
  const hang=()=>{
    wizard.animate(time,false,travelled,{x:0,y:0,strength:1,arms:{left:{x:-.2,y:1,strength:1},right:{x:0,y:-1,strength:1}}},1)
    const shoulder=wizard.root.getObjectByName('left-shoulder')!
    wizard.root.getObjectByName('left-hip')!.rotation.x=-.15
    wizard.root.getObjectByName('left-hip')!.getObjectByName('knee')!.rotation.x=.3
    wizard.root.rotation.z=.035*Math.sin(time*1.8)
    wizard.root.updateMatrixWorld(true);shoulder.getObjectByName('hand')!.getWorldPosition(grip)
    ropePose(grip);releaseGrip.copy(grip)
  }
  let time=0,travelled=0,disposed=false,leavingAt:number|undefined,lastWave=-Infinity,controlStarted=false,guideStartedAt=Infinity
  const wave:HandWave={x:0,y:0,strength:0},requested:HandWave={x:0,y:0,strength:0}
  let flightHeight=0
  let vortexUntil=0,vortexAngle=0,vortexActive=false,patternActive=false
  const anchor=new THREE.Vector3(),screen=new THREE.Vector3(),correction=new THREE.Vector3()
  const beforeControl:THREE.Vector3[]=[],viewForward=new THREE.Vector3()
  const projectionView=new THREE.Matrix4(),clipFrom=new THREE.Vector4(),clipTo=new THREE.Vector4()
  const activeFrame:Pigeon[]=[],bodyFrame:FlockBody[]=[],bodyPool:FlockBody[]=[]
  const groupGoal=new THREE.Vector3(),flockCenter=new THREE.Vector3(),birdGoal=new THREE.Vector3(),patternRay=new THREE.Vector3(),stepVelocity=new THREE.Vector3()
  const innerSafe=new THREE.Vector3(),standingSafe=new THREE.Vector3(),pairDelta=new THREE.Vector3(),movementDelta=new THREE.Vector3(),previousAnchor=new THREE.Vector3(),frameProjection=new THREE.Vector3()
  const clipToward=(point:THREE.Vector3,safe:THREE.Vector3,xLimit:number,yLow:number,yHigh:number)=>{
    clipFrom.set(point.x,point.y,point.z,1).applyMatrix4(projectionView)
    clipTo.set(safe.x,safe.y,safe.z,1).applyMatrix4(projectionView)
    let amount=0
    const cut=(a:number,b:number)=>{if(a<0)amount=Math.max(amount,b>a?-a/(b-a):1)}
    const a=clipFrom,b=clipTo
    cut(xLimit*a.w-a.x,xLimit*b.w-b.x);cut(xLimit*a.w+a.x,xLimit*b.w+b.x)
    cut(a.y-yLow*a.w,b.y-yLow*b.w);cut(yHigh*a.w-a.y,yHigh*b.w-b.y)
    cut(a.z+a.w,b.z+b.w);cut(a.w-a.z,b.w-b.z)
    point.lerp(safe,Math.min(1,amount+1e-5))
  }
  const inside=(point:THREE.Vector3)=>{const p=frameProjection.copy(point).project(camera);return p.z>-1&&p.z<1&&Math.abs(p.x)<=.8&&p.y>=-.76&&p.y<=.72}
  const keepInFrame=(bird:Pigeon)=>{
    // Apply after separation too: collisions and vortex spacing can push a
    // bird past its destination. Leave room for its head and flapping wings.
    for(let pass=0;pass<3;pass++){
      anchor.copy(bird.root.position).y+=1
      screen.copy(anchor).project(camera)
      const x=THREE.MathUtils.clamp(screen.x,-.8,.8),y=THREE.MathUtils.clamp(screen.y,-.76,.72)
      if(x===screen.x&&y===screen.y)break
      if(!patternActive){
        const safe=standingSafe.set(standing.x,anchor.y,standing.z)
        screen.copy(anchor);clipToward(screen,safe,.8,-.76,.72)
      }else screen.set(x,y,screen.z).unproject(camera)
      correction.copy(screen).sub(anchor)
      bird.root.position.add(correction);bird.root.position.y=Math.max(patternActive?1.5:0,bird.root.position.y)
      correction.normalize()
      const outward=bird.velocity.dot(correction)
      if(outward<0)bird.velocity.addScaledVector(correction,-outward)
    }
  }
  const groundPose=(bird:Pigeon)=>{bird.root.position.y=0;bird.root.rotation.z=0;bird.torso.rotation.x=0;bird.wings.forEach(wing=>{wing.rotation.z=0;wing.scale.y=1});bird.legs.forEach(leg=>leg.rotation.x=0);bird.head.position.set(0,1.57,.38);bird.updateNeck()}
  const initial=new Map(birds.map(bird=>[bird.id,{speed:bird.speed}]))
  const idleSteps=new Map<string,{target:THREE.Vector3;until:number;pace:number}>()
  const restoreBirds=()=>{idleSteps.clear();for(const bird of birds){const original=initial.get(bird.id);if(original){bird.speed=original.speed;groundPose(bird)}bird.timer=3+Math.random()*4;bird.velocity.set(0,0,0);bird.chooseTarget()}}
  const visit={
    owns(id:string){return initial.has(id)&&time>=enterDuration+turnDuration&&leavingAt===undefined},
    release(id:string){const bird=birds.find(bird=>bird.id===id),original=initial.get(id);if(bird&&original)bird.speed=original.speed;initial.delete(id);idleSteps.delete(id)},
    command(next:HandWave){if(leavingAt!==undefined||disposed)return;Object.assign(requested,next);requested.depth=next.depth??0;requested.arms=next.arms;requested.handCount=next.handCount;requested.conducting=next.conducting??0;requested.flourish=next.flourish??0;requested.scatter=next.scatter??.5;lastWave=time;if(next.arms&&(next.handCount===2||next.handCount===undefined)&&(next.conducting??0)>.3)vortexUntil=time+1.2;else if(!next.arms||(next.handCount??2)<2)vortexUntil=Math.min(vortexUntil,time+.25);container.dataset.wizardTracking=next.strength>.05?'moving':'waiting'},
    stop(){if(leavingAt!==undefined||disposed)return;leavingAt=time;restoreBirds();container.dataset.wizardPhase='leaving';container.dispatchEvent(new Event('wizardtrackingend'))},
    update(dt:number){
      if(disposed)return;dt=Math.min(dt,.05);time+=dt
      if(leavingAt===undefined)for(const bird of birds)if(!initial.has(bird.id))initial.set(bird.id,{speed:bird.speed})
      const enter=Math.min(1,time/enterDuration),zoom=THREE.MathUtils.smoothstep(time,0,.65)
      if(leavingAt===undefined){camera.position.lerpVectors(cameraFrom,cameraTo,zoom);viewTarget.lerpVectors(targetFrom,targetTo,zoom)}
      else{const t=THREE.MathUtils.smoothstep(time-leavingAt,Math.max(0,exitDuration-.7),exitDuration);camera.position.lerpVectors(cameraTo,cameraFrom,t);viewTarget.lerpVectors(targetTo,targetFrom,t)}
      camera.lookAt(viewTarget);camera.updateMatrixWorld(true)
      projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
      if(leavingAt===undefined&&enter<1){wizard.root.position.copy(standing).y=rise*(1-THREE.MathUtils.smoothstep(enter,0,1));hang()}
      else if(leavingAt!==undefined){
        const elapsed=time-leavingAt,lift=THREE.MathUtils.smoothstep(elapsed,1.2,exitDuration)
        wizard.root.position.copy(standing).y=rise*lift
        if(elapsed<1.05){
          wizard.root.rotation.z=0
          const reach=THREE.MathUtils.smoothstep(elapsed,.4,1.05)
          wizard.animate(time,false,travelled,{x:0,y:0,strength:reach,arms:{left:{x:-.2,y:1,strength:reach},right:{x:0,y:-1,strength:reach}}})
          wizard.root.updateMatrixWorld(true);wizard.root.getObjectByName('left-shoulder')!.getObjectByName('hand')!.getWorldPosition(grip)
          grip.y+=rise*(1-THREE.MathUtils.smoothstep(elapsed,0,1.05));ropePose(grip)
        }else hang()
        if(elapsed>=exitDuration)visit.dispose()
      }
      else{
        const turn=THREE.MathUtils.smoothstep(time-enterDuration,0,turnDuration),difference=Math.atan2(Math.sin(faceHeading-approachHeading),Math.cos(faceHeading-approachHeading))
        wizard.root.rotation.y=approachHeading+difference*turn
        wizard.root.rotation.z=0
        if(turn<1){
          container.dataset.wizardPhase='turning'
          const release=THREE.MathUtils.smoothstep(time-enterDuration,.2,turnDuration),hold=1-release
          wizard.animate(time,false,travelled,{x:0,y:0,strength:hold,arms:{left:{x:-.2,y:1,strength:hold},right:{x:0,y:-1,strength:hold}}},hold)
          wizard.root.getObjectByName('left-hip')!.rotation.x=-.15*hold
          wizard.root.getObjectByName('left-hip')!.getObjectByName('knee')!.rotation.x=.3*hold
          grip.copy(releaseGrip);grip.y+=rise*release;ropePose(grip);updateShadow();return
        }
        rope.visible=false
        if(!controlStarted){controlStarted=true;guideStartedAt=time;container.dispatchEvent(new Event('wizardcontrolstart'))}
        container.dataset.wizardPhase='tracking'
        if(time-lastWave>1.1){requested.strength=0;requested.flourish=0}
        wave.x=THREE.MathUtils.damp(wave.x,requested.x,14,dt);wave.y=THREE.MathUtils.damp(wave.y,requested.y,14,dt);wave.strength=THREE.MathUtils.damp(wave.strength,requested.strength,12,dt)
        wave.depth=THREE.MathUtils.damp(wave.depth??0,requested.depth??0,10,dt)
        wave.flourish=THREE.MathUtils.damp(wave.flourish??0,requested.flourish??0,9,dt)
        wave.scatter=THREE.MathUtils.damp(wave.scatter??0,requested.scatter??0,8,dt)
        wave.handCount=requested.handCount
        if(requested.arms){
          wave.arms??={left:{x:0,y:-1,strength:0},right:{x:0,y:-1,strength:0}}
          for(const side of ['left','right'] as const){
            const arm=wave.arms[side],target=requested.arms[side]
            arm.x=THREE.MathUtils.damp(arm.x,target.x,14,dt);arm.y=THREE.MathUtils.damp(arm.y,target.y,14,dt)
            arm.strength=THREE.MathUtils.damp(arm.strength,Math.min(wave.strength,target.strength),14,dt)
          }
        }else wave.arms=undefined
        wizard.animate(time,false,travelled,wave)
        const airborne=wave.strength>.2&&wave.y>.15
        flightHeight=THREE.MathUtils.damp(flightHeight,airborne?2+wave.y*8:0,airborne?4:3,dt)
        if(flightHeight<.035)flightHeight=0
        const active=activeFrame,bodies=bodyFrame;active.length=0;bodies.length=0
        const formationWidth=camera.aspect<1?Math.max(.35,camera.aspect*.8):1
        for(const bird of birds)if(bird.root.visible&&initial.has(bird.id)){
          const index=active.length,physics=bird.physics,body=bodyPool[index]??={position:physics.position,velocity:physics.velocity,radius:physics.radius}
          body.position=physics.position;body.velocity=physics.velocity;body.radius=Math.max(.9,physics.radius*Math.sqrt(formationWidth))
          active.push(bird);bodies.push(body)
        }
        active.forEach((bird,i)=>{(beforeControl[i]??=new THREE.Vector3()).copy(bird.root.position)})
        camera.getWorldDirection(viewForward)
        const viewDepth=camera.position.distanceTo(viewTarget)
        const halfWidth=viewDepth*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))*camera.aspect
        groupGoal.copy(standing).addScaledVector(right,wave.x*halfWidth*.6).addScaledVector(forward,(wave.y-(wave.depth??0)*1.8)*Math.min(6,viewDepth*.18)).setY(flightHeight+1)
        clipToward(groupGoal,standingSafe.copy(standing).setY(groupGoal.y),.7,-.65,.68)
        flockCenter.set(0,0,0);for(const bird of active)flockCenter.add(bird.root.position)
        if(active.length)flockCenter.divideScalar(active.length).setY(0);else flockCenter.copy(center)
        const vortex=time<vortexUntil
        const flourish=!vortex&&(wave.flourish??0)>.2&&wave.strength>.2
        patternActive=vortex||flourish
        if(vortex&&!vortexActive)vortexAngle=0
        vortexActive=vortex;vortexAngle+=dt*(2.1+(requested.conducting??0)*1.8)
        if(patternActive)flightHeight=3.5
        for(const [index,bird]of active.entries()){
          if(patternActive){
            const layer=index/Math.max(1,active.length-1),angle=vortexAngle*(1+layer*.25)+layer*Math.PI*3.5+(index%2)*Math.PI
            const scatter=wave.scatter??0,spread=(.57+layer*.36)*(.85+scatter*.25)
            const patternX=vortex?Math.cos(angle)*spread+Math.sin(time*3+index)*.045:Math.sin(layer*Math.PI*2+time*1.7)*(.34+scatter*.24)+Math.sin(time*3.5+layer*14)*(.07+scatter*.07)
            const patternY=vortex?-.68+layer*1.37+Math.sin(angle*1.3+index)*.07:-.12+Math.sin(layer*Math.PI*3-time*2.1)*(.24+scatter*.16)+(layer-.5)*.3
            const screenX=THREE.MathUtils.clamp(patternX*(1-.35*Math.abs(wave.x))+wave.x*.42,-.8,.8)
            const screenY=THREE.MathUtils.clamp(patternY*(1-.18*Math.abs(wave.y))+wave.y*.28,-.72,.7)
            const ray=patternRay.set(screenX,screenY,.5).unproject(camera).sub(camera.position).normalize()
            const depth=viewDepth*Math.max(.25,.42+layer*.52+Math.sin(angle)*.07-(wave.depth??0)*.1)
            const destination=birdGoal.copy(camera.position).addScaledVector(ray,depth/Math.max(.1,ray.dot(viewForward)))
            destination.y=Math.max(1.5,destination.y)
            const velocity=stepVelocity.copy(destination).sub(bird.root.position);bird.root.position.lerp(destination,1-Math.exp(-dt*7))
            bird.root.rotation.y=Math.atan2(velocity.x,velocity.z);bird.root.rotation.z=vortex?-.3:Math.sin(time*3+index*.4)*.25;bird.velocity.set(0,0,0);bird.flightDuration=0;bird.settle=0;bird.timer=1000
            bird.torso.rotation.x=-.18;bird.head.position.set(0,1.57,.6);bird.wings.forEach((wing,i)=>{wing.rotation.z=(i?-1:1)*(1.2+Math.sin(time*29+index*.5)*.75);wing.scale.y=2.2});bird.legs.forEach(leg=>leg.rotation.x=-.9);bird.updateNeck()
            continue
          }
          const angle=index*2.399963+Math.sin(time*.45+index)*.14,radius=Math.sqrt(index+.5)*(flightHeight>.1?1.35:1.8)
          const destination=birdGoal.copy(groupGoal).addScaledVector(right,Math.cos(angle)*radius*formationWidth*(1-.3*Math.abs(wave.x))).addScaledVector(forward,Math.sin(angle)*radius*(flightHeight>.1?.75:1.15)).setY(bird.root.position.y+1)
          const strength=wave.strength>.06?wave.strength:0
          let idlePace=0
          if(!strength){
            let step=idleSteps.get(bird.id)
            if(!step||time>=step.until){
              const heading=Math.random()*Math.PI*2,distance=1+Math.random()*2
              const target=bird.root.position.clone().add(new THREE.Vector3(Math.cos(heading)*distance,0,Math.sin(heading)*distance))
              if(target.clone().sub(standing).setY(0).length()>13)target.lerp(standing,.15)
              step={target,until:time+2+Math.random()*3.5,pace:Math.random()<.25?0:.3+Math.random()*.35}
              idleSteps.set(bird.id,step)
            }
            destination.copy(step.target).y=bird.root.position.y+1;idlePace=step.pace
          }else idleSteps.delete(bird.id)
          // Each bird curves toward its own inner destination before reaching
          // the viewport edge; the safety boundary no longer acts as a wall.
          const limit=(camera.aspect<1?.68:.74)+.04*Math.sin(index*1.73),p=screen.copy(destination).project(camera)
          if(Math.abs(p.x)>limit||p.y<-.68||p.y>.66){
            const safe=innerSafe.copy(groupGoal).setY(destination.y)
            clipToward(safe,standingSafe.copy(standing).setY(destination.y),limit,-.68,.66)
            clipToward(destination,safe,limit,-.68,.66)
          }
          destination.y=bird.root.position.y
          bird.flightDuration=0;bird.settle=0;bird.speed=(strength?strength*(flightHeight>.1?7:5):idlePace)*Math.min(1,bird.root.position.distanceTo(destination)/(strength?2:.7));bird.timer=1000
          bird.target.copy(destination)
          bird.update(dt,time,bodies[index],bodies)
          bird.root.position.y=THREE.MathUtils.damp(bird.root.position.y,flightHeight,6,dt)
          bird.root.rotation.z=THREE.MathUtils.damp(bird.root.rotation.z,0,8,dt)
          if(flightHeight>.1){
            bird.torso.rotation.x=-.12;bird.head.position.set(0,1.57,.6)
            bird.wings.forEach((wing,i)=>{wing.rotation.z=(i?-1:1)*(1.1+Math.sin(time*25)*.7);wing.scale.y=2.2})
            bird.legs.forEach(leg=>leg.rotation.x=-.9);bird.updateNeck()
          }
        }
        if(!patternActive&&flightHeight<.1)resolveContacts(bodies,3)
        if(patternActive||flightHeight>=.1)for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
          const delta=pairDelta.copy(active[j].root.position).sub(active[i].root.position)
          if(!patternActive)delta.y=0
          const distance=delta.length()
          if(distance<2&&distance>.001){delta.multiplyScalar((2-distance)*.5/distance);active[i].root.position.sub(delta);active[j].root.position.add(delta)}
        }
        if(patternActive)for(const bird of active)bird.root.position.y=Math.max(1.5,bird.root.position.y)
        for(const [index,bird]of active.entries()){
          keepInFrame(bird)
          const previous=beforeControl[index],movement=movementDelta.copy(bird.root.position).sub(previous)
          const limit=(patternActive?40:14)*dt
          previousAnchor.copy(previous).y+=1
          if(movement.length()>limit&&inside(previousAnchor)){
            bird.root.position.copy(previous).add(movement.clampLength(0,limit))
          }
          bird.velocity.clampLength(0,14)
        }
        container.dataset.wizardFlockCenter=flockCenter.toArray().join(',')
        container.dataset.wizardFlockMode=vortex?'vortex':flourish?'ribbon':flightHeight>.1?'flying':'walking'
        if(time>=enterDuration+turnDuration+controlDuration)visit.stop()
      }
      if(!disposed){
        updateShadow()
        const guideAge=time-guideStartedAt
        guide.style.opacity=String(1-THREE.MathUtils.smoothstep(guideAge,20,22))
        guide.hidden=!controlStarted||leavingAt!==undefined||guideAge>=22
        if(!guide.hidden){const anchor=wizard.root.position.clone().add(new THREE.Vector3(0,wizardHeight+.55,0)).project(camera);guide.hidden=anchor.z< -1||anchor.z>1||Math.abs(anchor.x)>.95||Math.abs(anchor.y)>.95;guide.style.left=(anchor.x+1)*.5*(container.clientWidth||window.innerWidth)+'px';guide.style.top=(1-anchor.y)*.5*(container.clientHeight||window.innerHeight)+'px'}
      }
    },
    dispose(){if(disposed)return;disposed=true;restoreBirds();guide.remove();rope.removeFromParent();ropeGeometry.dispose();ropeMaterial.dispose();footShadow.removeFromParent();shadowGeometry.dispose();shadowMaterial.dispose();wizard.dispose();camera.position.copy(cameraFrom);viewTarget.copy(targetFrom);camera.lookAt(viewTarget);container.dataset.wizardPhase='idle';delete container.dataset.wizardTracking;delete container.dataset.wizardFlockCenter;delete container.dataset.wizardFlockMode;container.dispatchEvent(new Event('wizardtrackingend'));finished()}
  }
  container.dataset.wizardPhase='entering';return visit
}
