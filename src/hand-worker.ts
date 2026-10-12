// A classic worker keeps MediaPipe's synchronous inference away from the 3D/UI thread.
interface HandTask { detectForVideo(image:ImageBitmap,time:number):{landmarks:{x:number;y:number;z:number}[][];handedness?:{categoryName:string;score:number}[][]};close():void }
const scope=self as unknown as {importScripts(...urls:string[]):void;postMessage(message:unknown):void;onmessage:((event:MessageEvent)=>void)|null;Vision:{FilesetResolver:{forVisionTasks(path:string):Promise<unknown>};HandLandmarker:{createFromOptions(files:unknown,options:unknown):Promise<HandTask>}}}
let task:HandTask|undefined
scope.onmessage=async event=>{
  const data=event.data
  try{
    if(data.type==='init'){
      scope.importScripts(new URL('models/vision_bundle.js',data.base).href)
      const files=await scope.Vision.FilesetResolver.forVisionTasks(new URL('models/wasm',data.base).href)
      task=await scope.Vision.HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('models/hand_landmarker.task',data.base).href,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.4,minHandPresenceConfidence:.4,minTrackingConfidence:.4})
      scope.postMessage({type:'ready'})
    }else if(data.type==='frame'){
      const start=performance.now()
      try{const result=task!.detectForVideo(data.bitmap,data.time);scope.postMessage({type:'result',landmarks:result.landmarks,handedness:result.handedness,cost:performance.now()-start,time:data.time})}finally{data.bitmap.close()}
    }
  }catch(error){scope.postMessage({type:'error',message:error instanceof Error?error.message:String(error)})}
}
