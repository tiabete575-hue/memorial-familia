# Memorial da Família

Aplicação em React com API Express. O Turso guarda homenagens e mensagens; o Cloudflare R2 guarda fotos privadas. As imagens são exibidas por URLs assinadas de curta duração. Os segredos ficam somente no servidor, em `.env`.

## Preparação local

1. Instale uma versão LTS atual do Node.js.
2. Crie um banco Turso e copie a URL e o token de autenticação de escrita para `.env`.
3. Crie um bucket privado no Cloudflare R2 e uma chave de API com leitura e gravação no bucket. Preencha o ID da conta, ID da chave, segredo e nome do bucket em `.env`.
4. Copie `.env.example` para `.env` e substitua todos os valores de exemplo. Nunca publique `.env` nem inclua tokens no código-fonte.
5. No terminal, nesta pasta, execute `npm install` e `npm run dev`.
6. Abra o endereço local mostrado pelo Vite. A API Express atende em `localhost:3001`; a aplicação cria as tabelas do Turso na primeira requisição.

O endpoint `/api/health` informa se o banco e o storage estão configurados. Fotos aceitas: JPEG, PNG, WebP ou GIF, no máximo 8 MB. A aplicação não inventa credenciais: mantenha o `.env.example` como modelo e forneça credenciais válidas no ambiente antes de usar os dados reais.

## Primeira homenagem

Ao consultar um banco Turso vazio pela primeira vez, o servidor registra a homenagem de Benedito Antônio Carneiro Rodrigues (1966–2024). A fotografia original enviada pela família está incluída em `src/benedito-carneiro-rodrigues.jpg` para uso na versão inicial do memorial.

## Publicação

A interface estática pode ser compilada com `npm run build`. O servidor Express requer um runtime Node.js persistente e as mesmas variáveis de ambiente. Configure a plataforma escolhida para servir `dist/` pelo frontend e encaminhar `/api` para o servidor Express.
