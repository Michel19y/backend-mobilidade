require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const adminRouter = require('./routes/admin');
console.log('👉 CONTEÚDO DO ADMIN ROUTER:', adminRouter.stack ? "Rotas carregadas!" : adminRouter);
const ridesRouter = require('./routes/rides');
const mapsRouter = require('./routes/maps');
const authRouter = require('./routes/auth'); // 👈 1. IMPORTAÇÃO ADICIONADA AQUI!

// ============================================================
// Validação das variáveis de ambiente obrigatórias
// ============================================================
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missingVars = requiredEnvVars.filter((v) => !process.env[v] || process.env[v].includes('COLE_'));

if (missingVars.length > 0) {
  console.error('\n⛔ ERRO: Variáveis de ambiente obrigatórias não configuradas:');
  missingVars.forEach((v) => console.error(`   → ${v}`));
  console.error('\n➡️  Edite o arquivo .env e preencha os valores.\n');
  process.exit(1);
}

// ============================================================
// App Express
// ============================================================
const app = express();
const PORT = process.env.PORT || 3001;

// --- Middlewares Globais ---
app.use(cors({
  origin: '*', // Em produção, restrinja para o domínio do app
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(morgan('dev')); // Loga todas as requisições no terminal

// ============================================================
// Rotas
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      supabase_url: process.env.SUPABASE_URL,
      port: PORT,
    },
  });
});

// Vincula os caminhos HTTP aos arquivos de rotas correspondentes
app.use('/api/auth', authRouter);   // 👈 2. REGISTRO DA ROTA ADICIONADO AQUI!
app.use('/api/rides', ridesRouter);
app.use('/api/maps', mapsRouter);
app.use('/api', adminRouter); 
// ============================================================
// Handler de rotas não encontradas
// ============================================================
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.', path: req.originalUrl });
});

// ============================================================
// Handler de erros globais
// ============================================================
app.use((err, req, res, next) => {
  console.error('[Global Error]', err);
  res.status(500).json({ error: 'Erro interno do servidor.', message: err.message });
});

// ============================================================
// Inicialização
// ============================================================
app.listen(PORT, () => {
  console.log('\n✅ DriveE Backend rodando!');
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   → Health check: http://localhost:${PORT}/health\n`);
});