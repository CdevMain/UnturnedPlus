# Unturned+ 🎮

Sistema de tracking e monitoramento de servidores do Unturned, feito em Electron para Windows.

**A fonte principal dos dados agora é o próprio servidor**, consultado em tempo real
pelo **Query Port** via protocolo **A2S / Source Engine Query** (o mesmo que o Steam,
o BattleMetrics e o próprio jogo usam). Você digita o **IP:porta** e o app puxa direto:
nome, mapa, jogadores online, **mods do Workshop**, descrição e a **configuração pública**
do servidor — **sem chave, sem token e sem depender de nenhum serviço externo**.

O BattleMetrics virou **opcional**: serve só para complementar com *rank* e histórico
da página pública (via leitura da página, sem API/token) quando você adiciona um servidor
pelo ID do BM.

## Requisitos

- Node.js 18 ou superior (necessário para o `fetch` nativo)
- Windows 10/11 (funciona também em Linux/macOS para desenvolvimento)
- Nenhum token é necessário para a consulta direta (Query Port). Um token/ID do
  BattleMetrics é opcional, só para os complementos de rank/histórico.

## Como as informações são obtidas (A2S / Query Port)

O app faz as três consultas do protocolo direto no servidor:

- **A2S_INFO** → nome, mapa, jogadores/limite, versão, tipo de servidor.
- **A2S_PLAYER** → lista de jogadores online (nome + tempo conectado).
- **A2S_RULES** → **todas as "rules" públicas** do servidor. É aqui que o Unturned
  publica o **mapa detalhado, os mods do Workshop, a descrição e vários valores de
  config**. Respostas grandes vêm fragmentadas em vários pacotes UDP — o app remonta
  tudo automaticamente e também faz o *handshake* de *challenge* dos servidores novos.

Na tela de tracking, o painel **Detalhes & Mods** mostra os campos reconhecidos
(descrição, modo, RocketMod, versão) e a **lista de mods** (com link pro Workshop).
Como os nomes das *rules* podem variar entre versões do Unturned e plugins, o botão
**"Ver todas as rules"** exibe o dicionário bruto completo — essa é sempre a fonte da
verdade se algum campo não for reconhecido automaticamente.

> Nota técnica: o **U3-SDK** (o projeto Unity linkado) **não** é o que consulta
> servidores — ele serve para extrair dados de *mapas* (locais, airdrops), já usado
> pelo `tools/UnturnedPlusExportNodes.cs`. Quem entrega as informações públicas do
> servidor ao vivo é o protocolo A2S acima.

### Motor de consulta (gamedig + A2S próprio)

Para máxima confiabilidade, a consulta usa dois motores, nesta ordem:

1. **gamedig** (`type: "unturned"`) — biblioteca testada que conhece as
   particularidades do Unturned (portas, campos EDF do A2S e *rules* grandes
   comprimidas em **bzip2**, que a implementação manual recusa). É o motor primário
   **quando instalado** (`npm install` já traz, pois é uma *optionalDependency*).
2. **A2S próprio** (`queryPort.js`) — implementação sem dependências, com **sonda
   multi-porta**, usada como *fallback*. Assim o app funciona mesmo se o gamedig não
   for instalado (ex.: máquina offline no momento do `npm install`).

Os dois caminhos devolvem o mesmo formato, então o resto do app não muda. Se o motor
principal não trouxer as *rules* (mods/ícone/airdrop), o app tenta completá-las com o
A2S_RULES próprio automaticamente.

## Airdrop 🪂

O painel **Airdrop** (na tela de tracking e no overlay) tem um botão
**"Caiu um airdrop"**: clique quando um cair no jogo e o app inicia uma **contagem
regressiva** até o próximo drop provável, conforme o **intervalo do servidor**.

O intervalo é definido, por ordem de prioridade: (1) o valor que você digitar no campo
*Intervalo*; (2) o valor de airdrop publicado pelo servidor nas *rules*, quando existir;
(3) um padrão editável de 1800s. Quando o tempo estoura, o contador passa a indicar
"AGORA / provável há …".

## Instalação

```bash
npm install
npm start
```

Não há dependências de runtime além do próprio Electron — o app usa o `fetch` nativo do Node, então o antigo erro `Cannot find module 'axios'` não existe mais nesta versão.

## Primeira configuração

1. Abra o app e clique no **+** para adicionar um servidor por **IP:porta**
   (ex.: `23.27.211.226:27017`). Pronto — os dados já vêm direto do servidor.
2. (Opcional) Em ⚙️ **Configurações**, ajuste o intervalo de atualização e o idioma.
3. (Opcional) Cole um token do BattleMetrics apenas se quiser os complementos de
   rank/histórico ao adicionar servidores por **ID do BM**.

> Sobre o **Query Port**: o número que você digita pode ser a **porta de jogo**
> (ex.: `27015`) ou a **porta de query** (ex.: `27016`, que é o que o BattleMetrics
> mostra) — o app **testa as portas candidatas automaticamente** (`porta+1`, `porta`,
> `porta-1`) e usa a que responder, guardando-a. Se ainda assim não conectar, informe
> a porta de query exata no campo *Query Port* ao adicionar. Um card que ficou "offline"
> por porta errada se recupera sozinho assim que uma porta responde.

## Servidor atual — "jogando agora" 🎯

O app tenta detectar **em qual servidor você está jogando** lendo o log do Unturned
(`Player.log`). Quando entra num servidor, aparece uma **faixa em destaque no topo** da
lista com um botão para **adicionar aos seus servidores**. Se o servidor **já está salvo**,
o próprio card fica **destacado em amarelo** ("jogando agora"), sem duplicar. A faixa troca/some
sozinha quando você muda de servidor ou sai do jogo.

> ⚠️ Parte dos servidores usa o **relay da Steam (SDR)** — nesses casos o log pode não
> conter um IP direto, e a detecção automática não consegue resolver. Por isso existe o
> **modo manual** (link "Definir manualmente"): informe o `IP:porta` ou aponte o arquivo
> `Player.log` do Unturned. O caminho padrão testado é
> `%USERPROFILE%\AppData\LocalLow\SmartlyDressedGames\Unturned\Player.log`.

## Ícone e mapa no card

- **Ícone público do servidor**: se o servidor publica um ícone (config `Browser_Icon`
  do Unturned) nas rules, ele aparece no card.
- **Fundo do mapa**: o card usa a imagem do mapa como fundo, reaproveitando as imagens
  importadas da sua instalação local do Unturned (⚙️ → importar mapas → `Map.png`).

⚠️ **Nunca compartilhe seu token publicamente.** Se ele vazou, revogue-o e gere um novo em https://www.battlemetrics.com/developers antes de usar o app.

## Como usar

### Adicionar servidor
- Clique no botão flutuante **+**.
- Digite um **IP:porta** (ex.: `23.27.211.226:27017`) ou um **ID do BattleMetrics** (ex.: `31635372`).
- Opcionalmente defina tags e marque como favorito.

### Excluir servidores
- Clique na **lixeira** para entrar no modo de seleção.
- Clique nos cards que deseja remover.
- Clique na lixeira novamente e confirme no modal.

### Tracking
- Clique em qualquer card para abrir a página de tracking, com:
  - Informações do servidor (jogadores, IP, mapa, rank, uptime)
  - Botão **Entrar no servidor** (`steam://connect/ip:port`)
  - Botão **Abrir no BattleMetrics**
  - Lista de jogadores online
  - Logs automáticos de entrada/saída de jogadores e mudança de status
  - Mapa interativo com pan (arrastar) e zoom (scroll)

### Mapas
Coloque a imagem do mapa na pasta `maps/` com o nome do mapa sem espaços:

```
maps/PEI.png
maps/Washington.png
maps/Russia.png
```

O app detecta o mapa atual do servidor pela API e carrega a imagem automaticamente.

## Estrutura do projeto

```
unturned-plus/
├── main.js            # Processo principal (janela, IPC, API BattleMetrics)
├── preload.js         # Ponte segura entre main e renderer
├── index.html         # Interface (home, tracking, modais)
├── styles.css         # Tema escuro "Survival Ops"
├── js/
│   ├── i18n.js        # Sistema de idiomas
│   ├── config.js      # Estado global e configurações
│   ├── list.js        # Home: cards, busca, adicionar/excluir
│   ├── tracking.js    # Tracking: polling, players, logs, uptime
│   ├── map.js         # Mapa interativo em canvas
│   └── ui.js          # Eventos, modais, toast, inicialização
├── languages/
│   ├── pt-BR.json
│   └── en-US.json
└── maps/              # Espaço reservado — as imagens reais vão para %APPDATA%
```

## Build para Windows

Dois cliques em **`build.bat`** fazem tudo (instala o que falta e empacota).
Pela linha de comando, na pasta do projeto:

```bash
npm install          # só na primeira vez
npm run dist         # gera os DOIS formatos
```

Saem dois arquivos em `dist/`:

| Arquivo | Para quê |
|---|---|
| `UnturnedPlus-<versão>-portable.exe` | **Um arquivo só.** Não instala nada, não pede admin. É o que se manda para alguém testar. |
| `UnturnedPlus-<versão>-setup.exe` | Instalador com atalhos no menu iniciar e na área de trabalho. |

Para gerar só um deles: `npm run dist:portable` ou `npm run dist:installer`.

A primeira build baixa o Electron (~100 MB) e demora alguns minutos; as
seguintes reaproveitam o download. `compression: "maximum"` no `package.json`
troca ~1 minuto de build por alguns MB a menos no arquivo final.

### O aviso do SmartScreen

Os executáveis **não são assinados** — assinatura de código é um certificado
pago. O Windows vai mostrar *"O Windows protegeu o computador"* na primeira
execução; o caminho é **Mais informações → Executar assim mesmo**. Vale avisar
quem for testar (veja `LEIA-ME-TESTADORES.md`, feito para mandar junto).

### Pasta de dados

Tanto em desenvolvimento quanto empacotado, o app usa `%APPDATA%\unturned-plus`.
Isso está fixado por `app.setName()` no `main.js`: sem isso, o Electron usaria um
nome em `npm start` e outro no build, e o instalador abriria com a lista de
servidores vazia — parecendo perda de dados quando é só outra pasta.

## Solução de problemas

**"Servidor não encontrado" ao adicionar por IP** — verifique se o servidor está listado no BattleMetrics e se o token foi salvo nas configurações.

**Erro 401/403 na API** — o token está ausente, inválido ou revogado. Gere um novo em https://www.battlemetrics.com/developers.

**Mapa não aparece** — clique em *Importar mapas do jogo* na aba Mapa. As imagens são copiadas da sua instalação do Unturned para `%APPDATA%\unturned-plus\maps`; a pasta `maps/` do projeto é só um espaço reservado e não é empacotada.

## Overlay in-game (v1.1)

O Unturned+ inclui um overlay externo — uma janela transparente sempre no topo que mostra o servidor fixado enquanto você joga. Ele **não toca no processo do jogo** (não injeta, não lê memória): é apenas uma janela por cima, como o overlay do Discord, alimentada pela API do BattleMetrics.

- **Fixar**: abra o tracking de um servidor e clique em **📌 Fixar no overlay**.
- **F8**: mostrar/ocultar o overlay (atalho global, funciona com o jogo em foco).
- **F9**: "modo fantasma" — os cliques atravessam o overlay e vão para o jogo.
- Arraste pela barra superior para reposicionar; redimensione pelas bordas.

⚠️ **Importante**: rode o Unturned em modo **janela sem bordas** (borderless/windowed). Em fullscreen exclusivo, nenhum overlay externo aparece.

### Por que não existe UI "dentro" do jogo?

UI nativa dentro do Unturned (UI Effects) só pode ser enviada pelo **servidor**, via plugins (RocketMod/OpenMod). Se um dia você tiver seu próprio servidor, dá para evoluir o Unturned+ com um plugin que transmite posições de jogadores em tempo real para o mapa do app. Modificar o **cliente** para injetar interface em servidores de terceiros não passa pelo anticheat e é tratado como cheat — o overlay externo é a alternativa segura.

## Sistema de mapas v2 (v1.2)

O app importa os mapas **da sua própria instalação do Unturned** — não distribuímos assets do jogo (a licença do source é não-comercial e os binários não podem ser redistribuídos).

### Importar mapas
Na página de tracking, clique em **Importar mapas do jogo**. O app detecta a instalação da Steam automaticamente (ou pede a pasta) e, **assim que você define o local, já sincroniza**: copia o `Map.png` (satélite) e `Chart.png` (carta) de **todos os mapas** — tanto os **oficiais** (`Maps/`) quanto os do **Workshop** (`steamapps/workshop/content/304930/`). A sincronização é incremental: mapas novos são detectados e copiados, e uma imagem só é **recopiada quando muda** (comparando tamanho + data). Rodar de novo quando nada mudou não recopia nada. Alterne entre as duas visões pelo seletor.

### Marcadores
Quatro camadas com liga/desliga: 📍 Locais, 🪂 Airdrops, 📦 Itens e ⭐ Custom.

- **＋ Marcador**: ativa o modo de edição — clique no mapa para adicionar (com nome e categoria), botão direito remove.
- As coordenadas são do **mundo do jogo** (origem no centro do mapa), convertidas automaticamente para a imagem. Tamanhos dos mapas oficiais já vêm configurados.
- Tudo fica salvo por mapa em `%APPDATA%/unturned-plus/maps/<Mapa>/markers.json` — pode compartilhar esse arquivo com amigos, que importam pelo botão **Importar JSON**.

### Exportar dados reais do mapa com o U3-SDK
O arquivo `tools/UnturnedPlusExportNodes.cs` é um script de editor para o projeto Unity do U3-SDK:

1. Copie-o para `Assets/Editor/` no projeto do SDK.
2. Carregue o mapa desejado no editor.
3. Menu **Unturned+ → Export Map Nodes**.
4. Importe o JSON gerado no app pelo botão **Importar JSON**.

Isso traz os **locais nomeados e pontos de airdrop reais** do level para o seu mapa. (Spawns individuais de itens são gerados por tabelas de spawn por região, não por pontos fixos — por isso a camada 📦 Itens é ideal para marcar manualmente os loots que você conhece.)
