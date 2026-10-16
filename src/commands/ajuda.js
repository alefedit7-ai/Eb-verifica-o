'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const { ehAutorizado } = require('../permissions');
const embeds = require('../utils/embeds');
const { adiar, responder } = require('../utils/discord');

const data = new SlashCommandBuilder()
  .setName('ajuda')
  .setDescription('Mostra como funciona o sistema de verificação do EB e os comandos disponíveis.')
  .setDMPermission(false);

async function execute(interaction) {
  await adiar(interaction);
  const cfg = db.getGuildConfig(interaction.guildId);

  const membro = [
    '**Como se verificar**',
    '1. No canal do painel, clique em **🔗 Vincular** e informe seu usuário ou ID do Roblox.',
    '2. Cole o **código temporário** na descrição ("Sobre") do seu perfil Roblox e toque em **✅ Já coloquei o código**.',
    '3. Clique em **🛡️ Verificar** para registrar a verificação e receber o cargo.',
    '',
    '🔒 Nunca informe senha ou cookie do Roblox — ninguém do EB vai pedir.',
    'Se algo der errado, procure a administração do seu servidor.',
  ];

  const admin = [
    '',
    '**Comandos administrativos**',
    '`/configurar definir` — canais, cargo de verificado, grupo Roblox e regras',
    '`/configurar admin_adicionar` / `admin_remover` — cargos autorizados',
    '`/configurar integracao` — (donos do bot) autoriza o servidor no sistema central',
    '`/configurar ver` — mostra a configuração atual',
    '`/painel` — publica ou atualiza o painel (sem duplicar)',
    '`/consultar` — registro central por Discord ou Roblox',
    '`/verificacao` — estado do membro neste servidor (opção de sincronizar cargo)',
    '`/desvincular` — remove uma vinculação (exige motivo)',
    '`/logs` — registros de auditoria',
  ];

  const linhas = ehAutorizado(interaction, cfg) ? [...membro, ...admin] : membro;
  return responder(interaction, { embeds: [embeds.neutro('🛡️ Ajuda — Sistema de Verificação EB', linhas.join('\n'))] });
}

module.exports = { data, execute };
