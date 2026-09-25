# Piñatas Carlos — Web de producción

Esta versión conserva el diseño original y lo prepara para GitHub Pages + Firebase.

## 1. Firebase
- Registra una aplicación Web en el proyecto Firebase existente.
- Habilita Authentication > Email/Password para el administrador.
- Habilita Authentication > Anonymous para visitantes/comentarios.
- Pega la configuración web en `data/firebase-config.js`.
- Pega el UID del administrador en `data/firebase-config.js`.
- Agrega las reglas de `FIREBASE-PIÑATAS-REGLAS.txt` sin borrar las reglas actuales.

## 2. Primera carga
Abre la web como administrador y usa:
Administrar > Herramientas > Importar catálogo inicial.

Después sube:
- Imagen de fondo
- Logo

Las fotos nuevas de productos se suben directamente a Firebase Storage.

## 3. Publicar
Sube TODO el contenido de esta carpeta a un repositorio nuevo de GitHub y activa GitHub Pages desde Settings > Pages > Deploy from a branch > main / root.

La URL quedará normalmente como:
`https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`

No es necesario comprar dominio.

## 4. Importante
`data/firebase-config.js` contiene configuración pública del cliente Firebase, no una contraseña. La seguridad real está en Authentication y Rules.
