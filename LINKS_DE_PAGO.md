# Links de pago de vendedores (MercadoPago o efectivo)

El vendedor arma la compra de un cliente (evento, entradas y datos del comprador), elige cómo va a pagar y
recibe un link para enviarle:

| Modalidad | Cuándo está disponible | Qué devuelve | Tickets |
|---|---|---|---|
| **MercadoPago** (por defecto) | el complejo tiene MercadoPago conectado (OAuth) | `init_point` de Checkout Pro, con el token **del complejo** | se validan solos cuando se acredita el pago |
| **Efectivo** | el admin lo habilitó en **Mi complejo** | link interno de la reserva (`/entrada/:token`) | `validado = false` hasta que el admin confirma el cobro |

## Configuración del complejo

En **Mi complejo**, el interruptor **«Pago en efectivo para vendedores»** guarda `tenants.efectivo_habilitado` para ese complejo. Viene apagado por defecto.

## API

```http
POST /api/links/generar            (JWT de vendedor)
{ "tipo_pago": "mercadopago" | "efectivo",     // opcional, por defecto mercadopago
  "id_evento": 3,
  "items": [{ "id_tipo": 7, "cantidad": 2 }],
  "comprador": { "nombre": "Pedro Gómez", "whatsapp": "11 4444 3333", "email": "opcional" },
  "tenant_id": 1, "seller_id": 4 }             // opcionales: si se envían deben ser los de la sesión
```

Respuesta `201`:

- **MercadoPago:**
  ```json
  { "tipo_pago": "mercadopago", "url": "<init_point>", "mensaje": "Link de MercadoPago generado", "venta": {…}, "tickets": [{ "validado": false, … }] }
  ```
- **Efectivo:**
  ```json
  { "tipo_pago": "efectivo", "url": "https://…/entrada/<token>", "mensaje": "Link de pago en efectivo generado (pendiente de validación)", … }
  ```

Reglas:

- **Complejo y vendedor:** `tenant_id` y `seller_id` salen siempre del JWT. Si el cuerpo trae otros, se responde 403.
- **Compra:** se valida igual que una compra del público: evento publicado del complejo del vendedor, stock, ventana de venta y límite por persona.
- **Medio no disponible:**
  - efectivo no habilitado → 403;
  - MercadoPago no conectado → 409, con un mensaje claro.

  Nunca se usa la cuenta de otro complejo.
- **Comprador:** se busca por email o WhatsApp entre los compradores, y si no existe se da de alta. Accede a sus entradas con el link privado de la reserva, sin contraseña.
- **Reserva:** dura 24 h con MercadoPago y 72 h en efectivo, configurables con `LINK_MP_RESERVA_HORAS` y `EFECTIVO_RESERVA_HORAS`, y nunca pasa del inicio del evento.
  - La preferencia de MercadoPago vence al mismo tiempo que la reserva.
  - Una reserva vencida se cancela y devuelve el stock.
- **Vuelta del pago:** al pagar, el comprador vuelve a `/entrada/:token`. El servidor consulta el pago a MercadoPago con el token del complejo (`GET /api/publico/entradas/:token/verificar-pago`) y lo acredita, sin depender del webhook.

`GET /api/links` lista los links de pago del vendedor con su estado.

## Validación de los tickets en efectivo

En **Ventas**, el admin ve **«Pendientes de pago en efectivo»**: cada reserva con su comprador, vendedor, monto y vencimiento.

- **Validar cobro** (`POST /api/ventas/:id/validar-efectivo`):
  - el pago en efectivo pasa a aprobado;
  - los tickets pasan de `pendiente` a `valido` (`validado = true`);
  - se le envían las entradas al comprador por WhatsApp;
  - queda registrado quién validó y cuándo (`pagos.id_validador`, `pagos.validado_en`).
- **Cancelar:** libera las entradas.
- **Mientras no se valida:** la **Portería rechaza** esos tickets («Pago en efectivo pendiente: el complejo todavía no validó la entrada») y no los marca como usados.

## Modelo de datos (migración 008)

| Pedido | Implementación (3FN, sin duplicar datos) |
|---|---|
| `complexes.efectivo_habilitado` | `tenants.efectivo_habilitado` |
| tabla `reservations` | `ventas`: una venta pendiente ya es la reserva, la que retiene el stock. `ventas.expira_en` guarda su vencimiento |
| `reservations.tipo_pago` | `ventas.metodo_pago`, que ahora incluye `'efectivo'` |
| `validado` | se deduce de `tickets.estado` (`pendiente` = no validado, `valido`/`usado` = validado). La vista **`reservas`** lo expone como columna `validado` |
| auditoría | `pagos` con `proveedor = 'efectivo'`, `id_validador` y `validado_en` |

## Pruebas

38 verificaciones end-to-end en Edge, con un simulador de MercadoPago (OAuth + checkout):

- **Por defecto:** el link es de MercadoPago y se crea con la cuenta del complejo, con vencimiento de reserva.
- **Pago:** el comprador paga sin iniciar sesión, vuelve a su reserva y el pago se acredita en la cuenta del complejo.
- **Efectivo deshabilitado:** el vendedor no puede elegirlo (en la UI aparece deshabilitado y la API responde 403).
- **Efectivo habilitado:**
  - el vendedor lo elige y ve el mensaje «pendiente de validación»;
  - la reserva queda por 72 h con los tickets en `validado = false`;
  - el comprador ve la reserva pendiente, sin QR.
- **Portería:** rechaza los tickets en efectivo sin validar. Después de «Validar cobro», el mismo QR da «Entrada permitida» y queda registrado qué admin validó.
- **Aislamiento:** un vendedor de otro complejo no puede vender eventos ajenos, y un complejo sin MercadoPago recibe un mensaje claro.
- **Al deshabilitar el efectivo:** el vendedor ya no puede generarlo.
- **Vencimiento:** una reserva vencida se cancela y devuelve el stock.
- **Diseño:** móvil en claro y oscuro sin scroll horizontal.

## Compra del cliente desde el link del vendedor (sin cuenta)

1. El vendedor comparte su link de venta (`/v/<código>`).
2. El cliente elige las entradas y completa **nombre y apellido, email y teléfono (WhatsApp)**, sin crear cuenta. Al tocar **Comprar**, el frontend llama a `POST /api/links/generar` con el `codigo_link`.
3. El backend identifica al vendedor y a **su** complejo a partir del link, nunca de `tenant_id` ni `seller_id` del cuerpo; si se envían y no coinciden, responde 403.
4. Crea la preferencia con el access token OAuth de ese complejo, renovándolo antes si hace falta. La preferencia lleva:
   - `payer` (name, surname, email, phone);
   - `back_urls` a la página de la reserva;
   - la `notification_url` del complejo.
5. El frontend redirige con `window.location.href = init_point`.

Reglas del modo público:

- sólo MercadoPago;
- email obligatorio;
- reserva de 30 min (`LINK_COMPRADOR_RESERVA_MIN`);
- como máximo 15 pedidos cada 10 min por IP (`LINK_PUBLICO_MAX_POR_IP`);
- la venta queda atribuida al link del vendedor.

Con email, el comprador se identifica sólo por email: dos personas pueden compartir un teléfono.

## Webhook único

`POST /api/pagos/webhook` es la URL para cargar en **Webhooks** de la aplicación de MercadoPago. Identifica el complejo por el `user_id` de la notificación, que es la cuenta de MercadoPago que recibió el pago.

- **Verificaciones:** valida la firma (`MP_WEBHOOK_SECRET`) y consulta el pago con el token de esa cuenta.
- **Pago de otra cuenta:** si se notifica con la cuenta equivocada, se ignora y no se acredita.
- **Ruta por complejo:** cada preferencia además envía su propia `notification_url`, `/api/pagos/webhook/mercadopago/<id del complejo>`.

Vista **`reservations`** (migración 010), sobre `ventas` + `pagos`:

| columna | origen |
|---|---|
| `id`, `tenant_id`, `seller_id` | venta, evento, vendedor |
| `buyer_name`, `buyer_email`, `buyer_phone` | comprador |
| `tipo_pago` | `ventas.metodo_pago` |
| `estado` | `approved` (pagada), `pending`, `rejected` (último intento rechazado; la reserva sigue abierta), `cancelled`, `refunded` |

Pruebas (35 verificaciones en Edge):

- **Compra:** el link del vendedor muestra el formulario y sólo MercadoPago, y redirige al `init_point` del complejo correcto. La preferencia lleva los datos del comprador y las `back_urls` del frontend.
- **Webhook único:**
  - `approved` cuando el comprador cierra la pestaña sin volver;
  - `rejected` con un pago rechazado y `pending` con uno en proceso;
  - firma inválida → 401; cuenta desconocida → ignorado.
- **Aislamiento:** Norte y Luna cobran cada una en su cuenta. Un pago notificado con la cuenta equivocada no se acredita, y un link de Norte no vende eventos de Luna.
- **Validaciones:** el `tenant_id` y el `seller_id` del cuerpo se rechazan si no coinciden; desde el link no se puede elegir efectivo; el email es obligatorio; un link inexistente o un pedido sin sesión ni link se rechazan.
- **Token:** si está por vencer se renueva con el refresh token, y si fue revocado (401) se renueva y se reintenta.
- **Diseño:** móvil en claro y oscuro.
