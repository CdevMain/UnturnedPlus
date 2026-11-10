// ============================================================
// notifCenter.js — A lista de notificações (tela)
//
// O balão é o aviso; esta lista é a memória. Quem estava no jogo,
// de costas, ou simplesmente piscou, perdia tudo — e boa parte do
// que o app tem a dizer ("o wipe é amanhã", "fulano entrou no
// servidor do time") só vale se continuar disponível depois.
//
// Decisões pequenas que mudam o uso:
//
//  • Abrir o menu NÃO marca tudo como lido. Marcar por abrir é como
//    se perde o aviso que a pessoa foi ver e não teve tempo de
//    tratar. Existe o botão para isso, e clicar numa linha marca só
//    aquela.
//
//  • Clicar numa notificação de servidor ABRE o servidor. Um aviso
//    que não leva a lugar nenhum obriga a pessoa a procurar do que
//    ele falava.
//
//  • O selo mostra não-lidas, não o total. Total vira um número
//    grande e permanente que ninguém olha.
// ============================================================

const NotifCenter = {
  itens: [],
  naoLidas: 0,

  async carregar() {
    const r = await window.api.notifList({ limit: 60 });
    this.itens = (r && r.items) || [];
    this.naoLidas = (r && r.unread) || 0;
    this.pintarSelo();
    this.render();
  },

  pintarSelo() {
    const b = document.getElementById('notif-badge');
    if (!b) return;
    b.textContent = this.naoLidas > 99 ? '99+' : String(this.naoLidas);
    b.classList.toggle('hidden', this.naoLidas === 0);
  },

  icone(kind) {
    return ({
      join: 'login', leave: 'logout', wipe: 'refresh', event: 'calendar',
      airdrop: 'parachute', team: 'users', system: 'info'
    })[kind] || 'info';
  },

  render() {
    const box = document.getElementById('notif-list');
    if (!box) return;

    if (!this.itens.length) {
      box.innerHTML = `<p class="muted small nm-empty">${escapeHtml(I18N.t('notif.empty'))}</p>`;
      return;
    }

    box.innerHTML = this.itens.map((n) => `
      <button class="nm-item${n.read ? '' : ' unread'}" data-notif="${escapeHtml(n.id)}"
              data-bmid="${escapeHtml(n.bmId || '')}">
        <span class="nm-ico k-${escapeHtml(n.kind)}">${Icon.svg(this.icone(n.kind), 15)}</span>
        <span class="nm-body">
          <span class="nm-title">${escapeHtml(I18N.t('notif.' + n.kind, { name: n.title }) || n.title)}</span>
          ${n.body ? `<span class="nm-sub">${escapeHtml(n.body)}</span>` : ''}
        </span>
        <time class="nm-when">${escapeHtml(this.quando(n.at))}</time>
      </button>`).join('');

    box.onclick = async (e) => {
      const it = e.target.closest('[data-notif]');
      if (!it) return;
      const id = it.dataset.notif;
      const bmId = it.dataset.bmid;
      // Marca SÓ esta. Abrir o menu não pode zerar o que a pessoa
      // ainda não leu.
      await window.api.notifMarkRead([id]);
      await this.carregar();
      if (bmId && AppState.config.servers.some((s) => s.bmId === bmId)) {
        document.getElementById('notif-menu').classList.add('hidden');
        openTracking(bmId);
      }
    };
  },

  // "agora", "12min", "3h", "ontem", ou a data. Hora cheia numa
  // lista de avisos recentes obriga a fazer a conta de cabeça.
  quando(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return I18N.t('time.now');
    if (s < 3600) return Math.floor(s / 60) + 'min';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    const d = new Date(ts);
    if (s < 172800) return I18N.t('time.yesterday');
    return d.toLocaleDateString(I18N.lang, { day: '2-digit', month: '2-digit' });
  }
};

function initNotifCenter() {
  const btn = document.getElementById('btn-notif');
  const menu = document.getElementById('notif-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) await NotifCenter.carregar();
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) menu.classList.add('hidden');
  });

  document.getElementById('notif-read-all').addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.notifMarkRead(null);
    await NotifCenter.carregar();
  });
  document.getElementById('notif-clear').addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.notifClear();
    await NotifCenter.carregar();
    toast(I18N.t('notif.cleared'));
  });

  // Chegou uma nova: o selo sobe na hora, e a lista só é redesenhada
  // se o menu estiver aberto (redesenhar o que ninguém vê é
  // trabalho jogado fora).
  window.api.onNotifNew(({ unread }) => {
    NotifCenter.naoLidas = unread;
    NotifCenter.pintarSelo();
    if (!menu.classList.contains('hidden')) NotifCenter.carregar();
  });

  NotifCenter.carregar();
}
