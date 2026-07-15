-- Tabla principal de usuarios y facturación de la empresa
CREATE TABLE IF NOT EXISTS usuarios_marisai (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    creditos_disponibles NUMERIC(10, 2) NOT NULL,
    es_administrador BOOLEAN DEFAULT FALSE,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inyección de tu cuenta corporativa con saldo infinito y permisos de RRHH
INSERT INTO usuarios_marisai (email, password_hash, creditos_disponibles, es_administrador)
VALUES ('rrhh.milchollos@gmail.com', '19862210Des', 99999999.99, TRUE)
ON CONFLICT (email) DO UPDATE 
SET creditos_disponibles = 99999999.99, es_administrador = TRUE;
