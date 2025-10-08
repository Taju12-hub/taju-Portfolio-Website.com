(function(){
  'use strict';

  const serverUrl = (window.WEBRTC_SIGNAL_URL || 'http://localhost:3000');
  const socket = io(serverUrl, { transports: ['websocket'], reconnection: true });

  const localVideoEl = document.getElementById('localVideo');
  const remoteVideoEl = document.getElementById('remoteVideo');
  const roomInputEl = document.getElementById('roomId');
  const btnJoin = document.getElementById('btnJoin');
  const btnLeave = document.getElementById('btnLeave');
  const btnMic = document.getElementById('btnMic');
  const btnCam = document.getElementById('btnCam');
  const btnSwap = document.getElementById('btnSwap');
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');

  let localStream = null;
  let peerConnection = null;
  let roomId = null;
  let micEnabled = true;
  let camEnabled = true;

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
    ]
  };

  function appendChat(from, text) {
    const div = document.createElement('div');
    div.className = 'chat-message';
    div.innerHTML = `<span class="from">${from}:</span> ${escapeHtml(text)}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function escapeHtml(str){
    return str.replace(/[&<>"]+/g, function(s){
      const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' };
      return map[s] || s;
    });
  }

  async function ensureLocalStream() {
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideoEl.srcObject = localStream;
    updateMediaButtonsState(true);
    return localStream;
  }

  function updateMediaButtonsState(enabled){
    btnMic.disabled = !enabled;
    btnCam.disabled = !enabled;
    btnSwap.disabled = !enabled;
  }

  function enableCallButtons(inCall){
    btnJoin.disabled = inCall;
    btnLeave.disabled = !inCall;
  }

  function createPeerConnection(){
    if (peerConnection) return peerConnection;

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && roomId) {
        socket.emit('candidate', { room: roomId, candidate: event.candidate });
      }
    };

    peerConnection.ontrack = (event) => {
      if (!remoteVideoEl.srcObject) {
        remoteVideoEl.srcObject = event.streams[0];
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        cleanupPeer();
      }
    };

    if (localStream) {
      for (const track of localStream.getTracks()) {
        peerConnection.addTrack(track, localStream);
      }
    }

    return peerConnection;
  }

  function cleanupPeer(){
    if (peerConnection) {
      try { peerConnection.close(); } catch(e) {}
    }
    peerConnection = null;
    if (remoteVideoEl.srcObject) {
      try {
        remoteVideoEl.srcObject.getTracks().forEach(t => t.stop());
      } catch(e) {}
      remoteVideoEl.srcObject = null;
    }
    enableCallButtons(false);
  }

  async function startCallAsCaller(){
    await ensureLocalStream();
    const pc = createPeerConnection();
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    socket.emit('offer', { room: roomId, sdp: offer });
  }

  async function handleOffer(sdp){
    await ensureLocalStream();
    const pc = createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { room: roomId, sdp: answer });
  }

  async function handleAnswer(sdp){
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async function handleCandidate(candidate){
    if (!peerConnection) return;
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE candidate', err);
    }
  }

  async function joinRoom(){
    roomId = (roomInputEl.value || 'room1').trim();
    if (!roomId) return;

    await ensureLocalStream();
    createPeerConnection();

    socket.emit('join', roomId);
    enableCallButtons(true);
    appendChat('System', `Joined room ${roomId}`);
  }

  function leaveRoom(){
    if (!roomId) return;
    socket.emit('leave', roomId);
    roomId = null;

    cleanupPeer();
    appendChat('System', 'Left the room');
  }

  function toggleMic(){
    if (!localStream) return;
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
    btnMic.innerHTML = micEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
  }

  function toggleCam(){
    if (!localStream) return;
    camEnabled = !camEnabled;
    localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
    btnCam.innerHTML = camEnabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
  }

  async function swapCamera(){
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    const currentFacing = videoTrack.getSettings().facingMode;
    const newFacing = currentFacing === 'environment' ? 'user' : 'environment';
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: newFacing } },
      audio: true
    });

    const newVideoTrack = newStream.getVideoTracks()[0];
    const sender = peerConnection && peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      await sender.replaceTrack(newVideoTrack);
    }

    localStream.removeTrack(videoTrack);
    videoTrack.stop();
    localStream.addTrack(newVideoTrack);
    localVideoEl.srcObject = null;
    localVideoEl.srcObject = localStream;
  }

  function sendChat(){
    const text = (chatInput.value || '').trim();
    if (!text || !roomId) return;
    appendChat('Me', text);
    socket.emit('chat-message', { room: roomId, from: 'Peer', text });
    chatInput.value = '';
  }

  // Socket events
  socket.on('connect', () => {
    // noop
  });

  socket.on('ready', () => {
    // Another peer is ready; act as caller
    if (roomId) {
      startCallAsCaller().catch(console.error);
    }
  });

  socket.on('offer', (sdp) => {
    handleOffer(sdp).catch(console.error);
  });

  socket.on('answer', (sdp) => {
    handleAnswer(sdp).catch(console.error);
  });

  socket.on('candidate', (candidate) => {
    handleCandidate(candidate).catch(console.error);
  });

  socket.on('leave', () => {
    cleanupPeer();
  });

  socket.on('chat-message', ({from, text}) => {
    appendChat(from || 'Peer', text || '');
  });

  // UI events
  btnJoin && btnJoin.addEventListener('click', joinRoom);
  btnLeave && btnLeave.addEventListener('click', leaveRoom);
  btnMic && btnMic.addEventListener('click', toggleMic);
  btnCam && btnCam.addEventListener('click', toggleCam);
  btnSwap && btnSwap.addEventListener('click', swapCamera);
  chatSend && chatSend.addEventListener('click', sendChat);
  chatInput && chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  window.addEventListener('beforeunload', () => {
    if (roomId) socket.emit('leave', roomId);
  });
})();
