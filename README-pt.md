# dsh-pet

Uma companheira que vive no canto inferior direito da **interface web do DSH**: fica por
perto ou aparece de forma aleatória, fala (com voz), anda, dança, fica tímida ou irritada, e
traz uma caixinha de texto para conversar. Quatro personagens fotorrealistas, cada uma com o
seu temperamento.

> Escopo: a mascote só vive dentro da janela do DSH (monta no slot de overlay do framework).
> **Não flutua sobre outros aplicativos** — isso exigiria um shell Electron separado.

## At a glance

- **Pontos de montagem**: `shell.overlay` (a mascote, camada que ignora cliques) e
  `conversation.input.right` (o botão ao lado do compositor).
- **Conversa privada**: o que você digita na caixinha **nunca entra na sua sessão**. O host
  expõe `POST /dsh-pet/chat` e responde com uma chamada única a `ctx.llm.stream()`
  (sem sessão, sem log de sessão).
- **Ícone**: `icon.svg` e o botão do compositor usam o mesmo traçado.
- **Painel de ajustes** agrupado e fixo na viewport, com selects e switches próprios.
- **Quatro personagens** fotorrealistas, 5 expressões cada: 薇, 绯, 靛, 雪.

## Behavior

| Recurso | Como |
|---|---|
| Sempre visível / aleatória | Alternador no painel; o modo aleatório usa probabilidade por hora |
| Horário ativo | Início e fim, aceita atravessar a meia-noite |
| Falas proativas | Pacotes de falas por humor, balão + voz |
| Voz | **Opcional**: com `edge-tts` num python do host usa voz neural; senão usa `speechSynthesis` |
| Caixinha de texto | Conversa só com a mascote; chamada pontual ao modelo, nada é gravado |
| Humores | idle / walk / dance / shy / angry / sleep / talk / happy |
| Olhar | As pupilas seguem o mouse (apenas variáveis CSS) |
| Efeitos | Tinta / confete / nuvem / névoa / bomba |

## Install (local, no registry)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Feche o DSH antes de instalar. O script adiciona a dependência `file:` ao perfil, registra o
bundle, roda `pnpm install` e confere o resultado. `update.cmd` apenas copia arquivos e pode
ser usado com o DSH aberto.

```bash
pip install edge-tts    # opcional: voz neural, qualquer python do host
```

## Verify

```bash
node --check client.js
node tests/smoke.mjs
cd <profile>/node_modules/@local/dsh-pet && node --test tests/host.test.mjs
node <dsh-plugin-guide>/bin/dsh-plugin-dev.js check --cwd . --strict
node <dsh-plugin-guide>/bin/dsh-plugin-dev.js verify --cwd .
```

## Customize

- Personagens, falas e temperamentos ficam em `PERSONAS` no `client.js`.
- Novos humores: keyframes no bloco `CSS` e o mapeamento da classe em `Face`/`PetArt`.
- `provider`, `model`, `maxTokens` e `temperature` são configuração do plugin.

## Security model

- As rotas do host têm três controles, nenhum preso a porta ou domínio fixo: `Host` deve
  ser um endereço de loopback, a origem do próprio host, ou estar em `allowedHosts`
  (para proxy reverso / LAN); se houver `Origin`, ele deve ser da mesma origem desse
  `Host` ou do shell de desktop (`dsh-app://app`, `dsh-app://shell`); e
  `Sec-Fetch-Site`, quando presente, só aceita `same-origin` ou `none`. Clientes que
  não enviam nada disso passam — esse é o limite real de um endpoint HTTP local.
- O áudio sintetizado fica no diretório temporário com um teto revalidado **depois de
  cada síntese**, e a escrita usa nome temporário aleatório + `rename`, então um link
  simbólico plantado não consegue desviá-la.
- Tudo o que a página envia (ajustes, histórico, id do personagem) é tratado como dado:
  validado, com limite de tamanho, nunca interpolado como instrução ou marcação.
- A voz neural envia o texto lido ao endpoint edge-tts da Microsoft. Desligue-a (ou não
  instale `edge-tts`) para manter tudo local; o painel avisa.

## Known limits

- A voz neural exige um python do host com `edge_tts`.
- O navegador bloqueia autoplay até o primeiro gesto do usuário.
- Ajustes ficam no `localStorage`; a alça de depuração `__dshPet` fica desligada por padrão
  (`dsh-pet.debug=1` ou `?petdebug=1`).
- Não flutua sobre outros aplicativos.
