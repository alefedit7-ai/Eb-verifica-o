'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('./database');
const log = require('./utils/logger');
const { IDS, CORES, RODAPE } = require('./constants');

const ESC = '\u001b';

function montarPainel(guild) {
  const embed = new EmbedBuilder()
    .setColor(CORES.verde)
    .setTitle('🛡️ SISTEMA DE VERIFICAÇÃO — EB')
    .setDescription(
      [
        '```ansi',
        `${ESC}[1;33m★  EXÉRCITO BRASILEIRO  ★${ESC}[0m`,
        `${ESC}[0;33m  Identificação e verificação de membros${ESC}[0m`,
        '```',
        'Seja bem-vindo(a) ao sistema oficial de verificação do **Exército Brasileiro**.',
        'Para ter acesso aos servidores e grupos do EB, você precisa **vincular** sua conta Roblox ao seu Discord e, depois, **verificar-se**.',
      ].join('\n'),
    )
    .addFields(
      {
        name: '🔗 Passo 1 — Vincular',
        value:
          'Clique em **Vincular**, informe seu **usuário ou ID do Roblox** e confirme que a conta é sua colocando um **código temporário** na descrição ("Sobre") do seu perfil Roblox.',
      },
      {
        name: '🛡️ Passo 2 — Verificar',
        value:
          'Com a conta vinculada, clique em **Verificar**. O sistema confere seu cadastro no banco central, registra a verificação e concede o **cargo de verificado** deste servidor.',
      },
      {
        name: '🔒 Segurança',
        value:
          'Nunca pedimos sua **senha** nem seu **cookie** do Roblox. Desconfie de qualquer pessoa que peça esses dados. Sua vinculação vale em todos os servidores autorizados do EB.',
      },
    )
    .setFooter({ text: `${RODAPE} • ${guild.name}` });

  const linha = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(IDS.VINCULAR).setLabel('Vincular').setEmoji('🔗').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(IDS.VERIFICAR).setLabel('Verificar').setEmoji('🛡️').setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [linha] };
}

function ehMensagemDoPainel(mensagem) {
  if (!mensagem.author || mensagem.author.id !== mensagem.client.user.id) return false;
  return (mensagem.components || []).some((linha) => (linha.components || []).some((c) => c.customId === IDS.VINCULAR));
}

/**
 * Garante que exista UM painel no canal configurado (sem duplicar a cada reinício).
 * Estratégia: reutiliza a mensagem guardada no banco; se sumiu, procura nas últimas 50 mensagens
 * por um painel do próprio bot; só envia um novo se não achar nenhum. Painéis duplicados são apagados.
 *
 * @returns {Promise<{status: 'publicado'|'atualizado'|'sem_canal'|'canal_invalido'|'sem_permissao'|'erro', canalId?: string, mensagemId?: string, motivo?: string}>}
 */
async function garantirPainel(client, guildId, { recriar = false } = {}) {
  try {
    const cfg = db.getGuildConfig(guildId);
    if (!cfg || !cfg.panelChannelId) return { status: 'sem_canal' };

    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return { status: 'erro', motivo: 'O bot não está neste servidor.' };

    const canal = await guild.channels.fetch(cfg.panelChannelId).catch(() => null);
    if (!canal || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(canal.type)) {
      return { status: 'canal_invalido' };
    }

    const eu = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    const perms = eu ? canal.permissionsFor(eu) : null;
    const necessarias = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
    ];
    if (!perms || !perms.has(necessarias)) return { status: 'sem_permissao', canalId: canal.id };

    // Painel antigo em outro canal (canal foi trocado): apaga para não ficar órfão.
    if (cfg.panelMessageId && cfg.panelMessageChannelId && cfg.panelMessageChannelId !== canal.id) {
      const antigo = await guild.channels.fetch(cfg.panelMessageChannelId).catch(() => null);
      if (antigo && antigo.messages) await antigo.messages.delete(cfg.panelMessageId).catch(() => {});
    }

    const recentes = await canal.messages.fetch({ limit: 50 }).catch(() => null);
    const paineis = recentes ? [...recentes.values()].filter(ehMensagemDoPainel) : [];
    const idGuardado = cfg.panelMessageChannelId === canal.id ? cfg.panelMessageId : null;

    let alvo = null;
    if (!recriar) {
      alvo = paineis.find((m) => m.id === idGuardado) || paineis[0] || null;
      if (!alvo && idGuardado) alvo = await canal.messages.fetch(idGuardado).catch(() => null);
    }
    for (const m of paineis) {
      if (!alvo || m.id !== alvo.id) await m.delete().catch(() => {});
    }

    const conteudo = montarPainel(guild);
    let mensagem = null;
    let status = 'publicado';
    if (alvo) {
      try {
        mensagem = await alvo.edit(conteudo);
        status = 'atualizado';
      } catch {
        mensagem = null;
      }
    }
    if (!mensagem) {
      mensagem = await canal.send(conteudo);
      status = 'publicado';
    }

    db.salvarGuildConfig(guildId, { panelMessageId: mensagem.id, panelMessageChannelId: canal.id });
    return { status, canalId: canal.id, mensagemId: mensagem.id };
  } catch (err) {
    log.erro(`Falha ao garantir painel no servidor ${guildId}:`, err);
    return { status: 'erro', motivo: err.message };
  }
}

function descreverStatusPainel(res) {
  switch (res.status) {
    case 'publicado':
      return `Painel publicado em <#${res.canalId}>.`;
    case 'atualizado':
      return `Painel já existia e foi atualizado em <#${res.canalId}> (sem duplicar).`;
    case 'sem_canal':
      return 'Nenhum canal de painel configurado. Use `/configurar definir canal_painel:#canal`.';
    case 'canal_invalido':
      return 'O canal de painel configurado não existe ou não é um canal de texto. Use `/configurar definir canal_painel:#canal`.';
    case 'sem_permissao':
      return `Faltam permissões do bot em <#${res.canalId}>: Ver Canal, Enviar Mensagens, Inserir Links e Ler Histórico.`;
    default:
      return `Erro ao publicar o painel${res.motivo ? `: ${res.motivo}` : ''}.`;
  }
}

module.exports = { montarPainel, garantirPainel, descreverStatusPainel };
