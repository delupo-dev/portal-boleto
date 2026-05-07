const express = require('express');
const sql = require('mssql');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORTA = process.env.PORT || 3001;

// ─── SEGURANÇA: Prevenir queda do servidor por erros inesperados ─────────────
process.on('uncaughtException', (err) => {
  console.error('🔥 ERRO CRÍTICO (uncaughtException):', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 ERRO CRÍTICO (unhandledRejection):', reason, promise);
});

// ─── SEGURANÇA: Rate Limiting (Proteção contra Robôs) ────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // limite de 100 req por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' }
});

const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // apenas 10 consultas de CPF por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de consultas excedido. Tente novamente em 15 minutos.' }
});

// Aplicar limite geral em todas as rotas
app.use(generalLimiter);

// ─── DB CONFIG ───────────────────────────────────────────────────────────────
const sqlConfig = {
  user: process.env.DB_USER || 'dev',
  password: process.env.DB_PASSWORD || '',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || '',
  port: parseInt(process.env.DB_PORT || '1433'),
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// ─── EMAIL CONFIG ─────────────────────────────────────────────────────────────
// Configure your SMTP here. Example uses Gmail App Password.
// For a local SMTP relay, change host/port/auth accordingly.
const mailerConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  },
  tls: {
    rejectUnauthorized: false
  }
};

const transporter = nodemailer.createTransport({
  ...mailerConfig,
  family: 4 // Force IPv4 to avoid ENETUNREACH errors
});

// ─── IN-MEMORY TOKEN STORE (production: use Redis/DB) ─────────────────────────
// token -> { cgc, email, expires }
const tokenStore = new Map();
// cgc -> { email, expires, attempts }
const pendingVerifications = new Map();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware para capturar erros de JSON malformado
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'JSON malformado.' });
  }
  next();
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function formatCGC(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '');
  return digits;
}

function maskEmail(emailStr) {
  if (!emailStr) return '';
  // Split by semicolon or comma to handle multiple emails
  const emails = emailStr.split(/[;,]/).map(e => e.trim()).filter(e => e.includes('@'));
  
  if (emails.length === 0) return emailStr;

  const masked = emails.map(e => {
    const [user, domain] = e.split('@');
    if (!domain) return e;
    // Mask user part: first 2 chars + *** + last char
    const prefix = user.length > 2 ? user.slice(0, 2) : user.slice(0, 1);
    const suffix = user.length > 1 ? user.slice(-1) : '';
    return prefix + '***' + suffix + '@' + domain;
  });

  return masked.join('; ');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── POOL HELPER ──────────────────────────────────────────────────────────────
async function getPool() {
  const pool = new sql.ConnectionPool(sqlConfig);
  await pool.connect();
  return pool;
}

// ─── ROUTE: Lookup CGC → return masked email ──────────────────────────────────
// POST /api/boleto/lookup
// Body: { cgc: "12345678000195" }
app.post('/api/boleto/lookup', lookupLimiter, async (req, res) => {
  const { cgc } = req.body;
  if (!cgc) return res.status(400).json({ error: 'CPF/CNPJ obrigatório.' });

  const digits = formatCGC(cgc);
  if (digits.length !== 11 && digits.length !== 14) {
    return res.status(400).json({ error: 'CPF/CNPJ inválido.' });
  }

  let pool;
  try {
    pool = await getPool();
    const request = pool.request();
    request.input('cgc', sql.VarChar, digits);

    // Look up the client email from the cliente table
    const result = await request.query(`
      SELECT TOP 1 
        c.nm_cliente,
        c.cgc,
        COALESCE(NULLIF(c.email_boleto,''), NULLIF(c.email_nfe,''), NULLIF(c.email,''), NULLIF(c.contato_email1,'')) AS email
      FROM cliente c
      WHERE REPLACE(REPLACE(REPLACE(c.cgc, '.', ''), '-', ''), '/', '') = @cgc
        AND COALESCE(NULLIF(c.email_boleto,''), NULLIF(c.email_nfe,''), NULLIF(c.email,''), NULLIF(c.contato_email1,'')) IS NOT NULL
    `);

    if (!result.recordset || result.recordset.length === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado ou sem email cadastrado.' });
    }

    const cliente = result.recordset[0];
    const maskedEmail = maskEmail(cliente.email);

    // Store pending verification
    pendingVerifications.set(digits, {
      email: cliente.email,
      name: cliente.nm_cliente,
      expires: Date.now() + 10 * 60 * 1000 // 10 min
    });

    return res.json({
      nome: cliente.nm_cliente,
      emailMascarado: maskedEmail,
      cgc: digits
    });
  } catch (err) {
    console.error('Erro lookup:', err);
    return res.status(500).json({ error: 'Erro ao consultar cliente.', detail: err.message });
  } finally {
    if (pool) pool.close();
  }
});

// ─── ROUTE: Send magic link via email ────────────────────────────────────────
// POST /api/boleto/send-link
// Body: { cgc: "12345678000195" }
app.post('/api/boleto/send-link', lookupLimiter, async (req, res) => {
  const { cgc, emailDigitado } = req.body;
  if (!cgc) return res.status(400).json({ error: 'CPF/CNPJ obrigatório.' });
  if (!emailDigitado) return res.status(400).json({ error: 'Email de confirmação obrigatório.' });

  const digits = formatCGC(cgc);
  const pending = pendingVerifications.get(digits);

  if (!pending || Date.now() > pending.expires) {
    return res.status(400).json({ error: 'Sessão expirada. Tente novamente.' });
  }

  // Verify if typed email matches any in the database field (semicolon/comma separated)
  const registeredEmails = pending.email.split(/[;,]/).map(e => e.trim().toLowerCase());
  const typed = emailDigitado.trim().toLowerCase();

  if (!registeredEmails.includes(typed)) {
    return res.status(400).json({ 
      error: 'O email informado não coincide com o nosso cadastro.',
      code: 'EMAIL_MISMATCH'
    });
  }

  // Generate access token
  const token = generateToken();
  tokenStore.set(token, {
    cgc: digits,
    email: typed, // Use the verified email
    name: pending.name,
    expires: Date.now() + 60 * 60 * 1000 // 1 hour
  });

  // Build magic link (adapt host/port for production)
  const host = req.headers.host || `localhost:${PORTA}`;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const magicLink = `${protocol}://${host}/boletos?token=${token}`;

  try {
    await transporter.sendMail({
      from: `"Portal Delupo" <${mailerConfig.auth.user}>`,
      to: typed,
      subject: '🔐 Acesso aos seus boletos pendentes - Delupo',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:#ffffff; padding:40px 20px; color:#111827;">
          <div style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 20px 50px rgba(0,0,0,0.1); border:1px solid #E5E7EB;">
            <div style="background:#4b5563; padding:50px 20px; text-align:center;">
              <img src="cid:logo" alt="Delupo" style="height:120px; width:auto; margin-bottom:20px;">
              <h1 style="color:#ffffff; margin:0; font-size:22px; font-weight:bold;">Segunda Via de Boletos</h1>
              <p style="color:#A1A1AA; margin:8px 0 0; font-size:14px;">Portal de Autoatendimento Delupo</p>
            </div>
            <div style="padding:40px 30px;">
              <p style="color:#111827; font-size:16px;">Olá, <strong>${pending.name}</strong>!</p>
              <p style="color:#4B5563; line-height:1.6;">Encontramos suas faturas em nosso sistema. Clique no botão abaixo para acessar seu painel exclusivo. Por segurança, este link expira em <strong>1 hora</strong>.</p>
              
              <div style="text-align:center; margin:40px 0;">
                <a href="${magicLink}" style="display:inline-block; background:linear-gradient(135deg,#FBBF24,#D97706); color:#000000; text-decoration:none; padding:16px 40px; border-radius:8px; font-size:16px; font-weight:bold; box-shadow:0 4px 15px rgba(251,191,36,0.2);">
                  Acessar Meus Boletos
                </a>
              </div>

              <p style="color:#9CA3AF; font-size:13px; text-align:center;">Se você não solicitou este acesso, pode ignorar este e-mail com segurança.</p>
              <hr style="border:none; border-top:1px solid #E5E7EB; margin:30px 0;">
              <p style="color:#9CA3AF; font-size:11px; text-align:center; text-transform:uppercase; letter-spacing:1px;">
                Link gerado em ${new Date().toLocaleTimeString('pt-BR')} • Válido por 60 minutos
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      attachments: [{
        filename: 'logo.png',
        path: path.join(__dirname, 'public', 'logo.png'),
        cid: 'logo' // matches src="cid:logo"
      }]
    });

    return res.json({ success: true, message: 'Link enviado para seu email.' });
  } catch (err) {
    console.error('Erro ao enviar email:', err);
    return res.status(500).json({ error: 'Erro ao enviar email.', detail: err.message });
  }
});

// ─── ROUTE: Validate token ───────────────────────────────────────────────────
// GET /api/boleto/validate?token=xxx
app.get('/api/boleto/validate', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token obrigatório.' });

  const session = tokenStore.get(token);
  if (!session || Date.now() > session.expires) {
    return res.status(401).json({ error: 'Link expirado ou inválido. Solicite um novo acesso.' });
  }

  return res.json({ valid: true, nome: session.name, cgc: session.cgc });
});

// ─── ROUTE: List boletos by token ─────────────────────────────────────────────
// GET /api/boleto/list?token=xxx
app.get('/api/boleto/list', generalLimiter, async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token obrigatório.' });

  const session = tokenStore.get(token);
  if (!session || Date.now() > session.expires) {
    return res.status(401).json({ error: 'Link expirado ou inválido.' });
  }

  let pool;
  try {
    pool = await getPool();
    const request = pool.request();
    request.input('cgc', sql.VarChar, session.cgc);

    const result = await request.query(`
      SELECT 
        t.cd_empresa_venda,
        t.situacao AS [ID_SITUACAO],
        CASE 
          WHEN t.situacao = 'PR ' THEN 'Pendente de registro' 
          WHEN t.situacao = 'GR'  THEN 'Gerado Remessa'
          WHEN t.situacao = 'RE'  THEN 'Registrado' 
          WHEN t.situacao = 'RR'  THEN 'Retorno de registro rejeitado'
          WHEN t.situacao = 'PC'  THEN 'Pendente de cancelamento' 
          WHEN t.situacao = 'GC'  THEN 'Gerado remessa de cancelamento'
          WHEN t.situacao = 'CA'  THEN 'Cancelado' 
          WHEN t.situacao = 'PG'  THEN 'Pago'
        END AS TIPO_SITUACAO,
        b.nm_fantasia AS NOME_BANCO,
        b.nr_banco_bc + '-' + b.digito_bc AS NR_BANCO,
        t.linha_digitavel AS LINHA_DIGITAVEL,
        CONVERT(VARCHAR(10), t.dt_vencimento, 103) AS VENCIMENTO,
        CONVERT(VARCHAR(10), t.dt_emissao, 103) AS DATA_DOCUMENTO,
        b.local_pgto AS LOCAL_PAGAMENTO,
        b.aceite AS ACEITE,
        'DM' AS ESPECIE_DOC,
        CONCAT(a.cd_agencia, '-', a.digito_agencia, '/', a.nr_conta, '-', a.digito_cc) AS AGENCIA_COD_BENEFICIARIO,
        t.nosso_numero AS NOSSO_NUMERO,
        t.vl_boleto AS VALOR_DOCUMENTO,
        t.cd_carteira AS CD_CARTEIRA,
        CONCAT(t.nr_titulo, '/', t.sequencia) AS NUMERO_DOCUMENTO,
        'R$' AS ESPECIE_MOEDA,
        CONVERT(VARCHAR(10), tr.dt_pgto, 103) AS DATA_PAGAMENTO,
        tr.vl_pago AS VALOR_PAGO,
        CONCAT(c.cd_cliente, ' - ', c.nm_cliente) AS CLIENTE,
        CONCAT(
          c.endereco_cobranca, ', ', c.nro_endereco_cobranca, ' - ',
          c.bairro_cobranca, ' ', c.cep_cobranca, ' ',
          ci.nm_cidade, '-', ci.uf
        ) AS ENDERECO,
        c.cgc AS CGC,
        REPLACE(
          a.ds_mensagem_boleto_multa_juro,
          '<juro>',
          'R$ ' + REPLACE(REPLACE(CONVERT(VARCHAR, CAST((t.vl_boleto * a.percentual_juros) / 100 AS MONEY), 1), ',', 'X'), '.', ',')
        ) AS MENSAGEM_CALCULADA,
        CONCAT(
          e.nm_empresa, ' - ', e.endereco, ', ', e.bairro, ', ',
          ci2.nm_cidade, '/', ci2.uf, ' - ', e.cep
        ) AS BENEFICIARIO
      FROM titulo_receber_boleto t
      INNER JOIN titulo_receber tr ON t.cd_empresa = tr.cd_empresa 
                                 AND t.cd_documento = tr.cd_documento 
                                 AND t.nr_titulo = tr.nr_titulo 
                                 AND t.sequencia = tr.sequencia
      INNER JOIN banco b        ON t.cd_banco = b.cd_banco  
      INNER JOIN banco_agencia a ON t.cd_banco = a.cd_banco AND t.nr_conta = a.nr_conta  
      INNER JOIN cliente c       ON t.cd_cliente = c.cd_cliente AND t.cd_empresa_cliente = c.cd_empresa  
      INNER JOIN cidade ci       ON c.cd_cidade_cobranca = ci.cd_cidade
      INNER JOIN empresa e       ON t.cd_empresa = e.cd_empresa
      INNER JOIN cidade ci2      ON e.cd_cidade = ci2.cd_cidade
      WHERE REPLACE(REPLACE(REPLACE(c.cgc, '.', ''), '-', ''), '/', '') = @cgc
        AND t.situacao NOT IN ('CA', 'PC')
      ORDER BY t.dt_vencimento ASC
    `);

    const allRecords = result.recordset || [];
    return res.json({ 
      boletos: allRecords.filter(b => b.ID_SITUACAO !== 'PG'),
      historico: allRecords.filter(b => b.ID_SITUACAO === 'PG')
    });
  } catch (err) {
    console.error('Erro list boletos:', err);
    return res.status(500).json({ error: 'Erro ao consultar boletos.', detail: err.message });
  } finally {
    if (pool) pool.close();
  }
});

// ─── ROUTE: Get single boleto for PDF by index ───────────────────────────────
// GET /api/boleto/detail?token=xxx&idx=0
app.get('/api/boleto/detail', async (req, res) => {
  const { token, idx } = req.query;
  if (!token) return res.status(400).json({ error: 'Token obrigatório.' });

  const session = tokenStore.get(token);
  if (!session || Date.now() > session.expires) {
    return res.status(401).json({ error: 'Link expirado ou inválido.' });
  }

  // Reuse the list query and pick by index
  let pool;
  try {
    pool = await getPool();
    const request = pool.request();
    request.input('cgc', sql.VarChar, session.cgc);

    const result = await request.query(`
      SELECT 
        t.situacao AS ID_SITUACAO,
        b.nm_fantasia AS NOME_BANCO,
        b.nr_banco_bc + '-' + b.digito_bc AS NR_BANCO,
        t.linha_digitavel AS LINHA_DIGITAVEL,
        CONVERT(VARCHAR(10), t.dt_vencimento, 103) AS VENCIMENTO,
        CONVERT(VARCHAR(10), t.dt_emissao, 103) AS DATA_DOCUMENTO,
        b.local_pgto AS LOCAL_PAGAMENTO,
        b.aceite AS ACEITE,
        'DM' AS ESPECIE_DOC,
        CONCAT(a.cd_agencia, '-', a.digito_agencia, '/', a.nr_conta, '-', a.digito_cc) AS AGENCIA_COD_BENEFICIARIO,
        t.nosso_numero AS NOSSO_NUMERO,
        t.vl_boleto AS VALOR_DOCUMENTO,
        t.cd_carteira AS CD_CARTEIRA,
        CONCAT(t.nr_titulo, '/', t.sequencia) AS NUMERO_DOCUMENTO,
        'R$' AS ESPECIE_MOEDA,
        c.nm_cliente AS CLIENTE,
        CONCAT(
          c.endereco_cobranca, ', ', c.nro_endereco_cobranca, ' - ',
          c.bairro_cobranca, ', ',
          ci.nm_cidade, '-', ci.uf, ' CEP: ', c.cep_cobranca
        ) AS ENDERECO,
        c.cgc AS CGC,
        REPLACE(
          a.ds_mensagem_boleto_multa_juro,
          '<juro>',
          'R$ ' + REPLACE(REPLACE(CONVERT(VARCHAR, CAST((t.vl_boleto * a.percentual_juros) / 100 AS MONEY), 1), ',', 'X'), '.', ',')
        ) AS MENSAGEM_CALCULADA,
        CONCAT(
          e.nm_empresa, ' - ', e.endereco, ', ', e.bairro, ', ',
          ci2.nm_cidade, '/', ci2.uf, ' - CEP: ', e.cep
        ) AS BENEFICIARIO,
        e.nm_empresa AS NM_EMPRESA,
        e.cnpj AS CNPJ_EMPRESA
      FROM titulo_receber_boleto t
      INNER JOIN banco b        ON t.cd_banco = b.cd_banco  
      INNER JOIN banco_agencia a ON t.cd_banco = a.cd_banco AND t.nr_conta = a.nr_conta  
      INNER JOIN cliente c       ON t.cd_cliente = c.cd_cliente AND t.cd_empresa_cliente = c.cd_empresa  
      INNER JOIN cidade ci       ON c.cd_cidade_cobranca = ci.cd_cidade
      INNER JOIN empresa e       ON t.cd_empresa = e.cd_empresa
      INNER JOIN cidade ci2      ON e.cd_cidade = ci2.cd_cidade
      WHERE REPLACE(REPLACE(REPLACE(c.cgc, '.', ''), '-', ''), '/', '') = @cgc
        AND t.situacao NOT IN ('PG', 'CA', 'PC')
      ORDER BY t.dt_vencimento ASC
    `);

    const records = result.recordset || [];
    const index = parseInt(idx || '0', 10);
    if (index < 0 || index >= records.length) {
      return res.status(404).json({ error: 'Boleto não encontrado.' });
    }

    return res.json({ boleto: records[index] });
  } catch (err) {
    console.error('Erro detail:', err);
    return res.status(500).json({ error: 'Erro ao buscar boleto.', detail: err.message });
  } finally {
    if (pool) pool.close();
  }
});

// ─── FALLBACK: serve index.html ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── MIDDLEWARE DE ERRO GLOBAL ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Erro na rota:', err);
  res.status(500).json({ error: 'Erro interno no servidor.', detail: err.message });
});

app.listen(PORTA, () => {
  console.log(`✅ Servidor de Segunda Via rodando em http://localhost:${PORTA}`);
  console.log(`📧 SMTP configurado: ${mailerConfig.host}:${mailerConfig.port}`);
});
