<template>
  <div class="card">
    <div class="card-head">
      <div class="card-title"><i class="bar"></i>蜂窝信号与频段</div>
      <div class="card-note">独立请求 network_information，避免固件清空 dump 字段</div>
    </div>

    <div class="metrics">
      <div class="metric">
        <div class="metric-label">信号格数</div>
        <div class="bars">
          <i v-for="n in 5" :key="n" :class="{ on: n <= state.status.signalbar }"></i>
        </div>
        <div class="metric-value small" :class="barsColor">{{ state.status.signalbar }} / 5 · {{ barsLabel }}</div>
      </div>
      <div class="metric" v-for="m in metrics" :key="m.label">
        <div class="metric-label">{{ m.label }}</div>
        <div class="metric-value" :class="m.value === '' ? 'muted' : m.q.color">
          {{ m.value === '' ? '--' : m.value + ' ' + m.unit }}
        </div>
        <div class="metric-track"><i :style="{ width: (m.q.ratio * 100) + '%', background: 'var(--' + (m.q.color === 'muted' ? 'border-strong' : m.q.color) + ')' }"></i></div>
        <div class="metric-label" style="margin-top:3px">{{ m.q.label }}</div>
      </div>
    </div>

    <div class="metrics" style="margin-top:8px">
      <div class="metric"><div class="metric-label">驻网制式</div><div class="metric-value small">{{ state.status.network_type_text || '--' }}</div></div>
      <div class="metric"><div class="metric-label">NR 频段</div><div class="metric-value small">{{ band || '--' }}</div></div>
      <div class="metric"><div class="metric-label">带宽</div><div class="metric-value small">{{ bw || '--' }}</div></div>
      <div class="metric"><div class="metric-label">PLMN</div><div class="metric-value small">{{ state.status.plmn || '--' }}</div></div>
      <div class="metric"><div class="metric-label">小区 / PCI</div><div class="metric-value small">{{ state.status.nr_cell_id || '--' }} / {{ state.status.nr_pci || '--' }}</div></div>
      <div class="metric"><div class="metric-label">签约速率 (AMBR)</div><div class="metric-value small">{{ ambr }}</div></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { state } from '../stores/f50Store.js'
import { signalQuality, formatBandwidth } from '../utils/format.js'

const metrics = computed(() => [
  { label: 'RSRP', value: state.status.rsrp, unit: 'dBm', q: signalQuality('rsrp', state.status.rsrp) },
  { label: 'RSRQ', value: state.status.rsrq, unit: 'dB', q: signalQuality('rsrq', state.status.rsrq) },
  { label: 'SINR / SNR', value: state.status.sinr, unit: 'dB', q: signalQuality('snr', state.status.sinr) }
])
const barsLabel = computed(() => ['无信号', '较弱', '一般', '良好', '极佳', '极佳'][state.status.signalbar] || '--')
const barsColor = computed(() => state.status.signalbar >= 4 ? 'green' : state.status.signalbar >= 3 ? 'blue' : state.status.signalbar >= 2 ? 'orange' : 'red')
const band = computed(() => state.status.nr_bands ? `n${state.status.nr_bands}` : '--')
const bw = computed(() => {
  const v = Number(state.status.nr_band_widths)
  return v ? `${v / 1000} MHz` : '--'
})
const ambr = computed(() => {
  const d = formatBandwidth(Number(state.status.dl_ambr) || 0)
  const u = formatBandwidth(Number(state.status.ul_ambr) || 0)
  return state.status.dl_ambr ? `↓${d} / ↑${u}` : '--'
})
</script>
