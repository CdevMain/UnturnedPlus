// ============================================================
// teamLive.js — O time DE VERDADE, contra api.cdev.com.br
//
// O que já existia: `teamStore` (grupo local, no disco) e
// `syncClient` (fila de operações escrita para um servidor que
// ainda não existia, com transporte de loopback para dar para
// testar). Agora o servidor existe, e este arquivo é a ponte.
//
// ------------------------------------------------------------
// A DIVISÃO: REST PARA ESTRUTURA, WEBSOCKET PARA IMEDIATO
// ------------------------------------------------------------
// Criar time, convidar, trocar papel, expulsar: REST. São coisas
// raras, que precisam de resposta clara e de erro tratável.
//
// Mensagem, "digitando", presença, posição no mapa: WebSocket. São
// coisas frequentes e que só valem se chegarem AGORA.
//
// Não é preciosismo: cada verbo no WebSocket é mais uma superfície
// para autorizar num canal que fica aberto por horas.
//
// ------------------------------------------------------------
// O QUE ACONTECE SEM INTERNET
// ------------------------------------------------------------
// Tudo continua funcionando local. O time do `teamStore` é a
// verdade que a tela desenha; o servidor é o que sincroniza entre
// máquinas. Perder a conexão degrada para "o que eu já sabia" em
// vez de para uma tela vazia — e é por isso que o cache local
// nunca é apagado quando a rede cai, só quando o servidor DIZ que
// alguma coisa mudou.
//
// ------------------------------------------------------------
// UM DETALHE QUE CUSTOU DECIDIR
// ------------------------------------------------------------
// O servidor identifica pessoas por `userId` (BIGSERIAL). O
// `teamStore` local identifica por um id próprio, gerado offline.
// Em vez de migrar um para o outro, guardamos o `remoteId` ao lado
// do local. Assim um grupo criado offline continua existindo, e
// quando ele sobe para o servidor ganha o par sem perder histórico.
// ============================================================

'use strict';

const EventEmitter = require('events');

class TeamLive extends EventEmitter {
  constructor({ conta, net, store }) {
    super();
    this.conta = conta;     // accountStore
    this.net = net;         // netClient (WebSocket)
    this.store = store;     // teamStore (cache local)
    this.times = [];
    this.atual = null;      // { id, name, conversationId, myRole, ... }
    this.membros = [];
    this.presenca = new Map();  // userId -> { online, lastSeen }
    this.mensagens = [];
    this.posicoes = new Map();  // userId -> { x, z, map, at }
    this.carregando = false;
    this.ultimoErro = null;
  }

  get ligado() { return !!(this.conta.publico().signedIn); }

  // ----------------------------------------------------------
  // REST
  // ----------------------------------------------------------
  async chamar(metodo, caminho, body) {
    if (!this.ligado) return { ok: false, error: 'not_signed_in' };
    const r = await this.conta.auth(metodo, caminho, body);
    if (!r.ok) this.ultimoErro = r.error || ('http_' + r.status);
    return r;
  }

  async carregarTimes() {
    const r = await this.chamar('GET', '/api/teams');
    if (!r.ok) return { ok: false, error: r.error };
    this.times = (r.data && r.data.teams) || [];
    // O time "atual" continua o mesmo entre recargas, desde que
    // ainda exista. Sem isto, cada refresh jogaria a pessoa de
    // volta para o primeiro time da lista.
    if (this.atual) {
      const ainda = this.times.find((t) => t.id === this.atual.id);
      this.atual = ainda ? { ...this.atual, ...ainda } : null;
    }
    if (!this.atual && this.times.length) await this.abrir(this.times[0].id);
    this.emit('mudou', this.publico());
    return { ok: true, teams: this.times };
  }

  async abrir(teamId) {
    const r = await this.chamar('GET', `/api/teams/${teamId}`);
    if (!r.ok) return { ok: false, error: r.error };
    const d = r.data || {};
    this.atual = d.team || null;
    this.membros = d.members || [];
    this.mensagens = [];
    this.emit('mudou', this.publico());

    // Presença, histórico e posições em paralelo: são
    // independentes, e esperar um pelo outro multiplica o tempo até
    // a tela ficar útil.
    this.posicoes.clear();
    await Promise.all([this.pedirPresenca(), this.carregarHistorico(), this.pedirPosicoes()]);
    return { ok: true, team: this.atual, members: this.membros };
  }

  async criar(name) {
    const r = await this.chamar('POST', '/api/teams', { name });
    if (!r.ok) return { ok: false, error: r.error };
    await this.carregarTimes();
    if (r.data && r.data.team) await this.abrir(r.data.team.id);
    return { ok: true, team: r.data && r.data.team };
  }

  // O convite é um par CÓDIGO + SENHA. Um código sozinho, curto o
  // bastante para alguém digitar, seria adivinhável por varredura;
  // a senha é o que impede entrar num time por sorte. Os dois saem
  // juntos aqui e é este par que se manda para a pessoa.
  async convidar({ role, maxUses, expiresInHours } = {}) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('POST', `/api/teams/${this.atual.id}/invites`, {
      role: role || 'member',
      maxUses: Number(maxUses) || 0,
      expiresInHours: Number(expiresInHours) || 0
    });
    if (!r.ok) return { ok: false, error: r.error };
    const inv = r.data && r.data.invite;
    return {
      ok: true,
      invite: inv,
      password: r.data && r.data.password,
      // O que se cola no chat, num pedaço só. Separar código e
      // senha em duas mensagens é como as pessoas perdem uma das
      // duas.
      share: inv ? `${inv.code}:${r.data.password}` : null
    };
  }

  // Aceita "CODIGO:SENHA" (o que a outra pessoa colou) ou os dois
  // campos separados. Recusar o formato colado seria implicância.
  async entrarPorCodigo(code, password) {
    let cod = String(code || '').trim();
    let senha = String(password || '').trim();
    if (!senha && cod.includes(':')) {
      const [c, ...resto] = cod.split(':');
      cod = c.trim();
      senha = resto.join(':').trim();
    }
    if (!cod || !senha) return { ok: false, error: 'code_and_password_required' };

    const r = await this.chamar('POST', '/api/teams/invites/redeem',
      { code: cod.toUpperCase(), password: senha });
    if (!r.ok) return { ok: false, error: r.error };
    await this.carregarTimes();
    if (r.data && r.data.team) await this.abrir(r.data.team.id);
    return { ok: true, team: r.data && r.data.team, role: r.data && r.data.role };
  }

  // Lista de convites em aberto. Serve para o caso chato: você
  // gerou um convite ontem, não lembra para quem mandou, e quer
  // cortar antes que ele circule. Sem esta tela o único jeito de
  // fechar um convite vazado seria trocar o time inteiro.
  async convites() {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('GET', `/api/teams/${this.atual.id}/invites`);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, invites: (r.data && r.data.invites) || [] };
  }

  async revogarConvite(inviteId) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('DELETE', `/api/teams/${this.atual.id}/invites/${inviteId}`);
    return { ok: r.ok, error: r.error };
  }

  async renomear(name) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('PATCH', `/api/teams/${this.atual.id}`, { name });
    if (!r.ok) return { ok: false, error: r.error };
    // Recarrega a lista também: o nome aparece nos dois lugares e
    // deixar um deles velho é o tipo de coisa que faz a pessoa
    // achar que o rename não funcionou.
    await this.carregarTimes();
    if (this.atual) await this.abrir(this.atual.id);
    return { ok: true };
  }

  // Dissolver é do dono e apaga para TODO MUNDO. É diferente de
  // sair, e a tela precisa perguntar de um jeito diferente.
  //
  // A partir do deploy 004 o servidor responde `scheduledFor`: a
  // exclusão é MARCADA e só vira apagamento de verdade 24 horas
  // depois. O time some para todo mundo na hora; o que fica é o
  // registro, esperando o prazo, para dar chance de desfazer.
  //
  // O app repassa `scheduledFor` sem depender dele: contra um
  // servidor antigo, que apaga na hora, o campo simplesmente não
  // vem e a mensagem na tela é a de sempre.
  async dissolver() {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('DELETE', `/api/teams/${this.atual.id}`);
    if (!r.ok) return { ok: false, error: r.error };
    this.atual = null; this.membros = []; this.mensagens = [];
    this.posicoes.clear();
    await this.carregarTimes();
    return { ok: true, scheduledFor: (r.body && r.body.scheduledFor) || null };
  }

  // Desfazer a exclusão dentro do prazo.
  async desfazerExclusao(teamId) {
    const r = await this.chamar('POST', `/api/teams/${teamId}/restore`);
    if (!r.ok) return { ok: false, error: r.error };
    await this.carregarTimes();
    return { ok: true, team: r.body && r.body.team };
  }

  // ----------------------------------------------------------
  // SERVIDORES VINCULADOS (migração 003)
  // ----------------------------------------------------------
  // O vínculo é a única coisa do time que precisa ser IGUAL para
  // todo mundo: se cada um tiver a sua lista, o escopo "servidor 1"
  // de uma pessoa não é o mesmo da outra e o conteúdo compartilhado
  // aparece no lugar errado.
  //
  // Por isso ele vai para a API — e por isso, enquanto a rota não
  // existir, o app continua guardando no disco. `rotaFaltando`
  // distingue "o servidor recusou" de "o servidor ainda não tem
  // isso": a primeira é erro para mostrar; a segunda é motivo para
  // usar a reserva local, calada.
  static rotaFaltando(r) {
    return r && !r.ok && (r.status === 404 || r.error === 'not_found' ||
                          r.error === 'unknown_route');
  }

  async servidores() {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('GET', `/api/teams/${this.atual.id}/servers`);
    if (TeamLive.rotaFaltando(r)) return { ok: false, error: 'needs_deploy' };
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, servers: (r.body && r.body.servers) || [] };
  }

  async vincularServidor(servidor) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('POST', `/api/teams/${this.atual.id}/servers`, {
      bmId: String(servidor.bmId), name: servidor.name,
      address: servidor.ip ? `${servidor.ip}:${servidor.port}` : null,
      map: servidor.map || null
    });
    if (TeamLive.rotaFaltando(r)) return { ok: false, error: 'needs_deploy' };
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, server: r.body && r.body.server };
  }

  async desvincularServidor(bmId) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('DELETE',
      `/api/teams/${this.atual.id}/servers/${encodeURIComponent(bmId)}`);
    if (TeamLive.rotaFaltando(r)) return { ok: false, error: 'needs_deploy' };
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true };
  }

  // ----------------------------------------------------------
  // CANAIS (migração 003)
  // ----------------------------------------------------------
  async canais() {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('GET', `/api/teams/${this.atual.id}/channels`);
    if (TeamLive.rotaFaltando(r)) return { ok: false, error: 'needs_deploy' };
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, channels: (r.body && r.body.channels) || [] };
  }

  async criarCanal({ name, topic = null }) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('POST', `/api/teams/${this.atual.id}/channels`, { name, topic });
    if (TeamLive.rotaFaltando(r)) return { ok: false, error: 'needs_deploy' };
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, channel: r.body && r.body.channel };
  }

  async apagarCanal(channelId) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('DELETE', `/api/teams/${this.atual.id}/channels/${channelId}`);
    if (TeamLive.rotaFaltando(r)) return { ok: false, error: 'needs_deploy' };
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true };
  }

  // Passar a posse. O servidor rebaixa quem transferiu para admin
  // (não para membro): quem criou o time continua podendo convidar.
  async transferir(userId) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('POST', `/api/teams/${this.atual.id}/transfer`, { userId });
    if (r.ok) { await this.carregarTimes(); await this.abrir(this.atual.id); }
    return { ok: r.ok, error: r.error };
  }

  // Banir é expulsar + impedir de voltar com outro convite. Existe
  // separado do kick porque as duas coisas resolvem problemas
  // diferentes: kick é para quem entrou errado, ban é para quem
  // você não quer de volta.
  async banir(userId, motivo) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('POST', `/api/teams/${this.atual.id}/ban/${userId}`,
      { reason: motivo || null });
    if (r.ok) await this.abrir(this.atual.id);
    return { ok: r.ok, error: r.error };
  }

  async sair() {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const eu = this.conta.publico().user;
    const r = await this.chamar('DELETE', `/api/teams/${this.atual.id}/members/${eu.id}`);
    if (!r.ok) return { ok: false, error: r.error };
    this.atual = null; this.membros = []; this.mensagens = [];
    this.posicoes.clear();
    await this.carregarTimes();
    return { ok: true };
  }

  async trocarPapel(userId, role) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('PATCH', `/api/teams/${this.atual.id}/members/${userId}`, { role });
    if (r.ok) await this.abrir(this.atual.id);
    return { ok: r.ok, error: r.error };
  }

  async remover(userId) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const r = await this.chamar('DELETE', `/api/teams/${this.atual.id}/members/${userId}`);
    if (r.ok) await this.abrir(this.atual.id);
    return { ok: r.ok, error: r.error };
  }

  // ----------------------------------------------------------
  // Chat
  // ----------------------------------------------------------
  async carregarHistorico(before = null) {
    if (!this.atual || !this.atual.conversationId) return { ok: false, error: 'no_conversation' };
    const q = before ? `?before=${encodeURIComponent(before)}&limit=40` : '?limit=40';
    const r = await this.chamar('GET', `/api/conversations/${this.atual.conversationId}/messages${q}`);
    if (!r.ok) return { ok: false, error: r.error };
    const novas = (r.data && r.data.messages) || [];
    // Paginação para TRÁS: as antigas entram na frente da lista.
    this.mensagens = before ? [...novas, ...this.mensagens] : novas;
    this.emit('mensagens', this.mensagens);
    return { ok: true, messages: novas, hasMore: novas.length >= 40 };
  }

  // Manda pelo WebSocket quando ele está de pé, e cai no REST
  // quando não está. Os dois gravam no mesmo lugar; a diferença é
  // que o WS já sai para os outros no mesmo instante.
  async enviar(texto) {
    const conteudo = String(texto || '').trim();
    if (!conteudo) return { ok: false, error: 'empty' };
    if (!this.atual || !this.atual.conversationId) return { ok: false, error: 'no_conversation' };

    if (this.net.estado().estado === 'online') {
      try {
        // `pedir` devolve { ok, data } — a resposta do servidor vem
        // DENTRO de `data`. Ler `r.type` direto (que foi o primeiro
        // palpite) faz o ack nunca ser reconhecido: o cliente acha
        // que falhou, reenvia pelo REST, e a mensagem entra DUAS
        // vezes no banco. Foi exatamente isso que o teste de duas
        // pessoas pegou.
        const r = await this.net.pedir({
          type: 'send_message',
          conversationId: this.atual.conversationId,
          content: conteudo
        });
        if (r && r.ok && r.data && r.data.type === 'ack') {
          return { ok: true, id: r.data.messageId, via: 'ws' };
        }
        // Erro de AUTORIZAÇÃO não se resolve tentando de novo por
        // outro caminho — o REST vai recusar igual. Só a queda de
        // conexão justifica o reenvio.
        if (r && !r.ok && r.error && r.error !== 'disconnected') {
          return { ok: false, error: r.error };
        }
      } catch { /* segue para o REST */ }
    }

    const r = await this.chamar('POST', `/api/conversations/${this.atual.conversationId}/messages`,
      { content: conteudo });
    if (!r.ok) return { ok: false, error: r.error };
    const m = r.data && r.data.message;
    if (m) { this.mensagens.push(m); this.emit('mensagens', this.mensagens); }
    return { ok: true, id: m && m.id, via: 'rest' };
  }

  // Apagar mensagem no modo servidor.
  //
  // FALTAVA. A tela chamava `teamDeleteMessage`, que vai no
  // armazenamento LOCAL — e no modo servidor as mensagens vêm com
  // id do servidor, que não existe no disco. Daí o "message not
  // found": o app procurava no lugar errado.
  async apagarMensagem(id) {
    const r = await this.chamar('DELETE', `/api/messages/${id}`);
    if (!r.ok) return { ok: false, error: r.error };
    // Some da lista local na hora. O servidor também avisa por
    // push, mas esperar o push deixaria a mensagem na tela por um
    // instante depois do clique — e isso lê como "não funcionou".
    this.mensagens = this.mensagens.map((m) =>
      (String(m.id) === String(id) ? { ...m, content: '', deletedAt: new Date().toISOString() } : m));
    this.emit('mensagens', this.mensagens);
    return { ok: true };
  }

  digitando() {
    if (!this.atual || !this.atual.conversationId) return;
    if (this.net.estado().estado !== 'online') return;
    this.net.enviar({ type: 'typing', conversationId: this.atual.conversationId });
  }

  async marcarLido() {
    if (!this.atual || !this.atual.conversationId) return;
    if (this.net.estado().estado === 'online') {
      this.net.enviar({ type: 'read', conversationId: this.atual.conversationId });
    } else {
      await this.chamar('POST', `/api/conversations/${this.atual.conversationId}/read`, {});
    }
  }

  // ----------------------------------------------------------
  // Presença
  // ----------------------------------------------------------
  async pedirPresenca() {
    const ids = this.membros.map((m) => m.id).filter(Boolean);
    if (!ids.length) return;
    if (this.net.estado().estado === 'online') {
      try {
        const r = await this.net.pedir({ type: 'presence_query', userIds: ids });
        // Mesmo cuidado do envio: a resposta vem em `r.data`.
        if (r && r.ok && r.data && r.data.presence) {
          this.aplicarPresenca(r.data.presence);
          return;
        }
        // Não deu certo pelo socket: NÃO retorna aqui. A primeira
        // versão retornava de qualquer jeito, e o resultado era a
        // lista inteira aparecendo offline sem nunca ter perguntado
        // a ninguém.
      } catch { /* cai no REST */ }
    }
    const r = await this.chamar('POST', '/api/users/presence', { userIds: ids });
    if (r.ok && r.data && r.data.presence) this.aplicarPresenca(r.data.presence);
  }

  // O servidor fala em `status: 'online' | 'offline'` nas consultas
  // e em `online: true/false` nos avisos por push. Normalizamos
  // aqui, num lugar só — o resto do app não deveria precisar saber
  // que existem dois formatos.
  aplicarPresenca(lista) {
    for (const p of lista || []) {
      const id = Number(p.userId ?? p.id);
      if (!Number.isFinite(id)) continue;
      const online = (typeof p.online === 'boolean') ? p.online : (p.status === 'online');
      this.presenca.set(id, { online, lastSeen: p.lastSeenAt || p.lastSeen || null });
    }
    this.emit('presenca', this.presencaPublica());
  }

  presencaPublica() {
    const out = {};
    for (const [k, vlr] of this.presenca) out[k] = vlr;
    return out;
  }

  // ----------------------------------------------------------
  // Posição no mapa
  //
  // Só WebSocket. Não existe rota REST equivalente porque não
  // existe tabela: o servidor guarda isto em memória, com prazo de
  // validade (ver src/ws/positions.js lá do lado de lá). Sem
  // socket, portanto, não há posição — e isso está certo: uma
  // posição que não chega AGORA não serve para nada.
  // ----------------------------------------------------------
  async marcarPosicao({ x, z, map }) {
    if (!this.atual) return { ok: false, error: 'no_team' };
    if (this.net.estado().estado !== 'online') return { ok: false, error: 'offline' };
    const r = await this.net.pedir({
      type: 'position', teamId: this.atual.id, x: Number(x), z: Number(z), map: map || null });
    if (!(r && r.ok)) return { ok: false, error: (r && r.error) || 'generic' };
    // A minha própria posição não volta pelo push (o servidor manda
    // para todo mundo, inclusive eu, mas não dá para contar com a
    // ordem). Gravar aqui deixa o mapa certo no instante do clique.
    const eu = this.conta.publico().user;
    if (eu) this.posicoes.set(Number(eu.id), { x: Number(x), z: Number(z), map: map || null, at: Date.now() });
    this.emit('posicoes', this.posicoesPublicas());
    return { ok: true };
  }

  async limparPosicao() {
    if (!this.atual) return { ok: false, error: 'no_team' };
    const eu = this.conta.publico().user;
    if (eu) this.posicoes.delete(Number(eu.id));
    this.emit('posicoes', this.posicoesPublicas());
    if (this.net.estado().estado !== 'online') return { ok: true, error: 'offline' };
    await this.net.pedir({ type: 'position_clear', teamId: this.atual.id });
    return { ok: true };
  }

  async pedirPosicoes() {
    if (!this.atual) return;
    if (this.net.estado().estado !== 'online') return;
    try {
      const r = await this.net.pedir({ type: 'position_query', teamId: this.atual.id });
      if (r && r.ok && r.data && Array.isArray(r.data.positions)) {
        this.posicoes.clear();
        for (const p of r.data.positions) {
          this.posicoes.set(Number(p.userId), { x: p.x, z: p.z, map: p.map, at: p.at });
        }
        this.emit('posicoes', this.posicoesPublicas());
      }
    } catch { /* sem posição é degradação aceitável */ }
  }

  posicoesPublicas() {
    const out = [];
    for (const [userId, p] of this.posicoes) {
      const m = this.membros.find((x) => Number(x.id) === userId);
      out.push({
        userId, x: p.x, z: p.z, map: p.map, at: p.at,
        name: m ? (m.displayName || m.display_name || m.username) : String(userId)
      });
    }
    return out;
  }

  // ----------------------------------------------------------
  // Eventos que CHEGAM do servidor
  //
  // Um ponto de entrada só. O netClient repassa tudo que o socket
  // recebe; aqui decidimos o que é do time e o que ignorar.
  // ----------------------------------------------------------
  aoReceber(msg) {
    if (!msg || !msg.type) return;
    const convId = this.atual && this.atual.conversationId;

    switch (msg.type) {
      case 'message':
        if (!convId || Number(msg.message?.conversationId) !== Number(convId)) return;
        // Duplicata: a mesma mensagem pode chegar pelo push E pelo
        // ack do envio. Filtrar por id é o que impede a linha
        // dobrada na tela de quem escreveu.
        if (this.mensagens.some((m) => m.id === msg.message.id)) return;
        this.mensagens.push(msg.message);
        this.emit('mensagens', this.mensagens);
        this.emit('nova-mensagem', msg.message);
        return;

      case 'typing':
        if (!convId || Number(msg.conversationId) !== Number(convId)) return;
        this.emit('digitando', { userId: msg.userId });
        return;

      case 'presence':
        this.aplicarPresenca([{ userId: msg.userId, online: !!msg.online, lastSeenAt: msg.lastSeenAt }]);
        return;

      case 'read':
        this.emit('lido', { userId: msg.userId, conversationId: msg.conversationId, readAt: msg.readAt });
        return;

      case 'position': {
        if (!this.atual || Number(msg.teamId) !== Number(this.atual.id)) return;
        this.posicoes.set(Number(msg.userId), { x: msg.x, z: msg.z, map: msg.map, at: msg.at });
        this.emit('posicoes', this.posicoesPublicas());
        return;
      }

      case 'position_gone': {
        if (!this.atual || Number(msg.teamId) !== Number(this.atual.id)) return;
        this.posicoes.delete(Number(msg.userId));
        this.emit('posicoes', this.posicoesPublicas());
        return;
      }

      case 'message_deleted': {
        if (!convId || Number(msg.conversationId) !== Number(convId)) return;
        this.mensagens = this.mensagens.map((m) =>
          (String(m.id) === String(msg.messageId)
            ? { ...m, content: '', deletedAt: new Date().toISOString() } : m));
        this.emit('mensagens', this.mensagens);
        return;
      }

      case 'team_changed':
        // O servidor avisou que a composição mudou (entrou, saiu,
        // trocou de papel). Recarregamos em vez de tentar aplicar o
        // delta: a lista é pequena e adivinhar delta é onde nascem
        // as telas que discordam do servidor.
        if (this.atual && Number(msg.teamId) === Number(this.atual.id)) this.abrir(this.atual.id);
        return;

      default:
        return;
    }
  }

  // Estado enxuto para a tela. Não devolve token, não devolve
  // objeto interno — só o que se desenha.
  publico() {
    return {
      signedIn: this.ligado,
      teams: this.times.map((t) => ({
        id: t.id, name: t.name, memberCount: t.memberCount ?? t.member_count, myRole: t.myRole
      })),
      team: this.atual ? {
        id: this.atual.id, name: this.atual.name,
        conversationId: this.atual.conversationId,
        myRole: this.atual.myRole, ownerId: this.atual.ownerId
      } : null,
      members: this.membros.map((m) => ({
        id: m.id, username: m.username, displayName: m.displayName || m.display_name,
        avatarUrl: m.avatarUrl || m.avatar_url, steamId: m.steamId || m.steam_id,
        role: m.role,
        online: !!(this.presenca.get(Number(m.id)) || {}).online,
        lastSeen: (this.presenca.get(Number(m.id)) || {}).lastSeen || null
      })),
      messages: this.mensagens,
      positions: this.posicoesPublicas(),
      net: this.net.estado().estado,
      error: this.ultimoErro
    };
  }
}

module.exports = { TeamLive };
