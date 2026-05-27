const express = require('express');
const router = express.Router();
const { authMiddleware, supabaseAdmin } = require('../middleware/auth');

// ============================================================
// Configurações de preço (APENAS NO SERVIDOR — invisível ao cliente)
// ============================================================
const PRECO_POR_KM = 2.80;       // R$ por km
const TAXA_BASE = 5.00;          // Taxa de partida fixa
const COMISSAO_PLATAFORMA = 0.10; // 10% de comissão

// ============================================================
// Helpers
// ============================================================

/**
 * Calcula a rota entre dois pontos via OSRM (server-side)
 * Retorna distância em km e duração em minutos.
 */
async function calcularRotaOSRM(origem, destino) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=full&geometries=polyline`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Falha ao calcular rota no OSRM');
  const data = await res.json();
  if (!data?.routes?.length) throw new Error('Nenhuma rota encontrada');

  const route = data.routes[0];
  const distKm = route.distance / 1000;
  const duracaoMin = Math.round(route.duration / 60);

  return {
    distanciaKm: parseFloat(distKm.toFixed(2)),
    duracaoMin,
    geometry: route.geometry, // polyline encodada para o app usar
  };
}

/**
 * Calcula o preço SEGURO no servidor. Jamais confia no valor do cliente.
 */
function calcularPreco(distKm) {
  return parseFloat(((distKm * PRECO_POR_KM) + TAXA_BASE).toFixed(2));
}

/**
 * Converte coordenadas em nome de endereço (reverse geocode)
 */
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
    const data = await res.json();
    return data.features?.[0]?.properties?.name || 'Endereço no mapa';
  } catch {
    return 'Endereço no mapa';
  }
}

// ============================================================
// POST /api/rides/solicitar
// Passageiro solicita uma corrida. O servidor calcula o preço.
// ============================================================
router.post('/solicitar', authMiddleware, async (req, res) => {
  const { origin_coords, destination_coords, metodo_pagamento, destination_text } = req.body;

  // Validação dos campos obrigatórios
  if (
    !origin_coords?.lat || !origin_coords?.lng ||
    !destination_coords?.lat || !destination_coords?.lng
  ) {
    return res.status(400).json({
      error: 'Coordenadas de origem e destino são obrigatórias.',
      code: 'RIDES_MISSING_COORDS',
    });
  }

  const metodosValidos = ['dinheiro', 'pix'];
  if (!metodosValidos.includes(metodo_pagamento)) {
    return res.status(400).json({
      error: `Método de pagamento inválido. Use: ${metodosValidos.join(', ')}`,
      code: 'RIDES_INVALID_PAYMENT',
    });
  }

  try {
    // 1. Calcular rota no servidor (não confia nas coordenadas de rota do cliente)
    const rota = await calcularRotaOSRM(origin_coords, destination_coords);

    // 2. Calcular preço no servidor (a fórmula nunca fica no cliente)
    const valor = calcularPreco(rota.distanciaKm);
    const distanciaFormatada = `${rota.distanciaKm.toFixed(1)} km`;

    // 3. Reverse geocode dos endereços (servidor faz a busca)
    const [originText, destText] = await Promise.all([
      reverseGeocode(origin_coords.lat, origin_coords.lng),
      destination_text || reverseGeocode(destination_coords.lat, destination_coords.lng),
    ]);

    // 4. Inserir no banco usando service_role (bypassa RLS, mas com dados confiáveis)
    const { data, error } = await supabaseAdmin
      .from('rides')
      .insert([{
        passenger_id: req.user.id, // Vem do JWT validado, não do body
        origin_text: typeof originText === 'string' ? originText : originText,
        destination_text: destText,
        origin_coords,
        destination_coords,
        distancia: distanciaFormatada,
        valor, // Calculado no servidor!
        status: 'pendente',
        metodo_pagamento,
        geometry: rota.geometry, // Para o motorista poder traçar a rota
      }])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      ride: {
        id: data.id,
        valor,
        distancia: distanciaFormatada,
        duracao: `${rota.duracaoMin} min`,
        geometry: rota.geometry,
        origin_text: data.origin_text,
        destination_text: data.destination_text,
        metodo_pagamento: data.metodo_pagamento,
        status: data.status,
      },
    });
  } catch (err) {
    console.error('[Rides/Solicitar] Erro:', err.message);
    return res.status(500).json({
      error: 'Erro ao processar solicitação de corrida.',
      code: 'RIDES_INTERNAL_ERROR',
    });
  }
});

// ============================================================
// POST /api/rides/cancelar
// Passageiro cancela a corrida. Verifica se é o dono da corrida.
// ============================================================
router.post('/cancelar', authMiddleware, async (req, res) => {
  const { ride_id } = req.body;

  if (!ride_id) {
    return res.status(400).json({ error: 'ride_id é obrigatório.', code: 'RIDES_MISSING_ID' });
  }

  try {
    // Busca a corrida e verifica se o passageiro é mesmo o dono
    const { data: ride, error: fetchError } = await supabaseAdmin
      .from('rides')
      .select('id, passenger_id, status')
      .eq('id', ride_id)
      .single();

    if (fetchError || !ride) {
      return res.status(404).json({ error: 'Corrida não encontrada.', code: 'RIDES_NOT_FOUND' });
    }

    // Segurança: só o dono pode cancelar
    if (ride.passenger_id !== req.user.id) {
      return res.status(403).json({ error: 'Acesso negado.', code: 'RIDES_FORBIDDEN' });
    }

    // Só pode cancelar corridas pendentes
    if (ride.status !== 'pendente') {
      return res.status(409).json({
        error: `Não é possível cancelar uma corrida com status "${ride.status}".`,
        code: 'RIDES_INVALID_STATUS',
      });
    }

    const { error } = await supabaseAdmin
      .from('rides')
      .update({ status: 'cancelado' })
      .eq('id', ride_id);

    if (error) throw error;

    return res.json({ success: true, message: 'Corrida cancelada com sucesso.' });
  } catch (err) {
    console.error('[Rides/Cancelar] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao cancelar corrida.', code: 'RIDES_INTERNAL_ERROR' });
  }
});

// ============================================================
// POST /api/rides/aceitar
// Motorista aceita uma corrida. Verifica atomicamente se ainda está pendente.
// ============================================================
router.post('/aceitar', authMiddleware, async (req, res) => {
  const { ride_id } = req.body;

  if (!ride_id) {
    return res.status(400).json({ error: 'ride_id é obrigatório.', code: 'RIDES_MISSING_ID' });
  }

  try {
    // Atualização atômica: só atualiza se o status ainda for 'pendente' e driver_id for null
    // Isso evita race condition de dois motoristas aceitando ao mesmo tempo
    const { data, error } = await supabaseAdmin
      .from('rides')
      .update({
        driver_id: req.user.id, // Vem do JWT validado
        status: 'aceita',
      })
      .eq('id', ride_id)
      .eq('status', 'pendente')
      .is('driver_id', null)
      .select()
      .single();

    if (error || !data) {
      return res.status(409).json({
        error: 'Esta corrida já foi aceita ou não está mais disponível.',
        code: 'RIDES_ALREADY_TAKEN',
      });
    }

    return res.json({ success: true, ride: data });
  } catch (err) {
    console.error('[Rides/Aceitar] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao aceitar corrida.', code: 'RIDES_INTERNAL_ERROR' });
  }
});

// ============================================================
// POST /api/rides/finalizar
// Motorista finaliza a corrida. Verifica se é realmente o motorista dela.
// ============================================================
router.post('/finalizar', authMiddleware, async (req, res) => {
  const { ride_id } = req.body;

  if (!ride_id) {
    return res.status(400).json({ error: 'ride_id é obrigatório.', code: 'RIDES_MISSING_ID' });
  }

  try {
    const { data: ride, error: fetchError } = await supabaseAdmin
      .from('rides')
      .select('id, driver_id, status, valor')
      .eq('id', ride_id)
      .single();

    if (fetchError || !ride) {
      return res.status(404).json({ error: 'Corrida não encontrada.', code: 'RIDES_NOT_FOUND' });
    }

    // Segurança: só o motorista da corrida pode finalizar
    if (ride.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Acesso negado.', code: 'RIDES_FORBIDDEN' });
    }

    if (ride.status !== 'aceita') {
      return res.status(409).json({
        error: `Não é possível finalizar corrida com status "${ride.status}".`,
        code: 'RIDES_INVALID_STATUS',
      });
    }

    // Calcula ganho líquido do motorista (sem o cliente poder manipular)
    const ganhoLiquido = parseFloat((ride.valor * (1 - COMISSAO_PLATAFORMA)).toFixed(2));

    const { error } = await supabaseAdmin
      .from('rides')
      .update({
        status: 'finalizada',
        ganho_motorista: ganhoLiquido,
        finalizada_em: new Date().toISOString(),
      })
      .eq('id', ride_id);

    if (error) throw error;

    return res.json({
      success: true,
      message: 'Corrida finalizada!',
      ganhoLiquido,
    });
  } catch (err) {
    console.error('[Rides/Finalizar] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao finalizar corrida.', code: 'RIDES_INTERNAL_ERROR' });
  }
});

module.exports = router;
