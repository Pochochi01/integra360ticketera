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
