# 🪅 Piñatas Carlos — Marketplace estático

Esta versión está pensada para subirla directamente a **GitHub Pages**.

## Estructura

```text
index.html
css/
  styles.css
js/
  app.js
data/
  catalogo.json
  config.json
assets/
  brand/
    logo.png
    hero-background.png
  products/
    fotos...
```

## Funciones

### Marketplace público
- Buscador.
- Categorías.
- Ordenar por destacadas, valoración y precio.
- Tarjetas de productos.
- Favoritos ❤️.
- Ficha completa de cada piñata.
- Galería.
- Valoraciones ⭐.
- Comentarios.
- Compartir enlaces directos.
- Compartir catálogo.
- Pedido por WhatsApp.
- Diseño responsive para teléfono y computadora.

### Administración
El botón ⚙️ abre un panel lateral.

Incluye:
- Ver todas las piñatas.
- Buscar.
- Crear.
- Editar.
- Duplicar.
- Ocultar/mostrar.
- Eliminar.
- Seleccionar varias fotografías.
- Precio.
- Categoría.
- Medida.
- Descripción.
- Etiquetas.
- Estado.
- Destacada.
- Exportar `catalogo.json`.

## Importante sobre GitHub Pages

GitHub Pages es alojamiento estático. No es una base de datos.

Por eso, en esta versión:
- Los cambios administrativos nuevos se guardan localmente en el navegador.
- Los comentarios y valoraciones de visitantes también son locales en este prototipo estático; cada navegador mantiene su propio historial.
- El catálogo inicial sí está incluido en `data/catalogo.json`.
- Las fotos iniciales sí están incluidas en `assets/products/`.

Para que una nueva piñata creada desde el panel sea permanente y visible para todos, hay que sincronizar el contenido modificado con el repositorio. El flujo de exportación permite descargar `catalogo.json`. Las fotografías nuevas deben copiarse a `assets/products/`.

Para una siguiente versión se puede integrar un publicador seguro con GitHub API/serverless. No se recomienda poner un token de escritura permanente dentro del código público.

## Publicar

1. Crea un repositorio en GitHub.
2. Sube **todo el contenido de esta carpeta**, respetando las carpetas.
3. Ve a Settings → Pages.
4. Selecciona Deploy from a branch.
5. Elige `main` y `/ (root)`.
6. Guarda.

Esta versión no depende de `fetch()` para cargar el catálogo: el catálogo y la configuración están empaquetados en `data/catalogo.js` y `data/config.js`, por lo que también puedes abrir `index.html` directamente en Android/PC con `file://`.

## Personalización

Edita `data/config.json` para cambiar:
- nombre,
- eslogan,
- ubicación,
- WhatsApp,
- Facebook.

Los productos iniciales están en `data/catalogo.json`.
