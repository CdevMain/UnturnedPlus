// ============================================================
// teamInvites.js — Convites com SENHA
//
// Entrar no grupo exige duas coisas: o CÓDIGO (identifica o grupo)
// e a SENHA (prova que você foi convidado). Código sozinho vaza
// fácil — ele aparece na tela, em print, em vídeo. A senha vai por
// fora, para a pessoa certa.
//
// ------------------------------------------------------------
// A SENHA NUNCA É GUARDADA
// ------------------------------------------------------------
// Guardamos scrypt(senha, salt). Isso importa mesmo num app local:
// o arquivo de grupos vai junto no backup, e backup circula por
// Discord. Senha em texto puro ali é senha entregue — e é senha
// que muita gente reusa em outro lugar.
//
// scrypt com N=16384 leva ~100 ms por tentativa nesta máquina. É
// imperceptível para quem digita uma vez e caro para quem tenta
// milhões — que é exatamente o desenho que se quer.
//
// O mesmo hash serve quando o servidor existir: ele guarda o
// mesmo formato e faz a mesma verificação. O cliente nunca manda
// a senha crua para lugar nenhum além do próprio scrypt.
// ============================================================

'use strict';

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

// Alfabeto sem 0/O/1/I/L: o código é ditado em voz alta no
// Discord, e esses cinco caracteres são a fonte de metade dos
// "não funciona" que na verdade são erro de digitação.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomFrom(alfabeto, n) {
  const bytes = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += alfabeto[bytes[i] % alfabeto.length];
  return s;
}

function newCode() { return randomFrom(ALFABETO, 6); }

// Senha sugerida: 4 grupos de 4. Longa o bastante para não ser
// adivinhada, e ainda dá para ditar.
function suggestPassword() {
  return [0, 1, 2, 3].map(() => randomFrom(ALFABETO, 4)).join('-');
}

function hashPassword(senha, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(senha), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
    // O scrypt do Node estoura a memória padrão com N=16384; sem
    // isto ele lança "memory limit exceeded" em vez de hashear.
    maxmem: 64 * 1024 * 1024
  });
  return { salt: salt.toString('hex'), hash: dk.toString('hex'), algo: 'scrypt', N: SCRYPT.N };
}

function verifyPassword(senha, guardado) {
  if (!guardado || !guardado.salt || !guardado.hash) return false;
  try {
    const { hash } = hashPassword(senha, guardado.salt);
    // Comparação em tempo constante: comparar com === vaza, pelo
    // tempo de resposta, quantos caracteres iniciais bateram.
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(guardado.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// Convite
// ------------------------------------------------------------
// { id, code, password{salt,hash}, role, expiresAt, maxUses,
//   uses, createdBy, createdAt, revoked }
//
// `role` é o papel que o convite CONCEDE. Um convite de "guest"
// deixa a pessoa entrar só olhando — útil para quem está sendo
// avaliado antes de virar membro.
function createInvite({ role = 'member', password = null, expiresInMs = 7 * 24 * 3600 * 1000,
                        maxUses = 0, createdBy = null } = {}) {
  const senha = password || suggestPassword();
  return {
    invite: {
      id: 'inv_' + crypto.randomBytes(6).toString('hex'),
      code: newCode(),
      password: hashPassword(senha),
      role,
      createdBy,
      createdAt: Date.now(),
      // Só `null`/`0` significam "não vence". Um valor negativo
      // gera uma data no passado — ou seja, já nasce vencido. A
      // versão anterior tratava qualquer valor <= 0 como "eterno",
      // o que transforma "expira agora" em "nunca expira": num
      // recurso de segurança, esse é o erro perigoso.
      expiresAt: (expiresInMs === null || expiresInMs === 0) ? null : Date.now() + expiresInMs,
      maxUses: Math.max(0, maxUses | 0),   // 0 = ilimitado
      uses: 0,
      revoked: false
    },
    // Devolvido UMA vez, para mostrar na tela e a pessoa copiar.
    // Depois disto não existe mais em lugar nenhum em texto puro.
    plainPassword: senha
  };
}

// Motivos separados de propósito. "Código errado" e "senha errada"
// são coisas diferentes para quem está tentando entrar de boa fé;
// juntar tudo em "falhou" faz a pessoa desistir sem saber o quê
// conferir. (Num servidor público valeria unificar para não dizer
// se o código existe — aqui o grupo é entre amigos.)
function checkInvite(invite, { code, password }) {
  if (!invite) return { ok: false, reason: 'no_invite' };
  if (invite.revoked) return { ok: false, reason: 'revoked' };
  if (invite.expiresAt && Date.now() > invite.expiresAt) return { ok: false, reason: 'expired' };
  if (invite.maxUses && invite.uses >= invite.maxUses) return { ok: false, reason: 'used_up' };
  if (String(code || '').trim().toUpperCase() !== invite.code) return { ok: false, reason: 'bad_code' };
  if (!verifyPassword(password, invite.password)) return { ok: false, reason: 'bad_password' };
  return { ok: true, role: invite.role };
}

function useInvite(invite) {
  invite.uses += 1;
  if (invite.maxUses && invite.uses >= invite.maxUses) invite.exhaustedAt = Date.now();
  return invite;
}

// O que pode ir para a tela: sem salt e sem hash.
function publicInvite(invite) {
  if (!invite) return null;
  const { password, ...resto } = invite;
  return {
    ...resto,
    hasPassword: !!(password && password.hash),
    expired: !!(invite.expiresAt && Date.now() > invite.expiresAt),
    exhausted: !!(invite.maxUses && invite.uses >= invite.maxUses)
  };
}

module.exports = {
  newCode, suggestPassword, hashPassword, verifyPassword,
  createInvite, checkInvite, useInvite, publicInvite, ALFABETO
};
