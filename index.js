const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// 1. Servidor HTTP con una ruta "/ping" para evitar que se duerma
const server = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong'); // Endpoint para servicios como UptimeRobot
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Servidor Cloud32 activo en Render 🚀');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('🔌 Nuevo cliente conectado.');
  ws.isAlive = true;
  ws.roomId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.method === 'handshake') {
        ws.roomId = data.project_id || data.room || 'global';
        console.log(`👤 Sala asignada: ${ws.roomId}`);
        return;
      }

      if (data.method === 'set') {
        const targetRoom = ws.roomId || 'global';

        wss.clients.forEach((client) => {
          if (
            client !== ws && 
            client.readyState === WebSocket.OPEN && 
            client.roomId === targetRoom
          ) {
            client.send(JSON.stringify({
              method: 'set',
              name: data.name,
              value: data.value
            }));
          }
        });
        return;
      }

    } catch (error) {
      console.error('❌ Error procesando mensaje:', error);
    }
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => console.log('❌ Cliente desconectado.'));
  ws.on('error', (err) => console.error('⚠️ Error:', err.message));
});

// 2. EN RENDER EL TIMEOUT DE INACTIVIDAD ES DE ~100 SEGUNDOS.
// Bajamos el latido a 25 segundos para que la conexión nunca parezca "inactiva".
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('💀 Limpiando conexión fantasma.');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping(); 
  });
}, 25000); // 25 segundos mantiene la conexión viva en el proxy de Render

wss.on('close', () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`🚀 Servidor Cloud32 escuchando en el puerto ${PORT}`);
});
