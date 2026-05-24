// backend/routes/auth.js
const express = require('express');
const router = express.Router();
// Altere a linha antiga para puxar do pacote correto que você acabou de instalar:
const { createClient } = require('@supabase/supabase-js');

// Inicializa o Supabase com a Service Key (Super Poderes)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

router.post('/register-motorista', async (req, res) => {
  try {
    const { email, password, nome, placa, anoCarro, cpfLimpo, celular } = req.body;

    // 1. Segunda camada de validação (Garante que se burlarem o app, o back barra)
    if (!email || !password || !nome || !placa || !anoCarro || !cpfLimpo) {
      return res.status(400).json({ error: 'Preencha todos os dados obrigatórios.' });
    }

    // 2. REGRA DE NEGÓCIO: Verifica se o CPF já está em uso
    const { data: existente, error: checkError } = await supabase
      .from('motoristas')
      .select('cpf')
      .eq('cpf', cpfLimpo)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existente) {
      // Regra de aviso exata do seu sistema
      return res.status(400).json({ error: 'esse cpf ja esta no processo de verificação de aprovaãop' });
    }

    // 3. Cria o usuário na Auth do Supabase pelo Servidor
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Já cria com e-mail confirmado para evitar atrito
      user_metadata: { full_name: nome, type: 'motorista', role: 'motorista' }
    });

    if (authError) return res.status(400).json({ error: authError.message });

    // 4. Insere os dados complementares na tabela 'motoristas'
    const { error: dbError } = await supabase
      .from('motoristas')
      .insert([{ 
        user_id: authData.user?.id, 
        nome, 
        email, 
        cpf: cpfLimpo, 
        celular, 
        placa: placa.toUpperCase(), 
        ano_carro: parseInt(anoCarro), 
        status: 'pendente' 
      }]);

    if (dbError) throw dbError;

    // Retorna Sucesso total
    return res.status(201).json({ message: 'Dados enviados para análise com sucesso.' });

  } catch (err) {
    console.error('[Erro Register Motorista]', err);
    return res.status(500).json({ error: 'Erro interno ao processar o cadastro.' });
  }
});


// backend/src/routes/auth.js

// backend/src/routes/auth.js

router.post('/login-motorista', async (req, res) => {
  try {
    // Forçamos o e-mail a ficar em minúsculo para evitar incompatibilidade
    const email = req.body.email?.toLowerCase().trim();
    const { password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Preencha todos os campos para entrar.' });
    }

    // 1. Autentica o usuário (valida e-mail e senha)
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    // 🚀 O PULO DO GATO: Em vez de buscar por e-mail, buscamos pelo ID único gerado na Auth!
    const { data: motorista, error: dbError } = await supabase
      .from('motoristas')
      .select('status')
      .eq('user_id', authData.user.id) // 👈 Busca 100% segura por ID
      .maybeSingle();

    if (dbError || !motorista) {
      // Se não achar o registro na tabela vinculada, desloga da Auth por segurança
      await supabase.auth.signOut();
      return res.status(404).json({ error: 'Vínculo de motorista não encontrado nesta tabela.' });
    }

    // 3. Validação dos Status de Aprovação
    if (motorista.status === 'pendente') {
      await supabase.auth.signOut(); // Desloga para não deixar a sessão aberta no app
      return res.status(403).json({ 
        error: 'esse cpf ja esta no processo de verificação de aprovaãop' 
      });
    }

    if (motorista.status === 'reprovado') {
      await supabase.auth.signOut();
      return res.status(403).json({ 
        error: 'Seu cadastro foi reprovado pela administração.' 
      });
    }

    // Se o status for 'aprovado'
    return res.status(200).json({
      message: 'Login aprovado!',
      session: authData.session,
      user: authData.user
    });

  } catch (err) {
    console.error('[Erro Login Motorista]', err);
    return res.status(500).json({ error: 'Erro interno ao processar o login.' });
  }
});

module.exports = router;