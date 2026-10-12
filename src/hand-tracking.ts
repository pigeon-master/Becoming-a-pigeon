export interface HandPose {x:number;y:number;strength:number;depth?:number}
export interface HandWave extends HandPose {arms?:{left:HandPose;right:HandPose};conducting?:number;handCount?:number;flourish?:number;scatter?:number}
interface Palm {x:number;y:number;time:number;size?:number;baseline?:number;aimX?:number;aimY?:number;wave?:HandPose}
export interface ConductorState {left?:Palm;right?:Palm;energy:number;time:number;leftActivity?:number;rightActivity?:number;lastBoth?:number;dualSince?:number;soloEnergy?:number;soloSide?:'left'|'right'}
const palmPosition=(landmarks:{x:number;y:number}[])=>{
  if(landmarks.length<21)return landmarks[9]??landmarks[0]
  let x=0,y=0;for(const i of [0,5,9,13,17]){x+=landmarks[i].x;y+=landmarks[i].y}
  return{x:x/5,y:y/5}
}
export function handMotion(previous:Palm|undefined,landmarks:{x:number;y:number}[]|null,time:number,aspect=4/3):{previous:Palm|undefined;wave:HandPose}{
  if(!landmarks?.length){
    if(previous?.wave&&time-previous.time<220)return{previous,wave:{...previous.wave,strength:Math.exp(-(time-previous.time)/300)}}
    return{previous:undefined,wave:{x:0,y:0,strength:0}}
  }
  const palm=palmPosition(landmarks),blend=previous&&time-previous.time<1200?1-Math.exp(-Math.max(1,time-previous.time)/70):1
  const measured=landmarks.length>17?Math.max(Math.hypot((landmarks[5].x-landmarks[17].x)*aspect,landmarks[5].y-landmarks[17].y),Math.hypot((landmarks[0].x-landmarks[9].x)*aspect,landmarks[0].y-landmarks[9].y)):undefined
  const size=measured===undefined?previous?.size:(previous?.size??measured)*(1-blend)+measured*blend,baseline=previous?.baseline??size
  const next:Palm={x:(previous?.x??1-palm.x)*(1-blend)+(1-palm.x)*blend,y:(previous?.y??1-palm.y)*(1-blend)+(1-palm.y)*blend,time,size,baseline}
  const axis=(position:number)=>{const value=Math.max(-1,Math.min(1,(position-.5)/.35));return Math.abs(value)<.08?0:value}
  // Hold the arm at the visible hand position, even when the user stops moving.
  const wave:HandPose={x:axis(next.x),y:axis(next.y),strength:1}
  if(landmarks.length>=21){
    let dx=0,dy=0,count=0
    const wrist=landmarks[0]
    for(const [base,joint,tip]of [[5,6,8],[9,10,12],[13,14,16],[17,18,20]]){
      const a=landmarks[base],b=landmarks[joint],c=landmarks[tip]
      const ux=(b.x-a.x)*aspect,uy=b.y-a.y,vx=(c.x-b.x)*aspect,vy=c.y-b.y
      const dot=(ux*vx+uy*vy)/Math.max(.00001,Math.hypot(ux,uy)*Math.hypot(vx,vy))
      const reach=Math.hypot((c.x-wrist.x)*aspect,c.y-wrist.y),bend=Math.hypot((b.x-wrist.x)*aspect,b.y-wrist.y)
      if(dot<.55||reach<bend*1.12)continue
      const x=(a.x-c.x)*aspect,y=a.y-c.y,length=Math.hypot(x,y)
      if(length<.025)continue
      dx+=x/length;dy+=y/length;count++
    }
    const length=Math.hypot(dx,dy)
    if(count&&length>.01){
      const weight=count<=2?.7:.12
      next.aimX=(previous?.aimX??dx/length)*(1-blend)+dx/length*blend
      next.aimY=(previous?.aimY??dy/length)*(1-blend)+dy/length*blend
      wave.x=Math.max(-1,Math.min(1,wave.x*(1-weight)+next.aimX*weight))
      wave.y=Math.max(-1,Math.min(1,wave.y*(1-weight)+next.aimY*weight))
    }
  }
  if(size!==undefined&&baseline&&baseline>.005)wave.depth=Math.max(-1,Math.min(1,(size/baseline-1)/.7))
  next.wave={...wave}
  return{previous:next,wave}
}
export function conductorMotion(state:ConductorState|undefined,hands:{x:number;y:number}[][],time:number,aspect=4/3,handedness?:{categoryName:string;score:number}[][]){
  const candidates=hands.map((hand,i)=>({hand,label:handedness?.[i]?.[0]})).filter(item=>item.hand.length).slice(0,2)
  if(candidates.length===2){
    const a=palmPosition(candidates[0].hand),b=palmPosition(candidates[1].hand)
    const labels=candidates.map(item=>item.label),knownPair=labels.every(label=>label&&(label.score??0)>=.65)&&labels[0]!.categoryName!==labels[1]!.categoryName
    const duplicate=(!knownPair&&Math.hypot((a.x-b.x)*aspect,a.y-b.y)<.055)||!!(labels[0]&&labels[1]&&labels[0].categoryName===labels[1].categoryName)
    if(duplicate)candidates.splice((candidates[1].label?.score??0)>(candidates[0].label?.score??0)?0:1,1)
  }
  const identified=candidates.length===2&&candidates.some(item=>item.label?.categoryName==='Left')&&candidates.some(item=>item.label?.categoryName==='Right')
  const ordered=identified?['Left','Right'].map(label=>candidates.find(item=>item.label?.categoryName===label)!.hand):candidates.map(item=>item.hand).sort((a,b)=>palmPosition(b).x-palmPosition(a).x)
  const speed=(previous:Palm|undefined,next:Palm|undefined)=>previous&&next&&time-previous.time<1000?Math.hypot(next.x-previous.x,next.y-previous.y)/Math.max(.05,(time-previous.time)/1000):0
  const dt=state?Math.min(.65,Math.max(.05,(time-state.time)/1000)):.1
  if(ordered.length<2){
    const palm=ordered.length?palmPosition(ordered[0]):undefined
    const label=candidates[0]?.label?.categoryName
    const side=label==='Left'?'left':label==='Right'?'right':state?.soloSide??(palm&&state?.right&&Math.abs(1-palm.x-state.right.x)<Math.abs(1-palm.x-(state.left?.x??-10))?'right':palm&&1-palm.x>=.5?'right':'left')
    const previous=state?.[side]
    const single=handMotion(previous,ordered[0]??null,time,aspect),rate=speed(previous,single.previous)
    const soloEnergy=ordered.length?Math.max(0,Math.min(1,(state?.soloEnergy??0)+(rate>.5?dt*3:-dt*1.8))):0
    const rest:HandPose={x:0,y:-1,strength:0}
    const arms=side==='left'?{left:single.wave,right:rest}:{left:rest,right:single.wave}
    return{state:{[side]:single.previous,energy:0,time,soloEnergy,soloSide:side} as ConductorState,wave:{...single.wave,arms,conducting:0,handCount:ordered.length,flourish:soloEnergy>.55?soloEnergy:0,scatter:Math.min(1,rate/1.5)} as HandWave}
  }
  const left=handMotion(state?.left,ordered[0],time,aspect),right=handMotion(state?.right,ordered[1],time,aspect)
  const leftRate=speed(state?.left,left.previous),rightRate=speed(state?.right,right.previous)
  const leftActivity=leftRate>.1?1:(state?.leftActivity??0)*Math.exp(-dt*3.2)
  const rightActivity=rightRate>.1?1:(state?.rightActivity??0)*Math.exp(-dt*3.2)
  const dualSince=state?.right?(state.dualSince??time):time
  const moving=time-dualSince>=300&&leftActivity>.22&&rightActivity>.22
  const energy=Math.max(0,Math.min(1,(state?.energy??0)+(moving?dt*3.5:-dt*1.5)))
  const wave:HandWave={x:(left.wave.x+right.wave.x)/2,y:(left.wave.y+right.wave.y)/2,strength:1,depth:Math.max(left.wave.depth??0,right.wave.depth??0),arms:{left:left.wave,right:right.wave},conducting:energy,handCount:2,flourish:0,scatter:Math.min(1,Math.max((leftRate+rightRate)/2,Math.hypot(left.wave.x-right.wave.x,left.wave.y-right.wave.y)*.35))}
  return{state:{left:left.previous,right:right.previous,energy,time,leftActivity,rightActivity,lastBoth:time,dualSince},wave}
}
export async function startHandTracking(video:HTMLVideoElement,onWave:(wave:HandWave)=>void,onError:(error:Error)=>void,signal?:AbortSignal){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('카메라는 HTTPS 환경의 지원 브라우저에서 사용할 수 있어요.')
  let stopped=false,busy=false,timer:ReturnType<typeof setTimeout>|undefined,conductor:ConductorState|undefined,interval=83,frameStarted=0,lastVideoTime=-1,inferenceCost=0
  const worker=new Worker(new URL('./hand-worker.ts',import.meta.url))
  let stream:MediaStream|undefined
  let deadline:ReturnType<typeof setTimeout>|undefined,rejectReady:(error:Error)=>void=()=>{}
  const stop=()=>{stopped=true;clearTimeout(timer);clearTimeout(deadline);worker.terminate();stream?.getTracks().forEach(track=>track.stop());video.srcObject=null;document.removeEventListener('visibilitychange',visibility);signal?.removeEventListener('abort',abort);rejectReady(new DOMException('손 추적이 종료됐어요.','AbortError'))}
  const abort=()=>stop()
  const visibility=()=>{if(document.hidden){stop();onError(new Error('화면을 벗어나 카메라를 껐어요.'))}}
  const ready=new Promise<void>((resolve,reject)=>{
    rejectReady=reject
    worker.onerror=()=>{clearTimeout(deadline);reject(new Error('이 브라우저에서 손 추적을 실행할 수 없어요.'));if(!stopped)onError(new Error('손 추적을 중단했어요.'))}
    worker.onmessage=event=>{
      const data=event.data
      if(data.type==='ready'){clearTimeout(deadline);resolve()}
      else if(data.type==='error'){clearTimeout(deadline);const error=new Error(data.message);reject(error);if(!stopped)onError(error)}
      else if(data.type==='result'){
        busy=false;const result=conductorMotion(conductor,data.landmarks??[],data.time??performance.now(),video.videoWidth/video.videoHeight||4/3,data.handedness);conductor=result.state;onWave(result.wave)
        inferenceCost=inferenceCost?inferenceCost*.7+data.cost*.3:data.cost
        interval=Math.min(400,Math.max(83,inferenceCost*1.5));schedule(Math.max(8,interval-(performance.now()-frameStarted)))
      }
    }
  })
  void ready.catch(()=>{})
  signal?.addEventListener('abort',abort,{once:true})
  const frame=async()=>{
    if(stopped||busy)return
    if(video.readyState<2||video.currentTime===lastVideoTime){schedule(16);return}
    lastVideoTime=video.currentTime;frameStarted=performance.now()
    busy=true
    try{const width=inferenceCost>65?320:480,height=width*.75,scale=Math.min(width/video.videoWidth,height/video.videoHeight);const bitmap=await createImageBitmap(video,{resizeWidth:Math.max(1,Math.round(video.videoWidth*scale)),resizeHeight:Math.max(1,Math.round(video.videoHeight*scale))});if(stopped){bitmap.close();return}worker.postMessage({type:'frame',bitmap,time:frameStarted},[bitmap])}catch(error){stop();onError(error instanceof Error?error:new Error(String(error)))}
  }
  const schedule=(delay=interval)=>{if(!stopped)timer=setTimeout(frame,delay)}
  try{
    // Ask camera permission immediately from the icon interaction; no video is uploaded.
    if(signal?.aborted)throw new DOMException('종료됐어요.','AbortError')
    const camera=navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:360},aspectRatio:{ideal:16/9},frameRate:{ideal:24,max:24}},audio:false}).then(camera=>{if(stopped||signal?.aborted){camera.getTracks().forEach(track=>track.stop());throw new DOMException('종료됐어요.','AbortError')}return camera})
    stream=await Promise.race([camera,ready.then(()=>{throw new Error('잘못된 카메라 준비 상태예요.')})])
    document.addEventListener('visibilitychange',visibility)
    video.srcObject=stream;video.muted=true;await video.play()
    deadline=setTimeout(()=>rejectReady(new Error('손 추적 모델을 준비하지 못했어요. 다시 시도해 주세요.')),25000)
    worker.postMessage({type:'init',base:new URL(import.meta.env.BASE_URL,location.href).href});await ready
    if(stopped)throw new Error('손 추적이 종료됐어요.')
    schedule();return{stop}
  }catch(error){stop();void ready.catch(()=>{});throw error}
}
