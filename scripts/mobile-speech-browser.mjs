import {build} from 'vite'
import {chromium,webkit,firefox} from '@playwright/test'
import {createServer} from 'node:http'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {resolve,sep} from 'node:path'
import assert from 'node:assert/strict'

// Reproduce mobile keyboard event sequences without touching the real database.
const root=await mkdtemp(resolve('artifacts','mobile-speech-'))
let server
try{
 await writeFile(resolve(root,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="action-bar"><button id="speak">Speak</button></div><button id="remove-pigeon"></button><section id="speech-panel" hidden><input id="speech-input"><output id="speech-count"></output><button id="speech-close">Save</button><p id="speech-error" hidden></p></section><button id="outside">Outside</button><script type="module" src="/fixture.ts"></script>')
 await writeFile(resolve(root,'fixture.ts'),`
 import {createSpeech} from ${JSON.stringify(resolve('src/speech.ts').replaceAll('\\','/'))};
 Math.random=()=>.5;window.saved=[];window.previews=[];
 const speech=createSpeech({say:async(owner,message,automatic)=>window.saved.push({message,automatic}),previewSpeech:(id,message,automatic)=>window.previews.push({message,automatic})} as any);
 window.reset=()=>{speech.setOwner({id:crypto.randomUUID(),token:'fixture'});document.getElementById('speak').click()};
 window.nativeEdit=(value,type='insertText',data=null,composing=false)=>{const input=document.getElementById('speech-input');input.dispatchEvent(new InputEvent('beforeinput',{inputType:type,data,isComposing:composing,bubbles:true}));input.value=value;input.setSelectionRange(value.length,value.length);input.dispatchEvent(new InputEvent('input',{inputType:type,data,isComposing:composing,bubbles:true}))};
 window.reset();`)
 await build({configFile:false,root,publicDir:false,logLevel:'error',define:{'import.meta.env.VITE_STORAGE_MODE':JSON.stringify('supabase')},build:{outDir:resolve(root,'site')}})
 const site=resolve(root,'site');server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://fixture').pathname,file=resolve(site,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(site+sep))throw Error();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(file))}catch{res.writeHead(404);res.end()}})
 await new Promise(done=>server.listen(0,'127.0.0.1',done))
 for(const engine of [chromium,webkit,firefox]){
  const browser=await engine.launch(engine===chromium?{channel:'msedge',headless:true}:{headless:true})
  try{
   const page=await browser.newPage({viewport:{width:390,height:844},isMobile:engine===firefox?undefined:true,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message))
   await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.reset)
   const input=page.locator('#speech-input')
   // Safari-style Korean: no composition events, and a keyboard revises the
   // current syllable through delete+insert events with pauses > old 120 ms.
   await page.evaluate(async()=>{
    let committed='';for(let i=0;i<12;i++){
     for(const syllable of ['ㅎ','하','한']){window.nativeEdit(committed,'deleteContentBackward');window.nativeEdit(committed+syllable,'insertText',syllable);await new Promise(done=>setTimeout(done,145));if(document.getElementById('speech-input').value!==committed+syllable)throw Error('Application rewrote an uncommitted Korean syllable')}
     committed+='한';
    }
   })
   await page.waitForTimeout(400);assert.equal(await input.inputValue(),'한'.repeat(12));assert.equal(await page.locator('#speech-count').textContent(),'12 / 50')
   await page.evaluate(()=>window.nativeEdit(document.getElementById('speech-input').value+' ','insertText',' '))
   await page.waitForTimeout(50);const boundary=await input.inputValue();assert.equal(boundary.replace(/[9.]/g,''),'한'.repeat(12)+' ');assert.equal((boundary.match(/9+/g)||[]).length,1)
   // Android-style whole-word replacements retain existing automatic chars.
   await page.evaluate(async()=>{
    const base=document.getElementById('speech-input').value;
    for(let i=0;i<20;i++){
     const input=document.getElementById('speech-input');input.setSelectionRange(0,input.value.length);window.nativeEdit(base+(i%2?'word':'ward'),'insertReplacementText',i%2?'word':'ward');await new Promise(done=>setTimeout(done,140));
    }
   });assert.equal((await input.inputValue()).match(/9+/g).length,1);assert.equal(await page.locator('#speech-count').textContent(),'17 / 50')
   await page.locator('#outside').click();await page.locator('#speech-panel').waitFor({state:'hidden'});const saved=await page.evaluate(()=>window.saved.at(-1));assert.equal(saved.message.replace(/[9.]/g,''),'한'.repeat(12)+' word');assert.equal(saved.automatic.length,7)
   // Editing an existing noisy sentence must not convert retained noise into
   // human text, or repeatedly re-arm it when prediction removes/reinserts it.
   await page.evaluate(()=>window.reset());await input.pressSequentially('abcdefghij',{delay:140});assert.equal(await input.inputValue(),'abcdefghij')
   await page.locator('#speech-close').click();await page.locator('#speech-panel').waitFor({state:'hidden'});assert.equal((await page.evaluate(()=>window.saved.at(-1))).automatic.length,7)
   // Missing compositionend on blur must not trap the editor open.
   await page.evaluate(()=>{window.reset();document.getElementById('speech-input').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));window.nativeEdit('한글','insertCompositionText','한글',true)})
   await page.locator('#speech-close').click();await page.locator('#speech-panel').waitFor({state:'hidden'});assert.equal((await page.evaluate(()=>window.saved.at(-1))).message,'한글')
   // Some mobile keyboards submit only beforeinput, without Enter keyup.
   await page.evaluate(()=>{window.reset();window.nativeEdit('완료','insertText','완료');document.getElementById('speech-input').dispatchEvent(new InputEvent('beforeinput',{inputType:'insertLineBreak',bubbles:true,cancelable:true}))});await page.locator('#speech-panel').waitFor({state:'hidden'});assert.equal((await page.evaluate(()=>window.saved.at(-1))).message,'완료')
   // The 50-character limit is applied on commitment without rewriting an IME.
   await page.evaluate(()=>{window.reset();window.nativeEdit('가'.repeat(52),'insertText','가')});assert.equal(await input.inputValue(),'가'.repeat(52));await page.locator('#speech-close').click();await page.locator('#speech-panel').waitFor({state:'hidden'});assert.equal((await page.evaluate(()=>window.saved.at(-1))).message.replace(/[9.]/g,''),'가'.repeat(50))
   // A keyboard with actual commitment events should produce noise during
   // typing, without requiring spaces or waiting for final submission.
   await page.evaluate(async()=>{
    window.reset();const input=document.getElementById('speech-input');
    for(let i=0;i<12;i++){
     const prefix=input.value;input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));window.nativeEdit(prefix+'한','insertCompositionText','한',true);input.dispatchEvent(new CompositionEvent('compositionend',{data:'한',bubbles:true}));await new Promise(done=>setTimeout(done,90));
     if(input.value.replace(/[9.]/g,'')!=='한'.repeat(i+1))throw Error('Composition flush duplicated or lost a syllable');
    }
   });assert.equal((await input.inputValue()).match(/9+/g).length,2,'Completed syllables generate noise at approximately the desktop cadence')
   assert.deepEqual(errors,[]);console.log(`PASS ${engine.name()}: event-less Korean composition, replacement bursts, bounded noise, submission, missing compositionend, character limit`)
  }finally{await browser.close()}
 }
}finally{if(server)await new Promise(done=>server.close(done));assert.ok(root.startsWith(resolve('artifacts')+sep));await rm(root,{recursive:true,force:true})}
