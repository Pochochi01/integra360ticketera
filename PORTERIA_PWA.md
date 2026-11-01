# PWA, porteros y Portería (lector QR)

La app se instala en el celular o la computadora como una aplicación propia (PWA). Incluye la
**Portería**: abre la cámara, lee el QR de cada entrada y la marca como ingresada.

## Qué incluye

| Pieza | Archivo |
|---|---|
| Manifest (`display: standalone`, íconos 72–512 px y *maskable*, acceso directo a Portería) | `frontend/public/manifest.json`, `frontend/public/icons/` |
| Service Worker (caché y modo sin conexión) | `frontend/public/service-worker.js` |
| Registro del SW, botón «Instalar app» y aviso de versión nueva | `frontend/src/pwa.js`, `frontend/src/components/AvisoActualizacion.jsx` |
| Lector QR (`getUserMedia` + `jsQR`) | `frontend/src/components/porteria/PorteriaQRReader.jsx` |
| Pantalla `/porteria` (sólo rol portero, con «Cerrar sesión») | `frontend/src/pages/Porteria.jsx` |
| Gestión de porteros del admin (`/admin/porteros`) | `frontend/src/pages/admin/AdminPorteros.jsx` |
| CRUD `/api/porteros` (admin) | `backend/src/controllers/porterosController.js`, `backend/src/models/Portero.js`, `backend/src/utils/credenciales.js` |
| Middleware `soloPortero` (JWT + rol portero + portero activo) | `backend/src/middlewares/tenant.js` y `exigirRol` en `backend/src/middlewares/auth.js` |
| API `POST /api/porteria/validarQR` (alias `/validar`) | `backend/src/routes/porteria.js`, `backend/src/services/validacionAcceso.js` |
| Tabla `porteros` y vista `eventos_inscripciones` | `backend/database/migrations/006_porteros.sql` |
| Vista `entradas` (`qr_code`, `estado`, `fecha_ingreso`) | `backend/database/migrations/005_porteria_entradas.sql` |

## Rol portero

- **Creación:** el admin del complejo entra en **Porteros**, carga nombre y apellido opcional, y el sistema genera:
  - el usuario, único: `<complejo>.<nombre>`, por ejemplo `norte.jose.maria.pena`, con un número al final si se repite;
  - una contraseña aleatoria de 10 caracteres, sin letras ni números que se confunden.
- **Contraseña:** se muestra una sola vez; en la base sólo queda el hash bcrypt. Si se pierde, el botón «Contraseña» genera una nueva y la anterior deja de funcionar.
- **Ingreso:** en *Ingresar*, el campo «Email o usuario» acepta el usuario generado, y el portero va directo a `/porteria`. No ve ninguna otra sección.
- **Acceso exclusivo:** `/api/porteria/*` exige JWT válido, rol `portero` (sin la excepción habitual del superadmin) y portero **activo** del complejo.
  - El estado activo se consulta en cada petición: desactivar a un portero lo deja afuera al instante, aunque su sesión siga abierta.
  - El admin y el superadmin reciben 403, y el frontend los redirige.
- **Eliminar:** sólo si el portero nunca registró lecturas; si ya trabajó, se desactiva para conservar el historial.
- **Modelo (3FN, igual que vendedores y administradores):**
  - `usuarios` guarda la persona y su contraseña (`rol = 'portero'`, sin email);
  - `porteros(id_portero, id_tenant, id_usuario, usuario, estado)` guarda la pertenencia al complejo. Los complejos son la tabla `tenants`.
- **Inscripciones:** cada ticket emitido es una inscripción al evento. `eventos_inscripciones` es una vista sobre `tickets`, así que el QR se valida contra los datos reales sin duplicarlos.

### Caché del Service Worker

- **Páginas:** red primero. Sin conexión se abre la última versión guardada y se mantiene la sesión.
- **JS, CSS e íconos:** se guardan una vez, porque cada build les cambia el nombre.
- **Imágenes de eventos:** se muestra la guardada mientras se actualiza en segundo plano.
- **`/api/*`: nunca se guarda.** Una respuesta vieja podría dejar entrar a dos personas con la misma entrada, así que sin conexión **no se valida**: la pantalla lo avisa y no lo confunde con una entrada inválida.

Cuando hay una versión nueva, aparece el aviso «Actualizar». La app nunca se recarga sola en medio de un ingreso.

## API

```http
POST /api/porteria/validarQR
Authorization: Bearer <token de un portero>
Content-Type: application/json

{ "codigo": "TK-…", "id_evento": 3 }      // también acepta "qr_code"; id_evento es opcional
```

| Caso | Respuesta |
|---|---|
| Entrada habilitada | `{ "permitido": true, "mensaje": "Entrada permitida", "estado": "ingresado", "fecha_ingreso": "…", "ticket": { "titular": "…", … } }` (queda inhabilitada) |
| Ya usada | `{ "permitido": false, "mensaje": "Entrada denegada", "estado": "ya_usado", "motivo": "Ya ingresó el …" }` |
| Inexistente, de otro evento o complejo, cancelada o **caducada** (12 h después del inicio del evento) | `{ "permitido": false, "mensaje": "Entrada denegada", "estado": "invalido", "motivo": "…" }` |

Admin, superadmin o cualquier otro rol reciben `403 Acceso exclusivo para portero`.

- **Una sola entrada por QR:** la fila del ticket se bloquea (`SELECT … FOR UPDATE`) dentro de una transacción. Si dos porteros escanean la misma entrada a la vez, sólo uno obtiene «ingresado».
- **Registro:** cada lectura (válida o no) queda en `accesos` con el portero, el código y la hora.
- **Por qué `entradas` es una vista:** expone `qr_code`, `estado` (`habilitada`, `ingresado`, …) y `fecha_ingreso` sin duplicar datos de `tickets` (3FN), así que nunca queda desincronizada.

## Instalación

```bash
cd backend && npm run migrate                 # aplica 005 (vista entradas)
cd frontend && npm install
```

## Pruebas

La cámara y el Service Worker **sólo funcionan en HTTPS o en `localhost`**. El permiso de cámara lo pide el navegador la primera vez que se toca «Escanear con cámara», no al instalar.

### Escritorio

```bash
cd frontend
npm run build && npm run preview              # http://localhost:4173 (versión de producción, con SW)
```

1. Ingresá como portero (`norte.puerta` / `porton123`): entra directo a la **Portería**. Para crear otro, ingresá como admin (`admin@norte.com` / `admin123`) → **Porteros**.
2. Tocá «Escanear con cámara»: el navegador pide permiso. Mostrá a la webcam el QR de una entrada (en el celular o impresa).
3. **Instalar:** usá el ícono de instalar de la barra de direcciones (Chrome o Edge) o el botón «Instalar app». Se abre en su propia ventana, sin barra del navegador.

### Celular (misma red wifi)

```bash
cd frontend
npm run dev:https                             # o: npm run build && npm run preview:https
```

1. En el celular abrí `https://<IP-de-la-PC>:5173` (o `:4173` con preview). La consola de Vite muestra la IP.
2. El certificado es autofirmado: aceptá la advertencia («Avanzado → Continuar»).
3. **Android (Chrome):** menú ⋮ → «Instalar app». **iPhone (Safari):** Compartir → «Agregar a inicio».
4. Abrí la app desde el ícono: se ve a pantalla completa. En «Portería», la cámara trasera se elige sola; si hay varias, se pueden alternar, y la linterna aparece cuando el teléfono la soporta.

### Casos para verificar

- **Permiso negado:** se muestra cómo habilitarlo y el foco pasa a la carga manual.
- **Sin cámara o cámara ocupada por otra app:** mensaje específico y carga manual.
- **Modo avión:** la app abre, avisa «Sin conexión» y no valida.
- **Mismo QR dos veces:** la segunda lectura dice «Entrada ya usada».
- **Lector de códigos USB o Bluetooth:** escribe en el campo manual y valida con Enter.

## Producción

Hay que servir el frontend por HTTPS con un certificado válido, por ejemplo con Caddy, Nginx + Let's Encrypt, Cloudflare o Vercel/Netlify. `/api` y `/uploads` deben llegar al backend. Dos detalles:

- `service-worker.js` tiene que servirse desde la raíz (`/service-worker.js`) y con `Cache-Control: no-cache`, para que los navegadores detecten las versiones nuevas.
- Ante un cambio de estrategia de caché, subí `VERSION` dentro del SW.

## Control de ingresos (`/admin/porteros` → pestaña «Control de ingresos»)

Panel en tiempo real para el organizador: por cada tipo de entrada, cuántas se vendieron, cuántas ingresaron y cuánto dinero representan. Se actualiza solo cada 10 s mientras la pestaña está visible, y al volver a ella.

### De dónde salen los números

No hay tablas nuevas: todo sale de lo que la Portería ya registra.

| Dato | Origen |
|---|---|
| Vendida | ticket vigente de una venta pagada (`tickets.estado` = `valido` o `usado`) |
| Ingresada | ticket `usado`: la Portería lo validó (`fecha_uso`) |
| Pendiente | ticket `valido`: todavía no entró |
| Monto | lo que realmente se cobró: el monto de la venta prorrateado entre sus tickets (respeta precios promocionales de links y cortesías en $0) |
| Capacidad | `tipos_ticket.stock_total` |
| Semáforo | uso ≥ 70 % verde · 40–69 % amarillo · < 40 % rojo · sin ventas, neutro |

Los tickets en efectivo todavía no validados no cuentan como vendidos.

### API

```http
GET /api/admin/event/:id/ingresos     (admin del complejo; otro complejo → 404, portero → 403)
→ { evento, generales: { vendidas, ingresadas, pendientes, facturado, consumido, pendiente_monto,
                         porcentaje_ingreso, semaforo, capacidad, capacidad_utilizada, ultimo_ingreso },
    por_tipo: [{ id_tipo, nombre, vendidas, ingresadas, pendientes, uso, semaforo,
                 monto_vendido, monto_consumido, monto_pendiente, capacidad, ultimo_ingreso }],
    actualizado_en }
```

Es **una sola consulta** agrupada por tipo, sin N+1 ([ingresosEvento.js](backend/src/services/ingresosEvento.js)). El prorrateo se calcula en una tabla derivada por venta, unida con un JOIN anidado para que un tipo sin ventas nunca sume montos de otros tipos.

### Pantalla

- **Filtros:**
  - **Evento:** por defecto, el próximo o en curso;
  - **Fecha** y **Estado:** acotan la lista de eventos;
  - **Tipo de ticket:** filtra tarjetas y gráficos, y recalcula los KPIs.
- **KPIs:**
  - ingreso general con semáforo y barra;
  - vendidas, ingresadas y pendientes;
  - capacidad utilizada;
  - facturado, consumido y pendiente;
  - % general.
- **Gráficos:**
  - donut con la distribución de vendidas por tipo (leyenda con valores);
  - barras horizontales de ingresadas por tipo;
  - barras apiladas de vendidas contra ingresadas;
  - ranking de los más consumidos.
- **Detalle por tipo:** tarjetas apilables, de 1, 2 o 3 columnas según el ancho.
- **Colores:** validados con la skill `dataviz` (`validate_palette.js`), con pasos propios en claro y oscuro. El color sigue al tipo, no a su posición, así que un filtro no repinta. Verde, amarillo y rojo quedan sólo para el semáforo, siempre con ícono y texto. A partir del séptimo tipo, los demás se agrupan como «Otros».
- **Piezas compartidas** con las estadísticas de `/admin/ventas`, en [estadisticas/comun.jsx](frontend/src/components/admin/estadisticas/comun.jsx): consulta en vivo, indicador «Actualizado hace…», tarjetas KPI y estilo de gráficos.

### Pruebas (2 nuevas, 24 en total)

- **Datos en vivo:**
  - compra de 4 entradas; la Portería real valida 3 QR y un QR repetido no suma;
  - vendidas, ingresadas, pendientes, uso, semáforo y montos se comparan con un cálculo independiente sobre la vista `tickets_detalle`, para cada tipo y en el total;
  - un tipo sin ventas queda en $0.
- **Acceso:** sin sesión → 401, portero → 403, otro complejo → 404.
- **Navegador** (Edge, 360 / 820 / 1280 px y modo oscuro):
  - 8 KPIs, 3 gráficos, ranking y tarjetas por tipo;
  - el filtro por tipo funciona;
  - se actualiza solo a los 10 s;
  - sin desbordes ni scroll horizontal.

## Venta en portería digital (`/admin/porteros/venta`, migración 017)

La venta en portería **no tiene un flujo de pago propio**. Usa el mismo núcleo que el resto de los canales:

1. **Checkout único** `POST /api/ventas/checkout`: reserva sin descontar stock y crea la preferencia con el token OAuth del complejo.
2. **Webhook**: valida firma, monto y cuenta cobradora.
3. **`confirmarStockDeVenta`**: descuenta el stock y habilita los tickets.
4. **Envío** de las entradas por correo y WhatsApp.
5. **La Portería** escanea el QR y registra el ingreso.

Lo único nuevo es de dónde sale la venta (`ventas.origen`), la landing rápida y la boletería asistida.

### Flujo del cliente sin entrada

1. Escanea el **QR de compra** de la puerta: `/comprar/evento/:id` (todos los tipos) o `/comprar/:id/:tipo` (un tipo ya elegido; el slug sale del nombre del tipo: «Early Bird» → `earlybird`).
2. En la landing rápida elige la entrada y la cantidad, carga 3 datos (con autocompletado del navegador) y toca **Pagar con Mercado Pago**. El botón queda fijo abajo, al alcance del pulgar.
3. MercadoPago aprueba:
   - el webhook habilita la entrada;
   - el cliente vuelve a `/entrada/:token` con su QR;
   - le llega por correo y WhatsApp.
4. El portero escanea el QR y el ingreso queda registrado.

Si MercadoPago rechaza el pago, el cliente vuelve a la landing (`?pago=rechazado`) para reintentar.

### Boletería asistida

En la pestaña **Venta en puerta** el staff elige el tipo y la cantidad (y, opcionalmente, los datos del cliente) y toca **Generar cobro**:

- se muestra el **QR de pago** de MercadoPago;
- el cliente lo escanea y paga desde su celular;
- la pantalla consulta el estado cada 2 s y, al aprobarse, muestra **Pago aprobado · Entrada generada · Lista para escanear**, con la imagen de cada entrada. Sin recargar.

Sin datos del cliente se crea un comprador anónimo «Cliente en puerta» para esa venta: la entrada le aparece en el celular al volver de MercadoPago.

### Pagos y webhooks

- **Pago y ticket duplicados imposibles:**
  - los tickets (con su QR único) se crean con la reserva, y el webhook sólo los habilita;
  - la venta se bloquea con `FOR UPDATE` y sólo la primera aprobación actúa;
  - `pagos.referencia_externa` es UNIQUE.
- **Reintentos:** ante un error responde 500, y MercadoPago reintenta.
- **Sin stock al aprobarse:** se reembolsa.
- **Auditoría:** cada notificación queda en `mercadopago_notificaciones` (payment_id, complejo, venta, estado resultante, qué se hizo, código HTTP).

### API nueva

```http
GET  /api/publico/comprar/:idEvento[/:tipo]     landing (evento, complejo, tipos con disponibilidad)
POST /api/ventas/checkout { event_id, origen: 'puerta_qr', … }   (el checkout de siempre; desde afuera sólo se acepta 'puerta_qr')
GET  /api/admin/event/:id/qr-compra             URLs de compra general y por tipo
POST /api/admin/puerta/cobro                    { id_evento, id_tipo, cantidad, comprador? } → { id_venta, init_point, qr_pago, monto_total, expira_en }
GET  /api/admin/puerta/cobro/:id                estado del cobro; aprobado → entradas con su link
GET  /api/admin/event/:id/ingresos              ahora suma puerta { tickets, monto, por_origen }, ultimas_operaciones y capacidad_disponible / semaforo_capacidad
```

El cobro asistido vence a los 15 min (`PUERTA_COBRO_MIN`).

### Panel del organizador

- **QR de compra** general y uno por tipo, con **PNG**, **PDF** (cartel A4 de unos 23 KB, generado con jsPDF, que se carga sólo al pedirlo), **Copiar** y **Compartir**.
- **Dashboard** (Control de ingresos), además de lo que ya mostraba:
  - **control de capacidad:** capacidad, ingresados y disponibles, con semáforo: verde más del 50 % libre, amarillo 10–50 %, rojo 10 % o menos;
  - **ventas en portería:** tickets y monto, separados en QR de compra y boletería;
  - **últimas operaciones:** hora, comprador, tipo, medio de pago, origen y estado.

### Tiempo real

Consultas periódicas: 10 s en el dashboard y 2 s en un cobro pendiente. No hay WebSockets ni SSE. Así funciona igual con varias instancias de pm2 detrás de nginx, sin estado compartido ni configuración de proxy, y la confirmación del cobro llega en 1–2 s.

### Pruebas (3 nuevas, 27 en total)

- **QR y landing:** URLs general y por tipo; la landing devuelve sólo el tipo del QR; un slug inexistente → 404; el stock exacto sólo se muestra cuando quedan pocas.
- **Compra por QR:**
  - queda marcada `puerta_qr`;
  - no descuenta stock hasta el webhook; al aprobarse descuenta, habilita los tickets y envía el correo;
  - suma en «ventas en portería»;
  - desde afuera no se puede marcar como `puerta_asistida`.
- **Boletería:**
  - el portero recibe 403;
  - devuelve el QR de pago y cobra en la cuenta del complejo;
  - pendiente → aprobado, con la notificación repetida: una sola vez el stock y sin tickets duplicados;
  - la Portería valida la entrada;
  - aparece en el dashboard y en las últimas operaciones;
  - las dos notificaciones quedan auditadas;
  - con datos, el cliente queda identificado.
- **Navegador** (Edge, 360 y 1280 px, MercadoPago simulado):
  - descargas de PNG y PDF;
  - el cobro aprobado aparece en pantalla en 1,4 s sin recargar;
  - la landing funciona y el dashboard se actualiza;
  - sin desbordes.

## Venta en puerta en efectivo (migración 018)

En **Venta en puerta → Cobro en boletería**, el staff elige el **método de pago**:

| Método | Botón | Qué pasa |
|---|---|---|
| **Mercado Pago QR** (como antes) | Generar QR | Se genera el cobro; el cliente paga desde su celular y la pantalla se confirma sola. El stock baja cuando MercadoPago aprueba |
| **Efectivo** | Registrar venta e ingresar | Sin QR ni MercadoPago: la venta queda pagada al instante, el stock se descuenta y las entradas quedan habilitadas para la Portería. Mensaje «Venta registrada en efectivo correctamente» |

Si el complejo no tiene MercadoPago conectado, la opción aparece deshabilitada y se cobra en efectivo.

### Cómo se registra

`registrarVentaEfectivo()` ([ventaPuerta.js](backend/src/services/ventaPuerta.js)) reutiliza el núcleo de siempre: `validarCompra('puerta')` + `ejecutarVenta(compra, { marcarPagado: true, alConfirmar })`. Todo en **una transacción**:

1. Valida la disponibilidad con las filas bloqueadas, igual que con MercadoPago.
2. Crea la venta con `metodo_pago = 'efectivo'` (el ENUM ya lo admitía desde la migración 008), `estado = 'pagado'` y `origen = 'puerta_asistida'`.
3. Registra el pago aprobado (`proveedor = 'efectivo'`) con quién cobró (`pagos.id_validador`, `validado_en`).
4. Descuenta el stock y habilita los tickets.
5. Agrega la auditoría en `auditoria_eventos` (`accion = 'venta_puerta'`, con método, cantidad, importe, tipos y observaciones).

Si cualquier paso falla, se revierte todo. Después de confirmar, la entrada sale por correo y WhatsApp si el cliente dejó datos.

| Dato pedido | Dónde queda |
|---|---|
| id_venta, fecha_hora, evento, comprador, importe | `ventas` (`id_venta`, `fecha_venta`, `id_evento`, `id_usuario`, `monto_total`) |
| cantidad | tickets de la venta |
| metodo_pago | `ventas.metodo_pago` (`mercadopago` / `efectivo`) |
| usuario que vendió | `ventas.id_usuario_staff` (nuevo) y, en efectivo, `pagos.id_validador` |
| observaciones | `ventas.observaciones` (nuevo) |

### Doble registro

- **En la pantalla:** el botón se deshabilita mientras se envía.
- **En el servidor**, que es la protección real: cada operación lleva una clave única (UUID) y `ventas.clave_idempotencia` es UNIQUE. Si la misma clave vuelve (doble click, reintento de red o pedidos simultáneos), se responde con la venta ya registrada (`200`, `repetida: true`) sin crear otra. Para MercadoPago devuelve el mismo QR, sin crear otra preferencia.

### API

```http
POST /api/admin/puerta/cobro   (sólo admin del complejo)
     { id_evento, id_tipo, cantidad, metodo_pago: 'mercadopago' | 'efectivo', comprador?, observaciones?, clave }
     efectivo    → 201 { id_venta, estado_pago: 'approved', tickets, mensaje }
     mercadopago → 201 { id_venta, init_point, qr_pago, … } (como antes)
     misma clave → 200 { …, repetida: true }
GET  /api/admin/event/:id/ingresos   ahora suma metodos_pago { por_metodo, total } y puerta.por_metodo
```

Cualquier otro método → 400. Sin stock → 409.

### Reportes

- **Control de ingresos:** tarjeta **Recaudación por método de pago**, con MercadoPago y efectivo separados (operaciones, entradas, recaudación y %) y el total combinado, para todo el evento o sólo la portería.
- **Listado de ventas** (`/admin/ventas`): debajo del total combinado, el total de cada método.
- **Lo que ya existía sigue igual:** la columna «Pago» del listado y el gráfico por medio de pago de las estadísticas de ventas.

### Pruebas (4 nuevas, 31 en total)

- **Efectivo:**
  - 201 con el mensaje y las entradas, sin QR y sin crear preferencia en MercadoPago;
  - el stock baja en el acto;
  - la venta queda `efectivo`/`pagado`/`puerta_asistida` con quién vendió y las observaciones;
  - el pago queda `efectivo`/aprobado con quién cobró;
  - la auditoría queda en la misma transacción;
  - la Portería deja entrar;
  - las estadísticas suman (porcentajes que dan 100 %);
  - un cliente anónimo no queda como «correo fallido».
- **Doble registro:** la misma clave dos veces y tres pedidos simultáneos con otra clave dan una venta por operación, con el stock descontado una vez.
- **Stock:** sin stock → 409 y no queda ninguna venta (rollback), igual que con MercadoPago. Otro método → 400; un portero → 403.
- **MercadoPago en boletería:** sin cambios; ahora guarda quién vendió y las observaciones, y la misma clave devuelve el mismo QR.
- **Navegador** (Edge, 360 y 1280 px):
  - botones según el método;
  - **doble click → una sola venta**;
  - confirmación «Venta registrada en efectivo correctamente»;
  - tabla de métodos en el dashboard y totales en Ventas;
  - sin desbordes.

## Rol cobrador de portería (migración 019)

Usuario exclusivo para cobrar en la boletería: su única pantalla es `/admin/porteros/venta`, en modo terminal.

### Roles y pertenencia

`usuarios.rol` suma `cobrador`. La pertenencia al complejo reutiliza la tabla **`porteros`**, que pasa a ser el personal de puerta: usuario generado para ingresar, contraseña generada, estado y complejo. La función la define el rol:

| Rol | Única pantalla | Backend |
|---|---|---|
| `portero` | Portería (`/porteria`) | sólo `/api/porteria/*` (`soloPortero`) |
| `cobrador` | Boletería (`/admin/porteros/venta`) | sólo `/api/admin/puerta/*` (`staffBoleteria`) |

El admin lo da de alta en **Porteros → Porteros → Nuevo integrante** eligiendo la **Función** (portero o cobrador). Después se puede cambiar con «Pasar a cobrador / portero». Desactivarlo lo deja afuera al instante, porque se verifica en cada pedido aunque su JWT siga vigente.

### Permisos

Están en una fuente única, declarativa: [config/permisos.js](backend/src/config/permisos.js).

| Permiso | admin | cobrador |
|---|---|---|
| `acceso_boleteria` | ✓ | ✓ |
| `venta_efectivo` | ✓ | ✓ |
| `venta_qr` | ✓ | ✓ |

- **Backend:** exige los permisos con `requierePermiso(...)`.
- **Frontend:** los recibe en la sesión (`usuario.permisos` en el login y en `/auth/me`).
- **Configuración del club:** además, el club decide en **Mi complejo → «Boletería: sólo efectivo»** (`tenants.boleteria_solo_efectivo`). Activado, Mercado Pago se oculta en la boletería para todos y el servidor lo rechaza con 403.

### Control de acceso

- **Backend:** la boletería usa `staffBoleteria`: JWT válido, rol admin o cobrador, complejo de la sesión, cobrador activo y permiso `acceso_boleteria`. El resto del panel sigue exigiendo `admin`, así que el cobrador recibe **403** en todo lo demás (probado sobre 14 rutas). Tampoco escanea en la Portería, y un portero no cobra.
- **Frontend:**
  - al iniciar sesión, el cobrador va directo a `/admin/porteros/venta`;
  - `TerminalCobrador` lo devuelve ahí ante cualquier otra URL;
  - el menú muestra sólo «Cobro en boletería» y «Salir».

### Terminal de cobro

- Selector de evento sólo si hay más de uno cobrable. No aparecen los eventos con asientos numerados, porque hay que elegir butaca.
- Tipos de entrada en botones grandes; los agotados aparecen deshabilitados.
- **Efectivo preseleccionado.** Mercado Pago QR como alternativa, si el club lo usa y está conectado.
- Botón **Registrar venta e ingresar**. Flujo mínimo: elegir el tipo (ya viene marcado el primero disponible), la cantidad y registrar.
- Confirmación con las entradas en pantalla, listas para escanear.

El medio por defecto y los medios permitidos los devuelve el backend (`GET /api/admin/puerta/evento/:id` → `medios`, `por_defecto`): no están fijos en el código del frontend. Las validaciones de stock, capacidad, ventana de venta, agotados y límites son las de siempre (`validarCompra` + `ejecutarVenta`).

### Auditoría

`auditoria_eventos` (`accion = 'venta_puerta'`) registra usuario, fecha y hora, evento, cantidad, importe, método, observaciones, **rol, IP y dispositivo** (user agent).

### API

```http
GET  /api/admin/puerta/eventos       eventos cobrables (admin y cobrador)
GET  /api/admin/puerta/evento/:id    tipos vendibles + { medios, por_defecto, solo_efectivo }
POST /api/admin/puerta/cobro         (como antes; el medio debe estar permitido → si no, 403)
GET  /api/admin/puerta/cobro/:id     (como antes)
POST /api/porteros                   { nombre, apellido?, rol?: 'portero' | 'cobrador' }
PUT  /api/porteros/:id               { …, rol? }   cambio de función
PUT  /api/tenants/mio                { boleteria_solo_efectivo: true | false }
```

### Pruebas (5 nuevas, 36 en total)

- **Alta:** el cobrador se da de alta como personal de puerta y su sesión trae sólo los permisos de boletería. Una función inválida → 400.
- **Cobro:** cobra en efectivo por defecto, con el mismo stock; la venta queda a su nombre y la auditoría guarda rol, IP y dispositivo. Para el admin, el medio por defecto sigue siendo Mercado Pago.
- **Accesos:** 403 en 14 rutas del panel (ingresos, estadísticas, eventos, correos, ventas, personal, vendedores, links, Mi complejo, historial, integraciones) y en la Portería. Un portero no entra a la boletería.
- **«Sólo efectivo»:** Mercado Pago desaparece de los medios para el cobrador y para el admin, y el servidor lo rechaza.
- **Desactivación y cambio de función:**
  - desactivado → 403 con el mismo JWT y login rechazado;
  - cambiado a portero → sin boletería y con acceso a la Portería.
- **Navegador** (Edge, 1280 / 820 / 390 px):
  - el login real lleva a la terminal;
  - el menú tiene sólo «Cobro en boletería» y «Salir»;
  - efectivo viene preseleccionado y la venta se registra con 1 click;
  - 8 URLs escritas a mano vuelven a la boletería;
  - con «sólo efectivo» desaparece el selector;
  - en el panel del admin, el personal muestra su función y Mi complejo tiene el ajuste;
  - sin scroll horizontal.
