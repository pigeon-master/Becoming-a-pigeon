import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import assert from 'node:assert/strict'

// Isolated visual fixtures use the real pigeon model; no development server or user data.
const artifacts = resolve('artifacts'); await mkdir(artifacts, { recursive: true })
const temporary = await mkdtemp(resolve(artifacts, 'behavior-preview-'))
const source = name => JSON.stringify(resolve('src', name).replaceAll('\\', '/'))
let browser, server
try {
  await writeFile(resolve(temporary, 'index.html'), '<html><body style="margin:0"><script type="module" src="./fixture.ts"></script></body></html>')
  await writeFile(resolve(temporary, 'fixture.ts'), `
    import * as THREE from 'three';
    import { Pigeon } from ${source('world.ts')};
    import { createPigeonBehaviors } from ${source('pigeon-behavior.ts')};
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff);
    const camera = new THREE.PerspectiveCamera(45, 900/650, .1, 100);
    camera.position.set(5,3.5,7); camera.lookAt(0,1,1.3);
    const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setSize(900,650);
    renderer.shadowMap.enabled=true; document.body.append(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xe8f2ff,0x747460,2.4));
    const sun = new THREE.DirectionalLight(0xfff0d1,3.2);sun.position.set(-9,18,9);sun.castShadow=true;scene.add(sun);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:0x666762,roughness:1}));
    ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
    const birds=[];let controller;
    window.fixture=(kind)=>{
      controller?.dispose();for(const bird of birds)bird.dispose();birds.length=0;
      for(let i=0;i<(kind==='mating'?2:1);i++){
        const geometry=new THREE.SphereGeometry(.3,16,12);geometry.scale(1,1.1,1.25);
        const bird=new Pigeon(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x52655e})));
        bird.id=String(i);bird.root.position.set(0,0,i*3);bird.root.rotation.y=0;bird.settle=0;
        scene.add(bird.root);birds.push(bird);
      }
      controller=createPigeonBehaviors(scene,birds,()=>kind==='peck'?.1:kind==='dropping'?.5:0);
      for(let i=0;i<24000;i++){
        controller.update(.025,true);
        if(kind==='peck'&&birds[0].head.position.y<.56)break;
        if(kind==='dropping'&&controller.summary.droppings){for(let j=0;j<25;j++)controller.update(.025,false);break;}
        if(kind==='mating'&&controller.mounted(birds[0])){for(let j=0;j<70;j++)controller.update(.025,false);break;}
      }
      renderer.render(scene,camera);
      return controller.summary;
    };`)
  await build({ configFile: false, root: temporary, publicDir: false, logLevel: 'error', build: { outDir: resolve(temporary, 'site') } })
  const site = resolve(temporary, 'site')
  server = createServer(async (request, response) => {
    try {
      const name = new URL(request.url, 'http://localhost').pathname
      const file = resolve(site, '.' + (name === '/' ? '/index.html' : name))
      if (!file.startsWith(site + sep)) { response.writeHead(403); response.end(); return }
      response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'text/html')
      response.end(await readFile(file))
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => !!window.fixture)
  for (const kind of ['peck', 'dropping', 'mating']) {
    const result = await page.evaluate(kind => window.fixture(kind), kind)
    assert.equal(result.actions[0]?.kind, kind)
    if (kind === 'dropping') assert.equal(result.droppings, 1)
    await page.screenshot({ path: resolve(artifacts, `behavior-${kind}.png`) })
  }
  assert.deepEqual(errors, [])
  console.log('PASS: real-model peck, white splat and mounted wing-flapping render without browser errors.')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  if (!temporary.startsWith(artifacts + sep)) throw new Error('Unexpected test directory')
  await rm(temporary, { recursive: true, force: true })
}
