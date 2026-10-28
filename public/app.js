// Interface do Emissor de Notas Fiscais — SPA sem frameworks.
'use strict';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const conteudo = $('#conteudo');

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
// Lista de pares para manter a ordem (objetos reordenam chaves numéricas como '17' e '90')
const LISTA_PAGAMENTOS = [['17', 'PIX'], ['01', 'Dinheiro'], ['03', 'Cartão de crédito'], ['04', 'Cartão de débito'], ['15', 'Boleto bancário'], ['05', 'Crédito loja'], ['90', 'Sem pagamento']];
const PAGAMENTOS = Object.fromEntries(LISTA_PAGAMENTOS);
const STATUS = { autorizada: 'Autorizada', processando: 'Processando', rejeitada: 'Rejeitada', cancelada: 'Cancelada' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = (n, casas = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const dataBR = (s) => (s ? new Date(s.replace(' ', 'T')).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

function documento(v) {
  const d = digitos(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v || '';
}
const chaveFormatada = (c) => (c || '').replace(/(\d{4})/g, '$1 ').trim();

async function api(metodo, url, corpo) {
  const resp = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await resp.json().catch(() => ({}));
  if (resp.status === 401 && !url.startsWith('/api/auth/')) mostrarAcesso(true); // sessão expirou
  if (!resp.ok) throw new Error(dados.erro || `Erro ${resp.status}`);
  return dados;
}

function aviso(msg, tipo = '') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  $('#avisos').append(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 6000 : 3500);
}

function dadosForm(form) {
  const d = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    d[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  return d;
}

const opcoes = (lista, atual) => lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(atual ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');
const opcoesUF = (atual) => '<option value="">UF</option>' + opcoes(UFS.map((u) => [u, u]), atual);
const selo = (status) => `<span class="selo ${status}">${STATUS[status] || status}</span>`;

const ICONE_OLHO = `<svg class="olho-aberto" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6.5 5 2.7 9.2 1.5 12c1.2 2.8 5 7 10.5 7s9.3-4.2 10.5-7C21.3 9.2 17.5 5 12 5m0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9m0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5"/></svg>
  <svg class="olho-fechado" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 4.2 4.2 2.8l17 17-1.4 1.4-3.4-3.4A11.4 11.4 0 0 1 12 19c-5.5 0-9.3-4.2-10.5-7a13 13 0 0 1 4-5.1zM12 5c5.5 0 9.3 4.2 10.5 7a13 13 0 0 1-3.1 4.3L16 12.9V12a4 4 0 0 0-4.9-3.9L8.6 5.6A11 11 0 0 1 12 5m-4 7a4 4 0 0 0 5.5 3.7l-5.2-5.2Q8 11.2 8 12"/></svg>`;

function campo({ nome, rotulo, valor = '', tam = 12, tipo = 'text', extra = '', dica = '' }) {
  const input = `<input id="f-${nome}" name="${nome}" type="${tipo}" value="${esc(valor)}" ${extra}>`;
  // Campos de senha ganham o botão de olho para mostrar/ocultar o que foi digitado
  const controle = tipo === 'password'
    ? `<div class="senha-wrap">${input}<button type="button" class="olho" data-olho aria-label="Mostrar senha" title="Mostrar senha">${ICONE_OLHO}</button></div>`
    : input;
  return `<div class="campo c${tam}"><label for="f-${nome}">${rotulo}</label>
    ${controle}${dica ? `<span class="dica">${dica}</span>` : ''}</div>`;
}

document.addEventListener('click', (ev) => {
  const botao = ev.target.closest('[data-olho]');
  if (!botao) return;
  const input = botao.previousElementSibling;
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  botao.classList.toggle('visivel', mostrar);
  botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  botao.title = botao.getAttribute('aria-label');
  input.focus();
});

/** Abre um modal com formulário. `aoSalvar` recebe os dados; se lançar erro, o modal continua aberto. */
function abrirModal({ titulo, corpo, botao = 'Salvar', aoSalvar, aoAbrir }) {
  const modal = $('#modal');
  const form = $('#modal-form');
  form.innerHTML = `<header><h2>${titulo}</h2></header><div class="corpo">${corpo}</div>
    <footer><button type="button" class="btn" value="cancelar">Cancelar</button><button type="submit" class="btn primario">${botao}</button></footer>`;
  $('[value=cancelar]', form).onclick = () => modal.close();
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = $('[type=submit]', form);
    btn.disabled = true;
    try {
      await aoSalvar(dadosForm(form), form);
      modal.close();
    } catch (err) {
      aviso(err.message, 'erro');
    } finally {
      btn.disabled = false;
    }
  };
  modal.showModal();
  aoAbrir?.(form);
  $('input, select, textarea', form)?.focus();
}

/** Preenche endereço a partir do CEP (ViaCEP), incluindo o código IBGE do município. */
function ligarCEP(form) {
  const cep = form.elements.cep;
  if (!cep) return;
  cep.addEventListener('blur', async () => {
    const c = digitos(cep.value);
    if (c.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${c}/json/`).then((x) => x.json());
      if (r.erro) return aviso('CEP não encontrado.', 'erro');
      const set = (n, v) => { if (form.elements[n] && v) form.elements[n].value = v; };
      set('logradouro', r.logradouro); set('bairro', r.bairro); set('municipio', r.localidade);
      set('uf', r.uf); set('cod_municipio', r.ibge);
      form.elements.numero?.focus();
    } catch { /* sem internet: preenchimento manual */ }
  });
}

// ---------------------------------------------------------------------------
// Roteador
// ---------------------------------------------------------------------------
const telas = {};
let emitenteCache = null;
let usuarioAtual = null;

// ---------------------------------------------------------------------------
// Login e primeiro acesso
// ---------------------------------------------------------------------------
function mostrarAcesso(configurado) {
  usuarioAtual = null;
  $('#modal').open && $('#modal').close();
  document.body.classList.add('sem-sessao');
  const primeiro = !configurado;
  conteudo.innerHTML = `
    <form class="cartao acesso" id="form-acesso">
      <div class="corpo">
        <div class="marca" style="padding:0 0 18px"><span class="marca-icone">NF</span><div><strong style="color:var(--texto)">Emissor NF</strong>
          <small style="color:var(--texto-2)">${primeiro ? 'Primeiro acesso' : 'Entre para continuar'}</small></div></div>
        ${primeiro ? `<div class="aviso-box info">Crie o usuário administrador. Depois você pode cadastrar outras pessoas em Configurações.</div>` : ''}
        <div class="campos">
          ${primeiro ? campo({ nome: 'nome', rotulo: 'Seu nome', extra: 'required autocomplete="name"' }) : ''}
          ${campo({ nome: 'login', rotulo: 'Usuário', extra: `required autocomplete="username" autocapitalize="none"${primeiro ? ' placeholder="ex.: nicolas"' : ''}`, dica: primeiro ? 'Pode usar seu nome: acentos e espaços são ajustados (ex.: “Nícolas Pereira” vira nicolas.pereira).' : '' })}
          ${campo({ nome: 'senha', rotulo: 'Senha', tipo: 'password', extra: `required autocomplete="${primeiro ? 'new-password' : 'current-password'}" ${primeiro ? 'minlength="8"' : ''}`, dica: primeiro ? 'Mínimo de 8 caracteres' : '' })}
          ${primeiro ? campo({ nome: 'confirmar', rotulo: 'Confirme a senha', tipo: 'password', extra: 'required autocomplete="new-password" minlength="8"' }) : ''}
        </div>
        <button class="btn primario" style="width:100%;margin-top:18px;padding:11px">${primeiro ? 'Criar e entrar' : 'Entrar'}</button>
      </div>
    </form>`;
  const form = $('#form-acesso');
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = dadosForm(form);
    if (primeiro && d.senha !== d.confirmar) return aviso('As senhas não conferem.', 'erro');
    const btn = $('button', form);
    btn.disabled = true;
    try {
      const u = await api('POST', primeiro ? '/api/auth/primeiro-acesso' : '/api/auth/entrar', d);
      entrarNoApp(u);
      if (primeiro) aviso(`Pronto! Seu usuário para entrar é: ${u.login}`, 'ok');
    } catch (err) {
      aviso(err.message, 'erro');
      btn.disabled = false;
      form.elements.senha.select();
    }
  };
  $('input', form).focus();
}

function entrarNoApp(usuario) {
  usuarioAtual = usuario;
  document.body.classList.remove('sem-sessao');
  $('#usuario-lateral').innerHTML = `<span><b>${esc(usuario.nome)}</b>${esc(usuario.login)}</span>
    <button type="button" class="btn-sair" id="sair" title="Sair do sistema">Sair</button>`;
  $('#sair').onclick = async () => {
    await api('POST', '/api/auth/sair').catch(() => {});
    rascunho = null;
    mostrarAcesso(true);
  };
  atualizarLateral().catch(() => {});
  navegar();
}

async function iniciar() {
  const estado = await api('GET', '/api/auth/estado');
  if (estado.usuario) entrarNoApp(estado.usuario);
  else mostrarAcesso(estado.configurado);
}

async function atualizarLateral() {
  emitenteCache = await api('GET', '/api/emitente');
  const e = emitenteCache;
  $('#marca-emitente').textContent = e.nome_fantasia || e.razao_social || 'Configure sua empresa';
  const selo = $('#selo-ambiente');
  const prov = e.provedor === 'focusnfe' ? 'Focus NFe' : 'Simulação local';
  selo.className = `ambiente ${e.ambiente}`;
  selo.innerHTML = `<b><span class="ponto"></span>${e.ambiente === 'producao' ? 'Produção' : 'Homologação'}</b>${prov}`;
}

async function navegar() {
  if (!usuarioAtual) return;
  const [, nome = 'painel', id] = location.hash.split('/');
  $$('nav a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === nome || (nome === 'nota' && a.dataset.rota === 'notas')));
  conteudo.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    await (telas[nome] || telas.painel)(id);
  } catch (err) {
    conteudo.innerHTML = `<div class="aviso-box erro">${esc(err.message)}</div>`;
  }
  conteudo.focus({ preventScroll: true });
}
window.addEventListener('hashchange', navegar);

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
telas.painel = async () => {
  const p = await api('GET', '/api/painel');
  const porTipo = Object.fromEntries(p.mes.map((m) => [m.tipo, m]));
  const pendentes = p.porStatus.filter((s) => s.status === 'processando' || s.status === 'rejeitada').reduce((s, x) => s + x.qtd, 0);
  const configurado = p.emitente.razao_social && p.emitente.cnpj;

  // últimos 6 meses, inclusive os sem faturamento
  const hoje = new Date();
  const meses = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - 5 + i, 1);
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { rotulo: MESES[d.getMonth()], total: p.meses.find((m) => m.mes === chave)?.total || 0 };
  });
  const max = Math.max(...meses.map((m) => m.total), 1);

  conteudo.innerHTML = `
    <div class="cabecalho"><div><h1>Painel</h1><p>Resumo do faturamento de ${MESES[hoje.getMonth()]}/${hoje.getFullYear()}</p></div>
      <div class="acoes"><a class="btn primario" href="#/emitir">+ Emitir nota</a></div></div>
    ${configurado ? '' : `<div class="aviso-box info"><b>Primeiro passo:</b> cadastre os dados da sua empresa em <a href="#/config">Configurações</a> para começar a emitir.</div>`}
    <div class="grade g4" style="margin-bottom:16px">
      <div class="cartao kpi"><small>NF-e autorizadas no mês</small><strong>${moeda(porTipo.NFe?.total)}</strong><span>${porTipo.NFe?.qtd || 0} nota(s) de produto</span></div>
      <div class="cartao kpi"><small>NFS-e autorizadas no mês</small><strong>${moeda(porTipo.NFSe?.total)}</strong><span>${porTipo.NFSe?.qtd || 0} nota(s) de serviço</span></div>
      <div class="cartao kpi"><small>Pendências</small><strong>${pendentes}</strong><span>processando ou rejeitadas</span></div>
      <div class="cartao kpi"><small>Cadastros</small><strong>${p.clientes}</strong><span>clientes · ${p.produtos} produtos/serviços</span></div>
    </div>
    <div class="grade g2">
      <section class="cartao"><header><h2>Últimas notas</h2><a class="btn-link" href="#/notas">Ver todas</a></header>
        ${tabelaNotas(p.ultimas, 'Nenhuma nota emitida ainda', 'Clique em “Emitir nota” para criar a primeira.')}</section>
      <section class="cartao"><header><h2>Faturamento — 6 meses</h2></header><div class="corpo">
        <div class="barras">${meses.map((m) => `<div class="barra"><span>${m.total ? numero(m.total / 1000, 1) + 'k' : ''}</span>
          <div style="height:${(m.total / max) * 100}%" title="${moeda(m.total)}"></div><small>${m.rotulo}</small></div>`).join('')}</div>
      </div></section>
    </div>`;
  ligarLinhasNotas();
};

function tabelaNotas(notas, vazioTitulo, vazioTexto) {
  if (!notas.length) return `<div class="vazio"><strong>${vazioTitulo}</strong>${vazioTexto}</div>`;
  return `<div class="tabela-wrap"><table><thead><tr><th>Nota</th><th>Cliente</th><th>Emissão</th><th>Status</th><th class="num">Valor</th></tr></thead><tbody>
    ${notas.map((n) => `<tr class="clicavel" data-id="${n.id}">
      <td><span class="tipo ${n.tipo}">${n.tipo === 'NFe' ? 'NF-e' : 'NFS-e'}</span> <b>${n.numero}</b><span class="sub">Série ${n.serie}</span></td>
      <td>${esc(n.cliente.nome)}<span class="sub">${documento(n.cliente.documento)}</span></td>
      <td>${dataBR(n.emitida_em)}</td><td>${selo(n.status)}</td><td class="num">${moeda(n.valor_total)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function ligarLinhasNotas() {
  $$('tr[data-id]').forEach((tr) => { tr.onclick = () => { location.hash = `#/nota/${tr.dataset.id}`; }; });
}

// ---------------------------------------------------------------------------
// Emitir nota
// ---------------------------------------------------------------------------
let rascunho = null;

telas.emitir = async () => {
  const [clientes, produtos] = await Promise.all([api('GET', '/api/clientes'), api('GET', '/api/produtos'), atualizarLateral()]);
  rascunho ||= { tipo: 'NFe', cliente_id: '', natureza: '', forma_pagamento: '17', frete: 0, iss_retido: false, observacoes: '', itens: [] };
  const e = emitenteCache;

  const desenhar = () => {
    const r = rascunho;
    const nfe = r.tipo === 'NFe';
    const lista = produtos.filter((p) => (nfe ? p.tipo !== 'servico' : p.tipo === 'servico'));
    conteudo.innerHTML = `
      <div class="cabecalho"><div><h1>Emitir nota fiscal</h1><p>Série ${nfe ? e.serie_nfe : e.serie_nfse} · próximo número <b>${nfe ? e.proximo_nfe : e.proximo_nfse}</b></p></div>
        <div class="alternador" role="tablist">
          <button type="button" data-tipo="NFe" class="${nfe ? 'ativo' : ''}">NF-e · Produtos</button>
          <button type="button" data-tipo="NFSe" class="${nfe ? '' : 'ativo'}">NFS-e · Serviços</button></div></div>
      ${e.ambiente !== 'producao' ? '<div class="aviso-box alerta">Ambiente de <b>homologação</b>: as notas emitidas aqui não têm valor fiscal.</div>' : ''}
      <div class="emissao">
        <div class="grade">
          <section class="cartao"><header><h2>${nfe ? 'Destinatário' : 'Tomador do serviço'}</h2>
            <button type="button" class="btn pequeno" id="novo-cliente">+ Novo cliente</button></header>
            <div class="corpo campos">
              <div class="campo c8"><label for="f-cliente">Cliente</label><select id="f-cliente">
                <option value="">Selecione…</option>${opcoes(clientes.map((c) => [c.id, `${c.nome} — ${documento(c.documento)}`]), r.cliente_id)}</select></div>
              <div class="campo c4"><label for="f-pag">Forma de pagamento</label><select id="f-pag">${opcoes(LISTA_PAGAMENTOS, r.forma_pagamento)}</select></div>
              <div class="campo"><label for="f-nat">${nfe ? 'Natureza da operação' : 'Descrição da operação'}</label>
                <input id="f-nat" value="${esc(r.natureza)}" placeholder="${nfe ? 'Venda de mercadoria' : 'Prestação de serviço'}"></div>
            </div></section>

          <section class="cartao"><header><h2>${nfe ? 'Produtos' : 'Serviços'}</h2>
            <button type="button" class="btn pequeno" id="add-item">+ Adicionar item</button></header>
            <div class="tabela-wrap"><table class="itens"><thead><tr>
              <th style="min-width:190px">Descrição</th>
              ${nfe ? '<th>NCM</th><th>CFOP</th><th>Un</th>' : '<th>Cód. serv.</th>'}
              <th>Qtd</th><th>Vlr unit.</th><th>Desc.</th>
              ${nfe ? '<th>ICMS %</th><th>IPI %</th>' : '<th>ISS %</th>'}
              <th class="num">Total</th><th></th></tr></thead>
              <tbody>${r.itens.length ? r.itens.map((it, i) => linhaItem(it, i, nfe, lista)).join('') : `<tr><td colspan="12"><div class="vazio"><strong>Nenhum item</strong>Adicione ${nfe ? 'produtos' : 'serviços'} à nota.</div></td></tr>`}</tbody>
            </table></div></section>

          <section class="cartao"><header><h2>Informações adicionais</h2></header><div class="corpo campos">
            ${nfe ? campo({ nome: 'frete', rotulo: 'Valor do frete (R$)', valor: r.frete || '', tam: 4, tipo: 'number', extra: 'step="0.01" min="0" id="f-frete"' })
              : `<div class="campo c4"><label class="rotulo">&nbsp;</label><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="f-retido" style="width:auto" ${r.iss_retido ? 'checked' : ''}> ISS retido pelo tomador</label></div>`}
            <div class="campo"><label for="f-obs">Observações (aparecem no documento)</label><textarea id="f-obs">${esc(r.observacoes)}</textarea></div>
          </div></section>
        </div>

        <aside class="cartao resumo"><header><h2>Resumo</h2></header><div class="corpo" id="resumo"></div>
          <footer style="padding:0 18px 18px"><button class="btn primario" id="emitir" style="width:100%;padding:11px">Emitir ${nfe ? 'NF-e' : 'NFS-e'}</button>
          <button class="btn" id="limpar" style="width:100%;margin-top:8px">Limpar</button></footer></aside>
      </div>`;
    ligar(lista);
    recalcular();
  };

  const linhaItem = (it, i, nfe, lista) => `<tr data-i="${i}">
    <td><input list="lista-prod" data-c="descricao" value="${esc(it.descricao)}" placeholder="Digite ou escolha">
      <datalist id="lista-prod">${lista.map((p) => `<option value="${esc(p.descricao)}">${esc(p.codigo || '')} · ${moeda(p.preco)}</option>`).join('')}</datalist></td>
    ${nfe ? `<td><input data-c="ncm" value="${esc(it.ncm)}" style="width:96px" class="mono" maxlength="10"></td>
      <td><input data-c="cfop" value="${esc(it.cfop)}" style="width:62px" class="mono" maxlength="4"></td>
      <td><input data-c="unidade" value="${esc(it.unidade)}" style="width:52px"></td>`
    : `<td><input data-c="codigo_servico" value="${esc(it.codigo_servico)}" style="width:78px" class="mono"></td>`}
    <td><input data-c="quantidade" type="number" step="any" min="0" value="${it.quantidade}" style="width:72px"></td>
    <td><input data-c="valor_unitario" type="number" step="0.01" min="0" value="${it.valor_unitario}" style="width:96px"></td>
    <td><input data-c="desconto" type="number" step="0.01" min="0" value="${it.desconto || ''}" style="width:78px"></td>
    ${nfe ? `<td><input data-c="aliq_icms" type="number" step="0.01" min="0" value="${it.aliq_icms || ''}" style="width:64px" ${e.regime === '1' ? 'disabled title="Simples Nacional: ICMS no DAS (CSOSN 102)"' : ''}></td>
      <td><input data-c="aliq_ipi" type="number" step="0.01" min="0" value="${it.aliq_ipi || ''}" style="width:64px"></td>`
    : `<td><input data-c="aliq_iss" type="number" step="0.01" min="0" value="${it.aliq_iss || ''}" style="width:64px"></td>`}
    <td class="num" data-total>${moeda((it.quantidade * it.valor_unitario) - (it.desconto || 0))}</td>
    <td><button type="button" class="btn icone perigo" data-remover title="Remover item" aria-label="Remover item">✕</button></td></tr>`;

  const novoItem = () => (rascunho.tipo === 'NFe'
    ? { descricao: '', ncm: '', cfop: '5102', unidade: 'UN', quantidade: 1, valor_unitario: 0, desconto: 0, aliq_icms: 0, aliq_ipi: 0, aliq_pis: 0, aliq_cofins: 0 }
    : { descricao: '', codigo_servico: '', quantidade: 1, valor_unitario: 0, desconto: 0, aliq_iss: 0 });

  function ligar(lista) {
    $$('.alternador button').forEach((b) => b.onclick = () => {
      if (b.dataset.tipo === rascunho.tipo) return;
      rascunho.tipo = b.dataset.tipo;
      rascunho.itens = [];
      rascunho.natureza = '';
      desenhar();
    });
    $('#f-cliente').onchange = (ev) => { rascunho.cliente_id = ev.target.value; };
    $('#f-pag').onchange = (ev) => { rascunho.forma_pagamento = ev.target.value; };
    $('#f-nat').oninput = (ev) => { rascunho.natureza = ev.target.value; };
    $('#f-obs').oninput = (ev) => { rascunho.observacoes = ev.target.value; };
    $('#f-frete') && ($('#f-frete').oninput = (ev) => { rascunho.frete = Number(ev.target.value) || 0; recalcular(); });
    $('#f-retido') && ($('#f-retido').onchange = (ev) => { rascunho.iss_retido = ev.target.checked; recalcular(); });
    $('#add-item').onclick = () => { rascunho.itens.push(novoItem()); desenhar(); $(`tr[data-i="${rascunho.itens.length - 1}"] input`)?.focus(); };
    $('#novo-cliente').onclick = () => formCliente(null, async (c) => { clientes.push(c); rascunho.cliente_id = String(c.id); desenhar(); });
    $('#limpar').onclick = () => { rascunho = null; telas.emitir(); };
    $('#emitir').onclick = emitir;

    $$('tr[data-i]').forEach((tr) => {
      const it = rascunho.itens[tr.dataset.i];
      $('[data-remover]', tr).onclick = () => { rascunho.itens.splice(tr.dataset.i, 1); desenhar(); };
      $$('input[data-c]', tr).forEach((inp) => inp.addEventListener('input', () => {
        const c = inp.dataset.c;
        it[c] = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
        if (c === 'descricao') {
          const p = lista.find((x) => x.descricao === inp.value);
          if (p) { // preenche a linha com os dados do cadastro
            Object.assign(it, {
              produto_id: p.id, codigo: p.codigo, valor_unitario: p.preco, ncm: p.ncm, cfop: p.cfop, unidade: p.unidade,
              aliq_icms: p.aliq_icms, aliq_ipi: p.aliq_ipi, aliq_pis: p.aliq_pis, aliq_cofins: p.aliq_cofins,
              aliq_iss: p.aliq_iss, codigo_servico: p.codigo_servico, cst_ibs_cbs: p.cst_ibs_cbs, cclass_trib: p.cclass_trib,
            });
            desenhar();
            return;
          }
        }
        $('[data-total]', tr).textContent = moeda(it.quantidade * it.valor_unitario - (it.desconto || 0));
        recalcular();
      }));
    });
  }

  let tempo;
  let ultimaConta = 0;
  function recalcular() {
    clearTimeout(tempo);
    tempo = setTimeout(async () => {
      const el = $('#resumo');
      if (!el) return;
      const minha = ++ultimaConta;
      const { totais: t } = await api('POST', '/api/calcular', rascunho);
      if (minha !== ultimaConta) return; // chegou uma resposta mais nova
      const l = (rot, v, cls = '') => `<div class="linha-total ${cls}"><span>${rot}</span><span>${moeda(v)}</span></div>`;
      el.innerHTML = (rascunho.tipo === 'NFe'
        ? l('Produtos', t.valor_produtos) + l('(−) Descontos', t.desconto) + l('(+) Frete', t.frete) + l('(+) IPI', t.valor_ipi)
          + l(e.regime === '1' ? 'ICMS (Simples — no DAS)' : 'ICMS destacado', t.valor_icms) + l('Total da NF-e', t.valor_total, 'grande')
        : l('Serviços', t.valor_servicos) + l('(−) Descontos', t.desconto) + l('ISS', t.valor_iss)
          + (t.iss_retido ? l('(−) ISS retido', t.valor_iss) : '') + l('Total da NFS-e', t.valor_total, 'grande')
          + (t.iss_retido ? l('Valor líquido a receber', t.valor_liquido) : ''))
        + blocoIbsCbs(t);
    }, 150);
  }

  async function emitir() {
    const btn = $('#emitir');
    btn.disabled = true;
    btn.textContent = 'Transmitindo…';
    try {
      const nota = await api('POST', '/api/notas', rascunho);
      rascunho = null;
      if (nota.status === 'autorizada') aviso(`${nota.tipo === 'NFe' ? 'NF-e' : 'NFS-e'} nº ${nota.numero} autorizada!`, 'ok');
      else aviso(`Nota nº ${nota.numero}: ${STATUS[nota.status]} — ${nota.motivo || ''}`, nota.status === 'rejeitada' ? 'erro' : '');
      atualizarLateral();
      location.hash = `#/nota/${nota.id}`;
    } catch (err) {
      aviso(err.message, 'erro');
      btn.disabled = false;
      btn.textContent = `Emitir ${rascunho.tipo === 'NFe' ? 'NF-e' : 'NFS-e'}`;
    }
  }

  if (!rascunho.itens.length) rascunho.itens.push(novoItem());
  desenhar();
};

// ---------------------------------------------------------------------------
// Notas emitidas
// ---------------------------------------------------------------------------
const filtrosNotas = { q: '', tipo: '', status: '', de: '', ate: '' };

telas.notas = async () => {
  conteudo.innerHTML = `
    <div class="cabecalho"><div><h1>Notas emitidas</h1><p>Consulte, imprima, baixe o XML ou cancele</p></div>
      <div class="acoes"><button class="btn" id="inutilizar">Inutilizar numeração</button><a class="btn primario" href="#/emitir">+ Emitir nota</a></div></div>
    <section class="cartao">
      <form class="filtros" id="filtros">
        <input type="search" name="q" placeholder="Buscar por número, cliente ou chave…" value="${esc(filtrosNotas.q)}" aria-label="Buscar">
        <select name="tipo" aria-label="Tipo">${opcoes([['', 'Todos os tipos'], ['NFe', 'NF-e'], ['NFSe', 'NFS-e']], filtrosNotas.tipo)}</select>
        <select name="status" aria-label="Status">${opcoes([['', 'Todos os status'], ...Object.entries(STATUS)], filtrosNotas.status)}</select>
        <input type="date" name="de" value="${filtrosNotas.de}" aria-label="De">
        <input type="date" name="ate" value="${filtrosNotas.ate}" aria-label="Até">
      </form>
      <div id="lista-notas"></div>
    </section>
    <section class="cartao" style="margin-top:16px"><header><h2>Numerações de NF-e inutilizadas</h2></header><div id="lista-inutilizacoes"></div></section>`;
  const form = $('#filtros');
  const carregarInutilizacoes = async () => {
    const lista = await api('GET', '/api/inutilizacoes');
    $('#lista-inutilizacoes').innerHTML = !lista.length
      ? '<div class="vazio" style="padding:24px"><strong>Nenhuma numeração inutilizada</strong>Use quando um número de NF-e for pulado ou ficar rejeitado e não for mais usado.</div>'
      : `<div class="tabela-wrap"><table><thead><tr><th>Série</th><th>Números</th><th>Justificativa</th><th>Protocolo</th><th>Data</th></tr></thead><tbody>
        ${lista.map((i) => `<tr><td>${i.serie}</td><td><b>${i.numero_inicial === i.numero_final ? i.numero_inicial : `${i.numero_inicial} a ${i.numero_final}`}</b></td>
          <td>${esc(i.justificativa)}<span class="sub">${esc(i.motivo || '')}</span></td><td class="mono">${esc(i.protocolo || '—')}</td><td>${dataBR(i.criada_em)}</td></tr>`).join('')}
        </tbody></table></div>`;
  };
  $('#inutilizar').onclick = async () => {
    const e = await api('GET', '/api/emitente');
    abrirModal({
      titulo: 'Inutilizar numeração de NF-e',
      botao: 'Inutilizar',
      corpo: `<div class="aviso-box alerta" style="margin-bottom:14px">A inutilização é <b>definitiva</b>: os números informados nunca mais poderão ser usados.
        Só é possível inutilizar números que não foram autorizados nem cancelados.</div>
        <div class="campos">
          ${campo({ nome: 'serie', rotulo: 'Série', valor: e.serie_nfe, tam: 4, tipo: 'number', extra: 'min="0" max="999" required' })}
          ${campo({ nome: 'numero_inicial', rotulo: 'Do número', tam: 4, tipo: 'number', extra: 'min="1" required' })}
          ${campo({ nome: 'numero_final', rotulo: 'Até o número', tam: 4, tipo: 'number', extra: 'min="1"', dica: 'Vazio = só um número' })}
          <div class="campo"><label for="f-just">Justificativa (15 a 255 caracteres)</label><textarea id="f-just" name="justificativa" minlength="15" maxlength="255" required></textarea></div>
        </div>`,
      aoSalvar: async (d) => {
        await api('POST', '/api/inutilizacoes', d);
        aviso('Numeração inutilizada.', 'ok');
        carregarInutilizacoes();
      },
    });
  };
  carregarInutilizacoes().catch((err) => aviso(err.message, 'erro'));
  const carregar = async () => {
    Object.assign(filtrosNotas, dadosForm(form));
    const qs = new URLSearchParams(Object.entries(filtrosNotas).filter(([, v]) => v));
    const notas = await api('GET', `/api/notas?${qs}`);
    const total = notas.filter((n) => n.status === 'autorizada').reduce((s, n) => s + n.valor_total, 0);
    $('#lista-notas').innerHTML = tabelaNotas(notas, 'Nenhuma nota encontrada', 'Ajuste os filtros ou emita uma nova nota.')
      + (notas.length ? `<div class="filtros" style="border:0;border-top:1px solid var(--borda);justify-content:space-between"><span>${notas.length} nota(s)</span><span>Total autorizado: <b>${moeda(total)}</b></span></div>` : '');
    ligarLinhasNotas();
  };
  let t;
  form.oninput = () => { clearTimeout(t); t = setTimeout(carregar, 250); };
  form.onsubmit = (e) => e.preventDefault();
  await carregar();
};

telas.nota = async (id) => {
  const n = await api('GET', `/api/notas/${id}`);
  const nfe = n.tipo === 'NFe';
  const t = n.totais;
  const rotulo = nfe ? 'NF-e' : 'NFS-e';
  conteudo.innerHTML = `
    <div class="cabecalho"><div><p><a class="btn-link" href="#/notas">← Notas emitidas</a></p>
      <h1>${rotulo} nº ${n.numero} <small style="font-weight:400;color:var(--texto-3)">série ${n.serie}</small> ${selo(n.status)}</h1>
      <p>Emitida em ${dataBR(n.emitida_em)} · ${n.ambiente === 'producao' ? 'Produção' : 'Homologação'} · ${n.provedor === 'focusnfe' ? 'Focus NFe' : 'Simulação local'}</p></div>
      <div class="acoes">
        ${n.status !== 'rejeitada' ? `<a class="btn" href="danfe.html?id=${n.id}" target="_blank">Imprimir ${nfe ? 'DANFE' : 'nota'}</a>` : ''}
        <a class="btn" href="/api/notas/${n.id}/xml">Baixar XML</a>
        ${n.status === 'processando' ? '<button class="btn primario" id="consultar">Consultar status</button>' : ''}
        ${n.status === 'rejeitada' ? '<button class="btn primario" id="reenviar">Corrigir e reenviar</button>' : ''}
        ${['autorizada', 'cancelada'].includes(n.status) ? '<button class="btn" id="enviar-email">Enviar por e-mail</button>' : ''}
        ${nfe && n.status === 'autorizada' ? '<button class="btn" id="carta">Carta de correção</button>' : ''}
        ${n.status === 'autorizada' ? '<button class="btn perigo" id="cancelar">Cancelar nota</button>' : ''}
      </div></div>
    ${n.status === 'rejeitada' ? `<div class="aviso-box erro"><b>Rejeitada:</b> ${esc(n.motivo)}</div>` : ''}
    ${n.status === 'processando' ? `<div class="aviso-box alerta">A nota está em processamento no provedor. Clique em “Consultar status” em alguns segundos.</div>` : ''}
    ${n.status === 'cancelada' ? `<div class="aviso-box alerta"><b>Cancelada em ${dataBR(n.cancelada_em)}.</b> Justificativa: ${esc(n.justificativa_cancelamento)}</div>` : ''}
    <div class="grade g2">
      <div class="grade">
        <section class="cartao"><header><h2>Identificação</h2></header><div class="corpo"><dl class="dl">
          ${nfe ? `<dt>Chave de acesso</dt><dd class="mono">${chaveFormatada(n.chave) || '—'}</dd><dt>Protocolo</dt><dd class="mono">${esc(n.protocolo) || '—'}</dd>`
            : `<dt>Código de verificação</dt><dd class="mono">${esc(n.protocolo) || '—'}</dd>`}
          <dt>Natureza</dt><dd>${esc(n.natureza)}</dd>
          <dt>Pagamento</dt><dd>${PAGAMENTOS[n.forma_pagamento] || n.forma_pagamento}</dd>
          <dt>Retorno</dt><dd>${esc(n.motivo) || '—'}</dd>
        </dl></div></section>
        <section class="cartao"><header><h2>Itens</h2></header><div class="tabela-wrap"><table><thead><tr>
          <th>#</th><th>Descrição</th>${nfe ? '<th>NCM</th><th>CFOP</th>' : ''}<th class="num">Qtd</th><th class="num">Unitário</th><th class="num">Desconto</th><th class="num">Total</th></tr></thead><tbody>
          ${n.itens.map((it) => `<tr><td>${it.numero_item}</td><td>${esc(it.descricao)}</td>${nfe ? `<td class="mono">${it.ncm}</td><td class="mono">${it.cfop}</td>` : ''}
            <td class="num">${numero(it.quantidade, 2)} ${esc(it.unidade || '')}</td><td class="num">${moeda(it.valor_unitario)}</td><td class="num">${moeda(it.desconto)}</td><td class="num">${moeda(it.valor_liquido)}</td></tr>`).join('')}
        </tbody></table></div></section>
        ${n.observacoes ? `<section class="cartao"><header><h2>Observações</h2></header><div class="corpo">${esc(n.observacoes)}</div></section>` : ''}
        ${n.cartas.length ? `<section class="cartao"><header><h2>Cartas de correção</h2></header><div class="tabela-wrap"><table><thead><tr><th>Seq.</th><th>Correção</th><th>Data</th></tr></thead><tbody>
          ${n.cartas.map((c) => `<tr><td>${c.sequencia}</td><td>${esc(c.texto)}<span class="sub">${esc(c.motivo || '')}${c.protocolo ? ' · protocolo ' + esc(c.protocolo) : ''}</span></td><td>${dataBR(c.criada_em)}</td></tr>`).join('')}
          </tbody></table></div><div class="corpo dica" style="padding-top:10px">A carta mais recente substitui as anteriores: ela deve conter todas as correções.</div></section>` : ''}
        ${n.emails.length ? `<section class="cartao"><header><h2>Envios por e-mail</h2></header><div class="tabela-wrap"><table><thead><tr><th>Para</th><th>Via</th><th>Data</th></tr></thead><tbody>
          ${n.emails.map((m) => `<tr><td>${esc(m.destinatarios)}</td><td>${m.via === 'focusnfe' ? 'Focus NFe (PDF + XML)' : 'E-mail do sistema (XML)'}</td><td>${dataBR(m.enviado_em)}</td></tr>`).join('')}
          </tbody></table></div></section>` : ''}
      </div>
      <div class="grade" style="align-content:start">
        <section class="cartao"><header><h2>${nfe ? 'Destinatário' : 'Tomador'}</h2></header><div class="corpo">
          <b>${esc(n.cliente.nome)}</b><span class="sub">${documento(n.cliente.documento)}${n.cliente.ie ? ' · IE ' + esc(n.cliente.ie) : ''}</span>
          <p style="margin:8px 0 0;color:var(--texto-2)">${esc([n.cliente.logradouro, n.cliente.numero, n.cliente.bairro].filter(Boolean).join(', '))}<br>${esc([n.cliente.municipio, n.cliente.uf].filter(Boolean).join(' / '))}</p>
        </div></section>
        <section class="cartao"><header><h2>Totais</h2></header><div class="corpo">
          ${(nfe
            ? [['Produtos', t.valor_produtos], ['Descontos', t.desconto], ['Frete', t.frete], ['Base ICMS', t.base_icms], ['ICMS', t.valor_icms], ['IPI', t.valor_ipi], ['PIS', t.valor_pis], ['COFINS', t.valor_cofins]]
            : [['Serviços', t.valor_servicos], ['Descontos', t.desconto], ['ISS', t.valor_iss], ['ISS retido', t.iss_retido ? 'Sim' : 'Não'], ['Valor líquido', t.valor_liquido]])
            .map(([r, v]) => `<div class="linha-total"><span>${r}</span><span>${typeof v === 'number' ? moeda(v) : v}</span></div>`).join('')}
          <div class="linha-total grande"><span>Total</span><span>${moeda(t.valor_total)}</span></div>
          ${blocoIbsCbs(t)}
        </div></section>
      </div>
    </div>`;

  const acao = async (btn, fn) => {
    btn.disabled = true;
    try { await fn(); } catch (err) { aviso(err.message, 'erro'); btn.disabled = false; }
  };
  $('#consultar') && ($('#consultar').onclick = (ev) => acao(ev.target, async () => {
    const r = await api('POST', `/api/notas/${id}/consultar`);
    aviso(`Status: ${STATUS[r.status]}`);
    telas.nota(id);
  }));
  $('#reenviar') && ($('#reenviar').onclick = (ev) => acao(ev.target, async () => {
    const r = await api('POST', `/api/notas/${id}/reenviar`);
    aviso(`Reenvio: ${STATUS[r.status]}`, r.status === 'autorizada' ? 'ok' : 'erro');
    telas.nota(id);
  }));
  $('#cancelar') && ($('#cancelar').onclick = () => abrirModal({
    titulo: `Cancelar ${rotulo} nº ${n.numero}`,
    botao: 'Confirmar cancelamento',
    corpo: `<div class="aviso-box alerta">O cancelamento é definitivo e será comunicado ao ${nfe ? 'SEFAZ' : 'município'}.${nfe ? ' A NF-e só pode ser cancelada em até 24 horas após a autorização.' : ''}</div>
      <div class="campo"><label for="f-just">Justificativa (mínimo 15 caracteres)</label><textarea id="f-just" name="justificativa" minlength="15" required></textarea></div>`,
    aoSalvar: async (d) => {
      await api('POST', `/api/notas/${id}/cancelar`, d);
      aviso('Nota cancelada.', 'ok');
      telas.nota(id);
    },
  }));
  $('#carta') && ($('#carta').onclick = () => abrirModal({
    titulo: `Carta de correção — NF-e nº ${n.numero}`,
    botao: 'Registrar correção',
    corpo: `<div class="aviso-box info" style="margin-bottom:14px">A carta de correção <b>não pode</b> alterar valores, quantidades, impostos, data de emissão
      ou trocar o remetente/destinatário. Use para corrigir, por exemplo, endereço, transportadora, CFOP ou texto da descrição.</div>
      ${n.cartas.length ? `<div class="aviso-box alerta" style="margin-bottom:14px">Já existe(m) ${n.cartas.length} carta(s). A nova substitui as anteriores, então repita nela todas as correções que ainda valem.</div>` : ''}
      <div class="campo"><label for="f-texto">Texto da correção (15 a 1000 caracteres)</label>
        <textarea id="f-texto" name="texto" minlength="15" maxlength="1000" required rows="5">${n.cartas.length ? esc(n.cartas[n.cartas.length - 1].texto) : ''}</textarea></div>`,
    aoSalvar: async (d) => {
      await api('POST', `/api/notas/${id}/carta-correcao`, d);
      aviso('Carta de correção registrada.', 'ok');
      telas.nota(id);
    },
  }));
  $('#enviar-email') && ($('#enviar-email').onclick = () => abrirModal({
    titulo: `Enviar ${rotulo} nº ${n.numero} por e-mail`,
    botao: 'Enviar',
    corpo: `${campo({ nome: 'destinatarios', rotulo: 'Para', valor: n.cliente.email || '', extra: 'required placeholder="cliente@empresa.com.br"', dica: 'Separe vários e-mails com vírgula (até 10).' })}
      <p class="dica" style="margin:12px 0 0">${n.provedor === 'focusnfe'
        ? 'A Focus NFe envia o DANFE em PDF e o XML. O envio pode levar alguns minutos.'
        : 'Será enviado pelo e-mail configurado em Configurações → E-mail, com o resumo da nota e o XML em anexo.'}</p>`,
    aoSalvar: async (d) => {
      const r = await api('POST', `/api/notas/${id}/email`, d);
      aviso(`E-mail enviado para ${r.para.join(', ')}.`, 'ok');
      telas.nota(id);
    },
  }));
};

/** Linhas informativas de IBS/CBS (reforma tributária, 2026 — não somam no total). */
function blocoIbsCbs(t) {
  if (!t.ibs_cbs_destacado) return '';
  return `<div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--borda)">
    <div class="dica" style="margin-bottom:4px">Reforma tributária · informativo, não soma no total</div>
    <div class="linha-total"><span>CBS</span><span>${moeda(t.valor_cbs)}</span></div>
    <div class="linha-total"><span>IBS</span><span>${moeda(t.valor_ibs)}</span></div></div>`;
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------
function formCliente(c, depois) {
  c ||= {};
  abrirModal({
    titulo: c.id ? 'Editar cliente' : 'Novo cliente',
    corpo: `<div class="campos">
      ${campo({ nome: 'documento', rotulo: 'CPF ou CNPJ *', valor: documento(c.documento), tam: 5, extra: 'required inputmode="numeric"' })}
      ${campo({ nome: 'ie', rotulo: 'Inscrição estadual', valor: c.ie, tam: 3, dica: 'Deixe vazio se isento' })}
      ${campo({ nome: 'telefone', rotulo: 'Telefone', valor: c.telefone, tam: 4 })}
      ${campo({ nome: 'nome', rotulo: 'Nome / Razão social *', valor: c.nome, tam: 8, extra: 'required' })}
      ${campo({ nome: 'email', rotulo: 'E-mail', valor: c.email, tam: 4, tipo: 'email' })}
      ${campo({ nome: 'cep', rotulo: 'CEP', valor: c.cep, tam: 3, dica: 'Preenche o endereço' })}
      ${campo({ nome: 'logradouro', rotulo: 'Logradouro', valor: c.logradouro, tam: 6 })}
      ${campo({ nome: 'numero', rotulo: 'Número', valor: c.numero, tam: 3 })}
      ${campo({ nome: 'bairro', rotulo: 'Bairro', valor: c.bairro, tam: 4 })}
      ${campo({ nome: 'municipio', rotulo: 'Município', valor: c.municipio, tam: 4 })}
      ${campo({ nome: 'cod_municipio', rotulo: 'Cód. IBGE', valor: c.cod_municipio, tam: 2 })}
      <div class="campo c2"><label for="f-uf">UF</label><select id="f-uf" name="uf">${opcoesUF(c.uf)}</select></div>
    </div>`,
    aoAbrir: ligarCEP,
    aoSalvar: async (d) => {
      const salvo = await api(c.id ? 'PUT' : 'POST', c.id ? `/api/clientes/${c.id}` : '/api/clientes', d);
      aviso('Cliente salvo.', 'ok');
      await depois?.(salvo);
    },
  });
}

telas.clientes = async () => {
  conteudo.innerHTML = `
    <div class="cabecalho"><div><h1>Clientes</h1><p>Destinatários de NF-e e tomadores de NFS-e</p></div>
      <div class="acoes"><button class="btn primario" id="novo">+ Novo cliente</button></div></div>
    <section class="cartao"><div class="filtros"><input type="search" id="busca" placeholder="Buscar por nome, CPF/CNPJ ou e-mail…" aria-label="Buscar"></div><div id="lista"></div></section>`;
  const carregar = async () => {
    const lista = await api('GET', `/api/clientes?q=${encodeURIComponent($('#busca').value)}`);
    $('#lista').innerHTML = !lista.length ? '<div class="vazio"><strong>Nenhum cliente</strong>Cadastre seu primeiro cliente.</div>'
      : `<div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Contato</th><th>Cidade</th><th></th></tr></thead><tbody>
        ${lista.map((c) => `<tr><td><b>${esc(c.nome)}</b><span class="sub">${c.tipo === 'PF' ? 'Pessoa física' : 'Pessoa jurídica'}</span></td>
          <td class="mono">${documento(c.documento)}</td><td>${esc(c.email || '')}<span class="sub">${esc(c.telefone || '')}</span></td>
          <td>${esc([c.municipio, c.uf].filter(Boolean).join(' / '))}</td>
          <td class="num"><button class="btn pequeno" data-editar="${c.id}">Editar</button> <button class="btn pequeno perigo" data-excluir="${c.id}">Excluir</button></td></tr>`).join('')}
        </tbody></table></div>`;
    $$('[data-editar]').forEach((b) => b.onclick = () => formCliente(lista.find((c) => c.id == b.dataset.editar), carregar));
    $$('[data-excluir]').forEach((b) => b.onclick = async () => {
      if (!confirm('Excluir este cliente?')) return;
      try { await api('DELETE', `/api/clientes/${b.dataset.excluir}`); aviso('Cliente excluído.'); carregar(); } catch (e) { aviso(e.message, 'erro'); }
    });
  };
  $('#novo').onclick = () => formCliente(null, carregar);
  $('#busca').oninput = carregar;
  await carregar();
};

// ---------------------------------------------------------------------------
// Produtos e serviços
// ---------------------------------------------------------------------------
function formProduto(p, depois) {
  p ||= { tipo: 'produto', cfop: '5102', unidade: 'UN' };
  abrirModal({
    titulo: p.id ? 'Editar item' : 'Novo produto ou serviço',
    corpo: `<div class="campos">
      <div class="campo c4"><label for="f-tipo">Tipo</label><select id="f-tipo" name="tipo">${opcoes([['produto', 'Produto (NF-e)'], ['servico', 'Serviço (NFS-e)']], p.tipo)}</select></div>
      ${campo({ nome: 'codigo', rotulo: 'Código interno', valor: p.codigo, tam: 3 })}
      ${campo({ nome: 'preco', rotulo: 'Preço (R$) *', valor: p.preco, tam: 5, tipo: 'number', extra: 'step="0.01" min="0" required' })}
      ${campo({ nome: 'descricao', rotulo: 'Descrição *', valor: p.descricao, extra: 'required' })}
      ${campo({ nome: 'cst_ibs_cbs', rotulo: 'CST IBS/CBS', valor: p.cst_ibs_cbs || '000', tam: 4, extra: 'class="mono" maxlength="3"', dica: '000 = tributação integral' })}
      ${campo({ nome: 'cclass_trib', rotulo: 'Classificação tributária (cClassTrib)', valor: p.cclass_trib || '000001', tam: 8, extra: 'class="mono" maxlength="6"', dica: 'Reforma tributária. 000001 = tributação integral; confirme o código com seu contador.' })}
      <div class="campo" data-so="produto"><div class="campos">
        ${campo({ nome: 'ncm', rotulo: 'NCM *', valor: p.ncm, tam: 4, extra: 'class="mono" maxlength="10"', dica: '8 dígitos' })}
        ${campo({ nome: 'cfop', rotulo: 'CFOP *', valor: p.cfop, tam: 4, extra: 'class="mono" maxlength="4"', dica: '5102 venda no estado · 6102 fora' })}
        ${campo({ nome: 'unidade', rotulo: 'Unidade', valor: p.unidade, tam: 4 })}
        ${campo({ nome: 'aliq_icms', rotulo: 'ICMS %', valor: p.aliq_icms, tam: 3, tipo: 'number', extra: 'step="0.01" min="0"' })}
        ${campo({ nome: 'aliq_ipi', rotulo: 'IPI %', valor: p.aliq_ipi, tam: 3, tipo: 'number', extra: 'step="0.01" min="0"' })}
        ${campo({ nome: 'aliq_pis', rotulo: 'PIS %', valor: p.aliq_pis, tam: 3, tipo: 'number', extra: 'step="0.01" min="0"' })}
        ${campo({ nome: 'aliq_cofins', rotulo: 'COFINS %', valor: p.aliq_cofins, tam: 3, tipo: 'number', extra: 'step="0.01" min="0"' })}
      </div></div>
      <div class="campo" data-so="servico"><div class="campos">
        ${campo({ nome: 'codigo_servico', rotulo: 'Item da lista de serviço (LC 116)', valor: p.codigo_servico, tam: 6, extra: 'class="mono"', dica: 'Ex.: 01.07 — suporte técnico em informática' })}
        ${campo({ nome: 'aliq_iss', rotulo: 'Alíquota ISS %', valor: p.aliq_iss, tam: 6, tipo: 'number', extra: 'step="0.01" min="0" max="5"', dica: 'Entre 2% e 5%, conforme o município' })}
      </div></div>
    </div>`,
    aoAbrir: (form) => {
      const alternar = () => $$('[data-so]', form).forEach((el) => { el.hidden = el.dataset.so !== form.elements.tipo.value; });
      form.elements.tipo.onchange = alternar;
      alternar();
    },
    aoSalvar: async (d) => {
      await api(p.id ? 'PUT' : 'POST', p.id ? `/api/produtos/${p.id}` : '/api/produtos', d);
      aviso('Item salvo.', 'ok');
      await depois?.();
    },
  });
}

telas.produtos = async () => {
  conteudo.innerHTML = `
    <div class="cabecalho"><div><h1>Produtos e serviços</h1><p>Cadastro com tributação padrão para agilizar a emissão</p></div>
      <div class="acoes"><button class="btn primario" id="novo">+ Novo item</button></div></div>
    <section class="cartao"><div class="filtros"><input type="search" id="busca" placeholder="Buscar por descrição, código ou NCM…" aria-label="Buscar"></div><div id="lista"></div></section>`;
  const carregar = async () => {
    const lista = await api('GET', `/api/produtos?q=${encodeURIComponent($('#busca').value)}`);
    $('#lista').innerHTML = !lista.length ? '<div class="vazio"><strong>Nenhum item</strong>Cadastre produtos (NF-e) ou serviços (NFS-e).</div>'
      : `<div class="tabela-wrap"><table><thead><tr><th>Descrição</th><th>Tipo</th><th>Fiscal</th><th>Tributos</th><th class="num">Preço</th><th></th></tr></thead><tbody>
        ${lista.map((p) => `<tr><td><b>${esc(p.descricao)}</b><span class="sub">${esc(p.codigo || '')}</span></td>
          <td><span class="tipo ${p.tipo === 'servico' ? 'NFSe' : 'NFe'}">${p.tipo === 'servico' ? 'Serviço' : 'Produto'}</span></td>
          <td class="mono">${p.tipo === 'servico' ? `LC116 ${esc(p.codigo_servico || '—')}` : `NCM ${esc(p.ncm)} · CFOP ${esc(p.cfop)}`}</td>
          <td>${p.tipo === 'servico' ? `ISS ${numero(p.aliq_iss)}%` : `ICMS ${numero(p.aliq_icms)}% · IPI ${numero(p.aliq_ipi)}%`}</td>
          <td class="num">${moeda(p.preco)}</td>
          <td class="num"><button class="btn pequeno" data-editar="${p.id}">Editar</button> <button class="btn pequeno perigo" data-excluir="${p.id}">Excluir</button></td></tr>`).join('')}
        </tbody></table></div>`;
    $$('[data-editar]').forEach((b) => b.onclick = () => formProduto(lista.find((p) => p.id == b.dataset.editar), carregar));
    $$('[data-excluir]').forEach((b) => b.onclick = async () => {
      if (!confirm('Excluir este item?')) return;
      try { await api('DELETE', `/api/produtos/${b.dataset.excluir}`); aviso('Item excluído.'); carregar(); } catch (e) { aviso(e.message, 'erro'); }
    });
  };
  $('#novo').onclick = () => formProduto(null, carregar);
  $('#busca').oninput = carregar;
  await carregar();
};

// ---------------------------------------------------------------------------
// Configurações (emitente)
// ---------------------------------------------------------------------------
telas.config = async () => {
  const e = await api('GET', '/api/emitente');
  conteudo.innerHTML = `
    <div class="cabecalho"><div><h1>Configurações</h1><p>Dados da sua empresa, numeração e integração de emissão</p></div></div>
    <form class="cartao" id="form-config"><div class="corpo">
      <fieldset><legend>Empresa emitente</legend><div class="campos">
        ${campo({ nome: 'cnpj', rotulo: 'CNPJ *', valor: documento(e.cnpj), tam: 4, extra: 'required' })}
        ${campo({ nome: 'ie', rotulo: 'Inscrição estadual', valor: e.ie, tam: 4, dica: 'Obrigatória para NF-e' })}
        ${campo({ nome: 'im', rotulo: 'Inscrição municipal', valor: e.im, tam: 4, dica: 'Obrigatória para NFS-e' })}
        ${campo({ nome: 'razao_social', rotulo: 'Razão social *', valor: e.razao_social, tam: 6, extra: 'required' })}
        ${campo({ nome: 'nome_fantasia', rotulo: 'Nome fantasia', valor: e.nome_fantasia, tam: 6 })}
        <div class="campo c4"><label for="f-regime">Regime tributário</label><select id="f-regime" name="regime">
          ${opcoes([['1', 'Simples Nacional'], ['3', 'Regime Normal (Lucro Presumido/Real)']], e.regime)}</select></div>
        ${campo({ nome: 'telefone', rotulo: 'Telefone', valor: e.telefone, tam: 4 })}
        ${campo({ nome: 'email', rotulo: 'E-mail', valor: e.email, tam: 4, tipo: 'email' })}
      </div></fieldset>
      <fieldset><legend>Endereço</legend><div class="campos">
        ${campo({ nome: 'cep', rotulo: 'CEP', valor: e.cep, tam: 3, dica: 'Preenche o endereço' })}
        ${campo({ nome: 'logradouro', rotulo: 'Logradouro', valor: e.logradouro, tam: 6 })}
        ${campo({ nome: 'numero', rotulo: 'Número', valor: e.numero, tam: 3 })}
        ${campo({ nome: 'complemento', rotulo: 'Complemento', valor: e.complemento, tam: 3 })}
        ${campo({ nome: 'bairro', rotulo: 'Bairro', valor: e.bairro, tam: 3 })}
        ${campo({ nome: 'municipio', rotulo: 'Município *', valor: e.municipio, tam: 3 })}
        ${campo({ nome: 'cod_municipio', rotulo: 'Cód. IBGE', valor: e.cod_municipio, tam: 2 })}
        <div class="campo c1" style="grid-column:span 1"><label for="f-uf">UF *</label><select id="f-uf" name="uf">${opcoesUF(e.uf)}</select></div>
      </div></fieldset>
      <fieldset><legend>Numeração</legend><div class="campos">
        ${campo({ nome: 'serie_nfe', rotulo: 'Série NF-e', valor: e.serie_nfe, tam: 3, tipo: 'number', extra: 'min="0"' })}
        ${campo({ nome: 'proximo_nfe', rotulo: 'Próximo nº NF-e', valor: e.proximo_nfe, tam: 3, tipo: 'number', extra: 'min="1"' })}
        ${campo({ nome: 'serie_nfse', rotulo: 'Série NFS-e (RPS)', valor: e.serie_nfse, tam: 3, tipo: 'number', extra: 'min="0"' })}
        ${campo({ nome: 'proximo_nfse', rotulo: 'Próximo nº NFS-e', valor: e.proximo_nfse, tam: 3, tipo: 'number', extra: 'min="1"' })}
      </div></fieldset>
      <fieldset><legend>Reforma tributária (IBS e CBS)</legend><div class="campos">
        <div class="campo c6"><label for="f-ibs">Destacar IBS/CBS nas notas</label><select id="f-ibs" name="ibs_cbs_destacar">
          ${opcoes([['auto', 'Automático (sim no regime normal, não no Simples)'], ['sim', 'Sim, sempre'], ['nao', 'Não']], e.ibs_cbs_destacar)}</select></div>
        ${campo({ nome: 'aliq_cbs', rotulo: 'CBS %', valor: e.aliq_cbs, tam: 2, tipo: 'number', extra: 'step="0.01" min="0" max="100"' })}
        ${campo({ nome: 'aliq_ibs_uf', rotulo: 'IBS estadual %', valor: e.aliq_ibs_uf, tam: 2, tipo: 'number', extra: 'step="0.01" min="0" max="100"' })}
        ${campo({ nome: 'aliq_ibs_mun', rotulo: 'IBS municipal %', valor: e.aliq_ibs_mun, tam: 2, tipo: 'number', extra: 'step="0.01" min="0" max="100"' })}
        <div class="campo"><p class="dica" style="margin:0">Em 2026 é a fase de teste: CBS 0,9% e IBS 0,1%, só informativos (não somam no total nem são recolhidos).
          É obrigatório no regime normal e facultativo no Simples Nacional, mas recomendado se você vende para outras empresas. Confirme com seu contador.</p></div>
      </div></fieldset>
      <fieldset><legend>E-mail (para enviar notas aos clientes)</legend><div class="campos">
        ${campo({ nome: 'smtp_host', rotulo: 'Servidor SMTP', valor: e.smtp_host, tam: 5, extra: 'placeholder="smtp.gmail.com"' })}
        <div class="campo c4"><label for="f-seg">Segurança</label><select id="f-seg" name="smtp_seguranca">
          ${opcoes([['starttls', 'STARTTLS (porta 587)'], ['ssl', 'SSL/TLS (porta 465)'], ['nenhuma', 'Nenhuma (não recomendado)']], e.smtp_seguranca)}</select></div>
        ${campo({ nome: 'smtp_porta', rotulo: 'Porta', valor: e.smtp_porta, tam: 3, tipo: 'number', extra: 'min="1" max="65535"' })}
        ${campo({ nome: 'smtp_usuario', rotulo: 'Usuário (e-mail)', valor: e.smtp_usuario, tam: 4, extra: 'autocomplete="off"' })}
        ${campo({ nome: 'smtp_senha', rotulo: 'Senha do e-mail', tam: 4, tipo: 'password', extra: `autocomplete="new-password" placeholder="${e.smtp_senha_configurada ? '•••••• (configurada)' : ''}"`, dica: 'Em branco mantém a atual. No Gmail, use uma “senha de app”.' })}
        ${campo({ nome: 'smtp_remetente', rotulo: 'E-mail do remetente', valor: e.smtp_remetente, tam: 4, tipo: 'email', dica: 'Vazio = o mesmo do usuário' })}
        <div class="campo"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn pequeno" id="testar-email">Salvar e enviar e-mail de teste</button>
          <span class="dica">Com a Focus NFe, o envio da nota é feito por ela (com DANFE em PDF) e este e-mail não é usado.</span></div></div>
      </div></fieldset>
      <fieldset style="margin:0"><legend>Transmissão</legend><div class="campos">
        <div class="campo c4"><label for="f-prov">Provedor</label><select id="f-prov" name="provedor">
          ${opcoes([['simulacao', 'Simulação local (testes)'], ['focusnfe', 'Focus NFe (SEFAZ / prefeituras)']], e.provedor)}</select></div>
        <div class="campo c4"><label for="f-amb">Ambiente</label><select id="f-amb" name="ambiente">
          ${opcoes([['homologacao', 'Homologação (sem valor fiscal)'], ['producao', 'Produção']], e.ambiente)}</select></div>
        ${campo({ nome: 'token', rotulo: 'Token da API', tam: 4, tipo: 'password', extra: `autocomplete="off" placeholder="${e.token_configurado ? '•••••• (configurado)' : 'Cole o token aqui'}"`, dica: 'Em branco mantém o token atual' })}
        <div class="campo"><div class="aviso-box info" style="margin:0">
          <b>Como emitir notas reais:</b> crie uma conta na Focus NFe, cadastre sua empresa e envie o certificado digital A1 no painel deles,
          copie o token de <b>homologação</b> para cá e faça testes. Quando tudo estiver certo, troque para o token e ambiente de <b>produção</b>.
        </div></div>
      </div></fieldset>
    </div>
    <footer style="padding:14px 18px;border-top:1px solid var(--borda);display:flex;justify-content:flex-end"><button class="btn primario">Salvar configurações</button></footer></form>
    <div class="grade g2" style="margin-top:16px">
      <section class="cartao"><header><h2>Usuários</h2><div class="acoes">
        <button type="button" class="btn pequeno" id="trocar-senha">Trocar minha senha</button>
        <button type="button" class="btn pequeno" id="novo-usuario">+ Novo usuário</button></div></header>
        <div id="lista-usuarios"></div></section>
      <section class="cartao"><header><h2>Backup</h2><button type="button" class="btn pequeno primario" id="fazer-backup">Fazer backup agora</button></header>
        <div id="lista-backups"></div></section>
    </div>`;
  const form = $('#form-config');
  ligarCEP(form);
  ligarUsuariosEBackup();
  const seg = form.elements.smtp_seguranca;
  seg.onchange = () => { form.elements.smtp_porta.value = seg.value === 'ssl' ? 465 : seg.value === 'starttls' ? 587 : 25; };
  $('#testar-email').onclick = () => abrirModal({
    titulo: 'Enviar e-mail de teste',
    botao: 'Enviar teste',
    corpo: campo({ nome: 'para', rotulo: 'Enviar para', valor: form.elements.smtp_remetente.value || form.elements.smtp_usuario.value, tipo: 'email', extra: 'required' }),
    aoSalvar: async (d) => {
      await api('PUT', '/api/emitente', dadosForm(form));
      await api('POST', '/api/email/teste', d);
      aviso(`E-mail de teste enviado para ${d.para}. Confira a caixa de entrada (e o spam).`, 'ok');
    },
  });
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = dadosForm(form);
    if (d.ambiente === 'producao' && e.ambiente !== 'producao' &&
      !confirm('Em PRODUÇÃO as notas têm valor fiscal e serão transmitidas de verdade. Continuar?')) return;
    try {
      await api('PUT', '/api/emitente', d);
      aviso('Configurações salvas.', 'ok');
      await atualizarLateral();
      telas.config();
    } catch (err) { aviso(err.message, 'erro'); }
  };
};

// ---------------------------------------------------------------------------
// Usuários e backup (dentro de Configurações)
// ---------------------------------------------------------------------------
function ligarUsuariosEBackup() {
  const tamanho = (b) => (b > 1048576 ? `${numero(b / 1048576, 1)} MB` : `${numero(b / 1024, 0)} KB`);

  const carregarUsuarios = async () => {
    const lista = await api('GET', '/api/usuarios');
    $('#lista-usuarios').innerHTML = `<div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>Último acesso</th><th></th></tr></thead><tbody>
      ${lista.map((u) => `<tr><td><b>${esc(u.nome)}</b>${u.id === usuarioAtual.id ? ' <span class="sub" style="display:inline">(você)</span>' : ''}<span class="sub">${esc(u.login)}</span></td>
        <td>${dataBR(u.ultimo_acesso) || '—'}</td>
        <td class="num">${u.id === usuarioAtual.id ? '' : `<button class="btn pequeno perigo" data-excluir-usuario="${u.id}">Excluir</button>`}</td></tr>`).join('')}
      </tbody></table></div>`;
    $$('[data-excluir-usuario]').forEach((b) => b.onclick = async () => {
      if (!confirm('Excluir este usuário? Ele perderá o acesso ao sistema.')) return;
      try { await api('DELETE', `/api/usuarios/${b.dataset.excluirUsuario}`); aviso('Usuário excluído.'); carregarUsuarios(); } catch (e) { aviso(e.message, 'erro'); }
    });
  };

  const carregarBackups = async () => {
    const { pasta, backups } = await api('GET', '/api/backups');
    $('#lista-backups').innerHTML = `<div class="corpo" style="padding-bottom:0"><p class="dica" style="margin:0">
        Backup automático ao ligar o sistema e a cada 6 horas. Os 30 mais recentes ficam guardados em <span class="mono">${esc(pasta)}</span>.</p></div>
      ${!backups.length ? '<div class="vazio"><strong>Nenhum backup ainda</strong>Clique em “Fazer backup agora”.</div>'
        : `<div class="tabela-wrap"><table><thead><tr><th>Data</th><th class="num">Tamanho</th><th></th></tr></thead><tbody>
          ${backups.slice(0, 8).map((b) => `<tr><td>${new Date(b.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}<span class="sub mono">${esc(b.nome)}</span></td>
            <td class="num">${tamanho(b.tamanho)}</td><td class="num"><a class="btn pequeno" href="/api/backups/${encodeURIComponent(b.nome)}">Baixar</a></td></tr>`).join('')}
          </tbody></table></div>${backups.length > 8 ? `<div class="filtros" style="border:0;border-top:1px solid var(--borda)">+ ${backups.length - 8} backup(s) mais antigo(s) na pasta</div>` : ''}`}`;
  };

  $('#novo-usuario').onclick = () => abrirModal({
    titulo: 'Novo usuário',
    botao: 'Criar usuário',
    corpo: `<div class="campos">
      ${campo({ nome: 'nome', rotulo: 'Nome *', tam: 6, extra: 'required' })}
      ${campo({ nome: 'login', rotulo: 'Usuário *', tam: 6, extra: 'required autocapitalize="none" autocomplete="off"' })}
      ${campo({ nome: 'senha', rotulo: 'Senha inicial *', tam: 6, tipo: 'password', extra: 'required minlength="8" autocomplete="new-password"', dica: 'Mínimo de 8 caracteres. Passe para a pessoa e peça que ela troque.' })}
    </div>`,
    aoSalvar: async (d) => { await api('POST', '/api/usuarios', d); aviso('Usuário criado.', 'ok'); carregarUsuarios(); },
  });

  $('#trocar-senha').onclick = () => abrirModal({
    titulo: 'Trocar minha senha',
    botao: 'Trocar senha',
    corpo: `<div class="campos">
      ${campo({ nome: 'senha_atual', rotulo: 'Senha atual', tipo: 'password', extra: 'required autocomplete="current-password"' })}
      ${campo({ nome: 'nova_senha', rotulo: 'Nova senha', tam: 6, tipo: 'password', extra: 'required minlength="8" autocomplete="new-password"' })}
      ${campo({ nome: 'confirmar', rotulo: 'Confirme a nova senha', tam: 6, tipo: 'password', extra: 'required minlength="8" autocomplete="new-password"' })}
    </div>`,
    aoSalvar: async (d) => {
      if (d.nova_senha !== d.confirmar) throw new Error('As senhas não conferem.');
      await api('POST', '/api/usuarios/eu/senha', d);
      aviso('Senha alterada.', 'ok');
    },
  });

  $('#fazer-backup').onclick = async (ev) => {
    ev.target.disabled = true;
    try { const b = await api('POST', '/api/backups'); aviso(`Backup criado: ${b.nome}`, 'ok'); carregarBackups(); } catch (e) { aviso(e.message, 'erro'); }
    ev.target.disabled = false;
  };

  carregarUsuarios().catch((e) => aviso(e.message, 'erro'));
  carregarBackups().catch((e) => aviso(e.message, 'erro'));
}

// ---------------------------------------------------------------------------
iniciar().catch((err) => { conteudo.innerHTML = `<div class="aviso-box erro">${esc(err.message)}</div>`; });
