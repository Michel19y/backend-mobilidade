const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

// ============================================================
// Proxy de APIs de Mapeamento
// ============================================================
// O app mobile nunca chama OSRM ou Photon diretamente.
// Todas as chamadas passam por aqui, onde podemos:
//  - Controlar rate limiting
//  - Ocultar os endpoints das ferramentas de análise de tráfego
//  - Cachear resultados futuramente
//  - Trocar de provedor sem alterar o app
// ============================================================

// ============================================================
// GET /api/maps/geocode?q=texto&lat=...&lng=...
// Busca endereços por texto (autocomplete)
// ============================================================
router.get('/geocode', authMiddleware, async (req, res) => {
  const { q, lat, lng, limit = 5 } = req.query;

  if (!q || q.length < 2) {
    return res.status(400).json({
      error: 'Parâmetro "q" deve ter ao menos 2 caracteres.',
      code: 'MAPS_INVALID_QUERY',
    });
  }

  try {
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}`;
    if (lat && lng) url += `&lat=${lat}&lon=${lng}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Photon retornou ${response.status}`);

    const data = await response.json();

    // Retorna apenas o necessário (sem expor o provider ao cliente)
    const results = (data.features || []).map((f) => ({
      nome: f.properties.name,
      cidade: f.properties.city || f.properties.state || '',
      pais: f.properties.country || '',
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    }));

    return res.json({ success: true, results });
  } catch (err) {
    console.error('[Maps/Geocode] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao buscar endereços.', code: 'MAPS_GEOCODE_ERROR' });
  }
});

// ============================================================
// GET /api/maps/reverse?lat=...&lng=...
// Converte coordenadas em endereço textual
// ============================================================
router.get('/reverse', authMiddleware, async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({
      error: 'Parâmetros "lat" e "lng" são obrigatórios.',
      code: 'MAPS_MISSING_COORDS',
    });
  }

  try {
    const response = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`);
    if (!response.ok) throw new Error(`Photon retornou ${response.status}`);

    const data = await response.json();
    const nome = data.features?.[0]?.properties?.name || 'Localização atual';

    return res.json({ success: true, nome });
  } catch (err) {
    console.error('[Maps/Reverse] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao converter coordenadas.', code: 'MAPS_REVERSE_ERROR' });
  }
});

// ============================================================
// GET /api/maps/rota?originLat=...&originLng=...&destLat=...&destLng=...
// Calcula rota entre dois pontos via OSRM e retorna a polyline
// ============================================================
router.get('/rota', authMiddleware, async (req, res) => {
  const { originLat, originLng, destLat, destLng } = req.query;

  if (!originLat || !originLng || !destLat || !destLng) {
    return res.status(400).json({
      error: 'Parâmetros originLat, originLng, destLat, destLng são obrigatórios.',
      code: 'MAPS_MISSING_COORDS',
    });
  }

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=polyline`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`OSRM retornou ${response.status}`);

    const data = await response.json();
    if (!data?.routes?.length) {
      return res.status(404).json({ error: 'Nenhuma rota encontrada.', code: 'MAPS_NO_ROUTE' });
    }

    const route = data.routes[0];
    const distKm = route.distance / 1000;
    const duracaoMin = Math.round(route.duration / 60);

    return res.json({
      success: true,
      geometry: route.geometry,
      distanciaKm: parseFloat(distKm.toFixed(2)),
      distanciaFormatada: `${distKm.toFixed(1)} km`,
      duracaoMin,
      duracaoFormatada: `${duracaoMin} min`,
    });
  } catch (err) {
    console.error('[Maps/Rota] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao calcular rota.', code: 'MAPS_ROUTE_ERROR' });
  }
});

// ============================================================
// GET /api/maps/rota-motorista?...
// Calcula DUAS rotas em paralelo: motorista→origem e origem→destino
// Usado pelo app do motorista ao aceitar uma corrida.
// ============================================================
router.get('/rota-motorista', authMiddleware, async (req, res) => {
  const { driverLat, driverLng, originLat, originLng, destLat, destLng } = req.query;

  if (!driverLat || !driverLng || !originLat || !originLng || !destLat || !destLng) {
    return res.status(400).json({
      error: 'Todos os parâmetros de localização são obrigatórios.',
      code: 'MAPS_MISSING_COORDS',
    });
  }

  try {
    const [res1, res2] = await Promise.all([
      fetch(`https://router.project-osrm.org/route/v1/driving/${driverLng},${driverLat};${originLng},${originLat}?overview=full&geometries=polyline`),
      fetch(`https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=polyline`),
    ]);

    if (!res1.ok || !res2.ok) throw new Error('Falha ao calcular rotas no OSRM');

    const [d1, d2] = await Promise.all([res1.json(), res2.json()]);

    return res.json({
      success: true,
      rotaAtendimento: {
        geometry: d1.routes[0].geometry,
        distanciaKm: parseFloat((d1.routes[0].distance / 1000).toFixed(2)),
        duracaoMin: Math.round(d1.routes[0].duration / 60),
      },
      rotaViagem: {
        geometry: d2.routes[0].geometry,
        distanciaKm: parseFloat((d2.routes[0].distance / 1000).toFixed(2)),
        duracaoMin: Math.round(d2.routes[0].duration / 60),
      },
    });
  } catch (err) {
    console.error('[Maps/RotaMotorista] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao calcular rotas do motorista.', code: 'MAPS_ROUTE_ERROR' });
  }
});

module.exports = router;
