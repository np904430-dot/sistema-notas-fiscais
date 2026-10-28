// Servidor HTTP do sistema de notas fiscais — Node.js puro, sem dependências.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db, limpar } = require('./src/db');
const { soDigitos, validarDocumento, validarCNPJ } = require('./src/validacao');
const { calcularNota, gerarChaveAcesso, gerarXmlNFe, gerarXmlNFSe } = require('./src/fiscal');
const { obterProvedor } = require('./src/provedores');
const auth = require('./src/auth');
const backup = require('./src/backup');
const { enviarEmail, EMAIL_VALIDO } = require('./src/email');

const PORTA = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');

class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}
const falha = (status, msg) => { throw new ErroHttp(status, msg); };

// ---------------------------------------------------------------------------
// Emitente
// ---------------------------------------------------------------------------
const CAMPOS_EMITENTE = ['razao_social', 'nome_fantasia', 'cnpj', 'ie', 'im', 'regime', 'cep', 'logradouro', 'numero',
  'complemento', 'bairro', 'municipio', 'cod_municipio', 'uf', 'telefone', 'email', 'serie_nfe', 'proximo_nfe',
  'serie_nfse', 'proximo_nfse', 'ambiente', 'provedor', 'token',
  'ibs_cbs_destacar', 'aliq_cbs', 'aliq_ibs_uf', 'aliq_ibs_mun',
  'smtp_host', 'smtp_porta', 'smtp_seguranca', 'smtp_usuario', 'smtp_senha', 'smtp_remetente'];

/** Emitente sem senhas/tokens — é o que vai para a tela e para a cópia gravada em cada nota. */
function semSegredos(e) {
  const { token, smtp_senha, smtp_usuario, smtp_host, smtp_porta, smtp_seguranca, smtp_remetente, ...resto } = e;
  return resto;
}

function lerEmitente({ comToken = false } = {}) {
  const e = db.prepare('SELECT * FROM emitente WHERE id = 1').get();
  if (comToken) return e;
  return {
    ...semSegredos(e),
    smtp_host: e.smtp_host, smtp_porta: e.smtp_porta, smtp_seguranca: e.smtp_seguranca,
    smtp_usuario: e.smtp_usuario, smtp_remetente: e.smtp_remetente,
    token_configurado: Boolean(e.token), smtp_senha_configurada: Boolean(e.smtp_senha),
  };
}

function salvarEmitente(dados) {
  if (dados.cnpj && !validarCNPJ(dados.cnpj)) falha(400, 'CNPJ do emitente inválido.');
  for (const a of ['aliq_cbs', 'aliq_ibs_uf', 'aliq_ibs_mun']) {
    if (a in dados && !(Number(dados[a]) >= 0 && Number(dados[a]) <= 100)) falha(400, 'Alíquota de IBS/CBS inválida.');
  }
  const atual = lerEmitente({ comToken: true });
  const novo = { ...atual };
  for (const c of CAMPOS_EMITENTE) if (c in dados) novo[c] = dados[c];
  if (!dados.token) novo.token = atual.token; // em branco = manter o atual
  if (!dados.smtp_senha) novo.smtp_senha = atual.smtp_senha;
  novo.cnpj = soDigitos(novo.cnpj);
  const sets = CAMPOS_EMITENTE.map((c) => `${c} = :${c}`).join(', ');
  db.prepare(`UPDATE emitente SET ${sets} WHERE id = 1`).run(limpar(Object.fromEntries(CAMPOS_EMITENTE.map((c) => [c, novo[c]]))));
  return lerEmitente();
}

// ---------------------------------------------------------------------------
// CRUD genérico para clientes e produtos
// ---------------------------------------------------------------------------
const TABELAS = {
  clientes: {
    campos: ['tipo', 'nome', 'documento', 'ie', 'email', 'telefone', 'cep', 'logradouro', 'numero', 'bairro', 'municipio', 'cod_municipio', 'uf'],
    busca: ['nome', 'documento', 'email'],
    ordem: 'nome',
    validar(d) {
      if (!d.nome?.trim()) falha(400, 'Informe o nome/razão social do cliente.');
      d.documento = soDigitos(d.documento);
      if (!validarDocumento(d.documento)) falha(400, 'CPF/CNPJ do cliente inválido.');
      d.tipo = d.documento.length === 11 ? 'PF' : 'PJ';
      const dup = db.prepare('SELECT id FROM clientes WHERE documento = ? AND id <> ?').get(d.documento, d.id ?? 0);
      if (dup) falha(409, 'Já existe um cliente com este CPF/CNPJ.');
    },
  },
  produtos: {
    campos: ['tipo', 'codigo', 'descricao', 'ncm', 'cfop', 'unidade', 'preco', 'aliq_icms', 'aliq_ipi', 'aliq_pis', 'aliq_cofins', 'aliq_iss', 'codigo_servico', 'cst_ibs_cbs', 'cclass_trib'],
    busca: ['descricao', 'codigo', 'ncm'],
    ordem: 'descricao',
    validar(d) {
      if (!d.descricao?.trim()) falha(400, 'Informe a descrição.');
      if (!(Number(d.preco) >= 0)) falha(400, 'Preço inválido.');
      if (d.tipo !== 'servico') {
        if (soDigitos(d.ncm).length !== 8) falha(400, 'NCM deve ter 8 dígitos.');
        if (soDigitos(d.cfop).length !== 4) falha(400, 'CFOP deve ter 4 dígitos.');
      }
      for (const a of ['preco', 'aliq_icms', 'aliq_ipi', 'aliq_pis', 'aliq_cofins', 'aliq_iss']) d[a] = Number(d[a]) || 0;
      d.cst_ibs_cbs = soDigitos(d.cst_ibs_cbs) || '000';
      d.cclass_trib = soDigitos(d.cclass_trib) || '000001';
      if (d.cst_ibs_cbs.length !== 3) falha(400, 'CST de IBS/CBS deve ter 3 dígitos.');
      if (d.cclass_trib.length !== 6) falha(400, 'Classificação tributária (cClassTrib) deve ter 6 dígitos.');
    },
  },
};

function listar(tabela, q) {
  const t = TABELAS[tabela];
  if (!q) return db.prepare(`SELECT * FROM ${tabela} ORDER BY ${t.ordem}`).all();
  const onde = t.busca.map((c) => `${c} LIKE :q`).join(' OR ');
  return db.prepare(`SELECT * FROM ${tabela} WHERE ${onde} ORDER BY ${t.ordem}`).all({ q: `%${q}%` });
}

function salvar(tabela, dados, id) {
  const t = TABELAS[tabela];
  const d = { ...dados, id };
  t.validar(d);
  const valores = limpar(Object.fromEntries(t.campos.map((c) => [c, d[c]])));
  if (id) {
    const r = db.prepare(`UPDATE ${tabela} SET ${t.campos.map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id`).run({ ...valores, id });
    if (!r.changes) falha(404, 'Registro não encontrado.');
    return db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(id);
  }
  const r = db.prepare(`INSERT INTO ${tabela} (${t.campos.join(', ')}) VALUES (${t.campos.map((c) => ':' + c).join(', ')})`).run(valores);
  return db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(r.lastInsertRowid);
}

function excluir(tabela, id) {
  if (tabela === 'clientes' && db.prepare('SELECT 1 FROM notas WHERE cliente_id = ?').get(id)) {
    falha(409, 'Cliente possui notas emitidas e não pode ser excluído.');
  }
  const r = db.prepare(`DELETE FROM ${tabela} WHERE id = ?`).run(id);
  if (!r.changes) falha(404, 'Registro não encontrado.');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notas fiscais
// ---------------------------------------------------------------------------
function hidratar(row) {
  if (!row) return row;
  const { cliente_json, emitente_json, itens_json, totais_json, ...n } = row;
  return { ...n, cliente: JSON.parse(cliente_json), emitente: JSON.parse(emitente_json), itens: JSON.parse(itens_json), totais: JSON.parse(totais_json) };
}

function obterNota(id) {
  const n = hidratar(db.prepare('SELECT * FROM notas WHERE id = ?').get(id));
  if (!n) falha(404, 'Nota não encontrada.');
  n.cartas = db.prepare('SELECT * FROM cartas_correcao WHERE nota_id = ? ORDER BY sequencia').all(id);
  n.emails = db.prepare('SELECT * FROM envios_email WHERE nota_id = ? ORDER BY id DESC').all(id);
  return n;
}

function listarNotas({ tipo, status, q, de, ate }) {
  const cond = [];
  const p = {};
  if (tipo) { cond.push('tipo = :tipo'); p.tipo = tipo; }
  if (status) { cond.push('status = :status'); p.status = status; }
  if (de) { cond.push('date(emitida_em) >= :de'); p.de = de; }
  if (ate) { cond.push('date(emitida_em) <= :ate'); p.ate = ate; }
  if (q) { cond.push("(CAST(numero AS TEXT) = :qn OR cliente_json LIKE :q OR chave LIKE :q)"); p.q = `%${q}%`; p.qn = q; }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return db.prepare(`SELECT * FROM notas ${where} ORDER BY id DESC LIMIT 500`).all(p).map(hidratar);
}

function validarEmitentePara(tipo, e) {
  const faltando = [];
  if (!e.razao_social) faltando.push('razão social');
  if (!validarCNPJ(e.cnpj)) faltando.push('CNPJ válido');
  if (!e.uf) faltando.push('UF');
  if (!e.municipio) faltando.push('município');
  if (tipo === 'NFe' && !e.ie) faltando.push('inscrição estadual');
  if (tipo === 'NFSe' && !e.im) faltando.push('inscrição municipal');
  if (faltando.length) falha(400, `Complete os dados do emitente em Configurações: ${faltando.join(', ')}.`);
}

function paraProvedor(nota, emitenteAtual) {
  return { ...nota, token: emitenteAtual.token };
}

function aplicarRetorno(id, ret) {
  db.prepare(`UPDATE notas SET status = :status, chave = COALESCE(:chave, chave), protocolo = COALESCE(:protocolo, protocolo),
    numero = COALESCE(:numero, numero), motivo = :motivo WHERE id = :id`)
    .run(limpar({ id, status: ret.status, chave: ret.chave, protocolo: ret.protocolo, numero: ret.numero, motivo: ret.motivo }));
}

async function emitirNota(dados) {
  const tipo = dados.tipo === 'NFSe' ? 'NFSe' : 'NFe';
  const emitente = lerEmitente({ comToken: true });
  validarEmitentePara(tipo, emitente);

  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(dados.cliente_id));
  if (!cliente) falha(400, 'Selecione um cliente/destinatário.');
  if (!dados.itens?.length) falha(400, 'Adicione ao menos um item.');

  dados.itens.forEach((it, i) => {
    if (!String(it.descricao || '').trim()) falha(400, `Item ${i + 1}: descrição obrigatória.`);
    if (!(Number(it.quantidade) > 0)) falha(400, `Item ${i + 1}: quantidade deve ser maior que zero.`);
    if (!(Number(it.valor_unitario) > 0)) falha(400, `Item ${i + 1}: valor unitário deve ser maior que zero.`);
    if (tipo === 'NFe' && soDigitos(it.ncm).length !== 8) falha(400, `Item ${i + 1}: NCM deve ter 8 dígitos.`);
    if (tipo === 'NFe' && soDigitos(it.cfop).length !== 4) falha(400, `Item ${i + 1}: CFOP deve ter 4 dígitos.`);
  });

  const { itens, totais } = calcularNota(tipo, dados.itens, emitente, dados);
  if (!(totais.valor_total > 0)) falha(400, 'O valor total da nota deve ser maior que zero.');

  const emitenteSnapshot = semSegredos(emitente);
  const campoNum = tipo === 'NFe' ? 'proximo_nfe' : 'proximo_nfse';
  const campoSerie = tipo === 'NFe' ? 'serie_nfe' : 'serie_nfse';

  // Reserva o número e grava a nota numa transação para não haver números duplicados
  db.exec('BEGIN IMMEDIATE');
  let id;
  try {
    const { [campoNum]: numero, [campoSerie]: serie } = db.prepare(`SELECT ${campoNum}, ${campoSerie} FROM emitente WHERE id = 1`).get();
    db.prepare(`UPDATE emitente SET ${campoNum} = ${campoNum} + 1 WHERE id = 1`).run();
    const r = db.prepare(`INSERT INTO notas (tipo, numero, serie, natureza, cliente_id, cliente_json, emitente_json, itens_json, totais_json,
      valor_total, observacoes, forma_pagamento, status, ambiente, provedor, ref)
      VALUES (:tipo, :numero, :serie, :natureza, :cliente_id, :cliente_json, :emitente_json, :itens_json, :totais_json,
      :valor_total, :observacoes, :forma_pagamento, 'processando', :ambiente, :provedor, :ref)`).run(limpar({
      tipo, numero, serie,
      natureza: dados.natureza || (tipo === 'NFe' ? 'Venda de mercadoria' : 'Prestação de serviço'),
      cliente_id: cliente.id,
      cliente_json: JSON.stringify(cliente),
      emitente_json: JSON.stringify(emitenteSnapshot),
      itens_json: JSON.stringify(itens),
      totais_json: JSON.stringify(totais),
      valor_total: totais.valor_total,
      observacoes: dados.observacoes,
      forma_pagamento: dados.forma_pagamento || '01',
      ambiente: emitente.ambiente,
      provedor: emitente.provedor,
      ref: `${tipo}-${soDigitos(emitente.cnpj)}-${serie}-${numero}-${Date.now()}`,
    }));
    id = Number(r.lastInsertRowid);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  await transmitir(id, emitente);
  return obterNota(id);
}

async function transmitir(id, emitente = lerEmitente({ comToken: true })) {
  const nota = obterNota(id);
  try {
    const ret = await obterProvedor(nota.provedor).emitir(paraProvedor(nota, emitente));
    aplicarRetorno(id, ret);
  } catch (err) {
    aplicarRetorno(id, { status: 'rejeitada', motivo: err.message });
  }
}

async function consultarNota(id) {
  const nota = obterNota(id);
  const ret = await obterProvedor(nota.provedor).consultar(paraProvedor(nota, lerEmitente({ comToken: true })));
  aplicarRetorno(id, ret);
  return obterNota(id);
}

async function reenviarNota(id) {
  const nota = obterNota(id);
  if (nota.status !== 'rejeitada') falha(400, 'Somente notas rejeitadas podem ser reenviadas.');
  db.prepare("UPDATE notas SET status = 'processando', motivo = NULL WHERE id = ?").run(id);
  await transmitir(id);
  return obterNota(id);
}

async function cancelarNota(id, justificativa) {
  const nota = obterNota(id);
  if (nota.status !== 'autorizada') falha(400, 'Somente notas autorizadas podem ser canceladas.');
  justificativa = String(justificativa || '').trim();
  if (justificativa.length < 15) falha(400, 'A justificativa deve ter no mínimo 15 caracteres.');
  if (nota.tipo === 'NFe') {
    const horas = (Date.now() - new Date(nota.emitida_em.replace(' ', 'T')).getTime()) / 36e5;
    if (horas > 24) falha(400, 'O prazo de cancelamento da NF-e (24h) expirou. Emita uma nota de devolução/estorno.');
  }
  const ret = await obterProvedor(nota.provedor).cancelar(paraProvedor(nota, lerEmitente({ comToken: true })), justificativa);
  if (ret.status !== 'cancelada') falha(422, ret.motivo || 'Cancelamento não homologado.');
  db.prepare(`UPDATE notas SET status = 'cancelada', motivo = ?, justificativa_cancelamento = ?,
    cancelada_em = datetime('now','localtime') WHERE id = ?`).run(ret.motivo || 'Cancelada', justificativa, id);
  return obterNota(id);
}

function xmlDaNota(id) {
  const nota = obterNota(id);
  if (nota.tipo === 'NFe') {
    nota.chave ||= gerarChaveAcesso({ uf: nota.emitente.uf, cnpj: nota.emitente.cnpj, serie: nota.serie, numero: nota.numero });
    return { nome: `NFe${nota.chave}.xml`, xml: gerarXmlNFe(nota) };
  }
  return { nome: `NFSe-${nota.serie}-${nota.numero}.xml`, xml: gerarXmlNFSe(nota) };
}

// ---------------------------------------------------------------------------
// Carta de correção (CC-e) — corrige erros que não alteram valores, impostos, partes ou data
// ---------------------------------------------------------------------------
async function cartaCorrecao(id, texto) {
  const nota = obterNota(id);
  if (nota.tipo !== 'NFe') falha(400, 'Carta de correção existe apenas para NF-e.');
  if (nota.status !== 'autorizada') falha(400, 'Somente NF-e autorizada pode receber carta de correção.');
  texto = String(texto || '').replace(/\s+/g, ' ').trim();
  if (texto.length < 15 || texto.length > 1000) falha(400, 'O texto da correção deve ter entre 15 e 1000 caracteres.');
  const sequencia = (db.prepare('SELECT MAX(sequencia) s FROM cartas_correcao WHERE nota_id = ?').get(id).s || 0) + 1;
  if (sequencia > 20) falha(400, 'Limite de 20 cartas de correção por NF-e atingido.');
  const ret = await obterProvedor(nota.provedor).cartaCorrecao(paraProvedor(nota, lerEmitente({ comToken: true })), texto, sequencia);
  if (!ret.ok) falha(422, `Carta de correção rejeitada: ${ret.motivo || 'sem detalhes'}`);
  db.prepare('INSERT INTO cartas_correcao (nota_id, sequencia, texto, protocolo, motivo) VALUES (?, ?, ?, ?, ?)')
    .run(id, ret.sequencia || sequencia, texto, ret.protocolo ?? null, ret.motivo ?? null);
  return obterNota(id);
}

// ---------------------------------------------------------------------------
// Inutilização de numeração da NF-e (números pulados ou rejeitados que nunca serão usados)
// ---------------------------------------------------------------------------
function listarInutilizacoes() {
  return db.prepare('SELECT * FROM inutilizacoes ORDER BY id DESC').all();
}

async function inutilizar(dados) {
  const emitente = lerEmitente({ comToken: true });
  validarEmitentePara('NFe', emitente);
  const serie = Number(dados.serie ?? emitente.serie_nfe);
  const inicial = Number(dados.numero_inicial);
  const final = Number(dados.numero_final || dados.numero_inicial);
  const justificativa = String(dados.justificativa || '').replace(/\s+/g, ' ').trim();
  if (!Number.isInteger(serie) || serie < 0 || serie > 999) falha(400, 'Série inválida.');
  if (!Number.isInteger(inicial) || inicial < 1 || !Number.isInteger(final) || final < inicial) falha(400, 'Faixa de números inválida.');
  if (final - inicial > 9999) falha(400, 'Inutilize no máximo 10.000 números por vez.');
  if (justificativa.length < 15 || justificativa.length > 255) falha(400, 'A justificativa deve ter entre 15 e 255 caracteres.');

  const usada = db.prepare(`SELECT numero FROM notas WHERE tipo = 'NFe' AND serie = ? AND numero BETWEEN ? AND ?
    AND status IN ('autorizada', 'cancelada', 'processando') LIMIT 1`).get(serie, inicial, final);
  if (usada) falha(400, `A NF-e nº ${usada.numero} (série ${serie}) já foi usada e não pode ser inutilizada.`);
  const sobreposta = db.prepare('SELECT * FROM inutilizacoes WHERE serie = ? AND numero_inicial <= ? AND numero_final >= ? LIMIT 1').get(serie, final, inicial);
  if (sobreposta) falha(400, `Os números ${sobreposta.numero_inicial} a ${sobreposta.numero_final} da série ${serie} já foram inutilizados.`);

  const ctx = { token: emitente.token, ambiente: emitente.ambiente };
  const ret = await obterProvedor(emitente.provedor).inutilizar(ctx, {
    cnpj: soDigitos(emitente.cnpj), serie, numero_inicial: inicial, numero_final: final, justificativa,
  });
  if (!ret.ok) falha(422, `Inutilização rejeitada: ${ret.motivo || 'sem detalhes'}`);
  db.prepare(`INSERT INTO inutilizacoes (serie, numero_inicial, numero_final, justificativa, ambiente, provedor, protocolo, motivo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(serie, inicial, final, justificativa, emitente.ambiente, emitente.provedor, ret.protocolo ?? null, ret.motivo ?? null);
  // Se a faixa inclui o próximo número, pula para depois dela
  if (serie === emitente.serie_nfe && emitente.proximo_nfe >= inicial && emitente.proximo_nfe <= final) {
    db.prepare('UPDATE emitente SET proximo_nfe = ? WHERE id = 1').run(final + 1);
  }
  return listarInutilizacoes()[0];
}

// ---------------------------------------------------------------------------
// Envio da nota por e-mail: pela Focus NFe (DANFE em PDF + XML) ou pelo SMTP configurado (resumo + XML)
// ---------------------------------------------------------------------------
function configSmtp(e) {
  return {
    host: e.smtp_host, porta: e.smtp_porta, seguranca: e.smtp_seguranca, usuario: e.smtp_usuario,
    senha: e.smtp_senha, remetente: e.smtp_remetente || e.email || e.smtp_usuario, remetenteNome: e.nome_fantasia || e.razao_social,
  };
}

const moedaBR = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function enviarNotaPorEmail(id, destinatarios) {
  const nota = obterNota(id);
  if (!['autorizada', 'cancelada'].includes(nota.status)) falha(400, 'Só é possível enviar notas autorizadas ou canceladas.');
  const emails = [...new Set((Array.isArray(destinatarios) ? destinatarios : String(destinatarios || '').split(/[,;\s]+/))
    .map((s) => s.trim()).filter(Boolean))];
  if (!emails.length) falha(400, 'Informe ao menos um e-mail.');
  if (emails.length > 10) falha(400, 'Envie para no máximo 10 e-mails por vez.');
  const invalido = emails.find((m) => !EMAIL_VALIDO.test(m));
  if (invalido) falha(400, `E-mail inválido: ${invalido}`);

  const emitente = lerEmitente({ comToken: true });
  const provedor = obterProvedor(nota.provedor);
  let via;
  if (provedor.enviarEmail) {
    await provedor.enviarEmail(paraProvedor(nota, emitente), emails);
    via = 'focusnfe';
  } else {
    const e = nota.emitente;
    const rotulo = nota.tipo === 'NFe' ? 'NF-e' : 'NFS-e';
    const nome = e.nome_fantasia || e.razao_social;
    const { nome: arquivo, xml } = xmlDaNota(id);
    const linhas = [
      ['Número', `${nota.numero} (série ${nota.serie})`],
      ['Emissão', nota.emitida_em],
      ['Valor total', moedaBR(nota.valor_total)],
      nota.tipo === 'NFe' ? ['Chave de acesso', (nota.chave || '').replace(/(\d{4})/g, '$1 ').trim()] : ['Código de verificação', nota.protocolo],
    ];
    const avisos = [
      nota.ambiente !== 'producao' && 'Documento emitido em ambiente de homologação — SEM VALOR FISCAL.',
      nota.status === 'cancelada' && `Esta nota foi CANCELADA em ${nota.cancelada_em}.`,
    ].filter(Boolean);
    await enviarEmail(configSmtp(emitente), {
      para: emails,
      assunto: `${rotulo} nº ${nota.numero} — ${nome}`,
      texto: `Olá, ${nota.cliente.nome}.\n\nSegue em anexo o XML da ${rotulo} nº ${nota.numero} emitida por ${e.razao_social}.\n\n`
        + linhas.map(([k, v]) => `${k}: ${v}`).join('\n') + (avisos.length ? `\n\n${avisos.join('\n')}` : '')
        + (nota.tipo === 'NFe' ? '\n\nConsulte a autenticidade em https://www.nfe.fazenda.gov.br/portal' : ''),
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1b2420;max-width:560px">
        <p>Olá, ${escHtml(nota.cliente.nome)}.</p>
        <p>Segue em anexo o XML da <b>${rotulo} nº ${nota.numero}</b> emitida por <b>${escHtml(e.razao_social)}</b>.</p>
        <table style="border-collapse:collapse;width:100%">${linhas.map(([k, v]) => `<tr><td style="padding:6px 0;color:#5d6862;width:40%">${k}</td><td style="padding:6px 0"><b>${escHtml(v)}</b></td></tr>`).join('')}</table>
        ${avisos.map((a) => `<p style="background:#fdf2e2;color:#7a3e06;padding:10px;border-radius:6px">${escHtml(a)}</p>`).join('')}
        ${nota.tipo === 'NFe' ? '<p style="color:#5d6862;font-size:12px">Consulte a autenticidade em <a href="https://www.nfe.fazenda.gov.br/portal">www.nfe.fazenda.gov.br/portal</a>.</p>' : ''}
      </div>`,
      anexos: [{ nome: arquivo, tipo: 'application/xml', conteudo: xml }],
    });
    via = 'smtp';
  }
  db.prepare('INSERT INTO envios_email (nota_id, destinatarios, via) VALUES (?, ?, ?)').run(id, emails.join(', '), via);
  return { ok: true, via, para: emails };
}

async function emailDeTeste(para) {
  const e = lerEmitente({ comToken: true });
  await enviarEmail(configSmtp(e), {
    para: [String(para || '').trim()],
    assunto: 'Teste do Emissor de Notas Fiscais',
    texto: 'Se você recebeu esta mensagem, o envio de e-mails do Emissor de Notas Fiscais está funcionando.',
    html: '<p style="font-family:Arial,sans-serif">Se você recebeu esta mensagem, o envio de e-mails do <b>Emissor de Notas Fiscais</b> está funcionando.</p>',
  });
  return { ok: true };
}

function painel() {
  const mes = db.prepare(`SELECT tipo, COUNT(*) qtd, COALESCE(SUM(valor_total),0) total FROM notas
    WHERE status = 'autorizada' AND strftime('%Y-%m', emitida_em) = strftime('%Y-%m', 'now', 'localtime') GROUP BY tipo`).all();
  const porStatus = db.prepare('SELECT status, COUNT(*) qtd FROM notas GROUP BY status').all();
  const meses = db.prepare(`SELECT strftime('%Y-%m', emitida_em) mes, COALESCE(SUM(valor_total),0) total FROM notas
    WHERE status = 'autorizada' AND emitida_em >= date('now','localtime','start of month','-5 months') GROUP BY mes ORDER BY mes`).all();
  const contagem = (sql) => db.prepare(sql).get().n;
  return {
    mes,
    porStatus,
    meses,
    clientes: contagem('SELECT COUNT(*) n FROM clientes'),
    produtos: contagem('SELECT COUNT(*) n FROM produtos'),
    ultimas: listarNotas({}).slice(0, 8),
    emitente: lerEmitente(),
  };
}

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------
const rotas = [];
const rota = (metodo, padrao, fn, { publica = false } = {}) => {
  const chaves = [];
  const re = new RegExp('^' + padrao.replace(/:(\w+)/g, (_, k) => { chaves.push(k); return '([^/]+)'; }) + '$');
  rotas.push({ metodo, re, chaves, fn, publica });
};

// Rotas públicas: tudo o mais exige login
rota('GET', '/api/auth/estado', ({ req }) => ({ configurado: auth.haUsuarios(), usuario: auth.usuarioDaRequisicao(req) }), { publica: true });
rota('POST', '/api/auth/primeiro-acesso', ({ res, corpo }) => auth.configurarPrimeiroAcesso(res, corpo), { publica: true });
rota('POST', '/api/auth/entrar', ({ req, res, corpo }) => auth.entrar(req, res, corpo), { publica: true });
rota('POST', '/api/auth/sair', ({ req, res }) => auth.sair(req, res), { publica: true });

rota('GET', '/api/usuarios', () => auth.listarUsuarios());
rota('POST', '/api/usuarios', ({ corpo }) => auth.criarUsuario(corpo));
rota('DELETE', '/api/usuarios/:id', ({ usuario, params }) => auth.excluirUsuario(usuario, Number(params.id)));
rota('POST', '/api/usuarios/eu/senha', ({ usuario, corpo }) => auth.trocarSenha(usuario, corpo));

rota('GET', '/api/backups', () => ({ pasta: backup.BACKUP_DIR, backups: backup.listarBackups() }));
rota('POST', '/api/backups', () => backup.fazerBackup());
rota('GET', '/api/backups/:nome', ({ params, res }) => {
  const arquivo = backup.caminhoBackup(params.nome);
  if (!arquivo) falha(404, 'Backup não encontrado.');
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${params.nome}"` });
  fs.createReadStream(arquivo).pipe(res);
  return undefined;
});

rota('GET', '/api/painel', () => painel());
rota('GET', '/api/emitente', () => lerEmitente());
rota('PUT', '/api/emitente', ({ corpo }) => salvarEmitente(corpo));

for (const t of Object.keys(TABELAS)) {
  rota('GET', `/api/${t}`, ({ query }) => listar(t, query.get('q')));
  rota('POST', `/api/${t}`, ({ corpo }) => salvar(t, corpo));
  rota('PUT', `/api/${t}/:id`, ({ params, corpo }) => salvar(t, corpo, Number(params.id)));
  rota('DELETE', `/api/${t}/:id`, ({ params }) => excluir(t, Number(params.id)));
}

rota('POST', '/api/calcular', ({ corpo }) => calcularNota(corpo.tipo, corpo.itens, lerEmitente(), corpo));
rota('GET', '/api/notas', ({ query }) => listarNotas(Object.fromEntries(query)));
rota('POST', '/api/notas', ({ corpo }) => emitirNota(corpo));
rota('GET', '/api/notas/:id', ({ params }) => obterNota(Number(params.id)));
rota('POST', '/api/notas/:id/consultar', ({ params }) => consultarNota(Number(params.id)));
rota('POST', '/api/notas/:id/reenviar', ({ params }) => reenviarNota(Number(params.id)));
rota('POST', '/api/notas/:id/cancelar', ({ params, corpo }) => cancelarNota(Number(params.id), corpo.justificativa));
rota('POST', '/api/notas/:id/carta-correcao', ({ params, corpo }) => cartaCorrecao(Number(params.id), corpo.texto));
rota('POST', '/api/notas/:id/email', ({ params, corpo }) => enviarNotaPorEmail(Number(params.id), corpo.destinatarios));
rota('GET', '/api/inutilizacoes', () => listarInutilizacoes());
rota('POST', '/api/inutilizacoes', ({ corpo }) => inutilizar(corpo));
rota('POST', '/api/email/teste', ({ corpo }) => emailDeTeste(corpo.para));
rota('GET', '/api/notas/:id/xml', ({ params, res }) => {
  const { nome, xml } = xmlDaNota(Number(params.id));
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"` });
  res.end(xml);
  return undefined;
});

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };

function servirEstatico(url, res) {
  const alvo = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!alvo.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  fs.readFile(alvo, (err, conteudo) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(conteudo);
  });
}

function mesmaOrigem(origem, host) {
  try { return new URL(origem).host === host; } catch { return false; }
}

async function lerCorpo(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  if (!partes.length) return {};
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { falha(400, 'JSON inválido.'); }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/')) return servirEstatico(url, res);

  const r = rotas.find((x) => x.metodo === req.method && x.re.test(url.pathname));
  try {
    if (!r) falha(404, 'Rota não encontrada.');
    // Bloqueia requisições de outros sites (CSRF): o navegador sempre envia Origin nesses casos
    if (req.method !== 'GET' && req.headers.origin && !mesmaOrigem(req.headers.origin, req.headers.host)) {
      falha(403, 'Origem não permitida.');
    }
    const usuario = r.publica ? null : auth.usuarioDaRequisicao(req);
    if (!r.publica && !usuario) falha(401, 'Sessão expirada. Faça login novamente.');
    const m = url.pathname.match(r.re);
    const params = Object.fromEntries(r.chaves.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const corpo = ['POST', 'PUT'].includes(req.method) ? await lerCorpo(req) : {};
    const resultado = await r.fn({ params, query: url.searchParams, corpo, req, res, usuario });
    if (resultado !== undefined) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(resultado));
    }
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ erro: err.message || 'Erro interno' }));
  }
});

servidor.listen(PORTA, () => {
  console.log(`\n  Sistema de Notas Fiscais rodando em http://localhost:${PORTA}\n`);
  backup.iniciarBackupAutomatico();
});
