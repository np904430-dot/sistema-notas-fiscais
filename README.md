# Emissor de Notas Fiscais

Sistema web para emissão de **NF-e** (produtos, modelo 55) e **NFS-e** (serviços), feito em Node.js puro — sem dependências para instalar.

## Como rodar

Requisito: Node.js 22.13 ou superior.

```bash
npm start
```

Abra http://localhost:3000. No VS Code, aperte **F5** (configuração "Iniciar sistema de notas") e o navegador abre sozinho.

## O que o sistema faz

- **Painel**: faturamento do mês por tipo de nota, pendências e gráfico dos últimos 6 meses.
- **Emitir nota**: NF-e ou NFS-e, com destinatário, itens puxados do cadastro, desconto, frete, ISS retido e cálculo automático de ICMS, IPI, PIS, COFINS e ISS.
- **Notas emitidas**: busca e filtros, impressão do DANFE / NFS-e (com código de barras da chave), download do XML (layout NF-e 4.00 e RPS ABRASF 2.04), consulta, reenvio de rejeitadas e cancelamento com justificativa (NF-e: prazo de 24h).
- **Clientes** e **Produtos/Serviços**: cadastros com validação de CPF/CNPJ, NCM, CFOP e preenchimento de endereço pelo CEP (ViaCEP, inclui o código IBGE).
- **Configurações**: dados do emitente, regime tributário (Simples Nacional zera o ICMS destacado, CSOSN 102), séries e numeração, provedor e ambiente.

## Recursos fiscais

- **IBS e CBS (reforma tributária)**: em 2026 (fase de teste) são destacados por item e no total — CBS 0,9% e IBS 0,1% —
  apenas como informação: não somam no valor da nota. Configure em **Configurações → Reforma tributária**:
  *Automático* destaca no regime normal (obrigatório) e não destaca no Simples Nacional (facultativo em 2026).
  Cada produto/serviço tem CST IBS/CBS (padrão `000`) e cClassTrib (padrão `000001`); confirme os códigos com o contador.
  No XML da NF-e entram os grupos `IBSCBS` e `IBSCBSTot` (NT 2025.002-RTC).
- **Carta de correção (CC-e)**: na tela de uma NF-e autorizada. Até 20 por nota; cada nova substitui as anteriores.
  Não pode alterar valores, impostos, data nem as partes da nota.
- **Inutilização de numeração**: em **Notas emitidas → Inutilizar numeração**, para números de NF-e pulados ou rejeitados.
  Números já autorizados/cancelados são bloqueados; se a faixa incluir o próximo número, ele avança.
- **Envio por e-mail**: botão **Enviar por e-mail** na nota.
  - Com a **Focus NFe**, ela envia o DANFE em PDF e o XML.
  - Na **simulação**, sai pelo SMTP configurado em **Configurações → E-mail**, com o resumo da nota e o XML em anexo.
    No Gmail use `smtp.gmail.com`, STARTTLS 587 e uma *senha de app* (não a senha normal).

## Login

No primeiro acesso o sistema pede para criar o usuário administrador. Depois disso, todas as telas e a API exigem login.
Outros usuários são cadastrados em **Configurações → Usuários**.

- Senhas com no mínimo 8 caracteres, guardadas com hash (scrypt), nunca em texto.
- A sessão dura 7 dias (cookie HttpOnly). O botão **Sair** fica no rodapé do menu.
- Após 5 senhas erradas seguidas, o login fica bloqueado por 5 minutos.

**Esqueceu a senha e não há outro usuário?** Pare o sistema e apague as tabelas de usuários e sessões
(as notas e cadastros continuam). Ao abrir de novo, ele volta para a tela de primeiro acesso:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.LOCALAPPDATA+'/EmissorNF/notas.db');d.exec('DELETE FROM sessoes; DELETE FROM usuarios;')"
```

## Onde ficam os dados e os backups

- **Banco ativo**: `%LOCALAPPDATA%\EmissorNF\notas.db` (fora do OneDrive, porque sincronizar um banco enquanto ele grava pode corromper o arquivo). Dá para mudar com a variável `DATA_DIR`.
- **Backups**: pasta `backups/` do projeto. Como ela fica no OneDrive, cada backup também vai para a nuvem.
  - Automático ao ligar o sistema e a cada 6 horas enquanto ele estiver ligado; os 30 mais recentes ficam guardados.
  - Manual em **Configurações → Backup → Fazer backup agora**, onde também dá para baixar cada um.

**Para restaurar um backup:** pare o sistema (Ctrl+C), copie o arquivo `backups\notas-AAAA-MM-DD_HH-MM-SS.db`
para `%LOCALAPPDATA%\EmissorNF\notas.db` (substituindo o atual e apagando `notas.db-wal` e `notas.db-shm`, se existirem)
e ligue o sistema de novo.

## Emissão real (SEFAZ / prefeitura)

Por padrão o sistema usa o provedor **Simulação local**: as notas são "autorizadas" na hora, com chave de acesso válida no formato da SEFAZ, mas **nada é transmitido** e as notas não têm valor fiscal.

Transmitir de verdade exige um certificado digital A1 e a assinatura XML no padrão da SEFAZ. Este sistema delega essa parte à [Focus NFe](https://focusnfe.com.br):

1. Crie uma conta na Focus NFe e cadastre sua empresa e seu certificado A1 no painel deles.
2. Em **Configurações → Transmissão**, escolha *Focus NFe*, ambiente *Homologação* e cole o token de homologação.
3. Emita notas de teste. Quando estiver tudo certo, troque para o token e o ambiente de **Produção**.

> Revise a tributação (CFOP, NCM, CST e alíquotas) com seu contador antes de emitir em produção.

## Estrutura

```
server.js            servidor HTTP e rotas da API
src/db.js            banco SQLite (%LOCALAPPDATA%\EmissorNF\notas.db, criado sozinho)
src/auth.js          usuários, senhas e sessões
src/backup.js        backups automáticos e manuais
src/fiscal.js        cálculo de impostos, chave de acesso e geração de XML
src/provedores.js    simulação local e integração com a Focus NFe
src/validacao.js     validação de CPF/CNPJ
public/              interface (index.html, app.js, app.css) e impressão (danfe.html)
```
