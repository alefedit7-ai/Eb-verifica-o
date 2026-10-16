# Bot de Verificação — EB

Sistema de vinculação Discord ↔ Roblox com painel automático, banco central SQLite e comandos administrativos.

## 1. Instalação (local ou hospedagem)

1. Tenha **Node.js 20+** instalado.
2. Na pasta do projeto, rode: `npm install`
3. Copie `.env.example` para `.env` e preencha:
   - `DISCORD_TOKEN` — Developer Portal > seu app > Bot > Reset Token
   - `BOT_OWNER_IDS` — seu ID de usuário (Modo Desenvolvedor > Copiar ID)
4. Inicie: `npm start`
5. Verifique: `npm run check`

> No celular (Discloud/Sparked Host), crie o arquivo `variables.env` com o mesmo conteúdo, pois arquivos que começam com ponto costumam ser ocultados.

## 2. Permissões do bot

Ao convidar o bot, conceda: Ver Canal, Enviar Mensagens, Inserir Links, Ler Histórico de Mensagens, Usar Comandos de Aplicativo e **Gerenciar Cargos**. Coloque o cargo do bot **acima** do cargo de verificado.

Opcional: se usar `USAR_INTENT_MEMBROS=true`, ative **Server Members Intent** no Developer Portal.

## 3. Adicionar o bot a vários servidores

1. Developer Portal > OAuth2 > URL Generator > escopos `bot` e `applications.commands`.
2. Marque as permissões acima e convide o bot para cada servidor do EB.
3. Em cada servidor, um **dono do bot** executa `/configurar integracao ativa:true`. Sem isso, os botões não funcionam ali.

## 4. Configurar um servidor (pelo Discord)

1. `/configurar definir canal_painel:#verificacao canal_logs:#logs cargo_verificado:@Verificado`
2. `/configurar admin_adicionar cargo:@Comando` (repita para cada cargo administrativo)
3. `/configurar definir aceitar_outros_servidores:true` — reconhece verificações feitas em outros servidores autorizados.
4. Por padrão, a conta Roblox precisa pertencer a **pelo menos um** dos grupos listados em `ROBLOX_GROUP_IDS` (EB, BPE, CIE, BFE, BAC ou TDU). Não é necessário pertencer a todos.
5. `/configurar ver` para conferir a configuração do servidor. O comando antigo `grupo_roblox` continua disponível para compatibilidade, mas a lista global é definida no `.env` ou `variables.env`.

O painel é publicado automaticamente ao iniciar o bot e pode ser atualizado com `/painel`. Ele não é duplicado a cada reinício.

## 5. Regra de grupos Roblox

- `ROBLOX_GROUP_IDS=866282850,1042231911,728691851,245426392,1073002614,781548145` define os grupos aceitos.
- `ROBLOX_REQUIRE_ANY_GROUP=true` exige participação em pelo menos um grupo da lista.
- A consulta aos grupos é feita em uma chamada à API pública da Roblox. Se a API estiver indisponível, a verificação falha de forma segura e pode ser tentada novamente.
- Para desativar a exigência global, defina `ROBLOX_REQUIRE_ANY_GROUP=false`; nesse modo, as configurações antigas por servidor voltam a controlar a exigência.

## 6. Testar

1. Clique em **🔗 Vincular**, informe seu usuário Roblox e cole o código no perfil ("Sobre").
2. Clique em **✅ Já coloquei o código** e depois em **🛡️ Verificar**.
3. Confira com `/verificacao membro:@você`.
4. Teste a segurança: tente vincular uma conta já usada por outro Discord (deve ser recusado) e confira em `/logs`.

## 7. Hospedagem gratuita — limitações

- **Discloud (plano grátis):** RAM limitada (100 MB no `discloud.config`), sem garantia de uptime 24/7 e pode reiniciar. Bom para começar.
- **Sparked Host:** planos gratuitos/testes podem ter prazo ou recursos restritos; confira os termos atuais.
- **Qualquer host grátis:** o banco SQLite fica no disco do container. Se o container for recriado, os dados podem ser perdidos. Faça backup periodicamente (copie `data/eb-verificacao.sqlite`).
- **API da Roblox:** pode bloquear IPs de datacenter. Se ocorrer, defina `ROBLOX_USERS_API` e `ROBLOX_GROUPS_API` com proxies compatíveis.

## 8. Segurança

- Nunca pedimos senha nem cookie do Roblox. A prova de propriedade é o código no perfil.
- Não compartilhe o `.env`/`variables.env`.
- Registros em `/logs` não contêm tokens nem senhas.
