<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>群测群防巡查管理</h2>
        <p class="page-desc">维护巡查记录，围绕巡查编号、所属隐患点、巡查人、巡查日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡查记录</button>
        <button class="btn" type="button" @click="exportRows">导出群测群防巡查清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>
    <p class="policy-note">复核口径：坡面情况与排水情况都为「正常」才判「已复核」；任一项异常转「发现异常」并写明原因。状态只能 待巡查 → 已巡查 → 发现异常 → 已复核 顺向推进。</p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <RouterLink
              v-if="column === '巡查编号'"
              class="link"
              :to="`/patrol/${encodeURIComponent(String(row['巡查编号']))}`"
            >
              {{ row[column] ?? '—' }}
            </RouterLink>
            <template v-else-if="column === '复核说明'">{{ noteFor(row) || '—' }}</template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>
            {{ row.status }}
            <span v-if="row.blocked" class="tag tag-warn" :title="String(row['复核问题'] ?? '')">待更正</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!actionsFor(row).length" class="muted">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无群测群防巡查数据，可先登记巡查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条群测群防巡查记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ['巡查编号', '所属隐患点', '巡查人', '巡查日期', '坡面情况', '排水情况', '巡查结论', '复核说明']
const statuses = ['待巡查', '已巡查', '发现异常', '已复核']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['巡查编号', '所属隐患点', '巡查人']

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 统计实时读列表，不再用页面写死的 0
const stats = computed(() => {
  const monthPrefix = new Date().toISOString().slice(0, 7)
  return [
    { label: '待巡查任务', value: rows.value.filter((row) => String(row.status) === '待巡查').length },
    { label: '发现异常次数', value: rows.value.filter((row) => String(row.status) === '发现异常').length },
    {
      label: '本月巡查次数',
      value: rows.value.filter(
        (row) => String(row.status) !== '待巡查' && String(row['巡查日期']).startsWith(monthPrefix),
      ).length,
    },
  ]
})

// 复核说明只用于展示：异常写明原因，越界值写明挡回原因，与状态机里的判定一致；不落库
function noteFor(row: EntryRow): string {
  if (row.blocked) return String(row['复核问题'] ?? '巡查结论越界，待更正')
  return String(row['异常原因'] ?? '')
}

// 状态只能顺向推进，动作按当前状态给：不把回退/跳级的入口摆出来
function actionsFor(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待巡查':
      return ['提交巡查']
    case '已巡查':
      return ['上报异常', '确认复核']
    case '发现异常':
      return ['确认复核']
    default:
      return []
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡查记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '群测群防巡查列表读取失败'
  }
}

onMounted(reload)
</script>
