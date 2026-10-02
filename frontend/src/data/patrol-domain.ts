/**
 * 群测群防巡查的业务规则（纯函数，不碰 localStorage）。
 *
 * 现行复核口径：坡面情况、排水情况都为「正常」才给「已复核」；
 * 任一项异常一律走「发现异常」，并在异常原因里写明原因。
 *
 * 状态只能顺向推进：待巡查 → 已巡查 → 发现异常 → 已复核，
 * 不允许跳级、不允许回退（打回待巡查的老口径已废止）。
 */
import type { EntryRow } from './types'

export const PATROL_KEY = 'patrol'
export const THREAT_KEY = 'threat'

export const PATROL_STATUSES = ['待巡查', '已巡查', '发现异常', '已复核'] as const

/** 坡面情况 / 排水情况的合法取值 */
export const FINDING_NORMAL = '正常'
export const FINDING_ABNORMAL = '异常'
export const FINDING_VALUES = [FINDING_NORMAL, FINDING_ABNORMAL]

/** 巡查结论允许的取值集：不在这个集合里的就是越界值，复核时挡回 */
export const CONCLUSION_VALUES = ['正常', '坡面异常', '排水异常', '坡面与排水均异常']

export function statusIndex(status: string): number {
  return PATROL_STATUSES.indexOf(status as (typeof PATROL_STATUSES)[number])
}

export function isFindingValid(value: unknown): boolean {
  return FINDING_VALUES.includes(String(value ?? ''))
}

/** 按现行口径判定一条巡查记录的结论性信息（只看坡面、排水两项事实）。 */
export function judgeRow(row: EntryRow): {
  status: '发现异常' | '已复核'
  conclusion: string
  abnormal: boolean
  reason: string
} {
  const slopeBad = String(row['坡面情况'] ?? '') === FINDING_ABNORMAL
  const drainBad = String(row['排水情况'] ?? '') === FINDING_ABNORMAL
  if (!slopeBad && !drainBad) {
    return { status: '已复核', conclusion: FINDING_NORMAL, abnormal: false, reason: '' }
  }
  const parts: string[] = []
  if (slopeBad) parts.push('坡面情况异常')
  if (drainBad) parts.push('排水情况异常')
  const conclusion = slopeBad && drainBad ? '坡面与排水均异常' : slopeBad ? '坡面异常' : '排水异常'
  return {
    status: '发现异常',
    conclusion,
    abnormal: true,
    reason: parts.join('，'),
  }
}

/** 越界校验：坡面/排水不是正常、异常，或巡查结论不在允许取值集里，复核一律挡回。 */
export function patrolViolation(row: EntryRow): string {
  if (!isFindingValid(row['坡面情况'])) {
    return `坡面情况「${String(row['坡面情况'] ?? '')}」不是正常/异常的合法取值`
  }
  if (!isFindingValid(row['排水情况'])) {
    return `排水情况「${String(row['排水情况'] ?? '')}」不是正常/异常的合法取值`
  }
  if (!CONCLUSION_VALUES.includes(String(row['巡查结论'] ?? ''))) {
    return `巡查结论「${String(row['巡查结论'] ?? '')}」越界，允许取值：${CONCLUSION_VALUES.join('、')}`
  }
  return ''
}

/**
 * 同一巡查编号只认一份记录：状态走得更远者为准；状态相同时以编号（id）更大、
 * 即更晚登记的那份为准。巡查人随主记录取，保证列表、详情两条读取路径读到的是同一套。
 * 巡查结论不参与合并选择——结论按现行口径重判，旧结论不再算数。
 */
export function canonicalPatrolRows(rows: EntryRow[]): EntryRow[] {
  const byCode = new Map<string, EntryRow>()
  for (const row of rows) {
    const code = String(row['巡查编号'] ?? '')
    const existing = code ? byCode.get(code) : undefined
    if (!existing) {
      byCode.set(code, row)
      continue
    }
    const existingRank = statusIndex(String(existing.status))
    const rowRank = statusIndex(String(row.status))
    const takeNew =
      rowRank > existingRank ||
      (rowRank === existingRank && Number(row.id) > Number(existing.id))
    if (takeNew) byCode.set(code, row)
  }
  return [...byCode.values()]
}

/**
 * 存量记录按新标准重判：
 * - 先按巡查编号合并（重复复核不另起记录，顺手修掉同一份记录重复显示）；
 * - 还没巡查（待巡查）的不动；
 * - 已巡查之后的记录，坡面/排水/结论有越界值的挡回，留在原状态并挂复核问题，等人工更正；
 * - 其余已巡查记录一律按现行口径重判：都正常给已复核，有异常退到发现异常并写明原因
 *   （旧口径误判成已复核的，按事实纠正，不算状态回退，而是口径订正）。
 */
export function migratePatrolRows(rows: EntryRow[]): { rows: EntryRow[]; changed: boolean } {
  const merged = canonicalPatrolRows(rows)
  const next = merged.map((row) => {
    const status = String(row.status)
    if (status === '待巡查') {
      return { ...row, pending: true, abnormal: false, blocked: false }
    }
    const violation = patrolViolation(row)
    if (violation) {
      return {
        ...row,
        blocked: true,
        复核问题: violation,
        abnormal: status === '发现异常',
      }
    }
    const verdict = judgeRow(row)
    const fixed: EntryRow = {
      ...row,
      status: verdict.status,
      pending: verdict.status !== '已复核',
      abnormal: verdict.abnormal,
      blocked: false,
      巡查结论: verdict.conclusion,
      异常原因: verdict.reason,
    }
    delete (fixed as Record<string, unknown>)['复核问题']
    return fixed
  })
  // 按内容判变化（而非对象引用）：重复迁移且内容一致时不产生 changed
  const changed =
    next.length !== rows.length ||
    next.some((row, index) => JSON.stringify(row) !== JSON.stringify(rows[index]))
  return { rows: next, changed }
}

/** 复核出异常时，给受威胁对象台账补一条「待核项」；同一隐患点只补一条（幂等）。 */
function pendingThreatCode(hazard: string): string {
  return `待核-${hazard}`
}

export function syncThreatPending(patrolRows: EntryRow[], threatRows: EntryRow[]): EntryRow[] {
  const hazards = new Set(
    patrolRows
      .filter((row) => String(row.status) === '发现异常' && !row.blocked)
      .map((row) => String(row['所属隐患点'] ?? '').trim())
      .filter(Boolean),
  )
  if (hazards.size === 0) return threatRows

  const next = [...threatRows]
  let added = false
  for (const hazard of hazards) {
    const code = pendingThreatCode(hazard)
    const exists = next.some(
      (row) => String(row['对象编号']) === code && String(row['所属隐患点']) === hazard,
    )
    if (exists) continue
    const id = next.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    next.push({
      id,
      status: '待登记',
      pending: true,
      abnormal: false,
      对象编号: code,
      所属隐患点: hazard,
      对象类型: '巡查待核项',
      对象名称: `${hazard} 巡查发现异常待核`,
      涉及人数: '',
      最近距离: '',
      联系人: '',
      对象状态: '待登记',
    })
    added = true
  }
  return added ? next : threatRows
}

export type PatrolAction = '提交巡查' | '上报异常' | '确认复核'

/** 巡查动作的结果：挡回（不合法）/ 幂等（已是目标态）/ 通过并给出更新后的行。 */
export type PatrolActionResult =
  | { ok: false; message: string }
  | { ok: true; idempotent: boolean; message: string; row?: EntryRow }

const REQUIRED_STATUS: Record<PatrolAction, (typeof PATROL_STATUSES)[number]> = {
  提交巡查: '待巡查',
  上报异常: '已巡查',
  确认复核: '已巡查',
}

/**
 * 执行巡查动作。状态只能顺着「待巡查 → 已巡查 → 发现异常 → 已复核」推进，
 * 不允许跳级、不允许回退；确认复核按现行口径判定，越界值挡回。
 */
export function applyPatrolAction(action: PatrolAction, row: EntryRow): PatrolActionResult {
  const current = String(row.status)
  const required = REQUIRED_STATUS[action]

  if (action === '确认复核') {
    // 同一巡查编号复核多遍：不另起记录，也不重复处理
    if (current === '已复核') {
      return { ok: true, idempotent: true, message: '该巡查记录已复核，无需重复复核' }
    }
    if (current !== '已巡查' && current !== '发现异常') {
      return {
        ok: false,
        message: `巡查记录当前为「${current}」，状态只能顺向推进，不能直接确认复核`,
      }
    }
    if (row.blocked) {
      return { ok: false, message: `巡查结论存在越界值，已挡回：${String(row['复核问题'] ?? '')}` }
    }
    const violation = patrolViolation(row)
    if (violation) {
      return { ok: false, message: `巡查结论给出越界值，已挡回：${violation}` }
    }
    const verdict = judgeRow(row)
    const fixed: EntryRow = {
      ...row,
      status: verdict.status,
      pending: verdict.status !== '已复核',
      abnormal: verdict.abnormal,
      blocked: false,
      巡查结论: verdict.conclusion,
      异常原因: verdict.reason,
    }
    delete fixed['复核问题']
    if (verdict.status === '发现异常') {
      return {
        ok: true,
        idempotent: current === '发现异常',
        message: `按现行口径复核：${verdict.reason}，转「发现异常」并已在受威胁对象台账登记待核项`,
        row: fixed,
      }
    }
    return {
      ok: true,
      idempotent: false,
      message: '坡面情况与排水情况均正常，复核通过，状态为「已复核」',
      row: fixed,
    }
  }

  if (action === '上报异常') {
    if (current === '发现异常') {
      return { ok: true, idempotent: true, message: '该巡查记录已是「发现异常」，无需重复上报' }
    }
    if (current !== '已巡查') {
      return {
        ok: false,
        message: `巡查记录当前为「${current}」，只有「已巡查」才能上报异常`,
      }
    }
    const slopeBad = String(row['坡面情况']) === FINDING_ABNORMAL
    const drainBad = String(row['排水情况']) === FINDING_ABNORMAL
    // 现场显式上报异常：把两项事实补齐为异常，保证后续按现行口径复核时结论合法
    const parts: string[] = []
    if (!slopeBad) parts.push('坡面情况异常')
    if (!drainBad) parts.push('排水情况异常')
    const fixed: EntryRow = {
      ...row,
      status: '发现异常',
      pending: true,
      abnormal: true,
      坡面情况: FINDING_ABNORMAL,
      排水情况: FINDING_ABNORMAL,
      巡查结论: '坡面与排水均异常',
      异常原因: parts.join('，') || '坡面情况异常，排水情况异常',
    }
    return {
      ok: true,
      idempotent: false,
      message: '已转「发现异常」，受威胁对象台账将登记一条待核项',
      row: fixed,
    }
  }

  // 提交巡查：只负责 待巡查 → 已巡查；坡面/排水/结论的越界值留到复核环节挡回
  if (current === required) {
    const fixed: EntryRow = {
      ...row,
      status: '已巡查',
      pending: true,
      abnormal: false,
    }
    return { ok: true, idempotent: false, message: '巡查已提交，状态为「已巡查」', row: fixed }
  }
  if (statusIndex(current) > statusIndex(required)) {
    return { ok: true, idempotent: true, message: `巡查记录已是「${current}」，无需重复提交` }
  }
  return { ok: false, message: `巡查记录当前为「${current}」，不能执行「${action}」` }
}
