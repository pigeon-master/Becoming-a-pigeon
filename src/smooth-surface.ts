import * as THREE from 'three'
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js'

export function smoothUnion(a: number, b: number, radius: number) {
  const h = Math.max(radius - Math.abs(a - b), 0) / radius
  return Math.min(a, b) - h * h * radius * .25
}

export function ellipsoidDistance(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  return (Math.hypot(x / rx, y / ry, z / rz) - 1) * Math.min(rx, ry, rz)
}

// Extract one connected surface once; animation subsequently only deforms its vertices.
export function createSmoothSurface(min: THREE.Vector3, max: THREE.Vector3, distance: (x: number, y: number, z: number) => number, resolution = 48) {
  const material = new THREE.MeshBasicMaterial()
  const marching = new MarchingCubes(resolution, material, false, false, 40000)
  marching.isolation = 0
  const extent = max.clone().sub(min), center = max.clone().add(min).multiplyScalar(.5)
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    marching.field[x + y * resolution + z * resolution * resolution] = -distance(
      min.x + x / resolution * extent.x, min.y + y / resolution * extent.y, min.z + z / resolution * extent.z)
  }
  marching.update()
  const count = marching.geometry.drawRange.count
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(marching.geometry.getAttribute('position').array.slice(0, count * 3)), 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from(marching.geometry.getAttribute('normal').array.slice(0, count * 3)), 3))
  geometry.scale(extent.x / 2, extent.y / 2, extent.z / 2); geometry.translate(center.x, center.y, center.z)
  geometry.normalizeNormals()
  marching.geometry.dispose(); material.dispose()
  return geometry
}

export function bindSmoothSurface(mesh: THREE.Mesh, nodes: THREE.Object3D[], influence: (point: THREE.Vector3) => number[]) {
  const parent = mesh.parent!
  parent.updateWorldMatrix(true, true)
  const parentInverse = new THREE.Matrix4().copy(parent.matrixWorld).invert()
  const inverseBind = nodes.map(node => new THREE.Matrix4().multiplyMatrices(parentInverse, node.matrixWorld).invert())
  const position = mesh.geometry.getAttribute('position'), normal = mesh.geometry.getAttribute('normal')
  const rest = new Float32Array(position.array), restNormals = new Float32Array(normal.array)
  const point = new THREE.Vector3(), moved = new THREE.Vector3(), output = new THREE.Vector3(), n = new THREE.Vector3(), outNormal = new THREE.Vector3()
  const weights: number[][] = []
  for (let i = 0; i < position.count; i++) weights.push(influence(point.fromArray(rest, i * 3)))
  mesh.frustumCulled = false
  return () => {
    parent.updateWorldMatrix(true, true); parentInverse.copy(parent.matrixWorld).invert()
    const transforms = nodes.map((node, i) => new THREE.Matrix4().multiplyMatrices(parentInverse, node.matrixWorld).multiply(inverseBind[i]))
    const rotations = transforms.map(matrix => new THREE.Matrix3().getNormalMatrix(matrix))
    for (let i = 0; i < position.count; i++) {
      const w = weights[i], remainder = Math.max(0, 1 - w.reduce((sum, value) => sum + value, 0))
      point.fromArray(rest, i * 3); n.fromArray(restNormals, i * 3)
      output.copy(point).multiplyScalar(remainder); outNormal.copy(n).multiplyScalar(remainder)
      for (let j = 0; j < w.length; j++) if (w[j] > 0) {
        output.addScaledVector(moved.copy(point).applyMatrix4(transforms[j]), w[j])
        outNormal.addScaledVector(moved.copy(n).applyMatrix3(rotations[j]), w[j])
      }
      position.setXYZ(i, output.x, output.y, output.z)
      outNormal.normalize(); normal.setXYZ(i, outNormal.x, outNormal.y, outNormal.z)
    }
    position.needsUpdate = true; normal.needsUpdate = true
  }
}
