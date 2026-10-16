'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('./config');

let db = null;

function erroDb(codigo, mensagem, extra = {}) {
  return Object.assign(new Error(mensagem), { codigo, ...extra });
}

/* ------------------------------------------------------------------ */
/* Inicialização e migrações                                            */
/* ------------------------------------------------------------------ */

const MIGRACOES = [
  // Versão 1 — esquema inicial
  `
  CREATE TABLE guild_config (
    guild_id                 TEXT PRIMARY KEY,
    panel_channel_id         TEXT,
    panel_message_id         TEXT,
    panel_message_channel_id TEXT,
    log_channel_id           TEXT,
    verified_role_id         TEXT,
    admin_role_ids           TEXT    NOT NULL DEFAULT '[]',
    integration_active       INTEGER NOT NULL DEFAULT 0,
    accept_foreign           INTEGER NOT NULL DEFAULT 1,
    roblox_group_id          TEXT,
    require_group            INTEGER NOT NULL DEFAULT 0,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL
  );

  CREATE TABLE users (
    discord_id          TEXT PRIMARY KEY,
    roblox_id           TEXT,
    roblox_username     TEXT,
    link_status         TEXT NOT NULL DEFAULT 'desvinculado'
                        CHECK (link_status IN ('vinculado','desvinculado')),
    verification_status TEXT NOT NULL DEFAULT 'nao_verificado'
                        CHECK (verification_status IN ('verificado','nao_verificado')),
    linked_at           INTEGER,
    verified_at         INTEGER,
    updated_at          INTEGER NOT NULL
  );

  -- Impede que a mesma conta Roblox fique vinculada ativamente a mais de um Discord.
  CREATE UNIQUE INDEX ux_users_roblox_ativo
    ON users (roblox_id) WHERE link_status = 'vinculado';

  CREATE TABLE guild_verifications (
    discord_id  TEXT NOT NULL,
    guild_id    TEXT NOT NULL,
    roblox_id   TEXT NOT NULL,
    method      TEXT NOT NULL DEFAULT 'manual',
    verified_at INTEGER NOT NULL,
    PRIMARY KEY (discord_id, guild_id)
  );
  CREATE INDEX ix_verifications_guild ON guild_verifications (guild_id);

  CREATE TABLE link_challenges (
    discord_id      TEXT PRIMARY KEY,
    roblox_id       TEXT NOT NULL,
    roblox_username TEXT NOT NULL,
    code            TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    expires_at      INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT,
    categoria  TEXT NOT NULL,   -- vinculacao | verificacao | admin | seguranca
    tipo       TEXT NOT NULL,
    actor_id   TEXT,
    target_id  TEXT,
    details    TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX ix_audit_guild ON audit_logs (guild_id, created_at DESC);
  CREATE INDEX ix_audit_target ON audit_logs (target_id, created_at DESC);
  `,
];

function iniciar() {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const atual = Number(db.pragma('user_version', { simple: true })) || 0;
  for (let versao = atual; versao < MIGRACOES.length; versao += 1) {
    db.transaction(() => {
      db.exec(MIGRACOES[versao]);
      db.pragma(`user_version = ${versao + 1}`);
    })();
  }
  return db;
}

function fechar() {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignorado */
    }
    db = null;
  }
}

/* ------------------------------------------------------------------ */
/* Configuração por servidor                                            */
/* ------------------------------------------------------------------ */

function mapearGuild(r) {
  if (!r) return null;
  let admins = [];
  try {
    admins = JSON.parse(r.admin_role_ids || '[]');
  } catch {
    admins = [];
  }
  return {
    guildId: r.guild_id,
    panelChannelId: r.panel_channel_id,
    panelMessageId: r.panel_message_id,
    panelMessageChannelId: r.panel_message_channel_id,
    logChannelId: r.log_channel_id,
    verifiedRoleId: r.verified_role_id,
    adminRoleIds: admins,
    integrationActive: !!r.integration_active,
    acceptForeign: !!r.accept_foreign,
    robloxGroupId: r.roblox_group_id,
    requireGroup: !!r.require_group,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const COLUNAS_GUILD = {
  panelChannelId: 'panel_channel_id',
  panelMessageId: 'panel_message_id',
  panelMessageChannelId: 'panel_message_channel_id',
  logChannelId: 'log_channel_id',
  verifiedRoleId: 'verified_role_id',
  adminRoleIds: 'admin_role_ids',
  integrationActive: 'integration_active',
  acceptForeign: 'accept_foreign',
  robloxGroupId: 'roblox_group_id',
  requireGroup: 'require_group',
};

function getGuildConfig(guildId) {
  return mapearGuild(db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId));
}

function listGuildConfigs() {
  return db.prepare('SELECT * FROM guild_config ORDER BY created_at').all().map(mapearGuild);
}

/** Cria ou atualiza parcialmente a configuração de um servidor (chaves em camelCase). */
function salvarGuildConfig(guildId, patch = {}) {
  const agora = Date.now();
  const params = { guild_id: guildId, updated_at: agora };
  const sets = [];
  for (const [chave, coluna] of Object.entries(COLUNAS_GUILD)) {
    if (!(chave in patch)) continue;
    let valor = patch[chave];
    if (chave === 'adminRoleIds') valor = JSON.stringify([...new Set(valor || [])]);
    else if (typeof valor === 'boolean') valor = valor ? 1 : 0;
    else if (valor === undefined || valor === '') valor = null;
    params[coluna] = valor;
    sets.push(`${coluna} = @${coluna}`);
  }

  db.transaction(() => {
    const existe = db.prepare('SELECT 1 FROM guild_config WHERE guild_id = ?').get(guildId);
    if (!existe) {
      db.prepare('INSERT INTO guild_config (guild_id, created_at, updated_at) VALUES (?, ?, ?)').run(guildId, agora, agora);
    }
    db.prepare(`UPDATE guild_config SET ${[...sets, 'updated_at = @updated_at'].join(', ')} WHERE guild_id = @guild_id`).run(params);
  })();

  return getGuildConfig(guildId);
}

/* ------------------------------------------------------------------ */
/* Usuários e vinculações                                               */
/* ------------------------------------------------------------------ */

function mapearUsuario(r) {
  if (!r) return null;
  return {
    discordId: r.discord_id,
    robloxId: r.roblox_id,
    robloxUsername: r.roblox_username,
    linkStatus: r.link_status,
    verificationStatus: r.verification_status,
    linkedAt: r.linked_at,
    verifiedAt: r.verified_at,
    updatedAt: r.updated_at,
  };
}

function getUser(discordId) {
  return mapearUsuario(db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId));
}

/** Retorna o usuário Discord que tem esta conta Roblox vinculada ATIVAMENTE (ou null). */
function getUserByRoblox(robloxId) {
  return mapearUsuario(
    db.prepare("SELECT * FROM users WHERE roblox_id = ? AND link_status = 'vinculado'").get(String(robloxId)),
  );
}

/** Há outro Discord com a mesma conta Roblox vinculada? (não deveria acontecer; checagem extra) */
function temConflito(discordId, robloxId) {
  const r = db
    .prepare("SELECT discord_id FROM users WHERE roblox_id = ? AND link_status = 'vinculado' AND discord_id <> ?")
    .get(String(robloxId), discordId);
  return r ? r.discord_id : null;
}

function criarDesafio(discordId, robloxId, robloxUsername, codigo, validadeMs) {
  const agora = Date.now();
  db.prepare(
    `INSERT INTO link_challenges (discord_id, roblox_id, roblox_username, code, attempts, expires_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET
       roblox_id = excluded.roblox_id, roblox_username = excluded.roblox_username,
       code = excluded.code, attempts = 0, expires_at = excluded.expires_at, created_at = excluded.created_at`,
  ).run(discordId, String(robloxId), robloxUsername, codigo, agora + validadeMs, agora);
}

function getDesafio(discordId) {
  const r = db.prepare('SELECT * FROM link_challenges WHERE discord_id = ?').get(discordId);
  if (!r) return null;
  return {
    discordId: r.discord_id,
    robloxId: r.roblox_id,
    robloxUsername: r.roblox_username,
    code: r.code,
    attempts: r.attempts,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

function incrementarTentativas(discordId) {
  db.prepare('UPDATE link_challenges SET attempts = attempts + 1 WHERE discord_id = ?').run(discordId);
}

function apagarDesafio(discordId) {
  db.prepare('DELETE FROM link_challenges WHERE discord_id = ?').run(discordId);
}

function limparDesafiosExpirados() {
  return db.prepare('DELETE FROM link_challenges WHERE expires_at < ?').run(Date.now()).changes;
}

/**
 * Efetiva a vinculação Discord ↔ Roblox (transação atômica).
 * Lança erro com `codigo`: JA_VINCULADO | CONFLITO_ROBLOX
 */
const efetivarVinculo = (discordId, robloxId, robloxUsername) => {
  robloxId = String(robloxId);
  try {
    db.transaction(() => {
      const agora = Date.now();
      const meu = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId);
      if (meu && meu.link_status === 'vinculado') {
        throw erroDb('JA_VINCULADO', 'Este Discord já está vinculado.', { robloxId: meu.roblox_id, robloxUsername: meu.roblox_username });
      }
      const outro = db
        .prepare("SELECT discord_id FROM users WHERE roblox_id = ? AND link_status = 'vinculado' AND discord_id <> ?")
        .get(robloxId, discordId);
      if (outro) throw erroDb('CONFLITO_ROBLOX', 'Conta Roblox já vinculada a outro Discord.', { outroDiscordId: outro.discord_id });

      if (meu) {
        db.prepare(
          `UPDATE users SET roblox_id = ?, roblox_username = ?, link_status = 'vinculado',
             verification_status = 'nao_verificado', linked_at = ?, verified_at = NULL, updated_at = ?
           WHERE discord_id = ?`,
        ).run(robloxId, robloxUsername, agora, agora, discordId);
      } else {
        db.prepare(
          `INSERT INTO users (discord_id, roblox_id, roblox_username, link_status, verification_status, linked_at, updated_at)
           VALUES (?, ?, ?, 'vinculado', 'nao_verificado', ?, ?)`,
        ).run(discordId, robloxId, robloxUsername, agora, agora);
      }
      db.prepare('DELETE FROM link_challenges WHERE discord_id = ?').run(discordId);
    })();
  } catch (err) {
    if (err && err.codigo) throw err;
    if (/UNIQUE/i.test(String(err && err.message))) {
      throw erroDb('CONFLITO_ROBLOX', 'Conta Roblox já vinculada a outro Discord.');
    }
    throw err;
  }
};

/** Remove a vinculação. Retorna o registro anterior (ou null se não havia vínculo ativo). */
function removerVinculo(discordId) {
  return db.transaction(() => {
    const anterior = mapearUsuario(db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId));
    if (!anterior || anterior.linkStatus !== 'vinculado') return null;
    const agora = Date.now();
    db.prepare(
      `UPDATE users SET roblox_id = NULL, roblox_username = NULL, link_status = 'desvinculado',
         verification_status = 'nao_verificado', verified_at = NULL, updated_at = ?
       WHERE discord_id = ?`,
    ).run(agora, discordId);
    db.prepare('DELETE FROM guild_verifications WHERE discord_id = ?').run(discordId);
    db.prepare('DELETE FROM link_challenges WHERE discord_id = ?').run(discordId);
    return anterior;
  })();
}

/* ------------------------------------------------------------------ */
/* Verificações                                                         */
/* ------------------------------------------------------------------ */

function mapearVerificacao(r) {
  return r && {
    discordId: r.discord_id,
    guildId: r.guild_id,
    robloxId: r.roblox_id,
    method: r.method,
    verifiedAt: r.verified_at,
  };
}

function getVerificacao(discordId, guildId) {
  return mapearVerificacao(
    db.prepare('SELECT * FROM guild_verifications WHERE discord_id = ? AND guild_id = ?').get(discordId, guildId),
  );
}

function listarVerificacoes(discordId) {
  return db
    .prepare('SELECT * FROM guild_verifications WHERE discord_id = ? ORDER BY verified_at')
    .all(discordId)
    .map(mapearVerificacao);
}

/** Verificações do usuário em OUTROS servidores com integração ativa. */
function verificacoesEmOutrosServidores(discordId, guildIdAtual) {
  return db
    .prepare(
      `SELECT v.* FROM guild_verifications v
         JOIN guild_config g ON g.guild_id = v.guild_id
        WHERE v.discord_id = ? AND v.guild_id <> ? AND g.integration_active = 1
        ORDER BY v.verified_at`,
    )
    .all(discordId, guildIdAtual)
    .map(mapearVerificacao);
}

/**
 * Registra a verificação do membro no servidor.
 * Retorna { primeira: boolean } — true se for a primeira vez neste servidor.
 */
function registrarVerificacao(discordId, guildId, robloxId, metodo = 'manual') {
  return db.transaction(() => {
    const agora = Date.now();
    const antes = db.prepare('SELECT 1 FROM guild_verifications WHERE discord_id = ? AND guild_id = ?').get(discordId, guildId);
    db.prepare(
      `INSERT INTO guild_verifications (discord_id, guild_id, roblox_id, method, verified_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(discord_id, guild_id) DO UPDATE SET
         roblox_id = excluded.roblox_id, method = excluded.method, verified_at = excluded.verified_at`,
    ).run(discordId, guildId, String(robloxId), metodo, agora);
    db.prepare(
      "UPDATE users SET verification_status = 'verificado', verified_at = ?, updated_at = ? WHERE discord_id = ?",
    ).run(agora, agora, discordId);
    return { primeira: !antes };
  })();
}

/* ------------------------------------------------------------------ */
/* Auditoria                                                            */
/* ------------------------------------------------------------------ */

function registrarAuditoria({ guildId = null, categoria, tipo, actorId = null, targetId = null, detalhes = null }) {
  const texto = detalhes == null ? null : String(detalhes).slice(0, 1000);
  db.prepare(
    `INSERT INTO audit_logs (guild_id, categoria, tipo, actor_id, target_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(guildId, categoria, tipo, actorId, targetId, texto, Date.now());
}

function listarAuditoria({ guildId = null, categoria = null, targetId = null, limite = 10 } = {}) {
  const filtros = [];
  const params = [];
  if (guildId) {
    filtros.push('guild_id = ?');
    params.push(guildId);
  }
  if (categoria) {
    filtros.push('categoria = ?');
    params.push(categoria);
  }
  if (targetId) {
    filtros.push('target_id = ?');
    params.push(targetId);
  }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  params.push(Math.min(Math.max(Number(limite) || 10, 1), 50));
  return db
    .prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params)
    .map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      categoria: r.categoria,
      tipo: r.tipo,
      actorId: r.actor_id,
      targetId: r.target_id,
      detalhes: r.details,
      criadoEm: r.created_at,
    }));
}

module.exports = {
  iniciar,
  fechar,
  getGuildConfig,
  listGuildConfigs,
  salvarGuildConfig,
  getUser,
  getUserByRoblox,
  temConflito,
  criarDesafio,
  getDesafio,
  incrementarTentativas,
  apagarDesafio,
  limparDesafiosExpirados,
  efetivarVinculo,
  removerVinculo,
  getVerificacao,
  listarVerificacoes,
  verificacoesEmOutrosServidores,
  registrarVerificacao,
  registrarAuditoria,
  listarAuditoria,
};
