'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const roblox = require('../roblox');
const audit = require('../services/audit');
const { exigirAutorizacao } = require('../permissions');
const embeds = require('../utils/embeds');
const { adiar, responder, ts } = require('../utils/discord');

const data = new SlashCommandBuilder()
  .setName('consultar')
  .setDescription('Consulta o registro central de vinculação/verificação (por Discord ou Roblox).')
  .setDMPermission(false)
  .addUserOption((o) => o.setName('usuario').setDescription('Membro do Discord a consultar.'))
  .addStringOption((o) => o.setName('roblox').setDescription('Usuário ou ID da conta Roblox a consultar.').setMaxLength(100));

async function execute(interaction) {
  await adiar(interaction);
  const { guild, user, client } = interaction;
  if (!(await exigirAutorizacao(interaction, db.getGuildConfig(guild.id)))) return;

  const alvo = interaction.options.getUser('usuario');
  const textoRoblox = interaction.options.getString('roblox');
  if (!alvo && !textoRoblox) {
    return responder(interaction, { embeds: [embeds.aviso('Informe um alvo', 'Use a opção `usuario` (Discord) **ou** `roblox` (usuário/ID).')] });
  }

  let registro = null;
  let contaRoblox = null;

  if (alvo) {
    registro = db.getUser(alvo.id);
  } else {
    try {
      contaRoblox = await roblox.resolverUsuario(textoRoblox);
    } catch {
      return responder(interaction, { embeds: [embeds.erro('Roblox indisponível', 'Não consegui consultar a Roblox agora. Tente novamente.')] });
    }
    if (!contaRoblox) {
      return responder(interaction, { embeds: [embeds.aviso('Conta não encontrada', 'Não encontrei essa conta Roblox.')] });
    }
    registro = db.getUserByRoblox(contaRoblox.id);
  }

  await audit.registrar(client, {
    guildId: guild.id,
    categoria: 'admin',
    tipo: 'consulta',
    actorId: user.id,
    targetId: alvo ? alvo.id : registro ? registro.discordId : null,
    detalhes: alvo ? 'Consulta por Discord' : `Consulta por Roblox: ${contaRoblox.nome} (${contaRoblox.id})`,
  });

  if (!registro) {
    const texto = contaRoblox
      ? `A conta Roblox **[${contaRoblox.nome}](${roblox.linkPerfil(contaRoblox.id)})** existe, mas **não está vinculada** a nenhum Discord.`
      : `<@${alvo.id}> não possui registro no banco central.`;
    return responder(interaction, { embeds: [embeds.info('Sem registro', texto)] });
  }

  const vinculado = registro.linkStatus === 'vinculado';
  const verificacoes = db.listarVerificacoes(registro.discordId);
  const listaServidores = verificacoes.length
    ? verificacoes
        .map((v) => {
          const g = client.guilds.cache.get(v.guildId);
          return `• **${g ? g.name : `Servidor ${v.guildId}`}** — ${ts(v.verifiedAt, 'f')} (${v.method})`;
        })
        .join('\n')
    : '—';
  const historico = db
    .listarAuditoria({ targetId: registro.discordId, limite: 5 })
    .map((h) => `• ${ts(h.criadoEm, 'd')} \`${h.tipo}\``)
    .join('\n');

  const linhas = [
    `**Discord:** <@${registro.discordId}> (\`${registro.discordId}\`)`,
    `**Roblox:** ${vinculado ? `[${registro.robloxUsername}](${roblox.linkPerfil(registro.robloxId)}) (\`${registro.robloxId}\`)` : '—'}`,
    `**Vinculação:** ${vinculado ? '✅ Vinculado' : '❌ Desvinculado'}${registro.linkedAt && vinculado ? ` desde ${ts(registro.linkedAt, 'f')}` : ''}`,
    `**Verificação:** ${registro.verificationStatus === 'verificado' ? '✅ Verificado' : '❌ Não verificado'}${registro.verifiedAt ? ` (última em ${ts(registro.verifiedAt, 'f')})` : ''}`,
    '',
    '**Servidores em que foi verificado:**',
    listaServidores,
  ];
  if (historico) linhas.push('', '**Últimos eventos:**', historico);

  return responder(interaction, { embeds: [embeds.neutro('🔎 Registro central', linhas.join('\n'))] });
}

module.exports = { data, execute };
