'use strict';

const crypto = require('crypto');
const { config } = require('./config');

/**
 * Integração com a API PÚBLICA da Roblox. Não usa senha, cookie nem chave de API:
 * a propriedade da conta é comprovada por um código colocado na descrição do perfil.
 */

class RobloxError extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'RobloxError';
    this.codigo = codigo; // RATE_LIMIT | TIMEOUT | REDE | API
  }
}

async function requisitar(url, { metodo = 'GET', corpo } = {}) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: metodo,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'EB-Verificacao-Bot/1.0',
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controlador.signal,
    });
    if (res.status === 429) throw new RobloxError('RATE_LIMIT', 'A Roblox limitou as consultas. Tente novamente em instantes.');
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new RobloxError('API', `A API da Roblox respondeu com status ${res.status}.`);
    return await res.json();
  } catch (err) {
    if (err instanceof RobloxError) throw err;
    if (err && err.name === 'AbortError') throw new RobloxError('TIMEOUT', 'A Roblox demorou demais para responder.');
    throw new RobloxError('REDE', 'Não foi possível contatar a Roblox.');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Interpreta o que o membro digitou.
 * Aceita: usuário (3–20 letras/números/_), ID numérico, ou link de perfil.
 * @returns {{tipo: 'id'|'usuario', valor: string} | null}
 */
function interpretarEntrada(entrada) {
  const limpo = String(entrada || '').trim().replace(/^@/, '');
  if (!limpo) return null;

  const link = limpo.match(/roblox\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/(\d{1,15})/i);
  if (link) return { tipo: 'id', valor: link[1] };
  if (/^\d{1,15}$/.test(limpo)) return { tipo: 'id', valor: limpo };
  if (/^[A-Za-z0-9_]{3,20}$/.test(limpo)) return { tipo: 'usuario', valor: limpo };
  return null;
}

async function buscarPorId(id) {
  const dados = await requisitar(`${config.roblox.usersApi}/v1/users/${id}`);
  if (!dados || dados.id == null) return null;
  return {
    id: String(dados.id),
    nome: dados.name,
    apelido: dados.displayName || dados.name,
    descricao: typeof dados.description === 'string' ? dados.description : '',
    banido: !!dados.isBanned,
  };
}

async function buscarPorNome(nome) {
  const dados = await requisitar(`${config.roblox.usersApi}/v1/usernames/users`, {
    metodo: 'POST',
    corpo: { usernames: [nome], excludeBannedUsers: true },
  });
  const item = dados && Array.isArray(dados.data) ? dados.data[0] : null;
  if (!item || item.id == null) return null;
  return { id: String(item.id), nome: item.name, apelido: item.displayName || item.name };
}

/**
 * Resolve o que o membro digitou para uma conta Roblox existente.
 * @returns {Promise<{id: string, nome: string, apelido: string} | null>} null = conta não encontrada ou entrada inválida
 */
async function resolverUsuario(entrada) {
  const interpretada = interpretarEntrada(entrada);
  if (!interpretada) return null;
  if (interpretada.tipo === 'id') {
    const p = await buscarPorId(interpretada.valor);
    return p && !p.banido ? { id: p.id, nome: p.nome, apelido: p.apelido } : null;
  }
  return buscarPorNome(interpretada.valor);
}

/** Perfil público (inclui a descrição "Sobre"). */
async function obterPerfil(id) {
  return buscarPorId(String(id));
}

/**
 * Consulta uma única vez os grupos públicos da conta e devolve os grupos
 * correspondentes à lista permitida. A regra de aprovação (qualquer um) fica
 * no serviço de verificação.
 * @returns {Promise<Array<{id: string, nome: string, cargo: string|null, rank: number|null}>>}
 */
async function obterGruposDoUsuario(usuarioId, grupoIds) {
  const ids = [...new Set((grupoIds || []).map(String).filter((id) => /^\d{1,12}$/.test(id)))];
  if (ids.length === 0) return [];
  const dados = await requisitar(`${config.roblox.groupsApi}/v2/users/${usuarioId}/groups/roles`);
  const lista = dados && Array.isArray(dados.data) ? dados.data : [];
  const permitidos = new Set(ids);
  return lista
    .filter((item) => item && item.group && permitidos.has(String(item.group.id)))
    .map((item) => ({
      id: String(item.group.id),
      nome: item.group.name || `Grupo ${item.group.id}`,
      cargo: item.role ? item.role.name : null,
      rank: item.role && Number.isFinite(item.role.rank) ? item.role.rank : null,
    }));
}

/** Compatibilidade com configurações antigas de um único grupo. */
async function obterCargoNoGrupo(usuarioId, grupoId) {
  const encontrados = await obterGruposDoUsuario(usuarioId, [grupoId]);
  const achado = encontrados[0];
  if (!achado) return { membro: false, cargo: null, rank: null };
  return { membro: true, cargo: achado.cargo, rank: achado.rank, grupoId: achado.id, grupoNome: achado.nome };
}

// Palavras neutras (evita o filtro de texto da Roblox transformar o código em "####").
const PALAVRAS = [
  'falcao', 'rio', 'pedra', 'monte', 'trilha', 'campo', 'ponte', 'norte', 'sul', 'leste',
  'oeste', 'cedro', 'ipe', 'jacare', 'tucano', 'onca', 'arara', 'serra', 'vale', 'mata',
  'cerrado', 'bravo', 'forte', 'tropa', 'bandeira', 'sol', 'lua', 'estrela', 'mapa', 'bussola',
  'abrigo', 'horizonte',
];

function gerarCodigo() {
  const escolher = () => PALAVRAS[crypto.randomInt(PALAVRAS.length)];
  const numero = crypto.randomInt(10, 100);
  return `eb-${escolher()}-${escolher()}-${escolher()}-${numero}`;
}

function descricaoContemCodigo(descricao, codigo) {
  return String(descricao || '').toLowerCase().includes(String(codigo).toLowerCase());
}

function linkPerfil(id) {
  return `https://www.roblox.com/users/${id}/profile`;
}

module.exports = {
  RobloxError,
  interpretarEntrada,
  resolverUsuario,
  obterPerfil,
  obterCargoNoGrupo,
  obterGruposDoUsuario,
  gerarCodigo,
  descricaoContemCodigo,
  linkPerfil,
};
