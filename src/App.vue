<template>
  <div class="app" :class="{ dark: state.theme === 'dark' }">
    <Header
      @refresh="onRefresh"
      @diagnose="runDiagnose"
      @open-web="onOpenWeb"
      @settings="state.view.settings = true"
      @info="onInfo"
    />

    <div class="progress-strip"><i :style="{ width: state.progress + '%' }"></i></div>

    <main class="workspace">
      <section class="col-left">
        <SpeedCard />
        <SignalCard />
        <TrafficCard @settings="state.view.settings = true" />
        <HardwareCard />
      </section>
      <section class="col-right">
        <SmsPanel @compose="state.view.compose = true" />
        <LogPanel />
      </section>
    </main>

    <footer class="statusbar">
      <span>{{ state.status.online ? '● 设备在线' : '○ 设备离线' }}</span>
      <span>{{ state.status.error || `最后更新 ${state.lastUpdate || '--'}` }}</span>
      <span>速率 {{ state.status.dl_text }} ↓ / {{ state.status.ul_text }} ↑</span>
      <span>本月 {{ formatBytes(state.status.monthly_total_bytes) }}</span>
      <span class="spacer"></span>
      <span>{{ state.config.base_url }}</span>
      <span>{{ state.runtime }}</span>
    </footer>

    <DeviceInfoModal v-if="state.view.info" />
    <SettingsModal v-if="state.view.settings" />
    <ComposeSmsModal v-if="state.view.compose" />
    <DiagnoseModal v-if="state.view.diagnose" />
    <ConfirmModal v-if="state.confirm" />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import Header from './components/Header.vue'
import SpeedCard from './components/SpeedCard.vue'
import SignalCard from './components/SignalCard.vue'
import TrafficCard from './components/TrafficCard.vue'
import HardwareCard from './components/HardwareCard.vue'
import SmsPanel from './components/SmsPanel.vue'
import LogPanel from './components/LogPanel.vue'
import DeviceInfoModal from './components/DeviceInfoModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import ComposeSmsModal from './components/ComposeSmsModal.vue'
import DiagnoseModal from './components/DiagnoseModal.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import {
  state, initApp, refreshStatus, refreshDeviceInfo, refreshSms,
  runDiagnose, openWeb, log
} from './stores/f50Store.js'
import { formatBytes } from './utils/format.js'

onMounted(() => { initApp() })

async function onRefresh() {
  await Promise.all([refreshStatus(true), refreshSms(true)])
  log('info', '手动刷新完成')
}

async function onInfo() {
  state.view.info = true
  await refreshDeviceInfo()
}
function onOpenWeb() { openWeb(`${state.config.base_url}/#home`) }
</script>
