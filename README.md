# 📄 Portal de Segunda Via de Boletos

Sistema profissional para consulta e emissão de segunda via de boletos bancários, integrado com SQL Server e envio de links de acesso seguro via e-mail (Magic Links).

---

## 🚀 Tecnologias Utilizadas

*   **Backend**: [Node.js](https://nodejs.org/) com [Express](https://expressjs.com/).
*   **Banco de Dados**: Microsoft SQL Server (utilizando a biblioteca `mssql`).
*   **E-mail**: [Nodemailer](https://nodemailer.com/) para envio de tokens de acesso.
*   **Frontend**: HTML5, CSS3 (Vanilla) e JavaScript Moderno.
*   **Bibliotecas Externas**:
    *   `html2pdf.js`: Geração de PDFs no navegador.
    *   `JsBarcode`: Geração de códigos de barras (formato ITF).
    *   `dotenv`: Gerenciamento de variáveis de ambiente seguras.

---

## 📂 Estrutura do Projeto

```text
boleto/
├── boleto-server.js        # Servidor principal (API e Rotas)
├── .env                    # Arquivo de credenciais (NÃO enviar para o Git)
├── .env.example            # Modelo para configuração do ambiente
├── package.json            # Dependências e scripts do Node.js
├── public/                 # Arquivos estáticos do frontend
│   ├── index.html          # Interface do usuário (Single Page Application)
│   ├── style.css           # Identidade visual e layout responsivo
│   ├── app.js              # Lógica do frontend e integração com a API
│   └── logos/              # Repositório de logos dos bancos em SVG
└── README.md               # Esta documentação
```

---

## 🛠️ Configuração e Instalação

### 1. Pré-requisitos
*   Node.js instalado (v16 ou superior).
*   Acesso ao banco de dados SQL Server.

### 2. Instalação
No terminal, dentro da pasta do projeto, execute:
```bash
npm install
```

### 3. Variáveis de Ambiente (`.env`)
Crie um arquivo `.env` baseado no `.env.example` e preencha as credenciais:
*   `DB_USER` / `DB_PASSWORD`: Acesso ao SQL Server.
*   `DB_SERVER` / `DB_NAME`: IP e nome do banco de dados.
*   `SMTP_USER` / `SMTP_PASS`: Credenciais de e-mail (para Gmail, use "Senha de App").

### 4. Executando o Projeto
```bash
node boleto-server.js
```
O portal estará disponível em `http://localhost:3001`.

---

## 🔒 Fluxo de Segurança e Acesso

1.  **Identificação**: O cliente digita o CPF/CNPJ. O sistema verifica se existe um e-mail vinculado no banco.
2.  **Confirmação**: O sistema mostra os e-mails mascarados (ex: `ti***o@...`). O cliente deve digitar o e-mail completo para confirmar.
3.  **Magic Link**: Um token único e temporário é gerado e enviado por e-mail.
4.  **Acesso**: Ao clicar no link, o cliente é autenticado sem senha e pode visualizar suas faturas.
5.  **SQL Protection**: Todas as consultas usam parâmetros (`@cgc`), tornando o sistema imune a ataques de SQL Injection.

---

## 📋 Regras de Negócio e Manutenção

### 1. Consulta de Boletos
A consulta principal busca dados nas tabelas `titulo_receber_boleto` e `titulo_receber`. Caso precise alterar os campos buscados, edite a rota `/api/boleto/list` no `boleto-server.js`.

### 2. Bloqueio de Vencidos
Boletos com data de vencimento anterior à data atual (`isExpired()`) têm o botão de impressão ocultado automaticamente, exibindo uma mensagem para contatar o financeiro.

### 3. Logos de Bancos
O sistema mapeia o código do banco (ex: 001, 341) para o arquivo correspondente em `public/logos/`. Para adicionar um novo banco:
1.  Verifique o código do banco no campo `NR_BANCO` do SQL.
2.  Adicione o mapeamento na função `getBankLogo` em `public/app.js`.

### 4. Layout do Boleto
O layout de impressão (CSS de impressão) está isolado no final do arquivo `style.css` sob a `@media print`. Ele foi otimizado para caber perfeitamente em uma folha A4.
