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
            {{ column === '巡查人' ? resolvePatroller(row) : row[column] || '—' }}
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDetail(row)">详情</button>
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
import { useRouter } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { PATROL_ACTION_FROM, resolvePatroller } from '@/data/patrol-rules'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡查编号", "所属隐患点", "巡查人", "巡查日期", "坡面情况", "排水情况", "巡查结论", "巡查状态"]
const statuses = ["待巡查", "已巡查", "发现异常", "已复核"]

const router = useRouter()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 面板统计跟列表读同一份数据，不再是写死的数字。
const stats = computed(() => [
  { label: '待巡查任务', value: rows.value.filter((row) => String(row.status) === '待巡查').length },
  { label: '发现异常次数', value: rows.value.filter((row) => String(row.status) === '发现异常').length },
  {
    label: '本月巡查次数',
    value: rows.value.filter((row) =>
      String(row['巡查日期'] ?? '').startsWith(new Date().toISOString().slice(0, 7)),
    ).length,
  },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 状态只能顺着「待巡查→已巡查→发现异常→已复核」推进，只给出当前状态能执行的动作。
function availableActions(row: EntryRow): string[] {
  return Object.keys(PATROL_ACTION_FROM).filter((action) =>
    PATROL_ACTION_FROM[action].includes(String(row.status)),
  )
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

function openDetail(row: EntryRow) {
  router.push({ name: 'patrol-detail', params: { id: Number(row.id) } })
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
