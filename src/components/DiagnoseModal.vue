<template>
  <div class="overlay" @click.self="close">
    <div class="modal wide">
      <div class="modal-head">
        <div class="modal-title">🩺 接口自检（只读）</div>
        <button class="btn sm ghost" @click="close">关闭</button>
      </div>
      <div class="modal-body">
        <div class="notice" style="margin-bottom:12px">
          设备地址 <span class="kbd">{{ r?.base_url }}</span> ·
          登录 {{ r?.logged_in ? '成功' : '未登录' }} · 会话 {{ r?.cookie }} ·
          通过 {{ (r?.items || []).filter(i => i.ok).length }} / {{ (r?.items || []).length }} 项。
          全部请求均为 <span class="kbd">goform_get_cmd_process</span> 只读 GET，不会修改设备配置。
        </div>
        <div v-for="(it, i) in (r?.items || [])" :key="i" class="card" style="margin-bottom:8px;padding:10px 12px">
          <div class="row" style="justify-content:space-between">
            <b style="font-size:12px">{{ it.name }}</b>
            <span class="chip" :class="it.ok ? 'green' : 'red'">{{ it.ok ? '通过' : '失败' }} · {{ it.keys }} 字段</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-3);font-family:var(--mono);margin:5px 0;word-break:break-all">cmd={{ it.cmd }}</div>
          <pre style="font-size:10.5px;white-space:pre-wrap;word-break:break-all;color:var(--text-2);max-height:110px;overflow:auto">{{ it.sample }}</pre>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click="rerun">重新自检</button>
        <button class="btn primary" @click="close">完成</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { state, runDiagnose } from '../stores/f50Store.js'
const r = computed(() => state.diagnoseResult)
function close() { state.view.diagnose = false }
async function rerun() { await runDiagnose() }
</script>
