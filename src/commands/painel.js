'use strict';

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const db = require('../database');
const audit = require('../services/audit');
const { exigirAutorizacao } = require('../permissions');
const { garantirPainel, descreverStatusPainel } = require('../panel');
const embeds = require('../utils/embeds');
const { adiar, responder } = require('../utils/discord');

const data = new SlashCommandBuilder()
  .setName('painel')
  .setDescription('Publica ou atualiza o painel de verificação deste servidor.')
  .setDMPermission(false)
  .addChannelOption((o) =>
    o
      .setName('canal')
      .setDescription('Canal do painel (opcional; se informado, passa a ser o canal configurado).')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  )
  .addBooleanOption((o) => o.setName('recriar').setDescription('Apagar o painel atual e enviar um novo.'));

async function execute(interaction) {
  await adiar(interaction);
  const { guild, user, client } = interaction;
  const cfgAtual = db.getGuildConfig(guild.id);
  if (!(await exigirAutorizacao(interaction, cfgAtual))) return;

  const canal = interaction.options.getChannel('canal');
  const recriar = interaction.options.getBoolean('recriar') || false;
  if (canal) db.salvarGuildConfig(guild.id, { panelChannelId: canal.id });

  const res = await garantirPainel(client, guild.id, { recriar });
  await audit.registrar(client, {
    guildId: guild.id,
    categoria: 'admin',
    tipo: 'painel',
    actorId: user.id,
    detalhes: `Resultado: ${res.status}${res.canalId ? ` em ${res.canalId}` : ''}${recriar ? ' (recriado)' : ''}`,
  });

  const ok = res.status === 'publicado' || res.status === 'atualizado';
  const linhas = [descreverStatusPainel(res)];
  const cfg = db.getGuildConfig(guild.id);
  if (ok && cfg && !cfg.integrationActive) {
    linhas.push('', '⚠️ A integração central está **inativa**: os botões só funcionam depois que um dono do bot usar `/configurar integracao ativa:true`.');
  }
  return responder(interaction, { embeds: [ok ? embeds.sucesso('Painel', linhas.join('\n')) : embeds.erro('Painel não publicado', linhas.join('\n'))] });
}

module.exports = { data, execute };
