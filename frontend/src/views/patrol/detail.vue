<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>巡查记录详情</h2>
        <p class="page-desc">与巡查列表读同一份本地数据，巡查人、巡查结论两处一致。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回巡查列表</button>
      </div>
    </header>

    <template v-if="record">
      <dl class="detail-grid">
        <div v-for="field in fields" :key="field" class="detail-item">
          <dt>{{ field }}</dt>
          <dd>{{ field === '巡查人' ? patroller : record[field] || '—' }}</dd>
        </div>
        <div class="detail-item">
          <dt>当前状态</dt>
          <dd>{{ record.status }}</dd>
        </div>
      </dl>

      <section class="verdict-panel">
        <h3>现行口径复核判定</h3>
        <p>
          坡面情况与排水情况都正常才给「已复核」。按当前记录判定：
          <strong>{{ verdict.conclusion }}</strong>（{{ verdict.status }}）。
        </p>
      </section>

      <section v-if="threatItem" class="verdict-panel">
        <h3>受威胁对象台账待核项</h3>
        <p>
          复核结果已写入受威胁对象台账：{{ threatItem['对象编号'] }} ·
          {{ threatItem['对象名称'] }}（{{ threatItem.status }}）。
        </p>
      </section>
    </template>

    <p v-else class="empty-state">
      没有找到编号为 {{ route.params.id }} 的巡查记录，
      <RouterLink to="/patrol">返回巡查列表</RouterLink>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getEntry, listEntries } from '@/api/local-service'
import { judgePatrol, resolvePatroller } from '@/data/patrol-rules'

const route = useRoute()
const router = useRouter()
const fields = ["巡查编号", "所属隐患点", "巡查人", "巡查日期", "坡面情况", "排水情况", "巡查结论", "巡查状态"]

const record = computed(() => getEntry('patrol', Number(route.params.id)))
// 巡查人只认「巡查人」字段，与列表页同一套读法，不从巡查结论里猜。
const patroller = computed(() => (record.value ? resolvePatroller(record.value) : '未登记'))
const verdict = computed(() =>
  record.value
    ? judgePatrol(record.value)
    : { status: '发现异常' as const, conclusion: '记录不存在', reasons: [] },
)
const threatItem = computed(() => {
  if (!record.value) return null
  const code = `THRE-REV-${String(record.value['巡查编号'] ?? '').trim()}`
  return listEntries('threat').items.find((row) => String(row['对象编号']) === code) ?? null
})

function goBack() {
  router.push({ name: 'patrol' })
}
</script>
