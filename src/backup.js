// Backups do banco: cópias completas e consistentes (VACUUM INTO) gravadas na pasta backups/ do projeto.
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const INTERVALO_MS = 6 * 3600 * 1000; // a cada 6 horas com o sistema ligado
const MANTER = 30;                     // quantidade de backups guardados
const NOME_VALIDO = /^notas-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/;

fs.mkdirSync(BACKUP_DIR, { recursive: true });

function carimbo(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function listarBackups() {
  return fs.readdirSync(BACKUP_DIR)
    .filter((n) => NOME_VALIDO.test(n))
    .map((nome) => {
      const st = fs.statSync(path.join(BACKUP_DIR, nome));
      return { nome, tamanho: st.size, criado_em: st.mtime.toISOString() };
    })
    .sort((a, b) => b.nome.localeCompare(a.nome));
}

function fazerBackup() {
  const nome = `notas-${carimbo()}.db`;
  const destino = path.join(BACKUP_DIR, nome);
  // Grava num arquivo temporário e renomeia: a nuvem nunca vê um backup pela metade
  const temp = destino + '.tmp';
  db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
  fs.renameSync(temp, destino);
  for (const antigo of listarBackups().slice(MANTER)) fs.rmSync(path.join(BACKUP_DIR, antigo.nome));
  return listarBackups().find((b) => b.nome === nome);
}

function caminhoBackup(nome) {
  if (!NOME_VALIDO.test(nome)) return null;
  const p = path.join(BACKUP_DIR, nome);
  return fs.existsSync(p) ? p : null;
}

/** Faz um backup ao iniciar (se o último tiver mais de 6h) e depois a cada 6h. */
function iniciarBackupAutomatico() {
  const tentar = () => {
    try {
      const ultimo = listarBackups()[0];
      if (!ultimo || Date.now() - new Date(ultimo.criado_em).getTime() >= INTERVALO_MS - 60000) {
        const b = fazerBackup();
        console.log(`  Backup automático: ${b.nome}`);
      }
    } catch (err) {
      console.error('  Falha no backup automático:', err.message);
    }
  };
  tentar();
  setInterval(tentar, INTERVALO_MS).unref();
}

module.exports = { BACKUP_DIR, listarBackups, fazerBackup, caminhoBackup, iniciarBackupAutomatico };
