const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());

// Usamos almacenamiento en memoria (MemoryStorage) para evitar crear carpetas locales
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Base de datos en memoria para servir los archivos
const filesDb = new Map();

// ─── API HTTP ───

// Endpoint para subir archivos
app.post('/api/files/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

  // Generar un ID único para el archivo
  const fileId = crypto.randomBytes(8).toString('hex');
  
  // Guardarlo en la RAM
  filesDb.set(fileId, {
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
    originalname: req.file.originalname
  });

  // El cliente lo recibe y suma al HTTP_BASE
  res.json({
    url: `api/files/${fileId}`,
    name: req.file.originalname
  });
});

// Endpoint para descargar/ver el archivo
app.get('/api/files/:id', (req, res) => {
  const file = filesDb.get(req.params.id);
  if (!file) return res.status(404).send('Archivo no encontrado');

  res.setHeader('Content-Type', file.mimetype);
  res.send(file.buffer);
});

// ─── WEBSOCKETS ───

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Estado global
const cloudVars = {};
const clients = new Map(); // socket -> { id, username, rooms: Set }

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
  const clientId = crypto.randomUUID();
  clients.set(ws, { id: clientId, username: 'Jugador_' + clientId.substring(0, 4), rooms: new Set() });

  // Enviar las variables actuales al recién conectado
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

        case 'link': // Entrar a sala
          if (Array.isArray(data.val)) {
            data.val.forEach(r => sender.rooms.add(r));
          }
          break;

        case 'unlink': // Salir de sala
          if (Array.isArray(data.val)) {
            data.val.forEach(r => sender.rooms.delete(r));
          }
          break;

        case 'gmsg': // Mensaje global o por sala
          const gmsgPayload = JSON.stringify({
            cmd: 'gmsg',
            val: data.val,
            origin: { id: sender.id, username: sender.username },
            rooms: Array.from(sender.rooms)
          });
          
          for (const [client, info] of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(gmsgPayload);
            }
          }
          break;

        case 'pmsg': // Mensaje directo
          const targetId = data.id; 
          const pmsgPayload = JSON.stringify({
            cmd: 'pmsg',
            val: data.val,
            origin: { id: sender.id, username: sender.username }
          });

          for (const [client, info] of clients) {
            if ((info.username === targetId || info.id === targetId) && client.readyState === WebSocket.OPEN) {
              client.send(pmsgPayload);
            }
          }
          break;

        case 'gvar': // Variable de nube
          cloudVars[data.name] = data.val;
          const gvarPayload = JSON.stringify({
            cmd: 'gvar',
            name: data.name,
            val: data.val
          });
          
          for (const [client] of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(gvarPayload);
            }
          }
          break;
      }
    } catch (e) {
      console.error('Mensaje corrupto recibido:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastUserList();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor Cloud32 en línea por el puerto ${PORT}`);
});
