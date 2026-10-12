import * as THREE from 'three'
import type { Pigeon } from './world'
import { createCompactCar } from './compact-car'
import { resolveContacts } from './flock-physics'
import { beginVisitorReturn, scheduleVisitorReturns, updateVisitorReturn } from './visitor-return'
import type { VisitorReturn } from './visitor-return'

const ENTRY_SPEED = 59.85
const RUN_SPEED = 55.65

export function createCarVisit(scene: THREE.Scene, camera: THREE.PerspectiveCamera, container: HTMLElement, birds: Pigeon[], finished: () => void, viewTarget = new THREE.Vector3(0, 1, 0)) {
  const car = createCompactCar(); scene.add(car.root)
  const participants = new Set(birds.map(bird=>bird.id))
  const allowedRemaining = Math.min(3, Math.max(0, participants.size - 1))
  const visibleBirds = birds.filter(bird => bird.root.visible)
  const xs = visibleBirds.map(bird => bird.root.position.x).sort((a,b) => a-b), zs = visibleBirds.map(bird => bird.root.position.z).sort((a,b) => a-b)
  const median = new THREE.Vector3(xs[Math.floor(xs.length/2)] ?? viewTarget.x, 0, zs[Math.floor(zs.length/2)] ?? viewTarget.z)
  const core = [...visibleBirds].sort((a,b) => a.root.position.distanceToSquared(median)-b.root.position.distanceToSquared(median)).slice(0, visibleBirds.length < 5 ? visibleBirds.length : Math.ceil(visibleBirds.length*.8))
  const center = core.length ? core.reduce((sum, bird) => sum.add(bird.root.position), new THREE.Vector3()).divideScalar(core.length).setY(0) : median
  const forward = center.clone().sub(camera.position).setY(0).normalize()
  if (forward.lengthSq() < .1) forward.set(0, 0, -1)
  const right = new THREE.Vector3(-forward.z, 0, forward.x)
  const at = (x: number, z: number) => center.clone().addScaledVector(right, x).addScaledVector(forward, z)
  // Begin on the far side of the flock, leaving the impact visible in front of the car.
  const driveAt = (x: number, z: number) => at(x, -z)
  // At most one lap before approaching stragglers; leave immediately once clear.
  const span = 26, radius = 14, k = .55228475 * radius, lane = 2.4
  const track = new THREE.CurvePath<THREE.Vector3>()
  // Cross the flock, travel well away to a broad turnaround, then approach again.
  track.add(new THREE.CubicBezierCurve3(driveAt(-span,-radius),driveAt(-span*.5,-radius),driveAt(-span*.5,-lane),driveAt(0,-lane)))
  track.add(new THREE.CubicBezierCurve3(driveAt(0,-lane),driveAt(span*.5,-lane),driveAt(span*.5,-radius),driveAt(span,-radius)))
  track.add(new THREE.CubicBezierCurve3(driveAt(span,-radius),driveAt(span+k,-radius),driveAt(span+radius,-k),driveAt(span+radius,0)))
  track.add(new THREE.CubicBezierCurve3(driveAt(span+radius,0),driveAt(span+radius,k),driveAt(span+k,radius),driveAt(span,radius)))
  track.add(new THREE.CubicBezierCurve3(driveAt(span,radius),driveAt(span*.5,radius),driveAt(span*.5,lane),driveAt(0,lane)))
  track.add(new THREE.CubicBezierCurve3(driveAt(0,lane),driveAt(-span*.5,lane),driveAt(-span*.5,radius),driveAt(-span,radius)))
  track.add(new THREE.CubicBezierCurve3(driveAt(-span,radius),driveAt(-span-k,radius),driveAt(-span-radius,k),driveAt(-span-radius,0)))
  track.add(new THREE.CubicBezierCurve3(driveAt(-span-radius,0),driveAt(-span-radius,-k),driveAt(-span-k,-radius),driveAt(-span,-radius)))
  const exit = new THREE.CurvePath<THREE.Vector3>()
  const buildExit = () => {
    let start=car.root.position.clone(), facing=new THREE.Vector3(Math.sin(car.root.rotation.y),0,Math.cos(car.root.rotation.y))
    const desired=Math.atan2(forward.x,forward.z), delta=Math.atan2(Math.sin(desired-car.root.rotation.y),Math.cos(desired-car.root.rotation.y))
    const segments=Math.ceil(Math.abs(delta)/(Math.PI/2)), turnRadius=12
    if(segments) {
      const turnCenter=start.clone().addScaledVector(new THREE.Vector3(facing.z,0,-facing.x),Math.sign(delta)*turnRadius)
      for(let i=0;i<segments;i++) {
        const angle=delta/segments, end=start.clone().sub(turnCenter).applyAxisAngle(new THREE.Vector3(0,1,0),angle).add(turnCenter)
        const endFacing=facing.clone().applyAxisAngle(new THREE.Vector3(0,1,0),angle), handle=4/3*Math.tan(Math.abs(angle)/4)*turnRadius
        exit.add(new THREE.CubicBezierCurve3(start,start.clone().addScaledVector(facing,handle),end.clone().addScaledVector(endFacing,-handle),end))
        start=end;facing=endFacing
      }
    }
    exit.add(new THREE.LineCurve3(start,start.clone().addScaledVector(forward,350)))
    exit.updateArcLengths()
  }
  const cameraFrom = camera.position.clone(), targetFrom = viewTarget.clone()
  const targetTo = center.clone().add(new THREE.Vector3(0, 3.3, 0))
  const viewDirection = cameraFrom.clone().sub(targetFrom).normalize()
  const fitCamera = camera.clone(), cameraTo = new THREE.Vector3()
  car.root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(car.root), corners: THREE.Vector3[] = []
  for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) corners.push(new THREE.Vector3(x,y,z))
  const axis = new THREE.Vector3(0,1,0)
  let fitDistance = Math.max(24, cameraFrom.distanceTo(targetFrom))
  for (let attempt=0;attempt<40;attempt++) {
    cameraTo.copy(targetTo).addScaledVector(viewDirection,fitDistance)
    fitCamera.position.copy(cameraTo);fitCamera.lookAt(targetTo);fitCamera.updateMatrixWorld(true)
    let fits = true
    // Include the flock at ground level, rather than fitting only the tall car.
    for (const bird of core) {
      for (const x of [-1.2,1.2]) for (const y of [0,3]) for (const z of [-1.2,1.2]) {
        const projected = bird.root.position.clone().setY(0).add(new THREE.Vector3(x,y,z)).project(fitCamera)
        if (Math.abs(projected.x)>.85 || Math.abs(projected.y)>.85 || projected.z< -1 || projected.z>1) fits=false
      }
    }
    // Fit the car near the flock and keep this view fixed for the whole drive.
    for (let i=0;i<48&&fits;i++) {
      const yaw=i/48*Math.PI*2, p=center
      const poseBounds=new THREE.Box3().setFromPoints(corners.map(corner=>corner.clone().applyAxisAngle(axis,yaw).add(p)))
      for (const x of [poseBounds.min.x,poseBounds.max.x]) for (const y of [poseBounds.min.y,poseBounds.max.y]) for (const z of [poseBounds.min.z,poseBounds.max.z]) {
        const projected=new THREE.Vector3(x,y,z).project(fitCamera)
        if(Math.abs(projected.x)>.85||Math.abs(projected.y)>.85||projected.z< -1||projected.z>1){fits=false;break}
      }
    }
    if (fits) break
    fitDistance*=1.12
  }
  // An entry line begins outside the fitted view and joins the track without a turn.
  const entry = new THREE.LineCurve3(driveAt(-fitDistance*2,-radius),driveAt(-span,-radius))
  const entryLength=entry.getLength(), trackLength=track.getLength()
  let exitLength=exit.getLength(), chase: THREE.CurvePath<THREE.Vector3> | undefined, chaseTravel=0, exitReady=false
  car.root.position.copy(entry.v1);car.root.rotation.y=Math.atan2(right.x,right.z)
  let time=0, travelled=0, entryTravel=0, trackTravel=0, exitTravel=0, laps=0, departed=false, disposed=false, rearSeen=false, departedAt: number | undefined
  interface Impact extends VisitorReturn { velocity: THREE.Vector3; farLaunch: boolean; drag: number; spin: THREE.Vector3; orientation: THREE.Quaternion; phase: number; stunnedUntil: number; at: number; speed: number; flightDuration: number; stage: 'launched' | 'stunned' | 'waiting' | 'returning'; done: boolean }
  let returnsStarted = false
  const exitSpeed = () => THREE.MathUtils.lerp(RUN_SPEED,RUN_SPEED*.8,THREE.MathUtils.smoothstep(exitTravel,0,24))
  const carProjection = (position: THREE.Vector3) => corners.map(corner => corner.clone().applyAxisAngle(axis, car.root.rotation.y).add(position).project(camera))
  const carScreenWidth = (position: THREE.Vector3) => {
    const projected=carProjection(position)
    return Math.max(...projected.map(p=>p.x))-Math.min(...projected.map(p=>p.x))
  }
  const carVisibleAt = (position: THREE.Vector3) => {
    const projected = carProjection(position)
    return carScreenWidth(position)>.065 && projected.some(p => p.z > -1 && p.z < 1) && Math.min(...projected.map(p=>p.x)) < 1 && Math.max(...projected.map(p=>p.x)) > -1 && Math.min(...projected.map(p=>p.y)) < 1 && Math.max(...projected.map(p=>p.y)) > -1
  }
  const impacts = new Map<string, Impact>()
  const hitCounts = new Map<string, number>()
  const resetPose = (bird: Pigeon) => {
    bird.root.visible = true; bird.root.position.y = 0; bird.root.rotation.x = 0; bird.root.rotation.z = 0
    bird.torso.rotation.x = 0; bird.velocity.set(0, 0, 0); bird.flightDuration = 0; bird.settle = 0; bird.timer = 3 + Math.random() * 4
    bird.wings.forEach(wing => { wing.rotation.z = 0; wing.scale.y = 1 }); bird.legs.forEach(leg => { leg.rotation.x = 0 }); bird.head.position.z = .38; bird.updateNeck()
  }
  const restore = (impact: Impact) => { resetPose(impact.bird); impact.bird.speed = impact.speed; impact.done = true }
  const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const inFrame = (position: THREE.Vector3, margin: number) => {
    const projected = position.clone().add(new THREE.Vector3(0,.8,0)).project(camera)
    return projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < margin && Math.abs(projected.y) < margin
  }
  const offscreen = () => {
    ray.setFromCamera(new THREE.Vector2(Math.random()<.5?-1.25:1.25,-.65+Math.random()*.4),camera)
    return ray.ray.intersectPlane(ground,new THREE.Vector3()) ?? center.clone().addScaledVector(right,Math.random()<.5?-30:30)
  }
  container.dataset.carPhase = 'entering'
  container.dataset.carLaps = '0'
  const visit = {
    owns(id: string) { return !!impacts.get(id) && !impacts.get(id)!.done },
    release(id: string) { const impact = impacts.get(id); if (impact) restore(impact) },
    update(dt: number) {
      if (disposed) return
      time += dt
      if (departedAt===undefined) {
        const viewBlend=THREE.MathUtils.smoothstep(time,0,Math.min(.8,entryLength/ENTRY_SPEED))
        camera.position.lerpVectors(cameraFrom,cameraTo,viewBlend);viewTarget.lerpVectors(targetFrom,targetTo,viewBlend)
      } else {
        const blend=THREE.MathUtils.smoothstep(time-departedAt,0,.7)
        camera.position.lerpVectors(cameraTo,cameraFrom,blend);viewTarget.lerpVectors(targetTo,targetFrom,blend)
      }
      camera.lookAt(viewTarget);camera.updateMatrixWorld(true)
      for (const bird of birds) if (!visit.owns(bird.id)) bird.timer = Math.max(bird.timer, 1)
      if (!departed) {
        const steps = Math.max(1, Math.ceil(dt / .01))
        for (let sub = 0; sub < steps && !departed; sub++) {
          const step=dt/steps
          const remaining=birds.filter(bird=>{
            if(!participants.has(bird.id))return false
            const impact=impacts.get(bird.id)
            return impact?.stage!=='waiting' && !(impact?.stage==='launched'&&impact.farLaunch&&time-impact.at>.2)
          })
          let curve: THREE.Curve<THREE.Vector3>, progress: number, movement: number
          if (entryTravel<entryLength) {
            movement=Math.min(entryLength-entryTravel,ENTRY_SPEED*step);entryTravel+=movement;curve=entry;progress=entryTravel/entryLength
          } else if (!exitReady && trackTravel<trackLength && remaining.length>allowedRemaining) {
            movement=Math.min(trackLength-trackTravel,RUN_SPEED*step);trackTravel+=movement;curve=track;progress=trackTravel/trackLength
            container.dataset.carPhase='circling'
            const complete=Math.min(1,Math.floor((trackTravel+.0001)/trackLength))
            if(complete>laps){laps=complete;container.dataset.carLaps=String(laps);container.dispatchEvent(new CustomEvent('carlap',{detail:{lap:laps,time}}))}
          } else {
            if(!exitReady && remaining.length>allowedRemaining) {
              if(!chase||chaseTravel>=chase.getLength()) {
                const candidates=remaining.filter(bird=>!visit.owns(bird.id))
                const bird=(candidates.length?candidates:remaining).sort((a,b)=>a.root.position.distanceToSquared(car.root.position)-b.root.position.distanceToSquared(car.root.position))[0]
                const start=car.root.position.clone(), facing=new THREE.Vector3(Math.sin(car.root.rotation.y),0,Math.cos(car.root.rotation.y))
                const destination=bird.root.position.clone().setY(0), direction=destination.clone().sub(start).normalize()
                if(direction.lengthSq()<.01)direction.copy(facing)
                chase=new THREE.CurvePath<THREE.Vector3>()
                let approach=start, approachDirection=facing
                if(facing.dot(direction)<.2) {
                  const side=new THREE.Vector3(facing.z,0,-facing.x), turn=side.dot(direction)<0?-1:1
                  approach=start.clone().addScaledVector(side,turn*24);approachDirection=facing.clone().negate()
                  chase.add(new THREE.CubicBezierCurve3(start,start.clone().addScaledVector(facing,24),approach.clone().addScaledVector(facing,24),approach))
                }
                const arrival=destination.clone().sub(approach).normalize()
                if(arrival.lengthSq()<.01)arrival.copy(approachDirection)
                chase.add(new THREE.CubicBezierCurve3(approach,approach.clone().addScaledVector(approachDirection,14),destination.clone().addScaledVector(arrival,-10),destination.clone().addScaledVector(arrival,16)));chaseTravel=0
              }
              movement=Math.min(chase.getLength()-chaseTravel,RUN_SPEED*step);chaseTravel+=movement;curve=chase;progress=chaseTravel/chase.getLength();container.dataset.carPhase='chasing'
            } else {
            if(!exitReady) {
              buildExit();exitLength=exit.getLength();exitReady=true
              container.dispatchEvent(new CustomEvent('carexitstart',{detail:{time,allowedRemaining,visible:birds.filter(bird=>participants.has(bird.id)&&bird.root.visible).length}}))
            }
            movement=Math.min(exitLength-exitTravel,exitSpeed()*step);exitTravel+=movement;curve=exit;progress=exitTravel/exitLength;container.dataset.carPhase='leaving'
            }
          }
          const tangent=curve.getTangentAt(progress)
          car.root.position.copy(curve.getPointAt(progress))
          const desiredYaw=Math.atan2(tangent.x,tangent.z), yawDelta=Math.atan2(Math.sin(desiredYaw-car.root.rotation.y),Math.cos(desiredYaw-car.root.rotation.y))
          car.root.rotation.y+=THREE.MathUtils.clamp(yawDelta,-6*step,6*step);travelled+=movement
          const nose = new THREE.Vector3(Math.sin(car.root.rotation.y), 0, Math.cos(car.root.rotation.y)), side = new THREE.Vector3(nose.z, 0, -nose.x)
          for (const bird of birds) {
            if(!participants.has(bird.id))continue
            const previous=impacts.get(bird.id)
            if ((previous&&(!previous.done||time-previous.at<previous.flightDuration+.65)) || !bird.root.visible || bird.root.position.y > 1.4) continue
            const offset = bird.root.position.clone().sub(car.root.position)
            // Use the visible body size, rather than the flock's larger avoidance radius.
            if (Math.abs(offset.dot(side)) > 1.57 * 2.5 + .52 || Math.abs(offset.dot(nose)) > 3.19 * 2.5 + .52) continue
            const hitCount=(hitCounts.get(bird.id)??0)+1;hitCounts.set(bird.id,hitCount)
            const farLaunch=hitCount>1 || Math.random()<.9
            const scatter = Math.random()<.75 ? (side.dot(forward)>0?-1:1) : (offset.dot(side)<0?-1:1)
            const velocity = nose.clone().applyAxisAngle(axis,(Math.random()-.5)*.6).multiplyScalar(farLaunch ? 30+Math.random()*9 : 18 + Math.random() * 6).addScaledVector(side, scatter * (2 + Math.random() * (farLaunch?6:2))); velocity.y = farLaunch ? 16+Math.random()*4 : 13 + Math.random() * 3
            velocity.multiplyScalar(1.05)
            if(farLaunch) {
              const duration=velocity.y/6, displacement=(1-Math.exp(-.75*duration))/.75
              for(let attempt=0;attempt<12;attempt++) {
                const landing=bird.root.position.clone().addScaledVector(velocity,displacement).setY(0)
                if(!inFrame(landing,1.15))break
                velocity.x*=1.25;velocity.z*=1.25
              }
            }
            const spin=new THREE.Vector3((Math.random()-.5)*9,(Math.random()-.5)*7,(Math.random()-.5)*10)
            impacts.set(bird.id, { bird, start: bird.root.position.clone(), velocity, farLaunch, drag:farLaunch?.75:1.35, spin, orientation:bird.root.quaternion.clone(), phase:Math.random()*Math.PI*2, stunnedUntil:0, at: time, speed: bird.speed, flightDuration:velocity.y/6, landing: new THREE.Vector3(), returnAt: Infinity, returnStart: 0, returnDuration: 0, returnMode: 'walk', returnSpeed: 0, stage: 'launched', done: false })
            bird.velocity.set(0, 0, 0); bird.flightDuration = 0
            container.dispatchEvent(new CustomEvent('carimpact', { detail: { id: bird.id, time, hitCount, farLaunch, lateral: offset.dot(side), longitudinal: offset.dot(nose), velocity: velocity.toArray(), spin:spin.toArray() } }))
          }
          if(exitTravel>=exitLength)departed=true
        }
        car.animate(travelled)
        car.root.updateMatrixWorld(true)
        if (exitTravel > 0) {
          const back = new THREE.Vector3(0, 1.8, -2.2).applyMatrix4(car.root.matrixWorld).project(camera)
          const away = car.root.position.clone().sub(camera.position).setY(0).normalize()
          const heading = new THREE.Vector3(Math.sin(car.root.rotation.y), 0, Math.cos(car.root.rotation.y))
          if (!rearSeen && heading.dot(away) > .8 && Math.abs(back.x) < .95 && Math.abs(back.y) < .95) {
            rearSeen = true; container.dispatchEvent(new Event('carrearvisible'))
          }
          car.fade(rearSeen ? THREE.MathUtils.smoothstep(carScreenWidth(car.root.position),.065,.11) : 1)
          const visible=carVisibleAt(car.root.position)
          const plateLeft=car.root.localToWorld(new THREE.Vector3(-.465,1.35,-2.135)).project(camera)
          const plateRight=car.root.localToWorld(new THREE.Vector3(.465,1.35,-2.135)).project(camera)
          const viewportWidth=container.clientWidth || window.innerWidth
          const platePixels=Math.abs(plateRight.x-plateLeft.x)*viewportWidth*.5
          const plazaDistance=Math.hypot(car.root.position.x-center.x,car.root.position.z-center.z)
          if(rearSeen && !returnsStarted && visible && heading.dot(away)>.8 && platePixels<40 && plazaDistance>=75) {
            returnsStarted=true
            scheduleVisitorReturns([...impacts.values()].filter(impact=>!impact.done),time,0)
            container.dispatchEvent(new CustomEvent('carreturnstart',{detail:{time,carVisible:visible,platePixels,plazaDistance}}))
          }
          if(rearSeen && !visible) departed=true
        }
        if (departed) {
          car.root.visible = false; container.dataset.carPhase = 'recovering'; departedAt=time
          scheduleVisitorReturns([...impacts.values()].filter(impact=>!impact.done&&!Number.isFinite(impact.returnAt)),time,0)
          container.dispatchEvent(new CustomEvent('cardeparted',{detail:{time}}))
        }
      }
      for (const impact of impacts.values()) {
        const { bird } = impact
        if (impact.done || !birds.includes(bird)) { impact.done = true; continue }
        const age = time - impact.at
        if (impact.stage === 'launched') {
          const flightAge=Math.min(age,impact.flightDuration)
          const displacement=(1-Math.exp(-impact.drag*flightAge))/impact.drag
          bird.root.position.copy(impact.start).addScaledVector(impact.velocity, displacement)
          bird.root.position.y = Math.max(0, impact.start.y + impact.velocity.y * flightAge - 6 * flightAge * flightAge)
          const spin=impact.spin.clone().multiplyScalar(Math.exp(-age*1.4)*(1+.3*Math.sin(age*7+impact.phase)))
          if(spin.lengthSq()>.0001)impact.orientation.premultiply(new THREE.Quaternion().setFromAxisAngle(spin.clone().normalize(),spin.length()*dt)).normalize()
          const upright=new THREE.Quaternion().setFromAxisAngle(axis,Math.atan2(impact.velocity.x,impact.velocity.z))
          bird.root.quaternion.copy(impact.orientation).slerp(upright,THREE.MathUtils.smoothstep(age/impact.flightDuration,.6,1))
          bird.wings.forEach((wing, i) => { wing.rotation.z = (i ? -1 : 1) * (1.1+.4*Math.sin(age*16+impact.phase+i*.7)) }); bird.legs.forEach(leg => { leg.rotation.x = -.7*(1-age/impact.flightDuration) })
          if(age>=impact.flightDuration) {
            const visible=inFrame(bird.root.position,.98)
            container.dispatchEvent(new CustomEvent('carlanding',{detail:{id:bird.id,time,visible,position:bird.root.position.toArray(),uprightAlignment:new THREE.Vector3(0,1,0).applyQuaternion(bird.root.quaternion).y}}))
            if(visible) {
              impact.stage='stunned';impact.stunnedUntil=time+1.2+Math.random()*.9
              impact.landing.copy(bird.root.position)
              bird.wings.forEach(wing=>{wing.rotation.z=0;wing.scale.y=1});bird.legs.forEach(leg=>{leg.rotation.x=0})
            } else { bird.root.visible = false; impact.stage='waiting' }
          }
        }
        if(impact.stage==='stunned') {
          const stand=THREE.MathUtils.smoothstep(time,impact.stunnedUntil-.3,impact.stunnedUntil)
          const heading=new THREE.Quaternion().setFromAxisAngle(axis,Math.atan2(impact.velocity.x,impact.velocity.z))
          bird.root.position.copy(impact.landing);bird.root.position.y=.48*(1-stand)
          bird.root.quaternion.copy(heading).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),(impact.spin.z<0?-1:1)*Math.PI*.5*(1-stand)))
          if(time>=impact.stunnedUntil) {
            restore(impact)
            bird.target.copy(center).add(new THREE.Vector3(Math.random()*8-4,0,Math.random()*6-3));bird.timer=5
            container.dispatchEvent(new CustomEvent('carstanding',{detail:{id:bird.id,time,position:bird.root.position.toArray()}}))
          }
        }
        if (impact.stage==='waiting' && time>=impact.returnAt) {
          const occupied=birds.filter(other=>other!==bird&&other.root.visible).map(other=>{
            const returning=impacts.get(other.id)
            return {...other.physics,position:returning?.stage==='returning'&&!returning.done?returning.landing:other.root.position}
          })
          resetPose(bird)
          if(!beginVisitorReturn(impact,time,offscreen(),occupied)){bird.root.visible=false;continue}
          impact.stage='returning'
          container.dispatchEvent(new CustomEvent('pigeonreturning',{detail:{id:bird.id,mode:impact.returnMode,speed:impact.returnSpeed,time,source:'car'}}))
        }
        if(impact.stage==='returning') {
          const neighbors=birds.filter(other=>other!==bird&&other.root.visible).map(other=>other.physics)
          if(updateVisitorReturn(impact,dt,time,neighbors,inFrame))restore(impact)
        }
      }
      resolveContacts(birds.filter(bird=>bird.root.visible).map(bird=>bird.physics))
      if (departed && time-departedAt!>=.7 && [...impacts.values()].every(impact => impact.done)) visit.dispose()
    },
    dispose() {
      if (disposed) return
      disposed = true; car.dispose()
      camera.position.copy(cameraFrom);viewTarget.copy(targetFrom);camera.lookAt(viewTarget)
      for (const impact of impacts.values()) if (!impact.done && birds.includes(impact.bird)) restore(impact)
      container.dataset.carPhase = 'idle'; finished()
    },
  }
  return visit
}
