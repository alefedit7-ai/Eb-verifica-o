'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { config } = require('../config');
const db = require('../database');
const roblox = require('../roblox');
const audit = require('./audit');
const embeds = require('../utils/embeds');
const limite = require('../utils/rateLimiter');
const { responder, adiar, ts } = require('../utils/discord');
const { IDS } = require('../constants');

const DEZ_MIN = 10 * 60 * 1000;

function mensagemErroRoblox(err) {
  if (err && err.codigo === 'RATE_LIMIT') return 'A Roblox está limitando consultas no momento. Aguarde um minuto e tente de novo.';
  return 'Não consegui consultar a Roblox agora. Tente novamente em instantes.';
}

/** Botão "Vincular": mostra o formulário privado (modal). */
async function abrirFormulario(interaction) {
  const rl = limite.verificar(`vincular_abrir:${interaction.user.id}`, 8, DEZ_MIN);
  if (!rl.ok) {
    return interaction.reply({
      embeds: [embeds.aviso('Calma aí, recruta', `Muitas tentativas seguidas. Tente de novo em ${limite.formatarEspera(rl.esperaMs)}.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = db.getGuildConfig(interaction.guildId);
  if (!cfg || !cfg.integrationActive) {
    return interaction.reply({
      embeds: [embeds.aviso('Servidor não autorizado', 'Este servidor ainda não foi autorizado no sistema central de verificação do EB. Avise a administração.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const registro = db.getUser(interaction.user.id);
  if (registro && registro.linkStatus === 'vinculado') {
    return interaction.reply({
      embeds: [
        embeds.info(
          'Você já está vinculado',
          `Seu Discord já está vinculado à conta Roblox **[${registro.robloxUsername}](${roblox.linkPerfil(registro.robloxId)})**.\n\nClique em **🛡️ Verificar** para concluir. Para trocar de conta, peça a um administrador que use \`/desvincular\`.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder().setCustomId(IDS.MODAL_VINCULAR).setTitle('Vincular conta Roblox');
  const campo = new TextInputBuilder()
    .setCustomId(IDS.CAMPO_ROBLOX)
    .setLabel('Usuário ou ID da conta Roblox')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(100)
    .setRequired(true)
    .setPlaceholder('Ex.: MeuUsuario  ou  123456789');
  modal.addComponents(new ActionRowBuilder().addComponents(campo));
  return interaction.showModal(modal);
}

/** Envio do formulário: valida a conta e gera o código temporário. */
async function receberFormulario(interaction) {
  await adiar(interaction);
  const { user, guildId, client } = interaction;

  const rl = limite.verificar(`vincular_enviar:${user.id}`, 8, DEZ_MIN);
  if (!rl.ok) {
    await audit.registrar(client, { guildId, categoria: 'seguranca', tipo: 'limite_tentativas', actorId: user.id, detalhes: 'vincular' });
    return responder(interaction, {
      embeds: [embeds.aviso('Muitas tentativas', `Tente de novo em ${limite.formatarEspera(rl.esperaMs)}.`)],
    });
  }

  const cfg = db.getGuildConfig(guildId);
  if (!cfg || !cfg.integrationActive) {
    return responder(interaction, { embeds: [embeds.aviso('Servidor não autorizado', 'Este servidor ainda não foi autorizado no sistema do EB.')] });
  }

  const atual = db.getUser(user.id);
  if (atual && atual.linkStatus === 'vinculado') {
    return responder(interaction, {
      embeds: [embeds.info('Você já está vinculado', `Conta atual: **${atual.robloxUsername}**. Clique em **Verificar**.`)],
    });
  }

  const entrada = interaction.fields.getTextInputValue(IDS.CAMPO_ROBLOX);
  let conta;
  try {
    conta = await roblox.resolverUsuario(entrada);
  } catch (err) {
    return responder(interaction, { embeds: [embeds.erro('Roblox indisponível', mensagemErroRoblox(err))] });
  }

  if (!conta) {
    await audit.registrar(client, {
      guildId,
      categoria: 'seguranca',
      tipo: 'vinculo_invalido',
      actorId: user.id,
      detalhes: `Conta Roblox não encontrada/entrada inválida: "${String(entrada).slice(0, 40)}"`,
    });
    return responder(interaction, {
      embeds: [
        embeds.erro(
          'Conta Roblox não encontrada',
          'Não encontrei essa conta. Confira o **nome de usuário** (não o nome de exibição) ou use o **ID numérico** do perfil, e tente de novo.',
        ),
      ],
    });
  }

  const dono = db.getUserByRoblox(conta.id);
  if (dono && dono.discordId !== user.id) {
    await audit.registrar(client, {
      guildId,
      categoria: 'seguranca',
      tipo: 'vinculo_conflito',
      actorId: user.id,
      targetId: dono.discordId,
      detalhes: `Tentou vincular a conta Roblox ${conta.nome} (${conta.id}), já vinculada ao Discord ${dono.discordId}.`,
    });
    return responder(interaction, {
      embeds: [
        embeds.erro(
          'Conta já vinculada',
          'Esta conta Roblox já está vinculada a **outro** usuário do Discord. Se você acredita que isso é um erro, procure a administração do EB.',
        ),
      ],
    });
  }

  const codigo = roblox.gerarCodigo();
  const validadeMs = config.codeTtlMinutes * 60 * 1000;
  db.criarDesafio(user.id, conta.id, conta.nome, codigo, validadeMs);

  await audit.registrar(client, {
    guildId,
    categoria: 'vinculacao',
    tipo: 'vinculo_iniciado',
    actorId: user.id,
    detalhes: `Conta Roblox: ${conta.nome} (${conta.id})`,
  });

  const botao = new ButtonBuilder()
    .setCustomId(IDS.CONFIRMAR_VINCULO)
    .setLabel('Já coloquei o código')
    .setEmoji('✅')
    .setStyle(ButtonStyle.Success);

  return responder(interaction, {
    embeds: [
      embeds.neutro(
        '🔗 Confirme que a conta é sua',
        [
          `Conta encontrada: **[${conta.nome}](${roblox.linkPerfil(conta.id)})**`,
          '',
          '**1.** Abra o Roblox e vá em *Perfil → Editar (lápis) → Sobre*.',
          '**2.** Cole **exatamente** este código na descrição e salve:',
          `\`\`\`${codigo}\`\`\``,
          '**3.** Volte aqui e toque em **✅ Já coloquei o código**.',
          '',
          `⏳ O código vale até ${ts(Date.now() + validadeMs, 't')} (${config.codeTtlMinutes} min). Depois de vinculado, você pode apagar o código do perfil.`,
          '🔒 Nunca informe sua senha ou cookie. O código é a única prova necessária.',
        ].join('\n'),
      ),
    ],
    components: [new ActionRowBuilder().addComponents(botao)],
  });
}

/** Botão "Já coloquei o código": confere o perfil Roblox e conclui a vinculação. */
async function confirmarVinculo(interaction) {
  await adiar(interaction);
  const { user, guildId, client } = interaction;

  const rl = limite.verificar(`vincular_confirmar:${user.id}`, 10, DEZ_MIN);
  if (!rl.ok) {
    await audit.registrar(client, { guildId, categoria: 'seguranca', tipo: 'limite_tentativas', actorId: user.id, detalhes: 'confirmar vínculo' });
    return responder(interaction, {
      embeds: [embeds.aviso('Muitas tentativas', `Tente de novo em ${limite.formatarEspera(rl.esperaMs)}.`)],
    });
  }

  const desafio = db.getDesafio(user.id);
  if (!desafio || desafio.expiresAt < Date.now()) {
    if (desafio) db.apagarDesafio(user.id);
    return responder(interaction, {
      embeds: [embeds.aviso('Pedido expirado', 'Não há vinculação pendente ou o código expirou. Clique em **🔗 Vincular** no painel para gerar um novo.')],
    });
  }

  if (desafio.attempts >= config.maxCodeAttempts) {
    db.apagarDesafio(user.id);
    await audit.registrar(client, {
      guildId,
      categoria: 'seguranca',
      tipo: 'codigo_bloqueado',
      actorId: user.id,
      detalhes: `Conta Roblox: ${desafio.robloxUsername} (${desafio.robloxId})`,
    });
    return responder(interaction, {
      embeds: [embeds.erro('Limite de tentativas', 'Você excedeu o número de conferências para este código. Clique em **🔗 Vincular** para gerar um novo.')],
    });
  }

  let perfil;
  try {
    perfil = await roblox.obterPerfil(desafio.robloxId);
  } catch (err) {
    return responder(interaction, { embeds: [embeds.erro('Roblox indisponível', mensagemErroRoblox(err))] });
  }
  if (!perfil || perfil.banido) {
    db.apagarDesafio(user.id);
    return responder(interaction, { embeds: [embeds.erro('Conta indisponível', 'Não consegui ler esse perfil Roblox. Gere uma nova vinculação.')] });
  }

  db.incrementarTentativas(user.id);

  if (!roblox.descricaoContemCodigo(perfil.descricao, desafio.code)) {
    const restantes = Math.max(config.maxCodeAttempts - (desafio.attempts + 1), 0);
    await audit.registrar(client, {
      guildId,
      categoria: 'seguranca',
      tipo: 'codigo_incorreto',
      actorId: user.id,
      detalhes: `Conta Roblox: ${perfil.nome} (${perfil.id}). Tentativas restantes: ${restantes}`,
    });
    return responder(interaction, {
      embeds: [
        embeds.aviso(
          'Código não encontrado',
          [
            'Não achei o código na descrição ("Sobre") do perfil. Verifique se:',
            '• você **salvou** a descrição;',
            '• colou o código **inteiro**, sem alterações;',
            '• a Roblox não trocou o texto por `####` (se trocou, gere um novo código em **🔗 Vincular**).',
            '',
            `Tentativas restantes para este código: **${restantes}**.`,
          ].join('\n'),
        ),
      ],
    });
  }

  try {
    db.efetivarVinculo(user.id, perfil.id, perfil.nome);
  } catch (err) {
    if (err.codigo === 'JA_VINCULADO') {
      return responder(interaction, { embeds: [embeds.info('Você já está vinculado', 'Clique em **🛡️ Verificar** no painel.')] });
    }
    if (err.codigo === 'CONFLITO_ROBLOX') {
      await audit.registrar(client, {
        guildId,
        categoria: 'seguranca',
        tipo: 'vinculo_conflito',
        actorId: user.id,
        targetId: err.outroDiscordId || null,
        detalhes: `Conflito ao concluir vínculo com ${perfil.nome} (${perfil.id}).`,
      });
      return responder(interaction, {
        embeds: [embeds.erro('Conta já vinculada', 'Esta conta Roblox já pertence a outro usuário do Discord. Procure a administração do EB.')],
      });
    }
    throw err;
  }

  await audit.registrar(client, {
    guildId,
    categoria: 'vinculacao',
    tipo: 'vinculado',
    actorId: user.id,
    detalhes: `Conta Roblox: ${perfil.nome} (${perfil.id})`,
  });

  return responder(interaction, {
    embeds: [
      embeds.sucesso(
        'Vinculação concluída!',
        `Seu Discord foi vinculado à conta Roblox **[${perfil.nome}](${roblox.linkPerfil(perfil.id)})**.\n\nAgora clique em **🛡️ Verificar** no painel para receber seu cargo. Você já pode apagar o código da descrição do perfil.`,
      ),
    ],
    components: [],
  });
}

module.exports = { abrirFormulario, receberFormulario, confirmarVinculo };
