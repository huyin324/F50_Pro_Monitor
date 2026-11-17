<template>
  <div class="overlay" @click.self="no">
    <div class="modal narrow">
      <div class="modal-head">
        <div class="modal-title">{{ state.confirm?.danger ? '⚠ 危险操作确认' : '操作确认' }}</div>
        <button class="btn sm ghost" @click="no">关闭</button>
      </div>
      <div class="modal-body">
        <div class="notice" :class="state.confirm?.danger ? 'warn' : ''" style="font-size:12.5px">
          {{ state.confirm?.message }}
        </div>
        <div v-if="state.confirm?.detail" class="field-hint" style="margin-top:10px;white-space:pre-wrap;font-size:11.5px">{{ state.confirm.detail }}</div>
        <div class="notice" :class="state.confirm?.danger ? 'error' : ''" style="margin-top:12px">
          {{ state.confirm?.notice || '此操作会向设备下发写指令并改变设备状态。请确认已知悉后果，再点击「确认执行」。' }}
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click="no">取消</button>
        <button class="btn" :class="state.confirm?.danger ? 'danger' : 'primary'" @click="yes">{{ state.confirm?.confirm_text || '确认执行' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { state, resolveConfirm } from '../stores/f50Store.js'
const no = () => resolveConfirm(false)
const yes = () => resolveConfirm(true)
</script>
