import {build} from 'vite'
import {chromium,webkit} from '@playwright/test'
import {createServer} from 'node:http'
import {mkdtemp,writeFile,readFile,rm,cp} from 'node:fs/promises'
import {resolve,sep} from 'node:path'
import assert from 'node:assert/strict'
const artifacts=resolve('artifacts'),root=await mkdtemp(resolve(artifacts,'hand-compat-'))
let server
try{
 await writeFile(resolve(root,'index.html'),'<video id="video" muted autoplay playsinline></video><script type="module" src="/fixture.ts"></script>')
 await writeFile(resolve(root,'fixture.ts'),`
 import {startHandTracking} from ${JSON.stringify(resolve('src/hand-tracking.ts').replaceAll('\\','/'))};
 window.ready=true;window.failures=[];window.waveCount=0;window.captureTimer=undefined;
 window.start=async()=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const g=canvas.getContext('2d');g.fillStyle='#aaa';g.fillRect(0,0,320,180);let stream;
  if(canvas.captureStream)stream=canvas.captureStream(10);
  else{
   // Desktop WebKit has no synthetic canvas captureStream. Supply its video
   // adapter with a canvas image while still running the real worker/WASM.
   stream={};const track={readyState:'live',stop(){this.readyState='ended'}};stream.getTracks=()=>[track];
   const video=document.getElementById('video');video.play=async()=>{};
   Object.defineProperty(video,'srcObject',{value:null,writable:true});
   for(const [key,get]of Object.entries({readyState:()=>2,videoWidth:()=>320,videoHeight:()=>180,currentTime:()=>performance.now()/1000}))Object.defineProperty(video,key,{get});
   const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(source,...args){return draw.call(this,source===video?canvas:source,...args)};
   const bitmap=window.createImageBitmap.bind(window);window.createImageBitmap=(source,...args)=>bitmap(source===video?canvas:source,...args);
  }
  window.stream=stream;
  window.captureTimer=setInterval(()=>{g.fillRect(0,0,320,180)},100);
  if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{value:{}});navigator.mediaDevices.getUserMedia=async()=>stream;
  window.tracking=await startHandTracking(document.getElementById('video'),()=>window.waveCount++,error=>window.failures.push(error.message),undefined,()=>{window.cameraReadyAt=performance.now();window.cameraReadyCalls=(window.cameraReadyCalls??0)+1});window.trackingReadyAt=performance.now();
 };
 window.stop=()=>{window.tracking?.stop();clearInterval(window.captureTimer)};
 `)
 await build({configFile:false,root,publicDir:false,logLevel:'error',build:{outDir:resolve(root,'site')}})
 const site=resolve(root,'site');await cp(resolve('public/models'),resolve(site,'models'),{recursive:true})
 server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://fixture').pathname,file=resolve(site,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(site+sep))throw Error();if(path.endsWith('hand_landmarker.task'))await new Promise(done=>setTimeout(done,1800));res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.wasm')?'application/wasm':'text/html');res.end(await readFile(file))}catch{res.writeHead(404);res.end()}})
 await new Promise(done=>server.listen(0,'127.0.0.1',done))
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch(engine===chromium?{channel:'msedge',headless:true}:{headless:true})
  try{
   for(const unsupported of [false,true]){
    // An iPhone in-app UA has Safari but no Version token: this caused the old
    // MediaPipe guard to use document.createElement() inside the worker.
    const context=await browser.newContext({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',viewport:{width:390,height:844},isMobile:true,hasTouch:true})
    await context.addInitScript(({unsupported})=>{
     const NativeWorker=window.Worker;window.workerFallbacks=0;window.workerFallbackReasons=[];
     window.Worker=class extends NativeWorker{
      constructor(url,options){
       const script=unsupported?URL.createObjectURL(new Blob(['self.OffscreenCanvas=undefined;importScripts('+JSON.stringify(String(url))+')'],{type:'text/javascript'})):url;
       super(script,options);this.addEventListener('message',e=>{if(e.data.type==='fallback'){window.workerFallbacks++;window.workerFallbackReasons.push(e.data.message)}});
      }
     };
    },{unsupported})
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready)
    await page.evaluate(()=>window.start());assert.equal(await page.evaluate(()=>window.cameraReadyCalls),1);assert.ok(await page.evaluate(()=>window.trackingReadyAt-window.cameraReadyAt>1000),'Camera-ready callback fires before the slow model download finishes');await page.waitForFunction(()=>window.waveCount>=2,{},{timeout:30000});assert.deepEqual(await page.evaluate(()=>window.failures),[]);assert.deepEqual(errors,[])
    if(unsupported)assert.equal(await page.evaluate(()=>window.workerFallbacks),1)
    else if(engine===chromium)assert.equal(await page.evaluate(()=>window.workerFallbacks),0,'Explicit worker canvas bypasses the Safari UA guard')
    assert.ok(await page.evaluate(()=>window.workerFallbackReasons.every(reason=>!/document/.test(reason))),'Worker never tries to create a DOM canvas')
    await page.evaluate(()=>window.stop());assert.ok(await page.evaluate(()=>window.stream.getTracks().every(t=>t.readyState==='ended')));assert.equal(await page.evaluate(()=>document.getElementById('video').srcObject),null)
    const fallbacks=await page.evaluate(()=>window.workerFallbacks);console.log(`PASS ${engine.name()} ${fallbacks?'compatibility fallback':'iPhone worker canvas'}: real model inference and camera cleanup`);await context.close()
   }
  }finally{await browser.close()}
 }
}finally{if(server)await new Promise(done=>server.close(done));assert.ok(root.startsWith(artifacts+sep));await rm(root,{recursive:true,force:true})}
