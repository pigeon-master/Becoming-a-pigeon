import test from 'node:test'
import assert from 'node:assert/strict'
import { handMotion, conductorMotion } from '../src/hand-tracking.ts'

function pointing(x:number,y:number){
  const hand=Array.from({length:21},()=>({x:.5,y:.5}))
  hand[0]={x:.5+x*.13/(4/3),y:.5+y*.13}
  hand[6]={x:.5-x*.08/(4/3),y:.5-y*.08}
  hand[8]={x:.5-x*.18/(4/3),y:.5-y*.18}
  return hand
}

test('an extended finger directs a centered hand in all eight directions',()=>{
  for(const [x,y] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
    const length=Math.hypot(x,y),wave=handMotion(undefined,pointing(x/length,y/length),100).wave
    if(x)assert.equal(Math.sign(wave.x),Math.sign(x))
    if(y)assert.equal(Math.sign(wave.y),Math.sign(y))
    assert.ok(Math.hypot(wave.x,wave.y)>.6)
  }
})

test('folded fingers preserve palm-position control without false pointing',()=>{
  const hand=Array.from({length:21},()=>({x:.2,y:.5}))
  hand[0].y=.63;hand[6].y=.45;hand[8].y=.57
  const wave=handMotion(undefined,hand,100).wave
  assert.ok(wave.x>.8);assert.ok(Math.abs(wave.y)<.15)
})

test('an open palm primarily follows hand position instead of accidentally lifting the flock',()=>{
  const hand=Array.from({length:21},()=>({x:.2,y:.5}))
  hand[0].y=.63
  for(const [joint,tip]of [[6,8],[10,12],[14,16],[18,20]]){hand[joint].y=.42;hand[tip].y=.25}
  const wave=handMotion(undefined,hand,100).wave
  assert.ok(wave.x>.7);assert.ok(Math.abs(wave.y)<.15)
})

test('a briefly occluded hand interpolates then stops when it stays absent',()=>{
  const initial=handMotion(undefined,pointing(0,1),100)
  const brief=handMotion(initial.previous,null,150)
  assert.ok(brief.wave.strength>.8&&brief.wave.y>.6)
  assert.equal(handMotion(brief.previous,null,400).wave.strength,0)
})

test('a hand approaching the camera retains its pointing direction and adds depth',()=>{
  const hand=pointing(0,1),first=handMotion(undefined,hand,100)
  const closer=hand.map(p=>({x:.5+(p.x-.5)*2,y:.5+(p.y-.5)*2}))
  const wave=handMotion(first.previous,closer,250).wave
  assert.ok((wave.depth??0)>.8);assert.ok(wave.y>.6)
})

test('rapid single-hand movement produces flourish without ever conducting',()=>{
  let previous:ReturnType<typeof conductorMotion>|undefined
  for(let i=0;i<16;i++){
    previous=conductorMotion(previous?.state,[[{x:.5,y:i%2?.25:.75}]],i*100)
    assert.equal(previous.wave.conducting,0);assert.equal(previous.wave.handCount,1)
  }
  assert.ok((previous!.wave.flourish??0)>.55)
})

test('duplicate landmarks and duplicate handedness cannot trigger a vortex',()=>{
  for(const metadata of [undefined,[[{categoryName:'Left',score:.9}],[{categoryName:'Left',score:.8}]]]){
    let previous:ReturnType<typeof conductorMotion>|undefined
    for(let i=0;i<15;i++){
      const y=i%2?.25:.75,x=metadata?.length?.75:.5
      previous=conductorMotion(previous?.state,[[{x,y}],[{x:metadata?.length?.25:.51,y:y+.01}]],i*100,4/3,metadata)
      assert.equal(previous.wave.conducting,0);assert.equal(previous.wave.handCount,1)
    }
  }
})

test('two moving hands conduct but a missing second hand clears the signal immediately',()=>{
  let previous:ReturnType<typeof conductorMotion>|undefined
  for(let i=0;i<15;i++){
    const y=i%2?.25:.75
    previous=conductorMotion(previous?.state,[[{x:.75,y}],[{x:.25,y:1-y}]],i*100)
  }
  assert.ok((previous!.wave.conducting??0)>.3)
  const single=conductorMotion(previous!.state,[[{x:.75,y:.5}]],1500)
  assert.equal(single.wave.conducting,0);assert.equal(single.wave.handCount,1);assert.equal(Object.values(single.wave.arms!).filter(arm=>arm.strength>0).length,1)
})

test('hand identity survives crossing the screen and close distinct hands remain two hands',()=>{
  const label=(side:string)=>[[{categoryName:side,score:.95}]]
  const first=conductorMotion(undefined,[[{x:.8,y:.25}]],0,4/3,label('Left'))
  const crossed=conductorMotion(first.state,[[{x:.2,y:.25}]],100,4/3,label('Left'))
  assert.equal(crossed.wave.arms!.left.strength,1);assert.equal(crossed.wave.arms!.right.strength,0)
  const both=conductorMotion(crossed.state,[[{x:.5,y:.2}],[{x:.51,y:.2}]],200,4/3,[...label('Right'),...label('Left')])
  assert.equal(both.wave.handCount,2);assert.ok(Object.values(both.wave.arms!).every(arm=>arm.strength===1))
  const remaining=conductorMotion(both.state,[[{x:.7,y:.2}]],300,4/3,label('Right'))
  assert.equal(remaining.wave.arms!.left.strength,0);assert.equal(remaining.wave.arms!.right.strength,1)
})

test('a momentary second detection and a single quick sweep do not trigger dramatic patterns',()=>{
  let previous:ReturnType<typeof conductorMotion>|undefined
  for(let i=0;i<3;i++)previous=conductorMotion(previous?.state,[[{x:.75,y:i%2?.25:.75}],[{x:.25,y:i%2?.75:.25}]],i*100)
  assert.equal(previous!.wave.conducting,0)
  const first=conductorMotion(undefined,[[{x:.5,y:.5}]],0)
  const sweep=conductorMotion(first.state,[[{x:.2,y:.5}]],100)
  assert.equal(sweep.wave.flourish,0)
})
