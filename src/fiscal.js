// Regras fiscais: cálculo de impostos, chave de acesso e geração de XML.
const { soDigitos } = require('./validacao');

const CODIGO_UF = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25,
  PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50,
  MT: 51, GO: 52, DF: 53,
};

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/**
 * Calcula itens e totais da nota.
 * NF-e: ICMS (zerado no Simples Nacional, CSOSN 102), IPI, PIS e COFINS por item.
 * NFS-e: ISS por item, com opção de ISS retido pelo tomador.
 * Reforma tributária (2026, fase de teste): IBS e CBS destacados por item, apenas informativos —
 * não entram no total da nota nem são recolhidos. Alíquotas de teste: CBS 0,9% e IBS 0,1%.
 */
function destacaIbsCbs(emitente) {
  const opcao = emitente?.ibs_cbs_destacar || 'auto';
  // Obrigatório no regime normal; facultativo para o Simples Nacional em 2026
  return opcao === 'sim' || (opcao === 'auto' && String(emitente?.regime ?? '1') !== '1');
}

function calcularIbsCbs(liquido, it, emitente) {
  const aliq_cbs = num(emitente.aliq_cbs ?? 0.9);
  const aliq_ibs_uf = num(emitente.aliq_ibs_uf ?? 0.1);
  const aliq_ibs_mun = num(emitente.aliq_ibs_mun ?? 0);
  const valor_ibs_uf = r2((liquido * aliq_ibs_uf) / 100);
  const valor_ibs_mun = r2((liquido * aliq_ibs_mun) / 100);
  return {
    cst_ibs_cbs: soDigitos(it.cst_ibs_cbs) || '000',
    cclass_trib: soDigitos(it.cclass_trib) || '000001',
    base_ibs_cbs: liquido,
    aliq_cbs, valor_cbs: r2((liquido * aliq_cbs) / 100),
    aliq_ibs_uf, valor_ibs_uf,
    aliq_ibs_mun, valor_ibs_mun,
    valor_ibs: r2(valor_ibs_uf + valor_ibs_mun),
  };
}

function calcularNota(tipo, itensEntrada, emitente, extras = {}) {
  const simples = String(emitente?.regime ?? '1') === '1';
  const comIbsCbs = destacaIbsCbs(emitente);
  const itens = (itensEntrada || []).map((it, i) => {
    const quantidade = num(it.quantidade);
    const valor_unitario = num(it.valor_unitario);
    const bruto = r2(quantidade * valor_unitario);
    const desconto = Math.min(r2(num(it.desconto)), bruto);
    const liquido = r2(bruto - desconto);
    const base = {
      numero_item: i + 1,
      produto_id: it.produto_id ?? null,
      codigo: it.codigo || String(i + 1),
      descricao: String(it.descricao || '').trim(),
      unidade: it.unidade || 'UN',
      quantidade,
      valor_unitario,
      valor_bruto: bruto,
      desconto,
      valor_liquido: liquido,
      ...(comIbsCbs && calcularIbsCbs(liquido, it, emitente)),
    };
    if (tipo === 'NFSe') {
      const aliq_iss = num(it.aliq_iss);
      return { ...base, codigo_servico: it.codigo_servico || '', aliq_iss, valor_iss: r2((liquido * aliq_iss) / 100) };
    }
    const aliq_icms = simples ? 0 : num(it.aliq_icms);
    const aliq_ipi = num(it.aliq_ipi);
    const aliq_pis = num(it.aliq_pis);
    const aliq_cofins = num(it.aliq_cofins);
    return {
      ...base,
      ncm: soDigitos(it.ncm),
      cfop: soDigitos(it.cfop) || '5102',
      cst_icms: simples ? '102' : '00',
      aliq_icms,
      base_icms: simples ? 0 : liquido,
      valor_icms: r2((liquido * aliq_icms) / 100),
      aliq_ipi,
      valor_ipi: r2((liquido * aliq_ipi) / 100),
      aliq_pis,
      valor_pis: r2((liquido * aliq_pis) / 100),
      aliq_cofins,
      valor_cofins: r2((liquido * aliq_cofins) / 100),
    };
  });

  const soma = (campo) => r2(itens.reduce((s, it) => s + num(it[campo]), 0));
  const ibsCbs = comIbsCbs ? {
    ibs_cbs_destacado: true,
    base_ibs_cbs: soma('base_ibs_cbs'),
    valor_cbs: soma('valor_cbs'),
    valor_ibs_uf: soma('valor_ibs_uf'),
    valor_ibs_mun: soma('valor_ibs_mun'),
    valor_ibs: soma('valor_ibs'),
  } : { ibs_cbs_destacado: false };

  if (tipo === 'NFSe') {
    const valor_servicos = soma('valor_bruto');
    const desconto = soma('desconto');
    const valor_iss = soma('valor_iss');
    const iss_retido = Boolean(extras.iss_retido);
    const valor_total = r2(valor_servicos - desconto);
    return {
      itens,
      totais: {
        valor_servicos, desconto, valor_iss, iss_retido,
        valor_liquido: r2(valor_total - (iss_retido ? valor_iss : 0)),
        valor_total,
        ...ibsCbs,
      },
    };
  }

  const valor_produtos = soma('valor_bruto');
  const desconto = soma('desconto');
  const frete = r2(num(extras.frete));
  const valor_ipi = soma('valor_ipi');
  return {
    itens,
    totais: {
      valor_produtos, desconto, frete,
      base_icms: soma('base_icms'),
      valor_icms: soma('valor_icms'),
      valor_ipi,
      valor_pis: soma('valor_pis'),
      valor_cofins: soma('valor_cofins'),
      valor_total: r2(valor_produtos - desconto + frete + valor_ipi),
      ...ibsCbs,
    },
  };
}

function digitoChave(chave43) {
  let peso = 2;
  let soma = 0;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Chave de acesso de 44 dígitos (layout SEFAZ) para NF-e modelo 55. */
function gerarChaveAcesso({ uf, cnpj, serie, numero, data = new Date(), codigoNumerico }) {
  const cUF = String(CODIGO_UF[uf] ?? 35);
  const aamm = String(data.getFullYear()).slice(2) + String(data.getMonth() + 1).padStart(2, '0');
  const cNF = (codigoNumerico ?? String(Math.floor(Math.random() * 1e8))).padStart(8, '0');
  const base = cUF + aamm + soDigitos(cnpj).padStart(14, '0') + '55' +
    String(serie).padStart(3, '0') + String(numero).padStart(9, '0') + '1' + cNF;
  return base + digitoChave(base);
}

const esc = (v) => String(v ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const tag = (nome, valor) => (valor === null || valor === undefined || valor === '' ? '' : `<${nome}>${esc(valor)}</${nome}>`);
const dec = (n, casas = 2) => num(n).toFixed(casas);

function docTag(documento) {
  const d = soDigitos(documento);
  return d.length === 11 ? tag('CPF', d) : tag('CNPJ', d);
}

// Grupos IBS/CBS conforme a NT 2025.002-RTC (reforma tributária)
function xmlIbsCbsItem(it) {
  return `<IBSCBS><CST>${it.cst_ibs_cbs}</CST><cClassTrib>${it.cclass_trib}</cClassTrib><gIBSCBS><vBC>${dec(it.base_ibs_cbs)}</vBC>`
    + `<gIBSUF><pIBSUF>${dec(it.aliq_ibs_uf, 4)}</pIBSUF><vIBSUF>${dec(it.valor_ibs_uf)}</vIBSUF></gIBSUF>`
    + `<gIBSMun><pIBSMun>${dec(it.aliq_ibs_mun, 4)}</pIBSMun><vIBSMun>${dec(it.valor_ibs_mun)}</vIBSMun></gIBSMun>`
    + `<vIBS>${dec(it.valor_ibs)}</vIBS><gCBS><pCBS>${dec(it.aliq_cbs, 4)}</pCBS><vCBS>${dec(it.valor_cbs)}</vCBS></gCBS></gIBSCBS></IBSCBS>`;
}

function xmlIbsCbsTotal(t) {
  const zeros = '<vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>';
  return `<IBSCBSTot><vBCIBSCBS>${dec(t.base_ibs_cbs)}</vBCIBSCBS>`
    + `<gIBS><gIBSUF>${zeros}<vIBSUF>${dec(t.valor_ibs_uf)}</vIBSUF></gIBSUF><gIBSMun>${zeros}<vIBSMun>${dec(t.valor_ibs_mun)}</vIBSMun></gIBSMun>`
    + `<vIBS>${dec(t.valor_ibs)}</vIBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS>`
    + `<gCBS>${zeros}<vCBS>${dec(t.valor_cbs)}</vCBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot>`;
}

/** XML da NF-e no layout 4.00 (sem assinatura digital — a assinatura é feita pelo provedor/certificado A1). */
function gerarXmlNFe(nota) {
  const e = nota.emitente;
  const c = nota.cliente;
  const t = nota.totais;
  const ambiente = nota.ambiente === 'producao' ? '1' : '2';
  const dhEmi = new Date(nota.emitida_em.replace(' ', 'T')).toISOString().replace(/\.\d{3}Z$/, '-03:00');
  const contribuinte = c.ie && c.tipo === 'PJ';

  const det = nota.itens.map((it) => `
    <det nItem="${it.numero_item}">
      <prod>${tag('cProd', it.codigo)}<cEAN>SEM GTIN</cEAN>${tag('xProd', it.descricao)}${tag('NCM', it.ncm)}${tag('CFOP', it.cfop)}${tag('uCom', it.unidade)}<qCom>${dec(it.quantidade, 4)}</qCom><vUnCom>${dec(it.valor_unitario, 10)}</vUnCom><vProd>${dec(it.valor_bruto)}</vProd><cEANTrib>SEM GTIN</cEANTrib>${tag('uTrib', it.unidade)}<qTrib>${dec(it.quantidade, 4)}</qTrib><vUnTrib>${dec(it.valor_unitario, 10)}</vUnTrib>${it.desconto ? `<vDesc>${dec(it.desconto)}</vDesc>` : ''}<indTot>1</indTot></prod>
      <imposto>
        <ICMS>${it.cst_icms === '102'
          ? '<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>'
          : `<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>${dec(it.base_icms)}</vBC><pICMS>${dec(it.aliq_icms, 4)}</pICMS><vICMS>${dec(it.valor_icms)}</vICMS></ICMS00>`}</ICMS>
        ${it.aliq_ipi ? `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>${dec(it.valor_liquido)}</vBC><pIPI>${dec(it.aliq_ipi, 4)}</pIPI><vIPI>${dec(it.valor_ipi)}</vIPI></IPITrib></IPI>` : ''}
        <PIS>${it.aliq_pis ? `<PISAliq><CST>01</CST><vBC>${dec(it.valor_liquido)}</vBC><pPIS>${dec(it.aliq_pis, 4)}</pPIS><vPIS>${dec(it.valor_pis)}</vPIS></PISAliq>` : '<PISNT><CST>07</CST></PISNT>'}</PIS>
        <COFINS>${it.aliq_cofins ? `<COFINSAliq><CST>01</CST><vBC>${dec(it.valor_liquido)}</vBC><pCOFINS>${dec(it.aliq_cofins, 4)}</pCOFINS><vCOFINS>${dec(it.valor_cofins)}</vCOFINS></COFINSAliq>` : '<COFINSNT><CST>07</CST></COFINSNT>'}</COFINS>
        ${it.cst_ibs_cbs ? xmlIbsCbsItem(it) : ''}
      </imposto>
    </det>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${nota.chave}" versao="4.00">
    <ide><cUF>${CODIGO_UF[e.uf] ?? 35}</cUF><cNF>${nota.chave.slice(35, 43)}</cNF>${tag('natOp', nota.natureza)}<mod>55</mod><serie>${nota.serie}</serie><nNF>${nota.numero}</nNF><dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF><idDest>${c.uf && c.uf !== e.uf ? 2 : 1}</idDest>${tag('cMunFG', e.cod_municipio)}<tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${nota.chave.slice(-1)}</cDV><tpAmb>${ambiente}</tpAmb><finNFe>1</finNFe><indFinal>${contribuinte ? 0 : 1}</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>SistemaNF 1.0</verProc></ide>
    <emit>${docTag(e.cnpj)}${tag('xNome', e.razao_social)}${tag('xFant', e.nome_fantasia)}
      <enderEmit>${tag('xLgr', e.logradouro)}${tag('nro', e.numero)}${tag('xCpl', e.complemento)}${tag('xBairro', e.bairro)}${tag('cMun', e.cod_municipio)}${tag('xMun', e.municipio)}${tag('UF', e.uf)}${tag('CEP', soDigitos(e.cep))}<cPais>1058</cPais><xPais>BRASIL</xPais>${tag('fone', soDigitos(e.telefone))}</enderEmit>
      ${tag('IE', soDigitos(e.ie))}<CRT>${e.regime === '1' ? 1 : 3}</CRT></emit>
    <dest>${docTag(c.documento)}${tag('xNome', ambiente === '2' ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : c.nome)}
      <enderDest>${tag('xLgr', c.logradouro)}${tag('nro', c.numero)}${tag('xBairro', c.bairro)}${tag('cMun', c.cod_municipio)}${tag('xMun', c.municipio)}${tag('UF', c.uf)}${tag('CEP', soDigitos(c.cep))}<cPais>1058</cPais><xPais>BRASIL</xPais></enderDest>
      <indIEDest>${contribuinte ? 1 : 9}</indIEDest>${contribuinte ? tag('IE', soDigitos(c.ie)) : ''}${tag('email', c.email)}</dest>${det}
    <total><ICMSTot><vBC>${dec(t.base_icms)}</vBC><vICMS>${dec(t.valor_icms)}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${dec(t.valor_produtos)}</vProd><vFrete>${dec(t.frete)}</vFrete><vSeg>0.00</vSeg><vDesc>${dec(t.desconto)}</vDesc><vII>0.00</vII><vIPI>${dec(t.valor_ipi)}</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>${dec(t.valor_pis)}</vPIS><vCOFINS>${dec(t.valor_cofins)}</vCOFINS><vOutro>0.00</vOutro><vNF>${dec(t.valor_total)}</vNF></ICMSTot>${t.ibs_cbs_destacado ? xmlIbsCbsTotal(t) : ''}</total>
    <transp><modFrete>${t.frete ? 0 : 9}</modFrete></transp>
    <pag><detPag><tPag>${nota.forma_pagamento || '01'}</tPag><vPag>${dec(t.valor_total)}</vPag></detPag></pag>
    ${nota.observacoes ? `<infAdic>${tag('infCpl', nota.observacoes)}</infAdic>` : ''}
  </infNFe>
</NFe>
${nota.protocolo ? `<protNFe versao="4.00"><infProt><tpAmb>${ambiente}</tpAmb><chNFe>${nota.chave}</chNFe><nProt>${nota.protocolo}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>` : ''}
</nfeProc>
`;
}

/** XML de RPS no padrão ABRASF 2.04 para NFS-e. */
function gerarXmlNFSe(nota) {
  const e = nota.emitente;
  const c = nota.cliente;
  const t = nota.totais;
  const discriminacao = nota.itens.map((it) => `${it.quantidade} x ${it.descricao} = R$ ${dec(it.valor_liquido)}`).join(' | ');
  const aliq = nota.itens[0]?.aliq_iss ?? 0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<EnviarLoteRpsSincronoEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">
  <LoteRps versao="2.04"><NumeroLote>${nota.numero}</NumeroLote>
    <Prestador><CpfCnpj>${docTag(e.cnpj)}</CpfCnpj>${tag('InscricaoMunicipal', e.im)}</Prestador>
    <QuantidadeRps>1</QuantidadeRps>
    <ListaRps><Rps><InfDeclaracaoPrestacaoServico Id="RPS${nota.numero}">
      <Rps><IdentificacaoRps><Numero>${nota.numero}</Numero><Serie>${nota.serie}</Serie><Tipo>1</Tipo></IdentificacaoRps><DataEmissao>${nota.emitida_em.slice(0, 10)}</DataEmissao><Status>${nota.status === 'cancelada' ? 2 : 1}</Status></Rps>
      <Competencia>${nota.emitida_em.slice(0, 10)}</Competencia>
      <Servico><Valores><ValorServicos>${dec(t.valor_servicos)}</ValorServicos><DescontoIncondicionado>${dec(t.desconto)}</DescontoIncondicionado><ValorIss>${dec(t.valor_iss)}</ValorIss><Aliquota>${dec(aliq, 4)}</Aliquota></Valores>
        <IssRetido>${t.iss_retido ? 1 : 2}</IssRetido>${tag('ItemListaServico', nota.itens[0]?.codigo_servico)}${tag('Discriminacao', discriminacao)}${tag('CodigoMunicipio', e.cod_municipio)}<ExigibilidadeISS>1</ExigibilidadeISS></Servico>
      <Prestador><CpfCnpj>${docTag(e.cnpj)}</CpfCnpj>${tag('InscricaoMunicipal', e.im)}</Prestador>
      <TomadorServico><IdentificacaoTomador><CpfCnpj>${docTag(c.documento)}</CpfCnpj></IdentificacaoTomador>${tag('RazaoSocial', c.nome)}
        <Endereco>${tag('Endereco', c.logradouro)}${tag('Numero', c.numero)}${tag('Bairro', c.bairro)}${tag('CodigoMunicipio', c.cod_municipio)}${tag('Uf', c.uf)}${tag('Cep', soDigitos(c.cep))}</Endereco>
        ${c.email ? `<Contato>${tag('Email', c.email)}</Contato>` : ''}</TomadorServico>
      <OptanteSimplesNacional>${e.regime === '1' ? 1 : 2}</OptanteSimplesNacional><IncentivoFiscal>2</IncentivoFiscal>
    </InfDeclaracaoPrestacaoServico></Rps></ListaRps>
  </LoteRps>
</EnviarLoteRpsSincronoEnvio>
`;
}

module.exports = { CODIGO_UF, calcularNota, gerarChaveAcesso, digitoChave, gerarXmlNFe, gerarXmlNFSe, r2 };
