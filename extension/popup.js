/**
 * B站直播间监控助手 - Popup交互逻辑
 */

// DOM元素引用
const elements = {
  // 状态显示
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  monitorStatus: document.getElementById('monitorStatus'),
  
  // 标签页
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  
  // 监控页
  roomInput: document.getElementById('roomInput'),
  addBtn: document.getElementById('addBtn'),
  startMonitorBtn: document.getElementById('startMonitorBtn'),
  stopMonitorBtn: document.getElementById('stopMonitorBtn'),
  controlInfo: document.getElementById('controlInfo'),
  streamerList: document.getElementById('streamerList'),
  emptyStreamers: document.getElementById('emptyStreamers'),
  streamerCount: document.getElementById('streamerCount'),
  
  // 设置页
  pollInterval: document.getElementById('pollInterval'),
  videoQuality: document.getElementById('videoQuality'),
  videoFormat: document.getElementById('videoFormat'),
  enableNotification: document.getElementById('enableNotification'),
  enableSound: document.getElementById('enableSound'),
  enableRecord: document.getElementById('enableRecord'),
  autoOpenRecord: document.getElementById('autoOpenRecord'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  testNotifyBtn: document.getElementById('testNotifyBtn'),
  
  // 历史页
  historyList: document.getElementById('historyList'),
  emptyHistory: document.getElementById('emptyHistory'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  
  // 辅助元素
  loadingOverlay: document.getElementById('loadingOverlay'),
  loadingText: document.getElementById('loadingText'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toastMessage'),
  helpLink: document.getElementById('helpLink')
};

// 全局状态
let state = {
  isMonitoring: false,
  recordingRooms: [],
  streamers: [],
  config: null,
  history: []
};

// ==================== 初始化 ====================

/**
 * 初始化Popup
 */
async function init() {
  try {
    // 绑定事件
    bindEvents();
    
    // 加载数据
    await loadAllData();
    
    // 开始状态更新轮询
    startStatusPolling();
    
    console.log('Popup初始化完成');
    
  } catch (error) {
    console.error('初始化失败:', error);
    showToast('初始化失败: ' + error.message, 'error');
  }
}

/**
 * 加载所有数据
 */
async function loadAllData() {
  await Promise.all([
    loadMonitorStatus(),
    loadStreamers(),
    loadConfig(),
    loadHistory()
  ]);
}

/**
 * 绑定事件
 */
function bindEvents() {
  // 标签页切换
  elements.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  
  // 添加主播
  elements.addBtn.addEventListener('click', handleAddStreamer);
  elements.roomInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddStreamer();
  });
  
  // 监控控制
  elements.startMonitorBtn.addEventListener('click', startMonitoring);
  elements.stopMonitorBtn.addEventListener('click', stopMonitoring);
  
  // 设置
  elements.saveSettingsBtn.addEventListener('click', saveSettings);
  elements.testNotifyBtn.addEventListener('click', testNotification);
  
  // 历史
  elements.clearHistoryBtn.addEventListener('click', clearHistory);
  
  // 帮助
  elements.helpLink.addEventListener('click', showHelp);
}

// ==================== 标签页切换 ====================

/**
 * 切换标签页
 */
function switchTab(tabName) {
  // 更新按钮状态
  elements.tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  
  // 更新内容显示
  elements.tabContents.forEach(content => {
    const isActive = content.id === `tab-${tabName}`;
    content.classList.toggle('active', isActive);
    
    // 切换到历史页时刷新
    if (isActive && tabName === 'history') {
      loadHistory();
    }
  });
}

// ==================== 后台通信 ====================

/**
 * 发送消息到后台
 */
async function sendMessage(type, data = {}) {
  try {
    return await chrome.runtime.sendMessage({
      type,
      ...data
    });
  } catch (error) {
    console.error('发送消息失败:', error);
    throw error;
  }
}

// ==================== 监控状态 ====================

/**
 * 加载监控状态
 */
async function loadMonitorStatus() {
  try {
    const response = await sendMessage('GET_MONITOR_STATUS');
    if (response.success) {
      state.isMonitoring = response.isMonitoring;
      state.recordingRooms = response.recordingRooms || [];
      updateMonitorUI();
    }
  } catch (error) {
    console.error('获取监控状态失败:', error);
  }
}

/**
 * 更新监控UI
 */
function updateMonitorUI() {
  // 更新头部状态
  if (state.isMonitoring) {
    elements.statusDot.classList.add('active');
    elements.statusText.textContent = '监控中';
    elements.startMonitorBtn.style.display = 'none';
    elements.stopMonitorBtn.style.display = 'inline-flex';
    
    if (state.recordingRooms.length > 0) {
      elements.statusDot.classList.add('live');
      elements.controlInfo.textContent = `正在录制 ${state.recordingRooms.length} 个直播间`;
    } else {
      elements.controlInfo.textContent = '等待主播开播...';
    }
  } else {
    elements.statusDot.classList.remove('active', 'live');
    elements.statusText.textContent = '未监控';
    elements.startMonitorBtn.style.display = 'inline-flex';
    elements.stopMonitorBtn.style.display = 'none';
    elements.controlInfo.textContent = '点击"开始监控"启动后台监控';
  }
}

/**
 * 开始监控
 */
async function startMonitoring() {
  // 检查是否有需要监控的主播
  const monitoringCount = state.streamers.filter(s => s.isMonitoring).length;
  if (monitoringCount === 0) {
    showToast('请先开启至少一个主播的监控', 'warning');
    return;
  }
  
  showLoading('正在启动监控...');
  
  try {
    const response = await sendMessage('START_MONITORING');
    hideLoading();
    
    if (response.success) {
      state.isMonitoring = response.isMonitoring;
      updateMonitorUI();
      showToast('监控已启动', 'success');
    } else {
      showToast('启动监控失败', 'error');
    }
  } catch (error) {
    hideLoading();
    showToast('启动监控失败: ' + error.message, 'error');
  }
}

/**
 * 停止监控
 */
async function stopMonitoring() {
  if (!confirm('确定要停止监控吗？正在进行的录制也将停止。')) {
    return;
  }
  
  showLoading('正在停止监控...');
  
  try {
    const response = await sendMessage('STOP_MONITORING');
    hideLoading();
    
    if (response.success) {
      state.isMonitoring = response.isMonitoring;
      updateMonitorUI();
      showToast('监控已停止', 'success');
    }
  } catch (error) {
    hideLoading();
    showToast('停止监控失败: ' + error.message, 'error');
  }
}

// ==================== 主播管理 ====================

/**
 * 加载主播列表
 */
async function loadStreamers() {
  try {
    const response = await sendMessage('GET_STREAMERS');
    if (response.success) {
      state.streamers = response.streamers || [];
      renderStreamerList();
    }
  } catch (error) {
    console.error('加载主播列表失败:', error);
  }
}

/**
 * 渲染主播列表
 */
function renderStreamerList() {
  // 更新计数
  elements.streamerCount.textContent = `共 ${state.streamers.length} 个`;
  
  // 清空列表
  const existingCards = elements.streamerList.querySelectorAll('.streamer-card');
  existingCards.forEach(card => card.remove());
  
  // 显示空状态
  if (state.streamers.length === 0) {
    elements.emptyStreamers.style.display = 'flex';
    return;
  }
  
  elements.emptyStreamers.style.display = 'none';
  
  // 渲染每个主播
  state.streamers.forEach(streamer => {
    const card = createStreamerCard(streamer);
    elements.streamerList.appendChild(card);
  });
}

/**
 * 创建主播卡片
 */
function createStreamerCard(streamer) {
  const card = document.createElement('div');
  card.className = 'streamer-card';
  
  // 状态类
  const isRecording = streamer.isRecording;
  const isLive = streamer.lastLiveStatus === 'live';
  const isMonitoring = streamer.isMonitoring;
  
  if (isRecording) {
    card.classList.add('recording');
  } else if (isLive) {
    card.classList.add('live');
  }
  
  if (isMonitoring) {
    card.classList.add('monitoring');
  }
  
  // 状态文本
  let statusClass = 'offline';
  let statusText = '未开播';
  let statusDotClass = 'offline';
  
  if (isRecording) {
    statusClass = 'recording';
    statusText = '录制中';
    statusDotClass = 'recording';
  } else if (isLive) {
    statusClass = 'live';
    statusText = '直播中';
    statusDotClass = 'live';
  }
  
  card.innerHTML = `
    <div class="streamer-info">
      <div class="streamer-main">
        <div class="streamer-name">${escapeHtml(streamer.streamerName)}</div>
        <div class="streamer-room-id">直播间: ${streamer.roomId}</div>
      </div>
      <div class="streamer-status">
        <span class="status-badge ${statusClass}">
          <span class="status-badge-dot ${statusDotClass}"></span>
          ${statusText}
        </span>
      </div>
    </div>
    <div class="streamer-actions">
      <div class="streamer-note">${escapeHtml(streamer.note || '无备注')}</div>
      <div class="streamer-buttons">
        <button class="btn btn-text" data-action="toggle" data-room-id="${streamer.roomId}">
          ${isMonitoring ? '关闭监控' : '开启监控'}
        </button>
        <button class="btn btn-text" data-action="open" data-room-id="${streamer.roomId}">
          打开
        </button>
        <button class="btn btn-text" data-action="delete" data-room-id="${streamer.roomId}">
          删除
        </button>
      </div>
    </div>
  `;
  
  // 绑定按钮事件
  card.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const roomId = btn.dataset.roomId;
      handleStreamerAction(action, roomId, streamer);
    });
  });
  
  // 双击切换监控
  card.addEventListener('dblclick', () => {
    handleStreamerAction('toggle', streamer.roomId, streamer);
  });
  
  return card;
}

/**
 * 处理主播操作
 */
async function handleStreamerAction(action, roomId, streamer) {
  switch (action) {
    case 'toggle':
      await toggleStreamerMonitoring(roomId, !streamer.isMonitoring);
      break;
    case 'open':
      openStreamerRoom(roomId);
      break;
    case 'delete':
      await deleteStreamer(roomId, streamer.streamerName);
      break;
  }
}

/**
 * 添加主播
 */
async function handleAddStreamer() {
  const input = elements.roomInput.value.trim();
  
  if (!input) {
    showToast('请输入直播间ID或链接', 'warning');
    return;
  }
  
  showLoading('正在验证直播间...');
  
  try {
    const response = await sendMessage('ADD_STREAMER', {
      roomId: input,
      note: ''
    });
    
    hideLoading();
    
    if (response.success) {
      elements.roomInput.value = '';
      showToast(response.message, 'success');
      await loadStreamers();
    } else {
      showToast(response.message, 'error');
    }
    
  } catch (error) {
    hideLoading();
    showToast('添加失败: ' + error.message, 'error');
  }
}

/**
 * 切换主播监控状态
 */
async function toggleStreamerMonitoring(roomId, enable) {
  try {
    const response = await sendMessage('TOGGLE_MONITORING', {
      roomId,
      enable
    });
    
    if (response.success) {
      const streamer = state.streamers.find(s => s.roomId === roomId);
      if (streamer) {
        streamer.isMonitoring = enable;
      }
      renderStreamerList();
      showToast(enable ? '已开启监控' : '已关闭监控', 'success');
    }
  } catch (error) {
    showToast('操作失败: ' + error.message, 'error');
  }
}

/**
 * 删除主播
 */
async function deleteStreamer(roomId, name) {
  if (!confirm(`确定要删除主播 "${name}" 吗？`)) {
    return;
  }
  
  try {
    const response = await sendMessage('REMOVE_STREAMER', { roomId });
    
    if (response.success) {
      await loadStreamers();
      showToast('已删除主播', 'success');
    } else {
      showToast('删除失败', 'error');
    }
  } catch (error) {
    showToast('删除失败: ' + error.message, 'error');
  }
}

/**
 * 打开直播间页面
 */
function openStreamerRoom(roomId) {
  chrome.tabs.create({
    url: `https://live.bilibili.com/${roomId}`
  });
}

// ==================== 设置管理 ====================

/**
 * 加载配置
 */
async function loadConfig() {
  try {
    const response = await sendMessage('GET_CONFIG');
    if (response.success) {
      state.config = response.config;
      fillConfigToUI();
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
}

/**
 * 填充配置到UI
 */
function fillConfigToUI() {
  if (!state.config) return;
  
  elements.pollInterval.value = state.config.pollInterval || 10;
  elements.videoQuality.value = state.config.videoQuality || '原画';
  elements.videoFormat.value = state.config.videoFormat || 'webm';
  elements.enableNotification.checked = state.config.enableNotification !== false;
  elements.enableSound.checked = state.config.enableSound !== false;
  elements.enableRecord.checked = state.config.enableRecord !== false;
  elements.autoOpenRecord.checked = state.config.autoOpenRecord !== false;
}

/**
 * 保存设置
 */
async function saveSettings() {
  const newConfig = {
    pollInterval: parseInt(elements.pollInterval.value) || 10,
    videoQuality: elements.videoQuality.value,
    videoFormat: elements.videoFormat.value,
    enableNotification: elements.enableNotification.checked,
    enableSound: elements.enableSound.checked,
    enableRecord: elements.enableRecord.checked,
    autoOpenRecord: elements.autoOpenRecord.checked
  };
  
  // 验证
  if (newConfig.pollInterval < 5) {
    newConfig.pollInterval = 5;
    elements.pollInterval.value = 5;
  }
  
  showLoading('正在保存设置...');
  
  try {
    const response = await sendMessage('SAVE_CONFIG', { config: newConfig });
    hideLoading();
    
    if (response.success) {
      state.config = newConfig;
      showToast('设置已保存', 'success');
    } else {
      showToast('保存失败', 'error');
    }
  } catch (error) {
    hideLoading();
    showToast('保存失败: ' + error.message, 'error');
  }
}

/**
 * 测试通知
 */
async function testNotification() {
  try {
    showLoading('正在发送测试通知...');
    
    const response = await sendNotificationDirect();
    
    hideLoading();
    
    if (response.success) {
      showToast('测试通知已发送，请查看系统通知栏', 'success');
    } else {
      showToast(response.error || '发送失败', 'error');
    }
    
  } catch (error) {
    hideLoading();
    showToast('测试失败: ' + error.message, 'error');
  }
}

async function sendNotificationDirect() {
  try {
    const iconData = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IiMwMGExZDYiIHJ4PSIxNiIvPjx0ZXh0IHg9IjY0IiB5PSI4NSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjYwIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+8J+TwTwvdGV4dD48L3N2Zz4=';
    
    return await chrome.notifications.create('test_notification_' + Date.now(), {
      type: 'basic',
      iconUrl: iconData,
      title: 'B站直播间监控助手 - 测试通知',
      message: '恭喜！通知功能正常工作！\n\n开播时您将收到类似的提醒。',
      priority: 2,
      requireInteraction: true
    });
  } catch (error) {
    console.error('发送通知失败:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 历史记录 ====================

/**
 * 加载历史记录
 */
async function loadHistory() {
  try {
    const response = await sendMessage('GET_HISTORY');
    if (response.success) {
      state.history = response.history || [];
      renderHistoryList();
    }
  } catch (error) {
    console.error('加载历史失败:', error);
  }
}

/**
 * 渲染历史列表
 */
function renderHistoryList() {
  // 清空列表
  const existingCards = elements.historyList.querySelectorAll('.history-card');
  existingCards.forEach(card => card.remove());
  
  if (state.history.length === 0) {
    elements.emptyHistory.style.display = 'flex';
    return;
  }
  
  elements.emptyHistory.style.display = 'none';
  
  state.history.slice(0, 50).forEach(record => {
    const card = createHistoryCard(record);
    elements.historyList.appendChild(card);
  });
}

/**
 * 创建历史卡片
 */
function createHistoryCard(record) {
  const card = document.createElement('div');
  card.className = 'history-card';
  
  const startTime = record.startTime ? new Date(record.startTime).toLocaleString('zh-CN') : '未知';
  const duration = formatDuration(record.duration);
  const fileSize = formatFileSize(record.fileSize);
  
  card.innerHTML = `
    <div class="history-header-row">
      <div class="history-name">${escapeHtml(record.streamerName || '未知主播')}</div>
      <span class="history-status ${record.status || 'completed'}">
        ${record.status === 'completed' ? '已完成' : '已中断'}
      </span>
    </div>
    <div class="history-title">${escapeHtml(record.title || '无标题')}</div>
    <div class="history-meta">
      <span class="history-meta-item">📅 ${startTime}</span>
      <span class="history-meta-item">⏱ ${duration}</span>
      <span class="history-meta-item">💾 ${fileSize}</span>
    </div>
  `;
  
  return card;
}

/**
 * 清空历史
 */
async function clearHistory() {
  if (!confirm('确定要清空所有录屏历史吗？')) {
    return;
  }
  
  try {
    const response = await sendMessage('CLEAR_HISTORY');
    if (response.success) {
      await loadHistory();
      showToast('历史记录已清空', 'success');
    }
  } catch (error) {
    showToast('清空失败: ' + error.message, 'error');
  }
}

// ==================== 状态轮询 ====================

/**
 * 开始状态轮询
 */
function startStatusPolling() {
  // 每2秒更新一次状态
  setInterval(async () => {
    await loadMonitorStatus();
    // 检查是否在监控，如果在监控则刷新主播列表状态
    if (state.isMonitoring) {
      await loadStreamers();
    }
  }, 2000);
}

// ==================== 工具函数 ====================

/**
 * HTML转义
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 格式化时长
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '未知';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}小时${m}分${s}秒`;
  }
  return `${m}分${s}秒`;
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

/**
 * 显示加载
 */
function showLoading(text = '处理中...') {
  elements.loadingText.textContent = text;
  elements.loadingOverlay.style.display = 'flex';
}

/**
 * 隐藏加载
 */
function hideLoading() {
  elements.loadingOverlay.style.display = 'none';
}

/**
 * 显示Toast
 */
function showToast(message, type = 'info') {
  elements.toastMessage.textContent = message;
  elements.toast.className = 'toast';
  elements.toast.classList.add(type, 'show');
  
  setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 3000);
}

/**
 * 显示帮助
 */
function showHelp() {
  const helpText = `
使用说明：

【添加主播】
在输入框中输入以下任意一种格式：
• 纯数字ID：如 123456
• 直播间链接：https://live.bilibili.com/123456
• 主播主页：https://space.bilibili.com/123456

【开启监控】
1. 双击主播列表项快速开启/关闭监控
2. 或点击"开启监控"按钮
3. 点击"开始监控"启动后台轮询

【录制说明】
• 检测到开播后自动打开直播间页面
• 需要授权浏览器录制标签页
• 视频下载到浏览器默认下载目录

【录制授权】
首次录制时，浏览器会弹出权限请求：
1. 选择"整个屏幕"或"标签页"
2. 点击"分享"按钮
3. 建议选择需要录制的标签页
  `;
  
  alert(helpText);
}

// 启动
document.addEventListener('DOMContentLoaded', init);
