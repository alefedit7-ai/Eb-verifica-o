'use strict';

const { PermissionFlagsBits } = require('discord.js');
const log = require('../utils/logger');

async function obterCargo(guild, roleId) {
  if (!roleId) return null;
  return guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
}

async function obterEu(guild) {
  return guild.members.me || (await guild.members.fetchMe().catch(() => null));
}

/**
 * Concede o cargo de verificado configurado no servidor, se o bot tiver permissão.
 * @returns {Promise<{ok: boolean, motivo: string, cargo?: object}>}
 */
async function concederCargoVerificado(guild, userId, cfg) {
  if (!cfg || !cfg.verifiedRoleId) return { ok: false, motivo: 'sem_cargo_configurado' };
  const cargo = await obterCargo(guild, cfg.verifiedRoleId);
  if (!cargo) return { ok: false, motivo: 'cargo_inexistente' };

  const eu = await obterEu(guild);
  if (!eu || !eu.permissions.has(PermissionFlagsBits.ManageRoles) || !cargo.editable) {
    return { ok: false, motivo: 'sem_permissao', cargo };
  }

  const membro = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  if (!membro) return { ok: false, motivo: 'membro_ausente', cargo };
  if (membro.roles.cache.has(cargo.id)) return { ok: true, motivo: 'ja_possuia', cargo };

  try {
    await membro.roles.add(cargo, 'Verificação EB');
    return { ok: true, motivo: 'concedido', cargo };
  } catch (err) {
    log.aviso(`Não foi possível conceder cargo em ${guild.id}:`, err.message);
    return { ok: false, motivo: 'erro', cargo };
  }
}

/** Remove o cargo de verificado (usado ao desvincular). Falhas são toleradas. */
async function removerCargoVerificado(guild, userId, cfg) {
  if (!cfg || !cfg.verifiedRoleId) return { ok: false, motivo: 'sem_cargo_configurado' };
  const cargo = await obterCargo(guild, cfg.verifiedRoleId);
  if (!cargo) return { ok: false, motivo: 'cargo_inexistente' };
  const eu = await obterEu(guild);
  if (!eu || !eu.permissions.has(PermissionFlagsBits.ManageRoles) || !cargo.editable) return { ok: false, motivo: 'sem_permissao' };
  const membro = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  if (!membro) return { ok: false, motivo: 'membro_ausente' };
  if (!membro.roles.cache.has(cargo.id)) return { ok: true, motivo: 'nao_possuia' };
  try {
    await membro.roles.remove(cargo, 'Desvinculação EB');
    return { ok: true, motivo: 'removido' };
  } catch (err) {
    log.aviso(`Não foi possível remover cargo em ${guild.id}:`, err.message);
    return { ok: false, motivo: 'erro' };
  }
}

/** Texto amigável para o membro sobre o resultado da concessão do cargo. */
function descreverResultado(res) {
  switch (res.motivo) {
    case 'concedido':
      return `🎖️ Cargo <@&${res.cargo.id}> concedido com sucesso.`;
    case 'ja_possuia':
      return `🎖️ Você já possui o cargo <@&${res.cargo.id}>.`;
    case 'sem_cargo_configurado':
      return '⚠️ Este servidor ainda não tem um cargo de verificado configurado. Sua verificação foi registrada, mas nenhum cargo foi concedido — avise a administração.';
    default:
      return '⚠️ Sua verificação foi registrada, mas o bot não conseguiu conceder o cargo (permissão ou hierarquia de cargos). Avise a administração.';
  }
}

module.exports = { concederCargoVerificado, removerCargoVerificado, descreverResultado };
