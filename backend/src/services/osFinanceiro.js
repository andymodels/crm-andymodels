/**
 * Distribuição (ordem fixa; percentuais inexistentes = 0):
 * 1) agencia_parcial = total_cliente - imposto_valor - modelo_liquido_total
 * 2) parceiro_valor = agencia_parcial * (parceiro_percent/100)
 * 3) agencia_apos_parceiro = agencia_parcial - parceiro_valor
 * 4) booker_valor = agencia_apos_parceiro * (booker_percent/100)
 * 5) agencia_final = agencia_apos_parceiro - booker_valor
 * 6) resultado_agencia = agencia_final - extras_despesa_valor
 *
 * Modelo: sempre sobre cachê (lineLiquido). Imposto: sempre sobre total_cliente.
 * Extras agência: já em total_cliente; não entram na cadeia de %.
 */

const n = (v) => Number(v || 0);

function lineLiquido(cacheModelo, impostoPercent, agenciaFeePercent, emiteNfPropria) {
  const c = n(cacheModelo);
  const imp = n(impostoPercent) / 100;
  const fee = n(agenciaFeePercent) / 100;
  if (emiteNfPropria) {
    return c - c * fee;
  }
  return c - c * imp - c * fee;
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
}) {
  const extrasAg = n(extras_agencia_valor);
  const extrasDesp = n(extras_despesa_valor);
  const impPct = n(imposto_percent);
  const feePct = n(agencia_fee_percent);
  const pp = parceiro_percent != null && parceiro_percent !== '' ? n(parceiro_percent) / 100 : 0;
  const bp = booker_percent != null && booker_percent !== '' ? n(booker_percent) / 100 : 0;

  let totalCliente;
  let taxaAgenciaValor;
  let modeloLiquidoTotal;
  let cacheTotal;

  if (tipo_os === 'sem_modelo') {
    const vs = n(valor_servico);
    totalCliente = vs + extrasAg;
    taxaAgenciaValor = 0;
    cacheTotal = 0;
    modeloLiquidoTotal = 0;
  } else {
    const linhasArr = Array.isArray(linhas) ? linhas : [];
    if (linhasArr.length > 0) {
      cacheTotal = linhasArr.reduce((s, l) => s + n(l.cache_modelo), 0);
      modeloLiquidoTotal = linhasArr.reduce(
        (s, l) =>
          s +
          lineLiquido(l.cache_modelo, impPct, feePct, Boolean(l.emite_nf_propria)),
        0,
      );
    } else {
      cacheTotal = n(cache_modelo_total);
      modeloLiquidoTotal = lineLiquido(cacheTotal, impPct, feePct, false);
    }
    taxaAgenciaValor = cacheTotal * (feePct / 100);
    totalCliente = cacheTotal + taxaAgenciaValor + extrasAg;
  }

  const impostoValor = totalCliente * (impPct / 100);
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
