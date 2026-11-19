# NETWATCH Perú

Dashboard de monitoreo de incidentes oficiales Cloudflare, Twilio, GitHub, DigitalOcean y Atlassian. Los operadores peruanos figuran como enlaces externos, sin estados automáticos no verificados.

## Uso local

`node server.js` y abrir http://localhost:3080

## Publicar en Render

En https://dashboard.render.com selecciona **New → Blueprint**, conecta este repositorio y confirma el despliegue del servicio Web. Render asigna una URL HTTPS.

**Nota:** el plan gratuito puede suspender la aplicación por inactividad y su historial local no es persistente. El monitoreo automático solo funciona con el servidor activo; las notificaciones del navegador requieren tener la página abierta.
