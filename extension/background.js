/**
 * B站直播间监控助手 - 后台服务脚本 v1.1.0
 * 
 * 修复记录：
 * 1. 修复通知图标问题（使用extension.getURL获取正确路径）
 * 2. 修复重复打开页面问题（添加防重机制）
 * 3. 修复配置保存问题（确保存储正确）
 * 4. 优化流程逻辑（不强制自动触发录制授权）
 * 5. 添加更好的状态跟踪和错误处理
 * 6. 添加手动录制控制支持
 */

const CONSTANTS = {
  API_ROOM_INIT: "https://api.live.bilibili.com/room/v1/Room/room_init",
  API_ROOM_INFO: "https://api.live.bilibili.com/room/v1/Room/get_info",
  API_USER_INFO: "https://api.live.bilibili.com/live_user/v1/Master/info",
  
  DEFAULT_POLL_INTERVAL: 10,
  DEFAULT_VIDEO_QUALITY: '原画',
  DEFAULT_VIDEO_FORMAT: 'webm',
  DEFAULT_ENABLE_NOTIFICATION: true,
  DEFAULT_ENABLE_SOUND: true,
  DEFAULT_ENABLE_RECORD: true,
  DEFAULT_AUTO_OPEN_RECORD: false,
  
  STORAGE_STREAMERS: 'streamers',
  STORAGE_CONFIG: 'config',
  STORAGE_STATE: 'monitor_state',
  STORAGE_HISTORY: 'history'
};

let globalState = {
  isMonitoring: false,
  pollingTimer: null,
  recordingRooms: new Map(),
  openingRooms: new Set(),
  lastNotifyTime: new Map(),
  notificationCooldown: 120000,
  lastCheckStatus: new Map()
};

function log(message, ...args) {
  const timestamp = new Date().toLocaleString('zh-CN');
  console.log(`[${timestamp}] ${message}`, ...args);
}

function extractRoomId(input) {
  if (!input) return null;
  input = input.trim();
  
  if (/^\d+$/.test(input)) {
    return input;
  }
  
  const liveMatch = input.match(/live\.bilibili\.com\/(\d+)/);
  if (liveMatch) {
    return liveMatch[1];
  }
  
  const shortMatch = input.match(/b23\.tv\/(\w+)/);
  if (shortMatch) {
    log('检测到短链接，需要进一步处理');
    return null;
  }
  
  return null;
}

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

async function fetchRoomInfo(roomId) {
  try {
    log(`获取直播间信息: ${roomId}`);
    
    const initResponse = await fetch(`${CONSTANTS.API_ROOM_INIT}?id=${roomId}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://live.bilibili.com/'
      }
    });
    
    const initData = await initResponse.json();
    
    if (initData.code !== 0) {
      log(`获取房间信息失败: ${initData.message}`);
      return null;
    }
    
    const initRoomData = initData.data;
    const realRoomId = initRoomData.room_id || roomId;
    const uid = initRoomData.uid;
    const liveStatus = initRoomData.live_status;
    
    let roomTitle = '';
    let liveTime = '';
    
    try {
      const infoResponse = await fetch(`${CONSTANTS.API_ROOM_INFO}?room_id=${realRoomId}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://live.bilibili.com/'
        }
      });
      
      const infoData = await infoResponse.json();
      if (infoData.code === 0 && infoData.data) {
        roomTitle = infoData.data.title || '';
        liveTime = infoData.data.live_time || '';
      }
    } catch (e) {
      log(`获取房间详细信息出错: ${e.message}`);
    }
    
    let streamerName = `主播_${realRoomId}`;
    try {
      const userResponse = await fetch(`${CONSTANTS.API_USER_INFO}?uid=${uid}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://live.bilibili.com/'
        }
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
      liveTime: liveTime
    };
    
  } catch (error) {
    log(`获取直播间信息异常: ${error.message}`);
    return null;
  }
}

async function getConfig() {
  try {
    const result = await chrome.storage.local.get(CONSTANTS.STORAGE_CONFIG);
    const savedConfig = result[CONSTANTS.STORAGE_CONFIG] || {};
    
    return {
      pollInterval: savedConfig.pollInterval ?? CONSTANTS.DEFAULT_POLL_INTERVAL,
      videoQuality: savedConfig.videoQuality || CONSTANTS.DEFAULT_VIDEO_QUALITY,
      videoFormat: savedConfig.videoFormat || CONSTANTS.DEFAULT_VIDEO_FORMAT,
      enableNotification: savedConfig.enableNotification ?? CONSTANTS.DEFAULT_ENABLE_NOTIFICATION,
      enableSound: savedConfig.enableSound ?? CONSTANTS.DEFAULT_ENABLE_SOUND,
      enableRecord: savedConfig.enableRecord ?? CONSTANTS.DEFAULT_ENABLE_RECORD,
      autoOpenRecord: savedConfig.autoOpenRecord ?? CONSTANTS.DEFAULT_AUTO_OPEN_RECORD,
      savePath: savedConfig.savePath || ''
    };
  } catch (error) {
    log(`获取配置失败: ${error.message}`);
    return {
      pollInterval: CONSTANTS.DEFAULT_POLL_INTERVAL,
      videoQuality: CONSTANTS.DEFAULT_VIDEO_QUALITY,
      videoFormat: CONSTANTS.DEFAULT_VIDEO_FORMAT,
      enableNotification: CONSTANTS.DEFAULT_ENABLE_NOTIFICATION,
      enableSound: CONSTANTS.DEFAULT_ENABLE_SOUND,
      enableRecord: CONSTANTS.DEFAULT_ENABLE_RECORD,
      autoOpenRecord: CONSTANTS.DEFAULT_AUTO_OPEN_RECORD,
      savePath: ''
    };
  }
}

async function saveConfig(config) {
  try {
    await chrome.storage.local.set({
      [CONSTANTS.STORAGE_CONFIG]: config
    });
    log(`配置已保存: ${JSON.stringify(config)}`);
    return true;
  } catch (error) {
    log(`保存配置失败: ${error.message}`);
    return false;
  }
}

async function getStreamers() {
  try {
    const result = await chrome.storage.local.get(CONSTANTS.STORAGE_STREAMERS);
    return result[CONSTANTS.STORAGE_STREAMERS] || [];
  } catch (error) {
    log(`获取主播列表失败: ${error.message}`);
    return [];
  }
}

async function saveStreamers(streamers) {
  try {
    await chrome.storage.local.set({
      [CONSTANTS.STORAGE_STREAMERS]: streamers
    });
    return true;
  } catch (error) {
    log(`保存主播列表失败: ${error.message}`);
    return false;
  }
}

async function addStreamer(roomId, streamerName = '', note = '') {
  const actualRoomId = extractRoomId(roomId);
  
  if (!actualRoomId) {
    return { success: false, message: '无法识别的直播间ID或链接' };
  }
  
  const streamers = await getStreamers();
  
  const exists = streamers.find(s => s.roomId === actualRoomId);
  if (exists) {
    return { success: false, message: '该主播已在监控列表中' };
  }
  
  const roomInfo = await fetchRoomInfo(actualRoomId);
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
  
  log(`已添加主播: ${newStreamer.streamerName} (${newStreamer.roomId})`);
  
  return { 
    success: true, 
    message: `成功添加主播: ${newStreamer.streamerName}`,
    streamer: newStreamer
  };
}

async function removeStreamer(roomId) {
  const streamers = await getStreamers();
  const newStreamers = streamers.filter(s => s.roomId !== roomId);
  
  if (newStreamers.length === streamers.length) {
    return false;
  }
  
  await saveStreamers(newStreamers);
  
  if (globalState.recordingRooms.has(roomId)) {
    await stopRecording(roomId);
  }
  
  globalState.openingRooms.delete(roomId);
  globalState.lastCheckStatus.delete(roomId);
  
  log(`已删除主播: ${roomId}`);
  
  return true;
}

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
  
  log(`主播 ${streamer.streamerName} 监控状态: ${enable ? '开启' : '关闭'}`);
  
  return true;
}

async function getHistory() {
  try {
    const result = await chrome.storage.local.get(CONSTANTS.STORAGE_HISTORY);
    return result[CONSTANTS.STORAGE_HISTORY] || [];
  } catch (error) {
    log(`获取历史记录失败: ${error.message}`);
    return [];
  }
}

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
  
  if (history.length > 100) {
    history.splice(100);
  }
  
  try {
    await chrome.storage.local.set({
      [CONSTANTS.STORAGE_HISTORY]: history
    });
  } catch (error) {
    log(`保存历史记录失败: ${error.message}`);
  }
  
  return newRecord;
}

async function sendNotification(roomId, title, message, type = 'info') {
  const config = await getConfig();
  
  if (!config.enableNotification) {
    log('通知已关闭，跳过');
    return;
  }
  
  const now = Date.now();
  const lastNotify = globalState.lastNotifyTime.get(roomId) || 0;
  
  if (now - lastNotify < globalState.notificationCooldown) {
    log(`通知冷却中，跳过: ${roomId}`);
    return;
  }
  
  globalState.lastNotifyTime.set(roomId, now);
  
  try {
    const notificationId = `bilibili_${roomId}_${Date.now()}`;
    
    const iconData = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IiMwMGExZDYiIHJ4PSIxNiIvPjx0ZXh0IHg9IjY0IiB5PSI4NSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjYwIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+8J+TwTwvdGV4dD48L3N2Zz4=';
    
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: iconData,
      title: title,
      message: message,
      priority: type === 'live' ? 2 : 0,
      requireInteraction: type === 'live'
    });
    
    log(`已发送通知: ${title} - ${message}`);
    
    if (config.enableSound && type === 'live') {
      await playNotificationSound();
    }
    
  } catch (error) {
    log(`发送通知失败: ${error.message}`);
  }
}

async function playNotificationSound() {
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    if (existingContexts.length === 0) {
      try {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: '播放开播提示音'
        });
      } catch (e) {
        log(`创建offscreen文档失败: ${e.message}`);
      }
    }
    
    try {
      await chrome.runtime.sendMessage({
        type: 'PLAY_SOUND',
        sound: 'notification'
      });
    } catch (e) {
      log(`发送播放声音消息失败: ${e.message}`);
    }
    
  } catch (error) {
    log(`播放提示音失败: ${error.message}`);
  }
}

async function startRecording(roomId, roomInfo) {
  if (globalState.recordingRooms.has(roomId)) {
    log(`房间 ${roomId} 已经在录制中`);
    return false;
  }
  
  if (globalState.openingRooms.has(roomId)) {
    log(`房间 ${roomId} 正在打开中，跳过`);
    return false;
  }
  
  const config = await getConfig();
  
  globalState.openingRooms.add(roomId);
  
  try {
    log(`准备打开直播间页面: ${roomInfo.streamerName} (${roomId})`);
    
    const existingTabs = await chrome.tabs.query({
      url: `https://live.bilibili.com/${roomId}`
    });
    
    let tab;
    if (existingTabs.length > 0) {
      tab = existingTabs[0];
      log(`找到已打开的标签页: tabId=${tab.id}`);
    } else {
      tab = await chrome.tabs.create({
        url: `https://live.bilibili.com/${roomId}`,
        active: false,
        pinned: false
      });
      log(`已打开新标签页: tabId=${tab.id}`);
    }
    
    globalState.recordingRooms.set(roomId, {
      tabId: tab.id,
      roomId: roomId,
      streamerName: roomInfo.streamerName,
      title: roomInfo.title,
      startTime: Date.now(),
      status: 'page_opened'
    });
    
    if (config.autoOpenRecord) {
      log(`自动录制已启用，等待页面加载后发送录制指令...`);
      
      setTimeout(async () => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          
          await chrome.tabs.sendMessage(tab.id, {
            type: 'RECORD_COMMAND',
            command: 'SHOW_PANEL',
            roomId: roomId,
            streamerName: roomInfo.streamerName,
            title: roomInfo.title,
            config: config
          });
          
          log(`已发送显示面板指令到 tabId=${tab.id}`);
        } catch (error) {
          log(`发送录制指令失败: ${error.message}`);
        }
      }, 8000);
    } else {
      log(`自动录制未启用，仅打开页面，等待用户手动操作`);
      
      setTimeout(async () => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          
          await chrome.tabs.sendMessage(tab.id, {
            type: 'RECORD_COMMAND',
            command: 'SHOW_PANEL_ONLY',
            roomId: roomId,
            streamerName: roomInfo.streamerName,
            title: roomInfo.title,
            config: config
          });
        } catch (error) {
          log(`发送显示面板指令失败: ${error.message}`);
        }
      }, 5000);
    }
    
    return true;
    
  } catch (error) {
    log(`开始录制流程失败: ${error.message}`);
    globalState.recordingRooms.delete(roomId);
    globalState.openingRooms.delete(roomId);
    return false;
  }
}

async function stopRecording(roomId) {
  const recordingInfo = globalState.recordingRooms.get(roomId);
  
  if (!recordingInfo) {
    log(`房间 ${roomId} 不在录制中`);
    return false;
  }
  
  log(`停止录制: ${recordingInfo.streamerName} (${roomId})`);
  
  try {
    await chrome.tabs.sendMessage(recordingInfo.tabId, {
      type: 'RECORD_COMMAND',
      command: 'STOP',
      roomId: roomId
    });
    
    setTimeout(async () => {
      try {
        const tabs = await chrome.tabs.query({
          url: `https://live.bilibili.com/${roomId}`
        });
        
        for (const tab of tabs) {
          try {
            await chrome.tabs.remove(tab.id);
            log(`已关闭标签页: tabId=${tab.id}`);
          } catch (e) {
            log(`关闭标签页失败: ${e.message}`);
          }
        }
      } catch (error) {
        log(`查询标签页失败: ${error.message}`);
      }
    }, 5000);
    
    globalState.recordingRooms.delete(roomId);
    globalState.openingRooms.delete(roomId);
    
    return true;
    
  } catch (error) {
    log(`停止录制失败: ${error.message}`);
    globalState.recordingRooms.delete(roomId);
    globalState.openingRooms.delete(roomId);
    return false;
  }
}

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
  
  await performMonitorCheck();
  
  if (globalState.pollingTimer) {
    clearInterval(globalState.pollingTimer);
  }
  
  globalState.pollingTimer = setInterval(async () => {
    if (globalState.isMonitoring) {
      await performMonitorCheck();
    }
  }, config.pollInterval * 1000);
  
  await sendNotification('system', '监控已启动', `正在监控 ${monitoringCount} 个主播`, 'info');
}

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
  
  for (const roomId of globalState.recordingRooms.keys()) {
    await stopRecording(roomId);
  }
}

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
}

async function checkSingleStreamer(streamer) {
  const roomId = streamer.roomId;
  const lastStatus = streamer.lastLiveStatus;
  
  const roomInfo = await fetchRoomInfo(roomId);
  
  if (!roomInfo) {
    log(`无法获取主播 ${roomId} 的状态，跳过本次检查`);
    return;
  }
  
  const streamers = await getStreamers();
  const targetStreamer = streamers.find(s => s.roomId === roomId);
  
  if (targetStreamer) {
    targetStreamer.lastCheckTime = new Date().toISOString();
    targetStreamer.streamerName = roomInfo.streamerName;
    await saveStreamers(streamers);
  }
  
  const currentStatus = roomInfo.isLive ? 'live' : 'offline';
  
  const lastCheck = globalState.lastCheckStatus.get(roomId);
  if (lastCheck === currentStatus && lastStatus === currentStatus) {
    return;
  }
  
  globalState.lastCheckStatus.set(roomId, currentStatus);
  
  log(`主播 ${roomInfo.streamerName} (${roomId}) 状态: ${lastStatus} -> ${currentStatus}`);
  
  if (lastStatus !== currentStatus) {
    await handleStatusChange(streamer, roomInfo, lastStatus, currentStatus);
    
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
  
  const config = await getConfig();
  if (currentStatus === 'live' && config.enableRecord) {
    if (!globalState.recordingRooms.has(roomId) && !globalState.openingRooms.has(roomId)) {
      log(`检测到主播正在直播: ${roomInfo.streamerName}`);
      
      if (config.autoOpenRecord) {
        log(`自动录制已启用，启动录制流程...`);
        await startRecording(roomId, roomInfo);
      } else {
        log(`自动录制未启用，仅发送通知`);
      }
    }
  }
}

async function handleStatusChange(streamer, roomInfo, oldStatus, newStatus) {
  const streamerName = roomInfo.streamerName || streamer.streamerName;
  const roomId = streamer.roomId;
  
  log(`状态变化: ${streamerName} ${oldStatus} -> ${newStatus}`);
  
  if (newStatus === 'live') {
    const title = roomInfo.title || '未知标题';
    
    await sendNotification(
      roomId,
      `${streamerName} 开播了！`,
      `直播间: ${roomId}\n${title}`,
      'live'
    );
    
  } else if (newStatus === 'offline') {
    await sendNotification(
      roomId,
      `${streamerName} 下播了`,
      `直播间 ${roomId} 已结束直播`,
      'info'
    );
    
    if (globalState.recordingRooms.has(roomId)) {
      await stopRecording(roomId);
    }
  }
}

async function handleDownloadRecording(message) {
  log(`处理下载: ${message.fileName}`);
  
  try {
    const downloadId = await chrome.downloads.download({
      url: message.url,
      filename: message.fileName,
      saveAs: false
    });
    
    log(`下载已开始, downloadId: ${downloadId}`);
    
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
    
    globalState.recordingRooms.delete(message.roomId);
    globalState.openingRooms.delete(message.roomId);
    
    return { success: true, downloadId };
    
  } catch (error) {
    log(`下载失败: ${error.message}`);
    
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
    globalState.openingRooms.delete(message.roomId);
    
    return { success: false, error: error.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      let response = await handleMessage(message, sender);
      sendResponse(response);
    } catch (error) {
      log(`处理消息出错: ${error.message}`);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true;
});

async function handleMessage(message, sender) {
  const type = message.type;
  
  log(`收到消息: ${type}`, sender.tab ? `from tab ${sender.tab.id}` : 'from extension');
  
  switch (type) {
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
      for (const s of streamers) {
        s.isRecording = globalState.recordingRooms.has(s.roomId);
        s.isOpening = globalState.openingRooms.has(s.roomId);
      }
      return { success: true, streamers };
      
    case 'GET_CONFIG':
      const config = await getConfig();
      return { success: true, config };
      
    case 'SAVE_CONFIG':
      const saved = await saveConfig(message.config);
      
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
      
      return { success: saved };
      
    case 'RECORD_COMPLETED':
      log(`录制完成: ${message.roomId}`);
      
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
      
      globalState.recordingRooms.delete(message.roomId);
      globalState.openingRooms.delete(message.roomId);
      
      await sendNotification(
        message.roomId,
        '录制完成',
        `${message.streamerName} 的直播已录制完成`,
        'info'
      );
      
      return { success: true };
      
    case 'RECORD_STARTED':
      log(`录制已开始: ${message.roomId}`);
      
      const recordingInfo = globalState.recordingRooms.get(message.roomId);
      if (recordingInfo) {
        recordingInfo.status = 'recording';
      }
      
      return { success: true };
      
    case 'RECORD_ERROR':
      log(`录制出错: ${message.error}`);
      globalState.recordingRooms.delete(message.roomId);
      globalState.openingRooms.delete(message.roomId);
      return { success: true };
      
    case 'MANUAL_RECORD_START':
      log(`手动开始录制: ${message.roomId}`);
      
      const info = globalState.recordingRooms.get(message.roomId);
      if (info) {
        info.status = 'recording';
        info.manualStart = true;
      }
      
      return { success: true };
      
    case 'DOWNLOAD_RECORDING':
      return await handleDownloadRecording(message);
      
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

chrome.notifications.onClicked.addListener(async (notificationId) => {
  log(`通知被点击: ${notificationId}`);
  await chrome.notifications.clear(notificationId);
});

chrome.runtime.onInstalled.addListener(async (details) => {
  log(`扩展已安装/更新: ${details.reason}`);
  
  const existingConfig = await getConfig();
  await saveConfig(existingConfig);
  
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: '播放开播提示音'
      });
    }
  } catch (e) {
    log(`offscreen文档已存在或创建失败: ${e.message}`);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  log('扩展随浏览器启动');
});

console.log('B站直播间监控助手 - Service Worker v1.1.0 已加载');
console.log('修复内容：');
console.log('1. 修复通知问题');
console.log('2. 修复重复打开页面问题');
console.log('3. 修复配置保存问题');
console.log('4. 添加手动录制控制');
console.log('5. 优化流程逻辑');
