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


// ─── WEBSOCKETS (CON BASE DE DATOS DE 2 HORAS EN RAM) ───
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const cloudVars = new Map(); 
const clients = new Map();

setInterval(() => {
  const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000); 
  for (const [name, data] of cloudVars.entries()) {
    if (data.timestamp < twoHoursAgo) {
      cloudVars.delete(name); 
    }
  }
}, 60000); 

function broadcastUserList() {
  const users = Array.from(clients.values()).map(c => c.username).filter(Boolean);
  const msg = JSON.stringify({ cmd: 'ulist', val: users });
  for (const [client] of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const clientId = crypto.randomUUID();
  clients.set(ws, { id: clientId, username: 'Jugador_' + clientId.substring(0, 4), rooms: new Set() });

  for (const [name, data] of cloudVars.entries()) {
    ws.send(JSON.stringify({ cmd: 'gvar', name: name, val: data.val }));
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const sender = clients.get(ws);

      switch (data.cmd) {
        case 'setid':
          sender.username = data.val;
          broadcastUserList();
          break;

        case 'link':
          if (Array.isArray(data.val)) data.val.forEach(r => sender.rooms.add(r));
          break;

        case 'unlink':
          if (Array.isArray(data.val)) data.val.forEach(r => sender.rooms.delete(r));
          break;

        case 'gmsg':
          const senderRooms = Array.from(sender.rooms);
          const gmsgPayload = JSON.stringify({
            cmd: 'gmsg', val: data.val,
            origin: { id: sender.id, username: sender.username },
            rooms: senderRooms
          });
          for (const [client] of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) client.send(gmsgPayload);
          }
          break;

        case 'pmsg':
          const targetId = data.id; 
          const pmsgPayload = JSON.stringify({ cmd: 'pmsg', val: data.val, origin: { id: sender.id, username: sender.username } });
          for (const [client, info] of clients) {
            if ((info.username === targetId || info.id === targetId) && client.readyState === WebSocket.OPEN) client.send(pmsgPayload);
          }
          break;

        case 'gvar':
          cloudVars.set(data.name, { val: data.val, timestamp: Date.now() });

          const gvarPayload = JSON.stringify({ cmd: 'gvar', name: data.name, val: data.val });
          for (const [client] of clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(gvarPayload);
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
    broadcastUserList();
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
