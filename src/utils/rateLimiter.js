'use strict';

// Limitador de tentativas em memória (janela deslizante).
const registros = new Map();

/**
 * @param {string} chave  ex.: "verificar:123456789"
 * @param {number} maximo número máximo de ações na janela
 * @param {number} janelaMs tamanho da janela em milissegundos
 * @returns {{ok: boolean, esperaMs: number}}
 */
function verificar(chave, maximo, janelaMs) {
  const agora = Date.now();
  const lista = (registros.get(chave) || []).filter((t) => agora - t < janelaMs);
  if (lista.length >= maximo) {
    registros.set(chave, lista);
    return { ok: false, esperaMs: janelaMs - (agora - lista[0]) };
  }
  lista.push(agora);
  registros.set(chave, lista);
  return { ok: true, esperaMs: 0 };
}

function formatarEspera(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s} segundo(s)`;
  return `${Math.ceil(s / 60)} minuto(s)`;
}

// Limpeza periódica para não acumular memória.
setInterval(() => {
  const agora = Date.now();
  for (const [chave, lista] of registros) {
    const viva = lista.filter((t) => agora - t < 60 * 60 * 1000);
    if (viva.length === 0) registros.delete(chave);
    else registros.set(chave, viva);
  }
}, 10 * 60 * 1000).unref();

module.exports = { verificar, formatarEspera };
