import {readFile,writeFile} from 'node:fs/promises'
import {inflateSync,deflateSync} from 'node:zlib'
import assert from 'node:assert/strict'

// Recompress IDAT only: preserve every pixel/filter byte and all colour metadata.
const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0})
const crc=data=>{let c=0xffffffff;for(const byte of data)c=table[(c^byte)&255]^(c>>>8);return(c^0xffffffff)>>>0}
const signature=Buffer.from([137,80,78,71,13,10,26,10])
let beforeTotal=0,afterTotal=0
for(const file of ['human-photo-atlas.png','chihuahua-photo-atlas.png','compact-car-atlas.png','wizard-photo-atlas.png','car-rear-lettering.png']){
 const path='public/models/'+file,input=await readFile(path);assert.ok(input.subarray(0,8).equals(signature))
 const chunks=[];for(let offset=8;offset<input.length;){const size=input.readUInt32BE(offset),end=offset+size+12;assert.ok(end<=input.length);const bytes=input.subarray(offset,end),type=bytes.toString('ascii',4,8);assert.equal(bytes.readUInt32BE(size+8),crc(bytes.subarray(4,size+8)));chunks.push({bytes,type,data:bytes.subarray(8,size+8)});offset=end}
 assert.ok(!chunks.some(chunk=>chunk.type==='acTL'),'Animated PNG is outside this optimizer scope')
 const original=Buffer.concat(chunks.filter(c=>c.type==='IDAT').map(c=>c.data)),raw=inflateSync(original),compressed=deflateSync(raw,{level:9})
 assert.ok(inflateSync(compressed).equals(raw),'Pixel and filter bytes must remain identical')
 const idat=Buffer.alloc(compressed.length+12);idat.writeUInt32BE(compressed.length);idat.write('IDAT',4,'ascii');compressed.copy(idat,8);idat.writeUInt32BE(crc(idat.subarray(4,compressed.length+8)),compressed.length+8)
 let inserted=false;const output=Buffer.concat([signature,...chunks.flatMap(chunk=>chunk.type!=='IDAT'?[chunk.bytes]:inserted?[]:(inserted=true,[idat]))])
 const result=output.length<input.length?output:input;if(result!==input)await writeFile(path,result)
 beforeTotal+=input.length;afterTotal+=result.length;console.log(`${file}: ${input.length} -> ${result.length} bytes; decoded pixels and metadata unchanged`)
}
console.log(JSON.stringify({beforeBytes:beforeTotal,afterBytes:afterTotal,savedBytes:beforeTotal-afterTotal}))
