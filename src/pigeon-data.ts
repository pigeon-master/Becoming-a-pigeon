export interface FaceAsset {
  positions: number[]
  uv: number[]
  photoWeights: number[]
  indices: number[]
  image: string
}
export interface PigeonRecord { id: string; createdAt: number; replaces: string | null; message: string; automatic?: number[] }
export interface PigeonOwner { id: string; token: string }
export interface FlockSnapshot { revision: number; birds: PigeonRecord[] }
