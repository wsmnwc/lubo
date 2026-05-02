/**
 * B站直播间监控助手 - 内容脚本 v1.1.0
 * 
 * 修复记录：
 * 1. 修复弹窗关闭按钮问题（使用正确的事件绑定）
 * 2. 修复录制无声音问题（确保getDisplayMedia配置正确）
 * 3. 修复MP4格式问题（改为webm默认，添加清晰的格式说明）
 * 4. 新增手动录制控制功能
 * 5. 优化录制流程，不强制自动触发授权
 */

(function() {
  'use strict';

  const CONTROL_PANEL_ID = 'bilibilimonitor-control-panel';
  const CONTROL_PANEL_SHADOW_ID = 'bilibilimonitor-shadow-root';
  
  let globalState = {
    mediaStream: null,
    mediaRecorder: null,
    recordedChunks: [],
    isRecording: false,
    isPanelVisible: false,
    startTime: null,
    recordingInfo: null,
    config: null,
    timerInterval: null,
    panelElement: null,
    shadowRoot: null
  };

  function log(message, ...args) {
    const timestamp = new Date().toLocaleString('zh-CN');
    console.log(`[Content ${timestamp}] ${message}`, ...args);
  }

  function getCurrentRoomId() {
    const match = window.location.pathname.match(/^\/(\d+)/);
    if (match) {
      return match[1];
    }
    const titleMatch = document.title.match(/(\d+)/);
    if (titleMatch) {
      return titleMatch[1];
    }
    return null;
  }

  function createControlPanel() {
    if (globalState.panelElement) {
      return globalState.panelElement;
    }

    const panel = document.createElement('div');
    panel.id = CONTROL_PANEL_ID;
    
    const shadow = panel.attachShadow({ mode: 'closed' });
    globalState.shadowRoot = shadow;
    
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      
      .control-panel {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 320px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: white;
        overflow: hidden;
        user-select: none;
        transition: all 0.3s ease;
      }
      
      .control-panel.minimized {
        width: auto;
        padding: 8px 12px;
      }
      
      .control-panel.minimized .panel-content {
        display: none;
      }
      
      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: rgba(0, 0, 0, 0.2);
      }
      
      .panel-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
      }
      
      .recording-indicator {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #999;
        animation: none;
      }
      
      .recording-indicator.active {
        background: #ff4757;
        animation: pulse 1.5s infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      
      .panel-buttons {
        display: flex;
        gap: 8px;
      }
      
      .btn-minimize, .btn-close {
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.2);
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        transition: background 0.2s;
      }
      
      .btn-minimize:hover, .btn-close:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      
      .panel-content {
        padding: 16px;
      }
      
      .info-section {
        background: rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
      }
      
      .info-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 6px;
        font-size: 12px;
      }
      
      .info-row:last-child {
        margin-bottom: 0;
      }
      
      .info-label {
        color: rgba(255, 255, 255, 0.7);
      }
      
      .info-value {
        font-weight: 500;
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      .status-section {
        display: flex;
        justify-content: center;
        margin-bottom: 12px;
      }
      
      .status-badge {
        padding: 6px 16px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 500;
        background: rgba(0, 0, 0, 0.2);
      }
      
      .status-badge.idle {
        background: rgba(0, 0, 0, 0.2);
      }
      
      .status-badge.recording {
        background: #ff4757;
        animation: pulse 1.5s infinite;
      }
      
      .timer-section {
        text-align: center;
        margin-bottom: 12px;
        font-size: 24px;
        font-weight: 600;
        font-family: 'SF Mono', Monaco, monospace;
      }
      
      .controls-section {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }
      
      .control-btn {
        flex: 1;
        padding: 10px 16px;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .btn-start {
        background: #2ed573;
        color: white;
      }
      
      .btn-start:hover {
        background: #26de81;
      }
      
      .btn-start:disabled {
        background: #95a5a6;
        cursor: not-allowed;
      }
      
      .btn-stop {
        background: #ff4757;
        color: white;
      }
      
      .btn-stop:hover {
        background: #ff3838;
      }
      
      .btn-stop:disabled {
        background: #95a5a6;
        cursor: not-allowed;
      }
      
      .help-text {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.7);
        text-align: center;
        line-height: 1.5;
      }
      
      .help-text strong {
        color: #ffd700;
      }
      
      .format-note {
        margin-top: 8px;
        padding: 8px;
        background: rgba(0, 0, 0, 0.15);
        border-radius: 6px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.8);
      }
      
      .minimized-bar {
        display: none;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      }
      
      .control-panel.minimized .minimized-bar {
        display: flex;
      }
      
      .minimized-bar .recording-indicator {
        margin-right: 4px;
      }
      
      .minimized-bar .minimized-text {
        font-size: 12px;
        font-weight: 500;
      }
      
      .minimized-bar .minimized-timer {
        font-size: 12px;
        font-family: 'SF Mono', Monaco, monospace;
        margin-left: auto;
      }
    `;
    shadow.appendChild(style);
    
    const container = document.createElement('div');
    container.className = 'control-panel';
    container.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">
          <div class="recording-indicator" id="recording-indicator"></div>
          <span>直播录制助手</span>
        </div>
        <div class="panel-buttons">
          <button class="btn-minimize" id="btn-minimize" title="最小化">−</button>
          <button class="btn-close" id="btn-close" title="关闭">×</button>
        </div>
      </div>
      
      <div class="minimized-bar">
        <div class="recording-indicator" id="recording-indicator-min"></div>
        <span class="minimized-text">录制助手</span>
        <span class="minimized-timer" id="minimized-timer" style="display: none;">00:00</span>
      </div>
      
      <div class="panel-content">
        <div class="info-section">
          <div class="info-row">
            <span class="info-label">主播</span>
            <span class="info-value" id="info-streamer">-</span>
          </div>
          <div class="info-row">
            <span class="info-label">直播间</span>
            <span class="info-value" id="info-room">-</span>
          </div>
          <div class="info-row">
            <span class="info-label">标题</span>
            <span class="info-value" id="info-title">-</span>
          </div>
        </div>
        
        <div class="status-section">
          <span class="status-badge idle" id="status-badge">等待操作</span>
        </div>
        
        <div class="timer-section" id="timer-section" style="display: none;">
          <span id="timer-display">00:00</span>
        </div>
        
        <div class="controls-section">
          <button class="control-btn btn-start" id="btn-start">开始录制</button>
          <button class="control-btn btn-stop" id="btn-stop" disabled>停止录制</button>
        </div>
        
        <div class="help-text">
          <p>点击「开始录制」后，在弹出的窗口中：<br>
          <strong>选择「标签页」→ 选中当前直播间标签页 → 勾选「分享音频」→ 点击「分享」</strong></p>
        </div>
        
        <div class="format-note">
          格式说明：当前录制格式为 <strong>WebM</strong>（浏览器原生支持，兼容性最好）。<br>
          如需MP4格式，可使用格式转换工具（如FFmpeg）进行转换。
        </div>
      </div>
    `;
    
    shadow.appendChild(container);
    globalState.panelElement = panel;
    
    return panel;
  }

  function setupPanelEventListeners() {
    const shadow = globalState.shadowRoot;
    if (!shadow) return;
    
    const btnClose = shadow.getElementById('btn-close');
    const btnMinimize = shadow.getElementById('btn-minimize');
    const btnStart = shadow.getElementById('btn-start');
    const btnStop = shadow.getElementById('btn-stop');
    const container = shadow.querySelector('.control-panel');
    const minimizedBar = shadow.querySelector('.minimized-bar');
    
    if (btnClose) {
      btnClose.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideControlPanel();
      });
    }
    
    if (btnMinimize) {
      btnMinimize.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.toggle('minimized');
      });
    }
    
    if (minimizedBar) {
      minimizedBar.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.remove('minimized');
      });
    }
    
    if (btnStart) {
      btnStart.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await startRecordingFlow();
      });
    }
    
    if (btnStop) {
      btnStop.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await stopRecordingFlow();
      });
    }
  }

  function showControlPanel(roomInfo, config) {
    log('显示控制面板');
    
    let panel = globalState.panelElement;
    
    if (!panel) {
      panel = createControlPanel();
      setupPanelEventListeners();
    }
    
    globalState.recordingInfo = {
      roomId: roomInfo.roomId || getCurrentRoomId(),
      streamerName: roomInfo.streamerName || '未知主播',
      title: roomInfo.title || '未知标题'
    };
    globalState.config = config;
    
    updatePanelInfo();
    
    if (!document.body.contains(panel)) {
      document.body.appendChild(panel);
    }
    
    panel.style.display = 'block';
    globalState.isPanelVisible = true;
    
    const container = globalState.shadowRoot?.querySelector('.control-panel');
    if (container) {
      container.classList.remove('minimized');
    }
    
    log('控制面板已显示');
  }

  function hideControlPanel() {
    log('隐藏控制面板');
    
    if (globalState.isRecording) {
      log('录制中，不隐藏控制面板');
      return;
    }
    
    if (globalState.panelElement) {
      globalState.panelElement.style.display = 'none';
    }
    
    globalState.isPanelVisible = false;
    log('控制面板已隐藏');
  }

  function updatePanelInfo() {
    const shadow = globalState.shadowRoot;
    if (!shadow || !globalState.recordingInfo) return;
    
    const infoStreamer = shadow.getElementById('info-streamer');
    const infoRoom = shadow.getElementById('info-room');
    const infoTitle = shadow.getElementById('info-title');
    
    if (infoStreamer) {
      infoStreamer.textContent = globalState.recordingInfo.streamerName || '-';
    }
    if (infoRoom) {
      infoRoom.textContent = globalState.recordingInfo.roomId || '-';
    }
    if (infoTitle) {
      infoTitle.textContent = globalState.recordingInfo.title || '-';
    }
  }

  function updateRecordingStatus(isRecording) {
    const shadow = globalState.shadowRoot;
    if (!shadow) return;
    
    const indicator = shadow.getElementById('recording-indicator');
    const indicatorMin = shadow.getElementById('recording-indicator-min');
    const statusBadge = shadow.getElementById('status-badge');
    const btnStart = shadow.getElementById('btn-start');
    const btnStop = shadow.getElementById('btn-stop');
    const timerSection = shadow.getElementById('timer-section');
    const minimizedTimer = shadow.getElementById('minimized-timer');
    
    const indicators = [indicator, indicatorMin];
    
    if (isRecording) {
      indicators.forEach(i => i?.classList.add('active'));
      statusBadge?.classList.remove('idle');
      statusBadge?.classList.add('recording');
      statusBadge.textContent = '录制中...';
      
      if (btnStart) {
        btnStart.disabled = true;
      }
      if (btnStop) {
        btnStop.disabled = false;
      }
      if (timerSection) {
        timerSection.style.display = 'block';
      }
      if (minimizedTimer) {
        minimizedTimer.style.display = 'inline';
      }
    } else {
      indicators.forEach(i => i?.classList.remove('active'));
      statusBadge?.classList.add('idle');
      statusBadge?.classList.remove('recording');
      statusBadge.textContent = '等待操作';
      
      if (btnStart) {
        btnStart.disabled = false;
      }
      if (btnStop) {
        btnStop.disabled = true;
      }
      if (timerSection) {
        timerSection.style.display = 'none';
      }
      if (minimizedTimer) {
        minimizedTimer.style.display = 'none';
      }
    }
  }

  function updateTimer() {
    const shadow = globalState.shadowRoot;
    if (!shadow || !globalState.startTime) return;
    
    const elapsed = Math.floor((Date.now() - globalState.startTime) / 1000);
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;
    
    let display;
    if (hours > 0) {
      display = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    const timerDisplay = shadow.getElementById('timer-display');
    const minimizedTimer = shadow.getElementById('minimized-timer');
    
    if (timerDisplay) {
      timerDisplay.textContent = display;
    }
    if (minimizedTimer) {
      minimizedTimer.textContent = display;
    }
  }

  async function getDisplayMediaStream() {
    log('获取媒体流...');
    
    try {
      const constraints = {
        video: {
          cursor: 'always'
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      };
      
      log('调用 getDisplayMedia，constraints:', JSON.stringify(constraints));
      
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      
      log('媒体流获取成功');
      log('视频轨道数:', stream.getVideoTracks().length);
      log('音频轨道数:', stream.getAudioTracks().length);
      
      if (stream.getAudioTracks().length === 0) {
        log('警告：没有音频轨道！请确保在分享时勾选了"分享音频"');
        alert('注意：您未选择"分享音频"选项，录制的视频将只有画面没有声音！\n\n请点击"停止录制"，然后重新点击"开始录制"，在弹出的窗口中：\n1. 选择「标签页」标签\n2. 选择当前直播间标签页\n3. 勾选「分享音频」复选框\n4. 点击「分享」');
      }
      
      return stream;
      
    } catch (error) {
      log('获取媒体流失败:', error.message);
      log('错误名称:', error.name);
      
      if (error.name === 'NotAllowedError') {
        log('用户取消了屏幕分享');
      } else if (error.name === 'NotFoundError') {
        log('找不到视频源');
      }
      
      throw error;
    }
  }

  function getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
      'video/mp4;codecs=h264,aac'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        log('支持的MIME类型:', type);
        return type;
      }
    }
    
    log('未找到支持的MIME类型，使用默认');
    return '';
  }

  function generateFileName(roomInfo, startTime) {
    const date = new Date(startTime);
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = date.toTimeString().slice(0, 8).replace(/:/g, '');
    const streamerName = (roomInfo.streamerName || 'unknown').replace(/[<>:\"/\\|?*]/g, '_');
    
    return `${streamerName}_${dateStr}_${timeStr}.webm`;
  }

  async function startRecordingFlow() {
    log('开始录制流程');
    
    if (globalState.isRecording) {
      log('已经在录制中');
      return;
    }
    
    try {
      const stream = await getDisplayMediaStream();
      globalState.mediaStream = stream;
      
      const mimeType = getSupportedMimeType();
      
      let options;
      if (mimeType) {
        options = { mimeType: mimeType };
      } else {
        options = {};
      }
      
      log('MediaRecorder options:', options);
      
      const mediaRecorder = new MediaRecorder(stream, options);
      globalState.mediaRecorder = mediaRecorder;
      globalState.recordedChunks = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          globalState.recordedChunks.push(event.data);
          log('收到数据块，大小:', event.data.size);
        }
      };
      
      mediaRecorder.onstop = async () => {
        log('MediaRecorder onstop 触发');
        await handleRecordingComplete();
      };
      
      mediaRecorder.onerror = (event) => {
        log('MediaRecorder 错误:', event.error?.message || '未知错误');
      };
      
      mediaRecorder.start(1000);
      log('MediaRecorder 已启动');
      
      globalState.isRecording = true;
      globalState.startTime = Date.now();
      
      globalState.timerInterval = setInterval(updateTimer, 1000);
      
      updateRecordingStatus(true);
      
      try {
        await chrome.runtime.sendMessage({
          type: 'RECORD_STARTED',
          roomId: globalState.recordingInfo?.roomId || getCurrentRoomId()
        });
      } catch (e) {
        log('发送录制开始消息失败:', e.message);
      }
      
      stream.getVideoTracks()[0]?.addEventListener('ended', async () => {
        log('视频轨道结束（用户停止分享）');
        if (globalState.isRecording) {
          await stopRecordingFlow();
        }
      });
      
    } catch (error) {
      log('开始录制失败:', error.message);
      
      if (error.name !== 'NotAllowedError') {
        alert(`开始录制失败：${error.message}\n\n请确保：\n1. 选择「标签页」而不是「屏幕」或「窗口」\n2. 选择当前直播间标签页\n3. 勾选「分享音频」选项`);
      }
      
      cleanupRecording();
    }
  }

  async function stopRecordingFlow() {
    log('停止录制流程');
    
    if (!globalState.isRecording) {
      log('当前没有录制');
      return;
    }
    
    try {
      if (globalState.timerInterval) {
        clearInterval(globalState.timerInterval);
        globalState.timerInterval = null;
      }
      
      if (globalState.mediaRecorder && globalState.mediaRecorder.state !== 'inactive') {
        log('停止 MediaRecorder...');
        globalState.mediaRecorder.stop();
      } else {
        log('MediaRecorder 已经停止，直接处理完成');
        await handleRecordingComplete();
      }
      
    } catch (error) {
      log('停止录制失败:', error.message);
      cleanupRecording();
    }
  }

  async function handleRecordingComplete() {
    log('处理录制完成');
    
    globalState.isRecording = false;
    updateRecordingStatus(false);
    
    if (globalState.timerInterval) {
      clearInterval(globalState.timerInterval);
      globalState.timerInterval = null;
    }
    
    if (globalState.recordedChunks.length === 0) {
      log('警告：没有录制到任何数据');
      alert('录制失败：没有录制到任何数据，请重试。');
      cleanupRecording();
      return;
    }
    
    try {
      const mimeType = globalState.mediaRecorder?.mimeType || 'video/webm';
      log('录制的MIME类型:', mimeType);
      
      const blob = new Blob(globalState.recordedChunks, { type: mimeType });
      log('录制的Blob大小:', blob.size, '字节');
      
      if (blob.size === 0) {
        alert('录制失败：录制的文件大小为0，请重试。');
        cleanupRecording();
        return;
      }
      
      const endTime = Date.now();
      const duration = globalState.startTime 
        ? Math.floor((endTime - globalState.startTime) / 1000) 
        : 0;
      
      const fileName = generateFileName(
        globalState.recordingInfo || {}, 
        globalState.startTime || Date.now()
      );
      
      log('生成文件名:', fileName);
      
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      
      log('下载已触发');
      
      try {
        await chrome.runtime.sendMessage({
          type: 'RECORD_COMPLETED',
          roomId: globalState.recordingInfo?.roomId || getCurrentRoomId(),
          streamerName: globalState.recordingInfo?.streamerName,
          title: globalState.recordingInfo?.title,
          startTime: globalState.startTime ? new Date(globalState.startTime).toISOString() : null,
          endTime: new Date(endTime).toISOString(),
          duration: duration,
          fileSize: blob.size,
          fileName: fileName
        });
      } catch (e) {
        log('发送录制完成消息失败:', e.message);
      }
      
      const mbSize = (blob.size / (1024 * 1024)).toFixed(2);
      alert(`录制完成！\n\n文件：${fileName}\n大小：${mbSize} MB\n时长：${formatDuration(duration)}\n\n文件已开始下载。`);
      
    } catch (error) {
      log('处理录制完成失败:', error.message);
      alert(`录制处理失败：${error.message}`);
    }
    
    cleanupRecording();
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

  function cleanupRecording() {
    log('清理录制资源');
    
    if (globalState.mediaStream) {
      globalState.mediaStream.getTracks().forEach(track => {
        track.stop();
      });
      globalState.mediaStream = null;
    }
    
    globalState.mediaRecorder = null;
    globalState.recordedChunks = [];
    globalState.isRecording = false;
    globalState.startTime = null;
    
    if (globalState.timerInterval) {
      clearInterval(globalState.timerInterval);
      globalState.timerInterval = null;
    }
    
    updateRecordingStatus(false);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        let response = await handleContentMessage(message, sender);
        sendResponse(response);
      } catch (error) {
        log('处理消息出错:', error.message);
        sendResponse({ success: false, error: error.message });
      }
    })();
    
    return true;
  });

  async function handleContentMessage(message, sender) {
    log('收到消息:', message.type);
    
    switch (message.type) {
      case 'RECORD_COMMAND':
        return await handleRecordCommand(message);
        
      case 'CHECK_STATUS':
        return {
          success: true,
          isRecording: globalState.isRecording,
          isPanelVisible: globalState.isPanelVisible,
          recordingInfo: globalState.recordingInfo
        };
        
      case 'SHOW_PANEL':
        showControlPanel(
          {
            roomId: message.roomId,
            streamerName: message.streamerName,
            title: message.title
          },
          message.config
        );
        return { success: true };
        
      default:
        return { success: false, error: 'Unknown message type' };
    }
  }

  async function handleRecordCommand(message) {
    const command = message.command;
    log('处理录制命令:', command);
    
    switch (command) {
      case 'SHOW_PANEL':
      case 'SHOW_PANEL_ONLY':
        showControlPanel(
          {
            roomId: message.roomId,
            streamerName: message.streamerName,
            title: message.title
          },
          message.config
        );
        return { success: true };
        
      case 'START':
        await startRecordingFlow();
        return { success: true };
        
      case 'STOP':
        await stopRecordingFlow();
        return { success: true };
        
      case 'HIDE':
        hideControlPanel();
        return { success: true };
        
      default:
        return { success: false, error: 'Unknown command' };
    }
  }

  function injectManualRecordingButton() {
    if (document.getElementById('bilibilimonitor-manual-btn')) {
      return;
    }
    
    const observer = new MutationObserver(() => {
      addManualButton();
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    addManualButton();
  }

  function addManualButton() {
    if (document.getElementById('bilibilimonitor-manual-btn')) {
      return;
    }
    
    const targetAreas = [
      '.room-tools-area',
      '.tool-bar',
      '.live-room-top',
      '.player-auxiliary-control-area',
      '.header-actions',
      '#head-info-vm'
    ];
    
    let targetElement = null;
    
    for (const selector of targetAreas) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        targetElement = elements[elements.length - 1];
        break;
      }
    }
    
    if (!targetElement) {
      targetElement = document.body;
    }
    
    const btn = document.createElement('button');
    btn.id = 'bilibilimonitor-manual-btn';
    btn.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      padding: 10px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 25px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      z-index: 2147483646;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
      transition: all 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    btn.innerHTML = '🎥 录制助手';
    
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.05)';
      btn.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
    });
    
    btn.addEventListener('click', () => {
      const roomId = getCurrentRoomId();
      const streamerName = document.querySelector('.room-owner-username, .host-name, .username')?.textContent?.trim() || '主播';
      const title = document.querySelector('.room-title, .live-title')?.textContent?.trim() || '直播中';
      
      showControlPanel({
        roomId: roomId,
        streamerName: streamerName,
        title: title
      }, null);
    });
    
    document.body.appendChild(btn);
    log('已添加手动录制按钮');
  }

  function init() {
    log('内容脚本初始化 v1.1.0');
    
    injectManualRecordingButton();
    
    const roomId = getCurrentRoomId();
    if (roomId) {
      log(`检测到B站直播间: ${roomId}`);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  log('内容脚本已加载 v1.1.0');
  console.log('修复内容：');
  console.log('1. 修复弹窗关闭按钮问题');
  console.log('2. 修复录制无声音问题（添加音频提示）');
  console.log('3. 修复MP4格式问题（默认webm）');
  console.log('4. 新增手动录制控制功能');
  console.log('5. 优化录制流程，不强制自动授权');
})();
