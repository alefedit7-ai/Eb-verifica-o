'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('../database');
const log = require('../utils/logger');
const { CORES, RODAPE } = require('../constants');

const TITULOS = {
  vinculo_iniciado: '🔗 Vinculação iniciada',
  vinculado: '✅ Vinculação concluída',
  vinculo_invalido: '⚠️ Tentativa de vinculação inválida',
  vinculo_conflito: '⛔ Conflito de identidade',
  codigo_incorreto: '⚠️ Código não encontrado no perfil',
  codigo_bloqueado: '⛔ Limite de tentativas do código atingido',
  verificado: '🛡️ Verificação concluída',
  verificado_reconhecido: '🛡️ Verificação reconhecida de outro servidor',
  verificacao_sem_vinculo: '⚠️ Verificação sem vinculação',
  verificacao_negada: '⛔ Verificação negada',
  limite_tentativas: '⏳ Limite de tentativas atingido',
  desvinculado: '🔓 Vinculação removida',
  config_alterada: '⚙️ Configuração alterada',
  painel: '📌 Painel publicado/atualizado',
  comando_negado: '⛔ Comando administrativo negado',
  consulta: '🔎 Consulta administrativa',
  sincronizado: '🔄 Cargo sincronizado',
  servidor_nao_autorizado: '⛔ Servidor não autorizado',
};

const COR_POR_CATEGORIA = {
  vinculacao: CORES.verde,
  verificacao: CORES.verde,
  admin: CORES.dourado,
  seguranca: CORES.vermelho,
};

/**
 * Grava no banco central e, se houver, envia ao canal de logs do servidor.
 * Nunca registre senhas, cookies ou tokens aqui.
 */
async function registrar(client, { guildId = null, categoria, tipo, actorId = null, targetId = null, detalhes = null }) {
  try {
    db.registrarAuditoria({ guildId, categoria, tipo, actorId, targetId, detalhes });
  } catch (err) {
    log.erro('Falha ao gravar auditoria:', err);
  }

  if (!guildId) return;
  try {
    const cfg = db.getGuildConfig(guildId);
    if (!cfg || !cfg.logChannelId) return;
    const canal = await client.channels.fetch(cfg.logChannelId).catch(() => null);
    if (!canal || !canal.isTextBased() || canal.guildId !== guildId) return;

    const linhas = [];
    if (actorId) linhas.push(`**Autor:** <@${actorId}> (\`${actorId}\`)`);
    if (targetId && targetId !== actorId) linhas.push(`**Alvo:** <@${targetId}> (\`${targetId}\`)`);
    if (detalhes) linhas.push(`**Detalhes:** ${String(detalhes).slice(0, 900)}`);

    const embed = new EmbedBuilder()
      .setColor(COR_POR_CATEGORIA[categoria] || CORES.dourado)
      .setTitle(TITULOS[tipo] || tipo)
      .setDescription(linhas.join('\n') || '—')
      .setFooter({ text: `${RODAPE} • ${categoria}` })
      .setTimestamp();

    await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    log.aviso(`Não foi possível enviar log ao canal do servidor ${guildId}:`, err.message);
  }
}

module.exports = { registrar, TITULOS };
