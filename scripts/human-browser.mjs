import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import assert from 'node:assert/strict'

const artifacts = resolve('artifacts'); await mkdir(artifacts, { recursive: true })
const temporary = await mkdtemp(resolve(artifacts, 'human-preview-'))
const source = name => JSON.stringify(resolve('src', name).replaceAll('\\', '/'))
let browser, server
try {
  await writeFile(resolve(temporary, 'index.html'), '<body style="margin:0"><script type="module" src="/fixture.ts"></script>')
  await writeFile(resolve(temporary, 'fixture.ts'), `
    import * as THREE from 'three';
    import {Pigeon} from ${source('world.ts')};
    import {createPoodleVisit} from ${source('poodle.ts')};
    import {loadHumanPhotos,createHuman} from ${source('human.ts')};
    import {createChihuahua,loadChihuahuaPhotos} from ${source('chihuahua.ts')};
    import {createCompactCar,loadCarPhotos} from ${source('compact-car.ts')};
    import {createCarVisit} from ${source('car-visit.ts')};
    const scene=new THREE.Scene();scene.background=new THREE.Color('white');
    const camera=new THREE.PerspectiveCamera(45,1000/750,.1,500);camera.position.set(0,4,14);camera.lookAt(0,1,0);camera.updateMatrixWorld();
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1000,750);renderer.shadowMap.enabled=true;document.body.append(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff,0x666666,2));
    const sun=new THREE.DirectionalLight(0xffffff,2.5);sun.position.set(-9,18,9);sun.castShadow=true;scene.add(sun);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(300,300),new THREE.MeshStandardMaterial({color:0x626466}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
    const birds=[];let visit,done=false,gesture=false,time=0,early=false,standingAt=0,gestureAt=0,heading=0,frontSeen=false,frontAlignment=0,unlockReturned=-1;const starts=[],yields=[];
    document.body.addEventListener('chihuahuafront',event=>{
      const dog=scene.getObjectByName('chihuahua-visitor');
      const forward=new THREE.Vector3(Math.sin(event.detail.heading),0,Math.cos(event.detail.heading));
      frontAlignment=forward.dot(camera.position.clone().sub(dog.position).setY(0).normalize());
      const face=dog.localToWorld(new THREE.Vector3(0,1.62,.58)).project(camera);
      frontSeen=Math.abs(face.x)<1&&Math.abs(face.y)<1&&face.z>-1&&face.z<1;
    });
    let humanStandingDistance=0
    document.body.addEventListener('humanstanding',event=>{standingAt=event.detail.time;heading=event.detail.heading;humanStandingDistance=event.detail.flockDistance});
    document.body.addEventListener('humangesture',()=>{gesture=true;gestureAt=time});
    document.body.addEventListener('pigeonyielded',event=>yields.push(event.detail));
    document.body.addEventListener('pigeonstartled',event=>{if(event.detail.source==='human'&&!gesture)early=true;starts.push(event.detail)});
    window.start=async(human=true)=>{
      if(human)await loadHumanPhotos();else await loadChihuahuaPhotos();
      visit?.dispose();for(const bird of birds)bird.dispose();birds.length=0;done=false;gesture=false;time=0;early=false;frontSeen=false;frontAlignment=0;starts.length=0;yields.length=0;
      for(let i=0;i<8;i++){
        const bird=new Pigeon(new THREE.Mesh(new THREE.SphereGeometry(.3),new THREE.MeshStandardMaterial({color:0x53685e})));
        bird.id=String(i);bird.root.position.set((i%4-1.5)*3,0,Math.floor(i/4)*3);bird.target.copy(bird.root.position);bird.settle=0;bird.timer=100;scene.add(bird.root);birds.push(bird);
      }
      unlockReturned=-1;
      visit=createPoodleVisit(scene,camera,document.body,birds,()=>{unlockReturned=birds.filter(bird=>!visit.owns(bird.id)).length},()=>done=true,human);
      if(human){const person=scene.getObjectByName('human-visitor');birds[0].root.position.copy(person.position).add(new THREE.Vector3(1,0,0));birds[0].target.copy(birds[0].root.position);}
    };
    window.step=()=>{
      time+=.025;visit.update(.025);
      for(const bird of birds)if(!visit.owns(bird.id))bird.update(.025,time,bird.physics,birds.filter(b=>b!==bird&&b.root.visible).map(b=>b.physics));
      renderer.render(scene,camera);
      return {done,gesture,early,standingAt,gestureAt,heading,frontSeen,frontAlignment,unlockReturned,starts:[...starts],yields:yields.length,visible:birds.filter(b=>b.root.visible).length,phase:document.body.dataset.humanPhase};
    };
    window.until=(phase)=>{let result;for(let i=0;i<8000;i++){result=window.step();if(phase==='pose'?result.gesture&&result.starts.length===8:result.done)break;}return result;};
    window.pose=()=>{
      const human=scene.getObjectByName('human-visitor'),box=new THREE.Box3().setFromObject(human.getObjectByName('face')),center=box.getCenter(new THREE.Vector3());
      const top=center.clone().setY(box.max.y).project(camera),bottom=center.clone().setY(box.min.y).project(camera);
      const facing=new THREE.Vector3(Math.sin(human.rotation.y),0,Math.cos(human.rotation.y)),towardCamera=camera.position.clone().sub(human.position).setY(0).normalize();
      return {knee:human.getObjectByName('left-hip').rotation.x,arms:human.getObjectByName('left-shoulder').rotation.z,heading:human.rotation.y,flockDistance:humanStandingDistance,facePixels:Math.abs(top.y-bottom.y)*375,faceAlignment:facing.dot(towardCamera),position:human.position.toArray()};
    };
    window.headPreview=(profile=false)=>{
      const person=createHuman(),preview=new THREE.Scene();preview.background=new THREE.Color(0xe8e8e8);preview.add(person.root);person.animate(0,false,0);person.root.updateMatrixWorld(true);
      preview.add(new THREE.HemisphereLight(0xffffff,0x777777,2));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(-3,9,6);preview.add(light);
      const center=new THREE.Box3().setFromObject(person.root.getObjectByName('face')).getCenter(new THREE.Vector3()),view=new THREE.PerspectiveCamera(40,1000/750,.01,100);
      view.position.copy(center).add(profile?new THREE.Vector3(1.9,.1,.1):new THREE.Vector3(1.25,.15,1.6));view.lookAt(center);renderer.render(preview,view);person.dispose();
    };
    window.humanViews=async()=>{
      const samples=[],originalRandom=Math.random;
      try{
        for(let i=0;i<8;i++){
          let seed=12345+i*7919;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
          const angle=i*Math.PI/4;camera.position.set(Math.sin(angle)*14,4,Math.cos(angle)*14);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
          await window.start(true);window.until('pose');samples.push(window.pose());
        }
      }finally{Math.random=originalRandom;visit?.dispose();camera.position.set(0,4,14);camera.lookAt(0,1,0);camera.updateMatrixWorld(true)}
      return samples;
    };
    window.dogPreview=(side=false)=>{
      const dog=createChihuahua(),preview=new THREE.Scene();preview.background=new THREE.Color('white');preview.add(dog.root);
      preview.add(new THREE.HemisphereLight(0xffffff,0x777777,2));
      const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(-5,9,8);preview.add(light);
      const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:0xaaaaaa}));floor.rotation.x=-Math.PI/2;preview.add(floor);
      dog.animate(.35);
      const view=new THREE.PerspectiveCamera(42,1000/750,.1,100);view.position.set(...(side?[8,3,.7]:[2.8,3.5,8]));view.lookAt(0,1.8,.3);renderer.render(preview,view);
      dog.dispose();floor.geometry.dispose();floor.material.dispose();
    };
    const carHits=[],carReturns=[],carLandings=[],carStands=[];let carExitVisible=-1,carRestFrames=0,carRestMotion=0,carRestUpright=0,carRear=false,carLaps=0,carFrames=0,carClipped=0,carTurn=0,lastCarYaw,carDepartedAt=0,carWalkFrames=0,carFlyFrames=0,carMaxTravel=0,carViewDistance=0,rearPlatePixels=0,carCameraStart,carCameraMotion=0;
    document.body.addEventListener('carimpact',event=>carHits.push(event.detail));
    document.body.addEventListener('carlanding',event=>carLandings.push(event.detail));
    document.body.addEventListener('carstanding',event=>carStands.push(event.detail));
    document.body.addEventListener('carexitstart',event=>carExitVisible=event.detail.visible);
    let returnTrigger
    let previousExitPosition,exitMinSpeed=Infinity
    window.exitMinSpeed=()=>exitMinSpeed
    window.returnTrigger=()=>returnTrigger
    document.body.addEventListener('carreturnstart',event=>returnTrigger=event.detail);
    document.body.addEventListener('carrearvisible',()=>carRear=true);
    document.body.addEventListener('carlap',event=>carLaps=event.detail.lap);
    document.body.addEventListener('cardeparted',event=>carDepartedAt=event.detail.time);
    document.body.addEventListener('pigeonreturning',event=>{if(event.detail.source==='car')carReturns.push(event.detail)});
    window.startCar=async(deterministic=false)=>{
      returnTrigger=undefined
      previousExitPosition=undefined;exitMinSpeed=Infinity
      await loadCarPhotos();visit?.dispose();birds.forEach(bird=>bird.dispose());birds.length=0;carHits.length=0;carReturns.length=0;carRear=false;carLaps=0;carFrames=0;carClipped=0;carTurn=0;lastCarYaw=undefined;carDepartedAt=0;carWalkFrames=0;carFlyFrames=0;carMaxTravel=0;carViewDistance=0;rearPlatePixels=0;carCameraStart=undefined;carCameraMotion=0;done=false;time=0;
      [[-3,1],[3,1],[0,-2]].forEach(([x,z],index)=>{
        const bird=new Pigeon(new THREE.Mesh(new THREE.SphereGeometry(.3),new THREE.MeshStandardMaterial({color:0x53685e})));
        bird.id=String(index);bird.root.position.set(x,0,z);bird.target.copy(bird.root.position);bird.settle=0;bird.timer=100;bird.speed=1;birds.push(bird);scene.add(bird.root);
      });
      carLandings.length=0;carStands.length=0;carExitVisible=-1;carRestFrames=0;carRestMotion=0;carRestUpright=0;const originalRandom=Math.random;
      visit=createCarVisit(scene,camera,document.body,birds,()=>{done=true;Math.random=originalRandom});
      const untouched=new Pigeon(new THREE.Mesh(new THREE.SphereGeometry(.3),new THREE.MeshStandardMaterial({color:0x53685e})));
      untouched.id='3';untouched.root.position.set(0,0,70);untouched.target.copy(untouched.root.position);untouched.settle=0;untouched.timer=100;untouched.speed=0;birds.push(untouched);scene.add(untouched.root);
      let randomCalls=0;if(deterministic)Math.random=()=>deterministic==='far'?.25:randomCalls++===0?.95:.5;
    };
    window.carView=(portrait=false)=>{
      camera.aspect=portrait?9/16:1000/750;camera.position.set(...(portrait?[0,4,14]:[14,6,8]));camera.lookAt(0,1,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    };
    window.carUntil=(phase)=>{
      let result;for(let i=0;i<2000;i++){
        result=window.step();
        const car=scene.getObjectByName('compact-car-visitor');
        if(car&&document.body.dataset.carPhase==='leaving'){
          if(previousExitPosition)exitMinSpeed=Math.min(exitMinSpeed,car.position.distanceTo(previousExitPosition)/.025)
          previousExitPosition=car.position.clone()
        }
        if(car&&document.body.dataset.carPhase==='circling'){
          carFrames++;carCameraStart??=camera.position.clone();carCameraMotion=Math.max(carCameraMotion,camera.position.distanceTo(carCameraStart));
          carViewDistance=Math.max(carViewDistance,camera.position.distanceTo(car.position));
          carMaxTravel=Math.max(carMaxTravel,Math.hypot(car.position.x,car.position.z));
          const box=new THREE.Box3().setFromObject(car);let clipped=false;
          for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
            const p=new THREE.Vector3(x,y,z).project(camera);if(Math.abs(p.x)>1||Math.abs(p.y)>1||p.z< -1||p.z>1)clipped=true;
          }if(clipped)carClipped++;
        }
        if(car&&document.body.dataset.carPhase!=='entering'){
          if(lastCarYaw!==undefined)carTurn=Math.max(carTurn,Math.abs(Math.atan2(Math.sin(car.rotation.y-lastCarYaw),Math.cos(car.rotation.y-lastCarYaw))));lastCarYaw=car.rotation.y;
        }
        if(car&&carRear&&document.body.dataset.carPhase==='leaving'){
          if(carCameraStart)carCameraMotion=Math.max(carCameraMotion,camera.position.distanceTo(carCameraStart));
          const plate=car.getObjectByName('rear-plate-99구9999'),left=plate.localToWorld(new THREE.Vector3(-.465,0,0)).project(camera),right=plate.localToWorld(new THREE.Vector3(.465,0,0)).project(camera);
          rearPlatePixels=Math.max(rearPlatePixels,Math.abs(right.x-left.x)*500);
        }
        for(const arrival of carReturns){
          const bird=birds.find(bird=>bird.id===arrival.id);if(!bird?.root.visible)continue;
          if(arrival.mode==='walk'&&bird.speed>=2&&bird.velocity.lengthSq()>.005&&bird.legs.some(leg=>Math.abs(leg.rotation.x)>.05))carWalkFrames++;
          if(arrival.mode==='fly'&&bird.root.position.y>.2&&bird.wings.some(wing=>wing.scale.y>2))carFlyFrames++;
        }
        for(const landing of carLandings.filter(landing=>landing.visible&&time-landing.time>.1&&time-landing.time<1.1)){
          const bird=birds.find(bird=>bird.id===landing.id);if(!bird)continue;
          carRestFrames++;carRestMotion=Math.max(carRestMotion,Math.hypot(bird.root.position.x-landing.position[0],bird.root.position.z-landing.position[2]));
          carRestUpright=Math.max(carRestUpright,Math.abs(new THREE.Vector3(0,1,0).applyQuaternion(bird.root.quaternion).y));
        }
        if(phase==='rear'?carRear:result.done)break;
      }return {...result,hits:[...carHits],rear:carRear,laps:carLaps,frames:carFrames,clipped:carClipped,turn:carTurn,cameraPosition:camera.position.toArray(),returns:[...carReturns],landings:[...carLandings],stands:[...carStands],exitVisible:carExitVisible,restFrames:carRestFrames,restMotion:carRestMotion,restUpright:carRestUpright,departedAt:carDepartedAt,walkFrames:carWalkFrames,flyFrames:carFlyFrames,maxTravel:carMaxTravel,viewDistance:carViewDistance,platePixels:rearPlatePixels,cameraMotion:carCameraMotion};
    };
    window.humanFraming=async(close)=>{
      visit?.dispose();camera.aspect=1000/750;camera.updateProjectionMatrix();
      const direction=new THREE.Vector3(0,3,14).normalize(),distance=close?4:28;
      camera.position.copy(new THREE.Vector3(0,1,0)).addScaledVector(direction,distance);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
      const before=camera.getWorldDirection(new THREE.Vector3());
      await window.start(true);window.until('pose');
      const box=new THREE.Box3().setFromObject(scene.getObjectByName('human-visitor'));let clipped=false;
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
        const p=new THREE.Vector3(x,y,z).project(camera);if(Math.abs(p.x)>.98||Math.abs(p.y)>.98||p.z< -1||p.z>1)clipped=true;
      }
      return {clipped,distance:camera.position.distanceTo(new THREE.Vector3(0,1,0)),angle:before.dot(camera.getWorldDirection(new THREE.Vector3()))};
    };
    window.carFlockFraming=async()=>{
      await loadCarPhotos();visit?.dispose();birds.forEach(bird=>bird.dispose());birds.length=0;
      const results=[];
      for(const aspect of [1000/750,390/844])for(const polar of [.3,1.5]){
        const testBirds=[];
        for(let i=0;i<10;i++){
          const bird=new Pigeon(new THREE.Mesh(new THREE.SphereGeometry(.3),new THREE.MeshStandardMaterial({color:0x53685e})));
          bird.id='frame-'+i;bird.root.position.set(i===9?200:(i%3-1)*4,0,i===9?200:(Math.floor(i/3)-1)*3);scene.add(bird.root);testBirds.push(bird);
        }
        camera.aspect=aspect;camera.updateProjectionMatrix();camera.position.set(0,1+Math.cos(polar)*4,Math.sin(polar)*4);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
        const pivot=new THREE.Vector3(0,1,0),check=createCarVisit(scene,camera,document.body,testBirds,()=>{},pivot);
        for(let i=0;i<32;i++)check.update(.025);
        const visible=testBirds.slice(0,9).filter(bird=>{const p=bird.root.position.clone().add(new THREE.Vector3(0,1,0)).project(camera);return bird.root.visible&&p.z>-1&&p.z<1&&Math.abs(p.x)<.95&&Math.abs(p.y)<.95}).length;
        results.push({aspect,polar,visible,distance:camera.position.distanceTo(pivot)});
        check.dispose();testBirds.forEach(bird=>bird.dispose());
      }
      camera.aspect=1000/750;camera.updateProjectionMatrix();camera.position.set(0,4,14);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
      return results;
    };
    window.carPreview=(rear=false)=>{
      const car=createCompactCar(),preview=new THREE.Scene();preview.background=new THREE.Color('white');preview.add(car.root);
      preview.add(new THREE.HemisphereLight(0xffffff,0x777777,2));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(-5,9,8);preview.add(light);
      const view=new THREE.PerspectiveCamera(42,1000/750,.1,100);view.position.set(...(rear?[18,12,-28]:[18,12,28]));view.lookAt(0,4,0);renderer.render(preview,view);car.dispose();
    };
    window.gait=async()=>{
      await loadHumanPhotos();const human=createHuman(),samples=[];
      for(const progress of [.2,.3,.4]){
        const travelled=progress*2*.85*human.root.scale.x;
        human.root.position.z=travelled;human.animate(progress,0,true,travelled);human.root.updateMatrixWorld(true);
        const hip=human.root.getObjectByName('left-hip'),shoe=hip.getObjectByName('shoe');
        const sole=shoe.getWorldPosition(new THREE.Vector3());
        samples.push({z:sole.z,y:sole.y,knee:hip.getObjectByName('knee').rotation.x});
      }
      human.dispose();
      const preview=new THREE.Scene();preview.background=new THREE.Color('white');
      preview.add(new THREE.HemisphereLight(0xffffff,0x666666,2));
      const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(12,18,8);preview.add(light);
      const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:0xaaaaaa}));floor.rotation.x=-Math.PI/2;preview.add(floor);
      const figures=[0,.18,.5,.8,1].map((progress,index)=>{
        const figure=createHuman();figure.animate(1,0,true,progress*2*.85*figure.root.scale.x);
        figure.root.position.z=(index-2)*5;preview.add(figure.root);return figure;
      });
      const view=new THREE.PerspectiveCamera(45,1000/750,.1,200);view.position.set(32,8,0);view.lookAt(0,4,0);
      renderer.render(preview,view);figures.forEach(figure=>figure.dispose());floor.geometry.dispose();floor.material.dispose();
      return samples;
    };
  `)
  await build({ configFile: false, root: temporary, publicDir: false, logLevel: 'error', build: { outDir: resolve(temporary, 'site') } })
  const site = resolve(temporary, 'site')
  await mkdir(resolve(site, 'models'), { recursive: true })
  await cp(resolve('public/models/human-photo-atlas.png'), resolve(site, 'models/human-photo-atlas.png'))
  await cp(resolve('public/models/chihuahua-photo-atlas.png'), resolve(site, 'models/chihuahua-photo-atlas.png'))
  await cp(resolve('public/models/compact-car-atlas.png'), resolve(site, 'models/compact-car-atlas.png'))
  await cp(resolve('public/models/car-rear-lettering.png'), resolve(site, 'models/car-rear-lettering.png'))
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://fixture').pathname
      if (path === '/favicon.ico') { res.writeHead(204); res.end(); return }
      const file = resolve(site, '.' + (path === '/' ? '/index.html' : path))
      if (!file.startsWith(site + sep)) throw new Error('Invalid path')
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'text/html'); res.end(await readFile(file))
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 750 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => !!window.start)
  const gait = await page.evaluate(() => window.gait())
  assert.ok(Math.max(...gait.map(sample => sample.z)) - Math.min(...gait.map(sample => sample.z)) < .001, 'The planted foot stays in place while the body advances')
  assert.ok(gait.every(sample => sample.y >= .01 && sample.y <= .03), 'The flat supporting sole stays on the ground')
  await page.screenshot({ path: resolve(artifacts, 'human-walk-cycle.png') })
  await page.evaluate(() => window.start())
  const pose = await page.evaluate(() => window.until('pose'))
  assert.equal(pose.early, false); assert.equal(pose.starts.length, 8); assert.ok(pose.yields > 0)
  assert.ok(pose.starts.every(start => start.source === 'human'))
  assert.ok(pose.gestureAt - pose.standingAt >= 2.18 && pose.gestureAt - pose.standingAt <= 2.3, 'Stand for two seconds, then strike the pose in 0.2 seconds')
  assert.ok(Math.max(...pose.starts.map(s => s.time)) - Math.min(...pose.starts.map(s => s.time)) < .2)
  const joints = await page.evaluate(() => window.pose()); assert.ok(joints.knee < -1.4 && joints.arms < -1.8)
  assert.ok(joints.flockDistance<3.1,'The human stops in or just beside the main flock')
  assert.ok(joints.facePixels>=18,'The human face remains large enough to see: '+joints.facePixels)
  assert.ok(Math.abs(Math.atan2(Math.sin(joints.heading - pose.heading), Math.cos(joints.heading - pose.heading))) < .03, 'Hold the chosen pose direction')
  assert.ok(joints.faceAlignment>=.49,'The face remains toward the viewer during the gesture')
  await page.screenshot({ path: resolve(artifacts, 'human-gesture.png') });await page.evaluate(()=>window.headPreview());await page.screenshot({path:resolve(artifacts,'human-head-three-quarter.png')});await page.evaluate(()=>window.headPreview(true));await page.screenshot({path:resolve(artifacts,'human-head-profile.png')})
  const returned = await page.evaluate(() => window.until('done')); assert.equal(returned.done, true); assert.equal(returned.visible, 8)
  assert.ok(returned.unlockReturned>=6,'Keep human visit controls locked until at least 75% have returned')
  const humanViews=await page.evaluate(()=>window.humanViews())
  assert.ok(humanViews.every(sample=>sample.faceAlignment>=.49&&sample.flockDistance<3.1),'Face the viewer near the flock from every camera azimuth')
  assert.ok(humanViews.some(sample=>sample.faceAlignment>.94)&&humanViews.some(sample=>sample.faceAlignment<.85),'Vary front and three-quarter face views')
  assert.ok(new Set(humanViews.map(sample=>sample.position.map(value=>value.toFixed(1)).join(','))).size>4,'Vary the standing locations')
  await page.evaluate(() => window.start(false))
  const dog = await page.evaluate(() => window.until('done')); assert.equal(dog.done, true); assert.equal(dog.starts.length, 8); assert.equal(dog.visible, 8)
  assert.ok(dog.frontSeen && dog.frontAlignment > .95, 'The dog faces the camera with its face visible before exiting')
  assert.ok(dog.unlockReturned>=6,'Keep dog visit controls locked until at least 75% have returned')
  await page.evaluate(() => window.dogPreview())
  await page.screenshot({ path: resolve(artifacts, 'chihuahua-preview.png') })
  await page.evaluate(() => window.dogPreview(true))
  await page.screenshot({ path: resolve(artifacts, 'chihuahua-side.png') })
  await page.evaluate(() => window.startCar(true))
  const rear = await page.evaluate(() => window.carUntil('rear'))
  assert.equal(rear.rear, true, 'The exit shows the rear of the car while heading away from the camera')
  await page.screenshot({ path: resolve(artifacts, 'car-exit.png') })
  const carReturn = await page.evaluate(() => window.carUntil('done'))
  assert.equal(carReturn.done, true); assert.equal(carReturn.visible, 4)
  assert.ok(carReturn.laps<=1, 'Use at most one round trip before targeting remaining pigeons')
  assert.ok(carReturn.exitVisible>=0&&carReturn.exitVisible<=3,'The car may leave with up to three participating pigeons remaining')
  assert.ok(carReturn.frames-carReturn.clipped>5,'The central approach remains visible before an early exit');assert.ok(carReturn.cameraMotion<.000001,'The camera stays fixed throughout driving and exit')
  assert.ok(carReturn.turn < .3, 'Curve tangents keep steering continuous through turns and exit')
  const exitSpeed=await page.evaluate(()=>window.exitMinSpeed())
  assert.ok(exitSpeed>42&&exitSpeed<46,'Slow smoothly to about 80% of driving speed during exit: '+exitSpeed)
  assert.ok(carReturn.maxTravel>15,'Keep curved driving approaches around the flock')
  assert.ok(carReturn.viewDistance<70,'Keep a moderate fixed view instead of zooming out to fit the entire route: '+carReturn.viewDistance)
  assert.ok(carReturn.platePixels>=60,'The rear license text is large enough to read during exit: '+carReturn.platePixels)
  const trigger=await page.evaluate(()=>window.returnTrigger())
  assert.ok(trigger.carVisible&&trigger.platePixels<40&&trigger.plazaDistance>=75&&trigger.time<carReturn.departedAt,'Wait until the car is well away from the plaza and its lettering is small before returning')
  if(carReturn.returns.length)assert.ok(carReturn.returns.some(arrival=>arrival.time<carReturn.departedAt),'At least one offscreen pigeon starts returning while the car is still visible')
  if(carReturn.returns.some(arrival=>arrival.mode==='walk'))assert.ok(carReturn.walkFrames>0,'Offscreen walking returns use the normal gait')
  if(carReturn.returns.some(arrival=>arrival.mode==='fly'))assert.ok(carReturn.flyFrames>0,'Offscreen flight returns flap their wings')
  assert.ok(carReturn.landings.some(landing=>landing.visible),'Hit pigeons can land visibly and resume walking')
  assert.ok(carReturn.landings.every(landing=>landing.uprightAlignment>.999),'Pigeons recover their upright orientation before landing')
  assert.ok(carReturn.restFrames>20&&carReturn.restMotion<.01&&carReturn.restUpright<.01,'Landed pigeons lie on their side and stay still before standing')
  assert.ok(carReturn.stands.every(stand=>carReturn.landings.some(landing=>landing.id===stand.id&&stand.time-landing.time>=1.2&&stand.time-landing.time<=2.15)),'Rest briefly before resuming normal walking')
  for(const hit of carReturn.hits.filter(hit=>hit.hitCount>1))assert.ok(carReturn.landings.some(landing=>landing.id===hit.id&&landing.visible&&landing.time<hit.time),'Repeat contact follows a visible landing')
  assert.ok(Math.abs(carReturn.cameraPosition[2]-14)<.001, 'Restore the original camera after the enlarged vehicle leaves')
  assert.ok(carReturn.hits.length >= 2, 'Pigeons in the driving lane get hit')
  assert.ok(carReturn.hits.every(hit => hit.id !== '3'), 'A pigeon away from the car never flees')
  assert.ok(carReturn.hits.every(hit => Math.abs(hit.lateral) <= 4.45 && Math.abs(hit.longitudinal) <= 8.5 && hit.velocity[1] >= (hit.farLaunch?16:13)*1.05 && hit.velocity[1]<=(hit.farLaunch?20:16)*1.05 && Math.hypot(hit.velocity[0],hit.velocity[2]) >= 16), 'Physical contact gives a stronger upward impulse')
  await page.evaluate(() => window.carPreview())
  await page.screenshot({ path: resolve(artifacts, 'car-front.png') })
  await page.evaluate(() => window.carPreview(true))
  await page.screenshot({ path: resolve(artifacts, 'car-rear.png') })
  await page.evaluate(()=>window.startCar('far'))
  const farImpacts=await page.evaluate(()=>window.carUntil('done'))
  assert.equal(farImpacts.done,true);assert.equal(farImpacts.visible,4)
  assert.ok(farImpacts.hits.length>0&&farImpacts.hits.every(hit=>hit.farLaunch&&hit.velocity[1]>=16.8&&hit.spin.some(rate=>Math.abs(rate)>1)),'The stronger impact variant launches higher with randomized spin')
  assert.ok(farImpacts.landings.some(landing=>!landing.visible),'Stronger hits send pigeons outside the view')
  assert.ok(farImpacts.returns.some(arrival=>arrival.time<farImpacts.departedAt),'Offscreen pigeons start returning before the car disappears')
  for (const portrait of [true,false]) {
    await page.evaluate(portrait=>window.carView(portrait),portrait)
    await page.evaluate(()=>window.startCar())
    const result=await page.evaluate(()=>window.carUntil('done'))
    assert.equal(result.done,true);assert.ok(result.laps<=1);assert.ok(result.exitVisible>=0&&result.exitVisible<=3);assert.ok(result.cameraMotion<.000001,portrait?'Fixed camera on a portrait display':'Fixed camera from a rotated view');assert.ok(result.turn<.3);assert.equal(result.rear,true)
  }
  const framedFlock=await page.evaluate(()=>window.carFlockFraming())
  assert.ok(framedFlock.every(view=>view.visible>=8),'Car entry keeps the main flock visible with close/high/low/portrait views and a distant outlier: '+JSON.stringify(framedFlock))
  const closeHuman=await page.evaluate(()=>window.humanFraming(true))
  assert.equal(closeHuman.clipped,false);assert.ok(closeHuman.distance>4&&closeHuman.distance<28);assert.ok(closeHuman.angle>.999999,'Human zoom preserves the viewing angle')
  const distantHuman=await page.evaluate(()=>window.humanFraming(false))
  assert.equal(distantHuman.clipped,false);assert.ok(Math.abs(distantHuman.distance-28)<.001,'Do not zoom out when the human already fits');assert.ok(distantHuman.angle>.999999)
  assert.deepEqual(errors, [])
  console.log('PASS: human gesture, planted feet, chihuahua scare/return and car collisions/rear exit/recovery.')
} finally {
  await browser?.close(); if (server) await new Promise(done => server.close(done))
  if (!temporary.startsWith(artifacts + sep)) throw new Error('Invalid temporary directory')
  await rm(temporary, { recursive: true, force: true })
}
