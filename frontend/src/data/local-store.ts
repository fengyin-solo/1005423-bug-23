import { migratePatrolRows, PATROL_KEY, syncThreatPending, THREAT_KEY } from './patrol-domain'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-patrol:entries'
// 巡查口径版本：口径改了就抬版本号，存量数据加载时按新口径重判一遍。
const SCHEMA_KEY = 'geohazard-patrol:schema-version'
const PATROL_SCHEMA_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 存量迁移：巡查记录去重 + 按新标准重判，并把「发现异常」反映到
 * 受威胁对象台账（每个隐患点补一条待核项）。仅在口径版本升级时执行一次。
 */
function migrate(data: Record<string, EntryRow[]>): {
  data: Record<string, EntryRow[]>
  changed: boolean
} {
  const patrolMigration = migratePatrolRows(data[PATROL_KEY] ?? [])
  const threats = data[THREAT_KEY] ?? []
  const nextThreats = syncThreatPending(patrolMigration.rows, threats)
  const changed = patrolMigration.changed || nextThreats.length !== threats.length
  if (!changed) return { data, changed: false }
  return {
    data: {
      ...data,
      [PATROL_KEY]: patrolMigration.rows,
      [THREAT_KEY]: nextThreats,
    },
    changed: true,
  }
}

/**
 * 日常保存时的对齐：只把当前「发现异常」同步成台账待核项（幂等），
 * 不重判状态——用户显式上报的异常以操作为准，不能被字段重新覆盖掉。
 */
function reconcileThreats(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const threats = data[THREAT_KEY] ?? []
  const nextThreats = syncThreatPending(data[PATROL_KEY] ?? [], threats)
  if (nextThreats === threats) return data
  return { ...data, [THREAT_KEY]: nextThreats }
}

function readStoredVersion(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0
  return Number(window.localStorage.getItem(SCHEMA_KEY) ?? 0)
}

function persist(data: Record<string, EntryRow[]>): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  window.localStorage.setItem(SCHEMA_KEY, String(PATROL_SCHEMA_VERSION))
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return migrate(fallback).data
  }
  let parsed: Record<string, EntryRow[]>
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = migrate(fallback).data
    persist(seeded)
    return seeded
  }
  try {
    parsed = { ...clone(SEED_ROWS), ...(JSON.parse(raw) as Record<string, EntryRow[]>) }
  } catch {
    const seeded = migrate(fallback).data
    persist(seeded)
    return seeded
  }
  // 口径升级（或老数据没有版本标记）时，存量记录按新标准重判一遍并落库
  const result = readStoredVersion() < PATROL_SCHEMA_VERSION ? migrate(parsed) : { data: parsed, changed: false }
  if (result.changed) persist(result.data)
  return result.data
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  let next = { ...allRows(), [key]: rows }
  // 巡查或台账任一边落库，都重新对齐一遍，避免两边口径漂移
  if (key === PATROL_KEY || key === THREAT_KEY) {
    next = reconcileThreats(next)
  }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
