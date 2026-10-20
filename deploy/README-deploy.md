# Despliegue en VPS: integra360ticketera.com

Probado para Ubuntu 22.04/24.04 con Node 22, MySQL 8 y nginx. Rutas usadas:

- Código: `/var/www/integra360ticketera` (este repositorio)
- Frontend compilado: `/var/www/integra360ticketera/frontend/dist`
- Backend: `127.0.0.1:4000`, nunca expuesto directo a internet

## 1. DNS

En el proveedor del dominio, apuntar estos registros a la IP del VPS:

| Tipo | Nombre | Valor |
|---|---|---|
| A | `@` | IP del VPS |
| A | `www` | IP del VPS |
| A | `*` | IP del VPS (un subdominio por complejo: `norte.integra360ticketera.com`) |

## 2. Base de datos

```sql
CREATE DATABASE integra360_ticketera CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'integra360'@'localhost' IDENTIFIED BY 'root123';
GRANT ALL PRIVILEGES ON integra360_ticketera.* TO 'integra360'@como'localhost';
FLUSH PRIVILEGES;
```

## 3. Backend

```bash
cd /var/www/integra360ticketera/backend
cp ../deploy/backend.env.production .env     # completar DB_PASSWORD
npm ci --omit=dev
npm run migrate                              # NO correr db:reset ni seed en producción
sudo npm i -g pm2
pm2 start src/server.js --name integra360-api
pm2 save && pm2 startup                      # arranca solo al reiniciar el VPS
```

El usuario superadmin inicial se crea a mano (el seed es sólo para pruebas), por ejemplo con
`node -e` usando bcrypt, o ejecutando el seed una única vez y cambiando enseguida las contraseñas.

## 4. Frontend

```bash
cd /var/www/integra360ticketera/frontend
npm ci && npm run build                      # genera dist/
```

## 5. Certificado HTTPS (dominio + comodín para los complejos)

El comodín `*.integra360ticketera.com` **sólo** se puede emitir con validación DNS:

```bash
sudo apt install certbot
sudo certbot certonly --manual --preferred-challenges dns \
  -d integra360ticketera.com -d '*.integra360ticketera.com'
```

Certbot pide crear un registro TXT `_acme-challenge` en el DNS.

- **Renovación automática:** usá el plugin de tu proveedor de DNS, por ejemplo `python3-certbot-dns-cloudflare` con `--dns-cloudflare`. Con `--manual` hay que renovar a mano cada 90 días.
- **Sin subdominios por complejo:** alcanza con `sudo certbot certonly --nginx -d integra360ticketera.com -d www.integra360ticketera.com`. En ese caso los complejos se eligen desde el selector de la web.

## 6. nginx

```bash
sudo cp /var/www/integra360ticketera/deploy/nginx/integra360ticketera.com.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/integra360ticketera.com.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo mkdir -p /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Verificar

- `curl https://integra360ticketera.com/api/health` debe devolver `{"ok":true}`.
- Abrir `https://norte.integra360ticketera.com`: tiene que mostrar sólo ese complejo.
- En MercadoPago, configurar el webhook en `https://integra360ticketera.com/api/pagos/webhook/mercadopago/...` (el panel de integraciones muestra la URL exacta).
- Desde el celular, abrir la web, instalarla como app y probar la Portería: la cámara exige HTTPS, que ya queda activo.

## Actualizar a una versión nueva

```bash
cd /var/www/integra360ticketera && git pull
cd backend && npm ci --omit=dev && npm run migrate && pm2 restart integra360-api
cd ../frontend && npm ci && npm run build
```

No hace falta recargar nginx: sirve el `dist/` nuevo y los usuarios ven el aviso «Hay una versión nueva».
