// Banco de dados SQLite embutido no Node (node:sqlite) — sem dependências externas.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// O banco ativo fica FORA do OneDrive/Dropbox: sincronizar um SQLite enquanto ele grava pode corromper o arquivo.
// Os backups (arquivos fechados e completos) é que ficam na pasta do projeto, onde a nuvem pode copiá-los com segurança.
const DATA_DIR = process.env.DATA_DIR
  || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'EmissorNF') : path.join(os.homedir(), '.emissor-nf'));
const ARQUIVO = path.join(DATA_DIR, 'notas.db');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Migração: versões anteriores guardavam o banco em ./data dentro do projeto
const ANTIGO_DIR = path.join(__dirname, '..', 'data');
const ANTIGO = path.join(ANTIGO_DIR, 'notas.db');
if (!fs.existsSync(ARQUIVO) && fs.existsSync(ANTIGO)) {
  const antigo = new DatabaseSync(ANTIGO);
  antigo.exec(`VACUUM INTO '${ARQUIVO.replace(/'/g, "''")}'`);
  antigo.close();
  fs.renameSync(ANTIGO_DIR, path.join(__dirname, '..', 'data-antigo-pode-apagar'));
  console.log(`  Banco migrado para ${ARQUIVO}`);
}

const db = new DatabaseSync(ARQUIVO);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS emitente (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  razao_social TEXT, nome_fantasia TEXT, cnpj TEXT, ie TEXT, im TEXT,
  regime TEXT DEFAULT '1',
  cep TEXT, logradouro TEXT, numero TEXT, complemento TEXT, bairro TEXT,
  municipio TEXT, cod_municipio TEXT, uf TEXT,
  telefone TEXT, email TEXT,
  serie_nfe INTEGER DEFAULT 1, proximo_nfe INTEGER DEFAULT 1,
  serie_nfse INTEGER DEFAULT 1, proximo_nfse INTEGER DEFAULT 1,
  ambiente TEXT DEFAULT 'homologacao',
  provedor TEXT DEFAULT 'simulacao',
  token TEXT
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'PJ',
  nome TEXT NOT NULL, documento TEXT NOT NULL, ie TEXT,
  email TEXT, telefone TEXT,
  cep TEXT, logradouro TEXT, numero TEXT, bairro TEXT, municipio TEXT, cod_municipio TEXT, uf TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'produto',
  codigo TEXT, descricao TEXT NOT NULL,
  ncm TEXT, cfop TEXT DEFAULT '5102', unidade TEXT DEFAULT 'UN',
  preco REAL NOT NULL DEFAULT 0,
  aliq_icms REAL DEFAULT 0, aliq_ipi REAL DEFAULT 0,
  aliq_pis REAL DEFAULT 0, aliq_cofins REAL DEFAULT 0,
  aliq_iss REAL DEFAULT 0, codigo_servico TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  numero INTEGER, serie INTEGER,
  natureza TEXT,
  cliente_id INTEGER REFERENCES clientes(id),
  cliente_json TEXT NOT NULL,
  emitente_json TEXT NOT NULL,
  itens_json TEXT NOT NULL,
  totais_json TEXT NOT NULL,
  valor_total REAL NOT NULL,
  observacoes TEXT,
  forma_pagamento TEXT,
  status TEXT NOT NULL DEFAULT 'processando',
  ambiente TEXT,
  provedor TEXT,
  ref TEXT,
  chave TEXT, protocolo TEXT, motivo TEXT,
  emitida_em TEXT DEFAULT (datetime('now','localtime')),
  cancelada_em TEXT, justificativa_cancelamento TEXT
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  ultimo_acesso TEXT
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS cartas_correcao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id INTEGER NOT NULL REFERENCES notas(id),
  sequencia INTEGER NOT NULL,
  texto TEXT NOT NULL,
  protocolo TEXT, motivo TEXT,
  criada_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inutilizacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serie INTEGER NOT NULL,
  numero_inicial INTEGER NOT NULL,
  numero_final INTEGER NOT NULL,
  justificativa TEXT NOT NULL,
  ambiente TEXT, provedor TEXT,
  protocolo TEXT, motivo TEXT,
  criada_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS envios_email (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id INTEGER NOT NULL REFERENCES notas(id),
  destinatarios TEXT NOT NULL,
  via TEXT, enviado_em TEXT DEFAULT (datetime('now','localtime'))
);
`);

// Colunas acrescentadas depois da primeira versão (bancos antigos ganham as colunas sem perder dados)
function garantirColunas(tabela, colunas) {
  const existentes = new Set(db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name));
  for (const [nome, definicao] of Object.entries(colunas)) {
    if (!existentes.has(nome)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${definicao}`);
  }
}
garantirColunas('emitente', {
  ibs_cbs_destacar: "TEXT DEFAULT 'auto'",
  aliq_cbs: 'REAL DEFAULT 0.9', aliq_ibs_uf: 'REAL DEFAULT 0.1', aliq_ibs_mun: 'REAL DEFAULT 0',
  smtp_host: 'TEXT', smtp_porta: 'INTEGER DEFAULT 587', smtp_seguranca: "TEXT DEFAULT 'starttls'",
  smtp_usuario: 'TEXT', smtp_senha: 'TEXT', smtp_remetente: 'TEXT',
});
garantirColunas('produtos', { cst_ibs_cbs: "TEXT DEFAULT '000'", cclass_trib: "TEXT DEFAULT '000001'" });

db.prepare('INSERT OR IGNORE INTO emitente (id) VALUES (1)').run();

// node:sqlite não aceita undefined como parâmetro
function limpar(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === undefined || v === '' ? null : typeof v === 'boolean' ? Number(v) : v;
  }
  return out;
}

module.exports = { db, limpar, DATA_DIR, ARQUIVO };
