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
