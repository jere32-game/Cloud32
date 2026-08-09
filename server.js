const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const app = express();

app.use(cors());

// ─── 1. PROTECCIÓN DE MEMORIA RAM ───
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Máximo 5MB por archivo para no crashear Render
});

const filesDb = new Map();

// ─── 2. ENDPOINTS PARA CRON-JOB.ORG ───
app.get('/', (req, res) => res.status(200).send('Servidor Cloud32 Activo'));
app.get('/ping', (req, res) => res.status(200).send('pong'));

// ─── API HTTP PARA ARCHIVOS ───
app.post('/api/files/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

  const fileId = crypto.randomBytes(8).toString('hex');
  
  filesDb.set(fileId, {
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
    originalname: req.file.originalname,
    timestamp: Date.now() // Guardamos la hora
  });

  res.json({
    url: `api/files/${fileId}`,
    name: req.file.originalname
  });
});

app.get('/api/files/:id', (req, res) => {
  const file = filesDb.get(req.params.id);
  if (!file) return res.status(404).send('Archivo no encontrado');

  res.setHeader('Content-Type', file.mimetype);
  res.send(file.buffer);
});

// ─── 3. LIMPIEZA AUTOMÁTICA DE BASURA ───
setInterval(() => {
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  for (const [id, file] of filesDb.entries()) {
    if (file.timestamp < tenMinutesAgo) {
      filesDb.delete(id);
    }
  }
}, 60000); // Revisa y limpia cada 1 minuto

// ─── WEBSOCKETS (SISTEMA ANTI-DESCONEXIÓN) ───
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const cloudVars = {};
const clients = new Map();

function broadcastUserList() {
  const users = Array.from(clients.values()).map(c => c.username).filter(Boolean);
  const msg = JSON.stringify({ cmd: 'ulist', val: users });
  for (const [client] of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  // Configuración del "Latido" (Heartbeat)
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const clientId = crypto.randomUUID();
  clients.set(ws, { id: clientId, username: 'Jugador_' + clientId.substring(0, 4), rooms: new Set() });

  // Enviar variables al conectar
  for (const [name, val] of Object.entries(cloudVars)) {
    ws.send(JSON.stringify({ cmd: 'gvar', name, val }));
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
          const gmsgPayload = JSON.stringify({
            cmd: 'gmsg', val: data.val,
            origin: { id: sender.id, username: sender.username },
            rooms: Array.from(sender.rooms)
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
          cloudVars[data.name] = data.val;
          const gvarPayload = JSON.stringify({ cmd: 'gvar', name: data.name, val: data.val });
          for (const [client] of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) client.send(gvarPayload);
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

// Mantener vivas las conexiones (Ping cada 30 seg)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor Cloud32 en línea por el puerto ${PORT}`);
});