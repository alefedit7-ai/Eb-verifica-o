'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const roles = require('../services/roles');
const audit = require('../services/audit');
const { aplicarReconhecimento } = require('../services/verifyService');
const { exigirAutorizacao } = require('../permissions');
const embeds = require('../utils/embeds');
const { adiar, responder, ts } = require('../utils/discord');

const data = new SlashCommandBuilder()
  .setName('verificacao')
  .setDescription('Mostra o estado de verificação de um membro neste servidor.')
  .setDMPermission(false)
  .addUserOption((o) => o.setName('membro').setDescription('Membro a verificar.').setRequired(true))
  .addBooleanOption((o) => o.setName('sincronizar').setDescription('Se estiver verificado (aqui ou em outro servidor autorizado), garante o cargo neste servidor.'));

const MOTIVOS = {
  integracao_inativa: 'a integração deste servidor está inativa',
  nao_aceita_outros: 'este servidor não aceita verificações de outros servidores',
  exige_grupo: 'este servidor exige grupo Roblox — o membro precisa clicar em Verificar',
  sem_vinculo: 'o membro não está vinculado',
  conflito: 'há conflito de identidade no cadastro',
  ja_verificado: 'já verificado neste servidor',
  sem_verificacao_externa: 'o membro não tem verificação em outro servidor autorizado',
};

async function execute(interaction) {
  await adiar(interaction);
  const { guild, user, client } = interaction;
  const cfg = db.getGuildConfig(guild.id);
  if (!(await exigirAutorizacao(interaction, cfg))) return;

  const alvo = interaction.options.getUser('membro', true);
  const sincronizar = interaction.options.getBoolean('sincronizar') || false;
  const extras = [];

  if (!cfg) {
    return responder(interaction, { embeds: [embeds.aviso('Servidor não configurado', 'Use `/configurar definir` primeiro.')] });
  }

  const registro = db.getUser(alvo.id);
  const vinculado = !!registro && registro.linkStatus === 'vinculado';

  if (sincronizar) {
    if (!vinculado) {
      extras.push('🔄 Sincronização não aplicada: o membro não está vinculado.');
    } else if (db.getVerificacao(alvo.id, guild.id)) {
      const res = await roles.concederCargoVerificado(guild, alvo.id, cfg);
      extras.push(`🔄 ${roles.descreverResultado(res)}`);
    } else {
      const rec = await aplicarReconhecimento(client, guild, alvo.id);
      extras.push(rec.aplicado ? `🔄 Verificação reconhecida de outro servidor. ${roles.descreverResultado(rec.cargo)}` : `🔄 Não foi possível sincronizar: ${MOTIVOS[rec.motivo] || rec.motivo}.`);
    }
    await audit.registrar(client, {
      guildId: guild.id,
      categoria: 'admin',
      tipo: 'sincronizado',
      actorId: user.id,
      targetId: alvo.id,
      detalhes: extras[extras.length - 1],
    });
  }

  const aqui = db.getVerificacao(alvo.id, guild.id);
  const outros = db.verificacoesEmOutrosServidores(alvo.id, guild.id);
  const membro = await guild.members.fetch({ user: alvo.id, force: true }).catch(() => null);
  const temCargo = membro && cfg.verifiedRoleId ? membro.roles.cache.has(cfg.verifiedRoleId) : null;

  const linhas = [
    `**Membro:** <@${alvo.id}> (\`${alvo.id}\`) ${membro ? '' : '— *não está neste servidor*'}`,
    `**Vinculado a Roblox:** ${vinculado ? `✅ ${registro.robloxUsername} (\`${registro.robloxId}\`)` : '❌ Não'}`,
    `**Verificado neste servidor:** ${aqui ? `✅ ${ts(aqui.verifiedAt, 'f')} (${aqui.method})` : '❌ Não'}`,
    `**Cargo de verificado:** ${cfg.verifiedRoleId ? (temCargo === null ? '—' : temCargo ? '✅ Possui' : '❌ Não possui') : '— (não configurado)'}`,
    `**Verificado em outros servidores autorizados:** ${outros.length ? `${outros.length}` : 'nenhum'}`,
  ];
  if (aqui && temCargo === false) linhas.push('', '💡 Verificado, mas sem o cargo. Use `sincronizar:true` para tentar conceder.');
  if (extras.length) linhas.push('', ...extras);

  return responder(interaction, { embeds: [embeds.neutro('🛡️ Estado de verificação', linhas.join('\n'))] });
}

module.exports = { data, execute };
