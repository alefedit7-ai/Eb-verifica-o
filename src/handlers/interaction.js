'use strict';

const { MessageFlags } = require('discord.js');
const { config } = require('../config');
const commands = require('../commands');
const link = require('../services/linkService');
const verify = require('../services/verifyService');
const audit = require('../services/audit');
const embeds = require('../utils/embeds');
const log = require('../utils/logger');
const { responder, erroGenerico } = require('../utils/discord');
const { IDS } = require('../constants');

function servidorPermitido(guildId) {
  return config.allowedGuildIds.length === 0 || config.allowedGuildIds.includes(guildId);
}

async function aoInteragir(interaction) {
  try {
    if (!interaction.inGuild()) {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'Use este recurso dentro de um servidor.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (!servidorPermitido(interaction.guildId)) {
      await audit.registrar(interaction.client, {
        guildId: interaction.guildId,
        categoria: 'seguranca',
        tipo: 'servidor_nao_autorizado',
        actorId: interaction.user.id,
        detalhes: 'Interação recebida de servidor fora de ALLOWED_GUILD_IDS.',
      });
      if (interaction.isRepliable()) {
        await interaction.reply({
          embeds: [embeds.erro('Servidor não autorizado', 'Este servidor não faz parte da lista de servidores autorizados do sistema de verificação do EB.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (!interaction.guild) {
      await responder(interaction, erroGenerico());
      return;
    }

    if (interaction.isChatInputCommand()) {
      const comando = commands.mapa.get(interaction.commandName);
      if (!comando) return;
      await comando.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      switch (interaction.customId) {
        case IDS.VINCULAR:
          await link.abrirFormulario(interaction);
          return;
        case IDS.CONFIRMAR_VINCULO:
          await link.confirmarVinculo(interaction);
          return;
        case IDS.VERIFICAR:
          await verify.executarVerificacao(interaction);
          return;
        default:
          return;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === IDS.MODAL_VINCULAR) {
      await link.receberFormulario(interaction);
    }
  } catch (err) {
    log.erro(`Erro ao tratar interação (${interaction.commandName || interaction.customId || interaction.type}):`, err);
    await responder(interaction, erroGenerico());
  }
}

module.exports = { aoInteragir, servidorPermitido };
