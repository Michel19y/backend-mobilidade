const { createClient } = require('@supabase/supabase-js');

// ============================================================
// Middleware de Autenticação
// ============================================================
// Valida o JWT Bearer token que o app mobile envia.
// Usa o Supabase Admin Client para verificar o token sem
// depender de nenhuma informação vinda do cliente.
//
// Se válido: injeta req.user = { id, email, ... }
// Se inválido: retorna 401 imediatamente, sem tocar nas rotas.
// ============================================================

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Token de autenticação não encontrado.',
      code: 'AUTH_MISSING_TOKEN',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Valida o token pelo Supabase — se o token foi adulterado, retorna erro
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error: 'Token inválido ou expirado.',
        code: 'AUTH_INVALID_TOKEN',
      });
    }

    // Injeta os dados do usuário verificados pelo servidor (não pelo cliente)
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error('[Auth Middleware] Erro:', err.message);
    return res.status(500).json({
      error: 'Erro interno ao validar autenticação.',
      code: 'AUTH_INTERNAL_ERROR',
    });
  }
}

module.exports = { authMiddleware, supabaseAdmin };
