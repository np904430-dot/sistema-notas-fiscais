// Provedores de emissão. Cada provedor implementa: emitir(nota), consultar(nota), cancelar(nota, justificativa).
// Todos retornam { status, chave?, protocolo?, numero?, motivo?, dados? }
// status: 'autorizada' | 'processando' | 'rejeitada' | 'cancelada'
const { gerarChaveAcesso } = require('./fiscal');
const { soDigitos } = require('./validacao');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const digitos = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

// ---------------------------------------------------------------------------
// Simulação local: autoriza sem enviar nada para a SEFAZ/prefeitura. Ideal para testes.
// ---------------------------------------------------------------------------
const simulacao = {
  nome: 'Simulação local',
  async emitir(nota) {
    await espera(400);
    if (nota.tipo === 'NFe') {
      return {
        status: 'autorizada',
        chave: gerarChaveAcesso({ uf: nota.emitente.uf, cnpj: nota.emitente.cnpj, serie: nota.serie, numero: nota.numero }),
        protocolo: (nota.ambiente === 'producao' ? '1' : '2') + digitos(14),
        motivo: 'Autorizado o uso da NF-e (simulação)',
      };
    }
    return {
      status: 'autorizada',
      protocolo: digitos(9).toUpperCase(), // código de verificação
      motivo: 'NFS-e gerada (simulação)',
    };
  },
  async consultar(nota) {
    return { status: nota.status, chave: nota.chave, protocolo: nota.protocolo, motivo: nota.motivo };
  },
  async cancelar() {
    await espera(300);
    return { status: 'cancelada', motivo: 'Cancelamento homologado (simulação)' };
  },
  async cartaCorrecao(nota, texto, sequencia) {
    await espera(300);
    return { ok: true, sequencia, protocolo: '2' + digitos(14), motivo: 'Evento registrado e vinculado a NF-e (simulação)' };
  },
  async inutilizar() {
    await espera(300);
    return { ok: true, protocolo: '2' + digitos(14), motivo: 'Inutilização de número homologado (simulação)' };
  },
  // Na simulação o e-mail sai pelo SMTP configurado no próprio sistema
  enviarEmail: null,
};

// ---------------------------------------------------------------------------
// Focus NFe (https://focusnfe.com.br) — API REST que assina com seu certificado A1
// e transmite para SEFAZ (NF-e) e prefeituras (NFS-e).
// ---------------------------------------------------------------------------
const STATUS_FOCUS = {
  autorizado: 'autorizada',
  cancelado: 'cancelada',
  processando_autorizacao: 'processando',
  erro_autorizacao: 'rejeitada',
  denegado: 'rejeitada',
};

function focusBase(ambiente) {
  return ambiente === 'producao' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
}

async function focusFetch(nota, metodo, caminho, corpo) {
  if (!nota.token) throw new Error('Token da Focus NFe não configurado em Configurações.');
  const resp = await fetch(focusBase(nota.ambiente) + caminho, {
    method: metodo,
    headers: {
      Authorization: 'Basic ' + Buffer.from(nota.token + ':').toString('base64'),
      'Content-Type': 'application/json',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resp.text();
  let dados;
  try { dados = JSON.parse(texto); } catch { dados = { mensagem: texto }; }
  if (!resp.ok && resp.status !== 422) {
    const msg = dados.mensagem || (dados.erros || []).map((e) => e.mensagem).join('; ') || `HTTP ${resp.status}`;
    throw new Error(`Focus NFe: ${msg}`);
  }
  return dados;
}

function payloadNFe(nota) {
  const e = nota.emitente;
  const c = nota.cliente;
  const doc = soDigitos(c.documento);
  const contribuinte = Boolean(c.ie) && c.tipo === 'PJ';
  return {
    natureza_operacao: nota.natureza,
    data_emissao: new Date().toISOString(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    local_destino: c.uf && c.uf !== e.uf ? 2 : 1,
    consumidor_final: contribuinte ? 0 : 1,
    presenca_comprador: 1,
    cnpj_emitente: soDigitos(e.cnpj),
    nome_destinatario: c.nome,
    [doc.length === 11 ? 'cpf_destinatario' : 'cnpj_destinatario']: doc,
    indicador_inscricao_estadual_destinatario: contribuinte ? 1 : 9,
    inscricao_estadual_destinatario: contribuinte ? soDigitos(c.ie) : undefined,
    email_destinatario: c.email || undefined,
    logradouro_destinatario: c.logradouro,
    numero_destinatario: c.numero,
    bairro_destinatario: c.bairro,
    municipio_destinatario: c.municipio,
    uf_destinatario: c.uf,
    cep_destinatario: soDigitos(c.cep),
    modalidade_frete: nota.totais.frete ? 0 : 9,
    valor_frete: nota.totais.frete || undefined,
    informacoes_adicionais_contribuinte: nota.observacoes || undefined,
    items: nota.itens.map((it) => ({
      numero_item: it.numero_item,
      codigo_produto: it.codigo,
      descricao: it.descricao,
      cfop: it.cfop,
      codigo_ncm: it.ncm,
      unidade_comercial: it.unidade,
      quantidade_comercial: it.quantidade,
      valor_unitario_comercial: it.valor_unitario,
      unidade_tributavel: it.unidade,
      quantidade_tributavel: it.quantidade,
      valor_unitario_tributavel: it.valor_unitario,
      valor_bruto: it.valor_bruto,
      valor_desconto: it.desconto || undefined,
      icms_origem: 0,
      icms_situacao_tributaria: it.cst_icms,
      ...(it.cst_icms === '00' && { icms_modalidade_base_calculo: 3, icms_base_calculo: it.base_icms, icms_aliquota: it.aliq_icms, icms_valor: it.valor_icms }),
      ...(it.aliq_ipi && { ipi_situacao_tributaria: '50', ipi_codigo_enquadramento_legal: '999', ipi_base_calculo: it.valor_liquido, ipi_aliquota: it.aliq_ipi }),
      pis_situacao_tributaria: it.aliq_pis ? '01' : '07',
      ...(it.aliq_pis && { pis_base_calculo: it.valor_liquido, pis_aliquota_porcentual: it.aliq_pis }),
      cofins_situacao_tributaria: it.aliq_cofins ? '01' : '07',
      ...(it.aliq_cofins && { cofins_base_calculo: it.valor_liquido, cofins_aliquota_porcentual: it.aliq_cofins }),
      // Reforma tributária — nomes conforme o guia da Focus NFe (focusnfe.com.br/guides/reforma-tributaria)
      ...(it.cst_ibs_cbs && {
        ibs_cbs_situacao_tributaria: it.cst_ibs_cbs,
        ibs_cbs_classificacao_tributaria: it.cclass_trib,
        ibs_cbs_base_calculo: it.base_ibs_cbs,
        cbs_aliquota: it.aliq_cbs, cbs_valor: it.valor_cbs,
        ibs_uf_aliquota: it.aliq_ibs_uf, ibs_uf_valor: it.valor_ibs_uf,
        ibs_mun_aliquota: it.aliq_ibs_mun, ibs_mun_valor: it.valor_ibs_mun,
        ibs_valor_total: it.valor_ibs,
      }),
    })),
    ...(nota.totais.ibs_cbs_destacado && {
      ibs_cbs_base_calculo: nota.totais.base_ibs_cbs,
      cbs_valor_total: nota.totais.valor_cbs,
      ibs_uf_valor_total: nota.totais.valor_ibs_uf,
      ibs_valor_total: nota.totais.valor_ibs,
    }),
    formas_pagamento: [{ forma_pagamento: nota.forma_pagamento || '01', valor_pagamento: nota.totais.valor_total }],
  };
}

function payloadNFSe(nota) {
  const e = nota.emitente;
  const c = nota.cliente;
  const doc = soDigitos(c.documento);
  return {
    data_emissao: new Date().toISOString(),
    prestador: { cnpj: soDigitos(e.cnpj), inscricao_municipal: e.im, codigo_municipio: e.cod_municipio },
    tomador: {
      [doc.length === 11 ? 'cpf' : 'cnpj']: doc,
      razao_social: c.nome,
      email: c.email || undefined,
      endereco: {
        logradouro: c.logradouro, numero: c.numero, bairro: c.bairro,
        codigo_municipio: c.cod_municipio, uf: c.uf, cep: soDigitos(c.cep),
      },
    },
    servico: {
      aliquota: nota.itens[0]?.aliq_iss ?? 0,
      item_lista_servico: nota.itens[0]?.codigo_servico,
      discriminacao: nota.itens.map((it) => `${it.quantidade} x ${it.descricao}`).join('\n') + (nota.observacoes ? `\n${nota.observacoes}` : ''),
      iss_retido: nota.totais.iss_retido,
      valor_servicos: nota.totais.valor_servicos,
      desconto_incondicionado: nota.totais.desconto || undefined,
    },
  };
}

function traduzFocus(nota, dados) {
  return {
    status: STATUS_FOCUS[dados.status] || (dados.codigo ? 'rejeitada' : 'processando'),
    chave: dados.chave_nfe ? dados.chave_nfe.replace(/^NFe/, '') : nota.chave,
    protocolo: dados.protocolo || dados.codigo_verificacao || nota.protocolo,
    numero: dados.numero ? Number(dados.numero) : undefined,
    motivo: dados.mensagem_sefaz || dados.mensagem || (dados.erros || []).map((e) => e.mensagem).join('; ') || dados.status,
    dados,
  };
}

const focusnfe = {
  nome: 'Focus NFe',
  async emitir(nota) {
    const rota = nota.tipo === 'NFe' ? 'nfe' : 'nfse';
    const corpo = nota.tipo === 'NFe' ? payloadNFe(nota) : payloadNFSe(nota);
    let dados = await focusFetch(nota, 'POST', `/v2/${rota}?ref=${encodeURIComponent(nota.ref)}`, corpo);
    // Processamento é assíncrono: consulta algumas vezes antes de devolver "processando"
    for (let i = 0; i < 5 && (!dados.status || dados.status.startsWith('processando')); i++) {
      await espera(2000);
      dados = await focusFetch(nota, 'GET', `/v2/${rota}/${encodeURIComponent(nota.ref)}`);
    }
    return traduzFocus(nota, dados);
  },
  async consultar(nota) {
    const rota = nota.tipo === 'NFe' ? 'nfe' : 'nfse';
    return traduzFocus(nota, await focusFetch(nota, 'GET', `/v2/${rota}/${encodeURIComponent(nota.ref)}`));
  },
  async cancelar(nota, justificativa) {
    const rota = nota.tipo === 'NFe' ? 'nfe' : 'nfse';
    const dados = await focusFetch(nota, 'DELETE', `/v2/${rota}/${encodeURIComponent(nota.ref)}`, { justificativa });
    return traduzFocus(nota, dados);
  },
  async cartaCorrecao(nota, texto) {
    const d = await focusFetch(nota, 'POST', `/v2/nfe/${encodeURIComponent(nota.ref)}/carta_correcao`, { correcao: texto });
    return {
      ok: d.status === 'autorizado',
      sequencia: d.numero_carta_correcao,
      protocolo: d.status_sefaz ? String(d.status_sefaz) : null,
      motivo: d.mensagem_sefaz || d.mensagem || d.status,
    };
  },
  async inutilizar(ctx, { cnpj, serie, numero_inicial, numero_final, justificativa }) {
    const d = await focusFetch(ctx, 'POST', '/v2/nfe/inutilizacao', { cnpj, serie: String(serie), numero_inicial, numero_final, justificativa });
    return { ok: d.status === 'autorizado', protocolo: d.protocolo_sefaz, motivo: d.mensagem_sefaz || d.mensagem || d.status };
  },
  // A Focus envia o DANFE em PDF e o XML para os e-mails informados (até 10)
  async enviarEmail(nota, emails) {
    const rota = nota.tipo === 'NFe' ? 'nfe' : 'nfse';
    const d = await focusFetch(nota, 'POST', `/v2/${rota}/${encodeURIComponent(nota.ref)}/email`, { emails });
    return { motivo: d.mensagem || 'Envio agendado pela Focus NFe.' };
  },
};

const PROVEDORES = { simulacao, focusnfe };

function obterProvedor(nome) {
  return PROVEDORES[nome] || simulacao;
}

module.exports = { obterProvedor, PROVEDORES };
