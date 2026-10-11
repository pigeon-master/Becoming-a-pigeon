import * as THREE from 'three'
import type { Pigeon } from './world'
import { findSpawn, resolveContacts } from './flock-physics'
import { createHuman } from './human'
import { createChihuahua } from './chihuahua'
import { beginVisitorReturn, scheduleVisitorReturns, updateVisitorReturn } from './visitor-return'

const random = (min: number, max: number) => min + Math.random() * (max - min)
const RETURN_DELAY = 4
const DOG_RUN_SPEED = 16.5
const DOG_EXIT_SPEED = 21

interface Escape {
  bird: Pigeon
  start: THREE.Vector3
  exit: THREE.Vector3
  alarmAt: number
  source: 'dog' | 'flock' | 'human' | null
  triggerDistance: number
  returnAt: number
  speed: number
  returnSpeed: number
  returnMode: 'walk' | 'fly'
  landing: THREE.Vector3
  returnStart: number
  returnDuration: number
  upward: boolean
  stage: 'calm' | 'alert' | 'fleeing' | 'waiting' | 'returning' | 'done'
}

export function createPoodleVisit(scene: THREE.Scene, camera: THREE.PerspectiveCamera, container: HTMLElement, birds: Pigeon[], interactive: () => void, finished: () => void, human = false, viewTarget = new THREE.Vector3(0, 1, 0)) {
  const person = human ? createHuman() : undefined
  const dog = person ?? createChihuahua(); scene.add(dog.root)
  const phaseKey = human ? 'humanPhase' : 'poodlePhase'
  const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const point = (x: number, y: number) => {
    ray.setFromCamera(new THREE.Vector2(x, y), camera)
    return ray.ray.intersectPlane(ground, new THREE.Vector3()) ?? new THREE.Vector3(0, 0, 0)
  }
  const offscreen = (margin = 1.25) => point(Math.random() < .5 ? -margin : margin, random(-.65, -.25))
  let target = point(0, human ? .08 : -.4), targetUntil = 0, dogEntered = false, deepRunDone = false
  let humanFlockCenter: THREE.Vector3 | undefined
  if(person) {
    const flock=birds.filter(bird=>bird.root.visible)
    const xs=flock.map(bird=>bird.root.position.x).sort((a,b)=>a-b), zs=flock.map(bird=>bird.root.position.z).sort((a,b)=>a-b)
    const median=new THREE.Vector3(xs[Math.floor(xs.length/2)]??viewTarget.x,0,zs[Math.floor(zs.length/2)]??viewTarget.z)
    const core=[...flock].sort((a,b)=>a.root.position.distanceToSquared(median)-b.root.position.distanceToSquared(median)).slice(0,Math.ceil(flock.length*.8))
    humanFlockCenter=core.length?core.reduce((sum,bird)=>sum.add(bird.root.position),new THREE.Vector3()).divideScalar(core.length).setY(0):median
    const away=humanFlockCenter.clone().sub(camera.position).setY(0).normalize()
    if(away.lengthSq()<.01)away.set(0,0,-1)
    const side=new THREE.Vector3(-away.z,0,away.x)
    const central=Math.random()<.65
    // Stay in or just behind the flock, facing it with the face toward the viewer.
    target=humanFlockCenter.clone().addScaledVector(away,central?random(.25,1.1):random(1.1,2.6)).addScaledVector(side,central?random(-.7,.7):random(-1.4,1.4))
  }
  const humanCameraFrom=camera.position.clone(), humanCameraTo=camera.position.clone()
  let humanZoom=false
  if(person) {
    const bounds=new THREE.Box3()
    for(const pose of [0,1]) {
      person.animate(0,pose,false);person.root.updateMatrixWorld(true)
      bounds.union(new THREE.Box3().setFromObject(person.root))
    }
    person.animate(0,0,false)
    const points: THREE.Vector3[]=[]
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])points.push(new THREE.Vector3(x,y,z).add(target))
    const view=camera.clone(), direction=humanCameraFrom.clone().sub(viewTarget).normalize()
    const fits=(distance: number)=>{
      view.position.copy(viewTarget).addScaledVector(direction,distance);view.lookAt(viewTarget);view.updateMatrixWorld(true)
      return points.every(point=>{const p=point.clone().project(view);return p.z>-1&&p.z<1&&Math.abs(p.x)<.93&&Math.abs(p.y)<.93})
    }
    const original=humanCameraFrom.distanceTo(viewTarget)
    if(!fits(original)) {
      let low=original,high=original
      for(let i=0;i<60&&!fits(high);i++)high*=1.15
      for(let i=0;i<24;i++){const middle=(low+high)/2;if(fits(middle))high=middle;else low=middle}
      humanCameraTo.copy(viewTarget).addScaledVector(direction,high);humanZoom=true
    }
    // Spawn against the fitted view, while retaining the original standing location.
    const originalPosition=camera.position.clone()
    camera.position.copy(humanCameraTo);camera.lookAt(viewTarget);camera.updateMatrixWorld(true)
    dog.root.position.copy(offscreen(1.6))
    camera.position.copy(originalPosition);camera.lookAt(viewTarget);camera.updateMatrixWorld(true)
  } else dog.root.position.copy(offscreen(1.6))
  let humanTravelled = 0
  let poseStarted: number | undefined, poseHeading = 0, gestured = false
  const yielded = new Map<string, number>()
  const entries = new Map<string, Escape>()
  const firstUpward = Math.random() < .5
  let elapsed = 0, departedAt: number | undefined, exitStarted: number | undefined, disposed = false, unlocked = false
  let dogExitStage: 'center' | 'front' = 'center', dogFrontAt: number | undefined
  const distance = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
  const inFrame = (position: THREE.Vector3, margin = 1) => {
    const projected = position.clone().add(new THREE.Vector3(0, .8, 0)).project(camera)
    return projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < margin && Math.abs(projected.y) < margin
  }
  const enroll = (bird: Pigeon) => {
    entries.set(bird.id, { bird, start: bird.root.position.clone(), exit: new THREE.Vector3(), alarmAt: Infinity, source: null, triggerDistance: 0, returnAt: Infinity, speed: bird.speed, returnSpeed: 0, returnMode: 'walk', landing: new THREE.Vector3(), returnStart: 0, returnDuration: 0, upward: Math.random() < .45, stage: departedAt === undefined && exitStarted === undefined ? 'calm' : 'done' })
  }
  birds.forEach(enroll)
  // Even a small flock shows both escape directions; larger flocks stay random.
  const initialEntries = [...entries.values()]
  if (initialEntries[0]) initialEntries[0].upward = firstUpward
  if (initialEntries[1]) initialEntries[1].upward = !firstUpward
  const alarm = (entry: Escape, source: 'dog' | 'flock' | 'human', separation: number) => {
    entry.stage = 'alert'; entry.source = source; entry.triggerDistance = separation
    entry.alarmAt = elapsed + (source === 'dog' ? random(.03, .1) : random(.1, .25))
  }
  const poseFlight = (bird: Pigeon) => {
    bird.torso.rotation.x = -.12; bird.head.position.z = .6
    bird.wings.forEach((wing, i) => { wing.rotation.z = (i ? -1 : 1) * (1.1 + Math.sin(elapsed * 29) * .75); wing.scale.y = 2.2 })
    bird.legs.forEach(leg => { leg.rotation.x = -.9 }); bird.updateNeck()
  }
  const restore = (entry: Escape) => {
    const bird = entry.bird
    bird.speed = entry.speed; bird.timer = random(3, 8); bird.flightDuration = 0; bird.settle = 0
    bird.root.visible = true; bird.root.position.y = 0; bird.torso.rotation.x = 0
    bird.wings.forEach(wing => { wing.rotation.z = 0; wing.scale.y = 1 })
    bird.legs.forEach(leg => { leg.rotation.x = 0 }); bird.head.position.z = .38; bird.updateNeck()
    entry.stage = 'done'
  }
  const scheduleReturns = () => {
    scheduleVisitorReturns([...entries.values()].filter(e => e.stage !== 'done'), departedAt!, RETURN_DELAY)
  }
  container.dataset[phaseKey] = human ? 'entering' : 'running'
  return {
    owns(id: string) { const stage = entries.get(id)?.stage; return !!stage && stage !== 'calm' && stage !== 'done' },
    release(id: string) {
      const entry = entries.get(id)
      if (!entry) return
      if (!entry.bird.root.visible) entry.bird.root.position.copy(findSpawn(birds.filter(b => b !== entry.bird && b.root.visible).map(b => b.physics)) ?? new THREE.Vector3())
      restore(entry)
    },
    update(dt: number) {
      elapsed += dt
      if(person&&humanZoom&&!unlocked) {
        if(departedAt===undefined)camera.position.lerpVectors(humanCameraFrom,humanCameraTo,THREE.MathUtils.smoothstep(elapsed,0,.65))
        else camera.position.lerpVectors(humanCameraTo,humanCameraFrom,THREE.MathUtils.smoothstep(elapsed-departedAt,0,.65))
        camera.lookAt(viewTarget);camera.updateMatrixWorld(true)
      }
      for (const bird of birds) if (!entries.has(bird.id)) enroll(bird)
      for (const [id] of entries) if (!birds.some(bird => bird.id === id)) entries.delete(id)
      if (departedAt === undefined && person) {
        const position = person.root.position
        if (poseStarted === undefined || exitStarted !== undefined) {
          const heading = target.clone().sub(position).setY(0)
          let alignment = 1
          if (heading.lengthSq() > .01) {
            const desired = Math.atan2(heading.x, heading.z)
            if (humanTravelled === 0) person.root.rotation.y = desired
            const turn = desired - person.root.rotation.y
            person.root.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 10)
            alignment = Math.max(0, Math.cos(desired - person.root.rotation.y))
          }
          const step = Math.min(heading.length(), dt * 6.2 * alignment)
          position.addScaledVector(heading.clone().normalize(), step)
          humanTravelled += step
          person.animate(elapsed, 0, true, humanTravelled)
          if (exitStarted === undefined && distance(position, target) < .15) {
            poseStarted = elapsed
            const flock = birds.filter(bird => bird.root.visible)
            const center = flock.length ? flock.reduce((sum, bird) => sum.add(bird.root.position), new THREE.Vector3()).divideScalar(flock.length) : point(0, -.4)
            const direction = center.sub(position).setY(0)
            if (direction.lengthSq() < .01 && flock.length) direction.copy(flock[0].root.position).sub(position).setY(0)
            const towardCamera = camera.position.clone().sub(position).setY(0)
            const cameraHeading = Math.atan2(towardCamera.x, towardCamera.z)
            const flockHeading = direction.lengthSq() > .01 ? Math.atan2(direction.x, direction.z) : cameraHeading
            const flockAngle = Math.atan2(Math.sin(flockHeading - cameraHeading), Math.cos(flockHeading - cameraHeading))
            // Vary front and three-quarter views, without ever turning the face away.
            const variation = Math.random() < .5 ? random(-20, 20) : (Math.random() < .5 ? -1 : 1) * random(35, 55)
            const angle = THREE.MathUtils.clamp(THREE.MathUtils.clamp(flockAngle, -Math.PI / 3, Math.PI / 3) * .25 + THREE.MathUtils.degToRad(variation), -Math.PI / 3, Math.PI / 3)
            poseHeading = cameraHeading + angle
            container.dispatchEvent(new CustomEvent('humanstanding', { detail: { time: elapsed, heading: poseHeading, position:position.toArray(),flockDistance:humanFlockCenter?position.distanceTo(humanFlockCenter):0 } }))
          }
          if (exitStarted !== undefined && !inFrame(position, 1.5)) {
            departedAt = elapsed; person.root.visible = false; scheduleReturns()
          }
        } else {
          const poseAge = elapsed - poseStarted
          person.root.rotation.y += Math.atan2(Math.sin(poseHeading - person.root.rotation.y), Math.cos(poseHeading - person.root.rotation.y)) * Math.min(1, dt * 6)
          person.animate(elapsed, THREE.MathUtils.smoothstep(poseAge - 2, 0, .2), false)
          if (!gestured && poseAge >= 2.2) {
            gestured = true
            container.dispatchEvent(new Event('humangesture'))
            for (const entry of entries.values()) if (entry.stage === 'calm') alarm(entry, 'human', distance(entry.bird.root.position, position))
          }
          if (poseAge > 4.8 && [...entries.values()].every(entry => entry.stage === 'waiting' || entry.stage === 'done')) {
            exitStarted = elapsed; target = offscreen(1.8)
          }
        }
        for (const entry of entries.values()) if (entry.stage === 'calm') {
          // Walking past is not an alarm. Suppress spontaneous flights during the approach.
          const bird = entry.bird; bird.timer = Math.max(bird.timer, 1)
          if (gestured) { alarm(entry, 'human', distance(bird.root.position, position)); continue }
          if (distance(bird.root.position, position) < 3.5 && elapsed >= (yielded.get(bird.id) ?? 0)) {
            const away = bird.root.position.clone().sub(position).setY(0)
            if (away.lengthSq() < .01) away.set(1, 0, 0)
            bird.target.copy(bird.root.position).addScaledVector(away.normalize(), 3.5); bird.target.y = 0
            bird.timer = 4; yielded.set(bird.id, elapsed + 1.5)
            container.dispatchEvent(new CustomEvent('pigeonyielded', { detail: { id: bird.id } }))
          }
        }
      }
      if (departedAt === undefined && !person) {
        const calm = [...entries.values()].filter(entry => entry.stage === 'calm')
        if (exitStarted === undefined && elapsed > 3.8 && deepRunDone && elapsed >= targetUntil && [...entries.values()].every(entry => entry.stage === 'waiting' || entry.stage === 'done')) {
          exitStarted = elapsed; target = point(0, -.35)
        }
        if (exitStarted === undefined && elapsed >= targetUntil) {
          const nearest = calm.sort((a, b) => distance(a.bird.root.position, dog.root.position) - distance(b.bird.root.position, dog.root.position))[0]
          if (dogEntered && !deepRunDone && (elapsed > 1.3 || !nearest)) {
            // Give the deeper dash enough time to reach its target before zigzagging again.
            const center = point(random(-.35, .35), -.25)
            const inward = center.clone().sub(camera.position).setY(0).normalize()
            target = center.addScaledVector(inward, random(5, 8))
            targetUntil = elapsed + THREE.MathUtils.clamp(distance(dog.root.position, target) / DOG_RUN_SPEED + .15, .65, 1.5)
            deepRunDone = true
          } else {
            target = !dogEntered ? point(0, -.4) : nearest ? nearest.bird.root.position.clone().setY(0).add(new THREE.Vector3(random(-1.2, 1.2), 0, random(-1.2, 1.2))) : point(random(-.75, .75), random(-.65, .05))
            targetUntil = elapsed + random(.4, .75)
          }
        }
        if (exitStarted !== undefined && dogExitStage === 'center' && distance(dog.root.position, target) < .3) {
          dogExitStage = 'front'
          target = camera.position.clone().setY(0)
        }
        const heading = target.clone().sub(dog.root.position).setY(0)
        const speed = exitStarted === undefined ? DOG_RUN_SPEED : DOG_EXIT_SPEED
        dog.root.position.addScaledVector(heading.clone().normalize(), Math.min(heading.length(), speed * dt))
        if (heading.lengthSq() > .01) dog.root.rotation.y = Math.atan2(heading.x, heading.z)
        dog.animate(elapsed)
        dogEntered ||= inFrame(dog.root.position, .95)
        if (exitStarted !== undefined && dogExitStage === 'front' && dogFrontAt === undefined && inFrame(dog.root.position)) {
          dogFrontAt = elapsed
          container.dispatchEvent(new CustomEvent('chihuahuafront', { detail: { time: elapsed, heading: dog.root.rotation.y } }))
        }
        if (exitStarted !== undefined && dogExitStage === 'front' && (distance(dog.root.position, target) < .2 || (!inFrame(dog.root.position, 1.3) && elapsed - (dogFrontAt ?? exitStarted) > .2))) {
          departedAt = elapsed; dog.root.visible = false; scheduleReturns()
        }
        // Only actual takeoffs spread the alarm, never still-waiting neighbors.
        const takingOff = [...entries.values()].filter(entry => entry.stage === 'fleeing' && elapsed - entry.alarmAt < .9)
        for (const entry of calm) {
          const nearDog = distance(entry.bird.root.position, dog.root.position)
          const neighbor = takingOff.find(other => distance(entry.bird.root.position, other.start) < 5.2)
          if (neighbor) alarm(entry, 'flock', distance(entry.bird.root.position, neighbor.start))
          else if (dogEntered && nearDog < 5.94) alarm(entry, 'dog', nearDog)
        }
      }
      container.dataset[phaseKey] = departedAt === undefined ? (person ? exitStarted !== undefined ? 'leaving' : poseStarted !== undefined ? elapsed - poseStarted < 2 ? 'standing' : 'gesture' : 'entering' : 'running') : elapsed < departedAt + RETURN_DELAY ? 'waiting' : 'returning'
      for (const entry of entries.values()) {
        const { bird } = entry
        if (entry.stage === 'alert' && elapsed >= entry.alarmAt) {
          entry.start.copy(bird.root.position); entry.exit.copy(offscreen(1.6)); entry.exit.y = random(3, 5)
          if (entry.upward) {
            entry.exit.copy(entry.start).add(new THREE.Vector3(random(-3, 3), 8, random(-3, 3)))
            // Rise beyond the top edge for this camera, even when zoomed out.
            for (let i = 0; i < 100 && entry.exit.clone().project(camera).y < 1.4; i++) entry.exit.y += 1
          }
          bird.velocity.set(0, 0, 0); bird.flightDuration = 0; entry.stage = 'fleeing'
          container.dispatchEvent(new CustomEvent('pigeonstartled', { detail: { id: bird.id, source: entry.source, distance: entry.triggerDistance, time: elapsed, dogVisible: !human && dog.root.visible, humanVisible: human && dog.root.visible, upward: entry.upward } }))
        }
        if (entry.stage === 'fleeing') {
          const t = THREE.MathUtils.clamp((elapsed - entry.alarmAt) / 1.5, 0, 1)
          bird.root.position.lerpVectors(entry.start, entry.exit, t)
          bird.root.position.y += Math.sin(t * Math.PI) * 1.5
          bird.root.rotation.y = Math.atan2(entry.exit.x - entry.start.x, entry.exit.z - entry.start.z)
          poseFlight(bird)
          if (entry.upward) bird.torso.rotation.x = -.45
          if (t === 1) { bird.root.visible = false; entry.stage = 'waiting' }
        }
        if (entry.stage === 'waiting' && elapsed >= entry.returnAt) {
          const occupied = [...entries.values()].filter(e => e !== entry && (e.stage === 'returning' || e.stage === 'done')).map(e => ({ ...e.bird.physics, position: e.stage === 'returning' ? e.bird.target : e.bird.root.position }))
          if (!beginVisitorReturn(entry, elapsed, offscreen(), occupied)) continue
          entry.stage = 'returning'
          container.dispatchEvent(new CustomEvent('pigeonreturning', { detail: { id: bird.id, mode: entry.returnMode, speed: entry.returnSpeed, time: elapsed } }))
        }
        if (entry.stage === 'returning') {
          const neighbors = birds.filter(b => b.root.visible && b !== bird).map(b => b.physics)
          if (updateVisitorReturn(entry, dt, elapsed, neighbors, inFrame)) restore(entry)
        }
      }
      if (departedAt !== undefined && elapsed >= departedAt + RETURN_DELAY && !unlocked) {
        const flock = [...entries.values()]
        const returned = flock.filter(entry => entry.stage === 'done').length
        if (returned >= Math.ceil(flock.length * .75)) { unlocked = true; interactive() }
      }
      resolveContacts(birds.filter(b => b.root.visible).map(b => b.physics))
      container.dataset.poodleVisibleBirds = String(birds.filter(b => b.root.visible).length)
      if (departedAt !== undefined && elapsed > departedAt + RETURN_DELAY && [...entries.values()].every(e => e.stage === 'done')) this.dispose()
    },
    dispose() {
      if (disposed) return
      disposed = true; dog.dispose()
      if(person&&humanZoom&&!unlocked){camera.position.copy(humanCameraFrom);camera.lookAt(viewTarget)}
      for (const entry of entries.values()) {
        if (!birds.includes(entry.bird) || entry.stage === 'done') continue
        restore(entry)
      }
      container.dataset[phaseKey] = 'idle'; delete container.dataset.poodleVisibleBirds; finished()
    },
  }
}
