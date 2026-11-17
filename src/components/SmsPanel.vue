<template>
  <div class="card sms-panel">
    <div class="card-head">
      <div class="card-title"><i class="bar" style="background:var(--purple)"></i>短信收件箱
        <span v-if="state.sms.unread" class="chip orange">{{ state.sms.unread }} 未读</span>
      </div>
      <div class="row">
        <button class="btn sm" @click="refresh">刷新</button>
        <button class="btn sm" @click="$emit('compose')">写短信</button>
      </div>
    </div>

    <div class="log-tools">
      <label class="check" title="全选/取消全选">
        <input type="checkbox" :checked="allSelected" @change="toggleAll($event.target.checked)" />
        <span class="box"></span><span>全选</span>
      </label>
      <span style="font-size:10.5px;color:var(--text-3)">已选 {{ state.selectedSms.length }} 条</span>
      <span style="flex:1"></span>
      <button class="btn sm" :disabled="!state.selectedSms.length || state.busy" @click="markRead">标记已读</button>
      <button class="btn sm" :disabled="!state.selectedSms.length || state.busy" @click="remove">删除</button>
      <button class="btn sm" @click="doExport">导出</button>
    </div>

    <div class="sms-list">
      <div v-if="state.sms.error" class="notice error">{{ state.sms.error }}</div>
      <div v-if="!state.sms.messages.length && !state.sms.error" class="sms-empty">暂无短信，或正在读取…</div>
      <div v-for="m in state.sms.messages" :key="m.id" class="sms-item" :class="{ unread: m.unread }">
        <div class="sms-top">
          <label class="check">
            <input type="checkbox" :checked="state.selectedSms.includes(m.id)" @change="toggleOne(m.id, $event.target.checked)" />
            <span class="box"></span>
          </label>
          <span class="sms-num">{{ m.number || '未知号码' }}</span>
          <span v-if="m.unread" class="chip blue">未读</span>
          <span class="sms-date">{{ m.date || m.date_raw }}</span>
        </div>
        <div class="sms-body" :title="m.content">{{ m.content }}</div>
        <div class="sms-actions">
          <span v-if="codeOf(m)" class="code-chip">{{ codeOf(m) }}</span>
          <button v-if="codeOf(m)" class="btn sm" @click="copy(codeOf(m), '验证码')">复制验证码</button>
          <button class="btn sm ghost" @click="copy(m.content, '短信内容')">复制全文</button>
          <button class="btn sm ghost" @click="copy(m.number, '号码')">复制号码</button>
          <span style="margin-left:auto;font-size:10px;color:var(--text-3)">#{{ m.id }} · {{ m.store }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { state, refreshSms, guardedAction, copyText, exportText, log } from '../stores/f50Store.js'
import { call } from '../transport.js'
import { extractCode } from '../utils/format.js'

defineEmits(['compose'])

const allSelected = computed(() => state.sms.messages.length > 0 && state.selectedSms.length === state.sms.messages.length)
const codeOf = m => extractCode(m.content)

function toggleOne(id, on) {
  if (on) { if (!state.selectedSms.includes(id)) state.selectedSms.push(id) }
  else state.selectedSms = state.selectedSms.filter(x => x !== id)
}
function toggleAll(on) {
  state.selectedSms = on ? state.sms.messages.map(m => m.id) : []
}
function refresh() { refreshSms(true) }
function copy(text, label) { copyText(text, label) }

async function markRead() {
  const ids = [...state.selectedSms]
  await guardedAction({
    title: '标记短信为已读',
    message: `确认把选中的 ${ids.length} 条短信标记为已读吗？`,
    detail: '将在设备端下发 SET_MSG_READ，标记后设备未读计数会变化。',
    action: () => call('mark_sms_read', { ids }),
    success: `${ids.length} 条短信已标记已读`
  })
  state.selectedSms = []
}

async function remove() {
  const ids = [...state.selectedSms]
  await guardedAction({
    title: '删除短信',
    message: `确认删除选中的 ${ids.length} 条短信吗？此操作不可撤销。`,
    detail: '将在设备端下发 DELETE_SMS。建议先「导出」备份。',
    danger: true,
    action: () => call('delete_sms', { ids }),
    success: `${ids.length} 条短信已删除`
  })
  state.selectedSms = []
}

async function doExport() {
  const rows = state.sms.messages.map(m =>
    `编号: ${m.id}\n号码: ${m.number}\n时间: ${m.date || m.date_raw}\n状态: ${m.unread ? '未读' : '已读'}\n内容: ${m.content}\n${'-'.repeat(40)}`
  ).join('\n')
  const head = `F50 Pro Monitor 短信导出\n导出时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}\n来源: ${state.sms.source}\n共 ${state.sms.messages.length} 条\n${'='.repeat(40)}\n`
  const name = `F50Pro_短信_${new Date().toISOString().slice(0, 10)}.txt`
  const ok = await exportText(name, head + rows)
  if (ok) log('info', `导出目录支持中文与 SMB/UNC（例如 \\\\NAS\\Share\\导出）`)
}
</script>
