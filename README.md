# DriveE Backend

Backend em Node.js/Express do **DriveE**, um app de mobilidade urbana (estilo Uber) com apps separados para passageiro e motorista. Este servidor concentra toda a lógica de negócio sensível — o app mobile nunca fala direto com o banco ou com provedores de mapas externos.

## Funcionalidades

- **Autenticação** (`/api/auth`): cadastro e login separados para motoristas e passageiros via Supabase Auth, com verificação de CPF duplicado e aprovação manual de motoristas (`pendente` → `aprovado`/`reprovado`) antes de liberar o login.
- **Corridas** (`/api/rides`): solicitar corrida (calcula rota e preço automaticamente via OSRM), listar corridas disponíveis para motoristas, aceitar, cancelar e finalizar corrida.
- **Mapas** (`/api/maps`): proxy autenticado para geocodificação (Photon), geocodificação reversa e cálculo de rota (OSRM) — o app nunca chama essas APIs externas diretamente, o que permite trocar de provedor ou aplicar rate limiting sem mexer no app.
- **Admin** (`/api/admin`): painel administrativo com CRUD genérico sobre as tabelas `motoristas`, `passageiros` e `rides` (protegido por `role: admin`), incluindo aprovação de motoristas.
- **Middleware de autenticação**: valida o JWT do Supabase em toda rota protegida, sem confiar em nenhuma informação enviada pelo cliente.

## Regras de negócio

- Preço da corrida = `distância_km × R$ 2,80 + R$ 5,00` (taxa base).
- Comissão da plataforma: 10% sobre o valor da corrida.
- CPF não pode se repetir entre motoristas nem entre passageiros.
- Motorista só consegue logar depois de ter o cadastro aprovado por um admin.

## Stack

- Node.js + Express 5
- Supabase (Auth + Postgres) via `@supabase/supabase-js`
- OSRM (rotas) e Photon/Komoot (geocodificação) como provedores de mapa gratuitos
- `jsonwebtoken` / `jwks-rsa`, `cors`, `morgan`, `dotenv`

## Como rodar

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Crie um arquivo `.env` na raiz com:
   ```
   SUPABASE_URL=https://SEU-PROJETO.supabase.co
   SUPABASE_SERVICE_KEY=sua-service-role-key
   PORT=3001
   ```
3. Rode em modo desenvolvimento (reinicia sozinho a cada mudança):
   ```bash
   npm run dev
   ```
   Ou em produção:
   ```bash
   npm start
   ```
4. Verifique se está no ar em `http://localhost:3001/health`.

## Estrutura

```
src/
├── server.js           # ponto de entrada, registra as rotas e middlewares globais
├── middleware/auth.js  # valida o token Supabase em toda rota protegida
└── routes/
    ├── auth.js         # cadastro/login de motoristas e passageiros
    ├── rides.js        # solicitar, aceitar, cancelar e finalizar corridas
    ├── maps.js         # proxy de geocodificação e cálculo de rota
    └── admin.js        # CRUD administrativo sobre motoristas/passageiros/rides
```
