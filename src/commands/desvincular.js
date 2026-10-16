'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const roles = require('../services/roles');
const audit = require('../services/audit');
const { exigirAutorizacao } = require('../permissions');
const embeds = require('../utils/embeds');
const { adiar, responder } = require('../utils/discord');

const data = new SlashCommandBuilder()
  .setName('desvincular')
  .setDescription('Remove a vinculação Discord ↔ Roblox de um membro (ação administrativa).')
  .setDMPermission(false)
  .addUserOption((o) => o.setName('usuario').setDescription('Membro que terá a vinculação removida.').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo da remoção (fica registrado).').setRequired(true).setMinLength(3).setMaxLength(200));

async function execute(interaction) {
  await adiar(interaction);
  const { guild, user, client } = interaction;
  if (!(await exigirAutorizacao(interaction, db.getGuildConfig(guild.id)))) return;

  const alvo = interaction.options.getUser('usuario', true);
  const motivo = interaction.options.getString('motivo', true).trim();

  const registro = db.getUser(alvo.id);
  if (!registro || registro.linkStatus !== 'vinculado') {
    return responder(interaction, { embeds: [embeds.info('Nada a remover', `<@${alvo.id}> não possui vinculação ativa.`)] });
  }

  // Descobre onde o membro estava verificado ANTES de apagar os registros.
  const guildsAfetadas = new Set(db.listarVerificacoes(alvo.id).map((v) => v.guildId));
  guildsAfetadas.add(guild.id);

  const anterior = db.removerVinculo(alvo.id);

  let removidos = 0;
  let falhas = 0;
  for (const guildId of guildsAfetadas) {
    const g = client.guilds.cache.get(guildId);
    const cfgG = db.getGuildConfig(guildId);
    if (!g || !cfgG) continue;
    const res = await roles.removerCargoVerificado(g, alvo.id, cfgG);
    if (res.motivo === 'removido') removidos += 1;
    else if (!res.ok && res.motivo !== 'membro_ausente' && res.motivo !== 'sem_cargo_configurado') falhas += 1;
  }

  await audit.registrar(client, {
    guildId: guild.id,
    categoria: 'admin',
    tipo: 'desvinculado',
    actorId: user.id,
    targetId: alvo.id,
    detalhes: `Roblox removido: ${anterior.robloxUsername} (${anterior.robloxId}). Motivo: ${motivo}. Cargos removidos: ${removidos}; falhas: ${falhas}.`,
  });

  const linhas = [
    `A vinculação de <@${alvo.id}> com **${anterior.robloxUsername}** foi removida e as verificações foram apagadas.`,
    `Cargos de verificado removidos: **${removidos}**.`,
  ];
  if (falhas) linhas.push(`⚠️ Não foi possível remover o cargo em **${falhas}** servidor(es) (permissão/hierarquia). Remova manualmente.`);
  linhas.push('', 'O membro poderá se vincular novamente pelo painel.');

  return responder(interaction, { embeds: [embeds.sucesso('Vinculação removida', linhas.join('\n'))] });
}

module.exports = { data, execute };
