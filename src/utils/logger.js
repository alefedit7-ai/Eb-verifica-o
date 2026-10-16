'use strict';

const { config } = require('../config');

// Nunca imprime o token do bot nem sequências que se pareçam com um.
function ocultar(texto) {
  let saida = String(texto);
  if (config.token) saida = saida.split(config.token).join('[TOKEN OCULTO]');
  return saida.replace(/[\w-]{24,}\.[\w-]{6,}\.[\w-]{27,}/g, '[TOKEN OCULTO]');
}

function agora() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function escrever(nivel, args) {
  const partes = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)));
  const linha = `[${agora()}] [${nivel}] ${ocultar(partes.join(' '))}`;
  if (nivel === 'ERRO') console.error(linha);
  else if (nivel === 'AVISO') console.warn(linha);
  else console.log(linha);
}

module.exports = {
  info: (...a) => escrever('INFO', a),
  aviso: (...a) => escrever('AVISO', a),
  erro: (...a) => escrever('ERRO', a),
};
