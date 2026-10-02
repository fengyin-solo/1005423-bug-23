<template>
  <section class="page" data-module="patrol-detail">
    <header class="page-head">
      <div>
        <h2>巡查记录详情</h2>
        <p class="page-desc">
          <RouterLink class="link" to="/patrol">← 返回群测群防巡查列表</RouterLink>
        </p>
      </div>
    </header>

    <p v-if="notFound" class="error-text">找不到这条巡查记录，可能已按巡查编号合并，请回到列表核对。</p>

    <template v-else-if="row">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ row.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">巡查人</span>
          <strong class="stat-value">{{ row['巡查人'] || '—' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">复核口径</span>
          <strong class="stat-value" style="font-size:14px">坡面、排水均正常才已复核</strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in detailFields" :key="field">
            <th>{{ field }}</th>
            <td>{{ row[field] === '' || row[field] == null ? '—' : row[field] }}</td>
          </tr>
          <tr>
            <th>异常原因</th>
            <td>{{ row['异常原因'] || '—' }}</td>
          </tr>
          <tr v-if="row.blocked">
            <th>复核问题</th>
            <td><span class="error-text">{{ row['复核问题'] }}</span></td>
          </tr>
        </tbody>
      </table>

      <div v-if="pendingThreat" class="detail-callout">
        受威胁对象台账已登记待核项：{{ pendingThreat['对象编号'] }}（{{ pendingThreat['对象名称'] }}），
        <RouterLink class="link" to="/threat">前往台账核对 →</RouterLink>
      </div>

      <div class="detail-actions">
        <button
          v-for="action in availableActions"
          :key="action"
          class="btn"
          :class="{ primary: action === '确认复核' }"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
        <span v-if="!availableActions.length" class="muted">该记录已到终态，无可执行动作。</span>
      </div>

      <footer class="page-foot">
        <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { getPatrolEntry, listEntries, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ idOrCode: string }>()

const row = ref<EntryRow | undefined>()
const notFound = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')

const detailFields = [
  '巡查编号',
  '所属隐患点',
  '巡查人',
  '巡查日期',
  '坡面情况',
  '排水情况',
  '巡查结论',
  '巡查状态',
]

function load() {
  const entry = getPatrolEntry(decodeURIComponent(props.idOrCode))
  row.value = entry
  notFound.value = !entry
}

// 状态只能顺向推进，详情页的动作入口与列表严格一致
const availableActions = computed<string[]>(() => {
  switch (String(row.value?.status)) {
    case '待巡查':
      return ['提交巡查']
    case '已巡查':
      return ['上报异常', '确认复核']
    case '发现异常':
      return ['确认复核']
    default:
      return []
  }
})

// 异常复核后台账多一条待核项：这里把同隐患点的待核项指给用户看
const pendingThreat = computed(() => {
  if (!row.value) return undefined
  const hazard = String(row.value['所属隐患点'] ?? '')
  return listEntries('threat').items.find(
    (item) =>
      String(item['所属隐患点']) === hazard &&
      String(item['对象编号']).startsWith('待核-'),
  )
})

function runAction(action: string) {
  if (!row.value) return
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction('patrol', Number(row.value.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  load()
}

watch(() => props.idOrCode, load, { immediate: true })
</script>
