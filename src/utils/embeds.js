'use strict';

const { EmbedBuilder } = require('discord.js');
const { CORES, RODAPE } = require('../constants');

function base(cor, titulo, descricao) {
  const e = new EmbedBuilder().setColor(cor).setFooter({ text: RODAPE }).setTimestamp();
  if (titulo) e.setTitle(String(titulo).slice(0, 256));
  if (descricao) e.setDescription(String(descricao).slice(0, 4000));
  return e;
}

module.exports = {
  sucesso: (titulo, descricao) => base(CORES.verde, `✅ ${titulo}`, descricao),
  erro: (titulo, descricao) => base(CORES.vermelho, `⛔ ${titulo}`, descricao),
  aviso: (titulo, descricao) => base(CORES.dourado, `⚠️ ${titulo}`, descricao),
  info: (titulo, descricao) => base(CORES.dourado, `ℹ️ ${titulo}`, descricao),
  neutro: (titulo, descricao) => base(CORES.verde, titulo, descricao),
};
