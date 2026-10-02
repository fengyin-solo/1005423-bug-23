import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { PATROL_ACTION_FROM, judgePatrol, resolvePatroller } from '@/data/patrol-rules'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 详情页与列表读同一份本地数据，按 id 取记录，导航进去的和列表里那条对得上。
export function getEntry(key: string, id: number): EntryRow | null {
  return listRows(key).find((row) => Number(row.id) === id) ?? null
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (key === 'patrol') {
    return runPatrolAction(rows, index, action)
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 状态只能顺着 meta.statuses 登记的路子往前推进，不许往回打。
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  if (currentIndex >= 0 && targetIndex <= currentIndex) {
    return {
      ok: false,
      message: `${meta.entity}状态只能顺着「${meta.statuses.join('→')}」推进，不能从「${current}」回到「${target}」`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 巡查记录的状态流转：待巡查 → 已巡查 → 发现异常 → 已复核，只能顺着推进；
// 确认复核按现行口径判定，同一巡查编号多复核一遍也只改原记录、不另起记录。
function runPatrolAction(rows: EntryRow[], index: number, action: string): ActionResult {
  const row = rows[index]
  const current = String(row.status)
  const allowedFrom = PATROL_ACTION_FROM[action] ?? []
  if (!allowedFrom.includes(current)) {
    return {
      ok: false,
      message: `巡查记录当前状态「${current}」，「${action}」只能对「${allowedFrom.join('」「')}」状态的记录执行，状态只能顺着「待巡查→已巡查→发现异常→已复核」推进`,
    }
  }

  if (action === '确认复核') {
    // 现行口径：坡面情况与排水情况都正常才给已复核，有异常走发现异常并写明原因。
    const verdict = judgePatrol(row)
    const updated: EntryRow = {
      ...row,
      status: verdict.status,
      pending: verdict.status !== '已复核',
      abnormal: verdict.status === '发现异常',
      巡查状态: verdict.status,
      巡查结论: verdict.conclusion,
    }
    const next = [...rows]
    next[index] = updated
    saveRows('patrol', next)
    syncThreatLedger(updated)
    return { ok: true, message: `巡查记录已按现行口径复核：${verdict.conclusion}，当前状态「${verdict.status}」` }
  }

  const target = action === '提交巡查' ? '已巡查' : '发现异常'
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: true,
    abnormal: target === '发现异常',
    巡查状态: target,
  }
  const next = [...rows]
  next[index] = updated
  saveRows('patrol', next)
  return { ok: true, message: `巡查记录已${action}，当前状态「${target}」` }
}

// 复核结果反映到受威胁对象台账：每个巡查编号对应一条待核项，重复复核只更新、不另起。
function syncThreatLedger(patrol: EntryRow): void {
  const threats = listRows('threat')
  const code = `THRE-REV-${String(patrol['巡查编号'] ?? '').trim()}`
  const base = {
    对象编号: code,
    所属隐患点: patrol['所属隐患点'],
    对象类型: '巡查复核',
    对象名称: `巡查${String(patrol['巡查编号'] ?? '')}复核结果待核`,
    涉及人数: 0,
    最近距离: '—',
    联系人: resolvePatroller(patrol),
    对象状态: '待核',
  }
  const index = threats.findIndex((row) => String(row['对象编号']) === code)
  const next = [...threats]
  if (index >= 0) {
    next[index] = { ...next[index], ...base }
  } else {
    const id = Math.max(0, ...threats.map((row) => Number(row.id))) + 1
    next.push({
      id,
      status: '待登记',
      pending: true,
      abnormal: String(patrol.status) === '发现异常',
      ...base,
    })
  }
  saveRows('threat', next)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
