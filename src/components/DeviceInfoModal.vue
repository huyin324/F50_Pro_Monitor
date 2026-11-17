<template>
  <div class="overlay" @click.self="close">
    <div class="modal wide">
      <div class="modal-head">
        <div class="modal-title">ⓘ 设备信息 · F50 Pro</div>
        <div class="row">
          <label class="check" title="隐藏敏感标识，便于截图分享">
            <input type="checkbox" v-model="masked" /><span class="box"></span><span>脱敏显示</span>
          </label>
          <button class="btn sm" @click="refresh">刷新</button>
          <button class="btn sm" @click="copyAll">复制全部</button>
          <button class="btn sm ghost" @click="close">关闭</button>
        </div>
      </div>

      <div class="modal-body">
        <div class="notice" style="margin-bottom:14px">
          数据来源：设备原生 <span class="kbd">/goform/goform_get_cmd_process</span> 的 iccid / imei / imsi / sim_msisdn / web_version / hardware_version 等字段。
          原版工具依赖 2333 端口 UFI 代理与 5555 ADB，F50 Pro 未开放这些端口，因此会出现信息为空；本工具已改为直读 80 端口。
        </div>

        <div v-for="g in groups" :key="g.title" class="info-group">
          <div class="info-group-title">{{ g.title }}</div>
          <table class="info-table">
            <tr v-for="row in g.rows" :key="row.k">
              <td class="k">{{ row.k }}</td>
              <td class="v">
                <span>{{ display(row.v, row.sensitive) }}</span>
                <button v-if="row.v && row.v !== '--'" class="btn sm ghost" style="margin-left:8px" @click="copyText(display(row.v, row.sensitive), row.k)">复制</button>
              </td>
            </tr>
          </table>
        </div>

        <div style="font-size:10.5px;color:var(--text-3);text-align:right">
          读取时间：{{ info.fetched_at || '--' }} · 固件标识：{{ info.firmware_label || '--' }}
        </div>
      </div>
      <div class="modal-foot">
        <span style="margin-right:auto;font-size:10.5px;color:var(--text-3)">IMSI / ICCID / IMEI 属敏感信息，分享前建议开启脱敏显示</span>
        <button class="btn primary" @click="close">完成</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { state, refreshDeviceInfo, copyText, log } from '../stores/f50Store.js'
import { maskIdent, formatBandwidth } from '../utils/format.js'

const masked = ref(false)
const s = computed(() => state.status)
const info = computed(() => state.deviceInfo || {})
const v = (key, ...fallbacks) => {
  const d = info.value
  for (const k of [key, ...fallbacks]) {
    const x = d[k]
    if (x !== undefined && x !== null && x !== '') return String(x)
  }
  return '--'
}
const display = (val, sensitive) => (sensitive && masked.value ? maskIdent(val, true) : (val || '--'))

const groups = computed(() => [
  {
    title: 'SIM 卡与身份标识',
    rows: [
      { k: 'SIM 卡号（本机号码）', v: v('sim_msisdn', 'sim_msisdn') || s.value.sim_msisdn || '--', sensitive: true },
      { k: 'ICCID', v: v('iccid') || s.value.iccid || '--', sensitive: true },
      { k: 'IMSI', v: v('imsi') || s.value.imsi || '--', sensitive: true },
      { k: 'IMEI', v: v('imei') || s.value.imei || '--', sensitive: true },
      { k: 'IMEI（卡槽 2）', v: v('imei_1', 'imei_0'), sensitive: true },
      { k: 'PLMN', v: v('plmn') || s.value.plmn || '--' },
      { k: '运营商', v: v('network_provider') || s.value.network_provider || '--' }
    ]
  },
  {
    title: '固件版本与硬件',
    rows: [
      { k: '固件版本（Web）', v: v('web_version') || s.value.web_version || '--' },
      { k: '软件内部版本', v: v('wa_inner_version') || s.value.wa_inner_version || '--' },
      { k: '定制 / 基带版本', v: v('cr_version') || s.value.cr_version || '--' },
      { k: 'wa_version', v: v('wa_version') },
      { k: '硬件版本', v: v('hardware_version') || s.value.hardware_version || '--' },
      { k: '设备型号', v: v('model_name') || s.value.model_name || '--' },
      { k: '市场名称', v: v('market_name') },
      { k: 'CPU 温度', v: v('cpu_temperature') !== '--' ? `${v('cpu_temperature')} °C` : '--' }
    ]
  },
  {
    title: '网络与连接',
    rows: [
      { k: '驻网制式', v: v('network_type') || s.value.network_type || '--' },
      { k: '网络模式', v: v('net_select') || s.value.net_select || '--' },
      { k: '连接状态', v: v('ppp_status') || s.value.ppp_status || '--' },
      { k: '工作模式', v: v('opms_wan_mode') || s.value.opms_wan_mode || '--' },
      { k: 'WAN IPv4', v: v('wan_ipaddr') || s.value.wan_ipaddr || '--' },
      { k: 'WAN IPv6', v: v('ipv6_wan_ipaddr') || s.value.ipv6_wan_ipaddr || '--' },
      { k: 'LAN IP / 后台地址', v: v('lan_ipaddr') || s.value.lan_ipaddr || '--' },
      { k: 'MAC 地址', v: (v('mac_address') || s.value.mac_address || '--').toUpperCase() },
      { k: 'PDP 类型', v: v('pdp_type') },
      { k: 'NR 频段', v: v('nr_bands') ? `n${v('nr_bands')}` : (s.value.nr_bands ? `n${s.value.nr_bands}` : '--') },
      { k: '小区 ID / PCI', v: `${v('nr_cell_id')} / ${v('nr_pci')}` },
      { k: 'NR-ARFCN / TAC', v: `${v('nr_fcn')} / ${v('nr_tac')}` },
      { k: '签约下行 AMBR', v: v('dl_ambr') ? formatBandwidth(Number(v('dl_ambr'))) : '--' },
      { k: '签约上行 AMBR', v: v('ul_ambr') ? formatBandwidth(Number(v('ul_ambr'))) : '--' },
      { k: 'Wi-Fi SSID', v: v('ssid') || s.value.ssid || '--' },
      { k: '已接入设备', v: `${v('wifi_access_sta_num') || s.value.wifi_access_sta_num || 0} 台` }
    ]
  },
  {
    title: '短信存储',
    rows: [
      { k: '设备收件箱容量', v: v('sms_capacity_total') || s.value.sms_nv_total || '--' },
      { k: '已存短信数', v: v('sms_capacity_used') || s.value.sms_nv_rev_total || '--' },
      { k: '读取来源', v: state.sms.source || '--' }
    ]
  }
])

function close() { state.view.info = false }
async function refresh() { await refreshDeviceInfo() }
async function copyAll() {
  const lines = [`F50 Pro Monitor 设备信息 · ${info.value.fetched_at || ''}`]
  for (const g of groups.value) {
    lines.push(`\n【${g.title}】`)
    for (const r of g.rows) lines.push(`${r.k}: ${display(r.v, r.sensitive)}`)
  }
  await copyText(lines.join('\n'), '设备信息')
  log('info', '设备信息已复制（脱敏状态：' + (masked.value ? '开启' : '关闭') + '）')
}
</script>
