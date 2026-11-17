<template>
  <div class="card">
    <div class="card-head">
      <div class="card-title"><i class="bar"></i>实时速率</div>
      <div class="card-note">{{ state.lastUpdate ? '更新于 ' + state.lastUpdate : '等待数据' }}</div>
    </div>

    <div class="speed-grid">
      <div class="speed-item">
        <div class="speed-label">↓ 实时下载</div>
        <div class="speed-value dl">{{ parts(state.status.dl_text).n }}<span class="speed-unit">{{ parts(state.status.dl_text).u }}</span></div>
        <svg class="spark" viewBox="0 0 260 48" preserveAspectRatio="none">
          <path :d="dlPath.fill" fill="var(--green)" opacity="0.10" />
          <path :d="dlPath.stroke" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" />
        </svg>
      </div>

      <div class="speed-divider"></div>

      <div class="speed-item">
        <div class="speed-label">↑ 实时上传</div>
        <div class="speed-value ul">{{ parts(state.status.ul_text).n }}<span class="speed-unit">{{ parts(state.status.ul_text).u }}</span></div>
        <svg class="spark" viewBox="0 0 260 48" preserveAspectRatio="none">
          <path :d="ulPath.fill" fill="var(--blue)" opacity="0.10" />
          <path :d="ulPath.stroke" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linecap="round" />
        </svg>
      </div>
    </div>

    <div class="speed-foot">
      <span>原始值 {{ fmt(state.status.dl_bps) }} / {{ fmt(state.status.ul_bps) }} B/s · 字段 flux_realtime_*_thrpt</span>
      <span>单位与 Web 管理端一致：b/s · Kb/s · Mb/s · Gb/s</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { state } from '../stores/f50Store.js'
import { smoothPath } from '../utils/format.js'

const dlPath = computed(() => smoothPath(state.speedHistory.dl))
const ulPath = computed(() => smoothPath(state.speedHistory.ul))

function parts(text) {
  const s = String(text || '— —')
  const m = s.match(/^([\d.]+)\s*(\S+)$/)
  return m ? { n: m[1], u: m[2] } : { n: s, u: '' }
}
const fmt = v => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
</script>
