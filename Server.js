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

// ─── PANEL DE CONTROL EN TIEMPO REAL (DASHBOARD) ───
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Panel Cloud32</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #121212; color: #ffffff; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        .header { border-bottom: 2px solid #2fff00; padding-bottom: 10px; margin-bottom: 20px; }
        h1 { color: #2fff00; margin: 0; font-size: 24px; }
        .stats-box { background: #1e1e1e; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #333; }
        .stats-box h2 { margin-top: 0; font-size: 18px; color: #aaa; }
        .big-number { font-size: 32px; font-weight: bold; color: #fff; }
        table { width: 100%; border-collapse: collapse; background: #1e1e1e; border-radius: 8px; overflow: hidden; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #333; }
        th { background: #2a2a2a; color: #2fff00; }
        .empty { text-align: center; color: #777; font-style: italic; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>☁️ Servidor Cloud32 - Monitor en Vivo</h1>
        </div>
        
        <div class="stats-box">
          <h2>Jugadores Conectados</h2>
          <div class="big-number" id="users-count">0</div>
        </div>

        <div class="stats-box">
          <h2>Variables de Nube Activas (Últimas 2 Horas)</h2>
          <table>
            <thead>
              <tr>
                <th>Nombre de Variable</th>
                <th>Valor Actual</th>
              </tr>
            </thead>
            <tbody id="vars-table">
              <tr><td colspan="2" class="empty">Cargando datos...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <script>
        async function fetchStatus() {
          try {
            const res = await fetch('/api/status');
            const data = await res.json();
            
            document.getElementById('users-count').innerText = data.clients;
            
            const tbody = document.getElementById('vars-table');
            const varsObj = data.variables;
            const keys = Object.keys(varsObj);
            
            if (keys.length === 0) {
              tbody.innerHTML = '<tr><td colspan="2" class="empty">No hay variables activas en este momento.</td></tr>';
              return;
            }

            let html = '';
            for (const key of keys) {
              html += \`<tr><td>\${key}</td><td>\${varsObj[key]}</td></tr>\`;
            }
            tbody.innerHTML = html;
            
          } catch(e) {
            console.error("Error conectando con el servidor local", e);
          }
        }

        setInterval(fetchStatus, 200);
        fetchStatus();
      </script>
    </body>
    </html>
  `);
});

app.get('/api/status', (req, res) => {
  const varsObj = {};
  for (const [name, data] of cloudVars.entries()) {
    varsObj[name] = data.val;
  }
  res.json({ clients: clients.size, variables: varsObj });
});

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
            // 🔥 AQUÍ ESTÁ LA MAGIA: Eliminé el "client !== ws". 
            // Ahora se lo envía a TODO EL MUNDO, incluyendo a quien mandó el mensaje originalmente.
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
