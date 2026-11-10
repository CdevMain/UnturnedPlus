// ============================================================
// conta.js — entrar/criar conta e o indicador de conexão
//
// O renderer NÃO guarda token e NÃO abre socket. Ele pede ao
// processo principal e recebe o resultado. Ver accountStore.js.
//
// Um modal só para entrar e criar: são o mesmo formulário com um
// campo a mais. Duas telas separadas seria duplicar validação,
// tradução e tratamento de erro para economizar um clique.
// ============================================================

const Conta = {
  info: { signedIn: false, user: null, baseUrl: '' },
  rede: { estado: 'off' },
  modo: 'login'   // login | registro | recuperar
};

// ------------------------------------------------------------
// Estado da conexão
// ------------------------------------------------------------
function pintarEstadoRede() {
  const dot = document.getElementById('net-dot');
  if (!dot) return;
  const e = Conta.rede.estado;
  dot.className = 'net-dot ' + e;
  dot.title = I18N.t('net.' + e);
  const txt = document.getElementById('net-txt');
  if (txt) txt.textContent = I18N.t('net.' + e);
}

async function carregarConta() {
  const antes = Conta.info.signedIn;
  Conta.info = await window.api.contaInfo();
  Conta.rede = await window.api.netState();
  pintarConta();
  pintarEstadoRede();
  // Entrar ou sair da conta TROCA a fonte do time (disco <-> servidor).
  // Sem redesenhar aqui, a pessoa logava e o painel continuava no
  // modo local até reiniciar o app.
  if (antes !== Conta.info.signedIn && typeof loadTeam === 'function') loadTeam();
  return Conta.info;
}

function pintarConta() {
  const item = document.getElementById('um-conta-txt');
  const sair = document.getElementById('um-sair-conta');
  if (item) {
    item.textContent = Conta.info.signedIn
      ? I18N.t('conta.signedInAs', { u: (Conta.info.user || {}).username || '' })
      : I18N.t('conta.signIn');
  }
  if (sair) sair.classList.toggle('hidden', !Conta.info.signedIn);

  // A aba do time muda de cara conforme a conta: sem conta, o time
  // é só local; com conta, sincroniza.
  document.body.classList.toggle('conta-on', !!Conta.info.signedIn);
}

// ------------------------------------------------------------
// Modal
// ------------------------------------------------------------
function abrirConta(modo = 'login') {
  Conta.modo = modo;
  aplicarModoConta();
  document.getElementById('conta-erro').classList.add('hidden');
  document.getElementById('conta-pass').value = '';
  const srv = document.getElementById('conta-server-txt');
  if (srv) srv.textContent = (Conta.info.baseUrl || '').replace(/^https?:\/\//, '');
  conferirServidor();
  showModal('modal-conta');
  setTimeout(() => document.getElementById(Conta.modo === 'registro' ? 'conta-email' : 'conta-id').focus(), 40);
}

// Três modos no MESMO formulário: entrar, criar e recuperar. Eles
// compartilham o campo de identificação e a checagem do servidor;
// separar em três telas seria triplicar validação e tradução para
// economizar um clique.
function aplicarModoConta() {
  const reg = Conta.modo === 'registro';
  const rec = Conta.modo === 'recuperar';
  const chave = rec ? 'recover' : (reg ? 'create' : 'signIn');

  document.getElementById('conta-titulo').textContent = I18N.t('conta.' + chave);
  document.getElementById('conta-sub').textContent =
    I18N.t(rec ? 'conta.subRecover' : (reg ? 'conta.subCreate' : 'conta.subSignIn'));

  document.getElementById('conta-row-email').classList.toggle('hidden', !reg);
  document.getElementById('conta-lbl-id').textContent =
    I18N.t(reg ? 'conta.username' : 'conta.identifier');

  // Na recuperação a senha ATUAL não existe (é justamente o que se
  // esqueceu): saem senha, entram código e senha nova.
  document.getElementById('conta-pass').closest('label').classList.toggle('hidden', rec);
  document.getElementById('conta-row-code').classList.toggle('hidden', !rec);
  document.getElementById('conta-row-newpass').classList.toggle('hidden', !rec);

  document.getElementById('conta-enviar').textContent =
    I18N.t(rec ? 'conta.recoverDo' : (reg ? 'conta.create' : 'conta.signIn'));
  document.getElementById('conta-alternar').textContent =
    I18N.t(rec ? 'conta.backToSignIn' : (reg ? 'conta.signInInstead' : 'conta.createInstead'));

  // "Esqueci a senha" some no cadastro (não há o que esquecer) e na
  // própria recuperação.
  document.getElementById('conta-esqueci').classList.toggle('hidden', reg || rec);

  document.getElementById('conta-pass').setAttribute(
    'autocomplete', reg ? 'new-password' : 'current-password');
}

// ------------------------------------------------------------
// O código de 9 dígitos
//
// Ele aparece UMA vez. Depois disso o servidor só tem o hash — nem
// ele consegue mostrar de novo. Por isso esta tela é chata de
// propósito: o botão de fechar só libera depois do "anotei".
// ------------------------------------------------------------
function mostrarCodigo(codigo) {
  const modal = document.getElementById('modal-codigo');
  if (!modal || !codigo) return;
  document.getElementById('codigo-valor').textContent = codigo;
  const chk = document.getElementById('codigo-confirmo');
  const btn = document.getElementById('codigo-fechar');
  chk.checked = false;
  btn.disabled = true;
  showModal('modal-codigo');
}

// Máscara 000-000-000 enquanto digita. Aceita colar com ou sem os
// hífens; o servidor também aceita, mas a máscara é o que faz a
// pessoa perceber que errou um dígito antes de enviar.
function mascararCodigo(el) {
  const d = el.value.replace(/\D/g, '').slice(0, 9);
  el.value = d.length > 6 ? `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`
           : d.length > 3 ? `${d.slice(0,3)}-${d.slice(3)}`
           : d;
}

// Confere o servidor ANTES de a pessoa digitar a senha. Descobrir
// que a API está fora do ar depois de preencher tudo é irritante —
// e faz parecer que a senha está errada.
async function conferirServidor() {
  const dot = document.getElementById('conta-dot');
  if (!dot) return;
  dot.className = 'cs-dot checking';
  const r = await window.api.contaHealth();
  dot.className = 'cs-dot ' + (r.ok ? 'up' : 'down');
  dot.title = r.ok ? I18N.t('conta.serverUp') : I18N.t('conta.serverDown');
  if (!r.ok) mostrarErroConta('conta.err_server_down');
}

function mostrarErroConta(chave, vars) {
  const el = document.getElementById('conta-erro');
  const t = I18N.t(chave, vars);
  // Chave sem tradução voltaria como o próprio nome dela na tela.
  el.textContent = t === chave ? I18N.t('conta.err_generic') : t;
  el.classList.remove('hidden');
}

// Trocar a senha com o código. Caminho separado porque não loga:
// termina no login normal, com a senha nova.
async function enviarRecuperacao() {
  const btn = document.getElementById('conta-enviar');
  const id = document.getElementById('conta-id').value.trim();
  const code = document.getElementById('conta-code').value.trim();
  const nova = document.getElementById('conta-newpass').value;
  document.getElementById('conta-erro').classList.add('hidden');

  if (!id || !code || !nova) return mostrarErroConta('conta.err_missing');
  if (nova.length < 8) return mostrarErroConta('conta.err_password_too_short');

  btn.disabled = true;
  btn.textContent = I18N.t('conta.working');
  try {
    const r = await window.api.contaRecuperar({ identifier: id, code, newPassword: nova });
    if (!r.ok) {
      // O servidor diz quantas tentativas restam e quanto falta da
      // trava; mostrar isso evita a pessoa martelar o botão sem saber.
      return mostrarErroConta('conta.err_' + r.error, {
        n: r.attemptsLeft,
        min: r.retryAfterSec ? Math.ceil(r.retryAfterSec / 60) : undefined
      });
    }
    // Deu certo: a senha mudou e um código NOVO já veio junto. A
    // pessoa acabou de gastar o dela; mandá-la "pedir outro depois"
    // garante que ela vai esquecer.
    hideModal('modal-conta');
    toast(I18N.t('conta.recovered'));
    if (r.nextCode) mostrarCodigo(r.nextCode);
    Conta.modo = 'login';
    document.getElementById('conta-code').value = '';
    document.getElementById('conta-newpass').value = '';
  } finally {
    btn.disabled = false;
    aplicarModoConta();
  }
}

async function enviarConta() {
  if (Conta.modo === 'recuperar') return enviarRecuperacao();
  const btn = document.getElementById('conta-enviar');
  const senha = document.getElementById('conta-pass').value;
  const id = document.getElementById('conta-id').value.trim();
  document.getElementById('conta-erro').classList.add('hidden');

  if (!id || !senha) return mostrarErroConta('conta.err_missing');

  btn.disabled = true;
  btn.textContent = I18N.t('conta.working');
  try {
    let r;
    if (Conta.modo === 'registro') {
      const email = document.getElementById('conta-email').value.trim();
      if (!email) return mostrarErroConta('conta.err_missing');
      r = await window.api.contaRegister({ email, username: id, password: senha, displayName: id });
    } else {
      r = await window.api.contaLogin({ identifier: id, password: senha });
    }

    if (!r.ok) {
      // `retryAfterMin` só existe no bloqueio por tentativas.
      return mostrarErroConta('conta.err_' + r.error, { n: r.retryAfterMin });
    }

    hideModal('modal-conta');
    await carregarConta();
    toast(I18N.t('conta.welcome', { u: r.user.displayName || r.user.username }));
    // Conta nova: o código sai agora e não sai mais. A tela do
    // código abre DEPOIS do modal de conta fechar, para não virar
    // modal em cima de modal.
    if (Conta.modo === 'registro' && r.recoveryCode) mostrarCodigo(r.recoveryCode);
    if (typeof loadTeam === 'function') loadTeam();
  } finally {
    btn.disabled = false;
    aplicarModoConta();
  }
}

async function sairDaConta() {
  const r = await window.api.contaLogout(false);
  await carregarConta();
  // Diz a verdade sobre o que aconteceu: se estava sem internet, a
  // sessão continua válida no servidor até vencer.
  toast(I18N.t(r.revoked ? 'conta.signedOut' : 'conta.signedOutLocal'));
  if (typeof loadTeam === 'function') loadTeam();
}

// ------------------------------------------------------------
// Ligação
// ------------------------------------------------------------
function initConta() {
  const menu = document.getElementById('user-menu');

  document.getElementById('um-conta').addEventListener('click', () => {
    menu.classList.add('hidden');
    Conta.info.signedIn ? abrirConta('login') : abrirConta('login');
  });
  document.getElementById('um-sair-conta').addEventListener('click', () => {
    menu.classList.add('hidden');
    sairDaConta();
  });

  document.getElementById('conta-cancelar').addEventListener('click', () => hideModal('modal-conta'));
  document.getElementById('conta-enviar').addEventListener('click', enviarConta);
  document.getElementById('conta-alternar').addEventListener('click', () => {
    // Da recuperação o botão volta para "entrar"; nos outros dois
    // ele alterna entre entrar e criar.
    Conta.modo = Conta.modo === 'recuperar' ? 'login'
               : Conta.modo === 'registro' ? 'login' : 'registro';
    aplicarModoConta();
    document.getElementById('conta-erro').classList.add('hidden');
  });

  document.getElementById('conta-esqueci').addEventListener('click', () => {
    Conta.modo = 'recuperar';
    aplicarModoConta();
    document.getElementById('conta-erro').classList.add('hidden');
    setTimeout(() => document.getElementById('conta-code').focus(), 40);
  });

  const campoCodigo = document.getElementById('conta-code');
  campoCodigo.addEventListener('input', () => mascararCodigo(campoCodigo));
  campoCodigo.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarConta(); });
  document.getElementById('conta-newpass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') enviarConta();
  });

  // ---- Tela do código ----
  const chk = document.getElementById('codigo-confirmo');
  const btnFechar = document.getElementById('codigo-fechar');
  chk.addEventListener('change', () => { btnFechar.disabled = !chk.checked; });
  btnFechar.addEventListener('click', () => hideModal('modal-codigo'));
  document.getElementById('codigo-copiar').addEventListener('click', async () => {
    const v = document.getElementById('codigo-valor').textContent;
    let ok = false;
    try { await navigator.clipboard.writeText(v); ok = true; }
    catch { try { ok = await window.api.copyText(v); } catch { ok = false; } }
    toast(I18N.t(ok ? 'rec.copied' : 'raid.copyFail'));
    // Copiar conta como "anotei": quem copiou tem o código em algum
    // lugar. Continua sendo o clique da pessoa que libera.
    if (ok) { chk.checked = true; btnFechar.disabled = false; }
  });
  document.getElementById('conta-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') enviarConta();
  });

  document.getElementById('conta-trocar-srv').addEventListener('click', async () => {
    const atual = Conta.info.baseUrl || 'https://api.cdev.com.br';
    const novo = await Ask.text(I18N.t('conta.askServer'), { valor: atual });
    if (!novo) return;
    // Só http(s). Sem isto dava para apontar para um esquema
    // qualquer e o erro apareceria lá no fundo, na hora de conectar.
    if (!/^https?:\/\/[^\s]+$/i.test(novo.trim())) return mostrarErroConta('conta.err_bad_url');
    Conta.info = await window.api.contaSetBaseUrl(novo.trim());
    document.getElementById('conta-server-txt').textContent =
      Conta.info.baseUrl.replace(/^https?:\/\//, '');
    conferirServidor();
  });

  // O processo principal avisa quando a conexão muda de estado.
  window.api.onNetState((st) => { Conta.rede = st; pintarEstadoRede(); });

  // E quando chega alguma coisa do servidor.
  window.api.onNetEvent((obj) => {
    if (!obj || !obj.type) return;
    if (typeof onServerEvent === 'function') onServerEvent(obj);
  });

  carregarConta();
}
