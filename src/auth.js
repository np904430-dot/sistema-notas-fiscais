// Login: usuários com senha (scrypt), sessões por cookie HttpOnly e bloqueio contra tentativas repetidas.
const crypto = require('node:crypto');
const { db } = require('./db');

const COOKIE = 'emissor_sessao';
const DURACAO_SESSAO = 7 * 24 * 3600 * 1000; // 7 dias
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 5 * 60 * 1000;
const falhas = new Map(); // ip -> { n, ate }

class ErroAuth extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 64);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function conferirSenha(senha, guardado) {
  const [alg, salHex, hashHex] = String(guardado).split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = crypto.scryptSync(senha, Buffer.from(salHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, calculado);
}

function validarSenha(senha) {
  if (String(senha || '').length < 8) throw new ErroAuth(400, 'A senha deve ter pelo menos 8 caracteres.');
}

const publico = (u) => u && { id: u.id, nome: u.nome, login: u.login, criado_em: u.criado_em, ultimo_acesso: u.ultimo_acesso };
const haUsuarios = () => Boolean(db.prepare('SELECT 1 FROM usuarios LIMIT 1').get());

/** "Nícolas Pereira" → "nicolas.pereira": sem acentos, minúsculo, espaços viram ponto. Vale no cadastro e no login. */
function normalizarLogin(valor) {
  return String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/\s+/g, '.');
}

function criarUsuario({ nome, login, senha }) {
  nome = String(nome || '').trim();
  login = normalizarLogin(login);
  if (!nome) throw new ErroAuth(400, 'Informe o nome.');
  if (login.length < 3 || login.length > 60) throw new ErroAuth(400, 'O usuário deve ter de 3 a 60 caracteres.');
  const invalidos = [...new Set(login.replace(/[a-z0-9._@-]/g, ''))];
  if (invalidos.length) throw new ErroAuth(400, `O usuário não pode ter estes caracteres: ${invalidos.join(' ')}  — use letras, números, ponto, hífen ou @.`);
  validarSenha(senha);
  if (db.prepare('SELECT 1 FROM usuarios WHERE login = ?').get(login)) throw new ErroAuth(409, 'Este usuário já existe.');
  const r = db.prepare('INSERT INTO usuarios (nome, login, senha_hash) VALUES (?, ?, ?)').run(nome, login, hashSenha(senha));
  return publico(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(r.lastInsertRowid));
}

function lerCookie(req) {
  const c = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  return c ? decodeURIComponent(c.slice(COOKIE.length + 1)) : null;
}

function cookieSessao(token, maxAgeSeg) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeg}`;
}

function abrirSessao(res, usuario) {
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, ?)').run(token, usuario.id, Date.now() + DURACAO_SESSAO);
  db.prepare("UPDATE usuarios SET ultimo_acesso = datetime('now','localtime') WHERE id = ?").run(usuario.id);
  res.setHeader('Set-Cookie', cookieSessao(token, DURACAO_SESSAO / 1000));
}

/** Usuário da sessão atual, ou null. */
function usuarioDaRequisicao(req) {
  const token = lerCookie(req);
  if (!token) return null;
  const u = db.prepare(`SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND s.expira_em > ?`).get(token, Date.now());
  return publico(u) || null;
}

function entrar(req, res, { login, senha }) {
  const ip = req.socket.remoteAddress;
  const f = falhas.get(ip);
  if (f && f.ate > Date.now()) {
    const min = Math.ceil((f.ate - Date.now()) / 60000);
    throw new ErroAuth(429, `Muitas tentativas erradas. Tente novamente em ${min} minuto(s).`);
  }
  const u = db.prepare('SELECT * FROM usuarios WHERE login = ?').get(normalizarLogin(login));
  if (!u || !conferirSenha(String(senha || ''), u.senha_hash)) {
    const n = (f && f.ate === 0 ? f.n : 0) + 1; // bloqueio vencido recomeça a contagem
    falhas.set(ip, { n, ate: n >= MAX_FALHAS ? Date.now() + BLOQUEIO_MS : 0 });
    throw new ErroAuth(401, 'Usuário ou senha incorretos.');
  }
  falhas.delete(ip);
  abrirSessao(res, u);
  return publico(u);
}

function sair(req, res) {
  const token = lerCookie(req);
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', cookieSessao('', 0));
  return { ok: true };
}

/** Primeiro acesso: cria o administrador e já entra. Só funciona enquanto não houver nenhum usuário. */
function configurarPrimeiroAcesso(res, dados) {
  if (haUsuarios()) throw new ErroAuth(403, 'O sistema já possui usuários. Faça login.');
  const u = criarUsuario(dados);
  abrirSessao(res, u);
  return u;
}

function trocarSenha(usuario, { senha_atual, nova_senha }) {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuario.id);
  if (!conferirSenha(String(senha_atual || ''), u.senha_hash)) throw new ErroAuth(400, 'Senha atual incorreta.');
  validarSenha(nova_senha);
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(nova_senha), u.id);
  return { ok: true };
}

function listarUsuarios() {
  return db.prepare('SELECT * FROM usuarios ORDER BY nome').all().map(publico);
}

function excluirUsuario(usuario, id) {
  if (id === usuario.id) throw new ErroAuth(400, 'Você não pode excluir o próprio usuário.');
  const r = db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  if (!r.changes) throw new ErroAuth(404, 'Usuário não encontrado.');
  return { ok: true };
}

module.exports = {
  ErroAuth, haUsuarios, usuarioDaRequisicao, entrar, sair, configurarPrimeiroAcesso,
  criarUsuario, trocarSenha, listarUsuarios, excluirUsuario,
};
