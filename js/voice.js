// ============================================================
// voice.js — Voz do grupo (WebRTC)
//
// ESTADO: o caminho de áudio está COMPLETO e funciona hoje. O que
// falta é só o servidor de sinalização — a parte que apresenta um
// jogador ao outro. Enquanto ele não existe, o "Testar microfone"
// roda a pilha WebRTC INTEIRA localmente: captura do microfone,
// RTCPeerConnection de verdade, codec, jitter buffer e reprodução.
// Se funcionar aqui, funciona com o servidor.
//
// Isso não é enfeite de demonstração. Quase tudo que quebra em voz
// quebra ANTES da rede: permissão do microfone negada, dispositivo
// errado selecionado, eco por falta de cancelamento, ganho zerado.
// Esses casos são testáveis hoje, na máquina de quem for usar.
//
// ------------------------------------------------------------
// POR QUE P2P E NÃO UM SERVIDOR DE ÁUDIO
// ------------------------------------------------------------
// Grupo de jogo tem 4 a 10 pessoas. Em malha (cada um com cada
// um), 6 pessoas dão 5 conexões por pessoa — o que uma conexão
// doméstica aguenta com folga, e o áudio não passa por servidor
// nenhum: menos atraso e nada gravado no meio do caminho.
// Acima de ~10 valeria um SFU; até lá, malha é mais simples e
// melhor. O servidor só apresenta um ao outro (sinalização) e
// serve de STUN/TURN quando o NAT não deixa passar.
// ============================================================

const Voice = {
  ready: false,
  joined: false,
  channelId: null,
  localStream: null,
  peers: new Map(),        // userId -> { pc, stream, audio, level }
  muted: false,
  deafened: false,
  pushToTalk: false,
  pttKey: 'AltLeft',
  pttActive: false,
  inputDeviceId: null,
  outputDeviceId: null,
  gain: 1,
  audioCtx: null,
  analyser: null,
  levelTimer: null,
  onLevel: null,
  onPeers: null,
  lastError: null,

  // STUN público basta para a maioria das casas. TURN (relay para
  // NAT simétrico) precisa de servidor próprio — entra junto com a
  // hospedagem.
  rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
};

// ------------------------------------------------------------
// Microfone
// ------------------------------------------------------------
async function voiceStart(opts = {}) {
  try {
    Voice.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: Voice.inputDeviceId ? { exact: Voice.inputDeviceId } : undefined,
        // Os três de sempre. Sem cancelamento de eco, quem estiver
        // no alto-falante devolve a voz de todo mundo de volta.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    Voice.ready = true;
    Voice.lastError = null;
    startLevelMeter();
    applyMute();
    return { ok: true };
  } catch (e) {
    Voice.ready = false;
    // Distinguir os motivos importa: "negado" se resolve na
    // permissão do Windows, "não encontrado" é outro problema.
    Voice.lastError =
      e.name === 'NotAllowedError' ? 'permission_denied' :
      e.name === 'NotFoundError' ? 'no_microphone' :
      e.name === 'NotReadableError' ? 'device_busy' : e.name || 'unknown';
    return { ok: false, reason: Voice.lastError };
  }
}

function voiceStop() {
  stopLevelMeter();
  for (const [id] of Voice.peers) closePeer(id);
  if (Voice.localStream) {
    for (const t of Voice.localStream.getTracks()) t.stop();
    Voice.localStream = null;
  }
  Voice.ready = false;
  Voice.joined = false;
  Voice.channelId = null;
}

async function listDevices() {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: todos.filter((d) => d.kind === 'audioinput').map((d) => ({ id: d.deviceId, label: d.label })),
      outputs: todos.filter((d) => d.kind === 'audiooutput').map((d) => ({ id: d.deviceId, label: d.label }))
    };
  } catch {
    return { inputs: [], outputs: [] };
  }
}

// ------------------------------------------------------------
// Mudo, surdo e push-to-talk
// ------------------------------------------------------------
function applyMute() {
  if (!Voice.localStream) return;
  // Em push-to-talk a faixa fica desligada até a tecla descer.
  const ligado = Voice.pushToTalk ? (Voice.pttActive && !Voice.muted) : !Voice.muted;
  for (const t of Voice.localStream.getAudioTracks()) t.enabled = ligado;
}

function setMuted(v) { Voice.muted = !!v; applyMute(); }

function setDeafened(v) {
  Voice.deafened = !!v;
  for (const [, p] of Voice.peers) if (p.audio) p.audio.muted = Voice.deafened;
  // Ficar surdo sem ficar mudo é pegadinha: você fala e não ouve a
  // resposta. Os dois andam juntos, como em qualquer app de voz.
  if (Voice.deafened) setMuted(true);
}

function initPushToTalk() {
  window.addEventListener('keydown', (e) => {
    if (!Voice.pushToTalk || e.code !== Voice.pttKey || Voice.pttActive) return;
    Voice.pttActive = true; applyMute();
  });
  window.addEventListener('keyup', (e) => {
    if (!Voice.pushToTalk || e.code !== Voice.pttKey) return;
    Voice.pttActive = false; applyMute();
  });
  // Perder o foco com a tecla pressionada deixaria o microfone
  // aberto sem ninguém perceber.
  window.addEventListener('blur', () => {
    if (Voice.pttActive) { Voice.pttActive = false; applyMute(); }
  });
}

// ------------------------------------------------------------
// Medidor de nível
// ------------------------------------------------------------
// É o que responde "meu microfone está pegando?" sem depender de
// outra pessoa do outro lado.
function startLevelMeter() {
  if (!Voice.localStream) return;
  try {
    Voice.audioCtx = Voice.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const src = Voice.audioCtx.createMediaStreamSource(Voice.localStream);
    Voice.analyser = Voice.audioCtx.createAnalyser();
    Voice.analyser.fftSize = 512;
    src.connect(Voice.analyser);
    const buf = new Uint8Array(Voice.analyser.frequencyBinCount);
    Voice.levelPeak = 0;
    Voice.levelTimer = setInterval(() => {
      Voice.analyser.getByteTimeDomainData(buf);
      let soma = 0;
      for (const v of buf) { const d = (v - 128) / 128; soma += d * d; }
      const rms = Math.min(1, Math.sqrt(soma / buf.length) * 3);
      // Sobe na hora, desce devagar. Fala normal tem silêncio entre
      // as sílabas; um medidor que zera nesses buracos pisca sem
      // parar e passa a impressão de microfone falhando.
      // 0,6 por tique de 100 ms: um buraco de 200 ms entre sílabas
      // derruba a barra para 36% (mexe, mas não pisca), e do topo
      // até o zero leva ~0,8 s — rápido o bastante para a barra
      // corresponder ao que a pessoa está falando AGORA.
      Voice.levelPeak = rms > Voice.levelPeak
        ? rms
        : Math.max(rms, Voice.levelPeak * 0.6);
      // A queda é geométrica: sem um piso, o medidor NUNCA chega a
      // zero e fica parado em 2 ou 3% numa sala silenciosa — o que
      // se lê como "o microfone está captando alguma coisa".
      if (Voice.levelPeak < 0.02) Voice.levelPeak = 0;
      if (Voice.onLevel) Voice.onLevel(Voice.levelPeak);
    }, 100);
  } catch { /* sem medidor não é motivo para derrubar a voz */ }
}

function stopLevelMeter() {
  if (Voice.levelTimer) clearInterval(Voice.levelTimer);
  Voice.levelTimer = null;
  Voice.analyser = null;
  Voice.levelPeak = 0;
  if (Voice.onLevel) Voice.onLevel(0);
}

// ------------------------------------------------------------
// Conexões
// ------------------------------------------------------------
// `send` é a função de sinalização: leva a oferta/resposta/ICE até
// o outro. Hoje é o loopback; amanhã é o WebSocket do servidor.
// O resto deste arquivo não muda quando isso acontecer.
function createPeer(userId, send) {
  const pc = new RTCPeerConnection(Voice.rtcConfig);
  const peer = { pc, stream: null, audio: null, level: 0, state: 'new' };
  Voice.peers.set(userId, peer);

  if (Voice.localStream) {
    for (const t of Voice.localStream.getTracks()) pc.addTrack(t, Voice.localStream);
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) send({ type: 'ice', to: userId, candidate: e.candidate });
  };
  pc.ontrack = (e) => {
    peer.stream = e.streams[0];
    const a = new Audio();
    a.srcObject = peer.stream;
    a.autoplay = true;
    a.muted = Voice.deafened;
    a.volume = Voice.gain;
    if (Voice.outputDeviceId && a.setSinkId) a.setSinkId(Voice.outputDeviceId).catch(() => {});
    a.play().catch(() => {});
    peer.audio = a;
    if (Voice.onPeers) Voice.onPeers(peerList());
  };
  pc.onconnectionstatechange = () => {
    peer.state = pc.connectionState;
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePeer(userId);
    if (Voice.onPeers) Voice.onPeers(peerList());
  };
  return peer;
}

function closePeer(userId) {
  const p = Voice.peers.get(userId);
  if (!p) return;
  try { p.pc.close(); } catch { /* já fechado */ }
  if (p.audio) { p.audio.pause(); p.audio.srcObject = null; }
  Voice.peers.delete(userId);
  if (Voice.onPeers) Voice.onPeers(peerList());
}

function peerList() {
  return [...Voice.peers.entries()].map(([userId, p]) => ({
    userId, state: p.state, hasAudio: !!p.stream, level: p.level
  }));
}

async function callPeer(userId, send) {
  const peer = Voice.peers.get(userId) || createPeer(userId, send);
  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);
  send({ type: 'offer', to: userId, sdp: offer });
}

// Ponto único de entrada da sinalização: tudo que chega do outro
// lado passa por aqui, venha do loopback ou do WebSocket.
async function onSignal(msg, send) {
  const de = msg.from;
  if (!de) return;
  let peer = Voice.peers.get(de);

  if (msg.type === 'offer') {
    peer = peer || createPeer(de, send);
    await peer.pc.setRemoteDescription(msg.sdp);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    send({ type: 'answer', to: de, sdp: answer });
  } else if (msg.type === 'answer' && peer) {
    await peer.pc.setRemoteDescription(msg.sdp);
  } else if (msg.type === 'ice' && peer) {
    // Candidato que chega antes da descrição remota faz o
    // addIceCandidate lançar. Não é erro fatal — é corrida normal.
    try { await peer.pc.addIceCandidate(msg.candidate); } catch { /* ignora */ }
  } else if (msg.type === 'leave') {
    closePeer(de);
  }
}

// ------------------------------------------------------------
// Teste local — a pilha WebRTC inteira, sem servidor
// ------------------------------------------------------------
// Duas RTCPeerConnections na mesma página conversando entre si.
// Exercita captura, negociação, ICE, codec e reprodução. Se isto
// falhar, o problema é da máquina e não da rede — e é bom saber
// disso antes de acusar o servidor.
async function voiceSelfTest() {
  if (!Voice.localStream) {
    const r = await voiceStart();
    if (!r.ok) return { ok: false, stage: 'microphone', reason: r.reason };
  }
  const a = new RTCPeerConnection(Voice.rtcConfig);
  const b = new RTCPeerConnection(Voice.rtcConfig);
  try {
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});

    for (const t of Voice.localStream.getTracks()) a.addTrack(t, Voice.localStream);

    const recebeu = new Promise((res) => {
      b.ontrack = (e) => res(e.streams[0]);
      setTimeout(() => res(null), 8000);
    });

    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);

    const stream = await recebeu;
    if (!stream) return { ok: false, stage: 'negotiation', reason: 'timeout' };

    // Chegou faixa: a volta completa funcionou.
    const faixas = stream.getAudioTracks().length;
    return {
      ok: faixas > 0,
      stage: 'done',
      tracks: faixas,
      connection: a.connectionState,
      ice: a.iceConnectionState
    };
  } catch (e) {
    return { ok: false, stage: 'exception', reason: e.message };
  } finally {
    a.close(); b.close();
  }
}

// ------------------------------------------------------------
// Sinalização por loopback (enquanto não há servidor)
// ------------------------------------------------------------
// Entrega as mensagens de sinalização para um "outro lado" fictício
// na mesma página. Serve para a tela mostrar o fluxo completo de
// entrar na sala, sem inventar que alguém conectou de verdade.
const VoiceLoopback = {
  outra: null,
  send(msg) {
    if (!this.outra) return;
    setTimeout(() => onSignal({ ...msg, from: 'u_loop' }, (m) => this.send({ ...m, from: 'me' })), 10);
  }
};

function voiceSetOutput(deviceId) {
  Voice.outputDeviceId = deviceId;
  for (const [, p] of Voice.peers) {
    if (p.audio && p.audio.setSinkId) p.audio.setSinkId(deviceId).catch(() => {});
  }
}

function voiceSetGain(v) {
  Voice.gain = Math.max(0, Math.min(2, v));
  for (const [, p] of Voice.peers) if (p.audio) p.audio.volume = Math.min(1, Voice.gain);
}
