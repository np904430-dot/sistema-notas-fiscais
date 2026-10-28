// Envio de e-mail por SMTP, sem dependências: TLS direto (porta 465) ou STARTTLS (porta 587).
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const crypto = require('node:crypto');

const EMAIL_VALIDO = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const semQuebra = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim(); // impede injeção de cabeçalhos

function cabecalhoUtf8(texto) {
  const t = semQuebra(texto);
  return /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`;
}

const base64Linhas = (buf) => buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');

/** Monta a mensagem MIME: corpo HTML + texto e anexos ({ nome, tipo, conteudo }). */
function montarMensagem({ de, deNome, para, assunto, html, texto, anexos = [] }) {
  const mix = 'mix_' + crypto.randomBytes(8).toString('hex');
  const alt = 'alt_' + crypto.randomBytes(8).toString('hex');
  const partes = [
    `From: ${deNome ? `${cabecalhoUtf8(deNome)} ` : ''}<${de}>`,
    `To: ${para.map((p) => `<${p}>`).join(', ')}`,
    `Subject: ${cabecalhoUtf8(assunto)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${de.split('@')[1]}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mix}"`,
    '',
    `--${mix}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Linhas(Buffer.from(texto, 'utf8')),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Linhas(Buffer.from(html, 'utf8')),
    `--${alt}--`,
  ];
  for (const a of anexos) {
    const nome = semQuebra(a.nome).replace(/"/g, '');
    partes.push(`--${mix}`, `Content-Type: ${a.tipo}; name="${nome}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${nome}"`, '', base64Linhas(Buffer.from(a.conteudo)));
  }
  partes.push(`--${mix}--`, '');
  return partes.join('\r\n');
}

/** Conversa SMTP linha a linha: cada comando espera a resposta completa (inclusive multilinha "250-..."). */
function criarSessao(socket, tempoLimite) {
  let sock = socket;
  let buffer = '';
  let pendente = null;

  const aoDados = (chunk) => {
    buffer += chunk.toString('utf8');
    const linhas = buffer.split('\r\n');
    // resposta completa: última linha não vazia no formato "123 texto"
    const completas = linhas.slice(0, -1);
    const ultima = completas[completas.length - 1];
    if (pendente && ultima && /^\d{3} /.test(ultima)) {
      const resp = { codigo: Number(ultima.slice(0, 3)), texto: completas.join('\n') };
      buffer = linhas[linhas.length - 1];
      const p = pendente; pendente = null;
      clearTimeout(p.timer);
      p.resolve(resp);
    }
  };
  const aoErro = (err) => { if (pendente) { clearTimeout(pendente.timer); pendente.reject(err); pendente = null; } };

  const ligar = (s) => { s.on('data', aoDados); s.on('error', aoErro); };
  ligar(sock);

  const esperar = () => new Promise((resolve, reject) => {
    pendente = { resolve, reject, timer: setTimeout(() => reject(new Error('Tempo esgotado aguardando o servidor de e-mail.')), tempoLimite) };
    aoDados(Buffer.alloc(0)); // caso a resposta já esteja no buffer
  });

  return {
    esperar,
    async comando(linha, esperado) {
      const r = esperar();
      sock.write(linha + '\r\n');
      const resp = await r;
      if (esperado && !esperado.includes(resp.codigo)) {
        throw new Error(`Servidor de e-mail recusou (${resp.codigo}): ${resp.texto.split('\n').pop().slice(4)}`);
      }
      return resp;
    },
    async iniciarTls(host) {
      sock.removeListener('data', aoDados);
      sock = await new Promise((resolve, reject) => {
        const s = tls.connect({ socket: sock, servername: host }, () => resolve(s));
        s.once('error', reject);
      });
      ligar(sock);
    },
    fechar() { sock.end(); },
  };
}

/**
 * Envia um e-mail. config: { host, porta, seguranca: 'ssl'|'starttls'|'nenhuma', usuario, senha, remetente, remetenteNome }
 */
async function enviarEmail(config, mensagem) {
  try {
    return await conversar(config, mensagem);
  } catch (err) {
    err.status ||= 502; // problema de configuração/servidor de e-mail, não erro interno do sistema
    throw err;
  }
}

async function conversar(config, mensagem) {
  const host = semQuebra(config.host);
  const porta = Number(config.porta) || (config.seguranca === 'ssl' ? 465 : 587);
  if (!host) throw new Error('Configure o servidor de e-mail (SMTP) em Configurações.');
  const de = semQuebra(config.remetente || config.usuario);
  if (!EMAIL_VALIDO.test(de)) throw new Error('E-mail do remetente inválido em Configurações → E-mail.');
  const para = (mensagem.para || []).map(semQuebra).filter(Boolean);
  if (!para.length || !para.every((p) => EMAIL_VALIDO.test(p))) throw new Error('Informe e-mails de destino válidos.');

  const tempo = 20000;
  const socket = await new Promise((resolve, reject) => {
    const s = config.seguranca === 'ssl'
      ? tls.connect({ host, port: porta, servername: host }, () => resolve(s))
      : net.connect({ host, port: porta }, () => resolve(s));
    s.setTimeout(tempo, () => s.destroy(new Error('Tempo esgotado conectando ao servidor de e-mail.')));
    s.once('error', (e) => reject(new Error(`Não foi possível conectar a ${host}:${porta} (${e.code || e.message}).`)));
  });

  const smtp = criarSessao(socket, tempo);
  try {
    const saudacao = await smtp.esperar();
    if (saudacao.codigo !== 220) throw new Error(`Servidor de e-mail indisponível: ${saudacao.texto}`);
    const nomeLocal = os.hostname().replace(/[^a-zA-Z0-9.-]/g, '') || 'localhost';
    let ehlo = await smtp.comando(`EHLO ${nomeLocal}`, [250]);
    if (config.seguranca === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.texto)) throw new Error('O servidor não oferece STARTTLS. Tente a opção SSL (porta 465).');
      await smtp.comando('STARTTLS', [220]);
      await smtp.iniciarTls(host);
      ehlo = await smtp.comando(`EHLO ${nomeLocal}`, [250]);
    }
    if (config.usuario) {
      const plain = Buffer.from(`\0${config.usuario}\0${config.senha || ''}`, 'utf8').toString('base64');
      await smtp.comando(`AUTH PLAIN ${plain}`, [235]).catch((err) => {
        throw new Error(`Usuário ou senha do e-mail recusados. ${err.message}`);
      });
    }
    await smtp.comando(`MAIL FROM:<${de}>`, [250]);
    for (const p of para) await smtp.comando(`RCPT TO:<${p}>`, [250, 251]);
    await smtp.comando('DATA', [354]);
    const corpo = montarMensagem({ ...mensagem, de, deNome: config.remetenteNome, para })
      .replace(/\r\n\./g, '\r\n..'); // "dot-stuffing" do protocolo SMTP
    await smtp.comando(`${corpo}\r\n.`, [250]);
    await smtp.comando('QUIT').catch(() => {});
  } finally {
    smtp.fechar();
  }
  return { para };
}

module.exports = { enviarEmail, EMAIL_VALIDO };
