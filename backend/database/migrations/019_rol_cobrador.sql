-- Rol COBRADOR de portería: personal que sólo cobra entradas en la boletería (/admin/porteros/venta).
--
-- usuarios.rol += 'cobrador'. La pertenencia al complejo reutiliza la tabla porteros (personal de puerta): usuario
-- generado para ingresar, estado activo/inactivo y complejo. Lo que distingue a cada uno es usuarios.rol:
--   portero  → sólo la Portería (escanear QR)        cobrador → sólo la boletería (cobrar)
-- Sin tablas nuevas: el alta, la contraseña generada, la desactivación y el login por usuario ya existen.
ALTER TABLE usuarios
  MODIFY rol ENUM('superadmin','admin','vendedor','comprador','portero','cobrador') NOT NULL DEFAULT 'comprador';

-- Configuración del club para la boletería: sólo efectivo (oculta y rechaza MercadoPago en la puerta)
ALTER TABLE tenants
  ADD COLUMN boleteria_solo_efectivo TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'la boletería cobra sólo en efectivo (sin MercadoPago)';
