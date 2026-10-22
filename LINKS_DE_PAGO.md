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

## Link de checkout del complejo (`/checkout/:linkId`)

Es la opción por defecto del vendedor, en **Link de pago → «Link para el cliente»**. La otra opción, «Cargar la compra», es el flujo en el que el vendedor carga los datos del cliente.

1. **El vendedor genera el link.** `POST /api/links/generar`, sin `comprador`:
   ```json
   { "id_evento": 3, "id_tipo": 7, "cantidad": 2, "descripcion": "opcional" }
   ```
   Todos los campos son opcionales. Responde `201`:
   ```json
   { "link_id": "qWtZBdSAm5", "url": "https://<frontend>/checkout/qWtZBdSAm5", … }
   ```
   - `linkId` es el código del link de venta del vendedor (`links_venta`). Identifica al vendedor y, por lo tanto, a su complejo (`tenant_id`).
   - El link puede fijar el producto: evento, tipo de entrada y cantidad (migración 011). Si fija tipo y cantidad, el comprador no los puede cambiar y el backend los impone aunque se manden otros.
   - No reserva nada y se puede usar muchas veces.
2. **El comprador abre `/checkout/:linkId`.** Ve el **logo, el nombre y la dirección del complejo**, quién lo atiende, el evento y las entradas, y el formulario (nombre y apellido, email, teléfono). Los datos salen de `GET /api/publico/checkout/:linkId`. El logo se carga en **Mi complejo → Logo**.
3. **Comprar.** `POST /api/pagos/crear`:
   ```json
   { "link_id": "…", "id_evento": 3, "items": [{ "id_tipo": 7, "cantidad": 2 }],
     "comprador": { "nombre": "…", "email": "…", "telefono": "…" } }
   ```
   - El backend toma complejo y vendedor del link: un `tenant_id` o `seller_id` distinto se rechaza con 403.
   - Valida la compra, reserva por 30 min y crea la preferencia con el **access token OAuth del complejo**, renovándolo si hace falta.
   - Devuelve el `init_point` y el frontend hace `window.location.href = init_point`.
4. **Pago y estado:**
   - si se aprueba, vuelve a la página de la reserva con las entradas;
   - si se rechaza, vuelve a `/checkout/:linkId?pago=rechazado` para reintentar;
   - el webhook único (`/api/pagos/webhook`) actualiza `reservations`: `approved`, `pending` o `rejected`.

Pruebas (37 verificaciones en Edge):

- **El vendedor genera el link:** página del complejo con nombre, dirección y vendedor.
- **Compra:** el formulario redirige al checkout de MercadoPago del complejo, con los datos del comprador en la preferencia.
- **Resultado:** si se aprueba, entradas y `approved`; si se rechaza, vuelve al checkout con un aviso y la reserva queda `pending`.
- **Webhook:** marca `approved` y `rejected`.
- **Producto fijo:** se impone aunque se manden otros items, y se rechazan otro tipo u otra cantidad.
- **Aislamiento:** el link de Luna muestra Boliche Luna y cobra en su cuenta. Un pago notificado con la cuenta equivocada no se acredita, y un link de Norte no vende eventos de Luna.
- **Link pausado:** la página muestra «Link no disponible» y `/api/pagos/crear` responde 409.
- **Token:** si está por vencer se renueva con el refresh token, y si fue revocado se renueva y se reintenta.
- **Diseño:** móvil en claro y oscuro.

## Links de venta del administrador (`/venta/:linkId`)

El admin genera en **Ventas → Links de venta** un link para compartir en redes. Cada link vende un tipo de entrada, con precio y **stock propios**.

| Modalidad | Comportamiento |
|---|---|
| **Reutilizable** | el comprador elige la cantidad (máx. 50 por compra). Se vende hasta que `stock_disponible` llega a 0 |
| **Único** (`reutilizable = false`) | una sola compra de `stock_total` entradas. La primera venta aprobada lo deja en 0 y queda inválido |

**El stock del link se descuenta sólo cuando MercadoPago aprueba el pago**, dentro de la misma transacción que aprueba la venta (`SalesLink.descontarPorVenta`, llamado desde `pagosService.procesarPagoMercadoPago`). Ese camino lo usan el webhook único, el webhook por complejo y la verificación al volver del checkout.

- Si dos compradores pagan por el último cupo, la segunda aprobación no encuentra stock: su venta se cancela y el pago se **reembolsa automáticamente**. Así nunca se sobrevende.
- `ventas_sales_link.stock_descontado` hace que una notificación repetida no descuente dos veces.
- El stock del **evento** (`tipos_ticket`) se sigue reservando 30 min al crear la preferencia, como en el resto del sistema. Si el pago no llega, la reserva vence y lo devuelve.

### API

```http
POST  /api/ventas/link             (admin) { id_tipo, stock_total, reutilizable?, precio?, producto?, tenant_id? }
      → 201 { id, url: "https://<frontend>/venta/<id>", stock_total, stock_disponible, reutilizable, … }
GET   /api/ventas/link             (admin) links del complejo con stock, ventas aprobadas y pendientes
PATCH /api/ventas/link/:id         (admin) { activo }  pausar / reactivar
GET   /api/ventas/link/:id/tickets (admin) compras del link: buyer_name, buyer_email, estado
GET   /api/publico/venta/:linkId   datos de la página (complejo, producto, stock, disponible / motivo)
POST  /api/ventas/checkout         { linkId, cantidad?, comprador: { nombre, email, telefono } } → 201 { init_point }
```

- `tenant_id` sale del JWT (admin) o del link (checkout). Si se envía uno distinto, se responde 403.
- La preferencia se crea con el access token OAuth **del complejo dueño del link**. Si está por vencer, antes se renueva con el `refresh_token`, y ante un 401 se renueva y se reintenta.
- `back_urls`:
  - aprobado o pendiente → `/entrada/:token`;
  - rechazado → `/venta/:linkId?pago=rechazado`.
- Errores del checkout:
  - link pausado, agotado o ya usado → 409;
  - cantidad mayor al stock restante → 409.

### Modelo de datos (migración 013)

| Pedido | Implementación |
|---|---|
| `sales_links` (id, tenant_id, producto, precio, stock_total, stock_disponible, reutilizable) | tabla `sales_links`, más `id_tipo` (qué entrada se emite), `activo`, `creado_por` |
| `tickets` (id, link_id, tenant_id, buyer_name, buyer_email, estado) | vista **`sales_link_tickets`** sobre `ventas` + `pagos` + `ventas_sales_link`. `estado`: `approved`, `pending`, `rejected`, `cancelled`, `refunded` |

Los tickets reales con QR siguen en `tickets`, y la Portería los valida igual que siempre.

### Pruebas

`cd backend && npm test` corre 7 pruebas de integración contra MySQL. Usan una base aparte (`DB_NAME_TEST`, por defecto `<DB_NAME>_test`) que se recrea con `migrate --fresh` + `seed`, y simulan MercadoPago a nivel de servicio:

- **Link único:** admite una sola venta aprobada; la segunda se reembolsa y el link queda inválido.
- **Link reutilizable:**
  - vende hasta agotar el stock;
  - un pago por más del stock restante se reembolsa;
  - `rejected` y `pending` no descuentan;
  - una notificación repetida no descuenta dos veces.
- **Stock:** crear la preferencia no lo descuenta.
- **Cuenta correcta:** la preferencia usa el token del complejo dueño del link. Un pago notificado con la cuenta del otro complejo se ignora.
- **Webhook por complejo:** actualiza la vista `sales_link_tickets`, el stock y emite los tickets.
- **Token por vencer:** se renueva con el `refresh_token`.
- **Link pausado:** la página lo informa y el checkout se rechaza. Otro complejo no puede modificar el link.

## Stock uniforme por evento (migración 014)

**Las ventas con MercadoPago descuentan el stock del evento sólo cuando el pago se aprueba**, en todos los canales. Crear la preferencia no descuenta nada; el descuento lo hace `pagosService.confirmarStockDeVenta` dentro de la transacción del webhook (o de la vuelta del comprador):

1. Bloquea los tipos de entrada y verifica que alcance el stock (y el cupo del link del complejo, si la venta viene de uno).
2. Si alcanza, descuenta todo junto, marca `ventas.stock_descontado = 1` y recalcula el estado del evento (`agotado` en 0).
3. Si no alcanza (otra compra aprobada se llevó las últimas entradas), no descuenta nada: cancela la venta y **reembolsa** el pago. Nunca se sobrevende.

| Venta | ¿Cuándo descuenta stock? |
|---|---|
| MercadoPago (directa, vendedor, link del complejo, comprador con cuenta) | al aprobarse el pago |
| Efectivo / transferencia (cobro manual) | al reservar: el admin confirma el cobro después |
| Cortesías, emisión corporativa e invitaciones | al emitir |

- Una venta de MercadoPago pendiente no retiene stock. Si vence o se rechaza, no hay nada que devolver.
- Los asientos numerados sí se retienen durante la reserva (30 min), para que dos personas no paguen la misma butaca.
- Con stock 0, cualquier canal responde 409. Vista **`events`**: stock del evento = suma de sus tipos a la venta.

### Checkout único: `POST /api/ventas/checkout`

| Canal | Cuerpo |
|---|---|
| Venta directa (página del evento o panel del admin) | `{ event_id, items: [{ id_tipo, cantidad }], comprador }` |
| Link de vendedor | `{ codigo_link \| link_id, items?, comprador }` |
| Link del complejo | `{ linkId, cantidad?, comprador }` |

`comprador = { nombre, email, telefono }`. Responde `201 { init_point, id_venta, monto_total, cantidad, canal }`. Los tres comparten el núcleo: validación de la compra, reserva sin descontar stock y preferencia con el token del complejo dueño del evento. `POST /api/pagos/crear` queda como alias del link de vendedor.

### Administración de eventos (`/admin/eventos`)

```http
GET  /api/admin/event/:id          evento + tipos + stock total + últimos 20 cambios auditados
POST /api/admin/event/:id/update   { nombre?, fecha?, lugar?, descripcion?, limite_por_persona?,
                                     agregar_stock?: [{ id_tipo, cantidad }] }   (también PUT)
```

- **Agregar entradas** suma a `stock_total` y `stock_disponible` (cantidad entre 1 y 100000). Nunca resta: lo vendido no se toca, y la edición del tipo no deja bajar el cupo por debajo de lo vendido.
- Todo ocurre en una transacción con filas bloqueadas y ajustes relativos: un pago aprobado al mismo tiempo no se pisa.
- Si el evento estaba agotado, vuelve a `publicado` y se avisa a la lista de espera.
- No se edita un evento cancelado o finalizado, y la fecha nueva debe ser futura.
- **Auditoría:** cada cambio queda en `auditoria_eventos` con quién, cuándo y los valores antes / después. El panel lo muestra en **Historial de cambios**.
- En el panel: botón **+ Entradas** por tipo, resumen de stock (disponibles / vendidas / cupo) y **Cobrar con MercadoPago**, que es la venta directa: el admin carga al comprador y obtiene el link de pago.

### Pruebas (4 nuevas, 15 en total)

- **Tres canales** (directa, vendedor, link del complejo) por `/api/ventas/checkout`: crear la preferencia no descuenta; el pago aprobado descuenta exactamente lo comprado. La página pública del evento ve el mismo stock al instante, y el alias `/api/pagos/crear` pasa por el mismo checkout.
- **Rechazos y vencimientos:** un pago rechazado y una reserva vencida no cambian el stock.
- **Agotamiento:** con 3 entradas, dos compras de 2 se aceptan; la primera aprobada descuenta y la segunda se reembolsa. Al llegar a 0 el evento queda `agotado` y los tres canales responden 409.
- **Admin:**
  - comprador → 403, otro complejo → 404;
  - cantidad negativa, tipo de otro evento o fecha pasada → 400;
  - edita nombre y lugar, agrega 10 entradas, el evento vuelve a `publicado` y quedan las dos entradas de auditoría;
  - las entradas nuevas se venden;
  - no se puede bajar el cupo por debajo de lo vendido.
