# Integra360 Ticketera

**Multi-tenant** ticketing platform for venues and clubs. Each venue (tenant):

- manages its own events, sellers and sales;
- collects payment for tickets through **its own MercadoPago account**;
- sends sale links and tickets over **WhatsApp**, using **Meta Business API** or **Baileys**;
- prints its **event image** on every QR ticket.

The platform (superadmin) charges each venue a **subscription** through its own MercadoPago account.

**Backend:** Node.js + Express + MySQL (MVC, JWT). **Frontend:** React + Vite + TailwindCSS + Axios + Context API.

## MercadoPago (OAuth)

Each venue and the platform link their **own** MercadoPago account with "Conectar con MercadoPago" (official OAuth, refresh tokens renewed automatically). Setup, flow and tests: [MERCADOPAGO_OAUTH.md](MERCADOPAGO_OAUTH.md).

## Seller payment links (MercadoPago or cash)

Sellers generate a payment link for a specific buyer: MercadoPago by default (venue's OAuth account) or cash if the venue admin enables it; cash tickets only become valid after the admin validates the payment. Details: [LINKS_DE_PAGO.md](LINKS_DE_PAGO.md).

## PWA and door control (Portería)

The app is installable as a PWA. The **Portería** screen (`/porteria`) scans ticket QR codes with the device camera and marks each ticket as used. Installation, API and desktop/mobile testing: [PORTERIA_PWA.md](PORTERIA_PWA.md).

## Setup

```bash
# Backend
cd backend
cp .env.example .env        # DB_*, JWT_SECRET, CREDENTIALS_KEY, FRONTEND_URL, BACKEND_PUBLIC_URL
npm install
npm run migrate             # applies pending migrations (001 → 008), tracked in the `migraciones` table
npm run seed                # multi-tenant test data (with sample event images)
npm run dev                 # http://localhost:4000/api
# npm run db:reset          # drops everything, migrates and seeds again

# Frontend
cd frontend
npm install
npm run dev                 # http://localhost:5173 (or http://norte.localhost:5173 to test subdomains)
```

`CREDENTIALS_KEY` encrypts the credentials stored in the database (AES-256-GCM). Generate it with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Do not change it** once integrations are saved: the stored credentials could no longer be decrypted.

MercadoPago sends payment notifications to `BACKEND_PUBLIC_URL`. In local development, use a tunnel (for example `ngrok http 4000`). Without webhooks, the buyer's return page confirms the payment anyway (`/ventas/:id/verificar-pago`).

### Test users

| Role | Email | Password |
|---|---|---|
| Superadmin | super@integra360.com | super123 |
| Admin, Complejo Norte (`norte`) | admin@norte.com | admin123 |
| Admin, Boliche Luna (`luna`) | admin@luna.com | admin123 |
| Sellers | carla@norte.com · diego@norte.com · lucia@luna.com | vende123 |
| Door staff (portero) — log in with **username** | norte.puerta · luna.puerta | porton123 |
| Buyers | ana@mail.com · bruno@mail.com | user123 |

With `PAGOS_SIMULADOS=true`, the test methods "Tarjeta (prueba)" (card `4111 1111 1111 1111`) and "Billetera (prueba)" are also offered. **In production set it to `false`**.

## Roles and panels

| Role | Can |
|---|---|
| `superadmin` | Venues (create, suspend, **plan and subscription**, **WhatsApp chatbot: Meta or Baileys**), the platform's MercadoPago account, plans, users |
| `admin` (venue) | Events (with **image**), ticket types, seats, **sellers (CRUD)**, sales, issuance, **door staff (create porteros with generated credentials)**, door activity, **its own MercadoPago account**, venue details and subscription |
| `vendedor` (seller) | Generate **unique sale links**, **send them to customers from the venue's WhatsApp**, and see their own sales |
| `portero` (door staff) | Only `/porteria`: scan ticket QR codes → "Entrada permitida" / "Entrada denegada". No other role (not even superadmin) can validate tickets |
| `comprador` (buyer) | Buy (WhatsApp is validated), pay with MercadoPago, see and download tickets (event image + QR), transfer them |

## Data model (3rd normal form)

Migration `003` normalized the schema: every non-key attribute depends only on its table's key. Existing data is moved before the columns are dropped.

| Before (redundancy) | Dependency removed | Now |
|---|---|---|
| `usuarios.id_tenant` | A user's venue membership depends on their role | `administradores(id_usuario, id_tenant)` and `vendedores(id_vendedor, id_tenant, id_usuario, estado)` |
| `vendedores.nombre/apellido/dni/whatsapp` | Duplicated the person's data (id_vendedor → id_usuario → name…) | Only in `usuarios` (new `apellido` column) |
| `tenants.config` (JSON) | Non-atomic value (1NF) | Columns `mensaje_whatsapp`, `color_primario`, `logo_url` |
| `asientos.id_evento` | id_tipo → id_evento (transitive) | The event comes from the seat's ticket type |
| `tickets.id_tenant`, `tickets.asiento` | Derived from the event and from `id_asiento` | Computed with JOINs |
| `ventas.id_tenant` | id_evento → id_tenant | Derived from the event |
| `ventas.id_link` | id_link → id_vendedor (transitive) | `ventas_link(id_venta, id_link)` |
| `ventas.referencia_pago` | Facts about the charge, not the sale | `pagos` table (one row per attempt) |
| `ventas.whatsapp_enviado_en` | Derived from the message log | Computed from `mensajes_whatsapp` |

**Tenant linkage:**

- `eventos`, `vendedores`, `administradores`, `mercadopago_integrations` and `chatbot_integrations` carry `id_tenant` directly.
- Tickets, sales and payments reach it through foreign keys (ticket → sale → event → tenant). This avoids redundant copies.
- The models still expose `id_tenant` so controllers don't depend on the physical layout.

**Deliberate exceptions:**

- `tipos_ticket.stock_disponible` is a cached aggregate, used for row locking and to prevent overselling.
- `ventas.monto_total` records the historical price.
- `mensajes_whatsapp.id_tenant` identifies the channel that sent the message; it also exists for messages that have no sale.

### Main tables

| Table | Fields |
|---|---|
| `tenants` | id_tenant, nombre, slug, contact, mensaje_whatsapp, color_primario, logo_url, estado |
| `usuarios` | id_usuario, nombre, apellido, email (unique), dni, whatsapp, password_hash, rol |
| `administradores` | id_usuario (PK), id_tenant |
| `vendedores` | id_vendedor, id_tenant, id_usuario (unique), estado |
| `links_venta` | id_link, id_vendedor, id_evento?, codigo (unique), descripcion, activo, visitas |
| `eventos` | id_evento, id_tenant, nombre, descripcion, **imagen_evento**, fecha, lugar, limite_por_persona, tiene_seating, estado |
| `tipos_ticket` / `asientos` | ticket types and seats (seat → type → event) |
| `ventas` | id_venta, id_evento, id_vendedor?, id_usuario, fecha_venta, monto_total, estado, metodo_pago, whatsapp_contacto, token_acceso |
| `ventas_link` | id_venta, id_link |
| `tickets` | id_ticket, id_venta, id_tipo, id_usuario, codigo_qr, estado, id_asiento? |
| `pagos` | id_pago, id_venta? **xor** id_suscripcion?, proveedor, estado, monto, preference_id, referencia_externa |
| `mercadopago_integrations` | id_tenant (NULL = platform), access_token (encrypted), public_key, collector_id, webhook_secret (encrypted), modo, activo |
| `chatbot_integrations` | id_tenant, provider (`meta`/`baileys`), credentials (encrypted), estado |
| `planes` / `suscripciones` | platform plans / one subscription per tenant (estado, vence_el) |
| `mensajes_whatsapp` | log of sent messages (tickets, sale link, test) |

Spec names map to these columns: `ventas.fecha` → `fecha_venta`, `ventas.monto` → `monto_total`, `tickets.tipo` → `id_tipo`.

## MercadoPago

- **Per venue:** the admin loads *access token*, *public key* and an optional webhook secret (Admin → Integraciones).
  - Credentials are **verified** against MercadoPago (`/users/me`) and the `collector_id` is filled in automatically.
  - They are stored **encrypted**; the API never returns them in full.
- **Platform:** the superadmin loads the account used to charge subscriptions (Superadmin → Plataforma).
- **Credential selection middleware** (`middlewares/integraciones.js` → `seleccionarMercadoPago(origen)`):
  - `sesion`: the logged-in admin's venue;
  - `venta`: the venue that owns the sale being paid;
  - `plataforma`: subscriptions;
  - `webhook`: the scope in the notification URL.
- **Purchase flow:**
  1. `POST /ventas` with `metodo_pago: mercadopago`.
  2. `POST /ventas/:id/pagar` creates a Checkout Pro preference with the venue's account. `external_reference` is `venta:<id>:pago:<id>`.
  3. The buyer pays and returns to `/ventas/:id/resultado`.
  4. The **webhook** (`/api/pagos/webhook/mercadopago/:ambito`), or the verification on return, **queries the payment with the right account**. It checks reference, amount and receiving account, then approves the sale and **sends the tickets over WhatsApp**.
- **Webhook security:**
  - The `x-signature` signature is validated when the venue configured a secret.
  - The webhook never trusts the notification body; it always queries the payment.
  - It is idempotent: repeated notifications have no effect.
- **Refunds:** cancelling a sale paid through MercadoPago triggers the **real refund** in MercadoPago before the sale is marked as refunded. If the payment arrives after the reservation expired, it is refunded automatically.

## Subscriptions (superadmin)

1. Create plans (Superadmin → Plataforma) and assign one to each venue (Complejos → Suscripción).
2. Collect payment:
   - a MercadoPago link for one month, generated by the superadmin or paid by the admin from "Mi complejo";
   - or a manual payment record.
3. Each approved payment extends `vence_el` by one month from today or from the current expiry date.

## WhatsApp chatbot (Meta or Baileys)

- **Only the superadmin configures it** per venue (Complejos → 💬 WhatsApp). Admins only see its status.
- **Meta Business (WhatsApp Cloud API):**
  - phone number ID + token, verified against the Graph API;
  - optional **approved template**: the link goes in `{{1}}`. Meta only allows free text within the 24-hour window after the customer's last message.
- **Baileys (WhatsApp Web, `baileys` 7.0.0-rc14 + `libsignal` 6.0.0):**
  - the panel shows a **QR code** to scan from the venue's phone;
  - the session lives in MySQL and recovers on its own (see the next section);
  - before sending, it checks that the number has a WhatsApp account.
- **What goes out through the venue's chatbot:**
  - tickets (link to `/entrada/:token`) when a sale is paid;
  - sale links sent by sellers (`POST /vendedor/links/:id/enviar`, limited to 20 per minute);
  - test messages.
- **Fallback:** if a venue has no chatbot, `WHATSAPP_FALLBACK=console` prints the message to the backend console. `none` makes the send fail.

### Baileys: session, "Bad MAC" and automatic reconnection

**What "Bad MAC" is.** libsignal raises it when it can't decrypt an **incoming** message because the Signal session with that contact is out of sync. In this project there were three causes:

- The session was stored in loose files (`useMultiFileAuthState`, which isn't atomic).
- **Two processes could open the same session**: another server instance, or overlapping `--watch` restarts. Each process advances the ratchet on its own.
- Baileys was missing `getMessage` and the retry cache, so its native recovery couldn't complete.

**How it works now** (`services/chatbot/baileysManager.js` and `authStateMySQL.js`):

1. **Single owner per venue.** Before connecting, the process takes a MySQL lock with `GET_LOCK('integra360_baileys_<tenant>')`, held on a dedicated connection.
   - If another instance already holds it, this one doesn't connect and the status shows `en_otra_instancia`.
   - The lock's connection is pinged every 5 minutes so MySQL doesn't drop it for inactivity.
   - If a process dies, MySQL releases the lock by itself.
   - Every 2 minutes a watchdog tries to take over sessions that have no owner.
2. **Session stored in MySQL** (`baileys_auth`). Credentials and each Signal key are a row, serialized with `BufferJSON` and **encrypted** (AES-256-GCM).
   - Each batch of keys is written in a transaction.
   - If a row can't be decrypted or parsed → `SesionCorruptaError` → the session is **regenerated**.
3. **Baileys' native recovery.**
   - A `msgRetryCounterCache` that survives reconnections.
   - `getMessage` with the recently sent messages, so they can be resent when a recipient asks for a retry.
   - `enableAutoSessionRecreation` is kept on.
4. **Decryption failures.** A message that arrives undecryptable (`CIPHERTEXT` stub: "Bad MAC", "No matching sessions", "Invalid PreKey"…):
   - **deletes the Signal session for that contact** (`signalRepository.deleteSession`); WhatsApp renegotiates it on the next message;
   - increments `chatbot_integrations.errores_descifrado`;
   - if within 10 minutes there are **≥ 15 failures from ≥ 5 different contacts**, the problem is our own session: it's regenerated.
   - libsignal's `console.error` for these cases (with stack traces) is filtered, because the handling happens here.
5. **Disconnections** (`DisconnectReason`) — no manual intervention needed:

| Code | Action |
|---|---|
| `restartRequired` (515) | reconnects immediately (normal right after scanning the QR) |
| `connectionLost`/`timedOut` (408), `connectionClosed` (428), `unavailableService` (503), network down, unknown | reconnects with **exponential backoff** 2 s → 60 s (+jitter), **with no retry limit**; resets to 0 when it connects |
| `loggedOut` (401), `badSession` (500), `multideviceMismatch` (411), corrupt session | **regenerates**: deletes credentials and keys, clears caches, opens a new session and **emits a new QR** (status `esperando_qr`, reason in `ultimo_error`, counter `regeneraciones`) |
| `connectionReplaced` (440) | stops and releases the lock, with no reconnect ping-pong |
| `forbidden` (403) | stops: WhatsApp blocked the number |

6. **Server startup and shutdown.**
   - On startup it reconnects the venues that have a session in the database.
   - Sessions in the old format (`sessions/tenant_<id>/`) aren't imported: they were the source of the out-of-sync keys. They're archived as `tenant_<id>.legacy-<fecha>` and the venue is asked to scan a new QR.
   - `SIGINT`/`SIGTERM` close the sockets and release the locks.

**The only step that needs a person** is scanning the QR again after a regeneration. WhatsApp requires the phone to authorize new credentials. The superadmin panel shows the new QR, the reason and the counters.

**Diagnostics:** `BAILEYS_LOG_LEVEL=warn` (or `debug`) shows the internal Baileys log. The console always shows lines like `[baileys:<tenant>] conexión cerrada (408) → reconectar_backoff`.

## Tickets with event image

- The admin uploads the event image (JPG/PNG/WEBP, up to 3 MB). The server validates that it really is an image, strips metadata, and normalizes it to JPG up to 1600 px under `uploads/eventos/`.
- Each ticket is **composed on the server** (sharp) as a PNG containing:
  - the event image as a banner;
  - the QR with a thumbnail of the image in the center (error correction H, verified to remain readable);
  - event, date, type, seat and ticket holder.
- The image is available from `/entrada/:token` (public link sent over WhatsApp, downloadable) and from "Mis tickets".

## Endpoints added in this version

| | Route | Who | |
|---|---|---|---|
| GET/PUT/DELETE | `/integraciones/mercadopago` | admin | the venue's MercadoPago account |
| POST | `/integraciones/mercadopago/probar` | admin | test credentials |
| GET/PUT | `/integraciones/plataforma/mercadopago` (+`/probar`) | superadmin | platform account |
| GET | `/integraciones/chatbot/estado` | admin | WhatsApp status (read-only) |
| GET/PUT/DELETE | `/integraciones/chatbot/:idTenant` | superadmin | `{provider: 'meta'\|'baileys', credentials}` |
| POST | `/integraciones/chatbot/:idTenant/probar` | superadmin | test message |
| POST/GET/POST | `/integraciones/chatbot/:idTenant/baileys/{conectar,estado,desconectar}` | superadmin | link via QR |
| POST | `/pagos/webhook/mercadopago/:ambito` | MercadoPago | `ambito` = id_tenant or `plataforma` |
| GET | `/ventas/:id/verificar-pago?payment_id=` | buyer | confirms the payment on return from MercadoPago |
| POST | `/vendedor/links/:id/enviar` | seller | `{whatsapp, mensaje?}` over the venue's chatbot |
| POST/DELETE | `/eventos/:id/imagen` | admin | multipart field `imagen` |
| GET | `/tickets/:id/imagen` | holder | ticket PNG (event + QR) |
| GET | `/publico/entradas/:token/tickets/:id.png` | public (token) | ticket PNG |
| GET/POST/PUT | `/suscripciones/planes[/:id]` | superadmin | plans |
| GET/PUT | `/suscripciones/tenant/:idTenant` | superadmin | view / assign plan |
| POST | `/suscripciones/tenant/:idTenant/{cobrar,registrar-pago,cancelar}` | superadmin | MercadoPago link / manual payment |
| GET/POST | `/suscripciones/mia` · `/suscripciones/mia/pagar` | admin | own subscription / pay a month |

`GET /eventos/:id` now also returns `metodos_pago`: MercadoPago appears only if the venue has it configured.

The endpoints from earlier versions (auth, tenants, events, sales, tickets, sellers, access) are unchanged.

## Structure

```
backend/src/
  middlewares/  auth · tenant · integraciones (MercadoPago credentials / chatbot per tenant) · validarCompra · subidaImagen
  services/     mercadopagoService · pagosService · notificaciones · ticketImagen · chatbot/{index, metaProvider, baileysManager}
  models/       Tenant · Usuario · Vendedor · LinkVenta · Evento · TipoTicket · Asiento · Venta · Ticket · Pago · Integracion · Suscripcion · …
  controllers/  … · pagos · integraciones · suscripciones
  utils/        crypto (AES-256-GCM) · qr · whatsapp · pagos (simulated gateway)
frontend/src/pages/
  admin/AdminIntegraciones · super/{SuperPlataforma, ChatbotModal, SuscripcionModal} · PagoResultado · Entrada · …
```

## Verification

This version was verified against a mock of the MercadoPago and Meta APIs, on a second backend instance:

- **API:** 161 end-to-end checks.
  - Normalization, encryption, MercadoPago flow (signatures, idempotency, wrong amount, refund, late payment), subscriptions, Meta and Baileys (real QR), images (the QR inside the image is decoded), per-tenant isolation.
  - Baileys (23 checks): MySQL storage, corruption detection, lock between processes, "Bad MAC" per contact and in bulk, disconnections and regeneration against the real WhatsApp servers.
  - The multi-tenant and regression suites from earlier versions.
- **Interface:** 43 checks in **Microsoft Edge** (Playwright) that go through the forms for each role.
  - Registration and live WhatsApp validation; login by role.
  - MercadoPago and chatbot configuration; image upload.
  - Seller CRUD with duplicates; sending links from the bot.
  - Purchase from a link → MercadoPago → tickets; subscription.
  - No console errors and no 5xx responses.
- **Fixes that came out of the interface tests:**
  - form labels not linked to their fields (accessibility);
  - a 500 error when linking Baileys (the socket was being serialized);
  - two buttons with the same accessible name "Cerrar";
  - a stray "0" on the purchase page;
  - zero totals shown as "Gratis";
  - success notices shown before the data was reloaded.
