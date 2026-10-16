'use strict';

const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { config } = require('./config');
const embeds = require('./utils/embeds');
const audit = require('./services/audit');
const { responder } = require('./utils/discord');

function ehDono(userId) {
  return config.ownerIds.includes(userId);
}

function permissoesDoMembro(membro) {
  if (!membro || membro.permissions == null) return null;
  if (typeof membro.permissions === 'string') return new PermissionsBitField(BigInt(membro.permissions));
  return membro.permissions;
}

function idsDeCargos(membro) {
  if (!membro || !membro.roles) return [];
  if (Array.isArray(membro.roles)) return membro.roles;
  if (membro.roles.cache) return [...membro.roles.cache.keys()];
  return [];
}

/**
 * Autorizado = dono do bot, OU administrador do servidor, OU possui um cargo administrativo configurado.
 */
function ehAutorizado(interaction, guildConfig) {
  if (ehDono(interaction.user.id)) return true;
  const perms = permissoesDoMembro(interaction.member);
  if (perms && perms.has(PermissionFlagsBits.Administrator)) return true;
  const permitidos = guildConfig ? guildConfig.adminRoleIds : [];
  if (permitidos.length === 0) return false;
  const meus = idsDeCargos(interaction.member);
  return meus.some((id) => permitidos.includes(id));
}

/** Retorna true se autorizado; caso contrário responde com negativa, registra tentativa e retorna false. */
async function exigirAutorizacao(interaction, guildConfig) {
  if (ehAutorizado(interaction, guildConfig)) return true;
  await responder(interaction, {
    embeds: [embeds.erro('Sem permissão', 'Este comando é restrito à administração autorizada do servidor.')],
  });
  await audit.registrar(interaction.client, {
    guildId: interaction.guildId,
    categoria: 'seguranca',
    tipo: 'comando_negado',
    actorId: interaction.user.id,
    detalhes: `/${interaction.commandName || 'comando'}`,
  });
  return false;
}

async function exigirDono(interaction) {
  if (ehDono(interaction.user.id)) return true;
  await responder(interaction, {
    embeds: [embeds.erro('Apenas donos do bot', 'Esta ação só pode ser feita por quem está em BOT_OWNER_IDS.')],
  });
  await audit.registrar(interaction.client, {
    guildId: interaction.guildId,
    categoria: 'seguranca',
    tipo: 'comando_negado',
    actorId: interaction.user.id,
    detalhes: `/${interaction.commandName || 'comando'} (exige dono)`,
  });
  return false;
}

module.exports = { ehDono, ehAutorizado, exigirAutorizacao, exigirDono };
