const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Servidor Cloud32 activo (NDJSON FIX) 🚀');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.roomId = 'global';

  ws.on('message', (message) => {
    try {
      // 1. EL FIX DE ENTRADA: 
      // TurboWarp a veces manda varios mensajes pegados con saltos de línea. 
      // Hay que separarlos para que JSON.parse no explote.
      const messages = message.toString().split('\n').filter(Boolean);

      messages.forEach((msg) => {
        const data = JSON.parse(msg);

        if (data.method === 'handshake') {
          ws.roomId = data.project_id || data.room || 'global';
          return;
        }

        if (data.method === 'set') {
          // 2. EL FIX DE SALIDA (LA MAGIA WEY):
          // Obligatorio sumarle el salto de línea '\n' al final. 
          // Si no, TurboWarp ignora el mensaje por completo.
          const payload = JSON.stringify({
            method: 'set',
            name: data.name,
            value: data.value
          }) + '\n'; 

          wss.clients.forEach((client) => {
            if (
              client !== ws && 
              client.readyState === WebSocket.OPEN && 
              client.roomId === ws.roomId
            ) {
              client.send(payload);
            }
          });
        }
      });
    } catch (error) {
      // Ignoramos silenciosamente si llega basura que no es JSON
    }
  });

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => { /* Cliente desconectado */ });
});

// Latido para evitar que Render desconecte a los jugadores
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`🚀 Servidor listo en el puerto ${PORT}`);
});
