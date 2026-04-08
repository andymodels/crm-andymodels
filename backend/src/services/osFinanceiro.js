/**
 * Regra de fechamento ao cliente:
 * - com modelo: base = soma dos cachês; taxa % sobre a base; subtotal = base + taxa + extras.
 * - sem modelo: base = valor_servico; mesma fórmula de taxa e subtotal.
 * - imposto/NF = percentual sobre o subtotal; total_cliente = subtotal + imposto.
 *
 * Distribuição interna (parceiro/booker sobre a fatia da agência):
 * - agencia_parcial = total_cliente - imposto_valor - modelo_liquido_total
 *
 * sem_modelo + job_sem_modelos explícito false (rascunho “virá ter modelos”): modelo_liquido_total = valor_servico
 * para a comissão — parceiro/booker só sobre taxa da agência + extras (como com_modelo). Com true ou sem flag
 * (legado): modelo_liquido_total = 0, comissão sobre o subtotal após imposto.
 */

const n = (v) => Number(v || 0);

/**
 * Valor devido ao modelo = cachê informado (sem deduzir taxa nem imposto).
 * Parâmetros extras ignorados — mantidos por compatibilidade.
 */
function lineLiquido(cacheModelo, _impostoPercent, _agenciaFeePercent, _emiteNfPropria) {
  return n(cacheModelo);
}

function computeOsFinancials({
  tipo_os,
  valor_servico,
  cache_modelo_total,
  agencia_fee_percent,
  extras_agencia_valor,
  extras_despesa_valor,
  imposto_percent,
  parceiro_percent,
  booker_percent,
  linhas,
  job_sem_modelos,
}) {
  const extrasAg = n(extras_agencia_valor);
  const extrasDesp = n(extras_despesa_valor);
  const impPct = n(imposto_percent);
  const feePct = n(agencia_fee_percent);
  const pp = parceiro_percent != null && parceiro_percent !== '' ? n(parceiro_percent) / 100 : 0;
  const bp = booker_percent != null && booker_percent !== '' ? n(booker_percent) / 100 : 0;

  let subtotalCliente;
  let taxaAgenciaValor;
  let modeloLiquidoTotal;
  let cacheTotal;

  if (tipo_os === 'sem_modelo') {
    const vs = n(valor_servico);
    taxaAgenciaValor = vs * (feePct / 100);
    subtotalCliente = vs + taxaAgenciaValor + extrasAg;
    cacheTotal = 0;
    const semExplicito =
      job_sem_modelos === false || job_sem_modelos === 'false' || job_sem_modelos === 0;
    modeloLiquidoTotal = semExplicito ? vs : 0;
  } else {
    const linhasArr = Array.isArray(linhas) ? linhas : [];
    if (linhasArr.length > 0) {
      cacheTotal = linhasArr.reduce((s, l) => s + n(l.cache_modelo), 0);
    } else {
      cacheTotal = n(cache_modelo_total);
    }
    modeloLiquidoTotal = cacheTotal;
    taxaAgenciaValor = cacheTotal * (feePct / 100);
    subtotalCliente = cacheTotal + taxaAgenciaValor + extrasAg;
  }

  const impostoValor = subtotalCliente * (impPct / 100);
  const totalCliente = subtotalCliente + impostoValor;
  const agenciaParcial = totalCliente - impostoValor - modeloLiquidoTotal;
  const parceiroValor = agenciaParcial * pp;
  const agenciaAposParceiro = agenciaParcial - parceiroValor;
  const bookerValor = agenciaAposParceiro * bp;
  const agenciaFinal = agenciaAposParceiro - bookerValor;
  const resultadoAgencia = agenciaFinal - extrasDesp;

  return {
    total_cliente: totalCliente,
    cache_modelo_total: cacheTotal,
    taxa_agencia_valor: taxaAgenciaValor,
    imposto_valor: impostoValor,
    modelo_liquido_total: modeloLiquidoTotal,
    agencia_parcial: agenciaParcial,
    parceiro_valor: parceiroValor,
    agencia_apos_parceiro: agenciaAposParceiro,
    booker_valor: bookerValor,
    agencia_final: agenciaFinal,
    resultado_agencia: resultadoAgencia,
  };
}

module.exports = {
  computeOsFinancials,
  lineLiquido,
};
