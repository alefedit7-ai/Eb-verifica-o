'use strict';

const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const audit = require('../services/audit');
const { exigirAutorizacao, exigirDono } = require('../permissions');
const { garantirPainel, descreverStatusPainel } = require('../panel');
const embeds = require('../utils/embeds');
const { adiar, responder } = require('../utils/discord');
const { config } = require('../config');

const CANAIS_TEXTO = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const data = new SlashCommandBuilder()
  .setName('configurar')
  .setDescription('Configura este servidor no sistema de verificação do EB.')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('definir')
      .setDescription('Define canais, cargo de verificado e regras deste servidor.')
      .addChannelOption((o) => o.setName('canal_painel').setDescription('Canal onde o painel de verificação será publicado.').addChannelTypes(...CANAIS_TEXTO))
      .addChannelOption((o) => o.setName('canal_logs').setDescription('Canal onde os logs de verificação serão enviados.').addChannelTypes(...CANAIS_TEXTO))
      .addRoleOption((o) => o.setName('cargo_verificado').setDescription('Cargo concedido a quem for verificado.'))
      .addBooleanOption((o) => o.setName('aceitar_outros_servidores').setDescription('Reconhecer verificações feitas em outros servidores autorizados do EB.'))
      .addStringOption((o) => o.setName('grupo_roblox').setDescription('ID do grupo Roblox do EB (use 0 para remover).').setMaxLength(15))
      .addBooleanOption((o) => o.setName('exigir_grupo').setDescription('Exigir que o membro esteja no grupo Roblox para ser verificado.')),
  )
  .addSubcommand((s) =>
    s
      .setName('admin_adicionar')
      .setDescription('Autoriza um cargo a usar os comandos administrativos.')
      .addRoleOption((o) => o.setName('cargo').setDescription('Cargo a autorizar.').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('admin_remover')
      .setDescription('Remove a autorização de um cargo administrativo.')
      .addRoleOption((o) => o.setName('cargo').setDescription('Cargo a remover.').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('integracao')
      .setDescription('(Donos do bot) Autoriza ou desativa este servidor no sistema central.')
      .addBooleanOption((o) => o.setName('ativa').setDescription('true = autorizado/ativo, false = desativado.').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('ver').setDescription('Mostra a configuração atual deste servidor.'));

function sim(v) {
  return v ? '✅ Sim' : '❌ Não';
}

function resumo(cfg) {
  if (!cfg) return 'Este servidor ainda não foi configurado.';
  const admins = cfg.adminRoleIds.length ? cfg.adminRoleIds.map((id) => `<@&${id}>`).join(', ') : '— (somente Administradores do servidor e donos do bot)';
  return [
    `**Integração central:** ${cfg.integrationActive ? '✅ Ativa' : '❌ Inativa (um dono do bot precisa usar `/configurar integracao`)'}`,
    `**Canal do painel:** ${cfg.panelChannelId ? `<#${cfg.panelChannelId}>` : '—'}`,
    `**Canal de logs:** ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : '—'}`,
    `**Cargo de verificado:** ${cfg.verifiedRoleId ? `<@&${cfg.verifiedRoleId}>` : '—'}`,
    `**Cargos administrativos:** ${admins}`,
    `**Aceita verificações de outros servidores:** ${sim(cfg.acceptForeign)}`,
    `**Grupo Roblox:** ${cfg.robloxGroupId ? `\`${cfg.robloxGroupId}\`` : '—'}`,
    `**Regra global de grupos Roblox:** ${config.roblox.requireAnyGroup ? 'Exige pelo menos um grupo da lista global' : 'Desativada'}`,
    `**Grupos Roblox aceitos:** ${config.roblox.groupIds.length ? config.roblox.groupIds.map((id) => `\`${id}\``).join(', ') : '—'}`,
    `**Exige grupo legado por servidor:** ${sim(cfg.requireGroup)}`, 
    `**ID do servidor:** \`${cfg.guildId}\``,
  ].join('\n');
}

async function execute(interaction) {
  await adiar(interaction);
  const { guild, user, client } = interaction;
  const sub = interaction.options.getSubcommand();
  const cfgAtual = db.getGuildConfig(guild.id);

  if (!(await exigirAutorizacao(interaction, cfgAtual))) return;

  /* ---------------------------- ver ---------------------------- */
  if (sub === 'ver') {
    return responder(interaction, { embeds: [embeds.neutro('⚙️ Configuração do servidor', resumo(cfgAtual))] });
  }

  /* ------------------------- integracao ------------------------- */
  if (sub === 'integracao') {
    if (!(await exigirDono(interaction))) return;
    const ativa = interaction.options.getBoolean('ativa', true);
    const cfg = db.salvarGuildConfig(guild.id, { integrationActive: ativa });
    await audit.registrar(client, {
      guildId: guild.id,
      categoria: 'admin',
      tipo: 'config_alterada',
      actorId: user.id,
      detalhes: `Integração central ${ativa ? 'ATIVADA' : 'DESATIVADA'} para este servidor.`,
    });
    return responder(interaction, { embeds: [embeds.sucesso('Integração atualizada', resumo(cfg))] });
  }

  /* ----------------------- admin_adicionar ---------------------- */
  if (sub === 'admin_adicionar' || sub === 'admin_remover') {
    const cargo = interaction.options.getRole('cargo', true);
    if (cargo.id === guild.id) {
      return responder(interaction, { embeds: [embeds.erro('Cargo inválido', 'O cargo @everyone não pode ser administrativo.')] });
    }
    const lista = new Set(cfgAtual ? cfgAtual.adminRoleIds : []);
    if (sub === 'admin_adicionar') lista.add(cargo.id);
    else lista.delete(cargo.id);
    const cfg = db.salvarGuildConfig(guild.id, { adminRoleIds: [...lista] });
    await audit.registrar(client, {
      guildId: guild.id,
      categoria: 'admin',
      tipo: 'config_alterada',
      actorId: user.id,
      detalhes: `Cargo administrativo ${sub === 'admin_adicionar' ? 'adicionado' : 'removido'}: ${cargo.name} (${cargo.id}).`,
    });
    return responder(interaction, { embeds: [embeds.sucesso('Cargos administrativos atualizados', resumo(cfg))] });
  }

  /* --------------------------- definir -------------------------- */
  const opt = interaction.options;
  const canalPainel = opt.getChannel('canal_painel');
  const canalLogs = opt.getChannel('canal_logs');
  const cargoVerificado = opt.getRole('cargo_verificado');
  const aceitar = opt.getBoolean('aceitar_outros_servidores');
  const grupoBruto = opt.getString('grupo_roblox');
  const exigirGrupo = opt.getBoolean('exigir_grupo');

  const patch = {};
  const alteracoes = [];
  const avisos = [];

  if (canalPainel) {
    patch.panelChannelId = canalPainel.id;
    alteracoes.push(`canal do painel → ${canalPainel.id}`);
  }
  if (canalLogs) {
    patch.logChannelId = canalLogs.id;
    alteracoes.push(`canal de logs → ${canalLogs.id}`);
    const real = guild.channels.cache.get(canalLogs.id);
    const eu = guild.members.me;
    if (real && eu) {
      const p = real.permissionsFor(eu);
      if (!p || !p.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        avisos.push(`O bot não tem permissão para enviar embeds em <#${canalLogs.id}>. Conceda Ver Canal, Enviar Mensagens e Inserir Links.`);
      }
    }
  }
  if (cargoVerificado) {
    if (cargoVerificado.id === guild.id) {
      return responder(interaction, { embeds: [embeds.erro('Cargo inválido', 'O cargo @everyone não pode ser o cargo de verificado.')] });
    }
    patch.verifiedRoleId = cargoVerificado.id;
    alteracoes.push(`cargo de verificado → ${cargoVerificado.id}`);
    const real = guild.roles.cache.get(cargoVerificado.id);
    if (real && !real.editable) {
      avisos.push(`O bot **não consegue conceder** <@&${cargoVerificado.id}> (permissão "Gerenciar Cargos" ausente ou cargo acima do cargo do bot). Arraste o cargo do bot para CIMA dele em Configurações do Servidor → Cargos.`);
    }
  }
  if (aceitar !== null) {
    patch.acceptForeign = aceitar;
    alteracoes.push(`aceitar outros servidores → ${aceitar}`);
  }
  if (grupoBruto !== null) {
    const limpo = grupoBruto.trim();
    if (['0', 'nenhum', 'remover'].includes(limpo.toLowerCase())) {
      patch.robloxGroupId = null;
      patch.requireGroup = false;
      alteracoes.push('grupo Roblox removido');
    } else if (/^\d{1,12}$/.test(limpo)) {
      patch.robloxGroupId = limpo;
      alteracoes.push(`grupo Roblox → ${limpo}`);
    } else {
      return responder(interaction, { embeds: [embeds.erro('ID de grupo inválido', 'Informe apenas números (ex.: `1234567`) ou `0` para remover.')] });
    }
  }
  if (exigirGrupo !== null) {
    const grupoFinal = 'robloxGroupId' in patch ? patch.robloxGroupId : cfgAtual && cfgAtual.robloxGroupId;
    if (exigirGrupo && !grupoFinal) {
      return responder(interaction, { embeds: [embeds.erro('Falta o grupo', 'Para exigir grupo, informe também `grupo_roblox` com o ID do grupo.')] });
    }
    patch.requireGroup = exigirGrupo;
    alteracoes.push(`exigir grupo → ${exigirGrupo}`);
  }

  if (alteracoes.length === 0) {
    return responder(interaction, {
      embeds: [embeds.aviso('Nada para alterar', 'Informe ao menos uma opção. Exemplo: `/configurar definir canal_painel:#verificacao canal_logs:#logs cargo_verificado:@Verificado`.')],
    });
  }

  const cfg = db.salvarGuildConfig(guild.id, patch);
  await audit.registrar(client, {
    guildId: guild.id,
    categoria: 'admin',
    tipo: 'config_alterada',
    actorId: user.id,
    detalhes: alteracoes.join('; '),
  });

  const partes = [resumo(cfg)];
  if (canalPainel) {
    const res = await garantirPainel(client, guild.id);
    partes.push('', `📌 ${descreverStatusPainel(res)}`);
  }
  if (!cfg.integrationActive) {
    avisos.push('A integração central deste servidor está **inativa**: os botões só funcionam depois que um dono do bot usar `/configurar integracao ativa:true`.');
  }
  if (avisos.length) partes.push('', ...avisos.map((a) => `⚠️ ${a}`));

  return responder(interaction, { embeds: [embeds.sucesso('Configuração salva', partes.join('\n'))] });
}

module.exports = { data, execute };
