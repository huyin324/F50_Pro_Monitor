<template>
  <div class="card">
    <div class="card-head">
      <div class="card-title"><i class="bar"></i>月度流量套餐</div>
      <div class="card-note">
        账单日 {{ state.status.quota_reset_day || '--' }} 号 ·
        {{ state.status.days_to_reset }} 天后重置
        <button class="btn sm ghost" style="margin-left:6px" @click="$emit('settings')">设置额度</button>
      </div>
    </div>

    <template v-if="enabled">
      <div class="row" style="justify-content:space-between;margin-bottom:7px">
        <div style="font-size:12px;color:var(--text-2)">
          已用 <b style="color:var(--text)">{{ formatBytes(s.monthly_total_bytes) }}</b>
          / {{ formatBytes(s.quota_bytes) }}
        </div>
        <div class="chip" :class="pctClass">{{ pct.toFixed(1) }}%</div>
      </div>
      <div class="progress"><i :class="barClass" :style="{ width: Math.min(100, pct) + '%' }"></i></div>
      <div class="row" style="justify-content:space-between;margin-top:6px;font-size:10.5px;color:var(--text-3)">
        <span>剩余 {{ formatBytes(s.quota_remaining_bytes) }}</span>
        <span>预警阈值 {{ state.config.quota_warn_pct }}% · {{ pct >= 100 ? '已超额' : pct >= state.config.quota_warn_pct ? '已达预警' : '用量正常' }}</span>
      </div>
      <div v-if="pct >= Number(state.config.quota_warn_pct)" class="notice warn" style="margin-top:9px">
        本月用量已达到套餐额度的 {{ pct.toFixed(1) }}%，距重置还有 {{ s.days_to_reset }} 天，请留意限速或额外计费。
      </div>
    </template>
    <template v-else>
      <div class="notice" style="margin-bottom:10px">
        尚未设置月度套餐额度。请在「设置 → 月度流量套餐」中填写额度（GB/MB/TB）与账单日，即可显示用量进度、剩余量与超额预警。
      </div>
    </template>

    <div class="metrics" style="margin-top:10px">
      <div class="metric"><div class="metric-label">本月下载</div><div class="metric-value green">{{ formatBytes(s.monthly_rx_bytes) }}</div></div>
      <div class="metric"><div class="metric-label">本月上传</div><div class="metric-value blue">{{ formatBytes(s.monthly_tx_bytes) }}</div></div>
      <div class="metric"><div class="metric-label">今日用量</div><div class="metric-value">{{ formatBytes(s.daily_total_bytes) }}</div></div>
      <div class="metric"><div class="metric-label">本连接时长</div><div class="metric-value small">{{ formatDuration(s.uptime_sec) }}</div></div>
      <div class="metric"><div class="metric-label">本次连接下载</div><div class="metric-value small">{{ formatBytes(s.session_rx_bytes) }}</div></div>
      <div class="metric"><div class="metric-label">设备侧限额</div><div class="metric-value small">{{ s.device_limit_bytes ? formatBytes(s.device_limit_bytes) : '未设置' }}</div></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { state } from '../stores/f50Store.js'
import { formatBytes, formatDuration } from '../utils/format.js'

defineEmits(['settings'])
const s = computed(() => state.status)
const enabled = computed(() => !!state.config.quota_enabled && Number(s.value.quota_bytes) > 0)
const pct = computed(() => Number(s.value.quota_used_pct) || 0)
const barClass = computed(() => pct.value >= 100 ? 'over' : pct.value >= Number(state.config.quota_warn_pct) ? 'warn' : '')
const pctClass = computed(() => pct.value >= 100 ? 'red' : pct.value >= Number(state.config.quota_warn_pct) ? 'orange' : 'green')
</script>
