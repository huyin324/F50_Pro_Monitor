<template>
  <div class="card log-panel">
    <div class="card-head">
      <div class="card-title"><i class="bar" style="background:var(--gray)"></i>运行日志</div>
      <div class="row">
        <button class="btn sm ghost" @click="doExport">导出日志</button>
        <button class="btn sm ghost" @click="clearLogs">清空</button>
      </div>
    </div>
    <div class="log-tools">
      <label class="check"><input type="checkbox" v-model="state.logFilter.info" /><span class="box"></span><span>信息</span></label>
      <label class="check"><input type="checkbox" v-model="state.logFilter.ok" /><span class="box"></span><span>成功</span></label>
      <label class="check"><input type="checkbox" v-model="state.logFilter.warn" /><span class="box"></span><span>警告</span></label>
      <label class="check"><input type="checkbox" v-model="state.logFilter.error" /><span class="box"></span><span>错误</span></label>
      <span style="flex:1"></span>
      <label class="check"><input type="checkbox" v-model="state.autoScroll" /><span class="box"></span><span>自动滚动</span></label>
    </div>
    <div class="log-list" ref="box">
      <div v-for="(l, i) in filtered" :key="i" class="log-line">
        <span class="log-time">{{ l.t }}</span>
        <span class="log-level" :class="l.level">{{ levelText(l.level) }}</span>
        <span class="log-msg">{{ l.msg }}</span>
      </div>
      <div v-if="!filtered.length" style="color:var(--text-3);text-align:center;padding:16px">暂无日志</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { state, clearLogs, exportText } from '../stores/f50Store.js'

const box = ref(null)
const filtered = computed(() => state.logs.filter(l => state.logFilter[l.level] !== false))

watch(() => state.logs.length, async () => {
  if (!state.autoScroll) return
  await nextTick()
  if (box.value) box.value.scrollTop = box.value.scrollHeight
})

function levelText(l) {
  return { info: 'INFO', ok: 'OK', warn: 'WARN', error: 'ERR' }[l] || l
}
async function doExport() {
  const text = state.logs.map(l => `${l.t} [${levelText(l.level)}] ${l.msg}`).join('\n')
  await exportText(`F50Pro_运行日志_${new Date().toISOString().slice(0, 10)}.txt`, text)
}
</script>
