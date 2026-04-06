/** Apenas dígitos */
function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

/** CPF: 11 dígitos + dígitos verificadores */
function isValidCPF(d) {
  if (!d || d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let n = 0;
  for (let i = 0; i < 9; i++) n += parseInt(d[i], 10) * (10 - i);
  let r = (n * 10) % 11;
  if (r === 10) r = 0;
  if (r !== parseInt(d[9], 10)) return false;
  n = 0;
  for (let i = 0; i < 10; i++) n += parseInt(d[i], 10) * (11 - i);
  r = (n * 10) % 11;
  if (r === 10) r = 0;
  return r === parseInt(d[10], 10);
}

/** CNPJ: 14 dígitos + verificadores */
function isValidCNPJ(d) {
  if (!d || d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let n = 0;
  for (let i = 0; i < 12; i++) n += parseInt(d[i], 10) * w1[i];
  let r = n % 11;
  const dv1 = r < 2 ? 0 : 11 - r;
  if (dv1 !== parseInt(d[12], 10)) return false;
  n = 0;
  for (let i = 0; i < 13; i++) n += parseInt(d[i], 10) * w2[i];
  r = n % 11;
  const dv2 = r < 2 ? 0 : 11 - r;
  return dv2 === parseInt(d[13], 10);
}

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidEmail(s) {
  const t = String(s || '').trim();
  if (t.length < 5 || t.length > 254) return false;
  return EMAIL_RE.test(t);
}

/** Telefone BR: exatamente 10 ou 11 dígitos (DDD + 8 ou 9 dígitos) após normalizar */
function isValidPhoneBR(digits) {
  if (!digits || (digits.length !== 10 && digits.length !== 11)) return false;
  const ddd = parseInt(digits.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) return false;
  return true;
}

function isValidCEP(d) {
  return d && d.length === 8;
}

/** URL http(s), opcional vazio */
function isValidWebsiteOptional(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return true;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normaliza e valida payload de cliente (POST completo ou PUT parcial).
 * @returns {{ ok: boolean, message?: string, body?: object }}
 */
function sanitizeAndValidateCliente(body, partial = false) {
  const b = { ...body };
  b.tipo_pessoa = b.tipo_pessoa === 'PF' ? 'PF' : 'PJ';
  const tipo = b.tipo_pessoa;

  if (!partial || b.documento !== undefined) {
    const d = onlyDigits(b.documento);
    b.documento = d;
    if (!d) return { ok: false, message: 'Documento (CPF ou CNPJ) e obrigatorio.' };
    if (tipo === 'PF') {
      if (!isValidCPF(d)) {
        return { ok: false, message: 'CPF invalido: os digitos verificadores nao conferem.' };
      }
    } else if (!isValidCNPJ(d)) {
      return { ok: false, message: 'CNPJ invalido: os digitos verificadores nao conferem.' };
    }
  }

  if (!partial || b.documento_representante !== undefined) {
    const d = onlyDigits(b.documento_representante);
    b.documento_representante = d;
    if (d && !isValidCPF(d)) {
      return { ok: false, message: 'CPF do representante invalido: digitos verificadores incorretos.' };
    }
  }

  if (!partial || b.cep !== undefined) {
    const d = onlyDigits(b.cep);
    b.cep = d;
    if (!d) return { ok: false, message: 'CEP e obrigatorio.' };
    if (!isValidCEP(d)) return { ok: false, message: 'CEP deve ter 8 digitos.' };
  }

  if (!partial) {
    const w = String(b.website ?? '').trim();
    b.website = w;
    if (w && !isValidWebsiteOptional(w)) {
      return { ok: false, message: 'Website invalido. Use endereco completo com http:// ou https://' };
    }
  } else if (b.website !== undefined) {
    const w = String(b.website).trim();
    b.website = w;
    if (w && !isValidWebsiteOptional(w)) {
      return { ok: false, message: 'Website invalido. Use endereco completo com http:// ou https://' };
    }
  }

  const telArr = Array.isArray(b.telefones) ? b.telefones : [];
  const emArr = Array.isArray(b.emails) ? b.emails : [];
  if (!partial || b.telefones !== undefined) {
    b.telefones = telArr.map((x) => onlyDigits(String(x || ''))).filter(Boolean);
    if (b.telefones.length === 0) return { ok: false, message: 'Informe ao menos um telefone valido.' };
    for (let i = 0; i < b.telefones.length; i++) {
      if (!isValidPhoneBR(b.telefones[i])) {
        return { ok: false, message: `Telefone ${i + 1} invalido: use DDD + numero (10 ou 11 digitos).` };
      }
    }
  }
  if (!partial || b.emails !== undefined) {
    b.emails = emArr.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
    if (b.emails.length === 0) return { ok: false, message: 'Informe ao menos um e-mail.' };
    for (let i = 0; i < b.emails.length; i++) {
      if (!isValidEmail(b.emails[i])) {
        return { ok: false, message: `E-mail ${i + 1} com formato invalido.` };
      }
    }
  }

  if (b.telefones?.length && b.emails?.length) {
    b.telefone = b.telefones[0];
    b.email = b.emails[0];
  }

  const textRequired = [
    ['nome_empresa', 'Nome da empresa / razao social'],
    ['nome_fantasia', 'Nome fantasia'],
    ['contato_principal', 'Representante legal (nome)'],
    ['logradouro', 'Logradouro'],
    ['numero', 'Numero'],
    ['bairro', 'Bairro'],
    ['cidade', 'Cidade'],
    ['uf', 'UF'],
  ];
  for (const [key, label] of textRequired) {
    if (partial && b[key] === undefined) continue;
    const v = String(b[key] ?? '').trim();
    b[key] = v;
    if (!v) return { ok: false, message: `${label} e obrigatorio.` };
  }
  if (b.uf && b.uf.length !== 2) {
    return { ok: false, message: 'UF deve ter 2 letras.' };
  }
  if (b.uf) b.uf = b.uf.toUpperCase();

  if (!partial || b.observacoes !== undefined) {
    b.observacoes = String(b.observacoes ?? '').trim();
  }

  if (!partial) {
    b.endereco_completo = `${b.logradouro}, ${b.numero} - ${b.bairro}, ${b.cidade}/${b.uf} CEP ${b.cep}`.trim();
  } else {
    const addrKeys = ['logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep'];
    if (addrKeys.some((k) => b[k] !== undefined)) {
      const okAddr = addrKeys.every((k) => String(b[k] ?? '').trim());
      if (okAddr) {
        b.endereco_completo = `${b.logradouro}, ${b.numero} - ${b.bairro}, ${b.cidade}/${b.uf} CEP ${b.cep}`.trim();
      }
    }
  }

  b.cnpj = b.documento;

  return { ok: true, body: b };
}

/**
 * Modelo: CPF, telefones, emails, datas, responsavel se menor
 */
function sanitizeAndValidateModelo(body, partial = false) {
  const b = { ...body };

  if (!partial || b.cpf !== undefined) {
    const d = onlyDigits(b.cpf);
    b.cpf = d;
    if (!d) return { ok: false, message: 'CPF do modelo e obrigatorio.' };
    if (!isValidCPF(d)) {
      return { ok: false, message: 'CPF do modelo invalido: digitos verificadores incorretos.' };
    }
  }

  const telArr = Array.isArray(b.telefones) ? b.telefones : [];
  const emArr = Array.isArray(b.emails) ? b.emails : [];
  if (!partial || b.telefones !== undefined) {
    b.telefones = telArr.map((x) => onlyDigits(String(x || ''))).filter(Boolean);
    if (b.telefones.length === 0) return { ok: false, message: 'Informe ao menos um telefone valido.' };
    for (let i = 0; i < b.telefones.length; i++) {
      if (!isValidPhoneBR(b.telefones[i])) {
        return { ok: false, message: `Telefone ${i + 1} invalido (DDD + numero).` };
      }
    }
  }
  if (!partial || b.emails !== undefined) {
    b.emails = emArr.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
    if (b.emails.length === 0) return { ok: false, message: 'Informe ao menos um e-mail.' };
    for (let i = 0; i < b.emails.length; i++) {
      if (!isValidEmail(b.emails[i])) {
        return { ok: false, message: `E-mail ${i + 1} com formato invalido.` };
      }
    }
  }
  if (b.telefones?.length) b.telefone = b.telefones[0];
  if (b.emails?.length) b.email = b.emails[0];

  if (!partial || b.nome !== undefined) {
    b.nome = String(b.nome ?? '').trim();
    if (!b.nome) return { ok: false, message: 'Nome e obrigatorio.' };
  }

  if (!partial || b.data_nascimento !== undefined) {
    const ds = String(b.data_nascimento ?? '').trim();
    b.data_nascimento = ds || null;
    if (!partial && !ds) return { ok: false, message: 'Data de nascimento e obrigatoria.' };
  }

  const age = getAgeBr(b.data_nascimento);
  const minor = age !== null && age < 18;

  if (minor) {
    if (!partial || b.responsavel_nome !== undefined) {
      b.responsavel_nome = String(b.responsavel_nome ?? '').trim();
      if (!b.responsavel_nome) return { ok: false, message: 'Nome do responsavel e obrigatorio para menor de idade.' };
    }
    if (!partial || b.responsavel_cpf !== undefined) {
      const r = onlyDigits(b.responsavel_cpf);
      b.responsavel_cpf = r;
      if (!r) return { ok: false, message: 'CPF do responsavel e obrigatorio para menor de idade.' };
      if (!isValidCPF(r)) {
        return { ok: false, message: 'CPF do responsavel invalido: digitos verificadores incorretos.' };
      }
    }
    if (!partial || b.responsavel_telefone !== undefined) {
      const rt = onlyDigits(b.responsavel_telefone);
      b.responsavel_telefone = rt;
      if (!rt) return { ok: false, message: 'Telefone do responsavel e obrigatorio para menor de idade.' };
      if (!isValidPhoneBR(rt)) return { ok: false, message: 'Telefone do responsavel invalido.' };
    }
  }

  const formas = Array.isArray(b.formas_pagamento) ? b.formas_pagamento : [];
  if (!partial || b.formas_pagamento !== undefined) {
    const { sanitizeAndValidateFormasPagamentoArray } = require('./formasPagamento');
    const fr = sanitizeAndValidateFormasPagamentoArray(formas);
    if (!fr.ok) return { ok: false, message: fr.message };
    b.formas_pagamento = fr.formas;
  }

  if (!partial || b.observacoes !== undefined) {
    b.observacoes = String(b.observacoes ?? '').trim();
  }

  if (!partial) {
    if (b.emite_nf_propria === undefined || b.emite_nf_propria === null) {
      return { ok: false, message: 'Informe se o modelo emite NF propria.' };
    }
    b.emite_nf_propria = Boolean(b.emite_nf_propria);
    if (b.ativo === undefined || b.ativo === null) {
      return { ok: false, message: 'Informe o status ativo do cadastro.' };
    }
    b.ativo = Boolean(b.ativo);
  } else {
    if (b.emite_nf_propria !== undefined) b.emite_nf_propria = Boolean(b.emite_nf_propria);
    if (b.ativo !== undefined) b.ativo = Boolean(b.ativo);
  }

  return { ok: true, body: b };
}

function normalizeTelefonesEmailsLists(b, partial) {
  const telArr = Array.isArray(b.telefones) ? b.telefones : [];
  const emArr = Array.isArray(b.emails) ? b.emails : [];
  if (!partial || b.telefones !== undefined) {
    b.telefones = telArr.map((x) => onlyDigits(String(x || ''))).filter(Boolean);
    if (b.telefones.length === 0) {
      return { ok: false, message: 'Informe ao menos um telefone valido (10 ou 11 digitos com DDD).' };
    }
    for (let i = 0; i < b.telefones.length; i++) {
      if (!isValidPhoneBR(b.telefones[i])) {
        return {
          ok: false,
          message: `Telefone ${i + 1} invalido: informe DDD + numero (10 ou 11 digitos no total).`,
        };
      }
    }
  }
  if (!partial || b.emails !== undefined) {
    b.emails = emArr.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
    if (b.emails.length === 0) return { ok: false, message: 'Informe ao menos um e-mail valido.' };
    for (let i = 0; i < b.emails.length; i++) {
      if (!isValidEmail(b.emails[i])) {
        return { ok: false, message: `E-mail ${i + 1} com formato invalido.` };
      }
    }
  }
  if (b.telefones?.length) b.telefone = b.telefones[0];
  if (b.emails?.length) b.email = b.emails[0];
  return { ok: true };
}

/**
 * Booker: CPF com digitos verificadores, telefones 10/11 digitos, emails
 */
function sanitizeAndValidateBooker(body, partial = false) {
  const b = { ...body };
  if (!partial || b.cpf !== undefined) {
    const d = onlyDigits(b.cpf);
    b.cpf = d;
    if (!d) return { ok: false, message: 'CPF e obrigatorio.' };
    if (!isValidCPF(d)) {
      return { ok: false, message: 'CPF invalido: os digitos verificadores nao conferem.' };
    }
  }
  const te = normalizeTelefonesEmailsLists(b, partial);
  if (!te.ok) return te;

  if (!partial || b.cep !== undefined) {
    const d = onlyDigits(b.cep);
    b.cep = d;
    if (!d) return { ok: false, message: 'CEP e obrigatorio.' };
    if (!isValidCEP(d)) return { ok: false, message: 'CEP deve ter 8 digitos.' };
  }

  if (!partial || b.nome !== undefined) {
    b.nome = String(b.nome ?? '').trim();
    if (!b.nome) return { ok: false, message: 'Nome e obrigatorio.' };
  }
  const textRequired = [
    ['logradouro', 'Logradouro'],
    ['numero', 'Numero'],
    ['bairro', 'Bairro'],
    ['cidade', 'Cidade'],
    ['uf', 'UF'],
  ];
  for (const [key, label] of textRequired) {
    if (partial && b[key] === undefined) continue;
    const v = String(b[key] ?? '').trim();
    b[key] = v;
    if (!v) return { ok: false, message: `${label} e obrigatorio.` };
  }
  if (!partial || b.complemento !== undefined) {
    b.complemento = String(b.complemento ?? '').trim();
  }
  if (b.uf && b.uf.length !== 2) {
    return { ok: false, message: 'UF deve ter 2 letras.' };
  }
  if (b.uf) b.uf = b.uf.toUpperCase();
  if (!partial || b.observacoes !== undefined) {
    b.observacoes = String(b.observacoes ?? '').trim();
  }
  if (!partial || b.ativo !== undefined) {
    if (!partial && (b.ativo === undefined || b.ativo === null)) {
      return { ok: false, message: 'Informe o status ativo do cadastro.' };
    }
    if (b.ativo !== undefined) b.ativo = Boolean(b.ativo);
  }

  if (!partial || b.formas_pagamento !== undefined) {
    const formas = Array.isArray(b.formas_pagamento) ? b.formas_pagamento : [];
    const { sanitizeAndValidateFormasPagamentoArray } = require('./formasPagamento');
    const fr = sanitizeAndValidateFormasPagamentoArray(formas);
    if (!fr.ok) return { ok: false, message: fr.message };
    b.formas_pagamento = fr.formas;
  }

  return { ok: true, body: b };
}

/**
 * Parceiro: CPF ou CNPJ com digitos verificadores
 */
function sanitizeAndValidateParceiro(body, partial = false) {
  const b = { ...body };
  if (!partial || b.cnpj_ou_cpf !== undefined) {
    const d = onlyDigits(b.cnpj_ou_cpf);
    b.cnpj_ou_cpf = d;
    if (!d) return { ok: false, message: 'CPF ou CNPJ e obrigatorio.' };
    if (d.length === 11) {
      if (!isValidCPF(d)) {
        return { ok: false, message: 'CPF invalido: os digitos verificadores nao conferem.' };
      }
    } else if (d.length === 14) {
      if (!isValidCNPJ(d)) {
        return { ok: false, message: 'CNPJ invalido: os digitos verificadores nao conferem.' };
      }
    } else {
      return { ok: false, message: 'Informe CPF com 11 digitos ou CNPJ com 14 digitos.' };
    }
  }
  const te = normalizeTelefonesEmailsLists(b, partial);
  if (!te.ok) return te;

  if (!partial || b.razao_social_ou_nome !== undefined) {
    b.razao_social_ou_nome = String(b.razao_social_ou_nome ?? '').trim();
    if (!b.razao_social_ou_nome) return { ok: false, message: 'Razao social ou nome e obrigatorio.' };
  }
  if (!partial || b.tipo_servico !== undefined) {
    b.tipo_servico = String(b.tipo_servico ?? '').trim();
    if (!b.tipo_servico) return { ok: false, message: 'Tipo de servico e obrigatorio.' };
  }
  if (!partial || b.contato !== undefined) {
    b.contato = String(b.contato ?? '').trim();
    if (!b.contato) return { ok: false, message: 'Contato e obrigatorio.' };
  }
  if (!partial || b.observacoes !== undefined) {
    b.observacoes = String(b.observacoes ?? '').trim();
  }
  if (!partial || b.ativo !== undefined) {
    if (!partial && (b.ativo === undefined || b.ativo === null)) {
      return { ok: false, message: 'Informe o status ativo do cadastro.' };
    }
    if (b.ativo !== undefined) b.ativo = Boolean(b.ativo);
  }

  if (!partial || b.formas_pagamento !== undefined) {
    const formas = Array.isArray(b.formas_pagamento) ? b.formas_pagamento : [];
    const { sanitizeAndValidateFormasPagamentoArray } = require('./formasPagamento');
    const fr = sanitizeAndValidateFormasPagamentoArray(formas);
    if (!fr.ok) return { ok: false, message: fr.message };
    b.formas_pagamento = fr.formas;
  }

  return { ok: true, body: b };
}

function getAgeBr(isoDate) {
  if (!isoDate) return null;
  const birth = new Date(isoDate);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

module.exports = {
  onlyDigits,
  isValidCPF,
  isValidCNPJ,
  isValidEmail,
  isValidPhoneBR,
  isValidCEP,
  isValidWebsiteOptional,
  sanitizeAndValidateCliente,
  sanitizeAndValidateModelo,
  sanitizeAndValidateBooker,
  sanitizeAndValidateParceiro,
};
