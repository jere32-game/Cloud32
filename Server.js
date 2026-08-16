const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const app = express();

app.use(cors());

// ─── HTTP ARCHIVOS SUBIDOS ───
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } 
});
const filesDb = new Map();

// ─── PROTECCIÓN ANTI-CURIOSOS ───
app.get('/', (req, res) => res.status(200).send('LOL No es tan facil amigo'));
app.get('/ping', (req, res) => res.status(200).send('pong'));

// ─── API HTTP ───
app.post('/api/files/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
  const fileId = crypto.randomBytes(8).toString('hex');
  filesDb.set(fileId, {
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
    originalname: req.file.originalname,
    timestamp: Date.now()
  });
  res.json({ url: `api/files/${fileId}`, name: req.file.originalname });
});

app.get('/api/files/:id', (req, res) => {
  const file = filesDb.get(req.params.id);
  if (!file) return res.status(404).send('Archivo no encontrado');
  res.setHeader('Content-Type', file.mimetype);
  res.send(file.buffer);
});

setInterval(() => {
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  for (const [id, file] of filesDb.entries()) {
    if (file.timestamp < tenMinutesAgo) filesDb.delete(id);
  }
}, 60000);


// ─── WEBSOCKETS (SISTEMA DE SALAS Y RAM 2 HORAS) ───
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const cloudVars = new Map(); 
const clients = new Map();

// Limpiador de RAM de 2 Horas
setInterval(() => {
  const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000); 
  for (const [name, data] of cloudVars.entries()) {
    if (data.timestamp < twoHoursAgo) {
      cloudVars.delete(name); 
    }
  }
}, 60000); 

// 🔥 MOTOR DE SALAS (ROOMS)
const getRooms = (client) => client.rooms.size > 0 ? Array.from(client.rooms) : ['global'];

function shareRoom(clientA, clientB) {
  const roomsA = getRooms(clientA);
  const roomsB = getRooms(clientB);
  // Si comparten al menos una sala, se pueden ver y comunicar
  return roomsA.some(r => roomsB.includes(r));
}

// 🔥 RADAR DE JUGADORES (Aislado por salas)
function refreshAllUlists() {
  for (const [ws, client] of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    
    const visibleUsers = new Set();
    for (const [otherWs, otherClient] of clients) {
      if (otherClient.username && shareRoom(client, otherClient)) {
        visibleUsers.add(otherClient.username);
      }
    }
    ws.send(JSON.stringify({ cmd: 'ulist', val: Array.from(visibleUsers) }));
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const clientId = crypto.randomUUID();
  // Se conectan sin nombre hasta que envíen 'setid'
  clients.set(ws, { id: clientId, username: '', rooms: new Set() });

  // Enviar las variables del lobby global al entrar
  for (const [key, varData] of cloudVars.entries()) {
    if (key.startsWith("global||")) {
      const varName = key.split("||")[1];
      ws.send(JSON.stringify({ cmd: 'gvar', name: varName, val: varData.val }));
    }
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const sender = clients.get(ws);

      switch (data.cmd) {
        case 'setid':
          sender.username = data.val;
          refreshAllUlists();
          break;

        case 'link':
          if (Array.isArray(data.val)) {
            data.val.forEach(r => {
              sender.rooms.add(r);
              // Al entrar a una sala, le enviamos las variables vivas de ESA sala
              for (const [key, varData] of cloudVars.entries()) {
                if (key.startsWith(r + "||")) {
                  const varName = key.split("||")[1];
                  ws.send(JSON.stringify({ cmd: 'gvar', name: varName, val: varData.val }));
                }
              }
            });
            refreshAllUlists(); // Actualiza quién ve a quién
          }
          break;

        case 'unlink':
          if (Array.isArray(data.val)) {
            data.val.forEach(r => sender.rooms.delete(r));
            refreshAllUlists();
          }
          break;

        case 'gmsg':
        case 'pmsg':
          // El chat y mensajes privados se mantienen iguales pero ya protegidos por shareRoom
          const payload = JSON.stringify({ cmd: data.cmd, val: data.val, origin: { id: sender.id, username: sender.username } });
          for (const [clientWs, clientInfo] of clients) {
            if (clientWs.readyState === WebSocket.OPEN && shareRoom(sender, clientInfo)) {
              if (data.cmd === 'pmsg' && clientInfo.username !== data.id) continue;
              clientWs.send(payload);
            }
          }
          break;

        case 'gvar':
          const senderRooms = getRooms(sender);
          
          // Guardar en la RAM con la etiqueta de la sala (Ej: "sala1||Puntos")
          senderRooms.forEach(room => {
            cloudVars.set(room + "||" + data.name, { val: data.val, timestamp: Date.now() });
          });

          // Transmitir SOLO a los que comparten sala con el enviador
          const gvarPayload = JSON.stringify({ cmd: 'gvar', name: data.name, val: data.val });
          for (const [clientWs, clientInfo] of clients) {
            if (clientWs.readyState === WebSocket.OPEN && shareRoom(sender, clientInfo)) {
              clientWs.send(gvarPayload);
            }
          }
          break;
      }
    } catch (e) {
      console.error('Mensaje corrupto ignorado');
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    refreshAllUlists();
  });
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor Cloud32 en línea por el puerto ${PORT}`));
