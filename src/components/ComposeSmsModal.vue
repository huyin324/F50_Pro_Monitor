<template>
  <div class="overlay" @click.self="close">
    <div class="modal narrow">
      <div class="modal-head">
        <div class="modal-title">✉ 发送短信</div>
        <button class="btn sm ghost" @click="close">关闭</button>
      </div>
      <div class="modal-body">
        <div class="field" style="margin-bottom:12px">
          <span class="field-label">接收号码</span>
          <input class="input mono" v-model="number" placeholder="13800138000 或 +8613800138000" />
        </div>
        <div class="field">
          <span class="field-label">短信内容</span>
          <textarea class="textarea" v-model="content" placeholder="支持中文；内容按 UTF-16BE 十六进制编码（与 Web 管理端一致）"></textarea>
          <span class="field-hint">字符数 {{ content.length }} · 编码 {{ content.length > 70 ? '将按长短信分段发送' : '单条' }} · encode_type = UNICODE</span>
        </div>
        <div class="notice warn" style="margin-top:12px">
          发送短信会产生运营商费用，且不可撤回。点击「发送」后仍需二次确认。
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click="close">取消</button>
        <button class="btn primary" :disabled="!number.trim() || !content.trim() || state.busy" @click="send">发送</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { state, guardedAction } from '../stores/f50Store.js'
import { call } from '../transport.js'

const number = ref('')
const content = ref('')
function close() { state.view.compose = false }

async function send() {
  const n = number.value.trim()
  const c = content.value
  const ok = await guardedAction({
    title: '发送短信',
    message: `确认向 ${n} 发送这条短信吗？`,
    detail: `内容：${c.length > 60 ? c.slice(0, 60) + '…' : c}\n将下发 SEND_SMS，可能产生短信费用。`,
    danger: true,
    action: () => call('send_sms', { number: n, content: c }),
    success: `短信已提交发送至 ${n}`
  })
  if (ok) { number.value = ''; content.value = ''; close() }
}
</script>
