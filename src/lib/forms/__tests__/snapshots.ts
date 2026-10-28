import path from 'node:path'
import type { FormCode, FormData } from '../types'
import { SAMPLE_509, SAMPLE_PARTA, SAMPLE_PARTB } from './fixtures/samples'

/** Where the approved renders of the synthetic samples live, and how they are drawn. */

export const SNAPSHOT_DIR = path.join(__dirname, 'snapshots')
export const SNAPSHOT_SCALE = 1

export const SAMPLES: [string, FormCode, FormData][] = [
  ['form509', '509', SAMPLE_509],
  ['form507-parta', '507a', SAMPLE_PARTA],
  ['form507-partb', '507b', SAMPLE_PARTB],
]

export function snapshotFile(name: string, page: number): string {
  return path.join(SNAPSHOT_DIR, `${name}-p${String(page).padStart(2, '0')}.png`)
}
