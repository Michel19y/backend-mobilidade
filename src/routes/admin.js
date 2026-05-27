// src/routes/admin.js
const express = require('express');
const router = express.Router();
const { authMiddleware, supabaseAdmin } = require('../middleware/auth');

const allowedTables = ['motoristas', 'rides', 'passageiros'];

const tableConfigs = {
  motoristas: {
    title: "Motoristas",
    fields: [
      { key: "id", label: "ID", type: "text", editable: false },
      { key: "user_id", label: "User ID", type: "text", editable: false },
      { key: "nome", label: "Nome", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "cpf", label: "CPF", type: "text" },
      { key: "celular", label: "Celular", type: "text" },
      { key: "placa", label: "Placa", type: "text" },
      { key: "ano_carro", label: "Ano do Carro", type: "numeric" },
      { key: "modelo_carro", label: "Modelo", type: "text" },
      { key: "status", label: "Status (pendente, aprovado, reprovado)", type: "text" },
      { key: "online", label: "Online", type: "boolean" },
      { key: "ultima_localizacao", label: "Última Localização", type: "json" },
      { key: "created_at", label: "Criado em", type: "date", editable: false },
    ],
  },
  passageiros: {
    title: "Passageiros",
    fields: [
      { key: "id", label: "ID", type: "text", editable: false },
      { key: "nome", label: "Nome", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "cpf", label: "CPF", type: "text" },
      { key: "celular", label: "Celular", type: "text" },
      { key: "created_at", label: "Criado em", type: "date", editable: false },
    ],
  },
  rides: {
    title: "Corridas",
    fields: [
      { key: "id", label: "ID", type: "text", editable: false },
      { key: "passenger_id", label: "ID Passageiro", type: "text" },
      { key: "driver_id", label: "ID Motorista", type: "text" },
      { key: "origin_text", label: "Origem (Texto)", type: "text" },
      { key: "destination_text", label: "Destino (Texto)", type: "text" },
      { key: "origin_coords", label: "Coords Origem", type: "json" },
      { key: "destination_coords", label: "Coords Destino", type: "json" },
      { key: "distancia_km", label: "Distância (km)", type: "numeric" },
      { key: "valor", label: "Valor (R$)", type: "numeric" },
      { key: "status", label: "Status da Corrida", type: "text" },
      { key: "metodo_pagamento", label: "Método Pagamento", type: "text" },
      { key: "cancelado_por", label: "Cancelado por", type: "text" },
      { key: "motivo_cancelamento", label: "Motivo", type: "text" },
      { key: "created_at", label: "Criado em", type: "date", editable: false },
      { key: "updated_at", label: "Atualizado em", type: "date", editable: false },
    ],
  },
};




function isAdmin(req, res) {
  if (req.user?.user_metadata?.role !== 'admin') {
    res.status(403).json({ error: 'Acesso negado.' });
    return false;
  }
  return true;
}

function isValidTable(table, res) {
  if (!allowedTables.includes(table)) {
    res.status(400).json({ error: 'Tabela inválida.' });
    return false;
  }
  return true;
}

// Rota de config — autentica mas não precisa checar role, é só metadata de UI
router.get('/admin/config', authMiddleware, (req, res) => {
  res.json(tableConfigs);
});


// GET
router.get('/admin/data/:table', authMiddleware, async (req, res) => {
  const { table } = req.params;
  if (!isAdmin(req, res) || !isValidTable(table, res)) return;

  try {
    let query = supabaseAdmin.from(table).select('*');
    if (table === 'rides') {
      query = supabaseAdmin.from('rides').select(`*, passageiros(nome), motoristas(nome)`);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST — insert
router.post('/admin/data/:table', authMiddleware, async (req, res) => {
  const { table } = req.params;
  if (!isAdmin(req, res) || !isValidTable(table, res)) return;

  try {
    const { data, error } = await supabaseAdmin.from(table).insert([req.body]).select();
    if (error) throw error;
    return res.json(data[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT — update
router.put('/admin/data/:table/:id', authMiddleware, async (req, res) => {
  const { table, id } = req.params;
  if (!isAdmin(req, res) || !isValidTable(table, res)) return;

  try {
    const { data, error } = await supabaseAdmin.from(table).update(req.body).eq('id', id).select();
    if (error) throw error;
    return res.json(data[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete('/admin/data/:table/:id', authMiddleware, async (req, res) => {
  const { table, id } = req.params;
  if (!isAdmin(req, res) || !isValidTable(table, res)) return;

  try {
    const { error } = await supabaseAdmin.from(table).delete().eq('id', id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH — aprovar motorista
router.patch('/admin/data/motoristas/:id/aprovar', authMiddleware, async (req, res) => {
  if (!isAdmin(req, res)) return;

  try {
    const { data, error } = await supabaseAdmin
      .from('motoristas')
      .update({ status: 'aprovado' })
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    return res.json(data[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;