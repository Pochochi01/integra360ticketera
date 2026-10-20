# MercadoPago con OAuth (multi-tenant)

Cada complejo cobra sus entradas en **su propia cuenta** de MercadoPago, y la plataforma cobra las
suscripciones en **la suya**. Las cuentas se vinculan con el botón **«Conectar con MercadoPago»**.
Nadie pega access tokens: el sistema guarda `access_token` y `refresh_token` cifrados y los renueva solo.

## 1. Registrar la aplicación (una sola vez, la plataforma)

1. En [MercadoPago Developers → Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app), crear una aplicación de tipo **Checkout Pro / pagos online**.
2. En **Detalles de aplicación → URLs de redireccionamiento**, cargar exactamente:
   `https://TU_DOMINIO/api/auth/mercadopago/callback`
3. En **Webhooks**, configurar la URL de notificaciones de *Pagos*: `https://TU_DOMINIO/api/pagos/webhook`
   (URL única: identifica el complejo por el `user_id` de la notificación).
   Cada cobro envía su propia `notification_url` a la cuenta que corresponde. Copiar la **Clave secreta**.
4. Copiar **Client ID** y **Client Secret** al `.env` del backend:

```env
MP_CLIENT_ID=1234567890123456
MP_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxx
MP_REDIRECT_URI=https://TU_DOMINIO/api/auth/mercadopago/callback   # igual a la registrada
MP_WEBHOOK_SECRET=clave-secreta-de-webhooks
MP_PKCE=false            # true sólo si se activó PKCE en la aplicación
MP_TEST_TOKEN=false      # true = credenciales de prueba (sandbox) al vincular
MP_RENOVAR_ANTES_DIAS=7
```

## 2. Vincular cuentas

| Quién | Dónde | Cuenta | Cobra |
|---|---|---|---|
| Admin de cada complejo | **Integraciones** → «Conectar con MercadoPago» | la del complejo (`tipo = tenant`) | entradas |
| Superadmin | **Plataforma** → «Conectar con MercadoPago» | la de la plataforma (`tipo = admin`, fila única) | suscripciones |

El panel muestra:

- el estado (Conectado / Pausado / Requiere reconexión);
- el **correo vinculado**, el usuario de MercadoPago y el modo (producción o prueba);
- la fecha de conexión y hasta cuándo vale el acceso.

El panel también permite:

- probar la conexión;
- pausar los cobros sin desvincular la cuenta (sólo para complejos);
- desconectar.

El mensaje de éxito o error aparece al volver de MercadoPago, por ejemplo si el usuario canceló, si el enlace venció o si MercadoPago rechazó la autorización.

## 3. Flujo

```
Panel ──GET /api/auth/mercadopago/connect (JWT)──▶ backend crea "state" de un solo uso (+PKCE) ──▶ { url }
  └─▶ auth.mercadopago.com/authorization?client_id&response_type=code&platform_id=mp&state&redirect_uri
        └─▶ el titular inicia sesión y autoriza
              └─▶ GET /api/auth/mercadopago/callback?code&state
                    ├─ valida y consume el state (vence a los 10 min, no se reutiliza → anti-CSRF)
                    ├─ POST /oauth/token  grant_type=authorization_code  → access_token + refresh_token
                    ├─ GET /users/me → correo vinculado
                    └─ guarda cifrado en mercadopago_tokens y redirige al panel (?mp=conectado | ?mp=error)
```

| Endpoint | Acceso | Uso |
|---|---|---|
| `GET /api/auth/mercadopago/connect` | admin del complejo | URL de autorización para la cuenta del complejo |
| `GET /api/auth/mercadopago/connect/plataforma` | superadmin | URL de autorización para la cuenta de la plataforma |
| `GET /api/auth/mercadopago/callback` | público (lo llama MercadoPago) | canje del código y guardado |
| `GET/PUT/DELETE /api/integraciones/mercadopago`, `POST …/probar` | admin | estado, pausar, desconectar y probar |
| `GET/DELETE /api/integraciones/plataforma/mercadopago`, `POST …/probar` | superadmin | ídem para la plataforma |
| `POST /api/ventas/:id/pagar` | comprador | cobro de entradas con la cuenta **del complejo** |
| `POST /api/suscripciones/mia/pagar`, `POST /api/suscripciones/tenant/:id/cobrar` | admin / superadmin | cobro de suscripción con la cuenta **de la plataforma** |

`connect` devuelve `{ url }` en lugar de redirigir, porque el JWT vive en el navegador y una redirección directa no lo llevaría. Con `?redirect=1` responde con un 302.

## 4. Renovación de tokens

El access token dura 180 días. `services/mercadopagoTokens.js` se encarga de que siempre haya uno vigente:

- **Antes de cada cobro:** `credencialesValidas()` renueva el token con `grant_type=refresh_token` si le quedan menos de `MP_RENOVAR_ANTES_DIAS`. El middleware `seleccionarMercadoPago` lo inyecta en `req.mercadopago`.
- **Si MercadoPago responde 401:** `conCredenciales()` renueva una vez y reintenta, sin que el usuario lo note. Pasa cuando el token se invalidó antes de tiempo.
- **Tarea periódica:** el servidor renueva al iniciar y cada 6 horas los tokens que están por vencer, aunque nadie cobre.
- **Renovaciones simultáneas:** MercadoPago **rota** el refresh token en cada renovación, así que dos renovaciones a la vez romperían la conexión. Se serializan con `GET_LOCK` de MySQL por cuenta, lo que también funciona con varias instancias del backend.
- **Si MercadoPago rechaza la renovación** (`invalid_grant`: el titular revocó el permiso), la cuenta queda en **«Requiere reconexión»**. El panel muestra el botón «Reconectar» y MercadoPago deja de ofrecerse a los compradores de ese complejo. Los demás complejos no se ven afectados.

## 5. Base de datos (migración 007)

- `mercadopago_tokens` tiene:
  - las columnas `id_tenant`, `tipo` (`tenant` | `admin`), `access_token` y `refresh_token` (cifrados con AES-256-GCM), `expires_in`, `expira_en`, `correo_vinculado`, `mp_user_id`, `public_key`, `live_mode`, `activo`, `estado`, `renovado_en`;
  - una fila por ámbito: `ambito = IFNULL(id_tenant, 0)` es UNIQUE;
  - un `CHECK` que asegura que la fila `admin` no tiene complejo y que cada fila `tenant` sí lo tiene;
  - una FK a `tenants`.
- `mercadopago_oauth_estados` guarda los `state` pendientes, que son de un solo uso, y el `code_verifier` de PKCE, que nunca viaja al navegador.
- **Se eliminó `mercadopago_integrations`** (los tokens pegados a mano no tienen refresh token). Después de migrar, cada complejo y la plataforma tienen que **volver a conectar** su cuenta una vez.

## 6. Pruebas

Se probó con un mock de MercadoPago que implementa la pantalla de autorización, `/oauth/token` con rotación de refresh tokens, `/users/me`, Checkout Pro y `/v1/payments`. Para usarlo, apuntá `MERCADOPAGO_API_URL` y `MP_AUTH_URL` al mock. Pasaron 40 verificaciones en Edge:

- **Conexión:** botón → autorización → callback → tokens guardados cifrados → correo en el panel. Cancelar en MercadoPago muestra un mensaje claro.
- **Seguridad:** un `state` reutilizado o inventado se rechaza, `connect` exige JWT y la API nunca devuelve los tokens.
- **Aislamiento:** dos complejos con cuentas distintas no se pisan, y la plataforma tiene su fila `admin`.
- **Pagos:** una compra de entradas crea la preferencia con el token del complejo y se verifica el pago.
- **Renovación:**
  - con el token por vencer, 5 pedidos simultáneos producen **una sola** renovación y el refresh token se rota y se guarda;
  - un access token revocado (401) se renueva y la llamada se reintenta;
  - la tarea periódica renueva los tokens por vencer.
- **Reconexión:** si se rechaza el refresh token, el complejo queda en «Requiere reconexión» y los demás siguen funcionando.
- **Suscripciones:** el cobro de una suscripción sale con la cuenta de la plataforma.
- **Webhooks:** una firma inválida devuelve 401 y una válida, 200.
- **Diseño:** móvil en claro y oscuro sin scroll horizontal.

**Pendiente:** probar en sandbox con una aplicación real de MercadoPago (`MP_TEST_TOKEN=true` y usuarios de prueba) antes de pasar a producción.
