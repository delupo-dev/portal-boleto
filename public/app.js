/* ═══════════════════════════════════════════════
   SEGUNDA VIA DE BOLETOS — App JS
   ═══════════════════════════════════════════════ */

let currentCGC = '';
let currentToken = '';
let boletosData = [];
let historicoData = []; // History of paid boletos

/* ─── INIT ─────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  createParticles();
  setupCGCMask();

  // Check if arriving via magic link
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    currentToken = token;
    validateTokenAndLoad(token);
  }

  document.getElementById('input-cgc').addEventListener('keydown', e => {
    if (e.key === 'Enter') lookupCGC();
  });
});

/* ─── PARTICLES ─────────────────────────────────── */
function createParticles() {
  const container = document.getElementById('particles');
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 6 + 2;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%;
      animation-duration:${Math.random() * 20 + 15}s;
      animation-delay:${Math.random() * 15}s;
    `;
    container.appendChild(p);
  }
}

/* ─── CPF/CNPJ MASK ─────────────────────────────── */
function setupCGCMask() {
  const input = document.getElementById('input-cgc');
  input.addEventListener('input', () => {
    let v = input.value.replace(/\D/g, '').slice(0, 14);
    if (v.length <= 11) {
      v = v.replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    } else {
      v = v.replace(/(\d{2})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1/$2')
        .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    }
    input.value = v;
    document.getElementById('cgc-error').textContent = '';
    input.classList.remove('invalid');
  });
}

/* ─── STEP NAVIGATION ───────────────────────────── */
function showStep(id) {
  document.querySelectorAll('.step').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const el = document.getElementById(id);
  el.style.display = 'flex';
  el.classList.add('active');
}

function goBack() {
  document.getElementById('input-email-confirm').value = '';
  document.getElementById('email-confirm-error').textContent = '';
  document.getElementById('input-email-confirm').classList.remove('invalid');
  showStep('step-cpf');
}
function resetAll() {
  currentCGC = ''; currentToken = ''; boletosData = [];
  document.getElementById('input-cgc').value = '';
  document.getElementById('input-email-confirm').value = '';
  document.getElementById('email-confirm-error').textContent = '';
  history.pushState({}, '', '/');
  showStep('step-cpf');
}

/* ─── LOADING ───────────────────────────────────── */
function showLoading(msg) {
  document.getElementById('loading-text').textContent = msg || 'Aguarde...';
  document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

/* ─── MODAL HELPERS ─────────────────────────────── */
function showContactModal() {
  document.getElementById('contact-modal').style.display = 'flex';
}
function closeContactModal() {
  document.getElementById('contact-modal').style.display = 'none';
}

/* ─── TOAST ─────────────────────────────────────── */
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
}

/* ─── STEP 1: LOOKUP CPF/CNPJ ───────────────────── */
async function lookupCGC() {
  const input = document.getElementById('input-cgc');
  const errEl = document.getElementById('cgc-error');
  const digits = input.value.replace(/\D/g, '');

  if (digits.length !== 11 && digits.length !== 14) {
    input.classList.add('invalid');
    errEl.textContent = 'Digite um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.';
    return;
  }

  const btn = document.getElementById('btn-lookup');
  btn.disabled = true;
  showLoading('Consultando cadastro...');

  try {
    const res = await fetch('/api/boleto/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cgc: digits })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Erro ao consultar.', 'error');
      return;
    }

    currentCGC = digits;
    document.getElementById('email-masked').textContent = data.emailMascarado;
    document.getElementById('client-name').textContent = data.nome;
    showStep('step-email');
  } catch (e) {
    showToast('Erro de conexão com o servidor.', 'error');
  } finally {
    btn.disabled = false;
    hideLoading();
  }
}

/* ─── STEP 2: SEND MAGIC LINK ───────────────────── */
async function sendLink() {
  const emailInput = document.getElementById('input-email-confirm');
  const emailError = document.getElementById('email-confirm-error');
  const typedEmail = emailInput.value.trim();

  // Client-side: basic format check
  if (!typedEmail || !typedEmail.includes('@')) {
    emailInput.classList.add('invalid');
    emailError.textContent = 'Digite seu email completo.';
    emailInput.focus();
    return;
  }

  emailInput.classList.remove('invalid');
  emailError.textContent = '';

  const btn = document.getElementById('btn-send');
  btn.disabled = true;
  showLoading('Verificando email...');

  try {
    const res = await fetch('/api/boleto/send-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cgc: currentCGC, emailDigitado: typedEmail })
    });
    const data = await res.json();

    if (!res.ok) {
      // Show error inline on the email field if it's an email mismatch
      if (data.code === 'EMAIL_MISMATCH') {
        emailInput.classList.add('invalid');
        emailError.textContent = data.error;
        emailInput.focus();
      } else {
        showToast(data.error || 'Erro ao enviar email.', 'error');
      }
      return;
    }

    showStep('step-sent');
  } catch (e) {
    showToast('Erro de conexão com o servidor.', 'error');
  } finally {
    btn.disabled = false;
    hideLoading();
  }
}

/* ─── VALIDATE TOKEN (magic link arrival) ───────── */
async function validateTokenAndLoad(token) {
  showLoading('Validando acesso...');
  try {
    const res = await fetch(`/api/boleto/validate?token=${token}`);
    const data = await res.json();

    if (!res.ok) {
      hideLoading();
      showToast(data.error || 'Link inválido ou expirado.', 'error');
      showStep('step-cpf');
      return;
    }

    // Save CGC globally for display
    currentCGC = data.cgc;
    
    // Load boleto list
    await loadBoletos(token, data.nome);
  } catch (e) {
    hideLoading();
    showToast('Erro ao validar link.', 'error');
    showStep('step-cpf');
  }
}

/* ─── LOAD BOLETOS LIST ─────────────────────────── */
async function loadBoletos(token, nome) {
  showLoading('Carregando boletos...');
  try {
    const res = await fetch(`/api/boleto/list?token=${token}`);
    const data = await res.json();

    if (!res.ok) {
      hideLoading();
      showToast(data.error || 'Erro ao carregar boletos.', 'error');
      showStep('step-cpf');
      return;
    }

    boletosData = data.boletos || [];
    historicoData = data.historico || [];
    renderBoletos(nome);
    handleSort(); // Aplica a ordenação inicial
    showStep('step-boletos');
  } catch (e) {
    showToast('Erro ao carregar boletos.', 'error');
    showStep('step-cpf');
  } finally {
    hideLoading();
  }
}

/* ─── EXPIRED CHECK ────────────────────────────── */
function isExpired(dateStr) {
  if (!dateStr) return false;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return false;
  const venc = new Date(parts[2], parts[1] - 1, parts[0]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return venc < today;
}

/* ─── HELPERS ──────────────────────────────────── */
function getMonthYear(dateStr) {
  if (!dateStr) return { m: '—', y: '—' };
  const parts = dateStr.split('/');
  if (parts.length !== 3) return { m: '—', y: '—' };
  const months = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const monthIdx = parseInt(parts[1]) - 1;
  return { m: months[monthIdx] || '—', y: parts[2] };
}

/* ─── SORTING LOGIC ────────────────────────────── */
function handleSort() {
  const sortType = document.getElementById('sort-select').value;

  const sortFn = (a, b) => {
    if (sortType === 'venc-asc' || sortType === 'venc-desc') {
      const partsA = a.VENCIMENTO.split('/');
      const partsB = b.VENCIMENTO.split('/');
      const dateA = new Date(partsA[2], partsA[1] - 1, partsA[0]);
      const dateB = new Date(partsB[2], partsB[1] - 1, partsB[0]);
      return sortType === 'venc-asc' ? dateA - dateB : dateB - dateA;
    }
    if (sortType === 'valor-asc' || sortType === 'valor-desc') {
      const valA = parseFloat(a.VALOR_DOCUMENTO || 0);
      const valB = parseFloat(b.VALOR_DOCUMENTO || 0);
      return sortType === 'valor-asc' ? valA - valB : valB - valA;
    }
    return 0;
  };

  boletosData.sort(sortFn);
  historicoData.sort(sortFn);

  // Re-render only the lists, keep the name/doc as is
  renderBoletos();
}

/* ─── RENDER BOLETOS CARDS ──────────────────────── */
function renderBoletos(nome) {
  if (nome) {
    document.getElementById('boletos-client-name').textContent = `NOME: ${nome}`;
  }

  const docEl = document.getElementById('boletos-client-doc');
  if (docEl && currentCGC) {
    docEl.textContent = `CNPJ: ${formatCGCDisplay(currentCGC)}`;
  }

  const list = document.getElementById('boletos-list');
  const empty = document.getElementById('boletos-empty');
  list.innerHTML = '';

  if (boletosData.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  boletosData.forEach((b, idx) => {
    const valor = parseFloat(b.VALOR_DOCUMENTO || 0)
      .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const expired = isExpired(b.VENCIMENTO);
    const statusClass = expired ? 'status-RR' : getStatusClass(b.ID_SITUACAO);
    const statusLabel = expired ? 'Vencido - Contate o financeiro' : (b.TIPO_SITUACAO || b.ID_SITUACAO || 'À vencer');
    const referencia = b.NUMERO_DOCUMENTO || '—';

    const card = document.createElement('div');
    card.className = 'fatura-row';
    card.innerHTML = `
      <div class="fatura-status-bar ${statusClass}"></div>
      <div class="fatura-content-wrapper">
        <div class="fatura-index">${idx + 1}</div>
        <div class="fatura-details">
          <div class="fatura-col">
            <span class="fatura-label">Venc. Original</span>
            <span class="fatura-value">${b.VENCIMENTO || '—'}</span>
          </div>
          <div class="fatura-col">
            <span class="fatura-label">Valor Original</span>
            <span class="fatura-value">${valor}</span>
          </div>
          <div class="fatura-col">
            <span class="fatura-label">Situação</span>
            <span class="fatura-value">${statusLabel}</span>
          </div>
          <div class="fatura-col">
            <span class="fatura-label">Referência</span>
            <span class="fatura-value">${referencia}</span>
          </div>
        </div>
      </div>
      <div class="fatura-actions">
        ${expired ? `
          <div class="vencido-notice" onclick="showContactModal()" style="cursor:pointer;">
            Entre em contato com o financeiro para atualizar seu boleto.
          </div>
        ` : ['PR', 'GR'].includes((b.ID_SITUACAO || '').trim()) ? `
          <div class="vencido-notice" style="color: #6B7280; background: #F3F4F6; border-color: #D1D5DB;">
            Aguardando registro no banco.
          </div>
        ` : `
          <button class="btn-fatura-action" onclick="openBoletoDetail(${idx})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
               <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
               <line x1="8" y1="4" x2="8" y2="20"></line>
               <line x1="16" y1="4" x2="16" y2="20"></line>
            </svg>
            <div class="action-text">Imprimir<br>boleto</div>
          </button>
        `}
      </div>
    `;
    list.appendChild(card);
  });

  // ─── RENDER HISTORICO ───────────────────────────
  const histSection = document.getElementById('historico-section');
  const histList = document.getElementById('historico-list');

  if (historicoData.length > 0) {
    histSection.style.display = 'block';
    histList.innerHTML = '';

    historicoData.forEach((h) => {
      const valor = parseFloat(h.VALOR_DOCUMENTO || 0)
        .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const valorPago = parseFloat(h.VALOR_PAGO || 0)
        .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      const { m, y } = getMonthYear(h.VENCIMENTO);
      const referencia = h.NUMERO_DOCUMENTO || '—';

      const row = document.createElement('div');
      row.className = 'fatura-row historico-row';
      row.innerHTML = `
        <div class="fatura-status-bar status-PG"></div>
        <div class="fatura-content-wrapper">
          <div class="fatura-month-badge">
            <span class="badge-month">${m}</span>
            <span class="badge-year">${y}</span>
          </div>
          <div class="fatura-details">
            <div class="fatura-col">
              <span class="fatura-label">Data do Pag.</span>
              <span class="fatura-value">${h.DATA_PAGAMENTO || '—'}</span>
            </div>
            <div class="fatura-col">
              <span class="fatura-label">Valor Pago</span>
              <span class="fatura-value">${valorPago}</span>
            </div>
            <div class="fatura-col">
              <span class="fatura-label">Situação</span>
              <span class="fatura-value">Pago</span>
            </div>
            <div class="fatura-col">
              <span class="fatura-label">Referência</span>
              <span class="fatura-value">${referencia}</span>
            </div>
          </div>
        </div>
      `;
      histList.appendChild(row);
    });
  } else {
    histSection.style.display = 'none';
  }
}

function getStatusClass(status) {
  if (!status) return 'status-default';
  const s = status.trim();
  if (s === 'RE') return 'status-RE';
  if (s === 'GR' || s === 'PR') return 'status-GR';
  if (s === 'RR') return 'status-RR';
  return 'status-default';
}

/* ─── OPEN SINGLE BOLETO DETAIL ─────────────────── */
function openBoletoDetail(idx) {
  const b = boletosData[idx];
  if (!b) return;
  renderBoletoPrint(b);
  showStep('step-boleto-detail');
  document.getElementById('step-boleto-detail').style.display = 'flex';
}

function showBoletosStep() {
  showStep('step-boletos');
}

/* ─── RENDER BOLETO LAYOUT (standard Brazilian boleto) ─ */
function renderBoletoPrint(b) {
  const area = document.getElementById('boleto-print-area');

  const valor = parseFloat(b.VALOR_DOCUMENTO || 0)
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
  const linha = b.LINHA_DIGITAVEL || '';
  const linhaFmt = linha.replace(/(\d{5})(\d{5})(\d{5})(\d{6})(\d{5})(\d{6})(\d{1})(\d{14})/, '$1.$2 $3.$4 $5.$6 $7 $8');

  const formatCGCDisplay = (cgc) => {
    if (!cgc) return '';
    const d = cgc.replace(/\D/g, '');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return cgc;
  };

  const cgcFmt = formatCGCDisplay(b.CGC);
  const dataDoc = b.DATA_DOCUMENTO || '';
  const vencimento = b.VENCIMENTO || '';
  const nossoNum = b.NOSSO_NUMERO || '';
  const nrDoc = b.NUMERO_DOCUMENTO || '';

  const generateVia = (type) => `
    <div class="boleto-via">
      <!-- HEADER DO BANCO -->
      <div class="boleto-banco-header">
        <div class="boleto-banco-logo">
          <img src="${getBankLogo(b.NR_BANCO)}" alt="Logo Banco" onerror="this.style.display='none'">
        </div>
        <div class="boleto-banco-cod">|${b.NR_BANCO || '001-9'}|</div>
        <div class="boleto-linha-digitavel">${linhaFmt || linha}</div>
      </div>

      <!-- CORPO DO BOLETO -->
      <div class="boleto-row">
        <div class="boleto-field" style="width: 75%;">
          <span class="boleto-field-label">LOCAL DE PAGAMENTO</span>
          <span class="boleto-field-value">${b.LOCAL_PAGAMENTO || 'PAGAVEL EM QUALQUER BANCO ATE O VENCIMENTO.'}</span>
        </div>
        <div class="boleto-field" style="width: 25%; border-right: none; background:#f4f4f4;">
          <span class="boleto-field-label">VENCIMENTO</span>
          <span class="boleto-field-value right-align">${vencimento}</span>
        </div>
      </div>

      <div class="boleto-row">
        <div class="boleto-field" style="width: 75%;">
          <span class="boleto-field-label">BENEFICIÁRIO</span>
          <span class="boleto-field-value">${b.BENEFICIARIO || ''}</span>
        </div>
        <div class="boleto-field" style="width: 25%; border-right: none; background:#f4f4f4;">
          <span class="boleto-field-label">AGÊNCIA/CÓD. BENEFICIÁRIO</span>
          <span class="boleto-field-value right-align">${b.AGENCIA_COD_BENEFICIARIO || ''}</span>
        </div>
      </div>

      <div class="boleto-row">
        <div class="boleto-field" style="width: 15%;">
          <span class="boleto-field-label">DATA DO DOCUMENTO</span>
          <span class="boleto-field-value">${dataDoc}</span>
        </div>
        <div class="boleto-field" style="width: 20%;">
          <span class="boleto-field-label">Número do Documento</span>
          <span class="boleto-field-value">${nrDoc}</span>
        </div>
        <div class="boleto-field" style="width: 10%;">
          <span class="boleto-field-label">ESPÉCIE DOC.</span>
          <span class="boleto-field-value">${b.ESPECIE_DOC || 'DM'}</span>
        </div>
        <div class="boleto-field" style="width: 7%;">
          <span class="boleto-field-label">ACEITE</span>
          <span class="boleto-field-value">${b.ACEITE || 'N'}</span>
        </div>
        <div class="boleto-field" style="width: 23%;">
          <span class="boleto-field-label">DATA DO PROCESSAMENTO</span>
          <span class="boleto-field-value">${dataDoc}</span>
        </div>
        <div class="boleto-field" style="width: 25%; border-right: none; background:#f4f4f4;">
          <span class="boleto-field-label">NOSSO NÚMERO</span>
          <span class="boleto-field-value right-align">${nossoNum}</span>
        </div>
      </div>

      <div class="boleto-row">
        <div class="boleto-field" style="width: 15%;">
          <span class="boleto-field-label">USO DO BANCO</span>
          <span class="boleto-field-value">&nbsp;</span>
        </div>
        <div class="boleto-field" style="width: 10%;">
          <span class="boleto-field-label">CARTEIRA</span>
          <span class="boleto-field-value">${b.CD_CARTEIRA || ''}</span>
        </div>
        <div class="boleto-field" style="width: 10%;">
          <span class="boleto-field-label">ESPÉCIE MOEDA</span>
          <span class="boleto-field-value">${b.ESPECIE_MOEDA || 'R$'}</span>
        </div>
        <div class="boleto-field" style="width: 20%;">
          <span class="boleto-field-label">QUANTIDADE</span>
          <span class="boleto-field-value">&nbsp;</span>
        </div>
        <div class="boleto-field" style="width: 20%;">
          <span class="boleto-field-label">VALOR</span>
          <span class="boleto-field-value">&nbsp;</span>
        </div>
        <div class="boleto-field" style="width: 25%; border-right: none; background:#f4f4f4;">
          <span class="boleto-field-label">(=) VALOR DO DOCUMENTO</span>
          <span class="boleto-field-value right-align bold">${valor.replace('R$', '').trim()}</span>
        </div>
      </div>

      <div class="boleto-row" style="border-bottom: none;">
        <div class="boleto-field instructions-col" style="width: 75%; border-bottom: 1px solid #000;">
          <span class="boleto-field-label">Instruções (instruções de responsabilidade do beneficiário. Qualquer dúvida sobre este boleto, contate o beneficiário)</span>
          <div class="instructions-text">
            ${b.MENSAGEM_CALCULADA || 'Após o vencimento, multa e Juros por dia de atraso. Sujeito a Protesto após 05 dias de atraso.'}
          </div>
        </div>
        <div class="values-col" style="width: 25%; border-left: none;">
          <div class="boleto-field border-bottom"><span class="boleto-field-label">(-) DESCONTO / ABATIMENTO</span><span class="boleto-field-value right-align">&nbsp;</span></div>
          <div class="boleto-field border-bottom"><span class="boleto-field-label">(-) OUTRAS DEDUÇÕES</span><span class="boleto-field-value right-align">&nbsp;</span></div>
          <div class="boleto-field border-bottom"><span class="boleto-field-label">(+) MORA / MULTA</span><span class="boleto-field-value right-align">&nbsp;</span></div>
          <div class="boleto-field border-bottom"><span class="boleto-field-label">(+) OUTROS ACRÉSCIMOS</span><span class="boleto-field-value right-align">&nbsp;</span></div>
          <div class="boleto-field border-bottom" style="background:#f4f4f4;"><span class="boleto-field-label">(=) VALOR COBRADO</span><span class="boleto-field-value right-align">&nbsp;</span></div>
        </div>
      </div>

      <div class="boleto-row" style="border-top: 1px solid #000; border-bottom: none; display: flex; flex-direction: column;">
        <div class="boleto-field" style="border-right: none; padding-top: 8px;">
          <div style="display:flex; justify-content:space-between;">
            <div style="display:flex;">
              <span class="boleto-field-label" style="margin-right: 8px;">Pagador:</span>
              <span class="boleto-field-value">${b.CLIENTE || ''}</span>
            </div>
            <div>
              <span class="boleto-field-label" style="display:inline; margin-right: 4px;">CNPJ:</span>
              <span class="boleto-field-value" style="display:inline;">${cgcFmt}</span>
            </div>
          </div>
          <div style="margin-left: 50px; margin-top: 4px;">
            <span class="boleto-field-value" style="font-weight: normal;">${b.ENDERECO || ''}</span>
          </div>
        </div>
        <div class="boleto-field" style="border-right: none; padding-bottom: 2px;">
          <span class="boleto-field-label" style="display:inline; margin-right: 8px;">Sacador/Avalista:</span>
        </div>
      </div>
      
      <div class="boleto-footer">
        <div class="autenticacao">${type}</div>
      </div>
    </div>
  `;

  area.innerHTML = `
    <div class="boleto-documento">
      ${generateVia('')}
      <div class="boleto-cutline dashed"></div>
      ${generateVia('Autenticação Mecânica <strong style="margin-left:16px;">Recibo do Pagador</strong>')}
      <div class="boleto-cutline dashed"></div>
      ${generateVia('Autenticação Mecânica <strong style="margin-left:16px;">Ficha de Compensação</strong>')}
      
      <!-- BARCODE SECTION FOR THE LAST VIA -->
      <div class="boleto-barcode-section" style="padding: 0 10mm 15px 10mm; display: flex; justify-content: flex-start;">
        <svg id="barcode-svg" class="boleto-barcode-img"></svg>
      </div>
    </div>
  `;

  // Draw barcode using Code128 svg algorithm
  setTimeout(() => drawBarcode(linha.replace(/\D/g, ''), 'barcode-svg'), 100);
}

/* ─── REAL ITF (INTERLEAVED 2 OF 5) BARCODE RENDERER ──────────────────────── */
function drawBarcode(linhaDigitavel, elementId) {
  const l = linhaDigitavel.replace(/\D/g, '');
  let barcode = '';

  // Converte a Linha Digitável para o Código de Barras de 44 posições
  if (l.length === 47) {
    // Boleto Bancário Padrão
    barcode = l.substring(0, 4) + l.substring(32, 33) + l.substring(33, 47) + l.substring(4, 9) + l.substring(10, 20) + l.substring(21, 31);
  } else if (l.length === 48) {
    // Boleto de Concessionária (Água, Luz, etc)
    barcode = l.substring(0, 11) + l.substring(12, 23) + l.substring(24, 35) + l.substring(36, 47);
  } else {
    // Fallback
    barcode = l;
  }

  if (window.JsBarcode) {
    try {
      JsBarcode('#' + elementId, barcode, {
        format: 'ITF',
        displayValue: false,
        background: '#ffffff',
        lineColor: '#000000',
        width: 2, 
        height: 100,
        margin: 0 // Margem controlada pelo container
      });

      const el = document.getElementById(elementId);
      if (el) {
        el.setAttribute('width', '103mm');
        el.setAttribute('height', '13mm');
        el.style.width = '103mm';
        el.style.height = '13mm';
      }
    } catch (e) {
      console.error('Erro ao gerar código de barras:', e);
    }
  }
}

/* ─── GET BANK LOGO ───────────────────────────── */
function getBankLogo(bankCode) {
  if (!bankCode) return '';
  const code = bankCode.toString().split('-')[0].padStart(3, '0');
  const basePath = 'logos/';
  const logos = {
    '001': 'Banco do Brasil S.A/banco-do-brasil-sem-fundo.svg',
    '003': 'Banco da Amazônia S.A/banco-da-amazonia.svg',
    '004': 'Banco do Nordeste do Brasil S.A/Logo_BNB.svg',
    '021': 'Banco do Estado do Espirito Santo/banestes.svg',
    '033': 'Banco Santander Brasil S.A/banco-santander-logo.svg',
    '037': 'Banco do Estado do Para/Logo_do_Banpará.svg',
    '041': 'Banrisul/banrisul-logo-2023.svg',
    '047': 'Banco do Estado do Sergipe/logo banese.svg',
    '070': 'BRB - Banco de Brasilia/brb-logo-abreviado.svg',
    '077': 'Banco Inter S.A/inter.svg',
    '085': 'Ailos/logo-ailos.svg',
    '104': 'Caixa Econômica Federal/caixa-economica-federal-X.svg',
    '136': 'Unicred/unicred-centralizada.svg',
    '197': 'Stone Pagamentos S.A/stone.svg',
    '212': 'Banco Original S.A/banco-original-logo-verde.svg',
    '237': 'Bradesco S.A/bradesco.svg',
    '246': 'ABC Brasil/logoabc.svg',
    '260': 'Nu Pagamentos S.A/nubank-logo-2021.svg',
    '290': 'PagSeguro Internet S.A/logo.svg',
    '323': 'Mercado Pago/mercado-pago.svg',
    '336': 'Banco C6 S.A/c6 bank.svg',
    '341': 'Itaú Unibanco S.A/itau-fundo-azul.svg',
    '389': 'Banco Mercantil do Brasil S.A/banco-mercantil-novo-azul.svg',
    '422': 'Banco Safra S.A/logo-safra.svg',
    '633': 'Banco Rendimento/banco rendimento logo nova .svg',
    '655': 'Banco Votorantim/banco-bv-logo.svg',
    '707': 'Banco Daycoval/logo-Daycoval- maior.svg',
    '748': 'Sicredi/logo-svg2.svg',
    '756': 'Sicoob/sicoob-vector-logo.svg'
  };

  return logos[code] ? basePath + logos[code] : '';
}

/* ─── FORMAT CGC DISPLAY ────────────────────────── */
function formatCGCDisplay(cgc) {
  if (!cgc) return '';
  const d = cgc.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return cgc;
}

/* ─── PRINT ─────────────────────────────────────── */
function printBoleto() {
  const container = document.getElementById('boleto-print-area');
  const element = document.querySelector('.boleto-documento');
  const btn = document.querySelector('button[onclick="printBoleto()"]');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = 'Gerando PDF...';
  btn.disabled = true;

  // Save original styles
  const oldPadding = container.style.padding;
  const oldMargin = element.style.margin;
  const oldBoxShadow = element.style.boxShadow;
  const oldMaxHeight = element.style.maxHeight;
  const oldOverflow = element.style.overflow;

  // Remove margins and paddings so html2canvas captures from (0,0) without cutoff
  container.style.padding = '0px';
  element.style.margin = '0px';
  element.style.boxShadow = 'none';
  // Force a safe height to guarantee it NEVER spawns a second page
  element.style.maxHeight = '1050px';
  element.style.overflow = 'hidden';

  const opt = {
    margin: 0,
    filename: 'boleto.pdf',
    image: { type: 'jpeg', quality: 1 },
    html2canvas: { scale: 3, useCORS: true, scrollX: 0, scrollY: 0, imageTimeout: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save().then(() => {
    // Restore original styles
    container.style.padding = oldPadding;
    element.style.margin = oldMargin;
    element.style.boxShadow = oldBoxShadow;
    element.style.maxHeight = oldMaxHeight;
    element.style.overflow = oldOverflow;

    btn.innerHTML = originalHtml;
    btn.disabled = false;
  });
}
