<template>
  <div class="overlay" @click.self="close">
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">⚙ 设置</div>
        <button class="btn sm ghost" @click="close">关闭</button>
      </div>

      <div class="modal-body">
        <!-- 连接 -->
        <div class="section">
          <div class="section-title">① 设备连接</div>
          <div class="grid-2">
            <div class="field">
              <span class="field-label">Web 管理端地址</span>
              <input class="input mono" v-model="draft.base_url" placeholder="http://192.168.0.1" />
              <span class="field-hint">支持 http://IP、域名与反代地址；不要带 /#home 等片段。</span>
            </div>
            <div class="field">
              <span class="field-label">Web 登录密码</span>
              <input class="input" type="password" v-model="draft.password" placeholder="管理后台密码" @keyup.enter="testConnection" @change="onPasswordChange" />
              <span class="field-hint">输入密码后按回车、离开输入框或点下方按钮，都会立即保存并连接；连续失败会锁定设备，工具不会盲目重试。</span>
            </div>
            <div class="field">
              <span class="field-label">状态 / 速率刷新间隔（毫秒）</span>
              <input class="input" type="number" min="500" step="250" v-model.number="draft.refresh_ms" />
              <span class="field-hint">实时速率建议 1000 ms；间隔过小会增加设备负担。</span>
            </div>
            <div class="field">
              <span class="field-label">短信刷新间隔（毫秒）</span>
              <input class="input" type="number" min="3000" step="1000" v-model.number="draft.sms_refresh_ms" />
            </div>
          </div>
          <div class="row" style="margin-top:10px;gap:10px">
            <button class="btn sm primary" :disabled="connecting" @click="testConnection">{{ connecting ? '连接中…' : '测试连接（保存并立即连接）' }}</button>
            <span v-if="connectResult" :style="{ fontSize: '11px', color: connectResult.ok ? 'var(--accent)' : 'var(--red)' }">
              {{ connectResult.ok ? '✓ ' : '✗ ' }}{{ connectResult.text }}
            </span>
            <span v-else style="font-size:10.5px;color:var(--text-3)">恢复默认后填入密码即自动连接，无需先关掉设置窗口</span>
          </div>
        </div>

        <!-- 月度套餐 -->
        <div class="section">
          <div class="section-title">② 月度流量套餐额度</div>
          <div class="row" style="margin-bottom:10px">
            <Toggle v-model="draft.quota_enabled" label="启用套餐额度与超额预警" />
          </div>
          <div class="grid-3">
            <div class="field">
              <span class="field-label">套餐额度</span>
              <input class="input" type="number" min="0" step="1" v-model.number="draft.monthly_quota_gb" :disabled="!draft.quota_enabled" />
              <span class="field-hint">填 0 表示不设额度。此额度仅保存在本机，不修改设备配置。</span>
            </div>
            <div class="field">
              <span class="field-label">单位</span>
              <select class="select" v-model="draft.quota_unit" :disabled="!draft.quota_enabled">
                <option value="GB">GB</option><option value="MB">MB</option><option value="TB">TB</option>
              </select>
            </div>
            <div class="field">
              <span class="field-label">预警阈值（%）</span>
              <input class="input" type="number" min="1" max="100" v-model.number="draft.quota_warn_pct" :disabled="!draft.quota_enabled" />
            </div>
          </div>
          <div class="grid-2" style="margin-top:11px">
            <div class="field">
              <span class="field-label">账单重置日（每月）</span>
              <input class="input" type="number" min="1" max="31" v-model.number="draft.quota_reset_day" :disabled="!draft.quota_enabled || draft.quota_auto_reset" />
            </div>
            <div class="field">
              <span class="field-label">&nbsp;</span>
              <Toggle v-model="draft.quota_auto_reset" label="跟随设备账单日（flux_clear_date）" hint="真机当前为每月 1 号" :disabled="!draft.quota_enabled" />
              <span class="field-hint">用量取设备 monthly_rx_bytes + monthly_tx_bytes；今日用量由本地基线差值计算。</span>
            </div>
          </div>
        </div>

        <!-- 通知 -->
        <div class="section">
          <div class="section-title">③ 新短信通知 / 流量预警转发</div>
          <div class="row" style="margin-bottom:10px">
            <Toggle v-model="draft.notify_enabled" label="启用通知转发" />
            <Toggle v-model="draft.notify_new_sms" label="新短信到达时推送" :disabled="!draft.notify_enabled" />
            <Toggle v-model="draft.sms_icon_alert" label="新短信图标闪烁提醒" hint="窗口最小化/失焦时任务栏闪烁 + 托盘图标跳动；预览模式为页签标题与图标闪烁" />
          </div>
          <div class="field">
            <span class="field-label">Webhook / Bark 地址</span>
            <input class="input mono" v-model="draft.notify_url" placeholder="https://api.day.app/xxxx/{title}/{body} 或自建 Webhook" :disabled="!draft.notify_enabled" />
            <span class="field-hint">
              含 <span class="kbd">{title}</span> / <span class="kbd">{body}</span> 占位符时按 GET 请求（兼容 Bark）；否则按 POST 发送 JSON。
              也可对接企业微信机器人、Server 酱等。
            </span>
          </div>
          <div class="row" style="margin-top:8px">
            <button class="btn sm" :disabled="!draft.notify_url" @click="testNotify">发送测试通知</button>
            <button class="btn sm" @click="testIconAlert">测试图标提醒</button>
            <span style="font-size:10.5px;color:var(--text-3)">最小化窗口后测试效果更明显；切回窗口自动恢复</span>
          </div>
        </div>

        <!-- 界面与文件 -->
        <div class="section">
          <div class="section-title">④ 界面、日志与导出目录</div>
          <div class="grid-2">
            <div class="field">
              <span class="field-label">主题</span>
              <select class="select" v-model="draft.theme">
                <option value="light">浅色（默认）</option><option value="dark">深色</option>
              </select>
            </div>
            <div class="field">
              <span class="field-label">日志最大行数</span>
              <input class="input" type="number" min="50" max="5000" v-model.number="draft.log_max_lines" />
            </div>
          </div>
          <div class="field" style="margin-top:11px">
            <span class="field-label">导出目录（短信 / 日志）</span>
            <div class="row">
              <input class="input mono" style="flex:1" v-model="draft.export_dir" placeholder="D:\监控导出  或  \\NAS\Share\F50导出" />
              <button class="btn" @click="browse">浏览…</button>
              <button class="btn" @click="testPath">测试写入</button>
            </div>
            <span class="field-hint">原生支持中文路径与 SMB 挂载的网络磁盘 / UNC 路径（\\服务器\共享\目录）。预览模式下使用原生目录选择需 Tauri 版本。</span>
          </div>
        </div>

        <!-- 高级 -->
        <div class="section">
          <div class="section-title">⑤ 高级</div>
          <div class="row" style="gap:16px">
            <Toggle v-model="draft.sms_hex_lowercase" label="短信正文使用小写十六进制" hint="极个别固件需要；默认使用大写（与 web 端 encodeMessage 一致）" />
            <Toggle v-model="draft.launch_at_login" label="开机自启动" hint="仅 Tauri 原生版生效" />
            <Toggle v-model="draft.minimize_to_tray" label="最小化到系统托盘" hint="仅 Tauri 原生版生效" />
          </div>
          <div class="row" style="margin-top:11px">
            <button class="btn" @click="runDiag">运行接口自检</button>
            <span style="font-size:10.5px;color:var(--text-3)">只读探测全部接口，用于排查适配问题</span>
          </div>
        </div>

        <div class="notice warn">
          安全提示：管理密码以明文保存在本机配置文件（<span class="kbd">%APPDATA%\F50_Pro_Monitor\config.json</span> 或预览模式的 <span class="kbd">.runtime/config.json</span>）。请勿把该文件或整个目录上传到公开仓库；对外分享时请先清空密码字段并对 IMSI / ICCID / IMEI 脱敏。
        </div>
      </div>

      <div class="modal-foot">
        <span style="margin-right:auto;font-size:10.5px;color:var(--text-3)">所有会改变设备状态的写操作均需二次确认，默认不自动执行</span>
        <button class="btn danger" :disabled="saving" @click="resetDefaults">恢复默认</button>
        <button class="btn" @click="close">取消</button>
        <button class="btn primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import Toggle from './Toggle.vue'
import { state, saveConfig, resetConfig, askConfirm, testIconAlert, log, chooseExportDir, exportText, runDiagnose } from '../stores/f50Store.js'
import { call } from '../transport.js'

const draft = reactive({ ...state.config })
const saving = ref(false)
const connecting = ref(false)
const connectResult = ref(null)

function close() { state.view.settings = false }

async function save() {
  saving.value = true
  try {
    await saveConfig({ ...draft })
    log('ok', `月度套餐：${draft.quota_enabled ? `${draft.monthly_quota_gb} ${draft.quota_unit}` : '未启用'}，重置日 ${draft.quota_auto_reset ? '跟随设备' : draft.quota_reset_day}`)
    close()
  } catch (e) {
    log('error', `保存设置失败：${e.message}`)
  } finally {
    saving.value = false
  }
}

/** 保存当前草稿并立即强制重连（清会话 + 重新登录），把结果显示在设置面板里。 */
async function testConnection() {
  if (connecting.value) return
  connecting.value = true
  connectResult.value = null
  try {
    const r = await saveConfig({ ...draft })
    const detail = r.ok
      ? `已连接 · ${state.status.connection_text || '设备在线'} · ${state.status.network_provider || ''}`
      : (r.error || '连接失败')
    connectResult.value = { ok: !!r.ok, text: detail }
  } catch (e) {
    connectResult.value = { ok: false, text: e.message }
  } finally {
    connecting.value = false
  }
}

/** 恢复默认后填入密码，失焦即自动连接（仅在「因缺密码而离线」时触发，避免误用错误密码反复登录）。 */
function onPasswordChange() {
  if (draft.password && state.status.online === false && state.status.need_config === true) {
    testConnection()
  }
}

async function resetDefaults() {
  const ok = await askConfirm({
    title: '恢复默认设置',
    message: '将清除本机保存的全部配置并恢复默认参数。',
    detail: '默认 Web 管理地址：http://192.168.0.1\n默认登录密码：空（需要在设置中重新填写）\n\n月度套餐额度、通知地址、导出目录、主题、开机自启、图标提醒与本地流量基线都会一并重置。',
    notice: '此操作只清除本机配置文件，不会向设备下发任何指令，也不会修改设备配置。',
    confirm_text: '确认恢复',
    danger: true
  })
  if (!ok) { log('info', '已取消：恢复默认设置'); return }
  saving.value = true
  try {
    await resetConfig()
    Object.assign(draft, state.config)
    log('ok', '已恢复默认参数，请填写 Web 登录密码后点击「保存设置」')
  } catch (e) {
    log('error', `恢复默认失败：${e.message}`)
  } finally {
    saving.value = false
  }
}

async function browse() {
  const p = await chooseExportDir()
  if (p) draft.export_dir = p
}
async function testPath() {
  if (!draft.export_dir) { log('warn', '请先填写导出目录'); return }
  const prev = state.config.export_dir
  state.config.export_dir = draft.export_dir
  await exportText('F50Pro_路径测试.txt', `路径写入测试\n时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}\n目录: ${draft.export_dir}\n`)
  state.config.export_dir = prev
}
async function testNotify() {
  try {
    const r = await call('send_notification', {
      title: 'F50 Pro Monitor 测试', body: '这是一条测试通知',
      url: draft.notify_url, force: true
    })
    if (r?.ok) log('ok', '测试通知已发送')
    else log('warn', `测试通知未送达：${r?.error || r?.message || '请检查地址'}`)
  } catch (e) {
    log('error', `测试通知失败：${e.message}`)
  }
}
async function runDiag() { close(); await runDiagnose() }
</script>
