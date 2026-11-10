const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Configuração
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),

  // Idiomas (lidos do disco pelo processo principal — fetch em
  // página file:// é bloqueado pelo Chromium)
  loadLanguage: (lang) => ipcRenderer.invoke('i18n:load', lang),

  // BattleMetrics (API oficial — usado só onde o usuário tiver token configurado)
  getServer: (bmId) => ipcRenderer.invoke('bm:server', bmId),
  searchByIp: (ipPort) => ipcRenderer.invoke('bm:searchByIp', ipPort),
  searchByName: (name) => ipcRenderer.invoke('bm:searchByName', name),

  // Query Port local (A2S/Source Query direto no servidor — sem terceiros)
  queryInfo: (ip, port) => ipcRenderer.invoke('query:info', ip, port),
  queryPlayers: (ip, port) => ipcRenderer.invoke('query:players', ip, port),
  queryServer: (ip, port) => ipcRenderer.invoke('query:server', ip, port),
  queryRules: (ip, port) => ipcRenderer.invoke('query:rules', ip, port),
  queryFull: (ip, port) => ipcRenderer.invoke('query:full', ip, port),
  queryServerByBmId: (bmId) => ipcRenderer.invoke('query:serverByBmId', bmId),
  // Sonda um IP:porta cru (usado ao adicionar por IP, sem BattleMetrics)
  probeServer: (ip, gamePort, queryPort) => ipcRenderer.invoke('server:probe', ip, gamePort, queryPort),

  // Airdrop (intervalo por servidor + marcar quando cair)
  getAirdrop: (bmId) => ipcRenderer.invoke('airdrop:get', bmId),
  setAirdropInterval: (bmId, seconds) => ipcRenderer.invoke('airdrop:setInterval', bmId, seconds),
  markAirdrop: (bmId, timestamp) => ipcRenderer.invoke('airdrop:mark', bmId, timestamp),
  getLocalHistory: (bmId, limit) => ipcRenderer.invoke('query:localHistory', bmId, limit),
  getUptime: (bmId) => ipcRenderer.invoke('query:uptime', bmId),
  clearLocalHistory: (bmId) => ipcRenderer.invoke('query:clearLocalHistory', bmId),
  onQueryUpdate: (cb) => ipcRenderer.on('query:update', (_e, payload) => cb(payload)),
  // Prioridade de polling: o servidor aberto na tela vai na frente
  // da fila, e o refresh manual não espera o próximo ciclo.
  focusServer: (bmId) => ipcRenderer.invoke('query:focus', bmId),
  pollNow: (bmId) => ipcRenderer.invoke('query:pollNow', bmId),
  restartPolling: () => ipcRenderer.invoke('query:restartPolling'),

  // BattleMetrics via scraping da página pública (SEM API/token)
  // `bmScrapeServer` e `bmScrapeHistory` saíram: a tela não consulta
  // mais o BattleMetrics. A busca continua, porque é ela que
  // encontra o servidor quando você adiciona por nome.
  bmScrapeSearch: (query) => ipcRenderer.invoke('bmscrape:search', query),
  // Resolve um ID do BattleMetrics -> { id, name, ip, port, map } (JSON público, com fallback)
  resolveBmId: (bmId) => ipcRenderer.invoke('bm:resolve', bmId),

  // Servidor atual ("jogando agora" / último jogado)
  getCurrentServer: () => ipcRenderer.invoke('currentServer:get'),
  setManualCurrentServer: (ip, port, name, map) => ipcRenderer.invoke('currentServer:setManual', ip, port, name, map),
  clearCurrentServer: () => ipcRenderer.invoke('currentServer:clear'),
  pickUnturnedLog: () => ipcRenderer.invoke('currentServer:pickLog'),
  setCurrentServerWatch: (enabled) => ipcRenderer.invoke('currentServer:setWatch', enabled),
  onCurrentServer: (cb) => ipcRenderer.on('current-server', (_e, payload) => cb(payload)),

  // Overlay
  toggleOverlay: () => ipcRenderer.invoke('overlay:toggle'),
  isOverlayOpen: () => ipcRenderer.invoke('overlay:isOpen'),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
  onOverlayConfigChanged: (cb) => ipcRenderer.on('overlay:configChanged', cb),
  onClickThroughChanged: (cb) => ipcRenderer.on('overlay:clickthrough', (_e, v) => cb(v)),

  // Aparência do overlay (tamanho, cor, transparência, blocos)
  applyOverlayUi: () => ipcRenderer.invoke('overlay:applyUi'),
  getOverlayUi: () => ipcRenderer.invoke('overlay:getUi'),
  onOverlayUi: (cb) => ipcRenderer.on('overlay:ui', (_e, ui) => cb(ui)),
  onOverlayResized: (cb) => ipcRenderer.on('overlay:resized', (_e, size) => cb(size)),

  // Conta Steam e amigos
  steamDetect: () => ipcRenderer.invoke('steam:detect'),
  steamProfile: (id) => ipcRenderer.invoke('steam:profile', id),
  steamFriends: () => ipcRenderer.invoke('steam:friends'),
  steamTest: () => ipcRenderer.invoke('steam:test'),

  // Atalhos globais
  applyHotkeys: () => ipcRenderer.invoke('hotkeys:apply'),
  checkHotkey: (accel) => ipcRenderer.invoke('hotkeys:check', accel),

  // Notificações
  showNotification: (payload) => ipcRenderer.invoke('notify:show', payload),
  testNotification: (payload) => ipcRenderer.invoke('notify:test', payload),
  hideNotification: () => ipcRenderer.invoke('notify:hide'),
  onNotify: (cb) => ipcRenderer.on('notify:show', (_e, payload) => cb(payload)),

  // Central de notificações (a lista que fica, além do balão)
  notifList: (opts) => ipcRenderer.invoke('notif:list', opts || {}),
  notifMarkRead: (ids) => ipcRenderer.invoke('notif:markRead', ids),
  notifRemove: (id) => ipcRenderer.invoke('notif:remove', id),
  notifClear: () => ipcRenderer.invoke('notif:clear'),
  onNotifNew: (cb) => ipcRenderer.on('notif:new', (_e, d) => cb(d)),

  // Mapas
  locateUnturned: () => ipcRenderer.invoke('maps:locate'),
  importMaps: () => ipcRenderer.invoke('maps:import'),
  syncMaps: () => ipcRenderer.invoke('maps:sync'),
  listMaps: () => ipcRenderer.invoke('maps:list'),
  mapImagePath: (mapName, view) => ipcRenderer.invoke('maps:imagePath', mapName, view),

  // Nós do mapa (localizações e airdrops extraídos do jogo)
  extractMapNodes: (mapName) => ipcRenderer.invoke('nodes:extract', mapName),
  mapScale: (mapName) => ipcRenderer.invoke('nodes:scale', mapName),

  // Marcadores
  loadMarkers: (mapName) => ipcRenderer.invoke('markers:load', mapName),
  saveMarkers: (mapName, data) => ipcRenderer.invoke('markers:save', mapName, data),
  importMarkersJson: (mapName) => ipcRenderer.invoke('markers:importJson', mapName),

  // Visualizador de log do Unturned (ao vivo)
  getLogState: () => ipcRenderer.invoke('log:state'),
  getLogEvents: (limit, includeNoise) => ipcRenderer.invoke('log:events', limit, includeNoise),
  getLogSuggestions: () => ipcRenderer.invoke('log:suggestions'),
  reloadLog: () => ipcRenderer.invoke('log:reload'),
  revealLog: () => ipcRenderer.invoke('log:reveal'),
  onLogEvents: (cb) => ipcRenderer.on('log:events', (_e, events) => cb(events)),

  // Workshop da Steam (nome, ícone, tags e datas de cada mod)
  workshopDetails: (ids) => ipcRenderer.invoke('workshop:details', ids),
  workshopPeek: (ids) => ipcRenderer.invoke('workshop:peek', ids),
  workshopClearCache: () => ipcRenderer.invoke('workshop:clearCache'),

  // Geolocalização do servidor (bandeirinha do card)
  geoLookup: (ip) => ipcRenderer.invoke('geo:lookup', ip),
  geoPeek: (ip) => ipcRenderer.invoke('geo:peek', ip),
  geoSetManual: (ip, code, name) => ipcRenderer.invoke('geo:setManual', ip, code, name),

  // Pastas de servidores
  createFolder: (data) => ipcRenderer.invoke('folders:create', data),
  updateFolder: (id, patch) => ipcRenderer.invoke('folders:update', id, patch),
  deleteFolder: (id) => ipcRenderer.invoke('folders:delete', id),
  moveToFolder: (bmIds, folderId) => ipcRenderer.invoke('folders:move', bmIds, folderId),

  // Anotações e prints (escopo: "server:<bmId>" ou "marker:<Mapa>:<id>")
  notesList: (scope) => ipcRenderer.invoke('notes:list', scope),
  noteGet: (id) => ipcRenderer.invoke('notes:get', id),
  noteSave: (note) => ipcRenderer.invoke('notes:save', note),
  noteDelete: (id) => ipcRenderer.invoke('notes:delete', id),
  notesDeleteScope: (scope) => ipcRenderer.invoke('notes:deleteScope', scope),
  notesListMarkers: (mapName) => ipcRenderer.invoke('notes:listMarkers', mapName),
  notesForgetMarker: (markerId) => ipcRenderer.invoke('notes:forgetMarker', markerId),
  notesLink: (a, b, rel) => ipcRenderer.invoke('notes:link', a, b, rel),
  notesUnlink: (a, b) => ipcRenderer.invoke('notes:unlink', a, b),
  notesBoardPos: (id, x, y) => ipcRenderer.invoke('notes:boardPos', id, x, y),
  notesBoard: (scope) => ipcRenderer.invoke('notes:board', scope),
  notesFichas: (scope) => ipcRenderer.invoke('notes:fichas', scope),

  // ---- Calculadora de raid ----
  // O catálogo é lido dos assets do jogo instalado (Bundles/Items).
  gamePathInfo: () => ipcRenderer.invoke('game:pathInfo'),
  gamePickPath: () => ipcRenderer.invoke('game:pickPath'),

  raidCatalog: (opts) => ipcRenderer.invoke('raid:catalog', opts || {}),
  raidIcon: (id) => ipcRenderer.invoke('raid:icon', id),

  // ---- Inventário e bases (por servidor) ----
  invPaths: () => ipcRenderer.invoke('inv:paths'),
  invSetPaths: (patch) => ipcRenderer.invoke('inv:setPaths', patch),
  invPickFolder: (title) => ipcRenderer.invoke('inv:pickFolder', title),
  invCatalog: () => ipcRenderer.invoke('inv:catalog'),
  invScan: () => ipcRenderer.invoke('inv:scan'),
  onInvProgress: (cb) => {
    const fn = (_e, m) => cb(m);
    ipcRenderer.on('inv:progress', fn);
    return () => ipcRenderer.removeListener('inv:progress', fn);
  },
  invLoad: (serverId) => ipcRenderer.invoke('inv:load', serverId),
  invSave: (serverId, data) => ipcRenderer.invoke('inv:save', serverId, data),
  invExportPdf: (html, name) => ipcRenderer.invoke('inv:exportPdf', html, name),

  // ---- Conta e rede (api.cdev.com.br) ----
  // Note o que NÃO existe aqui: nada que devolva token. O renderer
  // pede ações e recebe resultado; a credencial nunca atravessa.
  contaInfo: () => ipcRenderer.invoke('conta:info'),
  contaSetBaseUrl: (url) => ipcRenderer.invoke('conta:setBaseUrl', url),
  contaHealth: () => ipcRenderer.invoke('conta:health'),
  contaRegister: (d) => ipcRenderer.invoke('conta:register', d),
  contaLogin: (d) => ipcRenderer.invoke('conta:login', d),
  contaLogout: (todos) => ipcRenderer.invoke('conta:logout', todos),
  // ---- Time ao vivo (sincronizado pelo servidor) ----
  liveState: () => ipcRenderer.invoke('live:state'),
  liveLoad: () => ipcRenderer.invoke('live:load'),
  liveOpen: (id) => ipcRenderer.invoke('live:open', id),
  liveCreate: (name) => ipcRenderer.invoke('live:create', name),
  liveInvite: (opts) => ipcRenderer.invoke('live:invite', opts),
  liveRedeem: (code, senha) => ipcRenderer.invoke('live:redeem', code, senha),
  liveLeave: () => ipcRenderer.invoke('live:leave'),
  liveRole: (userId, role) => ipcRenderer.invoke('live:role', userId, role),
  liveKick: (userId) => ipcRenderer.invoke('live:kick', userId),
  liveSend: (texto) => ipcRenderer.invoke('live:send', texto),
  liveTyping: () => ipcRenderer.invoke('live:typing'),
  liveRead: () => ipcRenderer.invoke('live:read'),
  liveHistory: (before) => ipcRenderer.invoke('live:history', before),
  liveInvites: () => ipcRenderer.invoke('live:invites'),
  liveRevoke: (id) => ipcRenderer.invoke('live:revoke', id),
  liveRename: (name) => ipcRenderer.invoke('live:rename', name),
  liveDissolve: () => ipcRenderer.invoke('live:dissolve'),
  liveTransfer: (userId) => ipcRenderer.invoke('live:transfer', userId),
  liveBan: (userId, motivo) => ipcRenderer.invoke('live:ban', userId, motivo),
  livePosition: (pos) => ipcRenderer.invoke('live:position', pos),
  livePositionClear: () => ipcRenderer.invoke('live:positionClear'),
  liveDeleteMessage: (id) => ipcRenderer.invoke('live:deleteMessage', id),
  liveRestore: (teamId) => ipcRenderer.invoke('live:restore', teamId),
  liveServers: () => ipcRenderer.invoke('live:servers'),
  liveLinkServer: (s) => ipcRenderer.invoke('live:linkServer', s),
  liveUnlinkServer: (bmId) => ipcRenderer.invoke('live:unlinkServer', bmId),
  liveChannels: () => ipcRenderer.invoke('live:channels'),
  liveCreateChannel: (d) => ipcRenderer.invoke('live:createChannel', d),
  liveDeleteChannel: (id) => ipcRenderer.invoke('live:deleteChannel', id),
  onLiveState: (cb) => ipcRenderer.on('live:state', (_e, st) => cb(st)),
  onLiveMessages: (cb) => ipcRenderer.on('live:messages', (_e, m) => cb(m)),
  onLiveMessage: (cb) => ipcRenderer.on('live:message', (_e, m) => cb(m)),
  onLivePresence: (cb) => ipcRenderer.on('live:presence', (_e, p) => cb(p)),
  onLiveTyping: (cb) => ipcRenderer.on('live:typing', (_e, d) => cb(d)),
  onLivePositions: (cb) => ipcRenderer.on('live:positions', (_e, p) => cb(p)),

  contaRecuperar: (d) => ipcRenderer.invoke('conta:recuperar', d),
  contaRecuperacaoEstado: () => ipcRenderer.invoke('conta:recuperacaoEstado'),
  contaRecuperacaoRenovar: (senha) => ipcRenderer.invoke('conta:recuperacaoRenovar', senha),

  apiCall: (metodo, caminho, body) => ipcRenderer.invoke('api:call', metodo, caminho, body),

  netState: () => ipcRenderer.invoke('net:state'),
  netConnect: () => ipcRenderer.invoke('net:connect'),
  netDisconnect: () => ipcRenderer.invoke('net:disconnect'),
  netSend: (msg) => ipcRenderer.invoke('net:send', msg),
  netRequest: (msg) => ipcRenderer.invoke('net:request', msg),
  onNetEvent: (cb) => ipcRenderer.on('net:event', (_e, obj) => cb(obj)),
  onNetState: (cb) => ipcRenderer.on('net:state', (_e, st) => cb(st)),

  // Agenda: wipes e eventos por servidor
  schedList: (serverId) => ipcRenderer.invoke('sched:list', serverId),
  schedAgenda: (opts) => ipcRenderer.invoke('sched:agenda', opts),
  schedNextWipe: (serverId) => ipcRenderer.invoke('sched:nextWipe', serverId),
  schedSummary: () => ipcRenderer.invoke('sched:summary'),
  schedCreate: (d) => ipcRenderer.invoke('sched:create', d),
  schedUpdate: (id, d) => ipcRenderer.invoke('sched:update', id, d),
  schedDelete: (id) => ipcRenderer.invoke('sched:delete', id),
  schedDeleteByServer: (serverId) => ipcRenderer.invoke('sched:deleteByServer', serverId),
  schedUpcoming: (id, n) => ipcRenderer.invoke('sched:upcoming', id, n),
  schedPreview: (d) => ipcRenderer.invoke('sched:preview', d),
  onScheduleChanged: (cb) => ipcRenderer.on('sched:changed', () => cb()),

  notesCounts: (scopes) => ipcRenderer.invoke('notes:counts', scopes),
  shotsPick: () => ipcRenderer.invoke('shots:pick'),
  shotFromClipboard: () => ipcRenderer.invoke('shots:fromClipboard'),
  shotFromDataUrl: (dataUrl) => ipcRenderer.invoke('shots:fromDataUrl', dataUrl),
  shotMeta: (id) => ipcRenderer.invoke('shots:meta', id),
  shotDelete: (id) => ipcRenderer.invoke('shots:delete', id),
  shotReveal: (id) => ipcRenderer.invoke('shots:reveal', id),
  shotsPrune: () => ipcRenderer.invoke('shots:prune'),
  openGameScreenshots: () => ipcRenderer.invoke('shots:openGameFolder'),

  // Backup e reset
  backupPreview: (opts) => ipcRenderer.invoke('backup:preview', opts),
  backupExport: (opts) => ipcRenderer.invoke('backup:export', opts),
  backupPick: () => ipcRenderer.invoke('backup:pick'),
  backupApply: (opts) => ipcRenderer.invoke('backup:apply', opts),
  backupCancel: () => ipcRenderer.invoke('backup:cancel'),
  appReset: (opts) => ipcRenderer.invoke('app:reset', opts),
  appRelaunch: () => ipcRenderer.invoke('app:relaunch'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openUserData: () => ipcRenderer.invoke('app:openUserData'),

  // Grupos (time) e sincronização
  teamMe: (patch) => ipcRenderer.invoke('team:me', patch),
  teamGroups: () => ipcRenderer.invoke('team:groups'),
  teamCreateGroup: (data) => ipcRenderer.invoke('team:createGroup', data),
  teamUpdateGroup: (id, patch) => ipcRenderer.invoke('team:updateGroup', id, patch),
  teamDeleteGroup: (id) => ipcRenderer.invoke('team:deleteGroup', id),
  teamLeaveGroup: (id) => ipcRenderer.invoke('team:leaveGroup', id),
  teamJoinByCode: (code) => ipcRenderer.invoke('team:joinByCode', code),
  teamAddMember: (gid, m) => ipcRenderer.invoke('team:addMember', gid, m),
  teamSetRole: (gid, uid, role) => ipcRenderer.invoke('team:setRole', gid, uid, role),
  teamRemoveMember: (gid, uid) => ipcRenderer.invoke('team:removeMember', gid, uid),
  teamCan: (gid, action, item) => ipcRenderer.invoke('team:can', gid, action, item),
  teamItems: (gid, opts) => ipcRenderer.invoke('team:items', gid, opts),
  teamCreateItem: (gid, data) => ipcRenderer.invoke('team:createItem', gid, data),
  teamUpdateItem: (id, patch, opts) => ipcRenderer.invoke('team:updateItem', id, patch, opts),
  teamDeleteItem: (id, opts) => ipcRenderer.invoke('team:deleteItem', id, opts),
  teamLinkItems: (a, b, rel, opts) => ipcRenderer.invoke('team:linkItems', a, b, rel, opts),
  teamUnlinkItems: (a, b, opts) => ipcRenderer.invoke('team:unlinkItems', a, b, opts),
  teamItemLinks: (gid) => ipcRenderer.invoke('team:itemLinks', gid),
  teamProfile: (gid) => ipcRenderer.invoke('team:profile', gid),
  teamSetProfile: (gid, patch, opts) => ipcRenderer.invoke('team:setProfile', gid, patch, opts),
  teamSetPosition: (gid, pos) => ipcRenderer.invoke('team:setPosition', gid, pos),
  teamClearPosition: (gid) => ipcRenderer.invoke('team:clearPosition', gid),
  teamPositions: (gid, opts) => ipcRenderer.invoke('team:positions', gid, opts),

  // Fichas de jogadores (aliado/inimigo, grupos, anotações).
  fichasList: (nomes) => ipcRenderer.invoke('fichas:list', nomes),
  fichasAll: () => ipcRenderer.invoke('fichas:all'),
  fichaGet: (nome) => ipcRenderer.invoke('fichas:get', nome),
  fichaLink: (nome, link) => ipcRenderer.invoke('fichas:link', nome, link),
  fichaNote: (nome, nota) => ipcRenderer.invoke('fichas:note', nome, nota),
  fichaAlias: (principal, outro) => ipcRenderer.invoke('fichas:alias', principal, outro),
  fichaDelete: (nome) => ipcRenderer.invoke('fichas:delete', nome),
  fichaGroups: () => ipcRenderer.invoke('fichas:groups'),
  fichaGroupCreate: (d) => ipcRenderer.invoke('fichas:groupCreate', d),
  fichaGroupRename: (id, nome) => ipcRenderer.invoke('fichas:groupRename', id, nome),
  fichaGroupDelete: (id) => ipcRenderer.invoke('fichas:groupDelete', id),
  fichaSetGroup: (nome, gid) => ipcRenderer.invoke('fichas:setGroup', nome, gid),
  fichaGroup: (nomes, opts) => ipcRenderer.invoke('fichas:group', nomes, opts),
  fichasStats: () => ipcRenderer.invoke('fichas:stats'),
  // Servidores vinculados a um time.
  teamLinkServer: (gid, servidor, opts) => ipcRenderer.invoke('team:linkServer', gid, servidor, opts),
  teamUnlinkServer: (gid, bmId, opts) => ipcRenderer.invoke('team:unlinkServer', gid, bmId, opts),
  teamServers: (gid) => ipcRenderer.invoke('team:servers', gid),
  teamGroupsForServer: (bmId) => ipcRenderer.invoke('team:groupsForServer', bmId),
  teamSyncStatus: () => ipcRenderer.invoke('team:syncStatus'),
  teamSyncNow: () => ipcRenderer.invoke('team:syncNow'),
  teamSyncConfigure: (patch) => ipcRenderer.invoke('team:syncConfigure', patch),
  teamStats: () => ipcRenderer.invoke('team:stats'),
  teamDemo: (gid) => ipcRenderer.invoke('team:demo', gid),
  teamRoles: (gid) => ipcRenderer.invoke('team:roles', gid),
  teamTransfer: (gid, uid) => ipcRenderer.invoke('team:transfer', gid, uid),
  teamBan: (gid, uid, reason) => ipcRenderer.invoke('team:ban', gid, uid, reason),
  teamBans: (gid) => ipcRenderer.invoke('team:bans', gid),
  teamCreateInvite: (gid, opts) => ipcRenderer.invoke('team:createInvite', gid, opts),
  teamInvites: (gid) => ipcRenderer.invoke('team:invites', gid),
  teamRevokeInvite: (id) => ipcRenderer.invoke('team:revokeInvite', id),
  teamJoinWithInvite: (d) => ipcRenderer.invoke('team:joinWithInvite', d),
  teamChannels: (gid) => ipcRenderer.invoke('team:channels', gid),
  teamCreateChannel: (gid, d) => ipcRenderer.invoke('team:createChannel', gid, d),
  teamDeleteChannel: (id) => ipcRenderer.invoke('team:deleteChannel', id),
  teamMessages: (chId, o) => ipcRenderer.invoke('team:messages', chId, o),
  teamSend: (chId, d) => ipcRenderer.invoke('team:send', chId, d),
  teamEditMessage: (id, t) => ipcRenderer.invoke('team:editMessage', id, t),
  teamDeleteMessage: (id) => ipcRenderer.invoke('team:deleteMessage', id),
  teamMarkRead: (gid, chId) => ipcRenderer.invoke('team:markRead', gid, chId),
  teamUnread: (gid) => ipcRenderer.invoke('team:unread', gid),

  // Fotos e vídeos
  mediaPick: (scope) => ipcRenderer.invoke('media:pick', scope),
  mediaFromDataUrl: (d, scope) => ipcRenderer.invoke('media:fromDataUrl', d, scope),
  mediaThumb: (id, d) => ipcRenderer.invoke('media:thumb', id, d),
  mediaGet: (id) => ipcRenderer.invoke('media:get', id),
  mediaDelete: (id) => ipcRenderer.invoke('media:delete', id),
  mediaStats: () => ipcRenderer.invoke('media:stats'),
  mediaPruneOld: (d) => ipcRenderer.invoke('media:pruneOld', d),
  mediaLimits: () => ipcRenderer.invoke('media:limits'),

  onTeamChanged: (cb) => ipcRenderer.on('team:changed', (_e, i) => cb(i)),
  onTeamStatus: (cb) => ipcRenderer.on('team:status', (_e, s) => cb(s)),

  // Externos
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text)
});
