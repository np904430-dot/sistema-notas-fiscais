# Checklist — Emissor de Notas Fiscais

Última verificação: 28/10/2026 — 68 de 68 testes automáticos passaram.

## ✅ Já funcionando (testado)

- [x] Login com senha, sessão de 7 dias, botão Sair, bloqueio após 5 senhas erradas
- [x] Primeiro acesso e usuário administrador (`nicolas.adm`)
- [x] Cadastro de usuários e troca de senha (com o olho para ver a senha)
- [x] Proteção contra acesso sem login e contra pedidos de outros sites
- [x] Dados da empresa, regime tributário e numeração
- [x] Clientes (validação de CPF/CNPJ, endereço pelo CEP)
- [x] Produtos e serviços (NCM, CFOP, alíquotas, IBS/CBS)
- [x] Emissão de NF-e e NFS-e com cálculo de impostos
- [x] Chave de acesso de 44 dígitos com dígito verificador correto
- [x] DANFE e NFS-e para imprimir/salvar em PDF, com código de barras
- [x] XML para download (NF-e 4.00 e RPS ABRASF)
- [x] IBS e CBS da reforma tributária (CBS 0,9% e IBS 0,1% em 2026)
- [x] Cancelamento com justificativa (NF-e em até 24h)
- [x] Carta de correção
- [x] Inutilização de numeração
- [x] Envio da nota por e-mail (testado com servidor de e-mail de teste)
- [x] Painel, filtros e busca de notas
- [x] Backup automático (ao ligar e a cada 6h) e manual
- [x] Funciona no computador e no celular

## ⬜ Para você fazer

### Antes de usar no dia a dia
- [ ] Trocar a senha (ela apareceu num print): Configurações → Usuários → Trocar minha senha
- [ ] Criar um segundo usuário de reserva, para não ficar sem acesso se esquecer a senha
- [x] Apagar os dados de exemplo (feito em 28/10/2026; backup antes em `backups/notas-2026-10-28_10-31-37.db`)
- [ ] Cadastrar os dados reais da empresa, clientes e produtos
- [x] Apagar a pasta `data-antigo-pode-apagar`

### E-mail
- [ ] Configurar o e-mail em Configurações → E-mail (no Gmail: `smtp.gmail.com`, STARTTLS 587 e uma *senha de app*)
- [ ] Clicar em **Salvar e enviar e-mail de teste** e confirmar que chegou

### Com o contador
- [ ] Conferir CFOP, NCM e alíquotas de ICMS/IPI/PIS/COFINS de cada produto
- [ ] Conferir CST e cClassTrib de IBS/CBS (padrão: `000` / `000001`)
- [ ] Conferir código do serviço (LC 116) e alíquota de ISS de cada serviço
- [ ] Decidir se a empresa vai destacar IBS/CBS em 2026 (opcional no Simples Nacional)

### Para emitir notas de verdade
- [ ] Comprar o certificado digital A1 da empresa
- [ ] Criar conta na Focus NFe e enviar o certificado no painel deles
- [ ] Confirmar que a Focus atende a NFS-e da sua cidade
- [ ] Colar o token de **homologação** em Configurações → Transmissão (provedor Focus NFe)
- [ ] Emitir notas de teste em homologação: NF-e, NFS-e, cancelamento, carta de correção, inutilização e e-mail
- [ ] Só depois: trocar para o token e o ambiente de **produção**

## 🔁 Rotina

- [ ] Ligar o sistema: abrir a pasta SITE no VS Code e apertar **F5** (ou `npm start`)
- [ ] De vez em quando, conferir em Configurações → Backup se os backups estão sendo feitos
- [ ] Guardar uma cópia de um backup fora do computador (o OneDrive já faz isso com a pasta `backups`)
