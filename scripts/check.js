'use strict';

// Verificação rápida: sintaxe de todos os arquivos + validação dos comandos slash.
// Uso: npm run check
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.join(__dirname, '..');

function listar(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : listar(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

let falhou = false;
for (const arquivo of [...listar(path.join(raiz, 'src')), ...listar(path.join(raiz, 'scripts'))]) {
  const r = spawnSync(process.execPath, ['--check', arquivo], { encoding: 'utf8' });
  if (r.status !== 0) {
    falhou = true;
    console.error(`❌ Erro de sintaxe em ${path.relative(raiz, arquivo)}\n${r.stderr}`);
  }
}
if (!falhou) console.log('✅ Sintaxe OK em todos os arquivos.');

try {
  require.resolve('discord.js');
  const comandos = require('../src/commands');
  const nomes = comandos.json().map((c) => `/${c.name}`);
  console.log(`✅ Comandos válidos: ${nomes.join(' ')}`);
} catch (err) {
  falhou = true;
  console.error('❌ Não foi possível validar os comandos (rode "npm install" primeiro):', err.message);
}

process.exit(falhou ? 1 : 0);
