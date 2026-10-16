'use strict';

const { config, validarConfig } = require('./config');
const log = require('./utils/logger');

// 1) Valida as configurações obrigatórias ANTES de qualquer outra coisa.
const { erros, avisos } = validarConfig();
avisos.forEach((a) => log.aviso(a));
if (erros.length > 0) {
  console.error('\n❌ Configuração inválida:');
  erros.forEach((e) => console.error(`  • ${e}`));
  console.error('\nCorrija o arquivo .env (ou variables.env) e inicie novamente.\n');
  process.exit(1);
}

const { Client, Events, GatewayIntentBits } = require('discord.js');
const db = require('./database');
const commands = require('./commands');
const { aoInteragir, servidorPermitido } = require('./handlers/interaction');
const { garantirPainel } = require('./panel');
const { aplicarReconhecimento } = require('./services/verifyService');
const audit = require('./services/audit');

db.iniciar();
log.info(`Banco de dados pronto em: ${config.databasePath}`);

const intents = [GatewayIntentBits.Guilds];
if (config.useMembersIntent) intents.push(GatewayIntentBits.GuildMembers);
const client = new Client({ intents });

/** Cria a configuração do servidor principal a partir do .env, somente se ainda não existir no banco. */
function semearConfigInicial(c) {
  const b = config.bootstrap;
  if (!b.guildId) return;
  if (!c.guilds.cache.has(b.guildId)) {
    log.aviso('GUILD_ID_PRINCIPAL não é um servidor em que o bot está. Convide o bot ou corrija o ID.');
    return;
  }
  if (db.getGuildConfig(b.guildId)) {
    log.info('Servidor principal já está configurado no banco; variáveis iniciais ignoradas (use /configurar).');
    return;
  }
  db.salvarGuildConfig(b.guildId, {
    panelChannelId: b.panelChannelId || null,
    logChannelId: b.logChannelId || null,
    verifiedRoleId: b.verifiedRoleId || null,
    adminRoleIds: b.adminRoleIds,
    integrationActive: true,
  });
  log.info(`Servidor principal ${b.guildId} configurado a partir das variáveis iniciais.`);
}

async function registrarComandos(guild) {
  try {
    await guild.commands.set(commands.json());
  } catch (err) {
    log.erro(`Falha ao registrar comandos em ${guild.name} (${guild.id}):`, err.message);
  }
}

client.once(Events.ClientReady, async (c) => {
  log.info(`Online como ${c.user.tag} em ${c.guilds.cache.size} servidor(es).`);
  if (config.allowedGuildIds.length) log.info(`Lista de servidores permitidos ativa (${config.allowedGuildIds.length}).`);

  semearConfigInicial(c);

  for (const guild of c.guilds.cache.values()) {
    if (servidorPermitido(guild.id)) await registrarComandos(guild);
    else log.aviso(`Servidor fora da lista permitida (ignorado): ${guild.name} (${guild.id})`);
  }

  // Painel automático: publica (ou reaproveita) o painel de cada servidor configurado.
  for (const cfg of db.listGuildConfigs()) {
    if (!cfg.panelChannelId || !c.guilds.cache.has(cfg.guildId) || !servidorPermitido(cfg.guildId)) continue;
    const res = await garantirPainel(c, cfg.guildId);
    log.info(`Painel [${cfg.guildId}]: ${res.status}${res.motivo ? ` — ${res.motivo}` : ''}`);
    if (res.status !== 'publicado' && res.status !== 'atualizado') {
      await audit.registrar(c, {
        guildId: cfg.guildId,
        categoria: 'admin',
        tipo: 'painel',
        detalhes: `Falha ao publicar o painel na inicialização: ${res.status}`,
      });
    }
  }

  setInterval(() => {
    try {
      db.limparDesafiosExpirados();
    } catch (err) {
      log.aviso('Falha ao limpar códigos expirados:', err.message);
    }
  }, 5 * 60 * 1000).unref();

  log.info('Bot pronto. ✅');
});

client.on(Events.GuildCreate, async (guild) => {
  log.info(`Entrei no servidor ${guild.name} (${guild.id}).`);
  if (!servidorPermitido(guild.id)) {
    log.aviso(`Servidor ${guild.id} não está em ALLOWED_GUILD_IDS; interações serão recusadas.`);
    return;
  }
  await registrarComandos(guild);
});

if (config.useMembersIntent) {
  client.on(Events.GuildMemberAdd, async (membro) => {
    if (membro.user.bot || !servidorPermitido(membro.guild.id)) return;
    try {
      await aplicarReconhecimento(client, membro.guild, membro.id);
    } catch (err) {
      log.erro('Falha no reconhecimento automático:', err);
    }
  });
}

client.on(Events.InteractionCreate, aoInteragir);
client.on(Events.Error, (err) => log.erro('Erro do cliente Discord:', err));
client.on(Events.Warn, (msg) => log.aviso(msg));

process.on('unhandledRejection', (motivo) => log.erro('Promessa rejeitada sem tratamento:', motivo instanceof Error ? motivo : String(motivo)));
process.on('uncaughtException', (err) => {
  log.erro('Exceção não capturada:', err);
  db.fechar();
  process.exit(1);
});

function encerrar(sinal) {
  log.info(`${sinal} recebido. Encerrando...`);
  try {
    client.destroy();
  } catch {
    /* ignorado */
  }
  db.fechar();
  process.exit(0);
}
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));

client.login(config.token).catch((err) => {
  const msg = String(err && err.message ? err.message : err);
  if (/disallowed intents/i.test(msg)) {
    log.erro('Intent não permitido. Ligue "Server Members Intent" no Developer Portal ou defina USAR_INTENT_MEMBROS=false.');
  } else if (/invalid token|an invalid token/i.test(msg)) {
    log.erro('Token inválido. Gere um novo em Developer Portal > Bot > Reset Token e atualize o .env.');
  } else {
    log.erro('Falha ao conectar:', msg);
  }
  db.fechar();
  process.exit(1);
});
