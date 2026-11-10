# Unturned+ — versão de teste

Obrigado por testar! Isto é um app de PC que acompanha servidores de Unturned
(quem está online, mapa com marcadores, anotações, overlay). Ele **só lê** coisas
do seu computador — não modifica o jogo, não injeta nada, não pede sua senha da Steam.

---

## Como abrir

Você recebeu **um arquivo só**: `UnturnedPlus-1.3.0-portable.exe`.
Salve onde quiser e dê dois cliques. Não precisa instalar.

### O Windows vai reclamar na primeira vez

Vai aparecer uma tela azul: **"O Windows protegeu o computador"**.

Isso acontece com **todo** programa que não pagou por uma assinatura digital
(custa algumas centenas de dólares por ano) — não quer dizer que tem vírus.

Para abrir:

1. Clique em **Mais informações**
2. Clique em **Executar assim mesmo**

Só na primeira vez. Se o seu antivírus colocar em quarentena, é o mesmo motivo —
libere o arquivo ou me avise qual antivírus é.

---

## Primeira vez

O app abre com uma introdução de 4 telas. Vale seguir ela, principalmente o passo
que **procura a pasta do Unturned** — é o que libera os mapas e a detecção
automática do servidor em que você entrou.

Se ele não achar sozinho, o caminho costuma ser um destes:

```
C:\Program Files (x86)\Steam\steamapps\common\Unturned
C:\SteamLibrary\steamapps\common\Unturned
```

---

## O que eu gostaria que vocês testassem

- **Adicionar servidor** — por IP (`23.27.211.226:27017`) ou por ID do
  BattleMetrics. Com o jogo aberto, o app já sugere o servidor em que você está.
- **Entrar num servidor com o jogo aberto** e ver se o card "jogando agora"
  aparece sozinho na tela inicial.
- **Overlay** (tecla **F8**) — com o jogo em tela cheia sem bordas. F9 deixa os
  cliques atravessarem, F10 marca que caiu um airdrop.
- **Mapa** — importar os mapas do jogo, o botão "Extrair nomes do mapa", criar um
  marcador e clicar nele para abrir o card.
- **Notas e prints** — anotar alguma coisa e colar um print com **Ctrl+V**.
- **Idioma** — trocar para inglês em Configurações e ver se sobrou algum texto
  em português (ou vice-versa).

---

## Se der algum problema

Me manda:

1. **O que você fez** antes do problema aparecer (o passo a passo, mesmo que
   pareça óbvio).
2. **Um print** da tela.
3. **O backup**: Configurações → **Dados** → **Exportar backup**, marque tudo e
   me manda o `.json`. Ele contém sua lista de servidores, anotações e
   configurações — e **não** contém senha nem chave de API nenhuma.

Se o app travar de vez, dá para começar do zero em
Configurações → Dados → **Resetar o aplicativo**.

---

## Onde ficam os seus dados

`%APPDATA%\unturned-plus` — cole isso na barra do Explorador de Arquivos.

O app não instala nada fora dessa pasta. Para remover, apague o `.exe` e essa
pasta, e acabou.
