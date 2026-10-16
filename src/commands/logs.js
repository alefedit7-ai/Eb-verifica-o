'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const audit = require('../services/audit');
const { exigirAutorizacao, exigirDono } = require('../permissions');
const embeds = require('../utils/embeds');
const { adiar, responder, ts } = require('../utils/discord');

const data = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('Consulta os registros de auditoria deste servidor.')
  .setDMPermission(false)
  .addStringOption((o) =>
    o
      .setName('tipo')
      .setDescription('Filtrar por categoria.')
      .addChoices(
        { name: 'Vinculações', value: 'vinculacao' },
        { name: 'Verificações', value: 'verificacao' },
        { name: 'Ações administrativas', value: 'admin' },
        { name: 'Segurança / tentativas inválidas', value: 'seguranca' },
      ),
  )
  .addUserOption((o) => o.setName('usuario').setDescription('Filtrar por membro (alvo do registro).'))
  .addIntegerOption((o) => o.setName('quantidade').setDescription('Quantos registros mostrar (1–20, padrão 10).').setMinValue(1).setMaxValue(20))
  .addBooleanOption((o) => o.setName('global').setDescription('(Donos do bot) Incluir todos os servidores.'));

async function execute(interaction) {
  await adiar(interaction);
  const { guild, user, client } = interaction;
  if (!(await exigirAutorizacao(interaction, db.getGuildConfig(guild.id)))) return;

  const global = interaction.options.getBoolean('global') || false;
  if (global && !(await exigirDono(interaction))) return;

  const categoria = interaction.options.getString('tipo');
  const alvo = interaction.options.getUser('usuario');
  const limite = interaction.options.getInteger('quantidade') || 10;

  const registros = db.listarAuditoria({
    guildId: global ? null : guild.id,
    categoria,
    targetId: alvo ? alvo.id : null,
    limite,
  });

  await audit.registrar(client, {
    guildId: guild.id,
    categoria: 'admin',
    tipo: 'consulta',
    actorId: user.id,
    detalhes: `/logs ${categoria || 'todos'}${alvo ? ` usuario=${alvo.id}` : ''}${global ? ' global' : ''}`,
  });

  if (registros.length === 0) {
    return responder(interaction, { embeds: [embeds.info('Sem registros', 'Nenhum registro encontrado com esses filtros.')] });
  }

  const linhas = [];
  let tamanho = 0;
  for (const r of registros) {
    const titulo = audit.TITULOS[r.tipo] || r.tipo;
    const partes = [`${ts(r.criadoEm, 'f')} — **${titulo}**`];
    const quem = [r.actorId ? `por <@${r.actorId}>` : null, r.targetId && r.targetId !== r.actorId ? `alvo <@${r.targetId}>` : null].filter(Boolean).join(' • ');
    if (quem) partes.push(quem);
    if (r.detalhes) partes.push(`> ${String(r.detalhes).replace(/\n/g, ' ').slice(0, 160)}`);
    if (global && r.guildId) partes.push(`servidor \`${r.guildId}\``);
    const bloco = partes.join('\n');
    if (tamanho + bloco.length > 3800) break;
    tamanho += bloco.length + 2;
    linhas.push(bloco);
  }

  return responder(interaction, {
    embeds: [embeds.neutro(`📜 Últimos registros (${linhas.length})`, linhas.join('\n\n'))],
    allowedMentions: { parse: [] },
  });
}

module.exports = { data, execute };
