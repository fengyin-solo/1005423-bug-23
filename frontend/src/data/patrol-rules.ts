import type { EntryRow } from './types'

// 群测群防巡查的复核口径集中在这里：判定、结论词表、状态推进、存量重判都走这一套，
// 列表页、详情页、台账联动读到的规则保证是同一套。

export const PATROL_STATUSES = ['待巡查', '已巡查', '发现异常', '已复核'] as const

// 状态只能顺着「待巡查 → 已巡查 → 发现异常 → 已复核」推进，每个动作允许的来源状态：
export const PATROL_ACTION_FROM: Record<string, readonly string[]> = {
  提交巡查: ['待巡查'],
  上报异常: ['已巡查'],
  确认复核: ['已巡查', '发现异常'],
}

export type PatrolVerdict = {
  status: '已复核' | '发现异常'
  conclusion: string
  reasons: string[]
}

// 现行口径：坡面情况与排水情况都正常才给「已复核」；任一项异常走「发现异常」并写明原因。
export function judgePatrol(row: EntryRow): PatrolVerdict {
  const slope = String(row['坡面情况'] ?? '').trim()
  const drainage = String(row['排水情况'] ?? '').trim()
  const reasons: string[] = []
  if (!isNormalSituation(slope)) {
    reasons.push(`坡面情况「${slope || '未填写'}」`)
  }
  if (!isNormalSituation(drainage)) {
    reasons.push(`排水情况「${drainage || '未填写'}」`)
  }
  if (reasons.length === 0) {
    return { status: '已复核', conclusion: '正常', reasons }
  }
  return { status: '发现异常', conclusion: `异常：${reasons.join('；')}`, reasons }
}

export function isNormalSituation(value: string): boolean {
  return value.trim() === '正常'
}

// 巡查结论的合法词表：正常 / 异常 / 复核生成的「异常：原因」。越界值（如「优」「合格」）挡回。
export function isConclusionInRange(value: string): boolean {
  const text = value.trim()
  return text === '正常' || text === '异常' || text.startsWith('异常：')
}

// 巡查结论与巡查人撞在一起时的优先级：「巡查人」字段是唯一权威来源，
// 巡查结论只承载结论、永不当作人名来源；字段为空记「未登记」，不去结论里猜。
export function resolvePatroller(row: EntryRow): string {
  const name = String(row['巡查人'] ?? '').trim()
  return name !== '' ? name : '未登记'
}

export type PatrolMigration = {
  rows: EntryRow[]
  deduped: number
  rejudged: number
  bounced: number
}

// 存量记录按现行口径重判一遍：
// 1. 同一巡查编号只留一条（留状态推进最远的，并列取巡查日期新的），重复记录合并掉；
// 2. 已复核 / 发现异常的存量记录按坡面+排水重判；
// 3. 巡查结论越界的那几条挑出来挡回「已巡查」，写明原因，等重新复核。
export function migratePatrolRows(rows: EntryRow[]): PatrolMigration {
  const byCode = new Map<string, EntryRow>()
  let deduped = 0
  for (const row of rows) {
    const code = String(row['巡查编号'] ?? '').trim()
    const key = code !== '' ? code : `__id_${row.id}`
    const kept = byCode.get(key)
    if (!kept || patrolRank(row) >= patrolRank(kept)) {
      if (kept) deduped += 1
      byCode.set(key, row)
    } else {
      deduped += 1
    }
  }

  let rejudged = 0
  let bounced = 0
  const migrated = [...byCode.values()].map((row) => {
    const status = String(row.status)
    if (status !== '已复核' && status !== '发现异常') {
      return row
    }
    const conclusion = String(row['巡查结论'] ?? '')
    if (!isConclusionInRange(conclusion)) {
      bounced += 1
      return {
        ...row,
        status: '已巡查',
        pending: true,
        abnormal: false,
        巡查状态: '已巡查',
        巡查结论: `原巡查结论「${conclusion || '空'}」越界，已挡回待复核`,
      }
    }
    const verdict = judgePatrol(row)
    rejudged += 1
    return {
      ...row,
      status: verdict.status,
      pending: verdict.status !== '已复核',
      abnormal: verdict.status === '发现异常',
      巡查状态: verdict.status,
      巡查结论: verdict.conclusion,
    }
  })

  migrated.sort((a, b) => Number(a.id) - Number(b.id))
  return { rows: migrated, deduped, rejudged, bounced }
}

function patrolRank(row: EntryRow): number {
  const statusIndex = PATROL_STATUSES.indexOf(String(row.status) as (typeof PATROL_STATUSES)[number])
  const date = String(row['巡查日期'] ?? '')
  return statusIndex * 100000 + (Number(date.replace(/-/g, '')) || 0)
}
