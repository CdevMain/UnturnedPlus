# Unturned+ — todas as funções

Versão 1.7.0 do app · backend 1.0.0
22.117 linhas no app · 4.815 no backend · 761 chaves de tradução

Legenda: **✅ pronto e testado** · **🟡 pronto, mas esperando o servidor** ·
**⬜ planejado**

---

## 1. Tela inicial

| função | estado | observação |
|---|---|---|
| Lista de servidores em cards | ✅ | ícone, nome, jogadores, tags, status |
| Favoritos em seção separada | ✅ | contorno dourado, sempre no topo |
| Pastas (um nível) | ✅ | cor e ícone próprios; arrastar card para dentro |
| Busca por nome, tag ou pasta | ✅ | |
| Adicionar por IP ou ID do BattleMetrics | ✅ | detecta a query port sozinho (porta + 1) |
| Excluir vários de uma vez | ✅ | confirmação, e pergunta sobre anotações e prints |
| Copiar IP com um clique | ✅ | |
| Bandeira do país no card | ✅ | geoip com cache no processo principal |
| Quick view (espiar sem entrar) | ✅ | Shift + clique |
| Card "jogando agora" | ✅ | lido do log do Unturned |
| **Foto e nome da Steam no canto esquerdo** | ✅ | e no canto superior direito |
| **Selo de wipe no card** | ✅ | muda de cor conforme aperta |
| **Idioma do PC na primeira abertura** | ✅ | pt-BR e en-US; o resto cai no inglês |

## 2. Página do servidor

| função | estado | observação |
|---|---|---|
| Nome, jogadores, IP, status, uptime | ✅ | |
| Entrar no servidor | ✅ | `steam://connect/ip:porta` |
| Abrir no BattleMetrics | ✅ | |
| Mods do Workshop com link | ✅ | lidos das rules públicas |
| Detalhes (modo, PvP, RocketMod, versão) | ✅ | |
| Contador de airdrop | ✅ | intervalo do servidor ou manual |
| Jogadores online | ✅ | |
| Log de atividade | ✅ | entrada/saída, status, filtro, exportar |
| Histórico de jogadores | ✅ | gráfico das próprias consultas + BattleMetrics |
| Fixar no overlay | ✅ | |
| **Agenda do servidor** | ✅ | próximos 3 wipes/eventos |
| **Voltar como botão de verdade** | ✅ | e o Esc também sai |
| Tempo médio de airdrop calculado | ⬜ | hoje o intervalo é manual ou lido da config |

## 3. Mapa

| função | estado | observação |
|---|---|---|
| Mapa do jogo importado | ✅ | satélite e carta |
| Zoom, arrastar, tela cheia | ✅ | Esc sai da tela cheia |
| Camadas ligáveis | ✅ | locais, airdrops, itens, custom |
| Marcadores próprios | ✅ | nome, tipo, cor, ícone |
| Card do marcador com foto de capa | ✅ | |
| Anotações por marcador | ✅ | texto formatado + prints |
| Lista em massa | ✅ | busca, filtro, renomear, trocar tipo, apagar |
| **Leitura do `Nodes.dat` do jogo** | ✅ | formato binário resolvido; 9 mapas testados |
| **Coordenadas corretas** | ✅ | 1 pixel = 1 metro, conferido em pontes do PEI |
| **Locais oficiais travados** | ✅ | nome do jogo não é editável |
| **"Criar o meu aqui"** | ✅ | cópia editável, o oficial fica intacto |
| **Identificar local por coordenada** | ✅ | "em Novosibirsk" / "3662 m a nordeste de Volk" |
| **Barra de coordenada** | ✅ | X/Z e o local sob o cursor |
| **Nome sugerido ao criar marcador** | ✅ | "Ponto — Novosibirsk" |
| **Mapa troca junto com o servidor** | ✅ | inclusive quando o servidor está offline |
| Posição do time no mapa | 🟡 | manual; ver seção 8 |
| Sua posição automática | ❌ | **não é possível** — ver seção 8 |

## 4. Agenda (wipes e eventos)

| função | estado | observação |
|---|---|---|
| Wipe com data e hora | ✅ | |
| Repetição | ✅ | a cada N dias, semanal, mensal |
| Dia 29/30/31 em mês curto | ✅ | cai no último dia, não escorrega |
| Horário de verão | ✅ | 20h continua 20h na virada |
| Eventos além de wipe | ✅ | raid, airdrop, reunião |
| Duração | ✅ | mostra "acontecendo" enquanto rola |
| Avisos configuráveis | ✅ | 1h, 3h, 12h, 1 dia, 3 dias |
| Silenciar um item | ✅ | |
| Prévia antes de salvar | ✅ | mostra as 3 próximas datas |
| Contagem no card | ✅ | com cor de urgência |
| **"o wipe foi há 3h"** | ✅ | por 6h depois de passar |
| Linha no overlay | ✅ | o próximo, dentro do jogo |
| Selo de quantos itens em 24h | ✅ | no menu |
| Agenda compartilhada com o time | 🟡 | precisa do servidor |
| Importar wipe do BattleMetrics | ⬜ | o BM não publica isso de forma confiável |

## 5. Overlay (F8)

| função | estado |
|---|---|
| Painel por cima do jogo, sempre no topo | ✅ |
| Nome, jogadores, mapa, mods | ✅ |
| Contador de airdrop | ✅ |
| Eventos recentes | ✅ |
| Jogadores online | ✅ |
| **Próximo wipe/evento** | ✅ |
| Modo fantasma (cliques atravessam) | ✅ |
| Tamanho, opacidade, escala, cor | ✅ |
| Redimensionar com o mouse | ✅ |

## 6. Notificações

| função | estado |
|---|---|
| Janela própria, sem roubar o foco | ✅ |
| Entrada e saída de jogador | ✅ |
| Só amigos (opcional) | ✅ |
| **Wipe e evento chegando** | ✅ |
| Som sintetizado (sem arquivo) | ✅ |
| Posição, duração, volume | ✅ |
| Notificação do próprio Windows | ⬜ |

## 7. Steam

| função | estado |
|---|---|
| Detectar a conta instalada | ✅ |
| Foto e nome no app | ✅ |
| Amigos jogando Unturned | ✅ |
| Amigos que estão no card | ✅ |
| Abrir perfil na Steam | ✅ |
| Login pela Steam (OpenID) | ⬜ |

## 8. Time — local

Tudo funciona hoje, **na sua máquina**. Falta só a rede.

| função | estado | observação |
|---|---|---|
| Criar time, nome, foto, id | ✅ | |
| Hierarquia de 5 papéis | ✅ | dono, admin, moderador, membro, convidado |
| Regra única de permissão | ✅ | só age sobre quem tem rank menor |
| Convite com código **e senha** | ✅ | senha aparece uma vez só |
| Banir (impede voltar pelo convite) | ✅ | |
| Transferir a posse | ✅ | nunca fica sem dono |
| Chat com canais | ✅ | |
| Fotos e vídeos no chat | ✅ | 25 MB imagem, 200 MB vídeo |
| Marcadores, notas e prints do time | ✅ | |
| Comentários nos itens | ✅ | |
| Voz (WebRTC em malha) | ✅ | push-to-talk, mudo, surdo, ganho |
| Autoteste de microfone | ✅ | duas conexões locais conversando |
| Modo solo intacto | ✅ | seus dados nunca se misturam |
| **Sincronizar entre pessoas** | 🟡 | fila pronta, esperando hospedar |
| **Posição no mapa em tempo real** | 🟡 | manual hoje |

### Por que a posição é manual

Num servidor comum o app **não tem como** saber onde você está. O
`Client.log` do Unturned não traz coordenada — 5.000 linhas vasculhadas — e
ler a memória do jogo é exatamente o que o BattlEye trata como cheat
externo. Não é limitação de esforço: é o que existe.

O campo `source` (`manual` | `auto`) já está no lugar. No dia em que houver
um plugin RocketMod/OpenMod no servidor publicando posição, só muda quem
chama `setPosition` — o resto do app não sabe a diferença.

## 9. Configurações

| função | estado |
|---|---|
| Idioma (pt-BR / en-US) | ✅ |
| Token da API BattleMetrics | ✅ |
| Intervalo de atualização | ✅ |
| Atalhos configuráveis | ✅ |
| Conta Steam | ✅ |
| Aparência do overlay | ✅ |
| Backup: exportar e importar | ✅ |
| Reset total | ✅ |
| Prévia antes de restaurar | ✅ |
| Tema claro | ⬜ |

---

## 10. Backend — pronto, esperando a VPS

98 checagens contra PostgreSQL, HTTP e WebSocket de verdade.

| função | estado |
|---|---|
| Registro e login | ✅ |
| Senha em scrypt, re-hash automático | ✅ |
| Access + refresh com rotação | ✅ |
| Detecção de reuso de refresh | ✅ |
| Força bruta contada no banco | ✅ |
| Times, papéis, convites, ban, transferência | ✅ |
| Amigos (pedido, aceite, cruzado) | ✅ |
| Conversa direta, grupo e de time | ✅ |
| Mensagens: enviar, editar, apagar, responder | ✅ |
| Paginação por id | ✅ |
| Não lidas por participante | ✅ |
| WebSocket com autenticação | ✅ |
| Presença online/offline | ✅ |
| "Digitando" | ✅ |
| Notificações | ✅ |
| `/health`, `/health/db`, métricas | ✅ |
| Rate limit em dois níveis | ✅ |
| Migrations com trava anti-edição | ✅ |
| systemd, backup, monitoramento | ✅ |
| **Hospedar em api.cdev.com.br** | ⬜ **próximo passo** |

### Depois de hospedar, ligam sozinhos

O código do app já existe; hoje a fila só acumula.

- Time sincronizado entre as pessoas
- Chat de verdade entre máquinas
- Voz com sinalização pelo servidor
- Presença real
- Posição do time no mapa ao vivo
- Agenda compartilhada
- Entrar num time de outra pessoa

---

## 11. Planejado

**Curto prazo**

- Login pela Steam (OpenID) em vez de e-mail e senha
- Upload de foto/vídeo para o servidor (hoje é local)
- Notificação por push com o app fechado
- Tema claro

**Médio prazo**

- Integração com servidores Unturned: plugin publicando status, jogadores
  e eventos. A tabela `game_servers` e o `token_hash` já existem; cada
  servidor terá credencial própria, e um `serverId` mandado pelo cliente
  nunca vale sozinho.
- Posição automática no mapa (depende do plugin acima)
- Alerta de raid pelo log do servidor
- Estatísticas por jogador ao longo do tempo

**Longo prazo**

- App para celular só de acompanhar
- Página pública do time
- Aviso quando um amigo entra num servidor que você acompanha

---

## O que não vai existir, e por quê

| ideia | por quê não |
|---|---|
| Ler posição da memória do jogo | O BattlEye trata como cheat. Banimento. |
| Ler o chat do jogo | Mesma coisa. |
| Automatizar ações no jogo | Mesma coisa. |
| Wipe como campo de data simples | Quase todo wipe é recorrente; a data vence e o app passa a mentir. |
| Renomear local oficial do mapa | É a referência que o app usa para dizer onde as coisas ficam. Existe o "criar o meu aqui". |
