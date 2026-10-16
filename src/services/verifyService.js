'use strict';

const db = require('../database');
const roblox = require('../roblox');
const roles = require('./roles');
const audit = require('./audit');
const embeds = require('../utils/embeds');
const limite = require('../utils/rateLimiter');
const { responder, adiar } = require('../utils/discord');
const { config } = require('../config');

const CINCO_MIN = 5 * 60 * 1000;

function nomesDosServidores(client, verificacoes) {
  return verificacoes.map((v) => {
    const g = client.guilds.cache.get(v.guildId);
    return g ? g.name : `servidor ${v.guildId}`;
  });
}

/** Botão "Verificar". */
async function executarVerificacao(interaction) {
  await adiar(interaction);
  const { client, guild, user } = interaction;

  const cfg = db.getGuildConfig(guild.id);
  if (!cfg || !cfg.integrationActive) {
    return responder(interaction, {
      embeds: [embeds.aviso('Servidor não autorizado', 'Este servidor ainda não foi autorizado no sistema central de verificação do EB. Avise a administração.')],
    });
  }

  const rl = limite.verificar(`verificar:${user.id}`, 5, CINCO_MIN);
  if (!rl.ok) {
    await audit.registrar(client, { guildId: guild.id, categoria: 'seguranca', tipo: 'limite_tentativas', actorId: user.id, detalhes: 'verificar' });
    return responder(interaction, {
      embeds: [embeds.aviso('Muitas tentativas', `Aguarde ${limite.formatarEspera(rl.esperaMs)} antes de tentar verificar de novo.`)],
    });
  }

  // 1–2. O Discord está vinculado? (consulta ao banco central)
  const registro = db.getUser(user.id);
  if (!registro || registro.linkStatus !== 'vinculado') {
    await audit.registrar(client, { guildId: guild.id, categoria: 'seguranca', tipo: 'verificacao_sem_vinculo', actorId: user.id });
    return responder(interaction, {
      embeds: [
        embeds.aviso(
          'Você ainda não está vinculado',
          'Para se verificar, primeiro clique em **🔗 Vincular** no painel, informe sua conta Roblox e confirme o código no perfil. Depois volte aqui e clique em **🛡️ Verificar**.',
        ),
      ],
    });
  }

  // 3. Conflito de identidade?
  const conflito = db.temConflito(user.id, registro.robloxId);
  if (conflito) {
    await audit.registrar(client, {
      guildId: guild.id,
      categoria: 'seguranca',
      tipo: 'vinculo_conflito',
      actorId: user.id,
      targetId: conflito,
      detalhes: `Conta Roblox ${registro.robloxUsername} (${registro.robloxId}) aparece vinculada a mais de um Discord.`,
    });
    return responder(interaction, {
      embeds: [embeds.erro('Conflito de identidade', 'Detectamos um conflito no seu cadastro. Sua verificação foi bloqueada — procure a administração do EB.')],
    });
  }

  // Regra principal: pertencer a pelo menos um dos grupos EB configurados.
  // A consulta é feita em uma única chamada à API pública da Roblox.
  let grupo = null;
  if (config.roblox.requireAnyGroup) {
    let gruposEncontrados;
    try {
      const ids = [...config.roblox.groupIds];
      // Mantém compatibilidade com um grupo adicional configurado pelo comando antigo.
      if (cfg.robloxGroupId) ids.push(cfg.robloxGroupId);
      gruposEncontrados = await roblox.obterGruposDoUsuario(registro.robloxId, ids);
    } catch (err) {
      return responder(interaction, {
        embeds: [embeds.erro('Roblox indisponível', 'Não consegui consultar as comunidades Roblox agora. Tente novamente em instantes.')],
      });
    }

    if (gruposEncontrados.length === 0) {
      const nomes = 'EB, BPE, CIE, BFE, BAC ou TDU';
      await audit.registrar(client, {
        guildId: guild.id,
        categoria: 'seguranca',
        tipo: 'verificacao_negada',
        actorId: user.id,
        detalhes: `Conta ${registro.robloxUsername} não pertence a nenhum dos grupos Roblox exigidos: ${config.roblox.groupIds.join(', ')}.`,
      });
      return responder(interaction, {
        embeds: [embeds.erro(
          'Você não pertence a uma comunidade aceita',
          `A conta **${registro.robloxUsername}** precisa pertencer a pelo menos uma destas comunidades Roblox: **${nomes}**. Entre em uma delas e tente verificar novamente.`,
        )],
      });
    }
    grupo = gruposEncontrados[0];
  } else if (cfg.robloxGroupId) {
    // Modo legado, caso ROBLOX_REQUIRE_ANY_GROUP=false.
    try {
      grupo = await roblox.obterCargoNoGrupo(registro.robloxId, cfg.robloxGroupId);
    } catch (err) {
      if (cfg.requireGroup) {
        return responder(interaction, {
          embeds: [embeds.erro('Roblox indisponível', 'Não consegui consultar o grupo Roblox agora. Tente novamente em instantes.')],
        });
      }
    }
    if (cfg.requireGroup && grupo && !grupo.membro) {
      await audit.registrar(client, {
        guildId: guild.id,
        categoria: 'seguranca',
        tipo: 'verificacao_negada',
        actorId: user.id,
        detalhes: `Conta ${registro.robloxUsername} não é membro do grupo Roblox ${cfg.robloxGroupId}.`,
      });
      return responder(interaction, {
        embeds: [embeds.erro(
          'Entre no grupo do EB',
          `Sua conta **${registro.robloxUsername}** não é membro do grupo Roblox exigido por este servidor (ID \`${cfg.robloxGroupId}\`). Entre no grupo e tente de novo.`,
        )],
      });
    }
  }

  // 4. Registra a verificação (data, hora e servidor).
  const { primeira } = db.registrarVerificacao(user.id, guild.id, registro.robloxId, 'manual');

  // 5. Concede o cargo, se possível.
  const cargo = await roles.concederCargoVerificado(guild, user.id, cfg);

  await audit.registrar(client, {
    guildId: guild.id,
    categoria: 'verificacao',
    tipo: 'verificado',
    actorId: user.id,
    detalhes: `Roblox: ${registro.robloxUsername} (${registro.robloxId}). ${primeira ? 'Primeira verificação' : 'Reverificação'} neste servidor. Cargo: ${cargo.motivo}.`,
  });

  // 6. Mensagem privada de confirmação.
  const linhas = [
    `${primeira ? 'Verificação concluída' : 'Verificação atualizada'} para a conta **[${registro.robloxUsername}](${roblox.linkPerfil(registro.robloxId)})**.`,
    '',
    roles.descreverResultado(cargo),
  ];
  if (grupo && (grupo.nome || grupo.grupoNome || grupo.membro)) {
    const nomeGrupo = grupo.nome || grupo.grupoNome || 'comunidade aceita';
    const cargoGrupo = grupo.cargo || 'membro';
    linhas.push(`🪖 Comunidade Roblox reconhecida: **${nomeGrupo}** — cargo **${cargoGrupo}**.`);
  }
  const outros = db.verificacoesEmOutrosServidores(user.id, guild.id);
  if (outros.length) {
    linhas.push(`🌐 Você também está verificado em: ${nomesDosServidores(client, outros).join(', ')}.`);
  }

  return responder(interaction, { embeds: [embeds.sucesso('Verificação registrada', linhas.join('\n'))] });
}

/**
 * Reconhece, neste servidor, uma verificação feita em outro servidor autorizado
 * (respeitando as regras do servidor: integração ativa + "aceitar outros servidores" + sem exigência de grupo).
 * @returns {Promise<{aplicado: boolean, motivo: string, cargo?: object, origens?: object[]}>}
 */
async function aplicarReconhecimento(client, guild, userId) {
  const cfg = db.getGuildConfig(guild.id);
  if (!cfg || !cfg.integrationActive) return { aplicado: false, motivo: 'integracao_inativa' };
  if (!cfg.acceptForeign) return { aplicado: false, motivo: 'nao_aceita_outros' };
  if (cfg.requireGroup || config.roblox.requireAnyGroup) return { aplicado: false, motivo: 'exige_grupo' };

  const registro = db.getUser(userId);
  if (!registro || registro.linkStatus !== 'vinculado') return { aplicado: false, motivo: 'sem_vinculo' };
  if (db.temConflito(userId, registro.robloxId)) return { aplicado: false, motivo: 'conflito' };
  if (db.getVerificacao(userId, guild.id)) return { aplicado: false, motivo: 'ja_verificado' };

  const origens = db.verificacoesEmOutrosServidores(userId, guild.id);
  if (origens.length === 0) return { aplicado: false, motivo: 'sem_verificacao_externa' };

  db.registrarVerificacao(userId, guild.id, registro.robloxId, 'reconhecida');
  const cargo = await roles.concederCargoVerificado(guild, userId, cfg);
  await audit.registrar(client, {
    guildId: guild.id,
    categoria: 'verificacao',
    tipo: 'verificado_reconhecido',
    actorId: userId,
    detalhes: `Reconhecida a partir de: ${nomesDosServidores(client, origens).join(', ')}. Cargo: ${cargo.motivo}.`,
  });
  return { aplicado: true, motivo: 'reconhecido', cargo, origens };
}

module.exports = { executarVerificacao, aplicarReconhecimento };
