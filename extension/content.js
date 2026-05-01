/**
 * B站直播间监控助手 - 内容脚本
 * 注入到B站直播间页面，用于录制控制
 * 
 * 功能：
 * 1. 接收来自后台的录制指令
 * 2. 控制录制开始/停止
 * 3. 自动检测直播状态
 * 4. 保存录制的视频
 */

(() => {
  'use strict';

  console.log('[B站监控助手] 内容脚本已加载:', window.location.href);

  // ==================== 全局状态 ====================
  const state = {
    roomId: null,           // 直播间ID
    streamerName: '',       // 主播名称
    isRecording: false,      // 是否正在录制
    mediaRecorder: null,     // MediaRecorder实例
    recordedChunks: [],      // 录制的数据块
    stream: null,            // 媒体流
    startTime: null,         // 开始时间
    config: null,            // 配置
    controlPanel: null,      // 控制面板元素
    checkInterval: null,     // 状态检查定时器
    isLive: true,            // 当前是否在直播
    title: ''                 // 直播间标题
  };

  // ==================== 初始化 ====================

  /**
   * 初始化内容脚本
   */
  function init() {
    // 提取直播间ID
    state.roomId = extractRoomIdFromUrl();
    
    if (!state.roomId) {
      console.log('[B站监控助手] 未识别到直播间ID');
      return;
    }
    
    console.log(`[B站监控助手] 直播间ID: ${state.roomId}`);
    
    // 获取直播间信息
    getRoomInfo();
    
    // 监听来自后台的消息
    chrome.runtime.onMessage.addListener(handleMessage);
    
    // 发送页面加载完成消息
    sendPageReadyMessage();
    
    // 开始检查直播状态
    startLiveStatusCheck();
  }

  /**
   * 从URL提取直播间ID
   */
  function extractRoomIdFromUrl() {
    const url = window.location.href;
    // live.bilibili.com/123456
    const match = url.match(/live\.bilibili\.com\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * 获取直播间信息（从页面）
   */
  function getRoomInfo() {
    try {
      // 尝试从页面标题获取主播名
      const title = document.title;
      const nameMatch = title.match(/^(.+?)的直播间/);
      if (nameMatch) {
        state.streamerName = nameMatch[1];
      }
      
      // 尝试从页面meta标签获取
      const metaTitle = document.querySelector('meta[property="og:title"]');
      if (metaTitle) {
        const content = metaTitle.content;
        const match = content.match(/^(.+?)的直播间/);
        if (match) {
          state.streamerName = match[1];
        }
        state.title = content;
      }
      
      // 从__INITIAL_STATE__获取（如果存在）
      const initialState = window.__INITIAL_STATE__;
      if (initialState && initialState.roomInfo) {
        state.streamerName = initialState.roomInfo.uname || state.streamerName;
        state.title = initialState.roomInfo.title || state.title;
      }
      
      console.log(`[B站监控助手] 主播: ${state.streamerName}, 标题: ${state.title}`);
      
    } catch (error) {
      console.log('[B站监控助手] 获取直播间信息失败:', error);
    }
  }

  /**
   * 发送页面准备完成消息
   */
  function sendPageReadyMessage() {
    try {
      chrome.runtime.sendMessage({
        type: 'PAGE_READY',
        roomId: state.roomId,
        streamerName: state.streamerName,
        title: state.title
      });
    } catch (error) {
      console.log('[B站监控助手] 发送页面就绪消息失败:', error);
    }
  }

  // ==================== 消息处理 ====================

  /**
   * 处理来自后台的消息
   */
  function handleMessage(message, sender, sendResponse) {
    console.log('[B站监控助手] 收到消息:', message.type);
    
    (async () => {
      let response = { success: false };
      
      try {
        switch (message.type) {
          case 'RECORD_COMMAND':
            response = await handleRecordCommand(message);
            break;
            
          case 'GET_RECORD_STATUS':
            response = {
              success: true,
              isRecording: state.isRecording,
              roomId: state.roomId,
              streamerName: state.streamerName
            };
            break;
            
          case 'CHECK_LIVE_STATUS':
            response = await checkLiveStatusFromApi();
            break;
        }
      } catch (error) {
        console.error('[B站监控助手] 处理消息出错:', error);
        response = { success: false, error: error.message };
      }
      
      sendResponse(response);
    })();
    
    return true;  // 保持消息通道打开
  }

  /**
   * 处理录制指令
   */
  async function handleRecordCommand(message) {
    const command = message.command;
    state.config = message.config || {};
    
    console.log(`[B站监控助手] 录制指令: ${command}`);
    
    switch (command) {
      case 'START':
        return await startRecordingFlow();
        
      case 'STOP':
        return await stopRecordingFlow();
        
      default:
        return { success: false, error: `未知指令: ${command}` };
    }
  }

  // ==================== 录制流程 ====================

  /**
   * 开始录制流程
   */
  async function startRecordingFlow() {
    if (state.isRecording) {
      console.log('[B站监控助手] 已经在录制中');
      return { success: true, alreadyRecording: true };
    }
    
    // 显示控制面板
    createControlPanel();
    showControlPanel();
    
    updateControlPanelStatus('准备录制...');
    
    try {
      // 尝试获取媒体流
      const stream = await getMediaStream();
      
      if (!stream) {
        updateControlPanelStatus('需要授权录制权限');
        showPermissionButton();
        return { success: false, needPermission: true };
      }
      
      // 开始录制
      await startRecording(stream);
      
      return { success: true };
      
    } catch (error) {
      console.error('[B站监控助手] 开始录制失败:', error);
      updateControlPanelStatus(`录制失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 停止录制流程
   */
  async function stopRecordingFlow() {
    if (!state.isRecording) {
      console.log('[B站监控助手] 当前没有在录制');
      return { success: true };
    }
    
    updateControlPanelStatus('正在停止录制...');
    
    try {
      await stopRecording();
      return { success: true };
    } catch (error) {
      console.error('[B站监控助手] 停止录制失败:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== 媒体流获取 ====================

  /**
   * 获取媒体流
   * 优先使用tabCapture，如果不可用则使用getDisplayMedia
   */
  async function getMediaStream() {
    console.log('[B站监控助手] 正在获取媒体流...');
    
    // 方案1: 尝试使用tabCapture（需要扩展权限）
    try {
      // 向后台请求tabCapture流
      const streamId = await requestTabCaptureStreamId();
      
      if (streamId) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId
            }
          }
        });
        
        if (stream) {
          console.log('[B站监控助手] 使用tabCapture获取流成功');
          return stream;
        }
      }
    } catch (error) {
      console.log('[B站监控助手] tabCapture获取流失败:', error);
    }
    
    // 方案2: 使用getDisplayMedia（需要用户交互）
    console.log('[B站监控助手] 尝试使用getDisplayMedia...');
    return null;  // 返回null，让用户点击按钮授权
  }

  /**
   * 向后台请求tabCapture的streamId
   */
  async function requestTabCaptureStreamId() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REQUEST_TAB_CAPTURE',
        tabId: chrome.devtools?.inspectedWindow?.tabId
      });
      
      if (response && response.success && response.streamId) {
        return response.streamId;
      }
    } catch (error) {
      console.log('[B站监控助手] 请求tabCapture失败:', error);
    }
    
    return null;
  }

  /**
   * 使用getDisplayMedia获取流
   */
  async function getDisplayMediaStream() {
    try {
      updateControlPanelStatus('正在请求录制权限...');
      
      // 优先捕获标签页的音视频
      const constraints = {
        video: {
          cursor: "never"
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      };
      
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      
      console.log('[B站监控助手] getDisplayMedia获取流成功');
      return stream;
      
    } catch (error) {
      console.error('[B站监控助手] getDisplayMedia失败:', error);
      throw error;
    }
  }

  // ==================== 录制控制 ====================

  /**
   * 开始录制
   */
  async function startRecording(stream) {
    console.log('[B站监控助手] 开始录制...');
    
    state.stream = stream;
    state.recordedChunks = [];
    
    // 确定MIME类型
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4'
    ];
    
    let selectedMimeType = '';
    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        selectedMimeType = mimeType;
        break;
      }
    }
    
    if (!selectedMimeType) {
      throw new Error('不支持的视频格式');
    }
    
    console.log(`[B站监控助手] 使用MIME类型: ${selectedMimeType}`);
    
    // 创建MediaRecorder
    const options = {
      mimeType: selectedMimeType,
      videoBitsPerSecond: 8000000,  // 8 Mbps
      audioBitsPerSecond: 192000      // 192 kbps
    };
    
    state.mediaRecorder = new MediaRecorder(stream, options);
    
    // 设置数据处理
    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    };
    
    // 录制错误
    state.mediaRecorder.onerror = (event) => {
      console.error('[B站监控助手] 录制出错:', event);
      stopRecording();
    };
    
    // 开始录制，每1秒保存一次数据
    state.mediaRecorder.start(1000);
    state.isRecording = true;
    state.startTime = Date.now();
    
    // 更新UI
    updateControlPanelStatus('正在录制...');
    showStopButton();
    startRecordingTimer();
    
    console.log('[B站监控助手] 录制已开始');
    
    // 通知后台
    try {
      chrome.runtime.sendMessage({
        type: 'RECORD_STARTED',
        roomId: state.roomId,
        streamerName: state.streamerName,
        title: state.title
      });
    } catch (e) {
      // 忽略
    }
  }

  /**
   * 停止录制
   */
  async function stopRecording() {
    console.log('[B站监控助手] 停止录制...');
    
    if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') {
      console.log('[B站监控助手] 没有活动的录制');
      state.isRecording = false;
      return;
    }
    
    return new Promise((resolve, reject) => {
      // 设置停止回调
      state.mediaRecorder.onstop = async () => {
        console.log('[B站监控助手] 录制已停止，准备保存...');
        
        try {
          // 保存视频
          await saveRecording();
          
          // 停止流
          if (state.stream) {
            state.stream.getTracks().forEach(track => track.stop());
            state.stream = null;
          }
          
          // 清理
          state.isRecording = false;
          state.mediaRecorder = null;
          
          // 更新UI
          updateControlPanelStatus('录制已完成');
          hideControlPanel();
          
          resolve();
          
        } catch (error) {
          console.error('[B站监控助手] 保存录制失败:', error);
          reject(error);
        }
      };
      
      // 停止录制
      state.mediaRecorder.stop();
    });
  }

  /**
   * 保存录制的视频
   */
  async function saveRecording() {
    if (state.recordedChunks.length === 0) {
      console.log('[B站监控助手] 没有录制数据');
      return;
    }
    
    // 合并数据块
    const blob = new Blob(state.recordedChunks, {
      type: state.mediaRecorder?.mimeType || 'video/webm'
    });
    
    const fileSize = blob.size;
    const duration = (Date.now() - state.startTime) / 1000;
    
    console.log(`[B站监控助手] 录制文件大小: ${formatFileSize(fileSize)}`);
    
    // 生成文件名
    const fileName = generateFileName();
    
    // 方案1: 使用downloads API下载
    try {
      // 创建下载URL
      const url = URL.createObjectURL(blob);
      
      // 发送到后台进行下载
      await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_RECORDING',
        url: url,
        fileName: fileName,
        roomId: state.roomId,
        streamerName: state.streamerName,
        title: state.title,
        startTime: new Date(state.startTime).toISOString(),
        endTime: new Date().toISOString(),
        duration: duration,
        fileSize: fileSize
      });
      
      // 延迟释放URL
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      
      console.log(`[B站监控助手] 已发送下载请求: ${fileName}`);
      
    } catch (error) {
      console.error('[B站监控助手] 发送下载请求失败:', error);
      
      // 方案2: 直接在页面中触发下载
      triggerDirectDownload(blob, fileName);
    }
    
    // 清空数据
    state.recordedChunks = [];
  }

  /**
   * 直接在页面中触发下载
   */
  function triggerDirectDownload(blob, fileName) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      
      console.log(`[B站监控助手] 直接下载: ${fileName}`);
    } catch (error) {
      console.error('[B站监控助手] 直接下载失败:', error);
    }
  }

  /**
   * 生成文件名
   */
  function generateFileName() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    
    // 清理文件名中的非法字符
    const cleanName = (state.streamerName || '主播')
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 30);
    
    const cleanTitle = (state.title || '直播')
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 20);
    
    // 确定扩展名
    const mimeType = state.mediaRecorder?.mimeType || '';
    let ext = '.webm';
    if (mimeType.includes('mp4')) {
      ext = '.mp4';
    }
    
    return `${cleanName}_${dateStr}_${timeStr}${ext}`;
  }

  // ==================== 控制面板 ====================

  /**
   * 创建控制面板
   */
  function createControlPanel() {
    if (state.controlPanel) return;
    
    const panel = document.createElement('div');
    panel.id = 'bilibili-monitor-control-panel';
    panel.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 999999;
      background: linear-gradient(135deg, #00a1d6, #008ebf);
      color: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      min-width: 240px;
      display: none;
    `;
    
    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="font-weight: 600; font-size: 15px;">📺 B站直播录制</div>
        <button id="bmc-close-btn" style="background: none; border: none; color: white; font-size: 20px; cursor: pointer; padding: 0; line-height: 1;">×</button>
      </div>
      <div id="bmc-status" style="margin-bottom: 12px; padding: 8px 12px; background: rgba(255,255,255,0.15); border-radius: 6px;">
        准备中...
      </div>
      <div id="bmc-timer" style="font-size: 24px; font-weight: bold; text-align: center; margin-bottom: 12px; display: none;">
        00:00:00
      </div>
      <div id="bmc-buttons" style="display: flex; gap: 8px;">
        <button id="bmc-permission-btn" class="bmc-btn" style="flex: 1; padding: 10px 16px; border: none; border-radius: 6px; background: #ff6b6b; color: white; font-weight: 600; cursor: pointer; display: none;">
          🔴 授权录制
        </button>
        <button id="bmc-stop-btn" class="bmc-btn" style="flex: 1; padding: 10px 16px; border: none; border-radius: 6px; background: #e74c3c; color: white; font-weight: 600; cursor: pointer; display: none;">
          ⏹ 停止录制
        </button>
      </div>
    `;
    
    document.body.appendChild(panel);
    state.controlPanel = panel;
    
    // 绑定事件
    document.getElementById('bmc-close-btn').addEventListener('click', () => {
      hideControlPanel();
    });
    
    document.getElementById('bmc-permission-btn').addEventListener('click', async () => {
      try {
        const stream = await getDisplayMediaStream();
        if (stream) {
          await startRecording(stream);
        }
      } catch (error) {
        updateControlPanelStatus(`授权失败: ${error.message}`);
      }
    });
    
    document.getElementById('bmc-stop-btn').addEventListener('click', async () => {
      await stopRecordingFlow();
    });
  }

  /**
   * 显示控制面板
   */
  function showControlPanel() {
    createControlPanel();
    state.controlPanel.style.display = 'block';
  }

  /**
   * 隐藏控制面板
   */
  function hideControlPanel() {
    if (state.controlPanel) {
      state.controlPanel.style.display = 'none';
    }
  }

  /**
   * 更新状态文本
   */
  function updateControlPanelStatus(text) {
    createControlPanel();
    const statusEl = document.getElementById('bmc-status');
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  /**
   * 显示授权按钮
   */
  function showPermissionButton() {
    const btn = document.getElementById('bmc-permission-btn');
    if (btn) {
      btn.style.display = 'block';
    }
  }

  /**
   * 显示停止按钮
   */
  function showStopButton() {
    const permissionBtn = document.getElementById('bmc-permission-btn');
    const stopBtn = document.getElementById('bmc-stop-btn');
    const timer = document.getElementById('bmc-timer');
    
    if (permissionBtn) permissionBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'block';
    if (timer) timer.style.display = 'block';
  }

  /**
   * 开始录制计时器
   */
  function startRecordingTimer() {
    const timerEl = document.getElementById('bmc-timer');
    if (!timerEl) return;
    
    function update() {
      if (!state.isRecording) return;
      
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
      const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
      const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');
      
      timerEl.textContent = `${h}:${m}:${s}`;
      
      setTimeout(update, 1000);
    }
    
    update();
  }

  // ==================== 直播状态检查 ====================

  /**
   * 开始检查直播状态
   */
  function startLiveStatusCheck() {
    if (state.checkInterval) {
      clearInterval(state.checkInterval);
    }
    
    // 每10秒检查一次
    state.checkInterval = setInterval(async () => {
      if (state.isRecording) {
        const isStillLive = await checkIsLive();
        if (!isStillLive) {
          console.log('[B站监控助手] 检测到直播已结束，自动停止录制');
          await stopRecordingFlow();
        }
      }
    }, 10000);
  }

  /**
   * 检查是否仍在直播
   */
  async function checkIsLive() {
    // 方法1: 检查页面中的播放状态
    const videoPlayer = document.querySelector('video');
    if (videoPlayer) {
      // 如果视频元素存在但paused为true，可能已结束
      if (videoPlayer.paused && videoPlayer.ended) {
        return false;
      }
    }
    
    // 方法2: 检查页面中是否有"主播不在家"等提示
    const offlineIndicators = [
      '.player-offline',
      '.offline-tips',
      '.live-ended',
      '[class*="offline"]',
      '[class*="结束"]'
    ];
    
    for (const selector of offlineIndicators) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) {
        return false;
      }
    }
    
    // 方法3: 检查__INITIAL_STATE__
    try {
      if (window.__INITIAL_STATE__?.roomInfo?.live_status !== undefined) {
        return window.__INITIAL_STATE__.roomInfo.live_status === 1;
      }
    } catch (e) {
      // 忽略
    }
    
    return true;
  }

  /**
   * 通过API检查直播状态
   */
  async function checkLiveStatusFromApi() {
    try {
      const response = await fetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${state.roomId}`);
      const data = await response.json();
      
      if (data.code === 0) {
        return {
          success: true,
          isLive: data.data.live_status === 1
        };
      }
    } catch (error) {
      console.log('[B站监控助手] API检查直播状态失败:', error);
    }
    
    return { success: false, isLive: false };
  }

  // ==================== 工具函数 ====================

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

  // 启动
  init();

})();
