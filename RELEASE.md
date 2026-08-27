# Release do AltGrid

O workflow `.github/workflows/release.yml` publica os instaladores Windows no repositório público `acvisualdigital/altgrid-releases` quando uma tag `v*` é enviada. O preflight exige que a tag seja exatamente `v` seguida da versão de `package.json` (por exemplo, `v0.9.0-beta.1`). Betas devem ser publicadas como pré-lançamento; a versão pública final será 1.0.0.

## Configuração do GitHub

Cadastre estas **Variables** no repositório:

- `ALTGRID_API_BASE_URL`: URL pública da API usada pelo aplicativo.
- `SUPABASE_URL`: URL pública do projeto Supabase.
- `ALTGRID_STAGING_API_BASE_URL`: URL HTTPS da API de staging usada pelo smoke test.
- `ALTGRID_SMOKE_ORIGIN`: origem CORS autorizada para o teste; é opcional e usa `altgrid://app` por padrão.
- `LICENSE_KEY_ID`: identificador da chave de licença; é opcional.

Cadastre estes **Secrets**:

- `SUPABASE_ANON_KEY`: chave pública anon do Supabase embutida no cliente.
- `LICENSE_PUBLIC_KEY`: chave pública Ed25519 usada para validar licenças offline.
- `ALTGRID_RELEASES_TOKEN`: token de acesso de granularidade fina com permissão `Contents: Read and write` somente no repositório `acvisualdigital/altgrid-releases`. O `GITHUB_TOKEN` padrão não publica em outro repositório.

O workflow falha antes do build se a tag não combinar com a versão ou se alguma das quatro configurações obrigatórias do cliente estiver vazia. Ele informa somente os nomes ausentes e não imprime valores.

O instalador recebe `app-update.yml` com o provedor fixo do GitHub. A release deve conter `AltGrid-Setup-<versão>.exe`, seu `.blockmap` e `latest.yml`; o build local também copia esses metadados para `release/` e falha se estiverem ausentes ou inconsistentes. O executável Portable continua sendo publicado como alternativa manual, mas o fluxo de atualização interna é destinado à instalação NSIS.

## Smoke test de staging

`pnpm smoke:staging` executa apenas requisições `GET` e `OPTIONS`. Ele confere:

- `200` e JSON válido em `/health`, `/v1/app/config`, `/v1/games` e `/v1/products`;
- preflight CORS para a origem configurada;
- `401` sem token em `/v1/me`, `/v1/me/entitlements`, `/v1/devices`, `/v1/license/snapshot` e `/v1/admin/users`.

Para executar manualmente, defina `ALTGRID_STAGING_API_BASE_URL` no ambiente. `ALTGRID_SMOKE_TIMEOUT_MS` pode ajustar o timeout padrão de 10 segundos.

## Assinatura Windows opcional

Sem certificado, o workflow gera os executáveis normalmente e desativa descoberta automática de certificados. Para assinar, configure os dois secrets abaixo em conjunto:

- `WINDOWS_CERTIFICATE_BASE64`: conteúdo base64 do arquivo PFX/P12.
- `WINDOWS_CERTIFICATE_PASSWORD`: senha do certificado.

O certificado é gravado somente no diretório temporário do runner, seu conteúdo e senha não são enviados na linha de comando, e o arquivo temporário é removido ao final mesmo se o build falhar. Se apenas um dos dois secrets estiver configurado, a release falha antes da publicação.

## Comandos locais

```powershell
$env:RELEASE_TAG = 'v0.9.0-beta.1'
pnpm release:preflight
pnpm smoke:staging
```

Esses comandos não fazem deploy nem alteram dados externos.
