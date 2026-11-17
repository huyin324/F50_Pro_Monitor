<template>
  <div class="card">
    <div class="card-head">
      <div class="card-title"><i class="bar"></i>硬件 / 连接状态</div>
      <div class="card-note">全部取自设备原生 80 端口，不依赖 2333 UFI 代理或 ADB</div>
    </div>

    <div class="metrics">
      <div class="metric">
        <div class="metric-label">数据连接</div>
        <div class="metric-value small" :class="s.connected ? 'green' : 'red'">{{ s.connection_text || '--' }}</div>
        <div class="metric-label" style="margin-top:2px">{{ s.ppp_status || '--' }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">调制解调器</div>
        <div class="metric-value small" :class="s.modem_main_state ? 'green' : 'muted'">{{ modemText }}</div>
        <div class="metric-label" style="margin-top:2px">{{ s.modem_main_state || '--' }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">SIM 卡</div>
        <div class="metric-value small" :class="s.sim_status === '已就绪' ? 'green' : 'orange'">{{ s.sim_status || '--' }}</div>
        <div class="metric-label" style="margin-top:2px">卡槽 {{ s.sim_slot || '--' }} · PIN {{ s.sim_pin_status || '--' }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">网络模式</div>
        <div class="metric-value small">{{ s.network_mode_text || '--' }}</div>
        <div class="metric-label" style="margin-top:2px">{{ s.net_select || '--' }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Wi-Fi</div>
        <div class="metric-value small" :class="s.wifi_onoff_state === '1' ? 'green' : 'red'">{{ s.wifi_onoff_state === '1' ? '已开启' : '已关闭' }}</div>
        <div class="metric-label" style="margin-top:2px">{{ s.ssid || '--' }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">接入设备数</div>
        <div class="metric-value blue">{{ s.wifi_access_sta_num }} 台</div>
        <div class="metric-label" style="margin-top:2px">MAX_STATION_NUMBER 16</div>
      </div>
      <div class="metric">
        <div class="metric-label">CPU 温度</div>
        <div class="metric-value" :class="tempClass">{{ s.cpu_temperature === null ? '--' : s.cpu_temperature + ' °C' }}</div>
        <div class="metric-label" style="margin-top:2px">cpu_temperature</div>
      </div>
      <div class="metric">
        <div class="metric-label">CPU 占用</div>
        <div class="metric-value muted">{{ s.cpu_usage === null ? '--' : s.cpu_usage + ' %' }}</div>
        <div class="metric-label" style="margin-top:2px">固件未提供时显示 --</div>
      </div>
      <div class="metric">
        <div class="metric-label">内存占用</div>
        <div class="metric-value muted">{{ s.mem_usage === null ? '--' : s.mem_usage + ' %' }}</div>
        <div class="metric-label" style="margin-top:2px">固件未提供时显示 --</div>
      </div>
      <div class="metric">
        <div class="metric-label">供电 / 电池</div>
        <div class="metric-value small">{{ powerText }}</div>
        <div class="metric-label" style="margin-top:2px">battery_value {{ s.battery_value }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">漫游</div>
        <div class="metric-value small">{{ s.roam_setting_option === 'on' ? '已开启' : '已关闭' }}</div>
        <div class="metric-label" style="margin-top:2px">{{ s.roaming || '未漫游' }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">WAN IP</div>
        <div class="metric-value small">{{ s.wan_ipaddr || '--' }}</div>
        <div class="metric-label" style="margin-top:2px">LAN {{ s.lan_ipaddr || '--' }}</div>
      </div>
    </div>

    <div class="divider"></div>
    <div class="card-title" style="margin-bottom:8px"><i class="bar" style="background:var(--orange)"></i>连接控制（写操作需二次确认）</div>
    <div class="row">
      <button class="btn" :class="s.connected ? '' : 'primary'" :disabled="state.busy" @click="toggleData">
        {{ s.connected ? '断开移动数据' : '连接移动数据' }}
      </button>
      <select class="select" style="width:190px" v-model="mode">
        <option v-for="m in modes" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
      <button class="btn" :disabled="state.busy" @click="applyMode">应用网络模式</button>
      <span style="font-size:10.5px;color:var(--text-3)">当前：{{ s.net_select || '--' }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { state, guardedAction, log } from '../stores/f50Store.js'
import { call } from '../transport.js'
import { formatDuration } from '../utils/format.js'

const s = computed(() => state.status)
const modes = [
  { value: 'WL_AND_5G', label: '自动 5G（推荐）' },
  { value: 'LTE_AND_5G', label: '5G NSA' },
  { value: 'Only_5G', label: '5G SA' },
  { value: 'Only_LTE', label: '仅 4G LTE' },
  { value: 'WCDMA_AND_LTE', label: '4G / 3G' },
  { value: 'Only_WCDMA', label: '仅 3G' }
]
const mode = ref(s.value.net_select || 'WL_AND_5G')
watch(() => s.value.net_select, v => { if (v) mode.value = v })

const modemText = computed(() => /init_complete|ready/i.test(s.value.modem_main_state) ? '已就绪' : (s.value.modem_main_state || '--'))
const tempClass = computed(() => s.value.cpu_temperature === null ? 'muted' : (s.value.cpu_temperature >= 60 ? 'red' : s.value.cpu_temperature >= 48 ? 'orange' : 'green'))
const powerText = computed(() => {
  if (Number(s.value.battery_value) < 0) return 'USB 供电（无电池）'
  return `${s.value.battery_value}%${s.value.battery_charging === '1' ? ' · 充电中' : ''}`
})

async function toggleData() {
  const on = !s.value.connected
  await guardedAction({
    title: on ? '连接移动数据' : '断开移动数据',
    message: `确认要${on ? '开启' : '关闭'}设备的蜂窝数据连接吗？`,
    detail: on ? '将下发 CONNECT_NETWORK，设备会重新拨号。' : '将下发 DISCONNECT_NETWORK，设备会立即断网；若通过 Wi-Fi 连接设备，管理后台仍可访问。',
    danger: !on,
    action: () => call('set_mobile_data', { enabled: on }),
    success: `${on ? '连接' : '断开'}指令已下发，等待 ppp_status 更新`
  })
}

async function applyMode() {
  const label = modes.find(m => m.value === mode.value)?.label || mode.value
  await guardedAction({
    title: '切换网络模式',
    message: `确认把网络模式切换为「${label}」吗？`,
    detail: `将下发 SET_BEARER_PREFERENCE · BearerPreference=${mode.value}。切换期间可能短暂掉线。`,
    danger: true,
    action: () => call('set_network_mode', { mode: mode.value }),
    success: `网络模式已请求切换为 ${label}`
  })
  log('info', `会话时长 ${formatDuration(s.value.uptime_sec)}`)
}
</script>
