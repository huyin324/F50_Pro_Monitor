<template>
  <header class="header">
    <div class="brand">
      <img src="/app-icon.svg" alt="F50 Pro Monitor" />
      <div>
        <div class="brand-title">F50 Pro Monitor</div>
        <div class="brand-sub">MU3356 · 原生 80 端口 · v1.0.1</div>
      </div>
    </div>

    <div class="header-chips">
      <span class="chip" :class="state.status.connected ? 'green' : 'red'">
        <i class="dot" :class="{ off: !state.status.connected }"></i>
        {{ state.status.connected ? '已连接' : (state.status.online ? '已断开' : '离线') }}
      </span>
      <span class="chip blue">{{ state.status.network_type_text || '--' }}</span>
      <span class="chip">{{ state.status.network_provider || '未知运营商' }}</span>
      <span class="chip" :class="state.sms.unread ? 'orange' : ''">短信 {{ state.sms.unread }} 条未读</span>
      <span class="chip">{{ state.runtime }}</span>
    </div>

    <div class="header-actions">
      <button class="btn" :disabled="state.refreshing" title="立即刷新状态与速率" @click="$emit('refresh')">
        {{ state.refreshing ? '刷新中' : '刷新' }}
      </button>
      <button class="btn" title="只读接口自检，定位适配问题" @click="$emit('diagnose')">自检</button>
      <button class="btn" title="打开设备 Web 管理后台" @click="$emit('open-web')">后台</button>
      <button class="btn" title="设置（含月度流量套餐额度）" @click="$emit('settings')">设置</button>
      <button class="btn icon info" title="设备信息：SIM 卡号 / 固件版本 / ICCID / IMEI / IMSI" @click="$emit('info')">i</button>
    </div>
  </header>
</template>

<script setup>
import { state } from '../stores/f50Store.js'
defineEmits(['refresh', 'diagnose', 'open-web', 'settings', 'info'])
</script>
