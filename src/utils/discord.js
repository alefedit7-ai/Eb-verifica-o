'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('./embeds');
const log = require('./logger');

/** Timestamp dinâmico do Discord (aparece no fuso de quem lê). */
function ts(ms, formato = 'f') {
  if (!ms) return '—';
  return `<t:${Math.floor(Number(ms) / 1000)}:${formato}>`;
}

/** Responde de forma segura (reply / editReply / followUp conforme o estado), sempre privada. */
async function responder(interaction, conteudo) {
  const payload = typeof conteudo === 'string' ? { content: conteudo } : conteudo;
  try {
    if (interaction.deferred && !interaction.replied) return await interaction.editReply(payload);
    if (interaction.replied || interaction.deferred) return await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.aviso('Falha ao responder interação:', err.message);
    return null;
  }
}

async function adiar(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
}

function erroGenerico() {
  return {
    embeds: [embeds.erro('Ocorreu um erro', 'Não foi possível concluir a ação agora. Tente novamente em alguns instantes. Se persistir, avise a administração.')],
  };
}

module.exports = { ts, responder, adiar, erroGenerico };
