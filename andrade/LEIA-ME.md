# ANDRADE — Screenshare

Plataforma original em HTML5, CSS3 e JavaScript puro, com WebRTC e servidor WebSocket opcional. Não utiliza código, logotipo ou arquivos da referência. A URL de referência não pôde ser acessada durante a implementação; o projeto segue a estrutura detalhada do pedido.

## 1. Abrir imediatamente

Extraia **ANDRADE-completo.zip**, abra a pasta `andrade` e clique duas vezes em `index.html`.

A interface funciona sem instalação, CDN, fonte remota ou compilação. Crie uma sala, abra os painéis, teste o chat e conceda as permissões de mídia quando solicitado. Câmera e microfone começam desligados. Nada é capturado automaticamente.

Na cópia do repositório, os arquivos públicos ficam em `dist/`. O ZIP de entrega já coloca `index.html`, `room.html`, `css/`, `js/` e `assets/` diretamente na pasta `andrade`, como solicitado.

**Sem servidor, o modo é local.** O link não conecta outros dispositivos. Em uma origem HTTP local comum, as abas do mesmo navegador podem testar chat, participantes, gerenciamento e mídia via BroadcastChannel + WebRTC. Com `file://`, a comunicação entre abas depende do navegador; para um teste consistente, use o servidor abaixo. A indicação ONLINE da home descreve a conectividade do navegador, não a disponibilidade de um servidor.

## 2. Usar o servidor completo incluído

Instale o Node.js 22 ou superior. No terminal, dentro da pasta `andrade`, execute:

```bash
npm install
npm start
```

Abra `http://localhost:3000`. Crie a sala e mantenha a aba do host aberta. Para testar duas pessoas no mesmo computador, abra o convite em outro perfil/janela privativa do navegador ou entre pelo formulário da home com outro apelido. Duplicar a aba do host pode copiar sua sessão e credencial; entrar como convidado pelo formulário cria uma sessão distinta.

O servidor entrega automaticamente a configuração correta em `js/config.js`. Você não precisa editar o endereço WebSocket neste modo. É possível conferir o funcionamento em `/health`.

### Outros computadores e celulares

Hospede este mesmo servidor atrás de um proxy HTTPS que encaminhe WebSocket para `/ws`. Defina `PUBLIC_ORIGIN` com a origem HTTPS exata. Para expor o processo a um proxy/container, configure `HOST=0.0.0.0` conforme a sua hospedagem. O endereço `localhost` sempre representa o próprio aparelho; não funciona como convite para outro computador.

Copie `.env.example` para `.env`, ajuste os valores e inicie com:

```bash
node --env-file=.env server/index.mjs
```

Se o frontend estiver em outra hospedagem, ajuste `websocketUrl` em `js/config.js` para o endereço `wss://.../ws` do servidor e use `PUBLIC_ORIGIN` para autorizar a origem do frontend. Nunca coloque a senha da sala ou o token do host na URL.

## 3. Arquivos

```text
andrade/
├── index.html
├── room.html
├── css/
│   └── style.css
├── js/
│   ├── config.js
│   ├── app.js
│   ├── room.js
│   └── webrtc.js
├── assets/
│   ├── logo/andrade.svg
│   ├── icons/README.txt
│   └── images/README.txt
├── server/
│   └── index.mjs
├── package.json
├── package-lock.json
├── .env.example
└── LEIA-ME.md
```

- `app.js`: ícones, modais, convites, utilitários e fluxo da home.
- `room.js`: interface da sala, participantes, chat, gerenciamento e permissões de mídia.
- `webrtc.js`: sinalização WebSocket/local, negociação WebRTC e ciclo de vida dos peers.
- `config.js`: endereço do servidor, servidores ICE e limite da interface.
- `server/index.mjs`: servidor HTTP + WebSocket, salas, autenticação do host, senhas e moderação.

## 4. Recursos implementados

| Recurso | Comportamento |
|---|---|
| Criar sala | Código `AND-XXXX`, link próprio e credencial aleatória de host |
| Sala privada | Senha validada pelo servidor; alteração e remoção de senha pelo host |
| Entrar | Código, apelido e senha quando necessária |
| Tela | Seletor nativo do navegador; uma transmissão de tela por sala |
| Câmera | Preview local e miniaturas dos participantes |
| Microfone | Controle independente; desligar encerra a track de captura |
| Áudio | Silencia apenas a reprodução neste aparelho |
| Chat | Mensagens reais entre participantes; texto inserido com `textContent` |
| Pessoas | Lista real, host e estados MIC/CAM/SCREEN |
| Host | Remover, silenciar, bloquear entradas, alterar senha e encerrar |
| Atividades | Histórico desta aba; sem gravação de áudio/vídeo |
| Convite | Copia apenas o endereço e código; não contém credenciais |
| Celular | Transmissão acima, controles em grade e chat/pessoas em drawer |
| Acessibilidade | HTML semântico, modais nativos, foco visível, abas por teclado, redução de animações |

Os exemplos de pessoas e mensagens do pedido não são exibidos como se fossem participantes reais. Uma sala vazia mostra apenas quem está conectado.

## 5. Atalhos

| Tecla | Ação |
|---|---|
| M | Ligar/desligar microfone |
| V | Ligar/desligar câmera |
| S | Escolher uma tela para compartilhar |
| C | Abrir chat |
| F | Tela cheia |
| Escape | Fechar modal/drawer |

Atalhos são ignorados enquanto você escreve em campos ou tem um modal aberto. Enter envia a mensagem; Shift + Enter cria uma nova linha.

## 6. Mídia, rede e limites

- A captura depende da permissão do navegador e de contexto seguro: HTTPS ou localhost. A interface pode abrir pelo arquivo, mas a política de mídia varia por navegador.
- Compartilhamento de tela em celulares tem suporte limitado. Quando indisponível, a ANDRADE informa isso; participantes ainda podem assistir e conversar. Áudio do sistema também depende do navegador, sistema e superfície escolhida.
- A câmera solicita `{ video: true, audio: true }`. A track de áudio dessa solicitação é encerrada imediatamente: o microfone só transmite quando seu próprio controle é ativado. Ambos os dispositivos precisam estar disponíveis para essa chamada.
- O botão PARAR encerra o compartilhamento de tela e seu áudio. Câmera e microfone têm controles independentes. Sair da sala encerra todas as capturas.
- A mídia é criptografada em trânsito pelo WebRTC (DTLS/SRTP). O selo ENCRYPTED identifica esse protocolo; não afirma anonimato nem criptografia de ponta a ponta do chat. O servidor recebe mensagens e metadados de sinalização. Em produção, use WSS para o transporte de chat/sinalização.
- O servidor STUN configurado auxilia na descoberta de conexão. Redes restritivas exigem **TURN**: configure `TURN_URLS`, `TURN_USERNAME` e `TURN_CREDENTIAL`. Credenciais TURN são fornecidas aos clientes para conectar. Em produção, prefira credenciais temporárias emitidas por seu provedor e limite quotas; não use uma credencial permanente irrestrita.
- Esta implementação usa mesh: até 8 participantes, uma tela compartilhada por vez. A qualidade e o uso de banda dependem das máquinas e redes; não há promessa de latência zero ou resolução fixa. Para grandes salas, use uma arquitetura SFU.
- O host pode silenciar o microfone de um participante, que pode ativá-lo de novo. Remover desconecta a sessão atual, não constitui banimento permanente. Para impedir novas entradas, bloqueie a sala ou altere a senha.
- O token do host fica em `sessionStorage`; os apelidos e preferências ficam neste navegador. Senhas digitadas passam temporariamente pela sessão para entrar e são removidas após a conexão. No servidor, senhas usam `scrypt` com salt; o token do host é armazenado como hash e não é enviado aos participantes.
- Modo local é destinado a testes e utiliza dados locais do navegador. Ele não oferece isolamento contra outro código da mesma origem. Use o servidor para controle de acesso real entre dispositivos.
- Salas do servidor existem em memória, não sobrevivem a reinícios e expiram após 6 horas. Se o host desconectar, dispõe de 60 segundos para voltar com a mesma sessão; depois a sala é encerrada. Não há gravação de mídia nem arquivo permanente do chat.

## 7. Protocolo de sinalização

Mensagens JSON por WebSocket nativo; Socket.IO não é necessário. O backend incluído já é funcional, não é pseudocódigo.

| Direção | Tipos |
|---|---|
| Cliente → servidor | `inspect`, `join`, `signal`, `chat`, `media`, `share-start`, `share-stop` |
| Host → servidor | `lock`, `password`, `kick`, `mute`, `end` |
| Servidor → cliente | `info`, `welcome`, `room`, `signal`, `chat`, `ack`, `error`, `mute`, `removed`, `ended`, `host-offline` |

Comandos que aguardam confirmação levam `requestId`; o servidor responde com `ack`, `ok` e eventual `message`. `welcome` retorna o identificador atribuído pelo servidor, a lista de participantes e estado da sala. O servidor deriva o remetente e os privilégios da conexão autenticada, ignorando um `from` enviado pelo cliente. Mensagens `signal` são encaminhadas apenas dentro da mesma sala.

O módulo WebRTC mantém um peer por participante, negocia ofertas concorrentes com o padrão perfect negotiation, acumula candidatos ICE que chegam antes da descrição remota e remove conexões/tracks ao sair.

## 8. Verificação realizada

- Sintaxe dos quatro scripts públicos e do servidor.
- Referências de arquivos, IDs e estrutura HTML.
- Integração do servidor com três clientes WebSocket: senhas, privilégios, chat, sinalização, transmissão exclusiva, bloqueio, remoção, retorno do host e encerramento.
- Fluxos de interface em DOM simulado, duas abas com BroadcastChannel, mensagens escapadas e descarte de tracks de mídia simuladas.
- Layout responsivo implementado; inspeção visual em navegador real não estava disponível neste ambiente.
- Permissões e dispositivos foram simulados nos testes. Uma transmissão real entre aparelhos, NAT/TURN e compatibilidade móvel ainda devem ser conferidos no ambiente de publicação. Isso não é um teste concluído de vídeo entre duas máquinas reais.
- Ferramentas WebMCP são opcionais, detectadas em tempo de execução. A API foi exercitada com adaptador; um navegador com WebMCP real não estava disponível.

### Conferência manual rápida

1. Inicie o servidor e crie uma sala privada.
2. Entre por outro perfil do navegador ou aparelho via HTTPS. Confira que senha errada é recusada.
3. Compartilhe uma janela e confirme que ela aparece no outro aparelho.
4. Teste microfone, câmera, áudio, chat e tela cheia.
5. No host, teste bloquear entradas, silenciar, remover e encerrar.

## Referências técnicas

- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation

Interface e código de aplicação criados para ANDRADE. A dependência `ws` conserva sua licença MIT no pacote original instalado pelo npm.
