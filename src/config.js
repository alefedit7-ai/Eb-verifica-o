'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const raiz = path.join(__dirname, '..');

// Carrega ".env" e, se existir, "variables.env" (útil no celular/hospedagens onde arquivos com ponto somem).
// O dotenv não sobrescreve variáveis já definidas, então ".env" tem prioridade.
for (const nome of ['.env', 'variables.env']) {
  const caminho = path.join(raiz, nome);
  if (fs.existsSync(caminho)) dotenv.config({ path: caminho });
}

const SNOWFLAKE = /^\d{17,20}$/;
const PLACEHOLDER = /(COLE|SEU_|AQUI|EXEMPLO|XXXX)/i;

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function listaIds(valor) {
  return texto(valor)
    .split(/[,\s;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function booleano(valor, padrao = false) {
  const v = texto(valor).toLowerCase();
  if (!v) return padrao;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(v);
}

function inteiro(valor, padrao) {
  const n = Number.parseInt(texto(valor), 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function semBarraFinal(url) {
  return texto(url).replace(/\/+$/, '');
}

const GRUPOS_ROBLOX_PADRAO = ['866282850', '1042231911', '728691851', '245426392', '1073002614', '781548145'];

const config = {
  token: texto(process.env.DISCORD_TOKEN),
  ownerIds: listaIds(process.env.BOT_OWNER_IDS).filter((v) => !PLACEHOLDER.test(v)),
  allowedGuildIds: listaIds(process.env.ALLOWED_GUILD_IDS),
  databasePath: texto(process.env.DATABASE_PATH) || path.join(raiz, 'data', 'eb-verificacao.sqlite'),
  useMembersIntent: booleano(process.env.USAR_INTENT_MEMBROS, false),
  codeTtlMinutes: inteiro(process.env.CODIGO_VALIDADE_MIN, 10),
  maxCodeAttempts: 5,
  bootstrap: {
    guildId: texto(process.env.GUILD_ID_PRINCIPAL),
    panelChannelId: texto(process.env.CANAL_PAINEL_ID),
    logChannelId: texto(process.env.CANAL_LOGS_ID),
    verifiedRoleId: texto(process.env.CARGO_VERIFICADO_ID),
    adminRoleIds: listaIds(process.env.CARGOS_ADMIN_IDS),
  },
  roblox: {
    // Regra global: a conta precisa estar em pelo menos um dos grupos listados.
    groupIds: listaIds(process.env.ROBLOX_GROUP_IDS || GRUPOS_ROBLOX_PADRAO.join(','))
      .filter((id) => /^\d{1,12}$/.test(id)),
    requireAnyGroup: booleano(process.env.ROBLOX_REQUIRE_ANY_GROUP, true),
    usersApi: semBarraFinal(process.env.ROBLOX_USERS_API) || 'https://users.roblox.com',
    groupsApi: semBarraFinal(process.env.ROBLOX_GROUPS_API) || 'https://groups.roblox.com',
  },
};

/**
 * Valida as configurações obrigatórias.
 * @returns {{erros: string[], avisos: string[]}}
 */
function validarConfig() {
  const erros = [];
  const avisos = [];

  if (!config.token || PLACEHOLDER.test(config.token)) {
    erros.push('DISCORD_TOKEN não foi preenchido. Cole o token do bot no arquivo .env (ou variables.env).');
  } else if (!/^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/.test(config.token)) {
    erros.push('DISCORD_TOKEN parece inválido (formato inesperado). Gere um novo em Developer Portal > Bot > Reset Token.');
  }

  const ownersBrutos = listaIds(process.env.BOT_OWNER_IDS);
  if (config.ownerIds.length === 0) {
    erros.push('BOT_OWNER_IDS não foi preenchido. Informe o seu ID de usuário do Discord (ative o Modo Desenvolvedor e use "Copiar ID").');
  } else if (ownersBrutos.some((v) => !PLACEHOLDER.test(v) && !SNOWFLAKE.test(v))) {
    erros.push('BOT_OWNER_IDS contém um ID inválido. IDs do Discord têm de 17 a 20 números.');
  }

  const idsOpcionais = [
    ['ALLOWED_GUILD_IDS', config.allowedGuildIds],
    ['GUILD_ID_PRINCIPAL', config.bootstrap.guildId ? [config.bootstrap.guildId] : []],
    ['CANAL_PAINEL_ID', config.bootstrap.panelChannelId ? [config.bootstrap.panelChannelId] : []],
    ['CANAL_LOGS_ID', config.bootstrap.logChannelId ? [config.bootstrap.logChannelId] : []],
    ['CARGO_VERIFICADO_ID', config.bootstrap.verifiedRoleId ? [config.bootstrap.verifiedRoleId] : []],
    ['CARGOS_ADMIN_IDS', config.bootstrap.adminRoleIds],
  ];
  for (const [nome, ids] of idsOpcionais) {
    for (const id of ids) {
      if (!SNOWFLAKE.test(id)) erros.push(`${nome} contém um ID inválido: "${id}". IDs têm de 17 a 20 números.`);
    }
  }

  if (config.bootstrap.guildId === '' && (config.bootstrap.panelChannelId || config.bootstrap.logChannelId || config.bootstrap.verifiedRoleId)) {
    avisos.push('Você preencheu canais/cargos iniciais, mas não GUILD_ID_PRINCIPAL. Eles serão ignorados; use /configurar.');
  }

  const gruposBrutos = listaIds(process.env.ROBLOX_GROUP_IDS || GRUPOS_ROBLOX_PADRAO.join(','));
  if (gruposBrutos.some((id) => !/^\d{1,12}$/.test(id))) {
    erros.push('ROBLOX_GROUP_IDS deve conter apenas IDs numéricos separados por vírgula.');
  }
  if (config.roblox.requireAnyGroup && config.roblox.groupIds.length === 0) {
    erros.push('ROBLOX_GROUP_IDS precisa conter pelo menos um grupo quando ROBLOX_REQUIRE_ANY_GROUP=true.');
  }

  for (const [nome, url] of [['ROBLOX_USERS_API', config.roblox.usersApi], ['ROBLOX_GROUPS_API', config.roblox.groupsApi]]) {
    if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(url)) erros.push(`${nome} deve ser uma URL https sem caminho, ex.: https://users.roblox.com`);
  }

  if (config.useMembersIntent) {
    avisos.push('USAR_INTENT_MEMBROS=true: ative "Server Members Intent" no Developer Portal, senão o bot não conecta.');
  }

  return { erros, avisos };
}

module.exports = { config, validarConfig, SNOWFLAKE };
