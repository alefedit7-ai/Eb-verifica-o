'use strict';

const lista = [
  require('./configurar'),
  require('./painel'),
  require('./consultar'),
  require('./verificacao'),
  require('./desvincular'),
  require('./logs'),
  require('./ajuda'),
];

const mapa = new Map(lista.map((c) => [c.data.name, c]));

module.exports = { lista, mapa, json: () => lista.map((c) => c.data.toJSON()) };
