/**
 * B站直播间监控助手 - 后台服务脚本
 * 功能：直播间状态轮询、自动打开页面、录制控制、通知提醒
 */

// ==================== 常量定义 ====================
const CONSTANTS = {
  // B站API接口
  API_ROOM_INIT: "https://api.live.bilibili.com/room/v1/Room/room_init",
  API_ROOM_INFO: "https://api.live.bilibili.com/room/v1/Room/get_info",
  API_USER_INFO: "https://api.live.bilibili.com/live_user/v1/Master/info",
  
  // 默认配置
  DEFAULT_POLL_INTERVAL: 10,    // 默认轮询间隔（秒）
  DEFAULT_VIDEO_QUALITY: '原画',  // 默认画质
  DEFAULT_VIDEO_FORMAT: 'mp4',    // 默认格式
  DEFAULT_ENABLE_NOTIFICATION: true,
  DEFAULT_ENABLE_SOUND: true,
  DEFAULT_ENABLE_RECORD: true,
  
  // 存储键名
  STORAGE_STREAMERS: 'streamers',
  STORAGE_CONFIG: 'config',
  STORAGE_STATE: 'state',
  STORAGE_HISTORY: 'history'
};

// ==================== 全局状态 ====================
let globalState = {
  isMonitoring: false,           // 是否正在监控
  pollingTimer: null,            // 轮询定时器
  recordingRooms: new Map(),     // 正在录制的房间 Map<roomId, tabInfo>
  lastNotifyTime: new Map(),     // 上次通知时间 Map<roomId, timestamp>
  notificationCooldown: 60000    // 通知冷却时间（毫秒）
};

// ==================== 工具函数 ====================

/**
 * 日志输出（带时间戳）
 */
function log(message, ...args) {
  const timestamp = new Date().toLocaleString('zh-CN');
  console.log(`[${timestamp}] ${message}`, ...args);
}

/**
 * 从输入字符串提取直播间ID
 * 支持：纯数字ID、直播间链接、主播主页链接、短链接
 */
function extractRoomId(input) {
  if (!input) return null;
  
  input = input.trim();
  
  // 1. 纯数字ID
  if (/^\d+$/.test(input)) {
    return input;
  }
  
  // 2. 直播间链接: live.bilibili.com/123456
  const liveMatch = input.match(/live\.bilibili\.com\/(\d+)/);
  if (liveMatch) {
    return liveMatch[1];
  }
  
  // 3. 主播主页链接: space.bilibili.com/123456
  // 注意：需要调用API获取直播间ID，这里先不处理
  
  return null;
}

/**
 * 格式化时长
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

// ==================== B站API调用 ====================

/**
 * 调用B站API获取直播间基础信息
 */
async function fetchRoomInfo(roomId) {
  try {
    log(`获取直播间信息: ${roomId}`);
    
    // 第一步：获取房间初始化信息
    const initResponse = await fetch(`${CONSTANTS.API_ROOM_INIT}?id=${roomId}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://live.bilibili.com/'
      },
      credentials: 'include'
    });
    
    const initData = await initResponse.json();
    
    if (initData.code !== 0) {
      log(`获取房间初始化信息失败: ${initData.message}`);
      return null;
    }
    
    const initRoomData = initData.data;
    const realRoomId = initRoomData.room_id || roomId;
    const uid = initRoomData.uid;
    const liveStatus = initRoomData.live_status; // 0:未开播, 1:直播中, 2:轮播
    
    // 第二步：获取房间详细信息
    let roomTitle = '';
    let liveTime = '';
    let areaName = '';
    
    try {
      const infoResponse = await fetch(`${CONSTANTS.API_ROOM_INFO}?room_id=${realRoomId}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://live.bilibili.com/'
        },
        credentials: 'include'
      });
      
      const infoData = await infoResponse.json();
      if (infoData.code === 0 && infoData.data) {
        roomTitle = infoData.data.title || '';
        liveTime = infoData.data.live_time || '';
        areaName = infoData.data.area_name || '';
      }
    } catch (e) {
      log(`获取房间详细信息出错: ${e.message}`);
    }
    
    // 第三步：获取主播信息
    let streamerName = `主播_${realRoomId}`;
    try {
      const userResponse = await fetch(`${CONSTANTS.API_USER_INFO}?uid=${uid}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://live.bilibili.com/'
        },
        credentials: 'include'
      });
      
      const userData = await userResponse.json();
      if (userData.code === 0 && userData.data) {
        streamerName = userData.data.info?.uname || streamerName;
      }
    } catch (e) {
      log(`获取主播信息出错: ${e.message}`);
    }
    
    return {
      roomId: String(realRoomId),
      uid: uid,
      streamerName: streamerName,
      title: roomTitle,
      liveStatus: liveStatus,
      isLive: liveStatus === 1,
      isRoundPlaying: liveStatus === 2,
      liveTime: liveTime,
      areaName: areaName
    };
    
  } catch (error) {
    log(`获取直播间信息异常: ${error.message}`);
    return null;
  }
}

/**
 * 验证直播间是否存在
 */
async function verifyRoomExists(roomId) {
  const roomInfo = await fetchRoomInfo(roomId);
  return {
    exists: roomInfo !== null,
    roomInfo: roomInfo
  };
}

// ==================== 存储操作 ====================

/**
 * 获取配置
 */
async function getConfig() {
  const result = await chrome.storage.local.get(CONSTANTS.STORAGE_CONFIG);
  const savedConfig = result[CONSTANTS.STORAGE_CONFIG] || {};
  
  return {
    pollInterval: savedConfig.pollInterval || CONSTANTS.DEFAULT_POLL_INTERVAL,
    videoQuality: savedConfig.videoQuality || CONSTANTS.DEFAULT_VIDEO_QUALITY,
    videoFormat: savedConfig.videoFormat || CONSTANTS.DEFAULT_VIDEO_FORMAT,
    enableNotification: savedConfig.enableNotification !== false,
    enableSound: savedConfig.enableSound !== false,
    enableRecord: savedConfig.enableRecord !== false,
    savePath: savedConfig.savePath || ''
  };
}

/**
 * 保存配置
 */
async function saveConfig(config) {
  await chrome.storage.local.set({
    [CONSTANTS.STORAGE_CONFIG]: config
  });
}

/**
 * 获取主播列表
 */
async function getStreamers() {
  const result = await chrome.storage.local.get(CONSTANTS.STORAGE_STREAMERS);
  return result[CONSTANTS.STORAGE_STREAMERS] || [];
}

/**
 * 保存主播列表
 */
async function saveStreamers(streamers) {
  await chrome.storage.local.set({
    [CONSTANTS.STORAGE_STREAMERS]: streamers
  });
}

/**
 * 添加主播
 */
async function addStreamer(roomId, streamerName = '', note = '') {
  const streamers = await getStreamers();
  
  // 检查是否已存在
  const exists = streamers.find(s => s.roomId === roomId);
  if (exists) {
    return { success: false, message: '该主播已在监控列表中' };
  }
  
  // 获取直播间信息
  const roomInfo = await fetchRoomInfo(roomId);
  if (!roomInfo) {
    return { success: false, message: '无法获取直播间信息，请检查ID是否正确' };
  }
  
  const newStreamer = {
    roomId: roomInfo.roomId,
    streamerName: streamerName || roomInfo.streamerName,
    note: note || '',
    isMonitoring: true,
    lastLiveStatus: roomInfo.isLive ? 'live' : 'offline',
    lastLiveTime: roomInfo.liveTime || '',
    addedTime: new Date().toISOString(),
    lastCheckTime: new Date().toISOString()
  };
  
  streamers.push(newStreamer);
  await saveStreamers(streamers);
  
  return { 
    success: true, 
    message: `成功添加主播: ${newStreamer.streamerName}`,
    streamer: newStreamer
  };
}

/**
 * 删除主播
 */
async function removeStreamer(roomId) {
  const streamers = await getStreamers();
  const newStreamers = streamers.filter(s => s.roomId !== roomId);
  
  if (newStreamers.length === streamers.length) {
    return false;
  }
  
  await saveStreamers(newStreamers);
  
  // 如果正在录制，停止录制
  if (globalState.recordingRooms.has(roomId)) {
    await stopRecording(roomId);
  }
  
  return true;
}

/**
 * 更新主播监控状态
 */
async function toggleStreamerMonitoring(roomId, enable = null) {
  const streamers = await getStreamers();
  const streamer = streamers.find(s => s.roomId === roomId);
  
  if (!streamer) {
    return false;
  }
  
  if (enable === null) {
    enable = !streamer.isMonitoring;
  }
  
  streamer.isMonitoring = enable;
  await saveStreamers(streamers);
  
  return true;
}

/**
 * 获取录屏历史
 */
async function getHistory() {
  const result = await chrome.storage.local.get(CONSTANTS.STORAGE_HISTORY);
  return result[CONSTANTS.STORAGE_HISTORY] || [];
}

/**
 * 添加录屏历史
 */
async function addHistory(record) {
  const history = await getHistory();
  
  const newRecord = {
    id: Date.now(),
    roomId: record.roomId || '',
    streamerName: record.streamerName || '',
    title: record.title || '',
    startTime: record.startTime || new Date().toISOString(),
    endTime: record.endTime || new Date().toISOString(),
    duration: record.duration || 0,
    fileSize: record.fileSize || 0,
    fileName: record.fileName || '',
    status: record.status || 'completed'
  };
  
  history.unshift(newRecord);
  
  // 只保留最近100条
  if (history.length > 100) {
    history.splice(100);
  }
  
  await chrome.storage.local.set({
    [CONSTANTS.STORAGE_HISTORY]: history
  });
  
  return newRecord;
}

// ==================== 通知系统 ====================

/**
 * 发送桌面通知
 */
async function sendNotification(roomId, title, message, type = 'info') {
  const config = await getConfig();
  
  // 检查是否启用通知
  if (!config.enableNotification) {
    return;
  }
  
  // 检查冷却时间
  const now = Date.now();
  const lastNotify = globalState.lastNotifyTime.get(roomId) || 0;
  if (now - lastNotify < globalState.notificationCooldown) {
    log(`通知冷却中，跳过: ${roomId}`);
    return;
  }
  
  globalState.lastNotifyTime.set(roomId, now);
  
  // 创建通知
  const notificationId = `bilibili_monitor_${Date.now()}`;
  
  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message,
    priority: type === 'live' ? 2 : 0,
    requireInteraction: type === 'live'
  });
  
  // 播放提示音
  if (config.enableSound && type === 'live') {
    await playNotificationSound();
  }
  
  log(`发送通知: ${title} - ${message}`);
}

/**
 * 播放提示音
 * 注意：Service Worker中不能直接播放音频，需要通过offscreen或其他方式
 */
async function playNotificationSound() {
  // 方案1：通过创建offscreen文档播放音频
  // 方案2：使用通知的sound属性（部分浏览器支持）
  
  try {
    // 检查是否已有offscreen文档
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    if (existingContexts.length === 0) {
      // 创建offscreen文档
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: '播放开播提示音'
      });
    }
    
    // 发送消息到offscreen播放音频
    await chrome.runtime.sendMessage({
      type: 'PLAY_SOUND',
      sound: 'notification'
    });
    
  } catch (error) {
    log(`播放提示音出错: ${error.message}`);
  }
}

// ==================== 录制系统 ====================

/**
 * 开始录制
 * 流程：打开直播间页面 -> 注入脚本 -> 开始录制
 */
async function startRecording(roomId, roomInfo) {
  // 检查是否已在录制
  if (globalState.recordingRooms.has(roomId)) {
    log(`房间 ${roomId} 已经在录制中`);
    return false;
  }
  
  const config = await getConfig();
  if (!config.enableRecord) {
    log(`自动录制功能未开启`);
    return false;
  }
  
  log(`开始录制: ${roomInfo.streamerName} (${roomId})`);
  
  try {
    // 打开直播间页面
    const tab = await chrome.tabs.create({
      url: `https://live.bilibili.com/${roomId}`,
      active: false,  // 后台打开，不激活
      pinned: false
    });
    
    log(`已打开直播间页面: tabId=${tab.id}`);
    
    // 记录录制状态
    globalState.recordingRooms.set(roomId, {
      tabId: tab.id,
      roomId: roomId,
      streamerName: roomInfo.streamerName,
      title: roomInfo.title,
      startTime: Date.now(),
      status: 'waiting_page'
    });
    
    // 等待页面加载，然后发送录制指令
    setTimeout(async () => {
      await sendRecordCommand(tab.id, roomId, 'START');
    }, 5000);  // 等待5秒让页面加载
    
    return true;
    
  } catch (error) {
    log(`开始录制失败: ${error.message}`);
    globalState.recordingRooms.delete(roomId);
    return false;
  }
}

/**
 * 停止录制
 */
async function stopRecording(roomId) {
  const recordingInfo = globalState.recordingRooms.get(roomId);
  if (!recordingInfo) {
    log(`房间 ${roomId} 不在录制中`);
    return false;
  }
  
  log(`停止录制: ${recordingInfo.streamerName} (${roomId})`);
  
  try {
    // 发送停止录制指令
    await sendRecordCommand(recordingInfo.tabId, roomId, 'STOP');
    
    // 稍后关闭标签页（给录制完成一点时间）
    setTimeout(async () => {
      try {
        await chrome.tabs.remove(recordingInfo.tabId);
        log(`已关闭直播间标签页: tabId=${recordingInfo.tabId}`);
      } catch (e) {
        log(`关闭标签页失败: ${e.message}`);
      }
    }, 3000);
    
    globalState.recordingRooms.delete(roomId);
    return true;
    
  } catch (error) {
    log(`停止录制失败: ${error.message}`);
    globalState.recordingRooms.delete(roomId);
    return false;
  }
}

/**
 * 向标签页发送录制指令
 */
async function sendRecordCommand(tabId, roomId, command) {
  try {
    // 先注入脚本（防止页面还没加载content script）
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    
    // 发送消息
    await chrome.tabs.sendMessage(tabId, {
      type: 'RECORD_COMMAND',
      command: command,
      roomId: roomId,
      config: await getConfig()
    });
    
    log(`已发送录制指令 [${command}] 到 tabId=${tabId}`);
    
  } catch (error) {
    log(`发送录制指令失败: ${error.message}`);
  }
}

// ==================== 监控核心逻辑 ====================

/**
 * 启动监控
 */
async function startMonitoring() {
  if (globalState.isMonitoring) {
    log('监控已经在运行中');
    return;
  }
  
  const config = await getConfig();
  const streamers = await getStreamers();
  
  const monitoringCount = streamers.filter(s => s.isMonitoring).length;
  
  if (monitoringCount === 0) {
    log('没有需要监控的主播');
    return;
  }
  
  globalState.isMonitoring = true;
  log(`启动监控，轮询间隔: ${config.pollInterval}秒，监控主播数: ${monitoringCount}`);
  
  // 立即执行一次检查
  await performMonitorCheck();
  
  // 设置周期性检查
  if (globalState.pollingTimer) {
    clearInterval(globalState.pollingTimer);
  }
  
  globalState.pollingTimer = setInterval(async () => {
    if (globalState.isMonitoring) {
      await performMonitorCheck();
    }
  }, config.pollInterval * 1000);
  
  // 更新图标
  await updateExtensionIcon('active');
  
  // 发送通知
  await sendNotification('system', '监控已启动', `正在监控 ${monitoringCount} 个主播`, 'info');
}

/**
 * 停止监控
 */
async function stopMonitoring() {
  if (!globalState.isMonitoring) {
    return;
  }
  
  globalState.isMonitoring = false;
  
  if (globalState.pollingTimer) {
    clearInterval(globalState.pollingTimer);
    globalState.pollingTimer = null;
  }
  
  log('停止监控');
  
  // 停止所有录制
  for (const roomId of globalState.recordingRooms.keys()) {
    await stopRecording(roomId);
  }
  
  // 更新图标
  await updateExtensionIcon('inactive');
}

/**
 * 更新扩展图标状态
 */
async function updateExtensionIcon(status) {
  try {
    // Manifest V3 使用 action
    const iconPath = status === 'active' ? 'icons/icon48.png' : 'icons/icon48.png';
    
    // 设置徽章文字
    if (status === 'active') {
      const streamers = await getStreamers();
      const liveCount = streamers.filter(s => s.lastLiveStatus === 'live').length;
      
      await chrome.action.setBadgeText({
        text: liveCount > 0 ? liveCount.toString() : ''
      });
      
      await chrome.action.setBadgeBackgroundColor({
        color: '#e74c3c'
      });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
    
  } catch (error) {
    log(`更新图标失败: ${error.message}`);
  }
}

/**
 * 执行一次监控检查
 */
async function performMonitorCheck() {
  const streamers = await getStreamers();
  const monitoringStreamers = streamers.filter(s => s.isMonitoring);
  
  log(`执行监控检查，共 ${monitoringStreamers.length} 个主播需要检查`);
  
  for (const streamer of monitoringStreamers) {
    try {
      await checkSingleStreamer(streamer);
    } catch (error) {
      log(`检查主播 ${streamer.roomId} 时出错: ${error.message}`);
    }
  }
  
  // 更新图标
  await updateExtensionIcon('active');
}

/**
 * 检查单个主播状态
 */
async function checkSingleStreamer(streamer) {
  const roomId = streamer.roomId;
  const lastStatus = streamer.lastLiveStatus;
  
  // 获取直播间信息
  const roomInfo = await fetchRoomInfo(roomId);
  
  if (!roomInfo) {
    log(`无法获取主播 ${roomId} 的状态，跳过本次检查`);
    return;
  }
  
  // 更新最后检查时间
  const streamers = await getStreamers();
  const targetStreamer = streamers.find(s => s.roomId === roomId);
  if (targetStreamer) {
    targetStreamer.lastCheckTime = new Date().toISOString();
    targetStreamer.streamerName = roomInfo.streamerName;
    await saveStreamers(streamers);
  }
  
  // 判断直播状态变化
  const currentStatus = roomInfo.isLive ? 'live' : 'offline';
  
  log(`主播 ${roomInfo.streamerName} (${roomId}) 状态: ${lastStatus} -> ${currentStatus}`);
  
  // 状态变化检测
  if (lastStatus !== currentStatus) {
    await handleStatusChange(streamer, roomInfo, lastStatus, currentStatus);
    
    // 更新存储的状态
    const streamersToUpdate = await getStreamers();
    const s = streamersToUpdate.find(x => x.roomId === roomId);
    if (s) {
      s.lastLiveStatus = currentStatus;
      if (currentStatus === 'live') {
        s.lastLiveTime = roomInfo.liveTime || new Date().toISOString();
      }
      await saveStreamers(streamersToUpdate);
    }
  }
  
  // 如果正在直播但不在录制中，检查是否需要启动录制
  if (currentStatus === 'live') {
    const config = await getConfig();
    if (config.enableRecord && !globalState.recordingRooms.has(roomId)) {
      log(`检测到主播正在直播但未录制，尝试启动录制: ${roomInfo.streamerName}`);
      await startRecording(roomId, roomInfo);
    }
  }
}

/**
 * 处理状态变化
 */
async function handleStatusChange(streamer, roomInfo, oldStatus, newStatus) {
  const streamerName = roomInfo.streamerName || streamer.streamerName;
  const roomId = streamer.roomId;
  
  log(`状态变化: ${streamerName} ${oldStatus} -> ${newStatus}`);
  
  if (newStatus === 'live') {
    // 开播了！
    const title = roomInfo.title || '未知标题';
    
    // 发送开播通知
    await sendNotification(
      roomId,
      `${streamerName} 开播了！`,
      `直播间: ${roomId}\n${title}`,
      'live'
    );
    
    // 开始录制
    const config = await getConfig();
    if (config.enableRecord) {
      await startRecording(roomId, roomInfo);
    }
    
  } else if (newStatus === 'offline') {
    // 下播了
    await sendNotification(
      roomId,
      `${streamerName} 下播了`,
      `直播间 ${roomId} 已结束直播`,
      'info'
    );
    
    // 停止录制
    if (globalState.recordingRooms.has(roomId)) {
      await stopRecording(roomId);
    }
  }
}

// ==================== 消息处理 ====================

/**
 * 处理来自Popup和Content Script的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 异步处理，需要返回true
  (async () => {
    try {
      let response = await handleMessage(message, sender);
      sendResponse(response);
    } catch (error) {
      log(`处理消息出错: ${error.message}`);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true;  // 保持消息通道打开
});

/**
 * 处理具体消息
 */
async function handleMessage(message, sender) {
  const type = message.type;
  
  log(`收到消息: ${type}`, sender.tab ? `from tab ${sender.tab.id}` : 'from extension');
  
  switch (type) {
    // ========== 监控控制 ==========
    case 'START_MONITORING':
      await startMonitoring();
      return { success: true, isMonitoring: globalState.isMonitoring };
      
    case 'STOP_MONITORING':
      await stopMonitoring();
      return { success: true, isMonitoring: globalState.isMonitoring };
      
    case 'GET_MONITOR_STATUS':
      return { 
        success: true, 
        isMonitoring: globalState.isMonitoring,
        recordingCount: globalState.recordingRooms.size,
        recordingRooms: Array.from(globalState.recordingRooms.keys())
      };
      
    // ========== 主播管理 ==========
    case 'ADD_STREAMER':
      return await addStreamer(message.roomId, message.streamerName, message.note);
      
    case 'REMOVE_STREAMER':
      const removed = await removeStreamer(message.roomId);
      return { success: removed };
      
    case 'TOGGLE_MONITORING':
      const toggled = await toggleStreamerMonitoring(message.roomId, message.enable);
      return { success: toggled };
      
    case 'GET_STREAMERS':
      const streamers = await getStreamers();
      // 补充当前录制状态
      for (const s of streamers) {
        s.isRecording = globalState.recordingRooms.has(s.roomId);
      }
      return { success: true, streamers };
      
    // ========== 配置管理 ==========
    case 'GET_CONFIG':
      const config = await getConfig();
      return { success: true, config };
      
    case 'SAVE_CONFIG':
      await saveConfig(message.config);
      // 如果轮询间隔改变，重启定时器
      if (globalState.isMonitoring) {
        const newConfig = await getConfig();
        if (globalState.pollingTimer) {
          clearInterval(globalState.pollingTimer);
        }
        globalState.pollingTimer = setInterval(async () => {
          if (globalState.isMonitoring) {
            await performMonitorCheck();
          }
        }, newConfig.pollInterval * 1000);
      }
      return { success: true };
      
    // ========== 录制相关 ==========
    case 'RECORD_COMPLETED':
      // 来自content script的录制完成消息
      log(`录制完成: ${message.roomId}`);
      
      // 添加到历史记录
      await addHistory({
        roomId: message.roomId,
        streamerName: message.streamerName || '',
        title: message.title || '',
        startTime: message.startTime,
        endTime: message.endTime,
        duration: message.duration,
        fileSize: message.fileSize,
        fileName: message.fileName,
        status: 'completed'
      });
      
      // 清理录制状态
      globalState.recordingRooms.delete(message.roomId);
      
      // 发送完成通知
      await sendNotification(
        message.roomId,
        '录制完成',
        `${message.streamerName} 的直播已录制完成`,
        'info'
      );
      
      return { success: true };
      
    case 'RECORD_ERROR':
      log(`录制出错: ${message.error}`);
      globalState.recordingRooms.delete(message.roomId);
      return { success: true };
      
    // ========== 下载功能 ==========
    case 'DOWNLOAD_RECORDING':
      return await handleDownloadRecording(message);
      
    // ========== 历史记录 ==========
    case 'GET_HISTORY':
      const history = await getHistory();
      return { success: true, history };
      
    case 'CLEAR_HISTORY':
      await chrome.storage.local.remove(CONSTANTS.STORAGE_HISTORY);
      return { success: true };
      
    default:
      return { success: false, error: `Unknown message type: ${type}` };
  }
}

// ==================== 通知点击处理 ====================

chrome.notifications.onClicked.addListener(async (notificationId) => {
  log(`通知被点击: ${notificationId}`);
  
  // 关闭通知
  await chrome.notifications.clear(notificationId);
  
  // 如果是开播通知，打开直播间页面（根据notificationId解析）
  // 这里简化处理：打开Popup或者直播间页面
});

// ==================== 扩展启动 ====================

/**
 * 处理下载录制文件
 */
async function handleDownloadRecording(message) {
  log(`处理下载: ${message.fileName}`);
  
  try {
    // 使用chrome.downloads API下载文件
    // 注意：message.url 是一个 blob URL，需要转换
    
    // 方案：直接发起下载
    const downloadId = await chrome.downloads.download({
      url: message.url,
      filename: message.fileName,
      saveAs: false  // 直接下载到默认目录，不弹出保存对话框
    });
    
    log(`下载已开始, downloadId: ${downloadId}`);
    
    // 添加到历史记录
    await addHistory({
      roomId: message.roomId,
      streamerName: message.streamerName || '',
      title: message.title || '',
      startTime: message.startTime,
      endTime: message.endTime,
      duration: message.duration,
      fileSize: message.fileSize,
      fileName: message.fileName,
      status: 'completed'
    });
    
    // 清理录制状态
    globalState.recordingRooms.delete(message.roomId);
    
    return { success: true, downloadId };
    
  } catch (error) {
    log(`下载失败: ${error.message}`);
    
    // 即使下载失败，也添加到历史
    await addHistory({
      roomId: message.roomId,
      streamerName: message.streamerName || '',
      title: message.title || '',
      startTime: message.startTime,
      endTime: message.endTime,
      duration: message.duration,
      fileSize: message.fileSize,
      fileName: message.fileName,
      status: 'failed'
    });
    
    globalState.recordingRooms.delete(message.roomId);
    
    return { success: false, error: error.message };
  }
}

/**
 * 扩展安装/启动时初始化
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  log(`扩展已安装/更新: ${details.reason}`);
  
  // 初始化默认配置
  const existingConfig = await getConfig();
  await saveConfig(existingConfig);
  
  // 创建offscreen文档（用于播放音频）
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: '播放开播提示音'
    });
  } catch (e) {
    // 可能已存在，忽略错误
  }
  
  // 如果之前在监控，恢复监控
  // 注意：Manifest V3中Service Worker会被频繁终止，这里不自动恢复
  // 用户需要手动启动监控
});

/**
 * 扩展启动时
 */
chrome.runtime.onStartup.addListener(async () => {
  log('扩展随浏览器启动');
  // 这里不自动启动监控，保持用户控制
});

// ==================== 导出供调试 ====================

// 在Service Worker中，这些变量可以通过chrome://inspect/#service-workers查看
console.log('B站直播间监控助手 - Service Worker 已加载');
console.log('使用说明:');
console.log('1. 点击扩展图标打开Popup界面');
console.log('2. 添加需要监控的主播');
console.log('3. 点击"开始监控"按钮');
