const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000; 

// 1. Creamos un servidor web normal para los navegadores y Uptime Robot
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Servidor Cloud32 V2 en linea. Conectate desde TurboWarp usando wss://');
});

// 2. Enganchamos el servidor WebSocket al servidor web
const wss = new WebSocket.Server({ server });

let cloudVars = {}; 

console.log(`Cloud32 V2 (Fluido) iniciado en el puerto ${PORT}`);

wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'init', data: cloudVars }));

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            
            if (parsed.type === 'set') {
                cloudVars[parsed.name] = parsed.val;
                
                const outMsg = JSON.stringify(parsed);
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(outMsg);
                    }
                });
            }
        } catch (e) {}
    });
});

// 3. Encendemos el servidor principal
server.listen(PORT, () => {
    console.log(`Escuchando en el puerto ${PORT}`);
});
