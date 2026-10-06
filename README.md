# Memorial da Família

Memorial em React publicado como Cloudflare Worker. A API executa no Worker, usa Turso para as homenagens e Cloudinary para fotos. As assinaturas de upload são feitas no servidor; a chave secreta nunca vai para o navegador.

## Publicação no Cloudflare Workers

1. Use um token Turso novo, já que tokens compartilhados em conversas devem ser revogados.
2. Em Workers & Pages, adicione `TURSO_AUTH_TOKEN` e `CLOUDINARY_API_SECRET` como **Secrets**. O `wrangler.toml` define a URL do Turso, o nome da nuvem e a chave pública do Cloudinary.
3. Instale as dependências e publique com `npm install` e `npm run deploy`, autenticado na conta Cloudflare correta.

A publicação compila o frontend para `dist/` e envia a aplicação Worker. `/api/*` é encaminhado ao Worker; os demais caminhos são servidos pelos assets estáticos.

## Desenvolvimento local

O servidor Express continua disponível para `npm run dev`. Configure `.env` a partir de `.env.example` com o token Turso e o segredo do Cloudinary. Para experimentar o Worker, use `.dev.vars` com `TURSO_AUTH_TOKEN` e `CLOUDINARY_API_SECRET` e execute `npm run dev:worker`.

As tabelas são criadas na primeira chamada à API. Em banco sem homenagens, é registrada automaticamente a primeira homenagem de Benedito Antônio Carneiro Rodrigues. Fotos aceitas: JPEG, PNG, WebP ou GIF, até 8 MB. `GET /api/health` informa o estado das conexões.

## Rotas

- `GET /api/members` e `POST /api/members`
- `DELETE /api/members/:id`
- `GET` e `POST /api/members/:id/condolences`
- `DELETE /api/condolences/:id`
- `GET /api/media/:key`
- `GET /api/health`
