const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000; 

// Servidor web básico para responder a los pings de Uptime Robot y navegadores
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Cloud32 Voice & Data Server activo.');
});

const wss = new WebSocket.Server({ server });

// Estructura de memoria: rooms[nombre_sala] = { clients: Map(usuario -> ws), vars: {} }
const rooms = {};

wss.on('connection', (ws) => {
    let currentRoom = null;
    let myUser = null;

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);

            // 1. Unirse a una sala
            if (msg.type === 'join') {
                currentRoom = msg.room;
                myUser = msg.user;

                if (!rooms[currentRoom]) {
                    rooms[currentRoom] = { clients: new Map(), vars: {} };
                }
                rooms[currentRoom].clients.set(myUser, ws);

                // Enviar variables actuales de la sala al recién conectado
                ws.send(JSON.stringify({ type: 'init_vars', data: rooms[currentRoom].vars }));

                // Actualizar la lista de usuarios para todos en la sala
                const userList = Array.from(rooms[currentRoom].clients.keys());
                rooms[currentRoom].clients.forEach((clientWs) => {
                    clientWs.send(JSON.stringify({ type: 'user_list', users: userList }));
                });

                // Avisar a los demás que alguien entró (para que inicien la conexión de voz WebRTC)
                rooms[currentRoom].clients.forEach((clientWs, user) => {
                    if (user !== myUser) {
                        clientWs.send(JSON.stringify({ type: 'peer_joined', user: myUser }));
                    }
                });
            }
            // 2. Puente de WebRTC (Llamadas de voz)
            else if (msg.type === 'signal') {
                if (rooms[currentRoom] && rooms[currentRoom].clients.has(msg.to)) {
                    rooms[currentRoom].clients.get(msg.to).send(JSON.stringify({
                        type: 'signal',
                        from: myUser,
                        signal: msg.signal
                    }));
                }
            }
            // 3. Sincronización de Variables (solo dentro de la sala)
            else if (msg.type === 'set') {
                if (rooms[currentRoom]) {
                    rooms[currentRoom].vars[msg.name] = msg.val;
                    
                    const outMsg = JSON.stringify({ type: 'set', name: msg.name, val: msg.val });
                    rooms[currentRoom].clients.forEach((clientWs, user) => {
                        // Rebotar la variable a todos menos al que la envió
                        if (user !== myUser) clientWs.send(outMsg);
                    });
                }
            }
        } catch (e) {
            // Ignorar errores de parseo por spam
        }
    });

    ws.on('close', () => {
        if (currentRoom && myUser && rooms[currentRoom]) {
            // Eliminar al usuario de la sala
            rooms[currentRoom].clients.delete(myUser);
            
            // Avisar a los demás quién quedó en la sala
            const userList = Array.from(rooms[currentRoom].clients.keys());
            rooms[currentRoom].clients.forEach((clientWs) => {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'user_list', users: userList }));
                }
            });

            // Si la sala queda vacía, borrarla para ahorrar memoria en Render
            if (rooms[currentRoom].clients.size === 0) {
                delete rooms[currentRoom];
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Cloud32 Voice Server escuchando en puerto ${PORT}`);
});
