import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import assert from 'node:assert/strict'

const artifacts=resolve('artifacts');await mkdir(artifacts,{recursive:true})
const temporary=await mkdtemp(resolve(artifacts,'camera-check-'))
let browser,server
try {
  await writeFile(resolve(temporary,'index.html'),'<body style="margin:0"><main id="world" style="position:fixed;inset:0"></main><script type="module" src="/fixture.ts"></script>')
  await writeFile(resolve(temporary,'fixture.css'),(await readFile(resolve('src/style.css'),'utf8')).replace(/@font-face\{[^}]+\}/g,''));
  await writeFile(resolve(temporary,'fixture.ts'),`
    import './fixture.css';
    import * as THREE from 'three';
    import {createWorld} from ${JSON.stringify(resolve('src/world.ts').replaceAll('\\','/'))};
    const add=THREE.Scene.prototype.add;
    THREE.Scene.prototype.add=function(...objects){window.worldScene=this;for(const object of objects)if(object.name==='pigeon-removal-black-hole')window.hole=object;return add.apply(this,objects)};
    const update=THREE.PerspectiveCamera.prototype.updateMatrixWorld;
    THREE.PerspectiveCamera.prototype.updateMatrixWorld=function(force){
      update.call(this,force);
      const direction=new THREE.Vector3(0,0,-1).applyQuaternion(this.quaternion);
      window.viewDistance=(this.position.y-1.1)/-direction.y;
      window.viewPose=[...this.position.toArray(),...this.quaternion.toArray()];
    };
    const world=createWorld(document.getElementById('world'));
    for(let i=0;i<40;i++){
      const face=new THREE.Mesh(new THREE.SphereGeometry(.25,8,6),new THREE.MeshStandardMaterial({color:0x888888}));
      world.add(face,{id:String(i),focus:false});world.say(String(i),i%3?'Pigeon '+i:'Hi');
    }
    window.ready=world.count===40;
    window.focusSpeech=id=>world.focusSpeech(id);
    window.removeOne=()=>{window.removed=false;world.remove('0').then(()=>window.removed=world.count===39)};
  `)
  await build({configFile:false,root:temporary,publicDir:false,logLevel:'error',build:{outDir:resolve(temporary,'site')}})
  const site=resolve(temporary,'site')
  server=createServer(async(req,res)=>{
    try {
      const path=new URL(req.url,'http://fixture').pathname
      if(path==='/favicon.ico'){res.writeHead(204);res.end();return}
      const file=resolve(site,'.'+(path==='/'?'/index.html':path))
      if(!file.startsWith(site+sep))throw new Error('Invalid path')
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(file))
    }catch{res.writeHead(404);res.end()}
  })
  await new Promise(done=>server.listen(0,'127.0.0.1',done))
  browser=await chromium.launch({channel:'msedge',headless:true})
  const errors=[]
  for(const viewport of [{width:1000,height:750},{width:480,height:800}]){
    const page=await browser.newPage({viewport,reducedMotion:'reduce'})
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto('http://127.0.0.1:'+server.address().port)
    await page.waitForFunction(()=>window.ready)
    await page.mouse.move(viewport.width/2,viewport.height/2)
    await page.mouse.wheel(0,1800)
    await page.waitForFunction(()=>[...document.querySelectorAll('.speech-bubble')].every(bubble=>bubble.hidden))
    await page.mouse.wheel(0,-2400)
    await page.waitForFunction(()=>document.querySelectorAll('.speech-bubble:not([hidden])').length>0)
    const counts=await page.evaluate(async()=>{
      const counts=[]
      for(let i=0;i<12;i++){await new Promise(done=>setTimeout(done,100));counts.push(document.querySelectorAll('.speech-bubble:not([hidden])').length)}
      return counts
    })
    assert.ok(counts.every(count=>count>0),'Bubbles stay visible after zooming in with 40 pigeons: '+counts)
    await page.mouse.wheel(0,-2400)
    await page.waitForFunction(()=>window.viewDistance<8)
    await page.mouse.wheel(0,-2400)
    await page.waitForFunction(()=>window.viewDistance<4.2)
    await page.mouse.wheel(0,2400)
    await page.waitForFunction(()=>window.viewDistance>7.8)
    await page.mouse.wheel(0,2400)
    await page.waitForFunction(()=>window.viewDistance>15.8)
    await page.mouse.wheel(0,2400)
    await page.waitForFunction(()=>window.viewDistance>27)
    assert.ok(await page.evaluate(()=>window.viewDistance<=28.01),'Zoom stays within its fixed bounds')
    await page.waitForTimeout(1200)
    const idlePose=await page.evaluate(()=>{const pose=[...window.viewPose];for(const child of window.worldScene.children)if(child.isGroup)child.position.x+=2;return pose})
    await page.waitForTimeout(500)
    const idleAfter=await page.evaluate(()=>window.viewPose)
    assert.ok(idleAfter.every((value,i)=>Math.abs(value-idlePose[i])<.00001),'Moving pigeons do not move the camera after wheel input ends')
    await page.mouse.down();await page.mouse.move(viewport.width/2+50,viewport.height/2+15,{steps:5});await page.mouse.up()
    await page.waitForTimeout(100)
    const releasedPose=await page.evaluate(()=>{const pose=[...window.viewPose];for(const child of window.worldScene.children)if(child.isGroup)child.position.x-=2;return pose})
    await page.waitForTimeout(500)
    const releasedAfter=await page.evaluate(()=>window.viewPose)
    assert.ok(releasedAfter.every((value,i)=>Math.abs(value-releasedPose[i])<.00001),'The camera stops rotating and following the flock when the pointer is released')
    await page.evaluate(()=>window.focusSpeech('0'))
    await page.waitForTimeout(900)
    assert.ok(await page.evaluate(()=>!document.querySelector('.speech-bubble').hidden),'Opening speech focuses the owned pigeon and reveals its bubble from a distant view')
    const speechPose=await page.evaluate(()=>window.viewPose)
    await page.waitForTimeout(400)
    assert.ok(await page.evaluate(pose=>window.viewPose.every((value,i)=>Math.abs(value-pose[i])<.00001),speechPose),'Speech focus stops when its short transition finishes')
    const tailResult=await page.evaluate(async()=>{
      const detached=[],inside=(x,y,w,h,r)=>{if(x<0||x>w||y<0||y>h)return false;if(y<=h-r||x>=r&&x<=w-r)return true;const cx=x<r?r:w-r;return (x-cx)**2+(y-(h-r))**2<=r*r+.1};
      for(let frame=0;frame<12;frame++){
        await new Promise(requestAnimationFrame);
        for(const bubble of document.querySelectorAll('.speech-bubble:not([hidden])')){
          const box=bubble.getBoundingClientRect(),style=getComputedStyle(bubble),tail=getComputedStyle(bubble,'::after');const left=parseFloat(tail.left),top=box.height-parseFloat(tail.bottom)-parseFloat(tail.borderTopWidth);const radius=Math.min(parseFloat(style.borderBottomLeftRadius),box.width/2,box.height/2);
          if(!inside(left-6,top,box.width,box.height,radius)||!inside(left+6,top,box.width,box.height,radius))detached.push({left,top,w:box.width,h:box.height});
        }
      }
      const bubble=document.querySelector('.speech-bubble:not([hidden])');if(!bubble)throw Error('No visible bubble to test');for(const offset of [-500,500]){bubble.style.setProperty('--tail-offset',offset+'px');const box=bubble.getBoundingClientRect(),tail=getComputedStyle(bubble,'::after'),radius=Math.min(28,box.width/2,box.height/2),left=parseFloat(tail.left),top=box.height-parseFloat(tail.bottom)-parseFloat(tail.borderTopWidth);if(!inside(left-6,top,box.width,box.height,radius)||!inside(left+6,top,box.width,box.height,radius))detached.push({offset,left,top})}return detached;
    });assert.deepEqual(tailResult,[],'Tail base stays inside the rounded bubble during camera motion and extreme edge offsets');
    await page.mouse.move(viewport.width/2,viewport.height/2);await page.mouse.down();await page.mouse.move(viewport.width/2+100,viewport.height/2-30,{steps:10});await page.mouse.up();
    await page.evaluate(()=>window.removeOne())
    await page.waitForFunction(()=>document.getElementById('world').dataset.removalPhase==='sinking')
    assert.ok(await page.evaluate(()=>window.hole.visible&&window.hole.children.length===4),'Deletion uses the black hole and its three rings')
    await page.waitForFunction(()=>window.removed)
    assert.ok(await page.evaluate(()=>window.hole.parent===null),'Removal cleans up the black hole')
    await page.close()
  }
  assert.deepEqual(errors,[])
  console.log('PASS: smooth wheel zoom through the full 4–28 range and 40-pigeon speech visibility on desktop and portrait views.')
}finally{
  await browser?.close();if(server)await new Promise(done=>server.close(done))
  if(!temporary.startsWith(artifacts+sep))throw new Error('Invalid temporary directory')
  await rm(temporary,{recursive:true,force:true})
}
