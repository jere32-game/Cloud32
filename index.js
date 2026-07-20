const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// Servidor HTTP básico para el Ping de Render
const server = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Servidor Cloud32 Universal Activo 🚀');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.roomId = 'global';

  ws.on('message', (message) => {
    try {
      // 1. ACEPTAMOS EL MENSAJE EN BRUTO. 
      // Lo parseamos directamente sin forzar saltos de línea ni protocolos raros.
      const rawString = message.toString().trim();
      
      // Manejo de múltiples JSON pegados (si el motor envía en ráfagas)
      const messages = rawString.includes('}{') 
        ? rawString.replace(/}{/g, '}|||{').split('|||') 
        : [rawString];

      messages.forEach((msgString) => {
        const data = JSON.parse(msgString);

        // Si es un handshake, asignamos la sala
        if (data.method === 'handshake') {
          ws.roomId = data.project_id || data.room || 'global';
          return;
        }

        // 2. BROADCAST UNIVERSAL
        // Si no es handshake, simplemente tomamos el JSON TAL CUAL llega
        // y se lo rebotamos a los demás en la sala. 
        // Esto permite a PenguinMod o MisWarp leer el JSON original sin alteraciones.
        const payload = JSON.stringify(data);

        wss.clients.forEach((client) => {
          if (
            client !== ws && 
            client.readyState === WebSocket.OPEN && 
            client.roomId === ws.roomId
          ) {
            client.send(payload);
          }
        });
      });
      
    } catch (error) {
      // Si el cliente manda texto plano o basura en lugar de JSON, 
      // simplemente lo ignoramos sin desconectar al cliente ni crashear el servidor.
    }
  });

  // Mantener viva la conexión (Heartbeat)
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => { /* Manejo silencioso */ });
});

// Limpieza de inactivos cada 25s (Ideal para Render)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`🚀 Servidor Cloud32 Universal listo en el puerto ${PORT}`);
});
