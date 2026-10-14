import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import assert from 'node:assert/strict'

const artifacts=resolve('artifacts');await mkdir(artifacts,{recursive:true})
const root=await mkdtemp(resolve(artifacts,'analytics-check-'))
let browser,server
try {
  await writeFile(resolve(root,'index.html'), '<meta charset="utf-8"><body><div id="app"></div><script>window.dataLayer=[];function gtag(){dataLayer.push(Array.from(arguments))}</script><script type="module" src="/fixture.ts"></script>')
  await writeFile(resolve(root,'fixture.ts'), `import ${JSON.stringify(resolve('src/main.ts').replaceAll('\\','/'))};window.fixtureReady=true;`)
  const mocks={
    './world': `export function createWorld(container){
      let active=false,resolveVisit,count=0;const emit=(name,detail={})=>container.dispatchEvent(new CustomEvent(name,{detail}));
      const release=type=>{if(window.failVisit){window.failVisit=false;return Promise.reject(new Error('PRIVATE_FAILURE'))}active=true;emit('visitorstart',{exampleType:type});return new Promise(resolve=>{resolveVisit=resolve;window.fixtureUnlock=()=>resolve();window.fixtureFinish=()=>{active=false;emit('visitorend',{exampleType:type});emit('poodleend');resolve()}})};
      window.fixtureEmit=emit;window.fixtureRemoveFinish=()=>{};
      const world={releasePoodle:()=>release('dog'),releaseHuman:()=>release('human'),releaseCar:()=>release('car'),releaseWizard:()=>release('wizard'),stopWizard:()=>emit('wizardtrackingend'),wizardWave:()=>{},focusSpeech:()=>{},get count(){return count},get poodleActive(){return active},add:()=>count++,remove:()=>new Promise(done=>{window.fixtureRemoveFinish=()=>{count--;done()}})};
      window.fixtureWorld=world;return world;
    }`,
    './shared-flock': `export function connectFlock(world,status,onSnapshot){
      const shared={previewSpeech(){},say:async()=>{if(window.failSpeech)throw new Error('PRIVATE_SPEECH');window.saves=(window.saves??0)+1},publish:async()=>{world.add();return{id:'PRIVATE_OWNER_ID',token:'PRIVATE_OWNER_TOKEN'}},remove:async()=>world.remove(),close(){}};
      setTimeout(()=>onSnapshot({revision:0,birds:[]}),0);return shared;
    }`,
    './wizard': `export const loadWizardPhotos=async()=>{};`,
    './hand-tracking': `export async function startHandTracking(video,onWave,onError,signal,onReady){
      if(window.denyCamera){window.denyCamera=false;throw new DOMException('PRIVATE_DEVICE','NotAllowedError')}
      window.fixtureTrackingError=onError;onReady();return{stop(){}};
    }`,
    './face': `export async function createFace(){return{geometry:{dispose(){}},material:{map:{dispose(){}},dispose(){}}}}`,
  }
  await build({configFile:false,root,publicDir:resolve('public'),logLevel:'error',define:{'import.meta.env.VITE_STORAGE_MODE':JSON.stringify('supabase')},plugins:[{
    name:'isolated-analytics-fixture',
    enforce:'pre',
    resolveId(id,importer){if(importer?.replaceAll('\\','/').endsWith('/src/main.ts')&&mocks[id])return '\0analytics-mock:'+id},
    load(id){if(id.startsWith('\0analytics-mock:'))return mocks[id.slice('\0analytics-mock:'.length)]},
  }],build:{outDir:resolve(root,'site')}})
  const site=resolve(root,'site')
  server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://fixture').pathname,file=resolve(site,'.'+(path==='/'?'/index.html':path));assert.ok(file.startsWith(site+sep));const types={js:'text/javascript',css:'text/css',woff2:'font/woff2',png:'image/png'};res.setHeader('Content-Type',types[file.split('.').pop()]??'text/html');res.end(await readFile(file))}catch{res.writeHead(404);res.end()}})
  await new Promise(done=>server.listen(0,'127.0.0.1',done))
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.fixtureReady)
  const events=name=>page.evaluate(name=>window.dataLayer.filter(entry=>entry[0]==='event'&&entry[1]===name).map(entry=>entry[2]),name)
  const waitEvent=(name,count)=>page.waitForFunction(({name,count})=>window.dataLayer.filter(entry=>entry[1]===name).length===count,{name,count})

  // Use a synthetic camera with the real capture-dialog and speech handlers; no external data is sent.
  await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const context=canvas.getContext('2d');context.fillStyle='#ccc';context.fillRect(0,0,320,240)
    window.fixtureStream=canvas.captureStream(10);navigator.mediaDevices.getUserMedia=async()=>window.fixtureStream
  })
  await page.click('#join');await page.waitForFunction(()=>!document.getElementById('snap').disabled)
  await page.click('#snap');await waitEvent('pigeon_create_end',1)
  assert.equal((await events('pigeon_create_end'))[0].outcome,'completed')
  assert.ok(await page.evaluate(()=>window.fixtureStream.getTracks().every(track=>track.readyState==='ended')))

  // Exercise the actual icon handlers. Full recovery, rather than early UI unlock, ends measurement.
  await page.click('#poodle');await waitEvent('example_start',1)
  await page.evaluate(()=>window.fixtureEmit('pigeonstartled',{id:'PRIVATE_BIRD'}))
  await page.evaluate(()=>window.fixtureUnlock());await page.waitForTimeout(30)
  assert.equal((await events('example_end')).length,0)
  await page.evaluate(()=>window.fixtureFinish());await waitEvent('example_end',1)
  await page.click('#car');await waitEvent('example_start',2)
  await page.evaluate(()=>{window.fixtureEmit('carimpact',{id:'PRIVATE_BIRD'});window.fixtureEmit('carimpact',{id:'PRIVATE_BIRD'});window.fixtureEmit('carreturnstart')})
  await page.evaluate(()=>window.fixtureFinish());await waitEvent('example_end',2)
  assert.equal((await events('example_end'))[1].hit_count,2)
  await page.click('#human');await waitEvent('example_start',3)
  await page.evaluate(()=>window.fixtureEmit('humangesture'));await page.evaluate(()=>window.fixtureFinish());await waitEvent('example_end',3)

  await page.click('#wizard');await waitEvent('example_start',4)
  assert.equal((await events('wizard_control_start')).length,0)
  await page.evaluate(()=>window.fixtureEmit('wizardcontrolstart'));await waitEvent('wizard_control_start',1)
  for(const pattern of ['flying','ribbon','vortex','ribbon','vortex'])await page.evaluate(pattern=>window.fixtureEmit('wizardpattern',{pattern}),pattern)
  assert.equal((await events('wizard_pattern')).length,3)
  await page.click('#magic-stop');await waitEvent('wizard_control_end',1)
  await page.evaluate(()=>window.fixtureFinish());await waitEvent('example_end',4)
  assert.equal((await events('example_end'))[3].end_reason,'user_close')
  await page.evaluate(()=>window.denyCamera=true);await page.click('#wizard');await waitEvent('example_end',5)
  assert.equal((await events('example_error'))[0].error_code,'permission_denied')
  assert.equal((await events('example_start')).length,4)

  // A failed visit must not prevent the next example from being measured.
  await page.evaluate(()=>window.failVisit=true);await page.click('#car');await waitEvent('example_end',6)
  assert.equal((await events('example_end'))[5].outcome,'failed')
  await page.click('#human');await waitEvent('example_start',5);await page.evaluate(()=>window.fixtureFinish());await waitEvent('example_end',7)

  await page.click('#speak');await page.fill('#speech-input','PRIVATE_TEXT 한글');await page.press('#speech-input','Enter');await waitEvent('speech_saved',1)
  const saved=await events('speech_saved');assert.equal(saved[0].character_count,15)
  await page.click('#speak');await page.click('#speech-close');await page.waitForTimeout(50)
  assert.equal((await events('speech_saved')).length,1,'Closing unchanged text does not count another save')
  await page.click('#remove-pigeon');await page.click('#remove-ok');await waitEvent('pigeon_delete_start',1)
  assert.equal((await events('pigeon_delete_end')).length,0)
  await page.evaluate(()=>window.fixtureRemoveFinish());await waitEvent('pigeon_delete_end',1)
  assert.equal((await events('pigeon_delete_end'))[0].outcome,'completed')
  const measured=await page.evaluate(()=>JSON.stringify(window.dataLayer))
  for(const privateValue of ['PRIVATE_TEXT','PRIVATE_OWNER_ID','PRIVATE_OWNER_TOKEN','PRIVATE_BIRD','PRIVATE_DEVICE','PRIVATE_FAILURE'])assert.ok(!measured.includes(privateValue),'No personal content in telemetry: '+privateValue)
  assert.deepEqual(errors,[])
  console.log('PASS: actual icon/camera/speech/delete handlers, recovery timing, failed and cancelled attempts, deduplication, and no personal content in GA events.')
} finally {
  await browser?.close();if(server)await new Promise(done=>server.close(done))
  assert.ok(root.startsWith(artifacts+sep));await rm(root,{recursive:true,force:true})
}
