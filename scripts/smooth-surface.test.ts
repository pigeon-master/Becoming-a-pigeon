import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { bindSmoothSurface } from '../src/smooth-surface.ts'

test('surface deformation preserves fixed vertices and skips unchanged poses',()=>{
  const parent=new THREE.Group(),node=new THREE.Group()
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial())
  parent.add(mesh,node)
  const positions=mesh.geometry.getAttribute('position'),normals=mesh.geometry.getAttribute('normal')
  const rest=Array.from(positions.array)
  const deform=bindSmoothSurface(mesh,[node],p=>[p.x>0?1:0])
  node.rotation.z=.5;deform()
  const version=positions.version
  for(let i=0;i<positions.count;i++){
    if(rest[i*3]<=0)assert.deepEqual(Array.from(positions.array).slice(i*3,i*3+3),rest.slice(i*3,i*3+3))
    else assert.ok(Math.abs(positions.getX(i)-rest[i*3])>.1)
    assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(normals,i).length()-1)<1e-6)
  }
  deform();assert.equal(positions.version,version)
  node.rotation.z=.9;deform();assert.ok(positions.version>version)
  mesh.geometry.dispose();(mesh.material as THREE.Material).dispose()
})
