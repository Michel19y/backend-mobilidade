const express = require('express');
const router = express.Router();
const { authMiddleware, supabaseAdmin } = require('../middleware/auth');

// Configurações de negócio
const PRECO_POR_KM = 2.80;
const TAXA_BASE = 5.00;
const COMISSAO_PLATAFORMA = 0.10;

// --- Helpers ---
async function calcularRotaOSRM(origem, destino) {
    const url = `https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=full&geometries=polyline`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Falha ao calcular rota');
    const data = await res.json();
    if (!data?.routes?.length) throw new Error('Nenhuma rota encontrada');
    return {
        distanciaKm: parseFloat((data.routes[0].distance / 1000).toFixed(2)),
        geometry: data.routes[0].geometry,
    };
}

function calcularPreco(distKm) {
    return parseFloat(((distKm * PRECO_POR_KM) + TAXA_BASE).toFixed(2));
}

async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
        const data = await res.json();
        return data.features?.[0]?.properties?.name || 'Endereço no mapa';
    } catch { return 'Endereço no mapa'; }
}

// --- Rotas ---

// 1. Solicitar Corrida (Passageiro)
router.post('/solicitar', authMiddleware, async (req, res) => {
    const { origin_coords, destination_coords, metodo_pagamento, destination_text } = req.body;
    try {
        const rota = await calcularRotaOSRM(origin_coords, destination_coords);
        const valor = calcularPreco(rota.distanciaKm);
        const [originText, destText] = await Promise.all([
            reverseGeocode(origin_coords.lat, origin_coords.lng),
            destination_text || reverseGeocode(destination_coords.lat, destination_coords.lng),
        ]);

        const { data, error } = await supabaseAdmin
            .from('rides')
            .insert([{
                passenger_id: req.user.id,
                origin_text: originText,
                destination_text: destText,
                origin_coords,
                destination_coords,
                distancia_km: rota.distanciaKm,
                valor,
                status: 'aguardando',
                metodo_pagamento,
            }])
            .select().single();

        if (error) throw error;
        return res.status(201).json({ success: true, ride: data });
    } catch (err) {
        console.error('[Erro ao solicitar]:', err);
        return res.status(500).json({ error: 'Erro ao processar corrida.' });
    }
});

// 2. Listar Corridas Disponíveis (O que o Motorista busca no radar)
router.get('/disponiveis', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('rides')
            .select('*')
            .eq('status', 'aguardando')
            .is('driver_id', null);

        // --- ADICIONE ISTO ---
        console.log('🔍 [DEBUG BACKEND] Corridas encontradas no Supabase:', data ? data.length : 'Erro/Vazio');
        console.log('🔍 [DEBUG BACKEND] Erro do banco:', error);
        // ---------------------

        if (error) throw error;
        return res.json(data || []);
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao buscar chamadas.' });
    }
});


// 3. Aceitar Corrida (Motorista)
router.post('/aceitar', authMiddleware, async (req, res) => {
    const { ride_id } = req.body;
    try {
        const { data, error } = await supabaseAdmin
            .from('rides')
            .update({ driver_id: req.user.id, status: 'aceita' })
            .eq('id', ride_id)
            .eq('status', 'aguardando')
            .is('driver_id', null)
            .select().single();

        if (error || !data) return res.status(409).json({ error: 'Corrida indisponível.' });
        return res.json({ success: true, ride: data });
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao aceitar.' });
    }
});

// 4. Cancelar Corrida (Passageiro)
router.post('/cancelar', authMiddleware, async (req, res) => {
    const { ride_id } = req.body;
    try {
        const { data: ride } = await supabaseAdmin.from('rides').select('status').eq('id', ride_id).single();
        if (ride?.status !== 'aguardando') return res.status(409).json({ error: 'Não é possível cancelar.' });

        await supabaseAdmin.from('rides').update({ status: 'cancelada' }).eq('id', ride_id);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao cancelar.' });
    }
});

// 5. Finalizar Corrida (Motorista)
router.post('/finalizar', authMiddleware, async (req, res) => {
    const { ride_id } = req.body;
    try {
        await supabaseAdmin.from('rides').update({ 
            status: 'finalizada', 
            finalizada_em: new Date().toISOString() 
        }).eq('id', ride_id);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao finalizar.' });
    }
});

module.exports = router;