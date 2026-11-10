// ============================================================
// notify.js — Aviso de entrada/saída de jogador
//
// Roda numa janela própria, sempre no topo, sem foco e com os
// cliques atravessando (ver main.js). Recebe um evento, mostra o
// cartão pelo tempo configurado e some.
//
// O SOM é sintetizado com a Web Audio API em vez de vir de
// arquivos .wav/.mp3. Motivos:
//   • zero binários no repositório e no instalador;
//   • o volume é controlado de verdade (ganho), não "o arquivo é
//     alto demais";
//   • dá para variar o timbre por tipo de evento sem produzir
//     três arquivos.
// Se o usuário apontar um arquivo próprio, aí sim tocamos o
// arquivo — a síntese é só o padrão que sempre funciona.
// ============================================================
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('toast-card');

  let hideTimer = null;
  let audioCtx = null;

  // ----------------------------------------------------------
  // Som
  // ----------------------------------------------------------
  // Cada preset é uma sequência de [frequência Hz, início s, duração s].
  const SOUNDS = {
    blip:  [[880, 0, 0.07], [1320, 0.07, 0.10]],                 // dois toques curtos, subindo
    soft:  [[523.25, 0, 0.14], [659.25, 0.10, 0.18]],            // dó–mi, suave
    alert: [[1046.5, 0, 0.06], [0, 0.06, 0.04], [1046.5, 0.10, 0.06], [1318.5, 0.18, 0.14]]
  };

  function getCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function playSound(name, volume) {
    const seq = SOUNDS[name] || SOUNDS.blip;
    const ctx = getCtx();
    if (!ctx) return;

    const vol = Math.max(0, Math.min(1, volume == null ? 0.6 : volume));
    if (vol === 0) return;

    const now = ctx.currentTime;
    for (const [freq, start, dur] of seq) {
      if (!freq) continue;                       // pausa
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);

      // Envelope curto: sem o fade, o alto-falante estala.
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(vol * 0.35, now + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);

      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    }
  }

  // ----------------------------------------------------------
  // Cartão
  // ----------------------------------------------------------
  // Nome de ícone SVG. A janela de aviso é a que mais sofria com
  // emoji: fundo translúcido, cartão pequeno e cada Windows
  // desenhando o seu.
  const ICONS = { join: 'plus', leave: 'minus', airdrop: 'parachute',
                  wipe: 'broom', event: 'calendar', test: 'bell' };

  function labelFor(payload) {
    const t = (key, vars) => (typeof I18N !== 'undefined' ? I18N.t(key, vars) : key);
    switch (payload.type) {
      case 'join':    return { title: payload.name, sub: t('notify.joined') };
      case 'leave':   return { title: payload.name, sub: t('notify.left') };
      case 'airdrop': return { title: t('notify.airdropTitle'), sub: payload.name || '' };
      // Wipe e evento chegam com o texto já pronto do main: quem
      // sabe dizer "faltam 2 dias" é o scheduleStore, e ele não roda
      // nesta janela.
      case 'wipe':
      case 'event': {
        const b = payload.beforeMin;
        const quando = b === 0 ? t('sched.now')
          : b >= 1440 ? t('sched.inDays', { n: Math.round(b / 1440) })
          : b >= 60 ? t('sched.inHours', { n: Math.round(b / 60) })
          : t('sched.inMin', { n: b });
        return { title: payload.name, sub: quando };
      }
      default:        return { title: payload.name || 'Unturned+', sub: t('notify.testSub') };
    }
  }

  function show(payload) {
    const mode = payload.mode || 'both';

    if (mode !== 'visual') playSound(payload.sound, payload.volume);
    if (mode === 'sound') {
      // Só som: escondemos a janela logo em seguida.
      window.api.hideNotification();
      return;
    }

    const { title, sub } = labelFor(payload);
    $('toast-title').textContent = title || '';
    $('toast-sub').textContent = payload.server ? `${sub} · ${payload.server}` : sub;
    $('toast-icon').innerHTML = Icon.svg(ICONS[payload.type] || ICONS.test, 18);

    card.className = 'toast-card ' + (payload.type || 'test');
    if (String(payload.position || '').startsWith('bottom')) card.classList.add('from-bottom');

    // Barrinha de tempo: reinicia a animação a cada evento.
    const dur = Math.max(1, payload.durationSec || 4);
    const bar = $('toast-bar');
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth;                       // força o reflow
    bar.style.transition = `transform ${dur}s linear`;
    bar.style.transform = 'scaleX(0)';

    requestAnimationFrame(() => card.classList.add('show'));

    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      card.classList.remove('show');
      setTimeout(() => window.api.hideNotification(), 220);
    }, dur * 1000);
  }

  window.api.onNotify(show);

  // Carrega o idioma para os rótulos ("entrou no servidor").
  (async () => {
    try {
      const cfg = await window.api.getConfig();
      if (typeof I18N !== 'undefined') await I18N.load(cfg.language);
      if (typeof Icon !== 'undefined') Icon.paint();
    } catch { /* sem idioma: cai no texto padrão do I18N */ }
  })();
})();
