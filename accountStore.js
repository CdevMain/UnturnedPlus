// ============================================================
// accountStore.js — a conta do Unturned+ no servidor
//
// ------------------------------------------------------------
// POR QUE ISTO VIVE NO PROCESSO PRINCIPAL
// ------------------------------------------------------------
// O token nunca chega no renderer. Se ficasse lá, qualquer coisa
// que rode na página — um script de terceiro, uma URL de imagem
// maliciosa num nome de servidor — poderia ler `localStorage` e
// levar a sessão embora. Aqui ele vive num arquivo com permissão
// 600 e só sai pelo IPC já embutido no cabeçalho da requisição.
//
// O renderer nunca vê `accessToken` nem `refreshToken`. Ele
// pergunta "estou logada?" e recebe o PERFIL, não a credencial.
//
// ------------------------------------------------------------
// RENOVAÇÃO
// ------------------------------------------------------------
// O access dura 15 min. Em vez de esperar dar 401 e refazer a
// chamada, renovamos ANTES de vencer (60s de folga). Assim a
// pessoa nunca vê um pedido falhar por causa de token.
//
// O 401 mesmo assim é tratado: relógio errado, servidor
// reiniciado com outro segredo, sessão revogada de outro
// aparelho. Aí tenta renovar uma vez e refaz a chamada.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const FOLGA_MS = 60 * 1000;

let ARQUIVO = null;
let state = {
  baseUrl: '',
  user: null,
  accessToken: null,
  accessExp: 0,
  refreshToken: null
};
// Quantas vezes o access foi renovado nesta execução.
//
// Existe porque dois tokens emitidos no MESMO segundo são
// byte a byte iguais (o payload é {sub, iat, exp} e o iat tem
// resolução de segundo). Sem o contador não dá para provar que
// uma renovação aconteceu — nem em teste, nem depurando de
// verdade um "por que ele renovou 40 vezes num minuto?".
let renovacoes = 0;
let renovando = null;   // promessa em voo, para não renovar duas vezes

function init(userDataDir, baseUrlPadrao) {
  ARQUIVO = path.join(userDataDir, 'account.json');
  read();
  if (!state.baseUrl) state.baseUrl = baseUrlPadrao || '';
  return publico();
}

function read() {
  try {
    const cru = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    state = { baseUrl: '', user: null, accessToken: null, accessExp: 0, refreshToken: null, ...cru };
  } catch { /* primeira vez */ }
  return state;
}

function write() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    // Escreve com 600 desde a CRIAÇÃO. Criar com a máscara padrão
    // e corrigir depois deixa uma janela em que o refresh token
    // fica legível para outros usuários da máquina.
    fs.writeFileSync(ARQUIVO, JSON.stringify(state, null, 2), { mode: 0o600 });
    try { fs.chmodSync(ARQUIVO, 0o600); } catch { /* Windows não tem */ }
    return true;
  } catch { return false; }
}

// O que o renderer pode ver. Sem token, nunca.
function publico() {
  return {
    baseUrl: state.baseUrl,
    signedIn: !!state.refreshToken,
    user: state.user
  };
}

function setBaseUrl(url) {
  state.baseUrl = String(url || '').replace(/\/+$/, '');
  write();
  return publico();
}

// ------------------------------------------------------------
// HTTP
// ------------------------------------------------------------
// Sem dependência: `node:https` resolve, e o app já é Electron —
// acrescentar axios aqui seria peso no instalador por nada.
function pedir(metodo, caminho, { body, token, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(caminho, state.baseUrl); }
    catch { return reject(new Error('base_url_invalida')); }

    const dados = body === undefined ? null : JSON.stringify(body);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: metodo,
      headers: {
        Accept: 'application/json',
        ...(dados ? { 'Content-Type': 'application/json',
                      'Content-Length': Buffer.byteLength(dados) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(partes).toString('utf8');
        let json = null;
        try { json = txt ? JSON.parse(txt) : null; } catch { /* não-JSON */ }
        resolve({ status: res.statusCode, body: json, raw: txt });
      });
    });
    req.on('error', (e) => reject(new Error(e.code === 'ENOTFOUND' ? 'offline' : e.message)));
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    if (dados) req.write(dados);
    req.end();
  });
}

// Chamada autenticada, com renovação preventiva e uma segunda
// tentativa se mesmo assim vier 401.
async function auth(metodo, caminho, body) {
  if (!state.refreshToken) return { ok: false, status: 401, error: 'not_signed_in' };

  await garantirAccess();
  let r = await pedir(metodo, caminho, { body, token: state.accessToken });

  if (r.status === 401) {
    const nova = await renovar(true);
    if (!nova.ok) return { ok: false, status: 401, error: nova.error || 'session_expired' };
    r = await pedir(metodo, caminho, { body, token: state.accessToken });
  }
  return { ok: r.status >= 200 && r.status < 300, status: r.status,
           data: r.body, error: r.body && r.body.error };
}

async function garantirAccess() {
  if (state.accessToken && Date.now() < state.accessExp - FOLGA_MS) return;
  await renovar(false);
}

// `forcar` ignora a folga: veio 401 mesmo com token "válido".
function renovar(forcar) {
  if (renovando) return renovando;            // duas chamadas juntas: uma renovação só
  if (!state.refreshToken) return Promise.resolve({ ok: false, error: 'not_signed_in' });
  if (!forcar && state.accessToken && Date.now() < state.accessExp - FOLGA_MS) {
    return Promise.resolve({ ok: true });
  }

  renovando = (async () => {
    try {
      const r = await pedir('POST', '/api/auth/refresh', { body: { refreshToken: state.refreshToken } });
      if (r.status >= 200 && r.status < 300 && r.body && r.body.accessToken) {
        aplicarSessao(r.body);
        renovacoes += 1;
        return { ok: true };
      }
      // Refresh recusado é o fim da sessão: reusado, revogado ou
      // vencido. Limpar aqui evita o app ficar tentando para sempre
      // com uma credencial que o servidor já rejeitou.
      const motivo = (r.body && r.body.error) || 'refresh_failed';
      if (r.status === 401) limpar();
      return { ok: false, error: motivo };
    } catch (e) {
      // Erro de REDE não invalida a sessão: sem internet, o refresh
      // falha e a pessoa continua logada quando a rede voltar.
      return { ok: false, error: e.message === 'offline' ? 'offline' : 'network_error' };
    } finally {
      renovando = null;
    }
  })();
  return renovando;
}

function aplicarSessao(d) {
  state.user = d.user || state.user;
  state.accessToken = d.accessToken;
  state.refreshToken = d.refreshToken || state.refreshToken;
  // O servidor manda access de 15 min. Guardamos o VENCIMENTO lido
  // do próprio token, não um "agora + 15min" — se o relógio da
  // máquina estiver adiantado, a conta feita aqui erraria.
  state.accessExp = expDoToken(d.accessToken) || (Date.now() + 14 * 60 * 1000);
  write();
}

function expDoToken(t) {
  try {
    const p = JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8'));
    return typeof p.exp === 'number' ? p.exp * 1000 : 0;
  } catch { return 0; }
}

function limpar() {
  state.user = null;
  state.accessToken = null;
  state.accessExp = 0;
  state.refreshToken = null;
  write();
}

// ------------------------------------------------------------
// Ações
// ------------------------------------------------------------
async function register({ email, username, password, displayName }) {
  try {
    const r = await pedir('POST', '/api/auth/register',
      { body: { email, username, password, displayName } });
    if (r.status === 201 && r.body && r.body.accessToken) {
      aplicarSessao(r.body);
      // O código de recuperação passa DIRETO para a tela e não é
      // gravado em lugar nenhum. É a única vez que ele existe fora
      // do hash no servidor; guardá-lo aqui recriaria, no disco da
      // pessoa, exatamente a chave mestra que o servidor evita ter.
      return { ok: true, user: state.user, recoveryCode: r.body.recoveryCode || null };
    }
    return { ok: false, error: (r.body && r.body.error) || 'register_failed',
             field: r.body && r.body.field, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function login({ identifier, password }) {
  try {
    const r = await pedir('POST', '/api/auth/login', { body: { identifier, password } });
    if (r.status === 200 && r.body && r.body.accessToken) {
      aplicarSessao(r.body);
      return { ok: true, user: state.user };
    }
    return { ok: false, error: (r.body && r.body.error) || 'login_failed',
             retryAfterMin: r.body && r.body.retryAfterMin, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function logout(todosAparelhos = false) {
  if (!state.refreshToken) return { ok: true, revoked: false };

  // O /logout do servidor EXIGE access token válido. Então:
  // garante um, tira uma FOTO dos dois, e só então limpa.
  //
  // A versão anterior limpava primeiro e mandava
  // `token: state.accessToken` — que já era null. A chamada saía
  // sem Authorization, tomava 401, e a sessão continuava viva no
  // servidor por 30 dias. Sair do app parecia funcionar e não
  // revogava nada: um refresh token copiado seguiria valendo.
  try { await garantirAccess(); } catch { /* offline: segue */ }
  const foto = { access: state.accessToken, refresh: state.refreshToken };

  // Limpa LOCAL antes da rede. Servidor fora do ar não pode
  // impedir alguém de sair do app.
  limpar();

  let revoked = false;
  try {
    const r = await pedir('POST', '/api/auth/logout', {
      body: { refreshToken: foto.refresh, allDevices: !!todosAparelhos },
      token: foto.access
    });
    revoked = r.status >= 200 && r.status < 300;
  } catch { /* offline: o refresh vence sozinho em 30 dias */ }

  return { ok: true, revoked };
}

// Token de curta duração para o WebSocket. Quem conecta é o
// netClient, que não deve saber ler o arquivo de sessão.
async function accessParaWs() {
  if (!state.refreshToken) return null;
  await garantirAccess();
  return state.accessToken;
}

// ------------------------------------------------------------
// Recuperação de senha
// ------------------------------------------------------------

// Trocar a senha com o código. NÃO exige estar logado — é o caminho
// de quem não consegue entrar.
async function recuperar({ identifier, code, newPassword }) {
  try {
    const r = await pedir('POST', '/api/auth/recover',
      { body: { identifier, code, newPassword } });
    if (r.status === 200 && r.body && r.body.ok) {
      return { ok: true, nextCode: r.body.nextCode || null };
    }
    return { ok: false, error: (r.body && r.body.error) || 'recover_failed',
             attemptsLeft: r.body && r.body.attemptsLeft,
             retryAfterSec: r.body && r.body.retryAfterSec, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Estado do código (dica, quando foi emitido). Nunca o código.
async function recuperacaoEstado() {
  try {
    // `auth()` devolve { ok, status, data, error } — não `body`.
    const r = await auth('GET', '/api/auth/recovery');
    if (r.ok) return { ok: true, ...(r.data || {}) };
    return { ok: false, error: r.error || 'failed', status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Perdi o papel: emite outro. Pede a senha atual de propósito.
async function recuperacaoRenovar(password) {
  try {
    const r = await auth('POST', '/api/auth/recovery/renew', { password });
    if (r.ok && r.data && r.data.code) return { ok: true, code: r.data.code };
    return { ok: false, error: r.error || 'failed', status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function health() {
  try {
    const r = await pedir('GET', '/health', { timeoutMs: 6000 });
    return { ok: r.status === 200, status: r.status, data: r.body };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = {
  init, read, write, publico, setBaseUrl,
  register, login, logout, auth, pedir, renovar, limpar,
  recuperar, recuperacaoEstado, recuperacaoRenovar,
  accessParaWs, health, expDoToken,
  renovacoes: () => renovacoes,
  _state: () => state
};
